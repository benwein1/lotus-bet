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

import type { BetMedia, BetMediaKind, BetMediaRow } from './database.types';
import { supabase } from './supabase';

export const BUCKET = 'bet-media';

/**
 * Profile and group pictures. Public, unlike `bet-media` — see the note at the
 * top of `20260906090000_avatars.sql` for why a face is not treated like a
 * bet's attachments.
 */
export const AVATAR_BUCKET = 'avatars';

/** Four is enough to tell a story and short enough to stay scrollable. */
export const MAX_ATTACHMENTS = 4;

/** Signed URLs are re-fetched on every load, so they only need to outlive one. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

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

/** Opens the system library. Returns [] when the user backs out. */
export async function pickMedia(remaining: number): Promise<PickedMedia[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, remaining),
    quality: 0.85,
    videoMaxDuration: 60,
  });

  if (result.canceled) return [];
  return result.assets.slice(0, remaining).map(toPicked);
}

/** Opens the camera. Returns null when the user backs out or declines access. */
export async function captureMedia(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera access is off for Lotus Bet.');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images', 'videos'],
    quality: 0.85,
    videoMaxDuration: 60,
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
 * Turns stored rows into renderable ones. Signing is batched: a feed of ten
 * bets with media should cost one round trip, not ten.
 */
export async function signMedia(rows: BetMediaRow[]): Promise<BetMedia[]> {
  if (rows.length === 0) return [];

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      rows.map((row) => row.storage_path),
      SIGNED_URL_TTL_SECONDS
    );
  if (error) throw new Error(error.message);

  const urls = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));

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
