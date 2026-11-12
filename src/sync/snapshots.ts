import { exportBackup, importBackup, type ImportResult } from '../backup';
import { type AppDB, getMeta, nowIso, setMeta } from '../db';
import type { Remote } from './remote';

/**
 * Daily versioned backups in the cloud.
 *
 * Sync mirrors your data — including mistakes (a wrong edit or a delete reaches the cloud too).
 * Snapshots are point-in-time copies that are never overwritten: once a day after a successful sync,
 * the app uploads <userId>/backups/<UTC time>.zip (all records as JSON + CSV, ~KB–MB; photos are
 * already kept in the cloud and are never deleted there). Any snapshot can be restored later.
 */

export const SNAPSHOT_EVERY_MS = 20 * 60 * 60 * 1000; // at most ~once a day

export function backupFolder(userId: string) {
  return `${userId}/backups`;
}

export async function maybeSnapshot(db: AppDB, remote: Remote, userId: string, force = false): Promise<string | null> {
  const last = await getMeta<string | null>(db, `lastSnapshotAt:${userId}`, null);
  if (!force && last && Date.now() - new Date(last).getTime() < SNAPSHOT_EVERY_MS) return null;
  const supplierCount = await db.suppliers.count();
  if (!supplierCount) return null;
  const { blob, counts } = await exportBackup(db, false);
  const name = `${nowIso().replace(/[:.]/g, '-')}.zip`;
  await remote.uploadFile(`${backupFolder(userId)}/${name}`, blob, 'application/zip');
  await setMeta(db, `lastSnapshotAt:${userId}`, nowIso());
  await db.syncLog.add({
    at: nowIso(),
    level: 'info',
    message: `Cloud snapshot saved (${counts.suppliers} suppliers, ${counts.quotations} quotes, ${(blob.size / 1024).toFixed(0)} KB).`,
  });
  return name;
}

export async function listSnapshots(remote: Remote, userId: string) {
  const files = await remote.listFiles(backupFolder(userId));
  return files.filter((f) => f.name.endsWith('.zip')).sort((a, b) => b.name.localeCompare(a.name));
}

/** Snapshot file name "2026-12-05T10-22-31-123Z.zip" -> Date */
export function snapshotDate(name: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : null;
}

/** Brings back everything in the snapshot that is missing or was deleted since; keeps newer edits. */
export async function restoreSnapshot(db: AppDB, remote: Remote, userId: string, name: string): Promise<ImportResult> {
  const blob = await remote.downloadFile(`${backupFolder(userId)}/${name}`);
  const res = await importBackup(blob, db, { undelete: true });
  await db.syncLog.add({ at: nowIso(), level: 'info', message: `Restored cloud snapshot ${name}: ${res.added} added, ${res.restored} restored, ${res.updated} updated.` });
  return res;
}
