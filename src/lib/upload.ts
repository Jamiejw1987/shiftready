'use client';
import { createClient } from '@/lib/supabase/browser';

/** Phone photos are often 3-8 MB. Shrink them to a sharp, readable JPEG before uploading. PDFs go as they are. */
export async function prepareFile(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  if (!file.type.startsWith('image/')) return { blob: file, type: file.type || 'application/pdf', name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    if (blob) return { blob, type: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch { /* browser can't read this image type: upload the original */ }
  return { blob: file, type: file.type, name: file.name };
}

/** Uploads to a one-time signed slot handed out by the server. */
export async function uploadToSlot(path: string, token: string, blob: Blob, contentType: string) {
  const { error } = await createClient().storage.from('documents').uploadToSignedUrl(path, token, blob, { contentType });
  return !error;
}

export const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
