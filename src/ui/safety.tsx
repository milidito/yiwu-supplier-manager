import { useLiveQuery } from 'dexie-react-hooks';
import { exportBackup, saveFile } from '../backup';
import { db, getMeta, setMeta } from '../db';
import { unsavedPhotoIds } from '../devicePhotos';
import { timeAgo } from '../logic';
import { navigate } from '../router';
import { Section, toast } from './components';
import { useSyncStatus } from './hooks';
import { openSaveToPhotos } from './saveSheet';

const DAY = 864e5;

export async function backupToFiles() {
  const r = await exportBackup();
  const how = await saveFile(r.blob, r.filename, true);
  if (how !== 'cancelled') {
    await setMeta(db, 'lastBackupAt', new Date().toISOString());
    toast(`Backup ready: ${r.counts.suppliers} suppliers, ${r.counts.photos} photos (${(r.blob.size / 1e6).toFixed(1)} MB)`);
  }
}

/** Excel copy: one row per supplier with its photos. Loaded on demand (the Excel library is large). */
export async function excelToFiles(onProgress?: (msg: string) => void) {
  onProgress?.('Building Excel file…');
  const { exportExcel } = await import('../excel');
  const r = await exportExcel(undefined, (done, total) => onProgress?.(`Adding photos ${done}/${total}…`));
  const how = await saveFile(r.blob, r.filename, true);
  if (how !== 'cancelled') {
    await setMeta(db, 'lastExcelAt', new Date().toISOString());
    toast(`Excel ready: ${r.counts.suppliers} suppliers, ${r.counts.images} photos (${(r.blob.size / 1e6).toFixed(1)} MB)`);
  }
}

/** "Your copies": shows every place the data is kept and what needs attention. */
export function SafetyCard() {
  const st = useSyncStatus();
  const info = useLiveQuery(async () => {
    const uid = await getMeta<string | null>(db, 'syncUserId', null);
    return {
      suppliers: await db.suppliers.filter((s) => !s.deleted).count(),
      photos: await db.photos.filter((p) => !p.deleted).count(),
      lastBackup: await getMeta<string | null>(db, 'lastBackupAt', null),
      lastExcel: await getMeta<string | null>(db, 'lastExcelAt', null),
      lastSnapshot: uid ? await getMeta<string | null>(db, `lastSnapshotAt:${uid}`, null) : null,
      lastChange: (await db.suppliers.orderBy('updatedAt').last())?.updatedAt ?? null,
      unsaved: (await unsavedPhotoIds()).length,
    };
  }, []);
  if (!info || !info.suppliers) return null;
  const cloudOn = st.state !== 'local_only' && st.state !== 'signed_out';
  const fileStale = !info.lastBackup || (info.lastChange && info.lastChange > info.lastBackup && Date.now() - new Date(info.lastBackup).getTime() > DAY);
  return (
    <Section title="Your copies" className="safety">
      <div className="safety-row">
        <span className="safety-ico">📱</span>
        <div className="grow">
          <b>In the app on this phone</b>
          <div className="small muted">
            {info.suppliers} suppliers · {info.photos} photos
          </div>
        </div>
        <span className="ok-txt">✓</span>
      </div>
      <div className="safety-row">
        <span className="safety-ico">☁️</span>
        <div className="grow">
          <b>Cloud sync</b>
          <div className="small muted">
            {!cloudOn ? 'Not set up' : st.pending ? `${st.pending} change(s) waiting to upload` : `Up to date · ${timeAgo(st.lastSyncOkAt)}`}
          </div>
        </div>
        {cloudOn ? (
          <span className={st.pending ? 'warn-txt' : 'ok-txt'}>{st.pending ? '⏳' : '✓'}</span>
        ) : (
          <button className="btn btn-sm" onClick={() => navigate('/settings')}>
            Set up
          </button>
        )}
      </div>
      <div className="safety-row">
        <span className="safety-ico">🗂️</span>
        <div className="grow">
          <b>Daily cloud snapshots</b>
          <div className="small muted">{cloudOn ? (info.lastSnapshot ? `Last ${timeAgo(info.lastSnapshot)} · older ones kept` : 'First one after the next sync') : 'Needs cloud sync'}</div>
        </div>
        <span className={info.lastSnapshot ? 'ok-txt' : 'off-txt'}>{info.lastSnapshot ? '✓' : '–'}</span>
      </div>
      <div className="safety-row">
        <span className="safety-ico">💾</span>
        <div className="grow">
          <b>Backup file (iCloud Drive / Files)</b>
          <div className="small muted">{info.lastBackup ? `Last ${timeAgo(info.lastBackup)}` : 'Never'}</div>
        </div>
        <button className={`btn btn-sm ${fileStale ? 'btn-primary' : ''}`} onClick={() => backupToFiles().catch((e) => alert(e.message))} data-testid="safety-backup">
          Save now
        </button>
      </div>
      <div className="safety-row">
        <span className="safety-ico">📊</span>
        <div className="grow">
          <b>Excel copy (with photos)</b>
          <div className="small muted">{info.lastExcel ? `Last ${timeAgo(info.lastExcel)}` : 'Never'} · one row per supplier</div>
        </div>
        <button className="btn btn-sm" onClick={() => excelToFiles((m) => toast(m)).catch((e) => alert(e.message))} data-testid="safety-excel">
          Excel
        </button>
      </div>
      <div className="safety-row">
        <span className="safety-ico">🖼️</span>
        <div className="grow">
          <b>iPhone Photos</b>
          <div className="small muted">{info.unsaved ? `${info.unsaved} photo(s) not saved to Photos yet` : 'All photos saved to Photos'}</div>
        </div>
        {info.unsaved ? (
          <button className="btn btn-sm btn-primary" onClick={async () => openSaveToPhotos(await unsavedPhotoIds())} data-testid="safety-photos">
            Save
          </button>
        ) : (
          <span className="ok-txt">✓</span>
        )}
      </div>
    </Section>
  );
}
