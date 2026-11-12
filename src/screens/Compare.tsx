import { useMemo, useState } from 'react';
import { type CompareRow, fmtDate, fmtMoney, groupForComparison, latestQuotes, locationLine, matchesQuery, norm, toCny } from '../logic';
import { navigate } from '../router';
import { Empty, Header } from '../ui/components';
import { useProducts, useQuotations, useSettings, useSuppliers } from '../ui/hooks';

/**
 * Compare prices for the same / similar product across suppliers.
 * Prices are ranked only within the same currency AND unit. An optional "≈ CNY" column uses
 * the exchange rates YOU set in Settings and is labelled as an estimate.
 */
export function Compare({ initialQuery }: { initialQuery: string }) {
  const products = useProducts() ?? [];
  const quotes = useQuotations() ?? [];
  const suppliers = useSuppliers() ?? [];
  const settings = useSettings();
  const [q, setQ] = useState(initialQuery);
  const [cat, setCat] = useState('');
  const [latestOnly, setLatestOnly] = useState(true);

  const groups = useMemo(() => {
    if (!q.trim() && !cat) return [];
    const sById = new Map(suppliers.map((s) => [s.id, s]));
    const pById = new Map(products.map((p) => [p.id, p]));
    const qs = latestOnly ? latestQuotes(quotes) : quotes;
    const rows: CompareRow[] = [];
    for (const quote of qs) {
      const product = pById.get(quote.productId);
      const supplier = sById.get(quote.supplierId);
      if (!product || !supplier) continue;
      if (cat && product.category !== cat && supplier.category !== cat) continue;
      if (!matchesQuery(norm(`${product.name} ${product.category} ${product.notes} ${quote.notes}`), q)) continue;
      rows.push({ quote, product, supplier });
    }
    return groupForComparison(rows);
  }, [q, cat, latestOnly, products, quotes, suppliers]);

  const cats = [...new Set([...products.map((p) => p.category), ...suppliers.map((s) => s.category)].filter(Boolean))].sort();
  const hasRates = Object.values(settings.ratesToCny).some((r) => r && r > 0);
  const supplierCount = new Set(groups.flatMap((g) => g.rows.map((r) => r.supplier.id))).size;

  return (
    <div className="screen">
      <Header title="Compare prices" />
      <div className="searchbar">
        <input type="search" placeholder="Product, e.g. “phone case”" value={q} onChange={(e) => setQ(e.target.value)} data-testid="compare-search" />
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
          <label className="check">
            <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} /> Latest quotes only
          </label>
        </div>
      </div>

      {!q.trim() && !cat && <Empty>Type a product name or choose a category to compare quotes from different suppliers.</Empty>}
      {(q.trim() || cat) && !groups.length && <Empty>No quotes match.</Empty>}
      {groups.length > 0 && (
        <div className="small muted pad">
          {groups.reduce((n, g) => n + g.rows.length, 0)} quotes from {supplierCount} suppliers. Prices are only ranked against the same currency and unit.
        </div>
      )}

      {groups.map((g) => (
        <section className="card" key={g.key} data-testid="compare-group">
          <div className="card-hd">
            <h2>
              {g.currency} per {g.unit}
            </h2>
            <span className="small muted">
              {g.rows.length} quote{g.rows.length > 1 ? 's' : ''}
              {g.rows.length > 1 && ` · spread ${Math.round(((g.max - g.min) / (g.min || 1)) * 100)}%`}
            </span>
          </div>
          <div className="ctable">
            {g.rows.map((r, i) => {
              const cny = r.quote.currency !== 'CNY' && hasRates ? toCny(r.quote.price, r.quote.currency, settings.ratesToCny) : null;
              const best = r.quote.price === g.min && g.rows.length > 1;
              return (
                <button key={r.quote.id} className={`crow ${best ? 'best' : ''}`} onClick={() => navigate(`/p/${r.product.id}`)} data-testid="compare-row">
                  <div className="crank">{i + 1}</div>
                  <div className="grow">
                    <div className="li-title">
                      {r.product.name} {best && <span className="pill pill-ordered">lowest</span>}
                    </div>
                    <div className="small">
                      <span className="code-chip">{r.supplier.code}</span> {r.supplier.companyName || 'Unnamed'}
                    </div>
                    <div className="small muted">{locationLine(r.supplier)}</div>
                    <div className="small muted">
                      {[r.quote.moq ? `MOQ ${r.quote.moq.toLocaleString()}` : 'MOQ ?', r.quote.tierQty ? `price @ ${r.quote.tierQty.toLocaleString()}` : '', fmtDate(r.quote.quoteDate)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="right">
                    <div className="price-lg">{fmtMoney(r.quote.price, r.quote.currency)}</div>
                    {cny !== null && <div className="small muted">≈ {fmtMoney(cny, 'CNY')}*</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {hasRates && groups.length > 0 && <div className="small muted pad">* ≈ CNY uses your own exchange rates from Settings; it is an estimate, not a quote.</div>}
    </div>
  );
}
