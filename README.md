# Yiwu Supplier Manager

Offline-first, mobile-first supplier CRM for walking the Yiwu market: capture a supplier (ID, photos, WeChat, phone, district/floor/booth, products, prices) in about a minute with no internet, then search, compare quotes and back up or sync later.

**Live app:** https://milidito.github.io/yiwu-supplier-manager/ (auto-deployed from `main` by GitHub Actions)

**Status (v0.3.0, 12 Nov 2026):** working MVP. Local/offline features are implemented and tested. Cloud sync is implemented and tested against a local Postgres + PostgREST stand-in for Supabase. Hosting is live on GitHub Pages. **The Supabase project has not been created yet** (see `docs/CLOUD-SETUP.md`).

## Stack and why

| Need | Choice | Why |
|---|---|---|
| Works on iPhone + Android, no app store | **PWA** (installable web app), React 18 + TypeScript + Vite | One codebase; install from Safari/Chrome; updates itself |
| Opens with no internet | **Service worker** (vite-plugin-pwa / Workbox) precaches the whole app | Verified: app reloads in airplane mode |
| Data and photos stored offline | **IndexedDB** via Dexie | Large capacity, stores image Blobs; reactive UI via `useLiveQuery` |
| Small photos | Client-side compression (max 1600 px JPEG, 360 px thumbnails) | A 3000×2000 photo becomes about 150–400 KB, so uploads work on weak mobile data |
| Cloud | **Supabase** (Postgres + Auth + private Storage + Row Level Security), free tier | Real SQL, export-friendly, strict per-user isolation, no server code to run |
| Sync | Custom engine (`src/sync/engine.ts`) behind a `Remote` interface | Idempotent UUID upserts, pull cursor, last-write-wins with conflict log; backend swappable |

## Feature status

### Implemented and tested
- Dashboard: totals, added today/this week, follow-ups due, "to complete later", recent suppliers, sync status, quick actions.
- Fast capture: sequential IDs (`YW-001`…, never reused), auto-save (no Save button), partial records, location prefilled from the previous shop, **Save & next**.
- One-tap camera buttons per photo type: card front/back, shop/sign, booth no., product, catalogue/doc; gallery multi-import; photo viewer (re-categorise, link to a product, caption, delete).
- Products with many quotations: price, currency, unit, MOQ, price-tier qty, date, notes; product photos.
- Search across ID, company, contact, WeChat, phone (also digits only), product names, district/floor/street/booth, notes; filters (status, district, category, type, follow-up due, incomplete); sort.
- Price comparison: ranks only within the same **currency and unit**; latest-quote mode; optional "≈ CNY" using your own exchange rates (labelled as an estimate).
- Locations: browse by district, then floor, then street/booth.
- Follow-up date/task, own 1–5 rating, supplier type (marked as your own observation), status pipeline.
- Backup: one .zip with `suppliers.csv`, `products.csv`, `quotations.csv`, `photos.csv` (UTF-8 with BOM so Chinese text opens correctly in Excel), `data.json`, and all photos named `photos/YW-001/YW-001_card_front_1.jpg`. Restore/merge from the zip. Share sheet on phones.
- Offline: install banner, offline bar, persistent-storage request, storage usage display.
- Cloud sync (code + tests against a local stand-in): email/password sign-in; automatic sync on app open, back online, after edits, every 60 s while changes are pending; manual "Sync now"; retry with backoff; pending/synced/error states; sync log; conflicts list keeps the discarded version; deletions sync and remove cloud photo files; supplier-code collisions between two offline phones are renumbered and logged.
- Security: only the public anon/publishable key is used in the app (it refuses a service_role/secret key). RLS on every table and on storage, so each row and photo belongs to `auth.uid()`. Private photo bucket. Ownership cannot be changed by updates.

### Added in v0.2.0: copies of the data in several places
- **Your copies card** on the dashboard: app, cloud sync, daily cloud snapshot, backup file, iPhone Photos, each with its status and a one-tap fix.
- **Save to iPhone Photos:** prepare labelled copies (supplier ID, photo type, company, booth and date burned into a caption bar), then one tap opens the iOS share sheet ("Save N Images" / "Save to Files"). The prompt appears right after each photo (can be switched off), plus a batch "save all unsaved" option. On computers it downloads a .zip instead.
- **Daily cloud snapshots (version history):** after a successful sync, at most once a day, a dated zip of all records goes to `<user>/backups/` in private storage. Snapshots are never overwritten. Restore from Settings brings back anything deleted since then and keeps newer edits.
- **Trash:** deletes are soft everywhere. Suppliers, products, quotes and photos can be restored, and photo files are kept on the phone and in the cloud.
- GitHub Pages deploy workflow (`.github/workflows/deploy.yml`).

### Added in v0.3.0
- **Excel copy (.xlsx) with photos:** sheet *Suppliers* has one row per supplier and one column per field (ID, company, contact, WeChat, phone, email, district, floor, street, booth, category, type, status, rating, follow-up, notes, products and latest prices, dates), with the supplier's photos embedded in the same row ("Photo 1…N", label above each photo, up to 20 per supplier). Sheet *Products & prices* has one row per quote with the product photo. Header filters, frozen ID/company columns, prints landscape at one page wide. Works offline. Buttons: dashboard "Your copies" → Excel, and Settings → Backup. A readable copy only; restore uses the .zip.

### Planned (not built)
- Persian (فارسی) / bilingual UI with RTL.
- Business-card OCR, QR scanning of WeChat cards, printable QR/ID labels.
- Multi-user team accounts (the schema is single-owner by design today).
- Field-level merge for conflicts (today: whole-record last-write-wins plus kept copy).
- PDF quote sheets, currency rates fetched online.
- Native background upload and silent camera-roll saving (needs a native iOS app via Capacitor + Apple Developer account; not possible for web apps).

## Background sync: what to expect
- **iPhone (Safari/home-screen app):** no Background Sync API. Uploads happen while the app is open and online. Open the app on Wi-Fi in the evening and wait for "Synced".
- **Android Chrome:** supports Background Sync, but the app deliberately does not rely on it (auth tokens and photo uploads are handled in the page). Same behaviour as iPhone: sync while open, on reopen, and when back online.
- Nothing is lost if the app is closed before syncing: changes stay in IndexedDB (marked pending) and upload the next time the app is open and online. Verify this on your own phone with step 5 of `docs/TESTING.md`.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (use --host to open on your phone on the same Wi-Fi)
npm run build        # production build in dist/ (static files, any host)
npm run preview      # serve dist/ on :4173 with the service worker
```
The phone needs **HTTPS** for installation, camera and service worker. Deploy `dist/` to a static host (see `docs/DEPLOY.md`).

## Tests

```bash
npm test                    # unit: IDs, sync engine (retries, duplicates, conflicts, deletes, RLS-like isolation), search, compare, CSV
npx playwright install chromium   # once (or set CHROME_PATH=/path/to/chrome)
npm run test:e2e            # phone-sized browser: capture flow, offline reload, export/restore
POSTGREST_BIN=/path/to/postgrest RUN_E2E=1 npm run test:integration
                            # real Postgres + PostgREST + supabase-js + supabase/schema.sql (RLS),
                            # plus UI test: sign in, capture offline, auto-sync on reconnect
```
`test:integration` needs a local PostgreSQL superuser and the PostgREST binary. It is a stand-in for Supabase: Postgres, the REST layer, RLS and supabase-js are real, while auth and storage are small local fakes (`tests/integration/gateway.mjs`). The real Supabase project still needs the manual checks in `docs/TESTING.md`.

## Project layout
```
src/db.ts                 Dexie schema + types
src/repo.ts               all writes (timestamps, dirty flags, IDs, soft deletes)
src/images.ts             photo compression
src/logic.ts              search, comparison, formatting
src/backup.ts             zip export / restore
src/sync/engine.ts        sync algorithm (documented at top of file)
src/sync/remote.ts        backend interface + field mapping
src/sync/supabaseRemote.ts Supabase adapter
src/sync/runner.ts        when to sync + status for the UI
src/screens/*             UI screens
supabase/schema.sql       tables, triggers, RLS, private bucket (idempotent)
tests/                    unit, integration, e2e
docs/                     cloud setup, deploy, manual test checklist
```

## Data, privacy, deletion
- On the phone: browser IndexedDB for the app's origin. Removed by Settings → Danger zone → Erase, or by deleting the home-screen app/site data.
- In the cloud (once enabled): your own Supabase project. Only your signed-in account can read or write (RLS). Delete rows in the Table editor, or delete the whole project.
- Backups: wherever you save the .zip.
