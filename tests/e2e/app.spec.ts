import { expect, type Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.resolve('tests/fixtures', n);
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

async function fresh(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('dash-add')).toBeVisible();
}

async function fillField(page: Page, name: string, value: string) {
  await page.locator(`[name="${name}"]`).fill(value);
}

test('fast capture: photo-first partial save, sequential IDs, products, search, compare', async ({ page }) => {
  await fresh(page);
  await shot(page, '01-dashboard-empty');

  // --- Supplier 1: start with a photo only (partial record) ---
  await page.getByTestId('nav-add').click();
  await expect(page.getByTestId('supplier-code')).toContainText('YW-001');
  await expect(page.getByTestId('save-state')).toContainText('Not saved yet');
  await page.getByTestId('capture-shop-input').setInputFiles(fx('shop.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await page.getByTestId('capture-card_front-input').setInputFiles(fx('card.jpg'));
  await expect(page.getByTestId('photo-thumb')).toHaveCount(2);

  await fillField(page, 'companyName', 'Yiwu Huayi Phone Accessories');
  await fillField(page, 'contactPerson', 'Lily Wang');
  await fillField(page, 'wechatId', 'lily_huayi88');
  await fillField(page, 'phone', '+86 138 0579 1234');
  await fillField(page, 'district', 'District 2');
  await fillField(page, 'floor', '3');
  await fillField(page, 'street', '12');
  await fillField(page, 'booth', '23315');
  await fillField(page, 'category', 'Phone cases');
  await page.waitForTimeout(700); // auto-save debounce
  await shot(page, '02-capture-filled');

  // add product + first price
  await page.getByRole('button', { name: '+ Product', exact: true }).click();
  await fillField(page, 'productName', 'Silicone case iPhone 16');
  await fillField(page, 'price', '6.5');
  await fillField(page, 'moq', '500');
  await fillField(page, 'tierQty', '1000');
  await page.getByTestId('product-photo-input').setInputFiles(fx('product.jpg'));
  await shot(page, '03-product-form');
  await page.getByTestId('product-save').click();

  // supplier detail
  await expect(page.getByTestId('detail-code')).toHaveText('YW-001');
  await expect(page.getByTestId('detail-location')).toContainText('District 2 · Floor 3 · Street 12 · Booth 23315');
  await expect(page.locator('.li-title', { hasText: 'Silicone case iPhone 16' })).toBeVisible();
  await expect(page.getByText('6.50 CNY').first()).toBeVisible();
  await shot(page, '04-supplier-detail');

  // --- Supplier 2 & 3 via "Save & next": location prefilled from previous ---
  await page.getByTestId('nav-add').click();
  await expect(page.getByTestId('supplier-code')).toContainText('YW-002');
  await expect(page.locator('[name="district"]')).toHaveValue('District 2');
  await expect(page.locator('[name="floor"]')).toHaveValue('3');
  await fillField(page, 'companyName', 'Golden Star Cases');
  await fillField(page, 'wechatId', 'goldenstar_yw');
  await fillField(page, 'booth', '23320');
  await page.getByTestId('save-next').click();
  await expect(page.getByTestId('supplier-code')).toContainText('YW-003');
  await fillField(page, 'companyName', 'Bright Tote Bags');
  await fillField(page, 'district', 'District 4');
  await fillField(page, 'floor', '1');
  await fillField(page, 'booth', '101');
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toHaveText('YW-003');

  // product for supplier 2 to compare
  await page.goto('./#/suppliers?q=goldenstar');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await page.getByTestId('supplier-row').click();
  await page.getByTestId('add-product').click();
  await fillField(page, 'productName', 'Silicone case iPhone 16 Pro');
  await fillField(page, 'price', '5.8');
  await fillField(page, 'moq', '1000');
  await page.getByTestId('product-save').click();
  await expect(page.getByTestId('detail-code')).toHaveText('YW-002');

  // --- search across fields ---
  await page.goto('./#/suppliers');
  const search = page.getByTestId('supplier-search');
  for (const [q, n] of [
    ['lily_huayi', 1], // WeChat
    ['13805791234', 1], // phone digits
    ['silicone', 2], // product name
    ['23315', 1], // booth
    ['district 2', 2], // location
    ['YW-003', 1], // ID
    ['tote', 1], // company
  ] as const) {
    await search.fill(q);
    await expect(page.getByTestId('supplier-row'), `search "${q}"`).toHaveCount(n);
  }
  await search.fill('');
  await expect(page.getByTestId('supplier-row')).toHaveCount(3);
  await shot(page, '05-supplier-list');

  // --- compare ---
  await page.goto('./#/compare');
  await page.getByTestId('compare-search').fill('silicone case');
  await expect(page.getByTestId('compare-row')).toHaveCount(2);
  await expect(page.getByTestId('compare-row').first()).toContainText('5.80 CNY');
  await expect(page.getByTestId('compare-row').first()).toContainText('YW-002');
  await shot(page, '06-compare');

  // --- locations ---
  await page.goto('./#/locations');
  await expect(page.getByRole('heading', { name: 'District 2' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'District 4' })).toBeVisible();
  await shot(page, '07-locations');

  // --- dashboard ---
  await page.goto('./#/');
  await expect(page.getByTestId('stat-total')).toHaveText('3');
  await expect(page.getByTestId('sync-card')).toContainText('Local only');
  await shot(page, '08-dashboard');

  // --- persists after reload ---
  await page.reload();
  await expect(page.getByTestId('stat-total')).toHaveText('3');
});

test('works fully offline after first visit (service worker + IndexedDB)', async ({ page, context }) => {
  await fresh(page);
  // wait until the service worker controls the page
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload(); // served from the service-worker cache
  await expect(page.getByTestId('offline-bar')).toBeVisible();
  await expect(page.getByTestId('dash-add')).toBeVisible();

  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-card_front-input').setInputFiles(fx('card.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await fillField(page, 'companyName', 'Offline Supplier Ltd');
  await fillField(page, 'wechatId', 'offline_wx');
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toHaveText('YW-001');

  // edit while offline
  await page.getByRole('button', { name: 'Edit' }).click();
  await fillField(page, 'notes', 'Edited offline');
  await page.getByTestId('done').click();
  await expect(page.getByText('Edited offline')).toBeVisible();
  await shot(page, '09-offline-detail');

  // Excel export works offline too (library comes from the service-worker cache)
  await page.goto('./#/settings');
  const [xl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-excel').click()]);
  expect(xl.suggestedFilename()).toMatch(/\.xlsx$/);
  const wbOff = new ExcelJS.Workbook();
  await wbOff.xlsx.load(readFileSync((await xl.path())!) as never);
  expect(wbOff.getWorksheet('Suppliers')!.getRow(2).getCell(2).value).toBe('Offline Supplier Ltd');
  expect(wbOff.getWorksheet('Suppliers')!.getImages()).toHaveLength(1);

  // close & reopen the app while still offline
  await page.goto('about:blank');
  await page.goto('./#/suppliers');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await expect(page.getByTestId('supplier-row')).toContainText('Offline Supplier Ltd');
  await context.setOffline(false);
});

test('backup export (CSV/JSON/photos) and restore into a fresh phone', async ({ page, browser }) => {
  await fresh(page);
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-shop-input').setInputFiles(fx('shop.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await fillField(page, 'companyName', '义乌市华亿饰品有限公司');
  await fillField(page, 'wechatId', 'hy_jewelry');
  await page.getByRole('button', { name: '+ Product', exact: true }).click();
  await fillField(page, 'productName', 'Hair clip, "pearl", 6cm');
  await fillField(page, 'price', '0.35');
  await page.getByTestId('product-save').click();
  await expect(page.getByTestId('detail-code')).toHaveText('YW-001');

  await page.goto('./#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const file = await dl.path();
  const zip = await JSZip.loadAsync(readFileSync(file!));
  const names = Object.keys(zip.files);
  expect(names).toContain('data.json');
  expect(names).toContain('suppliers.csv');
  expect(names).toContain('quotations.csv');
  expect(names.some((n) => /^photos\/YW-001\/YW-001_shop_1\.jpg$/.test(n))).toBe(true);
  const csv = await zip.file('suppliers.csv')!.async('string');
  expect(csv).toContain('义乌市华亿饰品有限公司');
  const qcsv = await zip.file('quotations.csv')!.async('string');
  expect(qcsv).toContain('"Hair clip, ""pearl"", 6cm",0.35,CNY,piece');
  // photo was compressed (3000x2000 source -> max 1600px)
  const data = JSON.parse(await zip.file('data.json')!.async('string'));
  expect(data.photos[0].width).toBe(1600);

  // restore on a "new phone"
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('./#/settings');
  const dialog = p2.waitForEvent('dialog');
  await p2.getByTestId('import-input').setInputFiles(file!);
  const d = await dialog;
  expect(d.message()).toContain('Added: 4'); // supplier + product + quote + photo
  await d.accept();
  await p2.goto('./#/suppliers');
  await expect(p2.getByTestId('supplier-row')).toHaveCount(1);
  await expect(p2.getByTestId('supplier-row')).toContainText('YW-001');
  await p2.getByTestId('supplier-row').click();
  await expect(p2.getByTestId('photo-thumb')).toHaveCount(1);
  await expect(p2.locator('.li-title', { hasText: 'Hair clip' })).toBeVisible();
  await ctx2.close();
});

test('save to Photos (labelled copies), trash & restore, copies card', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-shop-input').setInputFiles(fx('shop.jpg'));
  // after-capture prompt
  await expect(page.getByTestId('toast-action')).toHaveText('Save to Photos');
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('save-sheet')).toBeVisible();
  const go = page.getByTestId('save-sheet-go');
  await expect(go).toHaveText(/Save 1 to Photos/);
  await page.screenshot({ path: 'test-results/screens/12-save-sheet.png' });
  // desktop Chrome has no share sheet for files -> falls back to a .zip of labelled copies
  const [dl] = await Promise.all([page.waitForEvent('download'), go.click()]);
  const zip = await JSZip.loadAsync(readFileSync((await dl.path())!));
  const names = Object.keys(zip.files);
  expect(names).toEqual(['YW-001_shop_1.jpg']);
  const jpg = await zip.file(names[0])!.async('uint8array');
  expect(jpg.length).toBeGreaterThan(10_000);

  await fillField(page, 'companyName', 'Trash Test Co');
  await page.getByTestId('capture-card_front-input').setInputFiles(fx('card.jpg'));
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toHaveText('YW-001');

  // copies card on the dashboard
  await page.goto('./#/');
  await expect(page.getByText('Your copies')).toBeVisible();
  await expect(page.getByText('1 photo(s) not saved to Photos yet')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/13-dashboard-copies.png', fullPage: true });

  // move to trash, then restore
  await page.goto('./#/suppliers');
  await page.getByTestId('supplier-row').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Move supplier to Trash' }).click();
  await expect(page).toHaveURL(/#\/suppliers$/);
  await expect(page.getByText('No suppliers yet')).toBeVisible();
  await page.goto('./#/trash');
  await expect(page.getByTestId('trash-supplier')).toContainText('Trash Test Co');
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.goto('./#/suppliers');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await page.getByTestId('supplier-row').click();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(2); // photos came back too
});

test('Excel export: one row per supplier with photos in the row', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-card_front-input').setInputFiles(fx('card.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await page.getByTestId('capture-shop-input').setInputFiles(fx('shop.jpg'));
  await fillField(page, 'companyName', 'Excel Co 义乌');
  await fillField(page, 'wechatId', 'excel_wx');
  await fillField(page, 'booth', '777');
  await page.getByTestId('save-next').click();
  await expect(page.getByTestId('supplier-code')).toContainText('YW-002');
  await fillField(page, 'companyName', 'Second Co');
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toHaveText('YW-002');

  await page.goto('./#/');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('safety-excel').click()]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync((await dl.path())!) as never);
  const ws = wb.getWorksheet('Suppliers')!;
  expect(ws.actualRowCount).toBe(3);
  expect(ws.getRow(2).getCell(1).value).toBe('YW-001');
  expect(ws.getRow(2).getCell(2).value).toBe('Excel Co 义乌');
  expect(ws.getRow(2).getCell(4).value).toBe('excel_wx');
  expect(ws.getRow(3).getCell(2).value).toBe('Second Co');
  const rows = ws.getImages().map((i) => Math.floor(i.range.tl.nativeRow));
  expect(rows).toEqual([1, 1]); // both photos sit in YW-001's row
  await expect(page.getByText(/Excel copy \(with photos\)/)).toBeVisible();
  await expect(page.getByText(/Last just now · one row per supplier/)).toBeVisible();
});
