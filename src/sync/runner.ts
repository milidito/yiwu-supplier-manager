import { db, getMeta, setMeta } from '../db';
import { onLocalChange, pendingCount } from '../repo';
import { SyncEngine, type SyncResult } from './engine';
import { maybeSnapshot } from './snapshots';
import { SupabaseRemote } from './supabaseRemote';

/**
 * Decides WHEN to sync, and exposes a status for the UI.
 *
 * Triggers (all are best-effort; none needs the OS-level Background Sync API):
 *  - app start / app brought back to the foreground
 *  - the browser reports it is back online
 *  - a few seconds after any local edit
 *  - every 60 s while the app is open and there are pending changes (every 5 min otherwise)
 *  - the manual "Sync now" button
 * Failed syncs back off: 30 s, 1 min, 2 min, 5 min (max).
 *
 * iPhone Safari does not support background sync: changes are uploaded the next time the app is open
 * and online. Android Chrome behaves the same in this app (we deliberately don't rely on Background Sync).
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export type SyncState = 'local_only' | 'signed_out' | 'offline' | 'syncing' | 'synced' | 'pending' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncOkAt: string | null;
  lastError: string | null;
  email: string | null;
  /** photos still downloading from the cloud (new phone / reinstall) */
  downloading: number;
}

type Listener = (s: SyncStatus) => void;

class Runner {
  remote: SupabaseRemote | null = null;
  private engine: SyncEngine | null = null;
  private listeners = new Set<Listener>();
  private status: SyncStatus = { state: 'local_only', pending: 0, lastSyncOkAt: null, lastError: null, email: null, downloading: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private started = false;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.status);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getStatus() {
    return this.status;
  }

  private set(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p };
    this.listeners.forEach((fn) => fn(this.status));
  }

  /**
   * The deploy build can carry the owner's project URL + publishable key (both public by design;
   * data is protected by sign-in + Row Level Security). A fresh install on a new phone is then
   * already pointed at the right project: just sign in. "Disconnect" stores null and overrides it.
   */
  async getConfig(): Promise<CloudConfig | null> {
    const row = await db.meta.get('cloudConfig');
    if (row !== undefined) return row.value as CloudConfig | null;
    const url = import.meta.env.VITE_DEFAULT_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_DEFAULT_SUPABASE_KEY as string | undefined;
    return url && anonKey ? { url, anonKey } : null;
  }

  async saveConfig(cfg: CloudConfig | null) {
    await setMeta(db, 'cloudConfig', cfg);
    await this.initRemote();
    await this.refresh();
  }

  private async initRemote() {
    const cfg = await this.getConfig();
    if (this.remote) {
      this.remote = null;
      this.engine = null;
    }
    if (cfg?.url && cfg?.anonKey) {
      this.remote = SupabaseRemote.create(cfg.url, cfg.anonKey);
      this.engine = new SyncEngine(db, this.remote);
      this.remote.client.auth.onAuthStateChange(() => {
        void this.refresh();
      });
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.initRemote();
    window.addEventListener('online', () => this.kick(500));
    window.addEventListener('offline', () => void this.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.kick(500);
    });
    onLocalChange(() => {
      void this.refresh();
      this.kick(4000);
    });
    await this.refresh();
    this.kick(1500);
  }

  /** schedule a sync attempt after `ms` */
  kick(ms = 0) {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), ms);
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    let ms: number;
    if (this.failures > 0) ms = [30_000, 60_000, 120_000, 300_000][Math.min(this.failures - 1, 3)];
    else ms = this.status.pending > 0 ? 60_000 : 300_000;
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  async refresh() {
    const pending = await pendingCount(db);
    const downloading = await db.photos.where('blobState').equals('remote_only').filter((p) => !p.deleted).count();
    const lastSyncOkAt = await getMeta<string | null>(db, 'lastSyncOkAt', null);
    let email: string | null = null;
    let state: SyncState;
    if (!this.remote) state = 'local_only';
    else if (!navigator.onLine) {
      state = 'offline';
      email = this.status.email;
    } else {
      const { data } = await this.remote.client.auth.getSession();
      email = data.session?.user?.email ?? null;
      if (!data.session) state = 'signed_out';
      else if (this.status.state === 'syncing') state = 'syncing';
      else if (this.status.state === 'error' && this.status.lastError) state = 'error';
      else state = pending > 0 ? 'pending' : 'synced';
    }
    this.set({ pending, lastSyncOkAt, email, state, downloading });
  }

  async syncNow(): Promise<SyncResult | null> {
    await this.refresh();
    if (!this.engine || !this.remote) return null;
    if (this.status.state === 'signed_out') return null;
    if (!navigator.onLine) {
      this.schedule();
      return null;
    }
    this.set({ state: 'syncing' });
    let res: SyncResult | null = null;
    try {
      res = await this.engine.sync();
      if (res.ok) {
        this.failures = 0;
        this.set({ state: 'synced', lastError: null });
        // daily point-in-time backup in the cloud (never overwritten)
        try {
          const uid = await this.remote.getUserId();
          if (uid) await maybeSnapshot(db, this.remote, uid);
        } catch (e) {
          await db.syncLog.add({ at: new Date().toISOString(), level: 'warn', message: `Cloud snapshot failed (will retry): ${e instanceof Error ? e.message : String(e)}` });
        }
      } else {
        this.failures++;
        this.set({ state: 'error', lastError: res.errors.join('; ') || 'Sync failed' });
      }
    } catch (e) {
      this.failures++;
      this.set({ state: 'error', lastError: e instanceof Error ? e.message : String(e) });
    }
    const keepError = this.status.state === 'error';
    await this.refresh();
    if (keepError && this.status.state !== 'error') this.set({ state: 'error' });
    this.schedule();
    // more cloud photos to fetch (e.g. first sign-in on a new phone): continue soon
    if (res?.morePhotos) this.kick(3000);
    return res;
  }

  clearError() {
    this.failures = 0;
    this.set({ lastError: null, state: 'pending' });
  }
}

export const syncRunner = new Runner();
