import { useLiveQuery } from 'dexie-react-hooks';
import { db, STATUS_LABELS, type SupplierStatus, TYPE_LABELS, todayYmd } from '../db';
import { fmtDate, fmtDateTime, fmtMoney, latestQuotes, locationLine } from '../logic';
import { deleteSupplier, updateSupplier } from '../repo';
import { navigate } from '../router';
import { copyText, Empty, Header, Section, Select, Stars } from '../ui/components';
import { GroupedGallery, usePhotos } from '../ui/photos';
import { useSupplier } from './SupplierEditor';

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function SupplierDetail({ id }: { id: string }) {
  const s = useSupplier(id);
  const photos = usePhotos(id) ?? [];
  const products = useLiveQuery(() => db.products.where('supplierId').equals(id).filter((p) => !p.deleted).toArray(), [id]) ?? [];
  const quotes = useLiveQuery(() => db.quotations.where('supplierId').equals(id).filter((q) => !q.deleted).toArray(), [id]) ?? [];

  if (s === undefined) return <Header title="Loading…" backTo="/suppliers" />;
  if (s === null || s.deleted)
    return (
      <div className="screen">
        <Header title="Not found" backTo="/suppliers" />
        <Empty>This supplier was deleted or does not exist.</Empty>
      </div>
    );

  const latest = latestQuotes(quotes);
  const phoneDigits = s.phone.replace(/[^\d+]/g, '');
  const waDigits = s.phone.replace(/\D/g, '');
  const loc = locationLine(s);
  const followDue = s.followUpDate && s.followUpDate <= todayYmd();

  return (
    <div className="screen">
      <Header title={s.code} sub={s.companyName || 'Unnamed supplier'} backTo="/suppliers" right={<button className="btn btn-sm" onClick={() => navigate(`/s/${id}/edit`)}>Edit</button>} />

      <div className="code-banner">
        <div>
          <div className="code-big" data-testid="detail-code">{s.code}</div>
          <div className="detail-name">{s.companyName || <span className="muted">No company name yet</span>}</div>
          {s.contactPerson && <div className="muted">{s.contactPerson}</div>}
        </div>
        <div className={`save-state ${s.dirty ? '' : 'ok'}`}>{s.dirty ? 'Saved on phone · upload pending' : s.syncedAt ? 'Synced to cloud' : 'Saved on phone'}</div>
      </div>

      <Section>
        <div className="row">
          <Select<SupplierStatus>
            className="grow"
            label="Status"
            value={s.status}
            onChange={(v) => updateSupplier(id, { status: v })}
            options={(Object.keys(STATUS_LABELS) as SupplierStatus[]).map((k) => ({ value: k, label: STATUS_LABELS[k] }))}
          />
          <div className="field">
            <span className="field-label">My rating</span>
            <Stars value={s.rating} onChange={(v) => updateSupplier(id, { rating: v })} />
          </div>
        </div>
        <div className="kv">
          <span>Type</span>
          <b>{TYPE_LABELS[s.supplierType]}</b>
        </div>
        {s.category && (
          <div className="kv">
            <span>Category</span>
            <b>{s.category}</b>
          </div>
        )}
      </Section>

      <Section title="Contact">
        {s.wechatId ? (
          <div className="contact-row">
            <span className="contact-ico wechat">微</span>
            <div className="grow">
              <div className="small muted">WeChat</div>
              <div className="mono">{s.wechatId}</div>
            </div>
            <button className="btn btn-sm" onClick={() => copyText(s.wechatId, 'WeChat ID copied')}>
              Copy
            </button>
          </div>
        ) : (
          <div className="muted small">No WeChat ID yet</div>
        )}
        {s.phone && (
          <div className="contact-row">
            <span className="contact-ico">☎</span>
            <div className="grow">
              <div className="small muted">Phone</div>
              <div className="mono">{s.phone}</div>
            </div>
            <a className="btn btn-sm" href={`tel:${phoneDigits}`}>
              Call
            </a>
            {waDigits.length >= 8 && (
              <a className="btn btn-sm" href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            )}
          </div>
        )}
        {s.email && (
          <div className="contact-row">
            <span className="contact-ico">@</span>
            <div className="grow mono">{s.email}</div>
            <a className="btn btn-sm" href={`mailto:${s.email}`}>
              Email
            </a>
          </div>
        )}
      </Section>

      <Section title="Location">
        <div className="loc-big" data-testid="detail-location">{loc || <span className="muted">No location yet</span>}</div>
        {s.locationNotes && <div className="muted">{s.locationNotes}</div>}
      </Section>

      <Section
        title="Products & prices"
        right={
          <button className="btn btn-sm btn-primary" onClick={() => navigate(`/p/new?supplier=${id}`)} data-testid="add-product">
            + Product
          </button>
        }
      >
        {!products.length && <Empty>No products yet. Add one with its price, unit and MOQ.</Empty>}
        {products.map((p) => {
          const qs = latest.filter((q) => q.productId === p.id).sort((a, b) => a.price - b.price);
          return (
            <a key={p.id} className="list-item" href={`#/p/${p.id}`}>
              <div className="grow">
                <div className="li-title">{p.name || '(unnamed product)'}</div>
                {p.category && <div className="small muted">{p.category}</div>}
              </div>
              <div className="right">
                {qs.length ? (
                  qs.slice(0, 2).map((q) => (
                    <div key={q.id} className="price">
                      {fmtMoney(q.price, q.currency)}
                      <span className="small muted"> /{q.unit}</span>
                      {q.moq ? <div className="small muted">MOQ {q.moq.toLocaleString()}</div> : null}
                    </div>
                  ))
                ) : (
                  <span className="small muted">no price</span>
                )}
              </div>
            </a>
          );
        })}
      </Section>

      <Section title="Photos" right={<span className="muted small">{photos.length}</span>}>
        <GroupedGallery supplierId={id} photos={photos} />
      </Section>

      <Section title="Follow-up">
        <div className={followDue ? 'note note-warn' : ''}>
          {s.followUpDate ? (
            <>
              <b>{fmtDate(s.followUpDate)}</b> {followDue && '· due'} {s.followUpNote && `— ${s.followUpNote}`}
            </>
          ) : (
            <span className="muted">No follow-up set</span>
          )}
        </div>
        <div className="chips">
          {[
            ['Tomorrow', 1],
            ['3 days', 3],
            ['1 week', 7],
            ['2 weeks', 14],
          ].map(([l, n]) => (
            <button key={l} className="chip" onClick={() => updateSupplier(id, { followUpDate: addDays(n as number) })}>
              {l}
            </button>
          ))}
          {s.followUpDate && (
            <button className="chip" onClick={() => updateSupplier(id, { followUpDate: null })}>
              ✓ Done / clear
            </button>
          )}
        </div>
      </Section>

      {s.notes && (
        <Section title="Notes">
          <div className="prewrap">{s.notes}</div>
        </Section>
      )}

      <Section>
        <div className="small muted">
          Created {fmtDateTime(s.createdAt)} · Updated {fmtDateTime(s.updatedAt)}
        </div>
        <div className="small muted">Ratings, type and notes are your own observations, not verified facts.</div>
        <button
          className="btn btn-danger-outline"
          onClick={async () => {
            if (!confirm(`Move ${s.code} with its products, prices and photos to Trash? You can restore it from More → Trash.`)) return;
            await deleteSupplier(id);
            navigate('/suppliers', true);
          }}
        >
          Move supplier to Trash
        </button>
      </Section>
    </div>
  );
}
