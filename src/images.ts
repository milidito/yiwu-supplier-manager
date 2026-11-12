/**
 * Client-side image compression so hundreds of market photos fit on the phone
 * and upload quickly over weak mobile data.
 *  - full:  long edge max 1600px, JPEG q≈0.82  (typically 150–400 KB)
 *  - thumb: long edge max 360px,  JPEG q≈0.7   (typically 15–40 KB)
 * If the browser cannot decode the file (rare formats), the original is kept as-is.
 */
export interface ProcessedImage {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  mime: string;
}

const FULL_MAX = 1600;
const THUMB_MAX = 360;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' honours EXIF orientation from phone cameras
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement) {
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  return { w, h };
}

async function render(src: ImageBitmap | HTMLImageElement, max: number, quality: number) {
  const { w, h } = sizeOf(src);
  const scale = Math.min(1, max / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(src, 0, 0, tw, th);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Image encoding failed');
  return { blob, w: tw, h: th };
}

export async function processImage(file: Blob): Promise<ProcessedImage> {
  try {
    const src = await decode(file);
    const full = await render(src, FULL_MAX, 0.82);
    const thumb = await render(src, THUMB_MAX, 0.7);
    if ('close' in src && typeof src.close === 'function') src.close();
    return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h, mime: 'image/jpeg' };
  } catch {
    return { full: file, thumb: file, width: 0, height: 0, mime: file.type || 'application/octet-stream' };
  }
}

/** Make a thumbnail for a photo downloaded from the cloud. */
export async function thumbFromFull(full: Blob): Promise<Blob> {
  try {
    const src = await decode(full);
    const t = await render(src, THUMB_MAX, 0.7);
    return t.blob;
  } catch {
    return full;
  }
}
