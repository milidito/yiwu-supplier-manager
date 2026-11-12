import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { db } from './db';
import { syncRunner } from './sync/runner';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Service worker: caches the app so it opens with no internet. Updates install automatically.
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

// Ask the browser not to evict our data under storage pressure (best effort; granted more readily to installed apps).
db.suppliers
  .count()
  .then((n) => (n > 0 ? navigator.storage?.persist?.() : undefined))
  .catch(() => undefined);

void syncRunner.start();
