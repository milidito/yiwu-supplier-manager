# Cloud setup (Supabase): only after the owner approves

Nothing here has been done yet. Every step is done by the owner in their own browser, so no one else gets access to the account.

## Cost and permanence (check https://supabase.com/pricing before signing up; prices change)
- **Free plan: $0, no credit card.** Per project: about 500 MB database, **1 GB file storage**, 5 GB egress per month. No automatic database backups.
- **Pausing:** free projects with low activity over 7 days are paused. A paused project can be resumed from the dashboard for 90 days. After that it can't be resumed, but the data can still be downloaded and moved to a new project. Paid plans are never paused.
- Rough capacity: compressed photos are about 150–400 KB each, so 1 GB holds roughly 3,000–5,000 photos.
- **Pro plan, $25/month:** no pausing, 100 GB storage, 7 days of daily backups. Worth it if this becomes a long-term business tool, or as soon as storage nears 1 GB.
- Either way the app keeps its own extra copies: daily snapshots, the backup .zip in iCloud Drive / Files, and photos in iPhone Photos. So the data never depends on Supabase alone.

### Recommended for long-term use
Start on Free now (no card). After the trip, either open the app at least weekly, or upgrade to Pro. Also keep a recent backup .zip in iCloud Drive or Google Drive.

## Steps (about 10 minutes)
1. Go to https://supabase.com, choose **Start your project**, and sign up with email (or GitHub).
2. **New project**: name it `yiwu-suppliers`, set a strong database password (store it in your password manager), choose a region (e.g. *Southeast Asia (Singapore)*, close to China and reasonable from Canada), and select the Free plan.
3. When the project is ready: **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**. It is safe to run again; re-run it whenever a new app version updates the schema.
4. **Authentication → Sign In / Providers → Email**: keep it enabled. Optional: turn on *Confirm email*. If it is on, confirm the email before signing in on the phone.
   Optional but recommended for a single-user tool: after you create your own account, turn off **Allow new users to sign up**, so nobody else can register in your project.
5. **Project Settings → API (or "API Keys")**: copy the **Project URL** and the **anon / publishable** key.
   **Never** copy the `service_role` / secret key into the app. The app refuses it.
6. On the phone: app → More → Settings → Cloud sync. Paste URL + key, tap **Test & save**, then **Create account** (or Sign in).
7. Check: Dashboard shows **Synced**. In Supabase → Table editor → `suppliers`, your rows appear. Storage → `supplier-photos` has a folder named after your user id.

## Using it in China
Foreign services may be slow or blocked in mainland China. Options: roaming data from your home carrier (usually routed outside China), a Hong Kong eSIM, or a VPN. Without them, the app keeps working offline and syncs when you are back. Keep exporting a .zip backup in the evenings as a second copy.

## Security notes
- The anon/publishable key is meant to be public. Protection comes from Row Level Security in `schema.sql`.
- Every table has `force row level security` with owner-only policies. The photo bucket is private, with folder-per-user policies.
- To revoke a lost phone: Supabase → Authentication → Users → your user → sign out all sessions / change password.
