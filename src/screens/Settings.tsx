import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { exportBackup, importBackup, saveFile } from '../backup';
import { CURRENCIES, db, getMeta, setMeta, UNITS } from '../db';
import { fmtDateTime, timeAgo } from '../logic';
import { saveSettings } from '../repo';
import { syncRunner } from '../sync/runner';
import { Empty, Field, Header, Section, Select, toast } from '../ui/components';
import { useSettings, useSyncStatus } from '../ui/hooks';
import { SyncCard } from './Dashboard';
import { listSnapshots, maybeSnapshot, restoreSnapshot, snapshotDate } from '../sync/snapshots';
import { unsavedPhotoIds } from '../devicePhotos';
import { openSaveToPhotos } from '../ui/saveSheet';
import { backupToFiles } from '../ui/safety';

export function More() {
  const items: [string, string, string][] = [
    ['#/products', '📦', 'Products & quotations'],
    ['#/compare', '⚖️', 'Compare prices'],
    ['#/locations', '📍', 'Locations'],
    ['#/sync', '🔄', 'Sync status, log & conflicts'],
    ['#/trash', '🗑️', 'Trash (restore deleted items)'],
    ['#/settings', '⚙️', 'Settings, cloud & backup'],
    ['#/help', '❔', 'How to use / install'],
  ];
  return (
    <div className="screen">
      <Header title="More" />
      <div className="card">
        {items.map(([href, ico, label]) => (
          <a key={href} className="list-item" href={href}>
            <span className="menu-ico">{ico}</span>
            <span className="grow li-title">{label}</span>
            <span className="muted">›</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function CloudSection() {
  const st = useSyncStatus();
  const cfg = useLiveQuery(() => getMeta<{ url: string; anonKey: string } | null>(db, 'cloudConfig', null), []);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (cfg === undefined) return null;

  if (!cfg) {
    return (
      <Section title="Cloud sync (Supabase)">
        <div className="small">
          Not set up — your data is stored <b>only on this phone</b>. Cloud sync needs a free Supabase project (see <code>docs/CLOUD-SETUP.md</code>). Use the <b>Project URL</b> and the <b>anon / publishable</b> key — never the service_role / secret key.
        </div>
        <Field label="Project URL" value={url} onChange={setUrl} placeholder="https://xxxx.supabase.co" inputMode="url" />
        <Field label="Anon / publishable key" value={key} onChange={setKey} placeholder="eyJ… or sb_publishable_…" />
        {msg && <div className="small err">{msg}</div>}
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setMsg(null);
            const u = url.trim().replace(/\/+$/, '');
            const k = key.trim();
            if (!/^https?:\/\/.+/.test(u)) return setMsg('URL must start with https://');
            if (k.length < 20) return setMsg('Key looks too short');
            if (/service_role|sb_secret_/i.test(k) || isServiceRoleJwt(k)) return setMsg('This looks like a SECRET/service_role key. Never put it in the app — use the anon / publishable key.');
            setBusy(true);
            try {
              const ok = await testConnection(u, k);
              if (!ok.ok) return setMsg(`Could not reach the project: ${ok.error}`);
              await syncRunner.saveConfig({ url: u, anonKey: k });
              toast('Cloud project connected — now sign in');
            } finally {
              setBusy(false);
            }
          }}
        >
          Test & save
        </button>
      </Section>
    );
  }

  const signedIn = st.state !== 'signed_out' && st.state !== 'local_only' && !!st.email;
  return (
    <Section title="Cloud sync (Supabase)">
      <div className="small muted">Project: {cfg.url}</div>
      {signedIn ? (
        <>
          <div className="kv">
            <span>Signed in as</span>
            <b>{st.email}</b>
          </div>
          <button
            className="btn btn-outline"
            onClick={async () => {
              if (st.pending && !confirm(`${st.pending} changes are not uploaded yet. They stay on this phone and upload after you sign in again. Sign out?`)) return;
              await syncRunner.remote?.client.auth.signOut();
              await syncRunner.refresh();
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <Field label="Email" type="email" inputMode="email" value={email} onChange={setEmail} />
          <Field label="Password" type="password" value={pw} onChange={setPw} />
          {msg && <div className="small">{msg}</div>}
          <div className="row">
            <button
              className="btn btn-primary grow"
              disabled={busy || !navigator.onLine}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                const { error } = (await syncRunner.remote?.client.auth.signInWithPassword({ email: email.trim(), password: pw })) ?? {};
                setBusy(false);
                if (error) setMsg(`Sign-in failed: ${error.message}`);
                else {
                  setPw('');
                  await syncRunner.refresh();
                  syncRunner.kick(100);
                  toast('Signed in — syncing');
                }
              }}
            >
              Sign in
            </button>
            <button
              className="btn btn-outline grow"
              disabled={busy || !navigator.onLine}
              onClick={async () => {
                if (pw.length < 8) return setMsg('Use a password of at least 8 characters.');
                setBusy(true);
                setMsg(null);
                const { data, error } = (await syncRunner.remote?.client.auth.signUp({ email: email.trim(), password: pw })) ?? {};
                setBusy(false);
                if (error) setMsg(`Sign-up failed: ${error.message}`);
                else if (!data?.session) setMsg('Account created. Check your email to confirm it, then sign in here.');
                else {
                  await syncRunner.refresh();
                  syncRunner.kick(100);
                }
              }}
            >
              Create account
            </button>
          </div>
          {!navigator.onLine && <div className="small muted">You need internet to sign in. The app works offline meanwhile.</div>}
        </>
      )}
      <button
        className="linkbtn small"
        onClick={async () => {
          if (!confirm('Disconnect this phone from the cloud project? Data on this phone is kept.')) return;
          await syncRunner.remote?.client.auth.signOut().catch(() => undefined);
          await syncRunner.saveConfig(null);
        }}
      >
        Disconnect cloud project
      </button>
    </Section>
  );
}

function isServiceRoleJwt(k: string) {
  try {
    const payload = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

async function testConnection(url: string, key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'key rejected' };
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function BackupSection() {
  const [busy, setBusy] = useState<string | null>(null);
  const lastBackup = useLiveQuery(() => getMeta<string | null>(db, 'lastBackupAt', null), []);
  const doExport = async (share: boolean) => {
    setBusy('Preparing backup…');
    try {
      const r = await exportBackup();
      await saveFile(r.blob, r.filename, share);
      await setMeta(db, 'lastBackupAt', new Date().toISOString());
      toast(`Backup: ${r.counts.suppliers} suppliers, ${r.counts.quotations} quotes, ${r.counts.photos} photos (${(r.blob.size / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      alert(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Backup & export">
      <div className="small">
        One .zip with all suppliers, products and quotes as <b>CSV</b> (opens in Excel / Google Sheets) and <b>JSON</b>, plus every photo named by supplier ID. Last backup: <b>{lastBackup ? timeAgo(lastBackup) : 'never'}</b>.
      </div>
      <div className="row">
        <button
          className="btn btn-primary grow"
          disabled={!!busy}
          onClick={async () => {
            setBusy('Preparing backup…');
            try {
              await backupToFiles();
            } catch (e) {
              alert(`Backup failed: ${(e as Error).message}`);
            } finally {
              setBusy(null);
            }
          }}
          data-testid="export-share"
        >
          Share / Save to Files
        </button>
        <button className="btn btn-outline grow" disabled={!!busy} onClick={() => doExport(false)} data-testid="export-download">
          Download .zip
        </button>
      </div>
      <label className="btn btn-outline">
        Restore / merge from backup…
        <input
          type="file"
          accept=".zip,application/zip"
          style={{ display: 'none' }}
          data-testid="import-input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy('Restoring…');
            try {
              const r = await importBackup(f);
              alert(`Restore finished.\nAdded: ${r.added}\nUpdated: ${r.updated}\nUnchanged: ${r.skipped}\nPhotos: ${r.photosAdded}${r.renumbered.length ? `\nRenumbered (ID already used): ${r.renumbered.join(', ')}` : ''}`);
            } catch (err) {
              alert(`Restore failed: ${(err as Error).message}`);
            } finally {
              setBusy(null);
            }
          }}
        />
      </label>
      {busy && <div className="small">{busy}</div>}
    </Section>
  );
}

function SnapshotSection() {
  const st = useSyncStatus();
  const [list, setList] = useState<{ name: string; size: number | null }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cloudOn = st.state !== 'local_only' && st.state !== 'signed_out';
  const load = async () => {
    setErr(null);
    try {
      const uid = await syncRunner.remote?.getUserId();
      if (!uid || !syncRunner.remote) return;
      setList(await listSnapshots(syncRunner.remote, uid));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (cloudOn && navigator.onLine) void load();
  }, [cloudOn]);
  if (!cloudOn) {
    return (
      <Section title="Cloud snapshots (version history)">
        <div className="small muted">After cloud sync is set up, a dated copy of all your records is saved in the cloud once a day and old copies are kept, so a wrong edit or delete can always be undone.</div>
      </Section>
    );
  }
  return (
    <Section title="Cloud snapshots (version history)">
      <div className="small">A dated copy of all records is saved in your cloud once a day after syncing. Old snapshots are never overwritten. Photos are kept in the cloud even if you delete them here. Restoring brings back anything deleted since that day and keeps your newer edits.</div>
      <div className="row">
        <button
          className="btn btn-outline grow"
          disabled={!!busy || !navigator.onLine}
          onClick={async () => {
            setBusy('Saving snapshot…');
            try {
              const uid = await syncRunner.remote!.getUserId();
              if (uid) await maybeSnapshot(db, syncRunner.remote!, uid, true);
              await load();
              toast('Snapshot saved in the cloud');
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          Save a snapshot now
        </button>
        <button className="btn btn-sm" onClick={load} disabled={!navigator.onLine}>
          Refresh
        </button>
      </div>
      {busy && <div className="small">{busy}</div>}
      {err && <div className="small err">{err}</div>}
      {list && !list.length && <div className="small muted">No snapshots yet.</div>}
      {list?.slice(0, 30).map((f) => (
        <div key={f.name} className="list-item">
          <div className="grow">
            <div className="li-title">{fmtDateTime(snapshotDate(f.name)?.toISOString() ?? f.name)}</div>
            <div className="small muted">{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''}</div>
          </div>
          <button
            className="btn btn-sm"
            disabled={!!busy}
            onClick={async () => {
              if (!confirm('Restore this snapshot? Deleted items come back; your newer edits are kept.')) return;
              setBusy('Restoring…');
              try {
                const uid = await syncRunner.remote!.getUserId();
                const r = await restoreSnapshot(db, syncRunner.remote!, uid!, f.name);
                alert(`Restored.\nAdded: ${r.added}\nBrought back: ${r.restored}\nUpdated: ${r.updated}\nUnchanged: ${r.skipped}`);
                syncRunner.kick(500);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            Restore
          </button>
        </div>
      ))}
    </Section>
  );
}

function PhotosSection() {
  const s = useSettings();
  const unsaved = useLiveQuery(() => unsavedPhotoIds(), []) ?? [];
  return (
    <Section title="iPhone Photos (camera roll)">
      <div className="small">
        iPhone does not let web apps save into Photos automatically. The app gives you a one-tap “Save to Photos”: each copy gets a label with the supplier ID, photo type and booth burned in. In the share screen tap <b>“Save N Images”</b>; if your iOS does not show it, use <b>“Save to Files”</b>. Most reliable alternative: take photos with the iPhone Camera app (saved to Photos/iCloud automatically) and add them here with <b>🖼️ Gallery</b>.
      </div>
      <label className="check">
        <input type="checkbox" checked={s.offerSaveToPhotos} onChange={(e) => saveSettings({ offerSaveToPhotos: e.target.checked })} /> Offer “Save to Photos” right after each photo
      </label>
      <button className="btn btn-primary" disabled={!unsaved.length} onClick={() => openSaveToPhotos(unsaved)} data-testid="save-unsaved-photos">
        {unsaved.length ? `Save ${Math.min(unsaved.length, 20)} of ${unsaved.length} unsaved photo(s) to Photos` : 'All photos already saved to Photos'}
      </button>
    </Section>
  );
}

function StorageSection() {
  const [info, setInfo] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  const load = async () => {
    const est = (await navigator.storage?.estimate?.()) ?? {};
    const persisted = await navigator.storage?.persisted?.();
    setInfo({ usage: est.usage, quota: est.quota, persisted });
  };
  useEffect(() => {
    void load();
  }, []);
  const counts = useLiveQuery(async () => ({ photos: await db.photos.filter((p) => !p.deleted).count() }), []);
  return (
    <Section title="Storage on this phone">
      {info && (
        <>
          <div className="kv">
            <span>Used</span>
            <b>
              {info.usage !== undefined ? `${(info.usage / 1e6).toFixed(1)} MB` : '?'}
              {info.quota ? ` of ~${(info.quota / 1e9).toFixed(1)} GB available` : ''}
            </b>
          </div>
          <div className="kv">
            <span>Photos</span>
            <b>{counts?.photos ?? 0}</b>
          </div>
          <div className="kv">
            <span>Protected from automatic cleanup</span>
            <b>{info.persisted ? 'Yes' : 'No'}</b>
          </div>
          {!info.persisted && (
            <button
              className="btn btn-outline"
              onClick={async () => {
                const ok = await navigator.storage?.persist?.();
                toast(ok ? 'Storage protected' : 'The browser did not allow it — install the app to the home screen and try again');
                void load();
              }}
            >
              Ask the browser to protect my data
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function PreferencesSection() {
  const s = useSettings();
  return (
    <Section title="Preferences">
      <Field label="Supplier ID prefix" value={s.codePrefix} onChange={(v) => saveSettings({ codePrefix: v || 'YW-' })} hint="New suppliers get the next number, e.g. YW-001. Use a different prefix per phone (YW-A, YW-B) if several phones capture at the same time." />
      <div className="row">
        <Select className="grow" label="Default currency" value={s.defaultCurrency} onChange={(v) => saveSettings({ defaultCurrency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Select className="grow" label="Default unit" value={s.defaultUnit} onChange={(v) => saveSettings({ defaultUnit: v })} options={UNITS.map((c) => ({ value: c, label: c }))} />
      </div>
      <div className="field-label">My exchange rates (optional, only for “≈ CNY” hints)</div>
      <div className="row">
        {['USD', 'CAD', 'EUR'].map((c) => (
          <Field
            key={c}
            className="grow"
            label={`1 ${c} = ? CNY`}
            inputMode="decimal"
            value={s.ratesToCny[c] ? String(s.ratesToCny[c]) : ''}
            onChange={(v) => {
              const n = Number(v.replace(',', '.'));
              saveSettings({ ratesToCny: { ...s.ratesToCny, [c]: v && Number.isFinite(n) && n > 0 ? n : null } });
            }}
          />
        ))}
      </div>
    </Section>
  );
}

function DangerSection() {
  const st = useSyncStatus();
  return (
    <Section title="Danger zone">
      <button
        className="btn btn-danger-outline"
        onClick={async () => {
          const warn = st.pending ? `\n\nWARNING: ${st.pending} changes are NOT uploaded to the cloud and will be lost.` : '';
          const t = prompt(`This erases ALL suppliers, prices and photos on this phone.${warn}\n\nExport a backup first. Type ERASE to confirm.`);
          if (t !== 'ERASE') return;
          await db.delete();
          localStorage.clear();
          location.reload();
        }}
      >
        Erase all data on this phone
      </button>
    </Section>
  );
}

export function Settings() {
  return (
    <div className="screen">
      <Header title="Settings" backTo="/more" />
      <SyncCard />
      <CloudSection />
      <SnapshotSection />
      <BackupSection />
      <PhotosSection />
      <PreferencesSection />
      <StorageSection />
      <Section title="Privacy">
        <div className="small">
          Data is stored in this browser’s private storage on this phone. If cloud sync is enabled, it is also stored in <b>your own</b> Supabase project; Row Level Security restricts every row and photo to your account, and photos are in a private bucket. Delete data here (Danger zone) and in your Supabase project (delete the project or the rows). Nothing is shared with anyone else.
        </div>
      </Section>
      <DangerSection />
      <div className="small muted pad">Yiwu Supplier Manager v{__APP_VERSION__}</div>
    </div>
  );
}

export function SyncScreen() {
  const st = useSyncStatus();
  const log = useLiveQuery(() => db.syncLog.orderBy('id').reverse().limit(60).toArray(), []) ?? [];
  const conflicts = useLiveQuery(() => db.conflicts.orderBy('id').reverse().toArray(), []) ?? [];
  const failedPhotos = useLiveQuery(() => db.photos.filter((p) => !p.deleted && !!p.uploadError).toArray(), []) ?? [];
  return (
    <div className="screen">
      <Header title="Sync" backTo="/more" />
      <SyncCard />
      <Section title="How sync works">
        <div className="small">
          Everything is saved on the phone first. When online and signed in, the app uploads automatically (on open, when the connection returns, after edits, and every minute while changes are pending). iPhone does not allow uploads while the app is closed — open the app on Wi-Fi to finish uploading. If two devices edit the same record, the most recent edit wins and the other version is kept below.
        </div>
        {st.state === 'error' && (
          <button className="btn btn-outline" onClick={() => syncRunner.syncNow()}>
            Retry now
          </button>
        )}
      </Section>
      {failedPhotos.length > 0 && (
        <Section title={`Photos with upload problems (${failedPhotos.length})`}>
          {failedPhotos.map((p) => (
            <div key={p.id} className="small">
              {fmtDateTime(p.createdAt)} — {p.uploadError}
            </div>
          ))}
        </Section>
      )}
      <Section title={`Conflicts (${conflicts.filter((c) => !c.reviewed).length} new)`}>
        {!conflicts.length && <Empty>No conflicts.</Empty>}
        {conflicts.map((c) => (
          <details key={c.id} className={`conflict ${c.reviewed ? 'muted' : ''}`}>
            <summary>
              {fmtDateTime(c.at)} — {c.label}: kept {c.kept === 'local' ? 'this phone’s' : 'the cloud'} version
            </summary>
            <div className="small">Discarded version (copy anything you need back into the record):</div>
            <pre className="pre">{JSON.stringify(c.discarded, null, 2)}</pre>
            {!c.reviewed && (
              <button className="btn btn-sm" onClick={() => db.conflicts.update(c.id!, { reviewed: 1 })}>
                Mark reviewed
              </button>
            )}
          </details>
        ))}
      </Section>
      <Section title="Sync log">
        {!log.length && <Empty>Nothing yet.</Empty>}
        {log.map((l) => (
          <div key={l.id} className={`small log-${l.level}`}>
            {fmtDateTime(l.at)} — {l.message}
          </div>
        ))}
      </Section>
    </div>
  );
}
