import JSZip from 'jszip';
import { db, type Photo, PHOTO_KIND_LABELS } from './db';
import { saveFile } from './backup';
import { locationLine } from './logic';

/**
 * "Save to Photos" for iPhone/Android.
 *
 * A web app cannot write into the camera roll silently. The supported way is the system share sheet
 * (navigator.share with image files), where iOS offers "Save N Images" (availability depends on the iOS
 * version; "Save to Files" is always offered). Each copy gets a caption bar burned in — supplier ID, photo
 * type, company and booth — so photos in the camera roll can never be confused with each other.
 * The originals inside the app are not changed.
 */

export const SHARE_BATCH = 20;

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return img;
}

export async function labelledFile(photo: Photo, index = 1): Promise<File> {
  const [stored, supplier, product] = await Promise.all([
    db.photoBlobs.get(photo.id),
    db.suppliers.get(photo.supplierId),
    photo.productId ? db.products.get(photo.productId) : Promise.resolve(undefined),
  ]);
  if (!stored) throw new Error('Image is not on this phone yet');
  const code = supplier?.code ?? 'YW-?';
  const name = `${code}_${photo.kind}_${index}.jpg`;
  try {
    const src = await decode(stored.full);
    const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
    const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
    const bar = Math.max(56, Math.round(w * 0.085));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h + bar;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0, w, h);
    ctx.fillStyle = '#0f4c5c';
    ctx.fillRect(0, h, w, bar);
    const pad = Math.round(bar * 0.18);
    const big = Math.round(bar * 0.36);
    const small = Math.round(bar * 0.24);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${big}px -apple-system, system-ui, sans-serif`;
    const line1 = `${code} · ${PHOTO_KIND_LABELS[photo.kind]}${product?.name ? ` · ${product.name}` : ''}`;
    ctx.fillText(line1, pad, h + pad, w - pad * 2);
    ctx.font = `400 ${small}px -apple-system, system-ui, 'PingFang SC', sans-serif`;
    const line2 = [supplier?.companyName, supplier ? locationLine(supplier) : '', new Date(photo.createdAt).toLocaleDateString()].filter(Boolean).join(' · ');
    ctx.fillText(line2, pad, h + pad + big + Math.round(bar * 0.08), w - pad * 2);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (out) return new File([out], name, { type: 'image/jpeg', lastModified: new Date(photo.createdAt).getTime() });
  } catch {
    /* fall back to the plain image */
  }
  return new File([stored.full], name, { type: stored.full.type || 'image/jpeg' });
}

export type SaveResult = 'shared' | 'cancelled' | 'downloaded' | 'nothing';

export interface PreparedPhotos {
  files: File[];
  ids: string[];
}

/** Step 1 (may take a few seconds): build labelled copies. */
export async function preparePhotos(photoIds: string[]): Promise<PreparedPhotos> {
  const photos = (await db.photos.bulkGet(photoIds.slice(0, SHARE_BATCH))).filter((p): p is Photo => !!p);
  const files: File[] = [];
  const ids: string[] = [];
  for (const [i, p] of photos.entries()) {
    try {
      files.push(await labelledFile(p, i + 1));
      ids.push(p.id);
    } catch {
      /* skip images not on this phone */
    }
  }
  return { files, ids };
}

export function canUseShareSheet(files: File[]): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  return !!nav.share && !!nav.canShare?.({ files });
}

/**
 * Step 2: MUST be called directly from a tap handler — Safari only opens the share sheet
 * right after a user gesture, so navigator.share() is called before anything else is awaited.
 */
export async function sharePrepared(p: PreparedPhotos): Promise<SaveResult> {
  if (!p.files.length) return 'nothing';
  if (canUseShareSheet(p.files)) {
    const sharing = navigator.share({ files: p.files });
    // iOS sometimes never resolves the promise after "Save Image": mark now, undo on cancel.
    await db.photos.where('id').anyOf(p.ids).modify({ savedToDevice: 1 });
    try {
      await sharing;
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        await db.photos.where('id').anyOf(p.ids).modify({ savedToDevice: 0 });
        return 'cancelled';
      }
      throw e;
    }
  }
  // computers / unsupported browsers: download a .zip of the labelled copies
  const zip = new JSZip();
  p.files.forEach((f) => zip.file(f.name, f, { compression: 'STORE' }));
  const blob = await zip.generateAsync({ type: 'blob' });
  await saveFile(blob, `yiwu-photos-${new Date().toISOString().slice(0, 10)}.zip`);
  await db.photos.where('id').anyOf(p.ids).modify({ savedToDevice: 1 });
  return 'downloaded';
}

export async function unsavedPhotoIds(): Promise<string[]> {
  const list = await db.photos.filter((p) => !p.deleted && !p.savedToDevice && p.blobState !== 'remote_only').toArray();
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((p) => p.id);
}
