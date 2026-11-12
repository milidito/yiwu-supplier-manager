import {
  db as defaultDb,
  type AppDB,
  type Photo,
  type PhotoKind,
  type Product,
  type Quotation,
  type Supplier,
  getMeta,
  nowIso,
  setMeta,
  todayYmd,
  uuid,
} from './db';
import { processImage, type ProcessedImage } from './images';

/** All writes go through this module so every change is timestamped and queued for sync. */

export interface AppSettings {
  codePrefix: string; // e.g. "YW-"
  defaultCurrency: string;
  defaultUnit: string;
  /** Your own manual exchange rates: how many CNY one unit of the currency buys. Used only for "≈ CNY" hints. */
  ratesToCny: Record<string, number | null>;
  /** after taking photos, show a one-tap "Save to Photos" button */
  offerSaveToPhotos: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  codePrefix: 'YW-',
  defaultCurrency: 'CNY',
  defaultUnit: 'piece',
  ratesToCny: { USD: null, CAD: null, EUR: null },
  offerSaveToPhotos: true,
};

export async function getSettings(d: AppDB = defaultDb): Promise<AppSettings> {
  const s = await getMeta<Partial<AppSettings>>(d, 'settings', {});
  return { ...DEFAULT_SETTINGS, ...s, ratesToCny: { ...DEFAULT_SETTINGS.ratesToCny, ...(s.ratesToCny || {}) } };
}

export async function saveSettings(patch: Partial<AppSettings>, d: AppDB = defaultDb) {
  const cur = await getSettings(d);
  await setMeta(d, 'settings', { ...cur, ...patch });
}

// ---------- notifications to the sync runner ----------
type Listener = () => void;
const changeListeners = new Set<Listener>();
export function onLocalChange(fn: Listener) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
function emitChange() {
  changeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

// ---------- supplier codes ----------
export function parseCodeNumber(code: string, prefix: string): number | null {
  if (!code.startsWith(prefix)) return null;
  const n = Number.parseInt(code.slice(prefix.length), 10);
  return Number.isFinite(n) ? n : null;
}

export function formatCode(prefix: string, n: number) {
  return `${prefix}${String(n).padStart(3, '0')}`;
}

/** Next free sequential code, e.g. YW-001. Considers deleted suppliers too so codes are never reused. */
export async function nextSupplierCode(d: AppDB = defaultDb, prefix?: string): Promise<string> {
  const p = prefix ?? (await getSettings(d)).codePrefix;
  let max = 0;
  await d.suppliers.each((s) => {
    const n = parseCodeNumber(s.code, p);
    if (n !== null && n > max) max = n;
  });
  const floor = await getMeta<number>(d, `codeFloor:${p}`, 0);
  return formatCode(p, Math.max(max, floor) + 1);
}

// ---------- suppliers ----------
export function blankSupplier(): Omit<Supplier, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'deleted' | 'dirty'> {
  return {
    companyName: '',
    contactPerson: '',
    wechatId: '',
    phone: '',
    email: '',
    district: '',
    floor: '',
    street: '',
    booth: '',
    locationNotes: '',
    category: '',
    supplierType: 'unknown',
    status: 'new',
    rating: null,
    followUpDate: null,
    followUpNote: '',
    notes: '',
  };
}

export async function createSupplier(fields: Partial<Supplier> = {}, d: AppDB = defaultDb): Promise<Supplier> {
  const t = nowIso();
  const s = await d.transaction('rw', d.suppliers, d.meta, async () => {
    const code = await nextSupplierCode(d);
    const rec: Supplier = {
      ...blankSupplier(),
      ...fields,
      id: uuid(),
      code,
      createdAt: t,
      updatedAt: t,
      deleted: 0,
      dirty: 1,
      baseUpdatedAt: null,
      syncedAt: null,
    };
    await d.suppliers.add(rec);
    if (rec.district || rec.floor || rec.street) {
      await setMeta(d, 'lastLocation', { district: rec.district, floor: rec.floor, street: rec.street });
    }
    return rec;
  });
  emitChange();
  return s;
}

const LOCAL_ONLY = ['dirty', 'baseUpdatedAt', 'syncedAt', 'id', 'code', 'createdAt'] as const;

function cleanPatch<T extends object>(patch: Partial<T>): Partial<T> {
  const p = { ...patch } as Record<string, unknown>;
  for (const k of LOCAL_ONLY) delete p[k];
  return p as Partial<T>;
}

export async function updateSupplier(id: string, patch: Partial<Supplier>, d: AppDB = defaultDb) {
  const p = cleanPatch(patch);
  await d.transaction('rw', d.suppliers, d.meta, async () => {
    await d.suppliers.update(id, { ...p, updatedAt: nowIso(), dirty: 1 });
    if ('district' in p || 'floor' in p || 'street' in p) {
      const s = await d.suppliers.get(id);
      if (s) await setMeta(d, 'lastLocation', { district: s.district, floor: s.floor, street: s.street });
    }
  });
  emitChange();
}

/** Allows changing the human code (e.g. to match a label you wrote on a card). Must stay unique. */
export async function changeSupplierCode(id: string, code: string, d: AppDB = defaultDb) {
  const c = code.trim();
  if (!c) throw new Error('Code cannot be empty');
  const clash = await d.suppliers.where('code').equals(c).filter((s) => s.id !== id && !s.deleted).count();
  if (clash) throw new Error(`Code ${c} is already used`);
  await d.suppliers.update(id, { code: c, updatedAt: nowIso(), dirty: 1 });
  emitChange();
}

export async function deleteSupplier(id: string, d: AppDB = defaultDb) {
  const t = nowIso();
  await d.transaction('rw', [d.suppliers, d.products, d.quotations, d.photos, d.photoBlobs], async () => {
    await d.suppliers.update(id, { deleted: 1, dirty: 1, updatedAt: t });
    // only children that are still active; ones deleted earlier keep their own deletion time
    await d.products.where('supplierId').equals(id).filter((x) => !x.deleted).modify({ deleted: 1, dirty: 1, updatedAt: t });
    await d.quotations.where('supplierId').equals(id).filter((x) => !x.deleted).modify({ deleted: 1, dirty: 1, updatedAt: t });
    const photos = await d.photos.where('supplierId').equals(id).toArray();
    for (const ph of photos) await markPhotoDeleted(ph, t, d);
  });
  emitChange();
}

// ---------- products ----------
export async function createProduct(fields: Partial<Product> & { supplierId: string }, d: AppDB = defaultDb) {
  const t = nowIso();
  const rec: Product = {
    name: '',
    category: '',
    notes: '',
    ...cleanPatch(fields),
    supplierId: fields.supplierId,
    id: uuid(),
    createdAt: t,
    updatedAt: t,
    deleted: 0,
    dirty: 1,
    baseUpdatedAt: null,
    syncedAt: null,
  };
  await d.products.add(rec);
  emitChange();
  return rec;
}

export async function updateProduct(id: string, patch: Partial<Product>, d: AppDB = defaultDb) {
  await d.products.update(id, { ...cleanPatch(patch), updatedAt: nowIso(), dirty: 1 });
  emitChange();
}

export async function deleteProduct(id: string, d: AppDB = defaultDb) {
  const t = nowIso();
  await d.transaction('rw', [d.products, d.quotations, d.photos, d.photoBlobs], async () => {
    await d.products.update(id, { deleted: 1, dirty: 1, updatedAt: t });
    await d.quotations.where('productId').equals(id).filter((x) => !x.deleted).modify({ deleted: 1, dirty: 1, updatedAt: t });
    const photos = await d.photos.where('productId').equals(id).toArray();
    for (const ph of photos) await markPhotoDeleted(ph, t, d);
  });
  emitChange();
}

// ---------- quotations ----------
export async function createQuotation(
  fields: Partial<Quotation> & { productId: string; supplierId: string; price: number },
  d: AppDB = defaultDb,
) {
  const t = nowIso();
  const settings = await getSettings(d);
  const rec: Quotation = {
    currency: settings.defaultCurrency,
    unit: settings.defaultUnit,
    moq: null,
    tierQty: null,
    quoteDate: todayYmd(),
    notes: '',
    ...cleanPatch(fields),
    productId: fields.productId,
    supplierId: fields.supplierId,
    price: fields.price,
    id: uuid(),
    createdAt: t,
    updatedAt: t,
    deleted: 0,
    dirty: 1,
    baseUpdatedAt: null,
    syncedAt: null,
  };
  await d.quotations.add(rec);
  emitChange();
  return rec;
}

export async function updateQuotation(id: string, patch: Partial<Quotation>, d: AppDB = defaultDb) {
  await d.quotations.update(id, { ...cleanPatch(patch), updatedAt: nowIso(), dirty: 1 });
  emitChange();
}

export async function deleteQuotation(id: string, d: AppDB = defaultDb) {
  // soft delete (restorable from Trash)
  await d.quotations.update(id, { deleted: 1, dirty: 1, updatedAt: nowIso() });
  emitChange();
}

// ---------- photos ----------
export async function addPhoto(
  args: { supplierId: string; kind: PhotoKind; file: Blob; productId?: string | null; caption?: string },
  d: AppDB = defaultDb,
  processed?: ProcessedImage,
): Promise<Photo> {
  const img = processed ?? (await processImage(args.file));
  const t = nowIso();
  const rec: Photo = {
    id: uuid(),
    supplierId: args.supplierId,
    productId: args.productId ?? null,
    kind: args.kind,
    caption: args.caption ?? '',
    width: img.width,
    height: img.height,
    bytes: img.full.size,
    mime: img.mime,
    blobState: 'local',
    createdAt: t,
    updatedAt: t,
    deleted: 0,
    dirty: 1,
    baseUpdatedAt: null,
    syncedAt: null,
  };
  await d.transaction('rw', d.photos, d.photoBlobs, async () => {
    await d.photoBlobs.put({ id: rec.id, full: img.full, thumb: img.thumb });
    await d.photos.add(rec);
  });
  emitChange();
  return rec;
}

export async function updatePhoto(id: string, patch: Partial<Pick<Photo, 'kind' | 'caption' | 'productId'>>, d: AppDB = defaultDb) {
  await d.photos.update(id, { ...patch, updatedAt: nowIso(), dirty: 1 });
  emitChange();
}

/** Soft delete: the image file is kept on the phone and in the cloud so it can be restored from Trash. */
async function markPhotoDeleted(ph: Photo, t: string, d: AppDB) {
  if (ph.deleted) return;
  await d.photos.update(ph.id, { deleted: 1, dirty: 1, updatedAt: t });
}

async function undeletePhoto(ph: Photo, t: string, d: AppDB) {
  const hasBlob = !!(await d.photoBlobs.get(ph.id));
  const blobState = hasBlob ? (ph.blobState === 'uploaded' ? 'uploaded' : 'local') : 'remote_only';
  await d.photos.update(ph.id, { deleted: 0, dirty: 1, updatedAt: t, blobState });
}

// ---------- trash / restore ----------
/** Restores a deleted supplier and everything that was deleted together with it. */
export async function restoreSupplier(id: string, d: AppDB = defaultDb) {
  const t = nowIso();
  await d.transaction('rw', [d.suppliers, d.products, d.quotations, d.photos, d.photoBlobs, d.meta], async () => {
    const s = await d.suppliers.get(id);
    if (!s || !s.deleted) return;
    const when = s.updatedAt;
    // if its code was reused meanwhile, give it a new one
    const clash = await d.suppliers.where('code').equals(s.code).filter((x) => x.id !== id && !x.deleted).count();
    const code = clash ? await nextSupplierCode(d) : s.code;
    await d.suppliers.update(id, { deleted: 0, dirty: 1, updatedAt: t, code });
    await d.products.where('supplierId').equals(id).filter((p) => !!p.deleted && p.updatedAt === when).modify({ deleted: 0, dirty: 1, updatedAt: t });
    await d.quotations.where('supplierId').equals(id).filter((q) => !!q.deleted && q.updatedAt === when).modify({ deleted: 0, dirty: 1, updatedAt: t });
    const photos = await d.photos.where('supplierId').equals(id).filter((p) => !!p.deleted && p.updatedAt === when).toArray();
    for (const ph of photos) await undeletePhoto(ph, t, d);
  });
  emitChange();
}

export async function restoreProduct(id: string, d: AppDB = defaultDb) {
  const t = nowIso();
  await d.transaction('rw', [d.products, d.quotations, d.photos, d.photoBlobs], async () => {
    const p = await d.products.get(id);
    if (!p || !p.deleted) return;
    const when = p.updatedAt;
    await d.products.update(id, { deleted: 0, dirty: 1, updatedAt: t });
    await d.quotations.where('productId').equals(id).filter((q) => !!q.deleted && q.updatedAt === when).modify({ deleted: 0, dirty: 1, updatedAt: t });
    const photos = await d.photos.where('productId').equals(id).filter((x) => !!x.deleted && x.updatedAt === when).toArray();
    for (const ph of photos) await undeletePhoto(ph, t, d);
  });
  emitChange();
}

export async function restorePhoto(id: string, d: AppDB = defaultDb) {
  await d.transaction('rw', d.photos, d.photoBlobs, async () => {
    const ph = await d.photos.get(id);
    if (ph?.deleted) await undeletePhoto(ph, nowIso(), d);
  });
  emitChange();
}

export async function restoreQuotation(id: string, d: AppDB = defaultDb) {
  await d.quotations.update(id, { deleted: 0, dirty: 1, updatedAt: nowIso() });
  emitChange();
}

export async function deletePhoto(id: string, d: AppDB = defaultDb) {
  await d.transaction('rw', d.photos, d.photoBlobs, async () => {
    const ph = await d.photos.get(id);
    if (ph) await markPhotoDeleted(ph, nowIso(), d);
  });
  emitChange();
}

// ---------- queries ----------
export async function pendingCount(d: AppDB = defaultDb): Promise<number> {
  const [a, b, c, e, f] = await Promise.all([
    d.suppliers.where('dirty').equals(1).count(),
    d.products.where('dirty').equals(1).count(),
    d.quotations.where('dirty').equals(1).count(),
    d.photos.where('dirty').equals(1).count(),
    d.photos.where('blobState').equals('local').filter((p) => !p.deleted).count(),
  ]);
  return a + b + c + e + f;
}

export async function lastLocation(d: AppDB = defaultDb) {
  return getMeta<{ district: string; floor: string; street: string } | null>(d, 'lastLocation', null);
}
