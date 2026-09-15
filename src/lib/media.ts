/**
 * Picking, uploading and reading back the photos and videos attached to a bet.
 *
 * Uploads go into a private `bet-media` bucket laid out as
 * `<group_id>/<bet_id>/<uuid>.<ext>`, so the storage policy can read the
 * owning group out of the first path segment and reuse the same membership
 * helper the tables use. Nothing is public: reads are short-lived signed URLs.
 */
import { File } from 'expo-file-system';
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
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
    videoMaxDuration: 60,
  },
  proof: {
    quality: 0.6,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    videoMaxDuration: 30,
  },
} as const;

/** Opens the system library. Returns [] when the user backs out. */
export async function pickMedia(remaining: number): Promise<PickedMedia[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, remaining),
    ...COMPRESSION.attachment,
  });

  if (result.canceled) return [];
  return result.assets.slice(0, remaining).map(toPicked);
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
  return result.assets.slice(0, remaining).map(toPicked);
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
  return asset ? toPicked(asset) : null;
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
  return asset ? toPicked(asset) : null;
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
