import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DISTRICT_SUGGESTIONS, STATUS_LABELS, type Supplier, type SupplierStatus, type SupplierType, TYPE_LABELS, db } from '../db';
import { blankSupplier, changeSupplierCode, createSupplier, lastLocation, nextSupplierCode, updateSupplier } from '../repo';
import { navigate } from '../router';
import { Chips, DataList, Field, Header, Section, Select, Stars, TextArea, toast } from '../ui/components';
import { useSuppliers } from '../ui/hooks';
import { PhotoStrip, QuickCapture, usePhotos } from '../ui/photos';

type Form = ReturnType<typeof blankSupplier>;

const KEY_FIELDS: (keyof Form)[] = ['companyName', 'contactPerson', 'wechatId', 'phone', 'booth', 'category', 'notes', 'email', 'followUpNote', 'locationNotes'];

/**
 * Fast capture + edit screen.
 * - Auto-saves to the phone ~0.5 s after typing stops (no "Save" needed, nothing is lost).
 * - A record is only created once you type something or take a photo.
 * - District / floor / street are prefilled from the previous supplier (you usually walk the same aisle).
 */
export function SupplierEditor({ id: initialId, isNew }: { id?: string; isNew: boolean }) {
  const [id, setId] = useState<string | undefined>(initialId);
  const [form, setForm] = useState<Form | null>(null);
  const [code, setCode] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showMore, setShowMore] = useState(false);
  const formRef = useRef<Form | null>(null);
  const idRef = useRef<string | undefined>(initialId);
  const dirtyRef = useRef(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppliers = useSuppliers() ?? [];
  const photos = usePhotos(id) ?? [];

  // load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialId) {
        const s = await db.suppliers.get(initialId);
        if (!s || cancelled) return;
        const { id: _i, code: c, createdAt, updatedAt, deleted, dirty, baseUpdatedAt, syncedAt, ...rest } = s;
        formRef.current = rest;
        setForm(rest);
        setCode(c);
      } else {
        const f = blankSupplier();
        const last = await lastLocation();
        if (last && (last.district || last.floor || last.street)) {
          f.district = last.district;
          f.floor = last.floor;
          f.street = last.street;
          setPrefilled(true);
        }
        const c = await nextSupplierCode();
        if (cancelled) return;
        formRef.current = f;
        setForm(f);
        setCode(c);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const hasContent = (f: Form) => KEY_FIELDS.some((k) => String(f[k] ?? '').trim() !== '') || f.rating !== null || !!f.followUpDate;

  /** Persist pending edits. With `force`, creates the record even if it is still empty (e.g. before adding a photo). */
  const flush = useCallback((force = false): Promise<string | undefined> => {
    const run = async () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const f = formRef.current;
      if (!f) return idRef.current;
      if (!idRef.current) {
        if (!force && !hasContent(f)) return undefined;
        setSaveState('saving');
        const rec = await createSupplier(f);
        idRef.current = rec.id;
        void navigator.storage?.persist?.().catch(() => undefined);
        setId(rec.id);
        setCode(rec.code);
        // If more edits arrived while creating, save them too.
        if (formRef.current !== f) await updateSupplier(rec.id, formRef.current!);
        dirtyRef.current = false;
        setSaveState('saved');
        return rec.id;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setSaveState('saving');
        await updateSupplier(idRef.current, f);
        setSaveState('saved');
      }
      return idRef.current;
    };
    const p = chain.current.then(run, run);
    chain.current = p;
    return p;
  }, []);

  // flush on unmount / page hide
  useEffect(() => {
    const onHide = () => void flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    if (!formRef.current) return;
    const next = { ...formRef.current, [k]: v };
    formRef.current = next;
    setForm(next);
    dirtyRef.current = true;
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  };

  const ensureId = async () => (await flush(true))!;

  const categories = suppliers.map((s) => s.category);
  const districts = [...DISTRICT_SUGGESTIONS, ...suppliers.map((s) => s.district)];

  if (!form) return <Header title="Loading…" backTo="/" />;

  const savedLabel = !id ? 'Not saved yet — type or take a photo' : saveState === 'saving' ? 'Saving…' : 'Saved on this phone ✓';

  return (
    <div className="screen">
      <Header title={isNew ? 'New supplier' : 'Edit supplier'} backTo={id ? `/s/${id}` : '/'} />

      <div className="code-banner" data-testid="supplier-code">
        <div>
          <div className="code-label">Supplier ID</div>
          <div className="code-big">{code}</div>
        </div>
        <div className={`save-state ${id ? 'ok' : ''}`} data-testid="save-state">
          {savedLabel}
        </div>
      </div>

      <Section title="Photos" right={<span className="muted small">{photos.length} saved</span>}>
        <QuickCapture ensureId={ensureId} photos={photos} />
        <PhotoStrip photos={photos} showKind />
      </Section>

      <Section title="Contact">
        <Field label="Company name" name="companyName" value={form.companyName} onChange={(v) => set('companyName', v)} placeholder="e.g. Yiwu Huayi Toys Co." />
        <Field label="Contact person" name="contactPerson" value={form.contactPerson} onChange={(v) => set('contactPerson', v)} />
        <div className="row">
          <Field className="grow" label="WeChat ID" name="wechatId" value={form.wechatId} onChange={(v) => set('wechatId', v)} />
          <Field className="grow" label="Phone / WhatsApp" name="phone" type="tel" inputMode="tel" value={form.phone} onChange={(v) => set('phone', v)} />
        </div>
      </Section>

      <Section title="Market location">
        {prefilled && !initialId && (
          <div className="note">
            Prefilled from your previous supplier.{' '}
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                set('district', '');
                set('floor', '');
                set('street', '');
                setPrefilled(false);
              }}
            >
              Clear
            </button>
          </div>
        )}
        <Field label="District" name="district" list="dl-district" value={form.district} onChange={(v) => set('district', v)} placeholder="District 1–5…" />
        <DataList id="dl-district" values={districts} />
        <div className="row">
          <Field className="grow" label="Floor" name="floor" inputMode="numeric" value={form.floor} onChange={(v) => set('floor', v)} />
          <Field className="grow" label="Street / aisle" name="street" value={form.street} onChange={(v) => set('street', v)} />
        </div>
        <Field label="Booth number" name="booth" value={form.booth} onChange={(v) => set('booth', v)} placeholder="e.g. 23315" />
      </Section>

      <Section title="Business">
        <Field label="Main product category" name="category" list="dl-category" value={form.category} onChange={(v) => set('category', v)} placeholder="e.g. Phone cases" />
        <DataList id="dl-category" values={categories} />
        <span className="field-label">Supplier type (only if you verified it)</span>
        <Chips<SupplierType> name="supplierType" value={form.supplierType} onChange={(v) => set('supplierType', v)} options={(Object.keys(TYPE_LABELS) as SupplierType[]).map((k) => ({ value: k, label: TYPE_LABELS[k] }))} />
        <Select<SupplierStatus> label="Status" name="status" value={form.status} onChange={(v) => set('status', v)} options={(Object.keys(STATUS_LABELS) as SupplierStatus[]).map((k) => ({ value: k, label: STATUS_LABELS[k] }))} />
        <TextArea label="Notes" name="notes" value={form.notes} onChange={(v) => set('notes', v)} placeholder="Quality, attitude, packaging, customisation, lead time…" />
      </Section>

      <Section title={<button type="button" className="linkbtn" onClick={() => setShowMore(!showMore)}>{showMore ? '▾' : '▸'} Follow-up, rating & more</button>}>
        {showMore && (
          <>
            <span className="field-label">My rating (your own impression)</span>
            <Stars size="lg" value={form.rating} onChange={(v) => set('rating', v)} />
            <div className="row">
              <Field className="grow" label="Follow-up date" type="date" name="followUpDate" value={form.followUpDate ?? ''} onChange={(v) => set('followUpDate', v || null)} />
            </div>
            <Field label="Follow-up task" name="followUpNote" value={form.followUpNote} onChange={(v) => set('followUpNote', v)} placeholder="e.g. Send logo file, ask for sample price" />
            <Field label="Email" name="email" type="email" inputMode="email" value={form.email} onChange={(v) => set('email', v)} />
            <TextArea label="Location notes" name="locationNotes" rows={2} value={form.locationNotes} onChange={(v) => set('locationNotes', v)} placeholder="Near gate 5, corner shop…" />
            {id && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={async () => {
                  const c = prompt('Change supplier ID (must be unique):', code);
                  if (!c || c === code) return;
                  try {
                    await flush();
                    await changeSupplierCode(id, c);
                    setCode(c.trim());
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                Change supplier ID
              </button>
            )}
          </>
        )}
      </Section>

      <div className="actionbar">
        {id && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={async () => {
              await flush();
              navigate(`/p/new?supplier=${id}`);
            }}
          >
            + Product
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline"
          data-testid="save-next"
          onClick={async () => {
            const saved = await flush();
            if (saved) toast(`${code} saved`);
            navigate(`/add?n=${Date.now()}`);
          }}
        >
          Save & next
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="done"
          onClick={async () => {
            const saved = await flush();
            navigate(saved ? `/s/${saved}` : '/', true);
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function useSupplier(id: string | undefined): Supplier | undefined | null {
  return useLiveQuery(async () => (id ? ((await db.suppliers.get(id)) ?? null) : null), [id]);
}
