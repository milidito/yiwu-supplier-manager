import { useLiveQuery } from 'dexie-react-hooks';
import { db, PHOTO_KIND_LABELS } from '../db';
import { fmtDateTime, fmtMoney } from '../logic';
import { restorePhoto, restoreProduct, restoreQuotation, restoreSupplier } from '../repo';
import { Empty, Header, PhotoThumb, Section, toast } from '../ui/components';

/** Everything deleted stays here (and in the cloud) and can be restored. Nothing is erased automatically. */
export function Trash() {
  const data = useLiveQuery(async () => {
    const [suppliers, products, quotes, photos] = await Promise.all([db.suppliers.toArray(), db.products.toArray(), db.quotations.toArray(), db.photos.toArray()]);
    const sById = new Map(suppliers.map((s) => [s.id, s]));
    const pById = new Map(products.map((p) => [p.id, p]));
    const delSup = suppliers.filter((s) => s.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // children deleted on their own (their parent is still active)
    const delProd = products.filter((p) => p.deleted && !sById.get(p.supplierId)?.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const delQuotes = quotes.filter((q) => q.deleted && !pById.get(q.productId)?.deleted && !sById.get(q.supplierId)?.deleted);
    const delPhotos = photos.filter((p) => p.deleted && !sById.get(p.supplierId)?.deleted && !(p.productId && pById.get(p.productId)?.deleted));
    return { delSup, delProd, delQuotes, delPhotos, sById, pById };
  }, []);
  if (!data) return null;
  const { delSup, delProd, delQuotes, delPhotos, sById, pById } = data;
  const empty = !delSup.length && !delProd.length && !delQuotes.length && !delPhotos.length;
  return (
    <div className="screen">
      <Header title="Trash" sub="Deleted items — restore any time" backTo="/more" />
      {empty && <Empty>Trash is empty.</Empty>}
      {delSup.length > 0 && (
        <Section title={`Suppliers (${delSup.length})`}>
          {delSup.map((s) => (
            <div key={s.id} className="list-item" data-testid="trash-supplier">
              <div className="grow">
                <div className="li-title">
                  <span className="code-chip">{s.code}</span> {s.companyName || 'Unnamed'}
                </div>
                <div className="small muted">Deleted {fmtDateTime(s.updatedAt)} · with its products, prices and photos</div>
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  await restoreSupplier(s.id);
                  toast(`${s.code} restored`);
                }}
              >
                Restore
              </button>
            </div>
          ))}
        </Section>
      )}
      {delProd.length > 0 && (
        <Section title={`Products (${delProd.length})`}>
          {delProd.map((p) => (
            <div key={p.id} className="list-item">
              <div className="grow">
                <div className="li-title">{p.name || 'Unnamed product'}</div>
                <div className="small muted">
                  {sById.get(p.supplierId)?.code} · deleted {fmtDateTime(p.updatedAt)}
                </div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => restoreProduct(p.id)}>
                Restore
              </button>
            </div>
          ))}
        </Section>
      )}
      {delQuotes.length > 0 && (
        <Section title={`Quotes (${delQuotes.length})`}>
          {delQuotes.map((q) => (
            <div key={q.id} className="list-item">
              <div className="grow">
                <div className="li-title">
                  {fmtMoney(q.price, q.currency)} / {q.unit}
                </div>
                <div className="small muted">
                  {sById.get(q.supplierId)?.code} · {pById.get(q.productId)?.name} · deleted {fmtDateTime(q.updatedAt)}
                </div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => restoreQuotation(q.id)}>
                Restore
              </button>
            </div>
          ))}
        </Section>
      )}
      {delPhotos.length > 0 && (
        <Section title={`Photos (${delPhotos.length})`}>
          {delPhotos.map((p) => (
            <div key={p.id} className="list-item">
              <PhotoThumb photo={p} />
              <div className="grow">
                <div className="li-title">{PHOTO_KIND_LABELS[p.kind]}</div>
                <div className="small muted">
                  {sById.get(p.supplierId)?.code} · deleted {fmtDateTime(p.updatedAt)}
                </div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => restorePhoto(p.id)}>
                Restore
              </button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
