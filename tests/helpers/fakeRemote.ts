import type { SyncTable } from '../../src/db';
import type { Remote, RemoteRow } from '../../src/sync/remote';

/** In-memory stand-in for the cloud, with failure injection. Shared "server" can serve several devices. */
export class FakeServer {
  tables: Record<SyncTable, Map<string, RemoteRow & { user_id: string }>> = {
    suppliers: new Map(), products: new Map(), quotations: new Map(), photos: new Map(),
  };
  files = new Map<string, Blob>();
  clock = Date.parse('2026-01-01T00:00:00Z');
  uploads = 0;
  tick() { this.clock += 1000; return new Date(this.clock).toISOString(); }
}

export class FakeRemote implements Remote {
  failPushOnce = 0;
  failUploadTimes = 0;
  failPull = false;
  pushCalls = 0;
  constructor(public server: FakeServer, public userId: string | null = 'user-a') {}
  async getUserId() { return this.userId; }
  async pull(table: SyncTable, since: string | null) {
    if (this.failPull) throw new Error('network down');
    return [...this.server.tables[table].values()]
      .filter((r) => r.user_id === this.userId && (!since || r.server_updated_at > since))
      .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at))
      .map((r) => ({ ...r }));
  }
  async push(table: SyncTable, rows: Record<string, unknown>[]) {
    this.pushCalls++;
    if (this.failPushOnce > 0) { this.failPushOnce--; throw new Error('timeout'); }
    for (const r of rows) {
      const existing = this.server.tables[table].get(r.id as string);
      if (existing && existing.user_id !== this.userId) throw new Error('RLS violation');
      this.server.tables[table].set(r.id as string, { ...(r as RemoteRow), user_id: this.userId!, server_updated_at: this.server.tick() });
    }
  }
  async uploadPhoto(path: string, blob: Blob) {
    if (this.failUploadTimes > 0) { this.failUploadTimes--; throw new Error('upload interrupted'); }
    this.server.uploads++;
    this.server.files.set(path, blob);
  }
  async downloadPhoto(path: string) {
    const b = this.server.files.get(path);
    if (!b) throw new Error('not found');
    return b;
  }
  async deletePhoto(path: string) { this.server.files.delete(path); }
  async uploadFile(path: string, blob: Blob) { this.server.files.set(path, blob); }
  async downloadFile(path: string) { return this.downloadPhoto(path); }
  async listFiles(folder: string) {
    return [...this.server.files.entries()]
      .filter(([k]) => k.startsWith(folder + '/') && !k.slice(folder.length + 1).includes('/'))
      .map(([k, b]) => ({ name: k.slice(folder.length + 1), size: b.size, createdAt: null }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }
}
