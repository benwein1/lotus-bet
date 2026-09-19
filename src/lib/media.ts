/**
 * Picking, uploading and reading back the photos and videos attached to a bet.
 *
 * Uploads go into a private `bet-media` bucket laid out as
 * `<group_id>/<bet_id>/<uuid>.<ext>`, so the storage policy can read the
 * owning group out of the first path segment and reuse the same membership
 * helper the tables use. Nothing is public: reads are short-lived signed URLs.
 */
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type {
  BetMedia,
  BetMediaKind,
  BetMediaPurpose,
  BetMediaRow,
} from './database.types';
import { supabase } from './supabase';

export { splitMedia } from './media-rules';

export const BUCKET = 'bet-media';

/**
 * Profile and group pictures. Public, unlike `bet-media` — see the note at the
 * top of `20260906090000_avatars.sql` for why a face is not treated like a
 * bet's attachments.
 */
export const AVATAR_BUCKET = 'avatars';

/** Four is enough to tell a story and short enough to stay scrollable. */
export const MAX_ATTACHMENTS = 4;

/**
 * Proof gets a larger budget than the bet's own illustration, and it is a
 * budget for the whole bet rather than for one person: an argument worth
 * photographing from three angles is exactly the argument this is for.
 */
export const MAX_PROOF = 8;

/** Signed URLs are re-fetched on every load, so they only need to outlive one. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * How long a signed URL is reused before being asked for again.
 *
 * Comfortably inside the hour the URL is actually good for, so a cached one is
 * never handed out close enough to expiry to break mid-render. The gap is the
 * whole point: a feed refresh is triggered by every realtime event and every
 * screen focus, and re-signing the same twenty paths each time is a storage
 * round trip that buys nothing — the objects have not moved.
 */
export const SIGN_CACHE_MS = 45 * 60 * 1000;

const signCache = new Map<string, { url: string; expires: number }>();

/**
 * Drops the cache. Called on sign-out, because the next person to use this
 * device must not inherit URLs minted for somebody else's session.
 */
export function clearMediaCache(): void {
  signCache.clear();
}

export interface PickedMedia {
  /** Local file URI, straight from the picker. */
  uri: string;
  kind: BetMediaKind;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  mimeType: string;
  fileName: string | null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

function toPicked(asset: ImagePicker.ImagePickerAsset): PickedMedia {
  const isVideo = asset.type === 'video' || asset.type === 'pairedVideo';
  const mimeType = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');

  return {
    uri: asset.uri,
    kind: isVideo ? 'video' : 'image',
    width: asset.width || null,
    height: asset.height || null,
    // The picker reports video length in milliseconds.
    durationMs: asset.duration != null ? Math.round(asset.duration) : null,
    mimeType,
    fileName: asset.fileName ?? null,
  };
}

/**
 * How hard to squeeze a file on the way in.
 *
 * `expo-image-picker` does the work itself — it re-encodes before handing back
 * a URI — so there is no second compression library to add. `quality` is JPEG
 * quality for stills; `videoQuality` picks the export preset; `videoMaxDuration`
 * is the real lever on size, because a clip's bytes scale with its length far
 * more predictably than with its preset.
 *
 * Proof is squeezed harder than a bet's own illustration. A receipt only has to
 * be legible enough to end an argument, and it is uploaded on a phone in a bar
 * on a bad connection — the illustration is the bet's face and sits in a
 * full-bleed feed card.
 */
const COMPRESSION = {
  attachment: {
    quality: 0.85,
    // The long edge, in pixels. A modern phone camera hands back something
    // like 4032×3024; the card it lands in is a phone width at 3× density,
    // which is about 1170px. Everything past that is downloaded, decoded and
    // then thrown away by the scaler.
    //
    // 1600 keeps real headroom over that — it is still oversampled on the
    // densest screen and on a tablet — while cutting roughly 85% of the
    // pixels, and pixels are what the cost is in: bytes over the wire, decode
    // time on the scroll, bitmap bytes in memory, and the per-account quota.
    maxEdge: 1600,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
    videoMaxDuration: 60,
  },
  proof: {
    quality: 0.6,
    // Proof is squeezed harder for the same reason its quality is lower: a
    // receipt has to be legible enough to end an argument, not to be a bet's
    // full-bleed face. It renders in a gallery tile, never edge to edge.
    maxEdge: 1200,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    // Fifteen seconds. Video is the overwhelming majority of this app's
    // storage risk for a small slice of its value — SCALEABILITY.md §4 puts
    // capping it first — and a receipt only has to be legible enough to end an
    // argument. A bet's own illustration keeps its minute.
    videoMaxDuration: 15,
  },
} as const;

/**
 * Re-encodes a still so the file that leaves the phone carries no metadata.
 *
 * SECURITY.md finding #6. A photo taken to prove a bet in somebody's flat can
 * carry GPS coordinates, and every member of the group can download the
 * object. `expo-image-picker` re-encodes stills at the configured quality,
 * which drops most metadata *in practice* — but "in practice" is not a
 * property, and the whole finding is that nothing guaranteed it.
 *
 * A re-encode with no actions is the guarantee: the encoder writes a fresh
 * file from decoded pixels, so there is no EXIF block to carry anything over.
 * On the web the same call goes through a canvas, which drops metadata for the
 * same reason.
 *
 * **Videos are not covered, and pretending otherwise would be worse than not
 * trying.** This library does not touch them. Shortening proof clips to 15
 * seconds is the mitigation that exists; stripping video metadata needs a
 * transcoding step nothing here has.
 */
async function stripMetadata(
  picked: PickedMedia,
  quality: number,
  maxEdge: number
): Promise<PickedMedia> {
  if (picked.kind !== 'image') return picked;

  // A failure is surfaced rather than swallowed. Falling back to the original
  // would upload the coordinates anyway and say nothing, which is exactly the
  // "not a guarantee" state this function exists to end.
  const result = await ImageManipulator.manipulateAsync(picked.uri, resizeTo(picked, maxEdge), {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return {
    ...picked,
    uri: result.uri,
    width: result.width || picked.width,
    height: result.height || picked.height,
    // The re-encode settles the format, whatever came in.
    mimeType: 'image/jpeg',
    fileName: picked.fileName?.replace(/\.[^.]+$/, '.jpg') ?? null,
  };
}

/**
 * The resize action for a picked still, or none at all.
 *
 * **The long edge is what gets capped, not the width.** Resizing by width
 * alone turns a portrait photo — which is most of them, taken on a phone held
 * upright — into something taller than the cap rather than smaller than it, so
 * the expensive dimension is the one left untouched. `manipulateAsync` scales
 * the other side to preserve the aspect ratio when only one is given, so
 * naming the long one is the whole job.
 *
 * An image already inside the cap gets an empty action list, which is exactly
 * what this function did before the cap existed — the re-encode still happens,
 * so the metadata guarantee above holds either way. A picker that gave us no
 * dimensions gets the same treatment: guessing at a resize from nothing could
 * upscale, and an upscale costs bytes to add no detail.
 */
function resizeTo(picked: PickedMedia, maxEdge: number): ImageManipulator.Action[] {
  const { width, height } = picked;
  if (!width || !height) return [];

  const longest = Math.max(width, height);
  if (longest <= maxEdge) return [];

  return width >= height ? [{ resize: { width: maxEdge } }] : [{ resize: { height: maxEdge } }];
}

/** Strips every still in a picked batch, leaving videos alone. */
function stripBatch(
  picked: PickedMedia[],
  quality: number,
  maxEdge: number
): Promise<PickedMedia[]> {
  return Promise.all(picked.map((item) => stripMetadata(item, quality, maxEdge)));
}

/** Opens the system library. Returns [] when the user backs out. */
export async function pickMedia(remaining: number): Promise<PickedMedia[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, remaining),
    ...COMPRESSION.attachment,
  });

  if (result.canceled) return [];
  return stripBatch(
    result.assets.slice(0, remaining).map(toPicked),
    COMPRESSION.attachment.quality,
    COMPRESSION.attachment.maxEdge
  );
}

/**
 * The same library picker, squeezed for proof of outcome.
 *
 * Separate from `pickMedia` rather than a flag on it, because the two differ
 * in more than compression: proof has its own cap, and a resolved bet can
 * collect several rounds of it from several people, so "remaining" is not the
 * same budget.
 */
export async function pickProofMedia(remaining: number): Promise<PickedMedia[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, remaining),
    ...COMPRESSION.proof,
  });

  if (result.canceled) return [];
  return stripBatch(
    result.assets.slice(0, remaining).map(toPicked),
    COMPRESSION.proof.quality,
    COMPRESSION.proof.maxEdge
  );
}

/** Shoot proof there and then. The camera is the common case for a receipt. */
export async function captureProofMedia(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera access is off for Lotus Bet.');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images', 'videos'],
    ...COMPRESSION.proof,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? stripMetadata(toPicked(asset), COMPRESSION.proof.quality, COMPRESSION.proof.maxEdge) : null;
}

/** Opens the camera. Returns null when the user backs out or declines access. */
export async function captureMedia(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera access is off for Lotus Bet.');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images', 'videos'],
    ...COMPRESSION.attachment,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? stripMetadata(toPicked(asset), COMPRESSION.attachment.quality, COMPRESSION.attachment.maxEdge) : null;
}

/**
 * Reads a local file into bytes.
 *
 * Two paths because the picker hands back two different kinds of URI: a real
 * file URI on device, and a `blob:` URL on the web that only `fetch` can open.
 */
async function readBytes(uri: string): Promise<ArrayBuffer | Blob> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return response.blob();
  }
  return new File(uri).arrayBuffer();
}

export interface UploadedMedia {
  storagePath: string;
  kind: BetMediaKind;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/**
 * Uploads one file and returns the row shape the caller should insert. The
 * bet row has to exist first — its id is part of the path, which is what ties
 * the object to a group the policies can check.
 */
export async function uploadBetMedia(
  groupId: string,
  betId: string,
  media: PickedMedia
): Promise<UploadedMedia> {
  const extension =
    EXTENSION_BY_MIME[media.mimeType] ??
    media.fileName?.split('.').pop()?.toLowerCase() ??
    (media.kind === 'video' ? 'mp4' : 'jpg');

  const storagePath = `${groupId}/${betId}/${randomId()}.${extension}`;
  const body = await readBytes(media.uri);

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, body, {
    contentType: media.mimeType,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return {
    storagePath,
    kind: media.kind,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
  };
}

/**
 * Removes objects that were uploaded but never got a row.
 *
 * `createBet` and `addBetProof` upload first and insert the `bet_media` rows
 * afterwards, because the bet's id is part of the storage path and so the row
 * has to exist before there is anywhere to put the file. That ordering is
 * correct and it leaves a window: if the third upload of four fails, or the
 * insert is refused, the objects already in the bucket have nothing pointing
 * at them and nothing will ever delete them.
 *
 * Orphaned bytes are the better half of that failure — the bet survives — but
 * they are bytes the group pays for forever, and SCALEABILITY.md puts storage
 * at the top of the cost list. So the caller sweeps up what it uploaded.
 *
 * Best-effort and silent by design: this runs while an error is already on its
 * way to the user, and "could not post the bet, and also could not tidy up" is
 * two failures reported where one is actionable.
 */
export async function discardUploads(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // Nothing to do and nobody to tell. The orphan is now a storage-sweep
    // problem rather than a user-facing one.
  }
  for (const path of paths) signCache.delete(path);
}

/**
 * Turns stored rows into renderable ones. Signing is batched: a feed of ten
 * bets with media should cost one round trip, not ten.
 */
export async function signMedia(rows: BetMediaRow[]): Promise<BetMedia[]> {
  if (rows.length === 0) return [];

  const now = Date.now();
  const urls = new Map<string, string>();

  // Anything still comfortably inside its TTL is answered from memory, so a
  // refresh that changed one like does not re-sign the whole feed's media.
  const missing: string[] = [];
  for (const row of rows) {
    const hit = signCache.get(row.storage_path);
    if (hit && hit.expires > now) urls.set(row.storage_path, hit.url);
    else if (!missing.includes(row.storage_path)) missing.push(row.storage_path);
  }

  if (missing.length > 0) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(error.message);

    for (const entry of data ?? []) {
      // `path` and `signedUrl` are both nullable: an object that has gone
      // comes back as an entry with an error rather than as a missing row.
      const path = entry.path;
      const url = entry.signedUrl;
      if (!path || !url) continue;
      urls.set(path, url);
      signCache.set(path, { url, expires: now + SIGN_CACHE_MS });
    }
  }

  return rows
    .map((row) => {
      const url = urls.get(row.storage_path);
      // A row whose object has gone is simply not rendered, rather than
      // rendering as a broken tile.
      return url ? { ...row, url } : null;
    })
    .filter((row): row is BetMedia => row !== null);
}

function randomId(): string {
  // Good enough for a filename: the path is already scoped by group and bet,
  // and the bucket is private.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Avatars ----------------------------------------------------------------

/**
 * Picks one square image for a profile or a group.
 *
 * Cropping is forced to 1:1 in the picker rather than fixed up with CSS later:
 * an avatar is rendered in a circle in a dozen places, and letting the user
 * choose what ends up inside that circle is the difference between a portrait
 * and a cropped forehead.
 */
export async function pickAvatar(): Promise<PickedMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? toPicked(asset) : null;
}

/**
 * Uploads an avatar and returns the public URL to store on the row.
 *
 * The path is stable per owner (`users/<id>/avatar.<ext>`) and upserted, so a
 * user who changes their picture five times leaves one object behind rather
 * than five. The cache-busting query string is what makes the new one show up
 * — the URL is otherwise identical and both the CDN and expo-image would
 * happily keep serving the old bytes.
 */
export async function uploadAvatar(
  owner: { kind: 'users' | 'groups'; id: string },
  media: PickedMedia
): Promise<string> {
  const extension =
    EXTENSION_BY_MIME[media.mimeType] ??
    media.fileName?.split('.').pop()?.toLowerCase() ??
    'jpg';

  const storagePath = `${owner.kind}/${owner.id}/avatar.${extension}`;
  const body = await readBytes(media.uri);

  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(storagePath, body, {
    contentType: media.mimeType,
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath);
  return `${data.publicUrl}?v=${Date.now().toString(36)}`;
}
