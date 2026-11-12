import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { AppDB } from '../../src/db';
import * as repo from '../../src/repo';
import { SyncEngine } from '../../src/sync/engine';
import { SupabaseRemote } from '../../src/sync/supabaseRemote';
import { listSnapshots, maybeSnapshot, restoreSnapshot } from '../../src/sync/snapshots';

/**
 * Runs only via `npm run test:integration` (tests/integration/run.sh), which starts
 * Postgres + PostgREST + a local gateway on :54321 and applies supabase/schema.sql.
 */
const ON = !!process.env.YSM_INTEGRATION;
const URL = 'http://127.0.0.1:54321';
const ANON = 'local-anon-key-not-a-secret-0000000000';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';

function sql(q: string): string {
  return execSync(`su postgres -c "psql -d ${process.env.YSM_DB} -Atc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
}
let k = 0;
async function device(email: string, pw: string) {
  const remote = SupabaseRemote.create(URL, ANON, `sb-test-${++k}`);
  const { error } = await remote.client.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  const db = new AppDB(`int-${k}-${Math.random()}`);
  return { db, remote, engine: new SyncEngine(db, remote) };
}
const img = (s: string) => ({ full: new Blob([s.repeat(500)], { type: 'image/jpeg' }), thumb: new Blob([s], { type: 'image/jpeg' }), width: 1600, height: 1200, mime: 'image/jpeg' });
const files = async () => (await (await fetch(`${URL}/__files`)).json()) as string[];

describe.skipIf(!ON)('Supabase integration (Postgres + PostgREST + RLS + supabase-js)', () => {
  it('full round trip across two phones, idempotent retries, RLS isolation, conflicts and deletes', async () => {
    // ---- phone 1 captures offline-style data, then syncs ----
    const p1 = await device('milad@example.com', 'pass-milad-123');
    const s = await repo.createSupplier({ companyName: '义乌华亿', wechatId: 'huayi88', district: 'District 2', floor: '3', booth: '23315', rating: 4, followUpDate: '2026-12-10' }, p1.db);
    const prod = await repo.createProduct({ supplierId: s.id, name: 'Phone case', category: 'Cases' }, p1.db);
    await repo.createQuotation({ supplierId: s.id, productId: prod.id, price: 6.5, currency: 'CNY', unit: 'piece', moq: 500, tierQty: 1000 }, p1.db);
    const ph1 = await repo.addPhoto({ supplierId: s.id, kind: 'card_front', file: new Blob(['x']) }, p1.db, img('a'));
    await repo.addPhoto({ supplierId: s.id, kind: 'product', productId: prod.id, file: new Blob(['x']) }, p1.db, img('b'));

    const r1 = await p1.engine.sync();
    expect(r1.errors).toEqual([]);
    expect(r1.ok).toBe(true);
    expect(await repo.pendingCount(p1.db)).toBe(0);
    expect(sql(`select code||'|'||company_name||'|'||user_id||'|'||rating||'|'||follow_up_date from suppliers`)).toBe(`YW-001|义乌华亿|${A}|4|2026-12-10`);
    expect(sql(`select price||'|'||currency||'|'||unit||'|'||moq||'|'||tier_qty from quotations`)).toBe('6.5000|CNY|piece|500|1000');
    expect(sql('select count(*) from photos')).toBe('2');
    expect((await files()).filter((f) => f.startsWith(`${A}/`))).toHaveLength(2);

    // ---- retry: nothing duplicated ----
    const r2 = await p1.engine.sync();
    expect(r2.pushed).toBe(0);
    expect(r2.uploaded).toBe(0);
    expect(sql('select count(*) from suppliers')).toBe('1');
    expect(sql('select count(*) from photos')).toBe('2');

    // ---- phone 2, same account: receives everything incl. photo files ----
    const p2 = await device('milad@example.com', 'pass-milad-123');
    const r3 = await p2.engine.sync();
    expect(r3.ok).toBe(true);
    const s2 = await p2.db.suppliers.get(s.id);
    expect(s2?.companyName).toBe('义乌华亿');
    expect(s2?.followUpDate).toBe('2026-12-10');
    expect((await p2.db.quotations.toArray())[0].price).toBe(6.5);
    const blob = await p2.db.photoBlobs.get(ph1.id);
    expect(blob?.full.size).toBe(500);

    // ---- another account sees nothing and cannot overwrite (RLS) ----
    const other = await device('other@example.com', 'pass-other-123');
    const r4 = await other.engine.sync();
    expect(r4.ok).toBe(true);
    expect(await other.db.suppliers.count()).toBe(0);
    await expect(
      other.remote.push('suppliers', [{ id: s.id, code: 'HACK', company_name: 'x', created_at: s.createdAt, updated_at: new Date().toISOString(), deleted: false }]),
    ).rejects.toThrow();
    await expect(other.remote.downloadPhoto(`${A}/${ph1.id}.jpg`)).rejects.toThrow();
    expect(sql('select code from suppliers')).toBe('YW-001');

    // ---- anonymous (no sign-in) gets no rows ----
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: anonRows, error: anonErr } = await anon.from('suppliers').select('*');
    expect(anonErr || (anonRows ?? []).length === 0).toBeTruthy();

    // ---- conflict: both phones edit the same supplier ----
    await repo.updateSupplier(s.id, { notes: 'from phone 1' }, p1.db);
    await new Promise((r) => setTimeout(r, 10));
    await repo.updateSupplier(s.id, { notes: 'from phone 2 (newer)' }, p2.db);
    await p1.engine.sync();
    const r5 = await p2.engine.sync();
    expect(r5.conflicts).toBe(1);
    await p1.engine.sync();
    expect((await p1.db.suppliers.get(s.id))?.notes).toBe('from phone 2 (newer)');
    expect(sql('select notes from suppliers')).toBe('from phone 2 (newer)');

    // ---- daily snapshot in real (private, per-user) storage ----
    const snap = await maybeSnapshot(p1.db, p1.remote, A, true);
    expect(snap).toMatch(/\.zip$/);
    const snaps = await listSnapshots(p1.remote, A);
    expect(snaps.map((x) => x.name)).toContain(snap);
    expect(await listSnapshots(other.remote, A).catch(() => [])).toHaveLength(0); // other account can't list mine

    // ---- delete on phone 2 propagates; files are KEPT (restorable) ----
    await repo.deleteSupplier(s.id, p2.db);
    const r6 = await p2.engine.sync();
    expect(r6.ok).toBe(true);
    expect(sql('select deleted from suppliers')).toBe('t');
    expect(sql('select bool_and(deleted) from photos')).toBe('t');
    expect((await files()).filter((f) => f.startsWith(`${A}/`) && f.endsWith('.jpg'))).toHaveLength(2);
    await p1.engine.sync();
    expect((await p1.db.suppliers.get(s.id))?.deleted).toBe(1);

    // ---- restore from the cloud snapshot on phone 1 -> back everywhere ----
    const rr = await restoreSnapshot(p1.db, p1.remote, A, snap!);
    expect(rr.restored).toBeGreaterThanOrEqual(5); // supplier, product, quote, 2 photos
    expect((await p1.engine.sync()).ok).toBe(true);
    expect(sql('select deleted from suppliers')).toBe('f');
    expect(sql('select count(*) from photos where not deleted')).toBe('2');
    await p2.engine.sync();
    expect((await p2.db.suppliers.get(s.id))?.deleted).toBe(0);
  });
});
