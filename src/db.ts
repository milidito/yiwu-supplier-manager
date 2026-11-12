import Dexie, { type Table } from 'dexie';

/**
 * Local on-device database (IndexedDB via Dexie).
 *
 * Every synced record carries:
 *  - id            UUID generated on the device (globally unique -> idempotent upserts, no duplicates on retry)
 *  - updatedAt     ISO time of the last local edit (used for last-write-wins conflict resolution)
 *  - deleted       0/1 soft-delete flag so deletions also synchronise
 *  - dirty         0/1 local-only flag: 1 = has changes not yet pushed to the cloud
 *  - baseUpdatedAt local-only: the updatedAt value the cloud had at our last successful sync
 *
 * IndexedDB cannot index booleans, so flags are stored as 0/1 numbers.
 */

export type SupplierStatus =
  | 'new'
  | 'contacted'
  | 'quoted'
  | 'sample_requested'
  | 'negotiating'
  | 'ordered'
  | 'inactive';

export type SupplierType = 'unknown' | 'factory' | 'trading';

export type PhotoKind = 'card_front' | 'card_back' | 'shop' | 'booth' | 'product' | 'document';

export interface SyncFields {
  id: string;
  createdAt: string;
  updatedAt: string;
  deleted: 0 | 1;
  dirty: 0 | 1;
  baseUpdatedAt?: string | null;
  syncedAt?: string | null;
}

export interface Supplier extends SyncFields {
  code: string; // human ID, e.g. YW-001
  companyName: string;
  contactPerson: string;
  wechatId: string;
  phone: string;
  email: string;
  district: string;
  floor: string;
  street: string; // street / aisle / area
  booth: string;
  locationNotes: string;
  category: string;
  supplierType: SupplierType;
  status: SupplierStatus;
  rating: number | null; // user's own 1-5 impression
  followUpDate: string | null; // YYYY-MM-DD
  followUpNote: string;
  notes: string;
}

export interface Product extends SyncFields {
  supplierId: string;
  name: string;
  category: string;
  notes: string;
}

export interface Quotation extends SyncFields {
  productId: string;
  supplierId: string;
  price: number;
  currency: string; // ISO code, e.g. CNY
  unit: string; // piece, set, carton...
  moq: number | null;
  tierQty: number | null; // quantity the price applies to
  quoteDate: string; // YYYY-MM-DD
  notes: string;
}

export type BlobState = 'local' | 'uploaded' | 'remote_only' | 'purged';

export interface Photo extends SyncFields {
  supplierId: string;
  productId: string | null;
  kind: PhotoKind;
  caption: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  /** local-only: where the image binary lives */
  blobState: BlobState;
  uploadError?: string | null;
  /** local-only: a labelled copy was handed to the iPhone share sheet (Save to Photos) */
  savedToDevice?: 0 | 1;
}

export interface PhotoBlob {
  id: string; // same as Photo.id
  full: Blob;
  thumb: Blob;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface SyncLogRow {
  id?: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ConflictRow {
  id?: number;
  at: string;
  table: SyncTable;
  recordId: string;
  label: string;
  kept: 'local' | 'remote';
  discarded: unknown; // the losing version, kept for manual review
  reviewed: 0 | 1;
}

export type SyncTable = 'suppliers' | 'products' | 'quotations' | 'photos';
export const SYNC_TABLES: SyncTable[] = ['suppliers', 'products', 'quotations', 'photos'];

export class AppDB extends Dexie {
  suppliers!: Table<Supplier, string>;
  products!: Table<Product, string>;
  quotations!: Table<Quotation, string>;
  photos!: Table<Photo, string>;
  photoBlobs!: Table<PhotoBlob, string>;
  meta!: Table<MetaRow, string>;
  syncLog!: Table<SyncLogRow, number>;
  conflicts!: Table<ConflictRow, number>;

  constructor(name = 'yiwu-supplier-manager') {
    super(name);
    this.version(1).stores({
      suppliers: 'id, code, updatedAt, createdAt, dirty, status, district, category, followUpDate',
      products: 'id, supplierId, dirty, name, category, updatedAt',
      quotations: 'id, productId, supplierId, dirty, quoteDate, updatedAt',
      photos: 'id, supplierId, productId, dirty, blobState, createdAt',
      photoBlobs: 'id',
      meta: 'key',
      syncLog: '++id, at',
      conflicts: '++id, recordId, reviewed',
    });
  }
}

export const db = new AppDB();

export async function getMeta<T>(d: AppDB, key: string, fallback: T): Promise<T> {
  const row = await d.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(d: AppDB, key: string, value: unknown): Promise<void> {
  await d.meta.put({ key, value });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC4122 v4 fallback
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const STATUS_LABELS: Record<SupplierStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  sample_requested: 'Sample requested',
  negotiating: 'Negotiating',
  ordered: 'Ordered',
  inactive: 'Inactive',
};

export const TYPE_LABELS: Record<SupplierType, string> = {
  unknown: 'Unknown',
  factory: 'Factory',
  trading: 'Trading company',
};

export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = {
  card_front: 'Card front',
  card_back: 'Card back',
  shop: 'Shop / sign',
  booth: 'Booth no.',
  product: 'Product',
  document: 'Catalogue / doc',
};

export const PHOTO_KIND_ORDER: PhotoKind[] = ['card_front', 'card_back', 'shop', 'booth', 'product', 'document'];

export const CURRENCIES = ['CNY', 'USD', 'CAD', 'EUR'];
export const UNITS = ['piece', 'pair', 'set', 'dozen', 'pack', 'box', 'carton', 'kg', 'meter'];
export const DISTRICT_SUGGESTIONS = [
  'District 1',
  'District 2',
  'District 3',
  'District 4',
  'District 5',
  'Huangyuan Market',
];
