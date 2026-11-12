import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SyncTable } from '../db';
import type { Remote, RemoteRow } from './remote';

export const PHOTO_BUCKET = 'supplier-photos';
const PAGE = 500;

/**
 * Supabase implementation of the Remote interface.
 * Uses only the public "anon"/publishable key + the signed-in user's session.
 * Data isolation is enforced server-side by Row Level Security (see supabase/schema.sql).
 */
export class SupabaseRemote implements Remote {
  constructor(public readonly client: SupabaseClient) {}

  static create(url: string, anonKey: string, storageKey = 'yiwu-sb-auth') {
    const client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey },
    });
    return new SupabaseRemote(client);
  }

  async getUserId(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.user?.id ?? null;
  }

  async pull(table: SyncTable, sinceIso: string | null): Promise<RemoteRow[]> {
    const out: RemoteRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let q = this.client
        .from(table)
        .select('*')
        .order('server_updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (sinceIso) q = q.gt('server_updated_at', sinceIso);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as RemoteRow[]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async push(table: SyncTable, rows: Record<string, unknown>[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  async uploadPhoto(path: string, blob: Blob, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(PHOTO_BUCKET).upload(path, blob, { upsert: true, contentType });
    if (error) throw new Error(error.message);
  }

  async downloadPhoto(path: string): Promise<Blob> {
    const { data, error } = await this.client.storage.from(PHOTO_BUCKET).download(path);
    if (error || !data) throw new Error(error?.message || 'download failed');
    return data;
  }

  async uploadFile(path: string, blob: Blob, contentType: string): Promise<void> {
    return this.uploadPhoto(path, blob, contentType);
  }

  async downloadFile(path: string): Promise<Blob> {
    return this.downloadPhoto(path);
  }

  async listFiles(folder: string) {
    const { data, error } = await this.client.storage
      .from(PHOTO_BUCKET)
      .list(folder, { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((f) => f.id) // folders have no id
      .map((f) => ({
        name: f.name,
        size: (f.metadata as { size?: number } | null)?.size ?? null,
        createdAt: f.created_at ?? null,
      }));
  }

  async deletePhoto(path: string): Promise<void> {
    const { error } = await this.client.storage.from(PHOTO_BUCKET).remove([path]);
    if (error) throw new Error(error.message);
  }
}
