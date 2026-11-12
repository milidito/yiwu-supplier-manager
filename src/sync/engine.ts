import {
  type AppDB,
  type Photo,
  type Supplier,
  type SyncTable,
  SYNC_TABLES,
  getMeta,
  nowIso,
  setMeta,
} from '../db';
import { thumbFromFull } from '../images';
import { formatCode, getSettings, parseCodeNumber } from '../repo';
import { type Remote, type RemoteRow, fromRemote, photoPath, toRemote } from './remote';

/**
 * Sync algorithm (runs on demand / when online):
 *
 *  1. PULL   for each table, fetch rows changed on the server since our cursor (minus a 2-minute overlap
 *            window so no row is missed due to transaction timing). Merge each row:
 *              - not present locally            -> insert
 *              - local copy has no pending edits -> overwrite with server copy
 *              - local copy has pending edits:
 *                  - server copy unchanged since our last sync (updated_at == baseUpdatedAt) -> keep local
 *                  - both changed -> CONFLICT: the most recent edit (updated_at) wins,
 *                    the losing version is saved in the Conflicts list for manual review.
 *            Supplier-code collisions (two devices both created YW-015 offline) are fixed on the
 *            not-yet-synced local record, which gets the next free code; this is logged.
 *  2. PHOTOS upload local image files (path = <userId>/<photoId>.jpg, overwrite allowed -> retry-safe).
 *            Deletions are soft: files of deleted photos stay in the cloud and on the phone (restorable).
 *  3. PUSH   upsert all records with pending edits (keyed by UUID -> retries never duplicate).
 *            A record edited while the push was in flight stays pending and is pushed next time.
 *  4. FETCH  download images that exist only in the cloud (e.g. taken on another device).
 *
 * Every step is idempotent, so an interrupted sync can simply be run again.
 */

export const PULL_OVERLAP_MS = 2 * 60 * 1000;
const PUSH_BATCH = 50;
const DOWNLOAD_BATCH = 40;
/** per sync run; remaining photos continue in the next run a few seconds later */
const DOWNLOAD_TIME_BUDGET_MS = 90_000;

export interface SyncResult {
  ok: boolean;
  pulled: number;
  pushed: number;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
  /** photos that exist only in the cloud and still need downloading (e.g. after installing on a new phone) */
  morePhotos?: number;
}

type Local = Record<string, unknown> & { id: string; updatedAt: string; dirty: 0 | 1; baseUpdatedAt?: string | null };

export class SyncEngine {
  private running: Promise<SyncResult> | null = null;

  constructor(
    private db: AppDB,
    private remote: Remote,
  ) {}

  /** Concurrent calls share the same in-flight run. */
  sync(): Promise<SyncResult> {
    if (!this.running) {
      this.running = this.runOnce().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async log(level: 'info' | 'warn' | 'error', message: string) {
    await this.db.syncLog.add({ at: nowIso(), level, message });
    // keep the log small
    const count = await this.db.syncLog.count();
    if (count > 300) {
      const old = await this.db.syncLog.orderBy('id').limit(count - 300).primaryKeys();
      await this.db.syncLog.bulkDelete(old);
    }
  }

  private async runOnce(): Promise<SyncResult> {
    const res: SyncResult = { ok: true, pulled: 0, pushed: 0, uploaded: 0, downloaded: 0, conflicts: 0, errors: [] };
    const userId = await this.remote.getUserId();
    if (!userId) {
      res.ok = false;
      res.errors.push('Not signed in to cloud');
      return res;
    }
    const lastUser = await getMeta<string | null>(this.db, 'syncUserId', null);
    if (lastUser && lastUser !== userId) {
      // Different account than before: re-pull everything for this account.
      for (const t of SYNC_TABLES) await setMeta(this.db, `cursor:${t}`, null);
      await this.log('warn', 'Signed in with a different cloud account; doing a full re-sync.');
    }
    await setMeta(this.db, 'syncUserId', userId);

    // 1. PULL
    for (const table of SYNC_TABLES) {
      try {
        const n = await this.pullTable(table, res);
        res.pulled += n;
      } catch (e) {
        res.ok = false;
        res.errors.push(`Download ${table}: ${msg(e)}`);
      }
    }
    // If pull failed, pushing could overwrite newer cloud edits; stop here and retry later.
    if (!res.ok) {
      await this.log('error', `Sync stopped: ${res.errors.join('; ')}`);
      return res;
    }

    // 2. PHOTO FILES
    try {
      res.uploaded += await this.uploadPhotoFiles(userId, res);
    } catch (e) {
      res.ok = false;
      res.errors.push(`Photo upload: ${msg(e)}`);
    }

    // 3. PUSH
    for (const table of SYNC_TABLES) {
      try {
        res.pushed += await this.pushTable(table, userId);
      } catch (e) {
        res.ok = false;
        res.errors.push(`Upload ${table}: ${msg(e)}`);
        // keep going with other tables; failed rows stay pending
      }
    }

    // 4. DOWNLOAD photos created on other devices
    try {
      res.downloaded += await this.downloadMissingPhotos(userId, res);
    } catch (e) {
      res.errors.push(`Photo download: ${msg(e)}`);
      res.ok = false;
    }

    await setMeta(this.db, 'lastSyncAt', nowIso());
    if (res.ok) {
      await setMeta(this.db, 'lastSyncOkAt', nowIso());
      if (res.pulled || res.pushed || res.uploaded || res.downloaded)
        await this.log(
          'info',
          `Synced: ${res.pushed} sent, ${res.uploaded} photos uploaded, ${res.pulled} received, ${res.downloaded} photos downloaded.`,
        );
    } else {
      await this.log('error', res.errors.join('; '));
    }
    return res;
  }

  // ---------------- PULL ----------------
  private async pullTable(table: SyncTable, res: SyncResult): Promise<number> {
    const cursor = await getMeta<string | null>(this.db, `cursor:${table}`, null);
    const since = cursor ? new Date(new Date(cursor).getTime() - PULL_OVERLAP_MS).toISOString() : null;
    const rows = await this.remote.pull(table, since);
    let maxCursor = cursor;
    let changed = 0;
    for (const row of rows) {
      const did = await this.mergeRow(table, row, res);
      if (did) changed++;
      if (!maxCursor || new Date(row.server_updated_at) > new Date(maxCursor)) maxCursor = row.server_updated_at;
    }
    if (maxCursor !== cursor) await setMeta(this.db, `cursor:${table}`, maxCursor);
    return changed;
  }

  private tableOf(table: SyncTable) {
    return this.db[table] as unknown as import('dexie').Table<Local, string>;
  }

  /** returns true if the local DB changed */
  private async mergeRow(table: SyncTable, row: RemoteRow, res: SyncResult): Promise<boolean> {
    const incoming = fromRemote(table, row) as Local;
    const t = this.tableOf(table);
    const scope = [...new Set([t, this.db.conflicts, this.db.suppliers, this.db.photos, this.db.photoBlobs, this.db.meta, this.db.syncLog])];
    return this.db.transaction('rw', scope, async () => {
      const local = await t.get(row.id);
      const syncedFields = { dirty: 0 as const, baseUpdatedAt: incoming.updatedAt, syncedAt: nowIso() };

      if (!local) {
        const rec: Local = { ...incoming, ...syncedFields };
        if (table === 'photos') (rec as unknown as Photo).blobState = 'remote_only';
        if (table === 'suppliers') await this.fixCodeCollision(rec as unknown as Supplier);
        await t.add(rec);
        return true;
      }

      if (local.updatedAt === incoming.updatedAt && !local.dirty) return false; // already have it

      const preserve =
        table === 'photos'
          ? { blobState: (local as unknown as Photo).blobState, savedToDevice: (local as unknown as Photo).savedToDevice }
          : {};

      if (!local.dirty) {
        await t.put({ ...local, ...incoming, ...syncedFields, ...preserve });
        if (table === 'suppliers') await this.fixCodeCollision({ ...local, ...incoming } as unknown as Supplier);
        return true;
      }

      // local has pending edits
      if (local.baseUpdatedAt && local.baseUpdatedAt === incoming.updatedAt) {
        return false; // server unchanged since our last sync; our pending edit will be pushed
      }

      // True conflict: both sides changed. Most recent edit wins; keep the loser for review.
      const remoteWins = incoming.updatedAt > local.updatedAt;
      const label = conflictLabel(table, { ...local, ...incoming });
      await this.db.conflicts.add({
        at: nowIso(),
        table,
        recordId: row.id,
        label,
        kept: remoteWins ? 'remote' : 'local',
        discarded: remoteWins ? stripLocal(local) : incoming,
        reviewed: 0,
      });
      res.conflicts++;
      if (remoteWins) {
        await t.put({ ...local, ...incoming, ...syncedFields, ...preserve });
      } else {
        // keep local values but remember the server version we have now seen,
        // so the next push simply overwrites it.
        await t.update(row.id, { baseUpdatedAt: incoming.updatedAt } as Partial<Local>);
      }
      await this.db.syncLog.add({
        at: nowIso(),
        level: 'warn',
        message: `Conflict on ${label}: kept ${remoteWins ? 'cloud' : 'this device'} version (newer edit). The other version is saved under Conflicts.`,
      });
      return remoteWins;
    });
  }

  /** If another supplier already uses this code, renumber the record that has never been synced. */
  private async fixCodeCollision(incoming: Supplier) {
    if (incoming.deleted) return;
    const clashes = await this.db.suppliers
      .where('code')
      .equals(incoming.code)
      .filter((s) => s.id !== incoming.id && !s.deleted)
      .toArray();
    for (const other of clashes) {
      if (other.syncedAt) continue; // both synced: leave it, user can edit the code manually
      const { codePrefix } = await getSettings(this.db);
      let max = 0;
      await this.db.suppliers.each((s) => {
        const n = parseCodeNumber(s.code, codePrefix);
        if (n !== null && n > max) max = n;
      });
      const n2 = parseCodeNumber(incoming.code, codePrefix);
      if (n2 !== null && n2 > max) max = n2;
      const newCode = formatCode(codePrefix, max + 1);
      await this.db.suppliers.update(other.id, { code: newCode, updatedAt: nowIso(), dirty: 1 });
      await this.db.syncLog.add({
        at: nowIso(),
        level: 'warn',
        message: `Supplier code ${incoming.code} was already used on another device. "${other.companyName || 'unnamed'}" on this device was renumbered to ${newCode}.`,
      });
    }
  }

  // ---------------- PHOTO FILES ----------------
  private async uploadPhotoFiles(userId: string, res: SyncResult): Promise<number> {
    let n = 0;
    const toUpload = await this.db.photos.where('blobState').equals('local').filter((p) => !p.deleted).toArray();
    for (const ph of toUpload) {
      const blob = await this.db.photoBlobs.get(ph.id);
      if (!blob) {
        await this.db.photos.update(ph.id, { uploadError: 'Image file missing on this device' });
        continue;
      }
      try {
        await this.remote.uploadPhoto(photoPath(userId, ph.id), blob.full, ph.mime || 'image/jpeg');
        await this.db.photos.update(ph.id, { blobState: 'uploaded', uploadError: null });
        n++;
      } catch (e) {
        res.ok = false;
        res.errors.push(`Photo ${ph.id.slice(0, 8)}: ${msg(e)}`);
        await this.db.photos.update(ph.id, { uploadError: msg(e) });
      }
    }
    // Note: files of deleted photos are deliberately NOT removed from the cloud,
    // so anything deleted by mistake can be restored (Trash / snapshots).
    return n;
  }

  // ---------------- PUSH ----------------
  private async pushTable(table: SyncTable, userId: string): Promise<number> {
    const t = this.tableOf(table);
    let dirty = await t.where('dirty').equals(1).toArray();
    if (table === 'photos') {
      // only publish photo metadata once its image file is in the cloud (or it was deleted)
      dirty = dirty.filter((p) => (p as unknown as Photo).blobState !== 'local' || p.deleted);
    }
    let pushed = 0;
    for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
      const batch = dirty.slice(i, i + PUSH_BATCH);
      await this.remote.push(
        table,
        batch.map((r) => toRemote(table, r as never, userId)),
      );
      const syncedAt = nowIso();
      await this.db.transaction('rw', t, async () => {
        for (const r of batch) {
          const cur = await t.get(r.id);
          // only clear "pending" if the record wasn't edited again while we were uploading
          if (cur && cur.updatedAt === r.updatedAt) {
            await t.update(r.id, { dirty: 0, baseUpdatedAt: r.updatedAt, syncedAt } as Partial<Local>);
          } else if (cur) {
            await t.update(r.id, { baseUpdatedAt: r.updatedAt, syncedAt } as Partial<Local>);
          }
        }
      });
      pushed += batch.length;
    }
    return pushed;
  }

  // ---------------- DOWNLOAD ----------------
  private async downloadMissingPhotos(userId: string, res?: SyncResult): Promise<number> {
    const started = Date.now();
    let n = 0;
    const errors: string[] = [];
    const failed = new Set<string>();
    while (Date.now() - started < DOWNLOAD_TIME_BUDGET_MS) {
      const batch = await this.db.photos
        .where('blobState')
        .equals('remote_only')
        .filter((p) => !p.deleted && !failed.has(p.id))
        .limit(DOWNLOAD_BATCH)
        .toArray();
      if (!batch.length) break;
      for (const ph of batch) {
        try {
          const full = await this.remote.downloadPhoto(photoPath(userId, ph.id));
          const thumb = await thumbFromFull(full);
          await this.db.transaction('rw', this.db.photos, this.db.photoBlobs, async () => {
            await this.db.photoBlobs.put({ id: ph.id, full, thumb });
            await this.db.photos.update(ph.id, { blobState: 'uploaded', uploadError: null });
          });
          n++;
        } catch (e) {
          failed.add(ph.id);
          errors.push(msg(e));
          await this.db.photos.update(ph.id, { uploadError: `Download failed: ${msg(e)}` });
        }
        if (Date.now() - started >= DOWNLOAD_TIME_BUDGET_MS) break;
      }
    }
    if (res) res.morePhotos = await this.db.photos.where('blobState').equals('remote_only').filter((p) => !p.deleted && !failed.has(p.id)).count();
    if (errors.length) throw new Error(`${errors.length} photo(s) could not be downloaded (${errors[0]})`);
    return n;
  }
}

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

function stripLocal(r: Local) {
  const { dirty, baseUpdatedAt, syncedAt, blobState, uploadError, ...rest } = r as Record<string, unknown>;
  return rest;
}

function conflictLabel(table: SyncTable, r: Record<string, unknown>): string {
  if (table === 'suppliers') return `supplier ${r.code ?? ''} ${r.companyName ?? ''}`.trim();
  if (table === 'products') return `product "${r.name ?? ''}"`;
  if (table === 'quotations') return `quotation ${r.price ?? ''} ${r.currency ?? ''}`;
  return `photo ${String(r.id).slice(0, 8)}`;
}
