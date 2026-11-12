import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, type Photo, type PhotoKind, PHOTO_KIND_LABELS, PHOTO_KIND_ORDER } from '../db';
import { openSaveToPhotos } from './saveSheet';
import { addPhoto, deletePhoto, getSettings, updatePhoto } from '../repo';
import { CaptureButton, KIND_ICONS, PhotoThumb, Select, toast, useBlobUrl } from './components';

/** Save camera/gallery files as photos of a supplier (and optionally a product). */
export async function savePhotos(files: File[], supplierId: string, kind: PhotoKind, productId: string | null = null) {
  const ids: string[] = [];
  for (const f of files) ids.push((await addPhoto({ supplierId, kind, file: f, productId })).id);
  const msg = `${files.length > 1 ? `${files.length} photos` : 'Photo'} saved in the app`;
  const { offerSaveToPhotos } = await getSettings();
  if (offerSaveToPhotos) toast(msg, { label: 'Save to Photos', onClick: () => openSaveToPhotos(ids) });
  else toast(msg);
  return ids;
}

export function usePhotos(supplierId: string | null | undefined, productId?: string | null) {
  return useLiveQuery(async () => {
    if (!supplierId && !productId) return [] as Photo[];
    const list = productId
      ? await db.photos.where('productId').equals(productId).toArray()
      : await db.photos.where('supplierId').equals(supplierId!).toArray();
    return list.filter((p) => !p.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [supplierId, productId]);
}

/** Big one-tap camera buttons, one per photo category. `ensureId` creates the record first if needed. */
export function QuickCapture(props: { ensureId: () => Promise<string>; photos: Photo[] }) {
  const counts = new Map<PhotoKind, number>();
  props.photos.forEach((p) => counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1));
  const [galleryKind, setGalleryKind] = useState<PhotoKind>('product');
  return (
    <div>
      <div className="capture-grid">
        {PHOTO_KIND_ORDER.map((k) => (
          <CaptureButton
            key={k}
            className="capture-btn"
            testId={`capture-${k}`}
            count={counts.get(k)}
            label={
              <>
                <span className="capture-ico">{KIND_ICONS[k]}</span>
                <span>{PHOTO_KIND_LABELS[k]}</span>
              </>
            }
            onFiles={async (files) => savePhotos(files, await props.ensureId(), k)}
          />
        ))}
      </div>
      <div className="row gallery-row">
        <Select
          label="Add from gallery as"
          value={galleryKind}
          onChange={setGalleryKind}
          options={PHOTO_KIND_ORDER.map((k) => ({ value: k, label: PHOTO_KIND_LABELS[k] }))}
          className="grow"
        />
        <CaptureButton gallery className="btn btn-outline" testId="gallery" label="🖼️ Gallery" onFiles={async (files) => savePhotos(files, await props.ensureId(), galleryKind)} />
      </div>
    </div>
  );
}

export function PhotoStrip(props: { photos: Photo[]; showKind?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!props.photos.length) return null;
  return (
    <>
      <div className="strip">
        {props.photos.map((p) => (
          <PhotoThumb key={p.id} photo={p} showKind={props.showKind} onClick={() => setOpen(p.id)} />
        ))}
      </div>
      {open && <PhotoViewer photoIds={props.photos.map((p) => p.id)} startId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Photos grouped by category with an add button per category (supplier detail screen). */
export function GroupedGallery(props: { supplierId: string; photos: Photo[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const general = props.photos;
  return (
    <div className="gallery">
      {PHOTO_KIND_ORDER.map((k) => {
        const list = general.filter((p) => p.kind === k);
        return (
          <div className="gallery-group" key={k}>
            <div className="gallery-hd">
              <span>
                {KIND_ICONS[k]} {PHOTO_KIND_LABELS[k]} <span className="muted">({list.length})</span>
              </span>
              <CaptureButton className="btn btn-sm" label="+ Photo" testId={`detail-capture-${k}`} onFiles={(files) => savePhotos(files, props.supplierId, k)} />
            </div>
            {list.length > 0 && (
              <div className="strip">
                {list.map((p) => (
                  <PhotoThumb key={p.id} photo={p} onClick={() => setOpen(p.id)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {open && <PhotoViewer photoIds={general.map((p) => p.id)} startId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function PhotoViewer(props: { photoIds: string[]; startId: string; onClose: () => void }) {
  const [idx, setIdx] = useState(Math.max(0, props.photoIds.indexOf(props.startId)));
  const id = props.photoIds[idx];
  const photo = useLiveQuery(() => (id ? db.photos.get(id) : undefined), [id]);
  const blob = useLiveQuery(() => (id ? db.photoBlobs.get(id) : undefined), [id]);
  const url = useBlobUrl(blob?.full);
  const products = useLiveQuery(
    () => (photo ? db.products.where('supplierId').equals(photo.supplierId).filter((p) => !p.deleted).toArray() : []),
    [photo?.supplierId],
  );
  if (!photo) return null;
  return (
    <div className="viewer" role="dialog" aria-label="Photo">
      <div className="viewer-top">
        <button className="btn btn-dark" onClick={props.onClose}>
          ✕ Close
        </button>
        <span className="muted-light">
          {idx + 1} / {props.photoIds.length}
        </span>
      </div>
      <div className="viewer-img">
        {url ? <img src={url} alt="" /> : <div className="muted-light">{photo.blobState === 'remote_only' ? 'In the cloud — will download on next sync' : 'Image not available'}</div>}
        {idx > 0 && (
          <button className="viewer-nav left" onClick={() => setIdx(idx - 1)} aria-label="Previous">
            ‹
          </button>
        )}
        {idx < props.photoIds.length - 1 && (
          <button className="viewer-nav right" onClick={() => setIdx(idx + 1)} aria-label="Next">
            ›
          </button>
        )}
      </div>
      <div className="viewer-bottom">
        <div className="row">
          <Select
            label="Type"
            className="grow dark"
            value={photo.kind}
            onChange={(v) => updatePhoto(photo.id, { kind: v })}
            options={PHOTO_KIND_ORDER.map((k) => ({ value: k, label: PHOTO_KIND_LABELS[k] }))}
          />
          {!!products?.length && (
            <Select
              label="Product"
              className="grow dark"
              value={photo.productId ?? ''}
              onChange={(v) => updatePhoto(photo.id, { productId: v || null })}
              options={[{ value: '', label: '— none —' }, ...products.map((p) => ({ value: p.id, label: p.name || '(unnamed)' }))]}
            />
          )}
        </div>
        <div className="row">
          <input
            className="viewer-caption"
            placeholder="Caption (optional)"
            defaultValue={photo.caption}
            key={photo.id}
            onBlur={(e) => e.target.value !== photo.caption && updatePhoto(photo.id, { caption: e.target.value })}
          />
          <button className="btn btn-dark" onClick={() => openSaveToPhotos([photo.id])} disabled={!url}>
            ⤓ Photos
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!confirm('Move this photo to Trash?')) return;
              await deletePhoto(photo.id);
              if (props.photoIds.length <= 1) props.onClose();
              else setIdx(Math.max(0, idx - 1));
            }}
          >
            Delete
          </button>
        </div>
        <div className="muted-light small">
          {photo.blobState === 'local' ? (photo.uploadError ? `Upload failed, will retry: ${photo.uploadError}` : 'Saved in the app · not uploaded yet') : photo.blobState === 'uploaded' ? 'Saved in the app and in the cloud' : ''}
          {photo.savedToDevice ? ' · copy sent to Photos' : ''}
        </div>
      </div>
    </div>
  );
}
