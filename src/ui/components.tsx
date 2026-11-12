import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { db, type Photo, type PhotoKind, PHOTO_KIND_LABELS, STATUS_LABELS, type SupplierStatus } from '../db';
import { back } from '../router';
import { useSyncStatus } from './hooks';

// ---------------- layout ----------------
export function Header(props: { title: ReactNode; backTo?: string; right?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="hdr">
      {props.backTo !== undefined ? (
        <button className="hdr-back" aria-label="Back" onClick={() => back(props.backTo)}>
          ‹
        </button>
      ) : (
        <span className="hdr-spacer" />
      )}
      <div className="hdr-title">
        <div className="hdr-main">{props.title}</div>
        {props.sub && <div className="hdr-sub">{props.sub}</div>}
      </div>
      <div className="hdr-right">{props.right ?? <SyncDot />}</div>
    </header>
  );
}

export function SyncDot() {
  const st = useSyncStatus();
  const map: Record<string, [string, string]> = {
    local_only: ['dot-grey', 'Local only'],
    signed_out: ['dot-amber', 'Signed out'],
    offline: ['dot-amber', st.pending ? `Offline · ${st.pending}` : 'Offline'],
    syncing: ['dot-blue', 'Syncing'],
    synced: ['dot-green', 'Synced'],
    pending: ['dot-amber', `${st.pending} pending`],
    error: ['dot-red', 'Sync error'],
  };
  const [cls, label] = map[st.state];
  return (
    <a className="syncdot" href="#/sync" data-testid="sync-dot" data-state={st.state}>
      <span className={`dot ${cls}`} />
      <span>{label}</span>
    </a>
  );
}

export function Section(props: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {(props.title || props.right) && (
        <div className="card-hd">
          <h2>{props.title}</h2>
          {props.right}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Empty(props: { children: ReactNode }) {
  return <div className="empty">{props.children}</div>;
}

// ---------------- form fields ----------------
interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  list?: string;
  autoFocus?: boolean;
  name?: string;
  hint?: ReactNode;
  className?: string;
}

export function Field(p: FieldProps) {
  return (
    <label className={`field ${p.className ?? ''}`}>
      <span className="field-label">{p.label}</span>
      <input
        name={p.name}
        type={p.type ?? 'text'}
        inputMode={p.inputMode}
        value={p.value}
        list={p.list}
        placeholder={p.placeholder}
        autoFocus={p.autoFocus}
        autoComplete="off"
        autoCorrect="off"
        onChange={(e) => p.onChange(e.target.value)}
        onBlur={p.onBlur}
      />
      {p.hint && <span className="field-hint">{p.hint}</span>}
    </label>
  );
}

export function TextArea(p: Omit<FieldProps, 'type' | 'inputMode' | 'list'> & { rows?: number }) {
  return (
    <label className={`field ${p.className ?? ''}`}>
      <span className="field-label">{p.label}</span>
      <textarea name={p.name} rows={p.rows ?? 3} value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} onBlur={p.onBlur} />
    </label>
  );
}

export function Select<T extends string>(p: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  name?: string;
  className?: string;
}) {
  return (
    <label className={`field ${p.className ?? ''}`}>
      <span className="field-label">{p.label}</span>
      <select name={p.name} value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Chips<T extends string>(p: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; name?: string }) {
  return (
    <div className="chips" role="radiogroup" data-name={p.name}>
      {p.options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={p.value === o.value}
          className={`chip ${p.value === o.value ? 'chip-on' : ''}`}
          onClick={() => p.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stars(p: { value: number | null; onChange?: (v: number | null) => void; size?: 'sm' | 'lg' }) {
  return (
    <span className={`stars ${p.size === 'lg' ? 'stars-lg' : ''}`} aria-label={`My rating ${p.value ?? 'none'} of 5`}>
      {[1, 2, 3, 4, 5].map((n) =>
        p.onChange ? (
          <button type="button" key={n} className={n <= (p.value ?? 0) ? 'star on' : 'star'} onClick={() => p.onChange!(p.value === n ? null : n)} aria-label={`${n} star`}>
            ★
          </button>
        ) : (
          <span key={n} className={n <= (p.value ?? 0) ? 'star on' : 'star'}>
            ★
          </span>
        ),
      )}
    </span>
  );
}

export function StatusPill({ status }: { status: SupplierStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function DataList({ id, values }: { id: string; values: string[] }) {
  return (
    <datalist id={id}>
      {[...new Set(values.filter(Boolean))].map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
}

// ---------------- photos ----------------
export function useBlobUrl(blob: Blob | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function PhotoThumb(props: { photo: Photo; onClick?: () => void; showKind?: boolean }) {
  const blob = useLiveQuery(() => db.photoBlobs.get(props.photo.id), [props.photo.id]);
  const url = useBlobUrl(blob?.thumb);
  const pendingUpload = props.photo.blobState === 'local';
  return (
    <button type="button" className="thumb" onClick={props.onClick} data-testid="photo-thumb" data-kind={props.photo.kind}>
      {url ? <img src={url} alt={PHOTO_KIND_LABELS[props.photo.kind]} loading="lazy" /> : <span className="thumb-missing">{props.photo.blobState === 'remote_only' ? '☁︎' : '…'}</span>}
      {props.showKind && <span className="thumb-kind">{PHOTO_KIND_LABELS[props.photo.kind]}</span>}
      {pendingUpload && <span className="thumb-pending" title="Not uploaded yet" />}
    </button>
  );
}

/**
 * A button that opens the phone camera directly (capture="environment").
 * With `gallery`, it opens the photo library instead and allows multiple selection.
 */
export function CaptureButton(props: {
  label: ReactNode;
  onFiles: (files: File[]) => unknown;
  gallery?: boolean;
  className?: string;
  testId?: string;
  count?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={props.className ?? 'btn'} onClick={() => ref.current?.click()} disabled={busy} data-testid={props.testId}>
        {busy ? 'Saving…' : props.label}
        {!!props.count && <span className="badge">{props.count}</span>}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        {...(props.gallery ? { multiple: true } : { capture: 'environment' })}
        style={{ display: 'none' }}
        data-testid={props.testId ? `${props.testId}-input` : undefined}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          try {
            await props.onFiles(files);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export const KIND_ICONS: Record<PhotoKind, string> = {
  card_front: '🪪',
  card_back: '🔄',
  shop: '🏪',
  booth: '🔢',
  product: '📦',
  document: '📄',
};

// ---------------- toast ----------------
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<unknown>;
}
let toastFn: ((m: string, a?: ToastAction) => void) | null = null;
export function toast(m: string, action?: ToastAction) {
  toastFn?.(m, action);
}
export function ToastHost() {
  const [msg, setMsg] = useState<{ m: string; a?: ToastAction } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    toastFn = (m, a) => {
      setMsg({ m, a });
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), a ? 6000 : 2600);
    };
    return () => {
      toastFn = null;
    };
  }, []);
  return msg ? (
    <div className="toast" role="status" data-testid="toast">
      <span>{msg.m}</span>
      {msg.a && (
        <button
          className="toast-btn"
          data-testid="toast-action"
          onClick={() => {
            const a = msg.a!;
            setMsg(null);
            void a.onClick();
          }}
        >
          {msg.a.label}
        </button>
      )}
    </div>
  ) : null;
}

export async function copyText(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}: ${text}`);
  } catch {
    window.prompt('Copy:', text);
  }
}
