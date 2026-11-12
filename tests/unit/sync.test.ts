import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '../../src/db';
import * as repo from '../../src/repo';
import { SyncEngine } from '../../src/sync/engine';
import { FakeRemote, FakeServer } from '../helpers/fakeRemote';

let n = 0;
function newDevice() {
  return new AppDB(`test-device-${++n}-${Math.random()}`);
}
const img = (s = 'x') => ({ full: new Blob([s.repeat(100)], { type: 'image/jpeg' }), thumb: new Blob([s], { type: 'image/jpeg' }), width: 10, height: 10, mime: 'image/jpeg' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('supplier codes & partial save', () => {
  it('generates sequential unique codes and allows empty records', async () => {
    const d = newDevice();
    const a = await repo.createSupplier({}, d);
    const b = await repo.createSupplier({ companyName: 'Jinhua Toys' }, d);
    const c = await repo.createSupplier({ wechatId: 'wx123' }, d);
    expect([a.code, b.code, c.code]).toEqual(['YW-001', 'YW-002', 'YW-003']);
    expect(a.companyName).toBe('');
    await repo.deleteSupplier(c.id, d);
    const e = await repo.createSupplier({}, d);
    expect(e.code).toBe('YW-004'); // deleted codes are never reused
    await expect(repo.changeSupplierCode(e.id, 'YW-002', d)).rejects.toThrow(/already used/);
  });

  it('counts pending changes', async () => {
    const d = newDevice();
    const s = await repo.createSupplier({}, d);
    await repo.addPhoto({ supplierId: s.id, kind: 'card_front', file: new Blob(['a']) }, d, img());
    // supplier row + photo row + photo file
    expect(await repo.pendingCount(d)).toBe(3);
  });
});

describe('sync engine', () => {
  let server: FakeServer;
  beforeEach(() => {
    server = new FakeServer();
  });

  it('does nothing when not signed in (offline-first: data stays local)', async () => {
    const d = newDevice();
    await repo.createSupplier({ companyName: 'A' }, d);
    const r = await new SyncEngine(d, new FakeRemote(server, null)).sync();
    expect(r.ok).toBe(false);
    expect(server.tables.suppliers.size).toBe(0);
    expect(await d.suppliers.where('dirty').equals(1).count()).toBe(1);
  });

  it('pushes records + photos, and retries after failures without duplicates', async () => {
    const d = newDevice();
    const remote = new FakeRemote(server);
    const eng = new SyncEngine(d, remote);
    const s = await repo.createSupplier({ companyName: 'Yiwu Bags Co', wechatId: 'bags88', district: 'District 2', floor: '3', booth: '12345' }, d);
    const p = await repo.createProduct({ supplierId: s.id, name: 'Tote bag', category: 'Bags' }, d);
    await repo.createQuotation({ supplierId: s.id, productId: p.id, price: 4.5, currency: 'CNY', unit: 'piece', moq: 500 }, d);
    await repo.addPhoto({ supplierId: s.id, kind: 'card_front', file: new Blob(['a']) }, d, img('a'));
    await repo.addPhoto({ supplierId: s.id, kind: 'product', productId: p.id, file: new Blob(['b']) }, d, img('b'));

    remote.failUploadTimes = 1; // first photo upload is interrupted
    remote.failPushOnce = 1; // and the first record upload times out
    const r1 = await eng.sync();
    expect(r1.ok).toBe(false);
    expect(await repo.pendingCount(d)).toBeGreaterThan(0);

    const r2 = await eng.sync();
    expect(r2.errors).toEqual([]);
    expect(r2.ok).toBe(true);
    expect(await repo.pendingCount(d)).toBe(0);
    expect(server.tables.suppliers.size).toBe(1);
    expect(server.tables.products.size).toBe(1);
    expect(server.tables.quotations.size).toBe(1);
    expect(server.tables.photos.size).toBe(2);
    expect(server.files.size).toBe(2);

    // A third sync re-sends nothing and creates no duplicates
    const before = server.uploads;
    const r3 = await eng.sync();
    expect(r3.pushed).toBe(0);
    expect(server.uploads).toBe(before);
    expect(server.tables.suppliers.size).toBe(1);
    const row = [...server.tables.suppliers.values()][0];
    expect(row.company_name).toBe('Yiwu Bags Co');
    expect(row.deleted).toBe(false);
  });

  it('second device receives records and downloads photos', async () => {
    const a = newDevice();
    const b = newDevice();
    const s = await repo.createSupplier({ companyName: 'Toy King' }, a);
    await repo.addPhoto({ supplierId: s.id, kind: 'shop', file: new Blob(['s']) }, a, img('s'));
    await new SyncEngine(a, new FakeRemote(server)).sync();

    const rb = await new SyncEngine(b, new FakeRemote(server)).sync();
    expect(rb.ok).toBe(true);
    const sb = await b.suppliers.get(s.id);
    expect(sb?.companyName).toBe('Toy King');
    expect(sb?.code).toBe('YW-001');
    expect(sb?.dirty).toBe(0);
    const phb = await b.photos.where('supplierId').equals(s.id).first();
    expect(phb?.blobState).toBe('uploaded');
    expect(await b.photoBlobs.get(phb!.id)).toBeTruthy();
  });

  it('other accounts never see my data', async () => {
    const a = newDevice();
    await repo.createSupplier({ companyName: 'Secret supplier' }, a);
    await new SyncEngine(a, new FakeRemote(server, 'user-a')).sync();
    const other = newDevice();
    await new SyncEngine(other, new FakeRemote(server, 'user-b')).sync();
    expect(await other.suppliers.count()).toBe(0);
  });

  it('resolves a two-device edit conflict with last-write-wins and keeps the losing version', async () => {
    const a = newDevice();
    const b = newDevice();
    const ea = new SyncEngine(a, new FakeRemote(server));
    const eb = new SyncEngine(b, new FakeRemote(server));
    const s = await repo.createSupplier({ companyName: 'Original' }, a);
    await ea.sync();
    await eb.sync();

    await repo.updateSupplier(s.id, { notes: 'edited on A' }, a);
    await sleep(5);
    await repo.updateSupplier(s.id, { notes: 'edited on B (later)' }, b);
    await ea.sync(); // A uploads first
    const rb = await eb.sync(); // B sees A's change, both changed -> conflict, B's edit is newer
    expect(rb.conflicts).toBe(1);
    expect((await b.suppliers.get(s.id))?.notes).toBe('edited on B (later)');
    const c = await b.conflicts.toArray();
    expect(c[0].kept).toBe('local');
    expect((c[0].discarded as { notes: string }).notes).toBe('edited on A');

    await ea.sync();
    expect((await a.suppliers.get(s.id))?.notes).toBe('edited on B (later)');
  });

  it('non-conflicting edits from another device are applied', async () => {
    const a = newDevice();
    const b = newDevice();
    const ea = new SyncEngine(a, new FakeRemote(server));
    const eb = new SyncEngine(b, new FakeRemote(server));
    const s = await repo.createSupplier({ companyName: 'X' }, a);
    await ea.sync();
    await eb.sync();
    await repo.updateSupplier(s.id, { status: 'quoted' }, b);
    await eb.sync();
    const ra = await ea.sync();
    expect(ra.conflicts).toBe(0);
    expect((await a.suppliers.get(s.id))?.status).toBe('quoted');
  });

  it('renumbers a colliding supplier code created offline on a second device', async () => {
    const a = newDevice();
    const b = newDevice();
    await repo.createSupplier({ companyName: 'From A' }, a);
    await repo.createSupplier({ companyName: 'From B' }, b);
    await new SyncEngine(a, new FakeRemote(server)).sync();
    await new SyncEngine(b, new FakeRemote(server)).sync();
    const codes = (await b.suppliers.toArray()).map((s) => `${s.code}:${s.companyName}`).sort();
    expect(codes).toEqual(['YW-001:From A', 'YW-002:From B']);
    const log = await b.syncLog.toArray();
    expect(log.some((l) => l.message.includes('renumbered to YW-002'))).toBe(true);
  });

  it('propagates deletes and removes cloud photo files', async () => {
    const a = newDevice();
    const b = newDevice();
    const ea = new SyncEngine(a, new FakeRemote(server));
    const eb = new SyncEngine(b, new FakeRemote(server));
    const s = await repo.createSupplier({ companyName: 'Del' }, a);
    const ph = await repo.addPhoto({ supplierId: s.id, kind: 'shop', file: new Blob(['x']) }, a, img());
    await ea.sync();
    await eb.sync();
    expect(server.files.size).toBe(1);
    await repo.deleteSupplier(s.id, a);
    await ea.sync();
    expect(server.files.size).toBe(0);
    expect(server.tables.suppliers.get(s.id)?.deleted).toBe(true);
    await eb.sync();
    expect((await b.suppliers.get(s.id))?.deleted).toBe(1);
    expect(await b.photoBlobs.get(ph.id)).toBeUndefined();
  });

  it('does not push if download failed (protects newer cloud data)', async () => {
    const d = newDevice();
    const remote = new FakeRemote(server);
    await repo.createSupplier({ companyName: 'A' }, d);
    remote.failPull = true;
    const r = await new SyncEngine(d, remote).sync();
    expect(r.ok).toBe(false);
    expect(remote.pushCalls).toBe(0);
  });
});
