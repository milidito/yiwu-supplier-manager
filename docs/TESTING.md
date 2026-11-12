# Testing

## What was tested automatically (12 Nov 2026)
| Area | How | Result |
|---|---|---|
| IDs sequential, unique, never reused; partial save | unit (Vitest + fake IndexedDB) | ✅ |
| Sync: push, photo upload, retry after timeout/interrupted upload, no duplicates | unit with in-memory cloud | ✅ |
| Sync: second phone receives data + photos; conflict LWW + kept copy; code collision renumbering; delete propagation; no push if download failed | unit | ✅ |
| Search (WeChat, phone digits, product, booth, ID, "district 2"), comparison grouping, CSV escaping | unit | ✅ |
| `supabase/schema.sql` runs (twice = idempotent) on PostgreSQL 16 | integration | ✅ |
| Real PostgREST + supabase-js + RLS: round trip, idempotent retry, 2 phones, other account sees nothing and cannot overwrite, anonymous gets nothing, conflict, delete + photo file removal | integration | ✅ |
| UI on a Pixel-7-sized screen: photo-first capture, auto-save, location prefill, Save & next, product + price, search, compare, locations, persistence after reload | Playwright (Chrome) | ✅ |
| Offline: app reloads from service worker with network off; create + edit offline; reopen offline | Playwright | ✅ |
| Export zip (CSV with Chinese text, JSON, photos named by ID, compression to 1600 px) and restore on a fresh browser | Playwright | ✅ |
| UI cloud flow: enter project, sign in, capture offline, **auto-sync on reconnect**, rows + photo in Postgres, daily snapshot created | Playwright + local backend | ✅ |
| v0.2: soft delete keeps photo files (phone + cloud); Trash restore of supplier/product/photo across phones; restored code re-numbered if reused | unit + integration + Playwright | ✅ |
| v0.2: daily cloud snapshot once per day, older kept, other account cannot list; restore brings back deleted data after it synced | unit + integration | ✅ |
| v0.2: Save to Photos sheet, labelled copy named `YW-001_shop_1.jpg` with caption bar (Chinese text OK); copies card | Playwright | ✅ |

**Not yet tested:** a real Supabase project (auth emails, real Storage service), a real iPhone (camera, the iOS share sheet's "Save N Images" option, home-screen install), Chinese mobile networks.

## Manual checklist on your phone (do before the trip)
1. Install from the HTTPS link (Add to Home Screen / Install app). Open from the icon.
2. Add 2 suppliers with real camera photos (card, shop, product). Check photos look sharp enough to read the card.
3. **Airplane mode on.** Close the app completely (swipe away). Reopen: it must open and show both suppliers.
4. Still offline: add a third supplier with 3 photos and a product with price + MOQ. Edit supplier 1's notes.
5. Close the app again before reconnecting (tests "restart before sync").
6. Airplane mode off, open the app: within about a minute the status changes to **Synced** (if cloud is set up). Check Supabase Table editor and Storage.
7. Settings → Backup → **Share / Save to Files**. Open the zip on a computer and check the CSVs in Excel and the photo folder names.
8. Second device (or a browser on your laptop with the same account): sign in and check all suppliers and photos arrive.
9. Edit the same supplier on both devices while one is offline, then sync both. More → Sync shows one conflict with the older version saved.
10. Search by WeChat ID, booth number and product name; compare two quotes.
11. Restore test: on a fresh browser, Settings → Restore from the zip.
12. **Save to Photos:** take a photo, tap “Save to Photos” in the message that appears, then “Save 1 to Photos”. Check whether iOS shows **“Save Image”** (if it doesn't, use “Save to Files”). Open Photos and check the label (supplier ID + booth) at the bottom.
13. Trash: move a supplier to Trash, restore it from More → Trash, and check its photos came back.
14. Snapshot: Settings → Cloud snapshots → “Save a snapshot now”, delete a test supplier, sync, then Restore that snapshot: the supplier returns.

## Commands
```bash
npm test
CHROME_PATH=/usr/bin/google-chrome npm run test:e2e
POSTGREST_BIN=/path/to/postgrest RUN_E2E=1 CHROME_PATH=/usr/bin/google-chrome npm run test:integration
```
