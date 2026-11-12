import { Header, Section } from '../ui/components';

export function Help() {
  return (
    <div className="screen">
      <Header title="How to use" backTo="/more" />
      <Section title="1. Install before you travel">
        <ol className="small">
          <li>
            <b>iPhone:</b> open the app link in <b>Safari</b> → Share → <b>Add to Home Screen</b>. Always open it from the home-screen icon.
          </li>
          <li>
            <b>Android:</b> open the link in <b>Chrome</b> → ⋮ → <b>Install app</b>.
          </li>
          <li>Open it once while online, then switch on airplane mode and check it still opens — that confirms offline mode works.</li>
        </ol>
      </Section>
      <Section title="2. At each shop (≈ 1 minute)">
        <ol className="small">
          <li>Tap the big ＋. Note the Supplier ID (e.g. YW-014) — you can write it on the business card.</li>
          <li>Tap 🏪 Shop / sign, 🔢 Booth no., 🪪 Card front / 🔄 back, 📦 Product — each opens the camera.</li>
          <li>Type company, WeChat, phone. District/floor/street are copied from the previous shop; just change the booth.</li>
          <li>“+ Product & price” to record price, currency, unit and MOQ. “Save & next” to go to the next shop.</li>
        </ol>
        <div className="small">Everything saves automatically on the phone — no internet needed.</div>
      </Section>
      <Section title="3. In the evening (on Wi-Fi)">
        <ul className="small">
          <li>Open the app: changes upload automatically if cloud sync is set up (Sync status at the top).</li>
          <li>More → Settings → Backup: share the .zip to Files / email / cloud drive as an extra copy.</li>
          <li>Complete “To complete later” records, set follow-ups, compare prices.</li>
        </ul>
      </Section>
      <Section title="Reinstalled the app, or a new phone?">
        <ol className="small">
          <li>Open the app link in Safari → Share → Add to Home Screen. Open it from the icon.</li>
          <li>More → Settings → Cloud sync: the project is already filled in. Enter your email + app password → <b>Sign in</b>. (The password is in iPhone Passwords if you saved it.)</li>
          <li>Keep the app open on Wi-Fi: all suppliers arrive first, then the photos download (the status shows how many are left).</li>
          <li>No cloud? Settings → Restore from your latest backup .zip in iCloud Drive.</li>
        </ol>
      </Section>
      <Section title="Good to know">
        <ul className="small">
          <li>Ratings, supplier type and notes are your own observations.</li>
          <li>Price comparison only ranks quotes with the same currency and unit.</li>
          <li>In mainland China, foreign cloud services may be slow or blocked without roaming data or a VPN. The app keeps working offline and syncs later.</li>
        </ul>
      </Section>
    </div>
  );
}
