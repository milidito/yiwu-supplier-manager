import { useState } from 'react';
import { todayYmd } from '../db';
import { fmtDate, isIncomplete, timeAgo } from '../logic';
import { navigate } from '../router';
import { syncRunner } from '../sync/runner';
import { Empty, Section } from '../ui/components';
import { isIos, isStandalone, useProducts, useQuotations, useSuppliers, useSyncStatus } from '../ui/hooks';
import { SupplierCard, useCoverPhotos } from './SupplierList';

export function SyncCard() {
  const st = useSyncStatus();
  const text: Record<string, string> = {
    local_only: 'Cloud sync is not set up yet. Your data is saved only on this phone — export a backup regularly.',
    signed_out: 'Cloud is configured but you are signed out. Sign in to back up and sync.',
    offline: 'Offline. Everything is saved on this phone and will upload when you are back online.',
    syncing: 'Syncing…',
    synced: 'All changes are backed up to the cloud.',
    pending: 'Changes waiting to upload.',
    error: 'Last sync failed — it will retry automatically.',
  };
  return (
    <section className={`card sync-card sync-${st.state}`} data-testid="sync-card">
      <div className="row between">
        <div>
          <div className="sync-title">
            {st.state === 'local_only' ? 'Local only' : st.state === 'synced' ? 'Synced' : st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Sync error' : st.state === 'offline' ? 'Offline' : st.state === 'signed_out' ? 'Signed out' : 'Pending'}
            {st.pending > 0 && <span className="badge">{st.pending} pending</span>}
          </div>
          <div className="small">{text[st.state]}</div>
          {st.lastError && st.state === 'error' && <div className="small err">{st.lastError}</div>}
          {st.state !== 'local_only' && <div className="small muted">Last successful sync: {timeAgo(st.lastSyncOkAt)}</div>}
        </div>
        {st.state === 'local_only' || st.state === 'signed_out' ? (
          <button className="btn btn-sm" onClick={() => navigate('/settings')}>
            Set up
          </button>
        ) : (
          <button className="btn btn-sm" disabled={st.state === 'syncing' || st.state === 'offline'} onClick={() => syncRunner.syncNow()}>
            Sync now
          </button>
        )}
      </div>
    </section>
  );
}

export function Dashboard() {
  const suppliers = useSuppliers();
  const products = useProducts() ?? [];
  const quotes = useQuotations() ?? [];
  const covers = useCoverPhotos();
  const [hideInstall, setHideInstall] = useState(() => localStorage.getItem('ysm-hide-install') === '1');
  if (!suppliers) return null;
  const today = todayYmd();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const addedToday = suppliers.filter((s) => s.createdAt >= startOfDay).length;
  const addedWeek = suppliers.filter((s) => s.createdAt >= weekAgo).length;
  const due = suppliers.filter((s) => s.followUpDate && s.followUpDate <= today).sort((a, b) => (a.followUpDate! < b.followUpDate! ? -1 : 1));
  const incomplete = suppliers.filter(isIncomplete).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recent = [...suppliers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const showInstall = !hideInstall && !isStandalone();

  return (
    <div className="screen">
      <header className="hdr hdr-home">
        <div className="hdr-title">
          <div className="hdr-main">Yiwu Suppliers</div>
          <div className="hdr-sub">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
      </header>

      {showInstall && (
        <section className="card note-warn">
          <b>Install this app on your home screen</b>
          <div className="small">
            {isIos()
              ? 'In Safari tap Share → “Add to Home Screen”. On iPhone this is important: Safari may delete website data that is not installed after a few days without use.'
              : 'In Chrome tap ⋮ → “Install app” / “Add to Home screen” so it opens offline like a normal app.'}
          </div>
          <button
            className="linkbtn"
            onClick={() => {
              localStorage.setItem('ysm-hide-install', '1');
              setHideInstall(true);
            }}
          >
            Dismiss
          </button>
        </section>
      )}

      <button className="btn btn-primary btn-xl" onClick={() => navigate(`/add?n=${Date.now()}`)} data-testid="dash-add">
        ＋ Add supplier
      </button>

      <SyncCard />

      <div className="stats">
        <a className="stat" href="#/suppliers">
          <b data-testid="stat-total">{suppliers.length}</b>
          <span>suppliers</span>
        </a>
        <div className="stat">
          <b>{addedToday}</b>
          <span>added today</span>
        </div>
        <div className="stat">
          <b>{addedWeek}</b>
          <span>this week</span>
        </div>
        <a className="stat" href="#/products">
          <b>{quotes.length}</b>
          <span>quotes · {products.length} products</span>
        </a>
      </div>

      <div className="quick">
        <a className="btn" href="#/suppliers">
          🔎 Search
        </a>
        <a className="btn" href="#/locations">
          📍 Locations
        </a>
        <a className="btn" href="#/compare">
          ⚖️ Compare
        </a>
        <a className="btn" href="#/products">
          📦 Products
        </a>
      </div>

      {due.length > 0 && (
        <Section title={`Follow-up due (${due.length})`}>
          {due.slice(0, 5).map((s) => (
            <a key={s.id} className="list-item" href={`#/s/${s.id}`}>
              <div className="grow">
                <div className="li-title">
                  <span className="code-chip">{s.code}</span> {s.companyName || 'Unnamed'}
                </div>
                <div className="small muted">
                  {fmtDate(s.followUpDate)} {s.followUpNote && `— ${s.followUpNote}`}
                </div>
              </div>
            </a>
          ))}
        </Section>
      )}

      <Section title="Recently updated" right={<a href="#/suppliers" className="small">All →</a>}>
        {!recent.length && <Empty>No suppliers yet. Tap “＋ Add supplier” at the first shop you visit.</Empty>}
        {recent.map((s) => (
          <SupplierCard key={s.id} s={s} photo={covers.get(s.id)} />
        ))}
      </Section>

      {incomplete.length > 0 && (
        <Section title={`To complete later (${incomplete.length})`}>
          <div className="small muted">Missing company name, WeChat/phone, or booth.</div>
          {incomplete.slice(0, 5).map((s) => (
            <a key={s.id} className="list-item" href={`#/s/${s.id}/edit`}>
              <div className="grow">
                <span className="code-chip">{s.code}</span> {s.companyName || <span className="muted">Unnamed</span>}
              </div>
              <span className="small">Complete →</span>
            </a>
          ))}
        </Section>
      )}
    </div>
  );
}
