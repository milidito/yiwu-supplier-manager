import type { Product, Quotation, Supplier } from './db';

// ---------------- search ----------------
export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function supplierHaystack(s: Supplier, productText = ''): string {
  const digits = (s.phone || '').replace(/\D/g, '');
  return norm(
    [
      s.code,
      s.code.replace(/[^a-z0-9]/gi, ''),
      s.companyName,
      s.contactPerson,
      s.wechatId,
      s.phone,
      digits,
      s.email,
      s.district,
      s.floor,
      s.street,
      s.booth,
      s.locationNotes,
      s.category,
      s.notes,
      s.followUpNote,
      productText,
    ].join(' | '),
  );
}

/** Every word of the query must appear somewhere (in any field). */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  return q.split(' ').every((tok) => {
    // short numbers ("2" in "district 2", floor "3") must match a whole number, not part of "12" or "23315"
    if (/^\d{1,3}$/.test(tok)) return new RegExp(`(^|\\D)${tok}(\\D|$)`).test(haystack);
    if (haystack.includes(tok)) return true;
    const d = tok.replace(/\D/g, '');
    return d.length >= 4 && haystack.includes(d);
  });
}

export function productTextBySupplier(products: Product[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of products) {
    if (p.deleted) continue;
    m.set(p.supplierId, `${m.get(p.supplierId) ?? ''} ${p.name} ${p.category} ${p.notes}`);
  }
  return m;
}

export function isIncomplete(s: Supplier): boolean {
  return !s.companyName.trim() || (!s.wechatId.trim() && !s.phone.trim()) || !s.booth.trim();
}

export function locationLine(s: Pick<Supplier, 'district' | 'floor' | 'street' | 'booth'>): string {
  const parts: string[] = [];
  if (s.district) parts.push(s.district);
  if (s.floor) parts.push(/^\d+$/.test(s.floor) ? `Floor ${s.floor}` : s.floor);
  if (s.street) parts.push(/^\d+$/.test(s.street) ? `Street ${s.street}` : s.street);
  if (s.booth) parts.push(`Booth ${s.booth}`);
  return parts.join(' · ');
}

// ---------------- comparison ----------------
export interface CompareRow {
  quote: Quotation;
  product: Product;
  supplier: Supplier;
}

export interface CompareGroup {
  key: string;
  currency: string;
  unit: string;
  rows: CompareRow[];
  min: number;
  max: number;
}

/** For each product, keep only the quotes from its most recent quote date (all tiers of that date). */
export function latestQuotes(quotes: Quotation[]): Quotation[] {
  const latest = new Map<string, string>();
  for (const q of quotes) {
    const cur = latest.get(q.productId);
    if (!cur || q.quoteDate > cur) latest.set(q.productId, q.quoteDate);
  }
  return quotes.filter((q) => q.quoteDate === latest.get(q.productId));
}

/**
 * Groups quotations by (currency, unit) — prices are only ranked against prices
 * in the same currency AND the same unit, so "per piece" is never compared with "per carton".
 */
export function groupForComparison(rows: CompareRow[]): CompareGroup[] {
  const groups = new Map<string, CompareGroup>();
  for (const r of rows) {
    const key = `${r.quote.currency}|${r.quote.unit}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, currency: r.quote.currency, unit: r.quote.unit, rows: [], min: Infinity, max: -Infinity };
      groups.set(key, g);
    }
    g.rows.push(r);
    g.min = Math.min(g.min, r.quote.price);
    g.max = Math.max(g.max, r.quote.price);
  }
  const out = [...groups.values()];
  for (const g of out) g.rows.sort((a, b) => a.quote.price - b.quote.price || (a.quote.moq ?? 0) - (b.quote.moq ?? 0));
  out.sort((a, b) => b.rows.length - a.rows.length);
  return out;
}

/** "≈ CNY" using the user's own manual rate. Returns null when no rate is set. */
export function toCny(price: number, currency: string, ratesToCny: Record<string, number | null>): number | null {
  if (currency === 'CNY') return price;
  const r = ratesToCny[currency];
  return r && r > 0 ? price * r : null;
}

export function fmtMoney(n: number, currency: string): string {
  const digits = n < 1 ? 3 : 2;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })} ${currency}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // Date-only values (YYYY-MM-DD) are calendar dates: build them in local time,
  // otherwise they are read as UTC midnight and show as the previous day in the Americas.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
