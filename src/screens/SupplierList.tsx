import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db, type Photo, STATUS_LABELS, type Supplier, type SupplierStatus, type SupplierType, TYPE_LABELS, todayYmd } from '../db';
import { isIncomplete, locationLine, matchesQuery, productTextBySupplier, supplierHaystack } from '../logic';
import { navigate } from '../router';
import { Empty, Header, PhotoThumb, StatusPill } from '../ui/components';
import { useProducts, useSuppliers } from '../ui/hooks';

type Sort = 'newest' | 'code' | 'updated' | 'location';

export function SupplierCard({ s, photo }: { s: Supplier; photo?: Photo }) {
  return (
    <a className="list-item" href={`#/s/${s.id}`} data-testid="supplier-row">
      {photo ? <PhotoThumb photo={photo} /> : <span className="thumb thumb-empty">{s.code.replace(/\D/g, '').slice(-3)}</span>}
      <div className="grow">
        <div className="li-title">
          <span className="code-chip">{s.code}</span> {s.companyName || <span className="muted">Unnamed</span>}
        </div>
        <div className="small muted">{[locationLine(s), s.category].filter(Boolean).join(' — ') || 'No location yet'}</div>
        <div className="li-meta">
          <StatusPill status={s.status} />
          {s.wechatId && <span className="small">WeChat ✓</span>}
          {isIncomplete(s) && <span className="small warn">incomplete</span>}
          {s.dirty === 1 && <span className="small muted">⏳</span>}
        </div>
      </div>
    </a>
  );
}

/** Representative photo per supplier: shop front, else business card, else any. */
export function useCoverPhotos(): Map<string, Photo> {
  const photos = useLiveQuery(() => db.photos.filter((p) => !p.deleted).toArray(), []) ?? [];
  return useMemo(() => {
    const rank = { shop: 0, card_front: 1, booth: 2, product: 3, card_back: 4, document: 5 } as const;
    const m = new Map<string, Photo>();
    for (const p of photos) {
      const cur = m.get(p.supplierId);
      if (!cur || rank[p.kind] < rank[cur.kind]) m.set(p.supplierId, p);
    }
    return m;
  }, [photos]);
}

export function SupplierList({ initialQuery }: { initialQuery: string }) {
  const suppliers = useSuppliers();
  const products = useProducts() ?? [];
  const covers = useCoverPhotos();
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState<SupplierStatus | ''>('');
  const [district, setDistrict] = useState('');
  const [category, setCategory] = useState('');
  const [stype, setStype] = useState<SupplierType | ''>('');
  const [onlyFollow, setOnlyFollow] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [sort, setSort] = useState<Sort>('newest');
  const [showFilters, setShowFilters] = useState(false);

  const ptext = useMemo(() => productTextBySupplier(products), [products]);
  const list = useMemo(() => {
    if (!suppliers) return [];
    const today = todayYmd();
    const out = suppliers.filter(
      (s) =>
        (!status || s.status === status) &&
        (!district || s.district === district) &&
        (!category || s.category === category) &&
        (!stype || s.supplierType === stype) &&
        (!onlyFollow || (s.followUpDate && s.followUpDate <= today)) &&
        (!onlyIncomplete || isIncomplete(s)) &&
        matchesQuery(supplierHaystack(s, ptext.get(s.id)), q),
    );
    const num = (c: string) => Number.parseInt(c.replace(/\D/g, ''), 10) || 0;
    out.sort((a, b) => {
      if (sort === 'code') return num(a.code) - num(b.code);
      if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
      if (sort === 'location') return locationLine(a).localeCompare(locationLine(b), undefined, { numeric: true });
      return b.createdAt.localeCompare(a.createdAt);
    });
    return out;
  }, [suppliers, ptext, q, status, district, category, stype, onlyFollow, onlyIncomplete, sort]);

  const districts = [...new Set((suppliers ?? []).map((s) => s.district).filter(Boolean))].sort();
  const categories = [...new Set((suppliers ?? []).map((s) => s.category).filter(Boolean))].sort();
  const activeFilters = [status, district, category, stype, onlyFollow ? '1' : '', onlyIncomplete ? '1' : ''].filter(Boolean).length;

  return (
    <div className="screen">
      <Header title="Suppliers" sub={suppliers ? `${list.length} of ${suppliers.length}` : ''} />
      <div className="searchbar">
        <input
          type="search"
          placeholder="Search name, WeChat, phone, product, booth…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            navigate(`/suppliers?q=${encodeURIComponent(e.target.value)}`, true);
          }}
          data-testid="supplier-search"
        />
        <button className={`btn btn-sm ${activeFilters ? 'btn-primary' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>
      {showFilters && (
        <div className="card filters">
          <div className="row">
            <label className="field grow">
              <span className="field-label">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus | '')}>
                <option value="">Any</option>
                {(Object.keys(STATUS_LABELS) as SupplierStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span className="field-label">District</span>
              <select value={district} onChange={(e) => setDistrict(e.target.value)}>
                <option value="">Any</option>
                {districts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <label className="field grow">
              <span className="field-label">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Any</option>
                {categories.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span className="field-label">Type</span>
              <select value={stype} onChange={(e) => setStype(e.target.value as SupplierType | '')}>
                <option value="">Any</option>
                {(Object.keys(TYPE_LABELS) as SupplierType[]).map((k) => (
                  <option key={k} value={k}>
                    {TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={onlyFollow} onChange={(e) => setOnlyFollow(e.target.checked)} /> Follow-up due
            </label>
            <label className="check">
              <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} /> Incomplete
            </label>
          </div>
          <div className="row">
            <label className="field grow">
              <span className="field-label">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="newest">Newest first</option>
                <option value="code">Supplier ID</option>
                <option value="updated">Recently updated</option>
                <option value="location">Location</option>
              </select>
            </label>
            {activeFilters > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  setStatus('');
                  setDistrict('');
                  setCategory('');
                  setStype('');
                  setOnlyFollow(false);
                  setOnlyIncomplete(false);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
      <div className="list">
        {suppliers && !suppliers.length && <Empty>No suppliers yet. Tap ＋ to add your first one.</Empty>}
        {suppliers && suppliers.length > 0 && !list.length && <Empty>No supplier matches.</Empty>}
        {list.map((s) => (
          <SupplierCard key={s.id} s={s} photo={covers.get(s.id)} />
        ))}
      </div>
    </div>
  );
}
