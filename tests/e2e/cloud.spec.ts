import { execSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * UI + cloud sync end-to-end against the local Supabase stand-in.
 * Runs only from tests/integration/run.sh with RUN_E2E=1 (needs the gateway on :54321).
 */
test.skip(!process.env.YSM_CLOUD_E2E, 'needs local backend (tests/integration/run.sh)');

const sql = (q: string) => execSync(`su postgres -c "psql -d ${process.env.YSM_DB} -Atc \\"${q}\\""`).toString().trim();

test('configure cloud, sign in, capture offline, auto-sync when back online', async ({ page, context }) => {
  await page.goto('./#/settings');
  await page.getByLabel('Project URL').fill('http://127.0.0.1:54321');
  await page.getByLabel('Anon / publishable key').fill('local-anon-key-not-a-secret-0000000000');
  await page.getByRole('button', { name: 'Test & save' }).click();
  await page.getByLabel('Email').fill('milad@example.com');
  await page.getByLabel('Password').fill('pass-milad-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
  await expect(page.getByTestId('sync-dot')).toHaveAttribute('data-state', 'synced', { timeout: 15000 });

  // go offline and capture a supplier with a photo
  await context.setOffline(true);
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-card_front-input').setInputFiles(path.resolve('tests/fixtures/card.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await page.locator('[name="companyName"]').fill('Cloud Test Supplier');
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toBeVisible();
  await expect(page.getByText('Saved on phone · upload pending')).toBeVisible();
  await page.goto('./#/suppliers');
  await expect(page.getByTestId('sync-dot')).toHaveAttribute('data-state', 'offline');
  await page.screenshot({ path: 'test-results/screens/10-offline-pending.png' });
  expect(sql("select count(*) from suppliers where company_name='Cloud Test Supplier'")).toBe('0');

  // back online -> uploads automatically (no button press)
  await context.setOffline(false);
  await expect(page.getByTestId('sync-dot')).toHaveAttribute('data-state', 'synced', { timeout: 20000 });
  expect(sql("select code from suppliers where company_name='Cloud Test Supplier'")).toMatch(/^YW-\d{3}$/);
  expect(sql("select count(*) from photos p join suppliers s on s.id=p.supplier_id where s.company_name='Cloud Test Supplier'")).toBe('1');
  await page.goto('./#/');
  await expect(page.getByTestId('sync-card')).toContainText('All changes are backed up');
  await page.screenshot({ path: 'test-results/screens/11-synced-dashboard.png', fullPage: true });
});
