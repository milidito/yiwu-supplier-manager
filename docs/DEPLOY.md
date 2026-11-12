# Putting the app on your phone (permanent hosting)

The app is a folder of static files (`dist/`). A phone can only install it as an offline app from an **HTTPS** address. Nothing has been created yet; each option needs a free account.

## Recommended: GitHub + GitHub Pages (free, permanent)
Why: the address never expires, every app version is kept (the source code is also a backup), and updates deploy automatically.
1. Create a free account at https://github.com.
2. New repository: name it `yiwu-supplier-manager` and make it **Public**. Pages on private repos needs a paid GitHub plan. The code holds no data and no keys: your data lives in your Supabase project, and you type the keys into the app on the phone.
3. Push the code (or connect GitHub to Claude: claude.ai → Settings → Connectors → GitHub, then Claude pushes it for you).
4. Repo → **Settings → Pages → Source: GitHub Actions**. The included workflow `.github/workflows/deploy.yml` tests, builds and publishes on every push.
5. The app is at `https://<your-username>.github.io/yiwu-supplier-manager/`.

## Alternative: Netlify (free)
Create an account at https://app.netlify.com, then **Add new site → Deploy manually**, and drag the `dist` folder in. Sites in your account stay online permanently. Updates mean dragging a new `dist` each time.

## After deploying
1. Open the HTTPS link on the iPhone in **Safari**, then Share → **Add to Home Screen**. Always open the app from that icon.
2. Open it once online, then test in airplane mode (`docs/TESTING.md`).
3. **Do this in Canada before the trip.** Once installed, the app opens offline, so the host does not need to be reachable from China. Updates download the next time the app is opened online (github.io and netlify.app can be slow or blocked in mainland China).

## Updating
Push to `main` (GitHub) or re-upload `dist/` (Netlify). The installed app updates on the next online launch. Data on the phone is never touched by updates.

Important: the app's data is tied to the web address. Keep using the same address; if you ever move to a new one, first make a backup .zip and restore it there, or sign in to cloud sync on the new address.
