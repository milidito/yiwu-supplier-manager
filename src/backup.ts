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

const LOCAL_ONLY_KEYS = ['dirty', 'baseUpdatedAt', 'syncedAt', 'blobState', 'uploadError', 'savedToDevice'];

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
  restored: number;
  skipped: number;
  photosAdded: number;
  renumbered: string[];
}

type Decision = 'add' | 'update' | 'undelete' | 'skip';

/** newer edit wins; with `undelete`, records deleted on this phone but present in the backup come back. */
function decide(local: { updatedAt: string; deleted: 0 | 1 } | undefined, incoming: { updatedAt: string; deleted: 0 | 1 }, undelete: boolean): Decision {
  if (!local) return 'add';
  if (undelete && local.deleted && !incoming.deleted) return 'undelete';
  if (incoming.updatedAt > local.updatedAt) return 'update';
  return 'skip';
}

/**
 * Restore / merge a backup into this device.
 * Records are matched by their UUID: newer edits win, nothing on this phone is deleted.
 * `undelete: true` (used for "restore from snapshot") also brings back records that were deleted since the backup.
 * Imported changes are marked pending so they also reach the cloud (uploads are idempotent).
 */
export async function importBackup(file: Blob, d: AppDB = defaultDb, opts: { undelete?: boolean } = {}): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('Not a Yiwu Supplier Manager backup (data.json missing)');
  const data = JSON.parse(await dataFile.async('string'));
  if (data.app !== 'yiwu-supplier-manager') throw new Error('Not a Yiwu Supplier Manager backup');

  const undelete = !!opts.undelete;
  const res: ImportResult = { added: 0, updated: 0, restored: 0, skipped: 0, photosAdded: 0, renumbered: [] };
  const { codePrefix } = await getSettings(d);
  const t = nowIso();
  const mark = <T extends object>(r: T) => ({ ...r, dirty: 1 as const, baseUpdatedAt: null, syncedAt: null });
  const count = (dec: Decision) => {
    if (dec === 'add') res.added++;
    else if (dec === 'update') res.updated++;
    else if (dec === 'undelete') res.restored++;
    else res.skipped++;
  };
  const freeCode = async (wanted: string, selfId: string) => {
    const clash = await d.suppliers.where('code').equals(wanted).filter((x) => !x.deleted && x.id !== selfId).count();
    if (!clash) return wanted;
    let max = 0;
    await d.suppliers.each((x) => {
      const n = parseCodeNumber(x.code, codePrefix);
      if (n !== null && n > max) max = n;
    });
    const code = formatCode(codePrefix, max + 1);
    res.renumbered.push(`${wanted} → ${code}`);
    return code;
  };

  for (const s of data.suppliers as Supplier[]) {
    const local = await d.suppliers.get(s.id);
    const dec = decide(local, s, undelete);
    count(dec);
    if (dec === 'add') await d.suppliers.add({ ...(mark(s) as Supplier), code: await freeCode(s.code, s.id) });
    else if (dec === 'update') await d.suppliers.put({ ...local!, ...mark(s), code: local!.code });
    else if (dec === 'undelete') await d.suppliers.put({ ...local!, ...mark(s), deleted: 0, updatedAt: t, code: await freeCode(local!.code, s.id) });
  }

  for (const [table, rows] of [
    ['products', data.products as Product[]],
    ['quotations', data.quotations as Quotation[]],
  ] as const) {
    const tb = d[table] as unknown as import('dexie').Table<Product | Quotation, string>;
    for (const r of rows) {
      const local = await tb.get(r.id);
      const dec = decide(local, r, undelete);
      count(dec);
      if (dec === 'add') await tb.add(mark(r) as never);
      else if (dec === 'update') await tb.put({ ...local!, ...mark(r) } as never);
      else if (dec === 'undelete') await tb.put({ ...local!, ...mark(r), deleted: 0, updatedAt: t } as never);
    }
  }

  for (const p of data.photos as (Photo & { file: string | null })[]) {
    const local = await d.photos.get(p.id);
    const dec = decide(local, p, undelete);
    count(dec);
    if (dec === 'skip') continue;
    const { file: fileName, ...meta } = p;
    const zf = fileName ? zip.file(fileName) : null;
    let haveBlob = !!(await d.photoBlobs.get(p.id));
    if (zf && !haveBlob) {
      const full = await zf.async('blob');
      const typed = new Blob([full], { type: meta.mime || 'image/jpeg' });
      await d.photoBlobs.put({ id: p.id, full: typed, thumb: await thumbFromFull(typed) });
      res.photosAdded++;
      haveBlob = true;
    }
    const blobState = local?.blobState === 'uploaded' && haveBlob ? 'uploaded' : haveBlob ? 'local' : 'remote_only';
    await d.photos.put({
      ...(local ?? {}),
      ...(mark(meta) as Photo),
      ...(dec === 'undelete' ? { deleted: 0 as const, updatedAt: t } : {}),
      blobState,
      savedToDevice: local?.savedToDevice,
    });
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
