import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { CURRENCIES, db, type Quotation, todayYmd, UNITS } from '../db';
import { fmtDate, fmtMoney, latestQuotes, locationLine, matchesQuery, norm, toCny } from '../logic';
import { createProduct, createQuotation, deleteProduct, deleteQuotation, updateProduct, updateQuotation } from '../repo';
import { back, navigate } from '../router';
import { DataList, Empty, Field, Header, Section, Select, TextArea, toast } from '../ui/components';
import { useProducts, useQuotations, useSettings, useSuppliers } from '../ui/hooks';
import { PhotoStrip, savePhotos, usePhotos } from '../ui/photos';
import { CaptureButton } from '../ui/components';
import { useSupplier } from './SupplierEditor';

function num(v: string): number | null {
  const t = v.replace(/,/g, '.').replace(/[^\d.]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface QuoteForm {
  price: string;
  currency: string;
  unit: string;
  moq: string;
  tierQty: string;
  quoteDate: string;
  notes: string;
}

function QuoteFields({ f, set }: { f: QuoteForm; set: (p: Partial<QuoteForm>) => void }) {
  return (
    <>
      <div className="row">
        <Field className="grow" label="Price *" name="price" inputMode="decimal" value={f.price} onChange={(v) => set({ price: v })} placeholder="0.00" />
        <Select label="Currency" name="currency" value={f.currency} onChange={(v) => set({ currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </div>
      <div className="row">
        <Select className="grow" label="Per unit" name="unit" value={f.unit} onChange={(v) => set({ unit: v })} options={[...new Set([...UNITS, f.unit])].map((u) => ({ value: u, label: u }))} />
        <Field className="grow" label="MOQ" name="moq" inputMode="numeric" value={f.moq} onChange={(v) => set({ moq: v })} placeholder="min. order" />
      </div>
      <div className="row">
        <Field className="grow" label="Price valid for qty" name="tierQty" inputMode="numeric" value={f.tierQty} onChange={(v) => set({ tierQty: v })} placeholder="e.g. 1000" hint="Quantity tier this price applies to" />
        <Field className="grow" label="Quote date" name="quoteDate" type="date" value={f.quoteDate} onChange={(v) => set({ quoteDate: v })} />
      </div>
      <TextArea label="Quote notes" name="quoteNotes" rows={2} value={f.notes} onChange={(v) => set({ notes: v })} placeholder="Packaging, material, logo, lead time, carton size…" />
    </>
  );
}

function blankQuote(currency: string, unit: string): QuoteForm {
  return { price: '', currency, unit, moq: '', tierQty: '', quoteDate: todayYmd(), notes: '' };
}

/** New product with its first price (one screen), or edit an existing product. */
export function ProductEditor({ id, supplierId }: { id?: string; supplierId?: string }) {
  const settings = useSettings();
  const existing = useLiveQuery(() => (id ? db.products.get(id) : undefined), [id]);
  const sid = existing?.supplierId ?? supplierId;
  const supplier = useSupplier(sid);
  const allProducts = useProducts() ?? [];
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [q, setQ] = useState<QuoteForm>(blankQuote(settings.defaultCurrency, settings.defaultUnit));
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (existing && !loaded) {
      setName(existing.name);
      setCategory(existing.category);
      setNotes(existing.notes);
      setLoaded(true);
    }
  }, [existing, loaded]);
  useEffect(() => {
    if (!id) setQ((cur) => (cur.price ? cur : blankQuote(settings.defaultCurrency, settings.defaultUnit)));
  }, [settings.defaultCurrency, settings.defaultUnit, id]);

  useEffect(() => {
    if (!category && supplier?.category && !id) setCategory(supplier.category);
  }, [supplier?.category]);

  if (!sid) return <Header title="No supplier selected" backTo="/" />;

  const save = async (another: boolean) => {
    if (!name.trim()) {
      alert('Please enter a product name');
      return;
    }
    if (id) {
      await updateProduct(id, { name: name.trim(), category: category.trim(), notes });
      navigate(`/p/${id}`, true);
      return;
    }
    const price = num(q.price);
    const p = await createProduct({ supplierId: sid, name: name.trim(), category: category.trim(), notes });
    if (price !== null) {
      await createQuotation({
        productId: p.id,
        supplierId: sid,
        price,
        currency: q.currency,
        unit: q.unit,
        moq: num(q.moq),
        tierQty: num(q.tierQty),
        quoteDate: q.quoteDate || todayYmd(),
        notes: q.notes,
      });
    }
    if (pendingPhotos.length) await savePhotos(pendingPhotos, sid, 'product', p.id);
    toast(`Saved "${p.name}"${price !== null ? ` · ${fmtMoney(price, q.currency)}/${q.unit}` : ''}`);
    if (another) {
      setName('');
      setNotes('');
      setPendingPhotos([]);
      setQ(blankQuote(q.currency, q.unit));
    } else navigate(`/s/${sid}`, true);
  };

  return (
    <div className="screen">
      <Header title={id ? 'Edit product' : 'New product & price'} sub={supplier ? `${supplier.code} ${supplier.companyName}` : ''} backTo={`/s/${sid}`} />
      <Section title="Product">
        <Field label="Product name *" name="productName" value={name} onChange={setName} placeholder="e.g. Silicone phone case iPhone 16" autoFocus={!id} />
        <Field label="Category" name="productCategory" list="dl-pcat" value={category} onChange={setCategory} />
        <DataList id="dl-pcat" values={allProducts.map((p) => p.category)} />
        <TextArea label="Product notes" name="productNotes" rows={2} value={notes} onChange={setNotes} placeholder="Material, colours, sizes…" />
        {!id && (
          <div className="row">
            <CaptureButton className="btn btn-outline grow" testId="product-photo" label={`📦 Product photo${pendingPhotos.length ? ` (${pendingPhotos.length})` : ''}`} onFiles={(f) => setPendingPhotos([...pendingPhotos, ...f])} />
            <CaptureButton gallery className="btn btn-outline" label="🖼️" onFiles={(f) => setPendingPhotos([...pendingPhotos, ...f])} />
          </div>
        )}
      </Section>
      {!id && (
        <Section title="Price quote">
          <QuoteFields f={q} set={(p) => setQ({ ...q, ...p })} />
        </Section>
      )}
      <div className="actionbar">
        {!id && (
          <button className="btn btn-outline" onClick={() => save(true)} data-testid="product-save-another">
            Save & add another
          </button>
        )}
        <button className="btn btn-primary" onClick={() => save(false)} data-testid="product-save">
          Save
        </button>
      </div>
    </div>
  );
}

export function QuoteEditor({ id, productId }: { id?: string; productId?: string }) {
  const settings = useSettings();
  const existing = useLiveQuery(() => (id ? db.quotations.get(id) : undefined), [id]);
  const pid = existing?.productId ?? productId;
  const product = useLiveQuery(() => (pid ? db.products.get(pid) : undefined), [pid]);
  const [f, setF] = useState<QuoteForm | null>(id ? null : blankQuote(settings.defaultCurrency, settings.defaultUnit));
  useEffect(() => {
    if (existing && !f)
      setF({
        price: String(existing.price),
        currency: existing.currency,
        unit: existing.unit,
        moq: existing.moq?.toString() ?? '',
        tierQty: existing.tierQty?.toString() ?? '',
        quoteDate: existing.quoteDate,
        notes: existing.notes,
      });
  }, [existing, f]);
  if (!f || !product) return <Header title="Loading…" backTo="/products" />;
  const save = async () => {
    const price = num(f.price);
    if (price === null) {
      alert('Please enter a price');
      return;
    }
    const data = { price, currency: f.currency, unit: f.unit, moq: num(f.moq), tierQty: num(f.tierQty), quoteDate: f.quoteDate || todayYmd(), notes: f.notes };
    if (id) await updateQuotation(id, data);
    else await createQuotation({ ...data, productId: product.id, supplierId: product.supplierId });
    back(`/p/${product.id}`);
  };
  return (
    <div className="screen">
      <Header title={id ? 'Edit quote' : 'New quote'} sub={product.name} backTo={`/p/${product.id}`} />
      <Section>
        <QuoteFields f={f} set={(p) => setF({ ...f, ...p })} />
      </Section>
      <div className="actionbar">
        {id && (
          <button
            className="btn btn-danger-outline"
            onClick={async () => {
              if (!confirm('Move this quote to Trash?')) return;
              await deleteQuotation(id);
              back(`/p/${product.id}`);
            }}
          >
            Delete
          </button>
        )}
        <button className="btn btn-primary" onClick={save} data-testid="quote-save">
          Save quote
        </button>
      </div>
    </div>
  );
}

export function ProductDetail({ id }: { id: string }) {
  const p = useLiveQuery(() => db.products.get(id), [id]);
  const supplier = useSupplier(p?.supplierId);
  const quotes = useLiveQuery(() => db.quotations.where('productId').equals(id).filter((q) => !q.deleted).toArray(), [id]) ?? [];
  const photos = usePhotos(p?.supplierId, id) ?? [];
  const settings = useSettings();
  if (!p) return <Header title="Loading…" backTo="/products" />;
  if (p.deleted)
    return (
      <div className="screen">
        <Header title="Deleted" backTo="/products" />
        <Empty>This product was deleted.</Empty>
      </div>
    );
  const sorted = [...quotes].sort((a, b) => b.quoteDate.localeCompare(a.quoteDate) || a.price - b.price);
  return (
    <div className="screen">
      <Header title={p.name || 'Product'} sub={supplier ? `${supplier.code} ${supplier.companyName}` : ''} backTo={`/s/${p.supplierId}`} right={<button className="btn btn-sm" onClick={() => navigate(`/p/${id}/edit`)}>Edit</button>} />
      <Section>
        {p.category && (
          <div className="kv">
            <span>Category</span>
            <b>{p.category}</b>
          </div>
        )}
        {supplier && (
          <a className="kv" href={`#/s/${supplier.id}`}>
            <span>Supplier</span>
            <b>
              {supplier.code} {supplier.companyName} · {locationLine(supplier)}
            </b>
          </a>
        )}
        {p.notes && <div className="prewrap">{p.notes}</div>}
        <a className="btn btn-outline" href={`#/compare?q=${encodeURIComponent(p.name)}`}>
          Compare with other suppliers
        </a>
      </Section>
      <Section title="Quotes" right={<button className="btn btn-sm btn-primary" onClick={() => navigate(`/q/new?product=${id}`)}>+ Quote</button>}>
        {!sorted.length && <Empty>No price yet.</Empty>}
        {sorted.map((q) => (
          <a key={q.id} className="list-item" href={`#/q/${q.id}/edit`}>
            <div className="grow">
              <div className="price-lg">
                {fmtMoney(q.price, q.currency)} <span className="small muted">/ {q.unit}</span>
              </div>
              <div className="small muted">
                {[q.moq ? `MOQ ${q.moq.toLocaleString()}` : '', q.tierQty ? `@ ${q.tierQty.toLocaleString()} ${q.unit}` : '', fmtDate(q.quoteDate)].filter(Boolean).join(' · ')}
              </div>
              {q.notes && <div className="small">{q.notes}</div>}
            </div>
            <CnyHint q={q} rates={settings.ratesToCny} />
          </a>
        ))}
      </Section>
      <Section
        title="Product photos"
        right={<CaptureButton className="btn btn-sm" label="+ Photo" onFiles={(f) => savePhotos(f, p.supplierId, 'product', id)} />}
      >
        {photos.length ? <PhotoStrip photos={photos} /> : <Empty>No photos linked to this product.</Empty>}
      </Section>
      <Section>
        <button
          className="btn btn-danger-outline"
          onClick={async () => {
            if (!confirm('Move this product and its quotes to Trash?')) return;
            await deleteProduct(id);
            navigate(`/s/${p.supplierId}`, true);
          }}
        >
          Delete product
        </button>
      </Section>
    </div>
  );
}

export function CnyHint({ q, rates }: { q: Quotation; rates: Record<string, number | null> }) {
  if (q.currency === 'CNY') return null;
  const c = toCny(q.price, q.currency, rates);
  return c === null ? null : <span className="small muted right">≈ {fmtMoney(c, 'CNY')}*</span>;
}

/** All products with their latest prices, with search + price/MOQ filters. */
export function ProductsList() {
  const products = useProducts();
  const quotes = useQuotations() ?? [];
  const suppliers = useSuppliers() ?? [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [currency, setCurrency] = useState('');
  const [minP, setMinP] = useState('');
  const [maxP, setMaxP] = useState('');
  const [maxMoq, setMaxMoq] = useState('');
  const sById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const latest = useMemo(() => latestQuotes(quotes), [quotes]);
  const rows = useMemo(() => {
    if (!products) return [];
    const lo = num(minP);
    const hi = num(maxP);
    const mm = num(maxMoq);
    return products
      .filter((p) => sById.has(p.supplierId))
      .map((p) => ({ p, s: sById.get(p.supplierId)!, qs: latest.filter((x) => x.productId === p.id) }))
      .filter(({ p, s, qs }) => {
        if (cat && p.category !== cat) return false;
        if (!matchesQuery(norm(`${p.name} ${p.category} ${p.notes} ${s.code} ${s.companyName}`), q)) return false;
        if (currency || lo !== null || hi !== null || mm !== null) {
          return qs.some(
            (x) => (!currency || x.currency === currency) && (lo === null || x.price >= lo) && (hi === null || x.price <= hi) && (mm === null || x.moq === null || x.moq <= mm),
          );
        }
        return true;
      })
      .sort((a, b) => b.p.createdAt.localeCompare(a.p.createdAt));
  }, [products, sById, latest, q, cat, currency, minP, maxP, maxMoq]);
  const cats = [...new Set((products ?? []).map((p) => p.category).filter(Boolean))].sort();
  return (
    <div className="screen">
      <Header title="Products & quotes" sub={products ? `${rows.length} products · ${quotes.length} quotes` : ''} backTo="/more" />
      <div className="searchbar">
        <input type="search" placeholder="Search product, category, supplier…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="product-search" />
      </div>
      <div className="card filters">
        <div className="row">
          <label className="field grow">
            <span className="field-label">Category</span>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Any</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="">Any</option>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <Field className="grow" label="Min price" inputMode="decimal" value={minP} onChange={setMinP} />
          <Field className="grow" label="Max price" inputMode="decimal" value={maxP} onChange={setMaxP} />
          <Field className="grow" label="Max MOQ" inputMode="numeric" value={maxMoq} onChange={setMaxMoq} />
        </div>
      </div>
      <div className="list">
        {products && !products.length && <Empty>No products yet. Open a supplier and tap “+ Product”.</Empty>}
        {rows.map(({ p, s, qs }) => (
          <a key={p.id} className="list-item" href={`#/p/${p.id}`} data-testid="product-row">
            <div className="grow">
              <div className="li-title">{p.name}</div>
              <div className="small muted">
                <span className="code-chip">{s.code}</span> {s.companyName} {p.category && `· ${p.category}`}
              </div>
            </div>
            <div className="right">
              {qs.length ? (
                qs
                  .sort((a, b) => a.price - b.price)
                  .slice(0, 2)
                  .map((x) => (
                    <div key={x.id} className="price">
                      {fmtMoney(x.price, x.currency)}
                      <span className="small muted">/{x.unit}</span>
                      {x.moq ? <div className="small muted">MOQ {x.moq.toLocaleString()}</div> : null}
                    </div>
                  ))
              ) : (
                <span className="small muted">no price</span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
