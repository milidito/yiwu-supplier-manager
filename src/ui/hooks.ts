import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, type Product, type Quotation, type Supplier } from '../db';
import { type AppSettings, DEFAULT_SETTINGS, getSettings } from '../repo';
import { type SyncStatus, syncRunner } from '../sync/runner';

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(syncRunner.getStatus());
  useEffect(() => syncRunner.subscribe(setS), []);
  return s;
}

export function useSettings(): AppSettings {
  return useLiveQuery(() => getSettings(db), [], DEFAULT_SETTINGS);
}

export function useSuppliers(): Supplier[] | undefined {
  return useLiveQuery(() => db.suppliers.filter((s) => !s.deleted).toArray(), []);
}

export function useProducts(): Product[] | undefined {
  return useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), []);
}

export function useQuotations(): Quotation[] | undefined {
  return useLiveQuery(() => db.quotations.filter((q) => !q.deleted).toArray(), []);
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => {
      window.removeEventListener('online', a);
      window.removeEventListener('offline', b);
    };
  }, []);
  return on;
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
