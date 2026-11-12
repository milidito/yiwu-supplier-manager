import {
  db as defaultDb,
  type AppDB,
  type Photo,
  PHOTO_KIND_LABELS,
  PHOTO_KIND_ORDER,
  type Product,
  type Quotation,
  STATUS_LABELS,
  TYPE_LABELS,
} from './db';
import { latestQuotes } from './logic';

/**
 * Excel copy of everything, readable by a human:
 *   Sheet "Suppliers"         one row per supplier, one column per field, photos embedded in the same row
 *   Sheet "Products & prices" one row per quote, with the product photo
 *   Sheet "About"             what the file contains
 * Photos are embedded as small previews (≈360 px) so the file stays manageable; full-size photos
 * are in the backup .zip and in the cloud. This file is a copy for reading/sharing — restore uses the .zip.
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_PHOTOS_PER_SUPPLIER = 20;

const PHOTO_COL_WIDTH = 18; // Excel width units (~130 px)
const PHOTO_BOX = { w: 122, h: 104 }; // px available for an image inside a cell (below the label)
const ROW_HEIGHT_PT = 100; // ~133 px

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function extOf(mime: string, bytes?: Uint8Array): 'jpeg' | 'png' | null {
  if (bytes && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes && bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (/jpe?g/.test(mime)) return 'jpeg';
  if (/png/.test(mime)) return 'png';
  return null;
}

function fit(w: number, h: number) {
  if (!w || !h) return { width: PHOTO_BOX.w, height: Math.round(PHOTO_BOX.w * 0.75) };
  const s = Math.min(PHOTO_BOX.w / w, PHOTO_BOX.h / h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function sortPhotos(list: Photo[]) {
  const rank = new Map(PHOTO_KIND_ORDER.map((k, i) => [k, i]));
  return [...list].sort((a, b) => (rank.get(a.kind)! - rank.get(b.kind)!) || a.createdAt.localeCompare(b.createdAt));
}

function quoteLine(p: Product | undefined, q: Quotation) {
  const bits = [`${q.price} ${q.currency}/${q.unit}`];
  if (q.moq) bits.push(`MOQ ${q.moq}`);
  if (q.tierQty) bits.push(`@${q.tierQty}`);
  if (q.quoteDate) bits.push(q.quoteDate);
  return `${p?.name || 'Product'}: ${bits.join(', ')}`;
}

export interface ExcelResult {
  blob: Blob;
  filename: string;
  counts: { suppliers: number; quotes: number; images: number; photosNotOnPhone: number };
}

export async function exportExcel(d: AppDB = defaultDb, onProgress?: (done: number, total: number) => void): Promise<ExcelResult> {
  const ExcelJS = (await import('exceljs')).default;
  const num = (c: string) => Number.parseInt(c.replace(/\D/g, ''), 10) || 0;
  const suppliers = (await d.suppliers.toArray()).filter((s) => !s.deleted).sort((a, b) => num(a.code) - num(b.code) || a.code.localeCompare(b.code));
  const products = (await d.products.toArray()).filter((p) => !p.deleted);
  const quotes = (await d.quotations.toArray()).filter((q) => !q.deleted);
  const photos = (await d.photos.toArray()).filter((p) => !p.deleted);
  const pById = new Map(products.map((p) => [p.id, p]));
  const sById = new Map(suppliers.map((s) => [s.id, s]));
  const latest = latestQuotes(quotes);
  const photosBySupplier = new Map<string, Photo[]>();
  for (const ph of photos) photosBySupplier.set(ph.supplierId, [...(photosBySupplier.get(ph.supplierId) ?? []), ph]);
  const maxPhotos = Math.min(MAX_PHOTOS_PER_SUPPLIER, Math.max(1, ...[...photosBySupplier.values()].map((l) => l.length)));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Yiwu Supplier Manager';
  wb.created = new Date();
  const counts = { suppliers: suppliers.length, quotes: quotes.length, images: 0, photosNotOnPhone: 0 };
  const header = { bold: true, color: { argb: 'FFFFFFFF' } };
  const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0F4C5C' } };

  /** embed a photo preview into cell (row r, col c — both 1-based); the cell text is the photo type */
  const imageCache = new Map<string, number>();
  const embed = async (ws: import('exceljs').Worksheet, ph: Photo, r: number, c: number, label: string) => {
    const cell = ws.getCell(r, c);
    cell.value = label;
    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: false };
    cell.font = { size: 8, color: { argb: 'FF5B6770' } };
    const blob = await d.photoBlobs.get(ph.id);
    if (!blob) {
      cell.value = `${label} (in cloud, not on this phone)`;
      counts.photosNotOnPhone++;
      return;
    }
    let imageId = imageCache.get(ph.id);
    if (imageId === undefined) {
      const src = blob.thumb.size ? blob.thumb : blob.full;
      const bytes = new Uint8Array(await src.slice(0, 4).arrayBuffer());
      const ext = extOf(src.type, bytes);
      if (!ext) {
        cell.value = `${label} (format not previewable)`;
        return;
      }
      imageId = wb.addImage({ base64: await blobToBase64(src), extension: ext });
      imageCache.set(ph.id, imageId);
    }
    // ExcelJS anchors are 0-based; place the image just below the small label
    ws.addImage(imageId, {
      tl: { col: c - 1 + 0.04, row: r - 1 + 0.16 } as never,
      ext: fit(ph.width, ph.height),
      editAs: 'oneCell',
    });
    counts.images++;
  };

  // ---------------- Suppliers ----------------
  const landscape = { orientation: 'landscape' as const, fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  const ws = wb.addWorksheet('Suppliers', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }], pageSetup: landscape });
  ws.pageSetup.printTitlesRow = '1:1';
  const cols: { header: string; key: string; width: number }[] = [
    { header: 'Supplier ID', key: 'code', width: 11 },
    { header: 'Company', key: 'companyName', width: 26 },
    { header: 'Contact person', key: 'contactPerson', width: 16 },
    { header: 'WeChat ID', key: 'wechatId', width: 18 },
    { header: 'Phone / WhatsApp', key: 'phone', width: 18 },
    { header: 'Email', key: 'email', width: 22 },
    { header: 'District', key: 'district', width: 12 },
    { header: 'Floor', key: 'floor', width: 7 },
    { header: 'Street / aisle', key: 'street', width: 10 },
    { header: 'Booth', key: 'booth', width: 10 },
    { header: 'Location notes', key: 'locationNotes', width: 18 },
    { header: 'Main category', key: 'category', width: 16 },
    { header: 'Type (my observation)', key: 'type', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'My rating (1-5)', key: 'rating', width: 9 },
    { header: 'Follow-up date', key: 'followUpDate', width: 12 },
    { header: 'Follow-up task', key: 'followUpNote', width: 22 },
    { header: 'Notes', key: 'notes', width: 34 },
    { header: 'Products & latest prices', key: 'products', width: 44 },
    { header: 'Photos', key: 'photoCount', width: 7 },
    { header: 'Created', key: 'createdAt', width: 17 },
    { header: 'Last updated', key: 'updatedAt', width: 17 },
  ];
  for (let i = 1; i <= maxPhotos; i++) cols.push({ header: `Photo ${i}`, key: `photo${i}`, width: PHOTO_COL_WIDTH });
  ws.columns = cols;
  const firstPhotoCol = cols.length - maxPhotos + 1;
  ws.getRow(1).font = header;
  ws.getRow(1).fill = headerFill;
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: firstPhotoCol - 1 } };

  const total = photos.length;
  let done = 0;
  for (const [i, s] of suppliers.entries()) {
    const r = i + 2;
    const myProducts = products.filter((p) => p.supplierId === s.id);
    const productLines = myProducts.flatMap((p) => {
      const qs = latest.filter((q) => q.productId === p.id).sort((a, b) => a.price - b.price);
      return qs.length ? qs.map((q) => quoteLine(p, q)) : [`${p.name || 'Product'}: (no price)`];
    });
    const myPhotos = sortPhotos(photosBySupplier.get(s.id) ?? []);
    const row = ws.getRow(r);
    row.values = {
      code: s.code,
      companyName: s.companyName,
      contactPerson: s.contactPerson,
      wechatId: s.wechatId,
      phone: s.phone,
      email: s.email,
      district: s.district,
      floor: s.floor,
      street: s.street,
      booth: s.booth,
      locationNotes: s.locationNotes,
      category: s.category,
      type: TYPE_LABELS[s.supplierType],
      status: STATUS_LABELS[s.status],
      rating: s.rating ?? '',
      followUpDate: s.followUpDate ?? '',
      followUpNote: s.followUpNote,
      notes: s.notes,
      products: productLines.join('\n'),
      photoCount: myPhotos.length,
      createdAt: new Date(s.createdAt).toLocaleString(),
      updatedAt: new Date(s.updatedAt).toLocaleString(),
    } as never;
    row.height = myPhotos.length ? ROW_HEIGHT_PT : Math.max(30, Math.min(ROW_HEIGHT_PT, 15 * productLines.length));
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(1).font = { bold: true, color: { argb: 'FF0F4C5C' } };
    for (const [j, ph] of myPhotos.slice(0, maxPhotos).entries()) {
      const label = `${PHOTO_KIND_LABELS[ph.kind]}${ph.productId && pById.get(ph.productId) ? ` · ${pById.get(ph.productId)!.name}` : ''}`;
      await embed(ws, ph, r, firstPhotoCol + j, label);
      onProgress?.(++done, total);
    }
    if (myPhotos.length > maxPhotos) {
      ws.getCell(r, firstPhotoCol + maxPhotos - 1).note = `${myPhotos.length - maxPhotos} more photo(s) are in the backup .zip`;
    }
  }

  // ---------------- Products & prices ----------------
  const wq = wb.addWorksheet('Products & prices', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: landscape });
  wq.columns = [
    { header: 'Supplier ID', key: 'code', width: 11 },
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Location', key: 'loc', width: 26 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Product category', key: 'pcat', width: 16 },
    { header: 'Price', key: 'price', width: 10 },
    { header: 'Currency', key: 'currency', width: 9 },
    { header: 'Unit', key: 'unit', width: 9 },
    { header: 'MOQ', key: 'moq', width: 9 },
    { header: 'Price valid for qty', key: 'tier', width: 11 },
    { header: 'Quote date', key: 'date', width: 12 },
    { header: 'Latest?', key: 'latest', width: 8 },
    { header: 'Quote notes', key: 'notes', width: 30 },
    { header: 'Product photo', key: 'photo', width: PHOTO_COL_WIDTH },
  ];
  wq.getRow(1).font = header;
  wq.getRow(1).fill = headerFill;
  wq.getRow(1).height = 30;
  wq.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  const latestIds = new Set(latest.map((q) => q.id));
  const sortedQuotes = quotes
    .filter((q) => sById.has(q.supplierId))
    .sort((a, b) => num(sById.get(a.supplierId)!.code) - num(sById.get(b.supplierId)!.code) || (pById.get(a.productId)?.name ?? '').localeCompare(pById.get(b.productId)?.name ?? '') || b.quoteDate.localeCompare(a.quoteDate));
  for (const [i, q] of sortedQuotes.entries()) {
    const r = i + 2;
    const s = sById.get(q.supplierId)!;
    const p = pById.get(q.productId);
    const row = wq.getRow(r);
    row.values = {
      code: s.code,
      company: s.companyName,
      loc: [s.district, s.floor && `Floor ${s.floor}`, s.street && `Street ${s.street}`, s.booth && `Booth ${s.booth}`].filter(Boolean).join(' · '),
      product: p?.name ?? '',
      pcat: p?.category ?? '',
      price: q.price,
      currency: q.currency,
      unit: q.unit,
      moq: q.moq ?? '',
      tier: q.tierQty ?? '',
      date: q.quoteDate,
      latest: latestIds.has(q.id) ? 'yes' : '',
      notes: q.notes,
    } as never;
    row.alignment = { vertical: 'top', wrapText: true };
    const prodPhoto = sortPhotos(photos.filter((ph) => ph.productId === q.productId))[0];
    if (prodPhoto) {
      row.height = ROW_HEIGHT_PT;
      await embed(wq, prodPhoto, r, 14, 'Product');
    }
  }
  wq.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };

  // ---------------- About ----------------
  const wa = wb.addWorksheet('About');
  wa.columns = [{ width: 110 }];
  [
    'Yiwu Supplier Manager — Excel copy',
    `Exported: ${new Date().toLocaleString()}`,
    `${counts.suppliers} suppliers · ${counts.quotes} quotes · ${counts.images} embedded photo previews`,
    '',
    'Suppliers: one row per supplier, one column per field. Photos are in the "Photo" columns of the same row (label above each photo).',
    'Products & prices: one row per quote. "Latest?" marks the most recent quote date of each product.',
    'Photos here are small previews. Full-size photos are in the backup .zip (photos/<Supplier ID>/…) and in the cloud.',
    'Ratings, supplier type and notes are your own observations.',
    'This file is a readable copy. To restore data into the app, use the backup .zip (Settings → Restore).',
  ].forEach((line, i) => {
    const c = wa.getCell(i + 1, 1);
    c.value = line;
    if (i === 0) c.font = { bold: true, size: 14 };
  });

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return { blob: new Blob([buf], { type: XLSX_MIME }), filename: `yiwu-suppliers-${stamp}.xlsx`, counts };
}
