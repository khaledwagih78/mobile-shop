'use client';
import { supabaseBrowser } from './supabase/client';

export const MEDIA_BUCKET = 'device-media';
export type MediaKind = 'INTAKE' | 'DIAGNOSIS' | 'REPAIR' | 'TEST' | 'HANDOVER' | 'CUSTOMER_UPLOAD';

/** Resize to max 1600px and re-encode as JPEG (~200–400KB) — fast uploads on mobile data. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('NOT_AN_IMAGE');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ENCODE_FAILED'))), 'image/jpeg', quality));
}

/**
 * Uploads photos to the PRIVATE bucket (path <branch>/<device>/<uuid>.jpg, enforced by
 * storage RLS) and registers each one on the order. Returns how many failed.
 */
export async function uploadDeviceMedia(opts: {
  branchId: string;
  deviceId: string;
  orderId: string | null;
  kind: MediaKind;
  files: File[];
  visibleToCustomer?: boolean;
}): Promise<{ ok: number; failed: number }> {
  const sb = supabaseBrowser();
  let ok = 0;
  let failed = 0;
  for (const f of opts.files) {
    try {
      const blob = await compressImage(f);
      const path = `${opts.branchId}/${opts.deviceId}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const reg = await sb.rpc('register_device_media', {
        p_device: opts.deviceId,
        p_path: path,
        p_kind: opts.kind,
        p_order: opts.orderId,
        p_caption: null,
        p_visible: opts.visibleToCustomer ?? false,
      });
      if (reg.error) throw reg.error;
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}

/** Short-lived signed URLs (private photos are never public). */
export async function signedUrls(paths: string[], seconds = 600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabaseBrowser().storage.from(MEDIA_BUCKET).createSignedUrls(paths, seconds);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}
