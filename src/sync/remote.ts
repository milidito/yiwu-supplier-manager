import type { Photo, Product, Quotation, Supplier, SyncTable } from '../db';

/**
 * Abstraction over the cloud backend. The sync engine only talks to this interface,
 * so the backend (Supabase today) can be swapped without touching the engine.
 */
export interface RemoteRow {
  id: string;
  /** server-assigned modification time, used as the pull cursor */
  server_updated_at: string;
  [k: string]: unknown;
}

export interface Remote {
  /** id of the signed-in user, or null if not signed in */
  getUserId(): Promise<string | null>;
  /** rows changed on the server strictly after `sinceIso` (or all if null), ascending by server_updated_at */
  pull(table: SyncTable, sinceIso: string | null): Promise<RemoteRow[]>;
  /** idempotent upsert by primary key `id` */
  push(table: SyncTable, rows: Record<string, unknown>[]): Promise<void>;
  /** idempotent upload (overwrite allowed) */
  uploadPhoto(path: string, blob: Blob, contentType: string): Promise<void>;
  downloadPhoto(path: string): Promise<Blob>;
  deletePhoto(path: string): Promise<void>;
}

export function photoPath(userId: string, photoId: string) {
  return `${userId}/${photoId}.jpg`;
}

// ---------- field mapping (local camelCase <-> remote snake_case) ----------
type Map = Record<string, string>;

const common: Map = {
  id: 'id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deleted: 'deleted',
};

export const FIELD_MAPS: Record<SyncTable, Map> = {
  suppliers: {
    ...common,
    code: 'code',
    companyName: 'company_name',
    contactPerson: 'contact_person',
    wechatId: 'wechat_id',
    phone: 'phone',
    email: 'email',
    district: 'district',
    floor: 'floor',
    street: 'street',
    booth: 'booth',
    locationNotes: 'location_notes',
    category: 'category',
    supplierType: 'supplier_type',
    status: 'status',
    rating: 'rating',
    followUpDate: 'follow_up_date',
    followUpNote: 'follow_up_note',
    notes: 'notes',
  },
  products: {
    ...common,
    supplierId: 'supplier_id',
    name: 'name',
    category: 'category',
    notes: 'notes',
  },
  quotations: {
    ...common,
    productId: 'product_id',
    supplierId: 'supplier_id',
    price: 'price',
    currency: 'currency',
    unit: 'unit',
    moq: 'moq',
    tierQty: 'tier_qty',
    quoteDate: 'quote_date',
    notes: 'notes',
  },
  photos: {
    ...common,
    supplierId: 'supplier_id',
    productId: 'product_id',
    kind: 'kind',
    caption: 'caption',
    width: 'width',
    height: 'height',
    bytes: 'bytes',
    mime: 'mime',
  },
};

type AnyLocal = Supplier | Product | Quotation | Photo;

export function toRemote(table: SyncTable, rec: AnyLocal, userId: string): Record<string, unknown> {
  const m = FIELD_MAPS[table];
  const out: Record<string, unknown> = { user_id: userId };
  for (const [local, remote] of Object.entries(m)) {
    let v = (rec as unknown as Record<string, unknown>)[local];
    if (local === 'deleted') v = !!v;
    if (v === undefined) v = null;
    if (v === '' && (local === 'followUpDate' || local === 'quoteDate')) v = null;
    out[remote] = v;
  }
  return out;
}

export function fromRemote(table: SyncTable, row: RemoteRow): Record<string, unknown> {
  const m = FIELD_MAPS[table];
  const out: Record<string, unknown> = {};
  for (const [local, remote] of Object.entries(m)) {
    let v = row[remote];
    if (local === 'deleted') v = v ? 1 : 0;
    if (local === 'price' || local === 'moq' || local === 'tierQty' || local === 'rating') {
      v = v === null || v === undefined ? null : Number(v);
    }
    if (typeof v === 'string' && (local === 'createdAt' || local === 'updatedAt')) v = normalizeIso(v);
    if (v === null && typeof (m as Map)[local] === 'string' && !['rating', 'followUpDate', 'moq', 'tierQty', 'productId'].includes(local)) {
      // keep text fields as '' instead of null for simpler UI code
      if (!['price', 'width', 'height', 'bytes'].includes(local)) v = '';
    }
    out[local] = v;
  }
  return out;
}

/** Postgres returns "2026-11-12T14:00:00.123+00:00"; make it the same shape as Date.toISOString(). */
export function normalizeIso(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}
