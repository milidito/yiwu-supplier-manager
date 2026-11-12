import JSZip from 'jszip';
import {
  db as defaultDb,
  type AppDB,
  type Photo,
  type Product,
  type Quotation,
  type Supplier,
  PHOTO_KIND_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  nowIso,
} from './db';
import { formatCode, getSettings, parseCodeNumber } from './repo';
import { thumbFromFull } from './images';

/**
 * Portable backup: a single .zip containing
 *   data.json                    full machine-readable backup (used for restore)
 *   suppliers.csv / products.csv / quotations.csv / photos.csv   (open in Excel / Google Sheets; UTF-8)
 *   photos/YW-001/YW-001_card_front_1.jpg ...                     every photo, named by supplier code
 */

const LOCAL_ONLY_KEYS = ['dirty', 'baseUpdatedAt', 'syncedAt', 'blobState', 'uploadError'];

function strip<T extends object>(r: T) {
  const o = { ...r } as Record<string, unknown>;
  for (const k of LOCAL_ONLY_KEYS) delete o[k];
  return o;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // BOM so Excel opens Chinese characters correctly
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function safe(s: string) {
  return s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60);
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  counts: { suppliers: number; products: number; quotations: number; photos: number; missingPhotoFiles: number };
}

export async function exportBackup(d: AppDB = defaultDb, includePhotos = true): Promise<ExportResult> {
  const suppliers = (await d.suppliers.toArray()).filter((s) => !s.deleted).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const products = (await d.products.toArray()).filter((p) => !p.deleted);
  const quotations = (await d.quotations.toArray()).filter((q) => !q.deleted);
  const photos = (await d.photos.toArray()).filter((p) => !p.deleted);
  const sById = new Map(suppliers.map((s) => [s.id, s]));
  const pById = new Map(products.map((p) => [p.id, p]));

  const zip = new JSZip();
  const photoFiles: Record<string, string> = {};
  let missing = 0;

  if (includePhotos) {
    const counters = new Map<string, number>();
    for (const ph of photos) {
      const s = sById.get(ph.supplierId);
      const code = s?.code ?? 'unknown';
      const key = `${code}_${ph.kind}`;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      const blob = await d.photoBlobs.get(ph.id);
      if (!blob) {
        missing++;
        continue;
      }
      const ext = ph.mime === 'image/png' ? 'png' : 'jpg';
      const name = `photos/${safe(code)}/${safe(code)}_${ph.kind}_${n}.${ext}`;
      photoFiles[ph.id] = name;
      zip.file(name, blob.full, { binary: true, compression: 'STORE' });
    }
  }

  const data = {
    app: 'yiwu-supplier-manager',
    formatVersion: 1,
    exportedAt: nowIso(),
    settings: await getSettings(d),
    suppliers: suppliers.map(strip),
    products: products.map(strip),
    quotations: quotations.map(strip),
    photos: photos.map((p) => ({ ...strip(p), file: photoFiles[p.id] ?? null })),
  };
  zip.file('data.json', JSON.stringify(data, null, 2));

  zip.file(
    'suppliers.csv',
    toCsv(
      ['Supplier ID', 'Company', 'Contact', 'WeChat', 'Phone', 'Email', 'District', 'Floor', 'Street/aisle', 'Booth', 'Location notes', 'Category', 'Type', 'Status', 'My rating', 'Follow-up date', 'Follow-up note', 'Notes', 'Created', 'Updated'],
      suppliers.map((s) => [s.code, s.companyName, s.contactPerson, s.wechatId, s.phone, s.email, s.district, s.floor, s.street, s.booth, s.locationNotes, s.category, TYPE_LABELS[s.supplierType], STATUS_LABELS[s.status], s.rating, s.followUpDate, s.followUpNote, s.notes, s.createdAt, s.updatedAt]),
    ),
  );
  zip.file(
    'products.csv',
    toCsv(
      ['Supplier ID', 'Company', 'Product', 'Category', 'Notes', 'Created'],
      products.map((p) => [sById.get(p.supplierId)?.code, sById.get(p.supplierId)?.companyName, p.name, p.category, p.notes, p.createdAt]),
    ),
  );
  zip.file(
    'quotations.csv',
    toCsv(
      ['Supplier ID', 'Company', 'Booth', 'Product', 'Price', 'Currency', 'Unit', 'MOQ', 'Price tier qty', 'Quote date', 'Notes'],
      quotations.map((q) => {
        const s = sById.get(q.supplierId);
        return [s?.code, s?.companyName, [s?.district, s?.floor, s?.street, s?.booth].filter(Boolean).join(' / '), pById.get(q.productId)?.name, q.price, q.currency, q.unit, q.moq, q.tierQty, q.quoteDate, q.notes];
      }),
    ),
  );
  zip.file(
    'photos.csv',
    toCsv(
      ['Supplier ID', 'Type', 'Product', 'Caption', 'File', 'Taken'],
      photos.map((p) => [sById.get(p.supplierId)?.code, PHOTO_KIND_LABELS[p.kind], p.productId ? pById.get(p.productId)?.name : '', p.caption, photoFiles[p.id] ?? '(file not on this device)', p.createdAt]),
    ),
  );

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const stamp = nowIso().slice(0, 16).replace(/[:T]/g, '-');
  return {
    blob,
    filename: `yiwu-suppliers-backup-${stamp}.zip`,
    counts: { suppliers: suppliers.length, products: products.length, quotations: quotations.length, photos: photos.length, missingPhotoFiles: missing },
  };
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  photosAdded: number;
  renumbered: string[];
}

/**
 * Restore / merge a backup into this device.
 * Records are matched by their UUID: newer edits win, nothing is deleted.
 * Imported changes are marked pending so they also reach the cloud (uploads are idempotent).
 */
export async function importBackup(file: Blob, d: AppDB = defaultDb): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('Not a Yiwu Supplier Manager backup (data.json missing)');
  const data = JSON.parse(await dataFile.async('string'));
  if (data.app !== 'yiwu-supplier-manager') throw new Error('Not a Yiwu Supplier Manager backup');

  const res: ImportResult = { added: 0, updated: 0, skipped: 0, photosAdded: 0, renumbered: [] };
  const { codePrefix } = await getSettings(d);

  const mark = <T extends object>(r: T) => ({ ...r, dirty: 1 as const, baseUpdatedAt: null, syncedAt: null });

  // suppliers (with code-collision handling)
  for (const s of data.suppliers as Supplier[]) {
    const local = await d.suppliers.get(s.id);
    if (local) {
      if (s.updatedAt > local.updatedAt) {
        await d.suppliers.put({ ...local, ...mark(s), code: local.code });
        res.updated++;
      } else res.skipped++;
      continue;
    }
    const clash = await d.suppliers.where('code').equals(s.code).filter((x) => !x.deleted).count();
    let code = s.code;
    if (clash) {
      let max = 0;
      await d.suppliers.each((x) => {
        const n = parseCodeNumber(x.code, codePrefix);
        if (n !== null && n > max) max = n;
      });
      code = formatCode(codePrefix, max + 1);
      res.renumbered.push(`${s.code} → ${code}`);
    }
    await d.suppliers.add({ ...(mark(s) as Supplier), code });
    res.added++;
  }

  for (const [table, rows] of [
    ['products', data.products as Product[]],
    ['quotations', data.quotations as Quotation[]],
  ] as const) {
    const t = d[table] as unknown as import('dexie').Table<Product | Quotation, string>;
    for (const r of rows) {
      const local = await t.get(r.id);
      if (!local) {
        await t.add(mark(r) as never);
        res.added++;
      } else if (r.updatedAt > local.updatedAt) {
        await t.put({ ...local, ...mark(r) } as never);
        res.updated++;
      } else res.skipped++;
    }
  }

  for (const p of data.photos as (Photo & { file: string | null })[]) {
    const local = await d.photos.get(p.id);
    if (local && !(p.updatedAt > local.updatedAt)) {
      res.skipped++;
      continue;
    }
    const { file: fileName, ...meta } = p;
    const zf = fileName ? zip.file(fileName) : null;
    const haveLocalBlob = local ? !!(await d.photoBlobs.get(p.id)) : false;
    if (zf && !haveLocalBlob) {
      const full = await zf.async('blob');
      const typed = new Blob([full], { type: meta.mime || 'image/jpeg' });
      await d.photoBlobs.put({ id: p.id, full: typed, thumb: await thumbFromFull(typed) });
      res.photosAdded++;
    }
    const hasBlob = haveLocalBlob || !!zf;
    await d.photos.put({
      ...(local ?? {}),
      ...(mark(meta) as Photo),
      blobState: local?.blobState === 'uploaded' ? 'uploaded' : hasBlob ? 'local' : 'remote_only',
    });
    if (local) res.updated++;
    else res.added++;
  }
  return res;
}

/** Save a generated file: native share sheet on phones (→ "Save to Files", AirDrop, WeChat…), else download. */
export async function saveFile(blob: Blob, filename: string, preferShare = false) {
  const file = new File([blob], filename, { type: blob.type || 'application/zip' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (preferShare && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
