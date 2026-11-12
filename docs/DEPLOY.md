# Putting the app on your phone (hosting): needs an account, so only after approval

The app is a folder of static files (`dist/`, also delivered as `yiwu-supplier-manager-dist.zip`). A phone can only install it as an offline app from an **HTTPS** address. Any free static host works. Nothing has been created yet.

| Option | Account | Cost | Effort | Notes |
|---|---|---|---|---|
| **Netlify Drop** (recommended to start) | Netlify (free) | $0 | Drag the `dist` folder onto app.netlify.com/drop | Fastest; claim the site with a free account so it stays online |
| Cloudflare Pages | Cloudflare (free) | $0 | Upload `dist` (Direct Upload) or connect GitHub | Very fast CDN |
| GitHub Pages | GitHub (free) | $0 | Push the repo, enable Pages on `dist` (or a GitHub Action) | Good for continuing development |

The app uses hash routing and relative paths, so it works on any of these with no server configuration, including in a sub-folder.

## After deploying
1. Open the HTTPS link on the phone: **Safari** (iPhone) or **Chrome** (Android).
2. Install: iPhone Share → **Add to Home Screen**; Android ⋮ → **Install app**.
3. Open it from the icon once while online, then test in airplane mode (`docs/TESTING.md`).
4. **Do this in Canada before the trip.** Once installed, the app opens offline, so the host does not need to be reachable from China. Updates download the next time the app is opened online.

## Updating
`npm run build` and re-upload `dist/`. The installed app updates itself on the next online launch. Data on the phone is not touched by updates.
