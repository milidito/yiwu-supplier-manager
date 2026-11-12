import { useEffect, useState } from 'react';
import { type PreparedPhotos, preparePhotos, SHARE_BATCH, sharePrepared } from '../devicePhotos';
import { isIos } from './hooks';
import { toast } from './components';

let openFn: ((ids: string[]) => void) | null = null;

/** Opens the "Save to Photos" sheet for these photos (first SHARE_BATCH of them). */
export function openSaveToPhotos(ids: string[]) {
  openFn?.(ids);
}

export function SaveSheetHost() {
  const [ids, setIds] = useState<string[] | null>(null);
  const [prepared, setPrepared] = useState<PreparedPhotos | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    openFn = (list) => {
      setIds(list);
      setPrepared(null);
      setError(null);
    };
    return () => {
      openFn = null;
    };
  }, []);
  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    preparePhotos(ids)
      .then((p) => !cancelled && setPrepared(p))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [ids]);
  if (!ids) return null;
  const more = ids.length > SHARE_BATCH ? ids.length - SHARE_BATCH : 0;
  return (
    <div className="sheet-backdrop" onClick={() => setIds(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Save to Photos" data-testid="save-sheet">
        <h2>Save to iPhone Photos</h2>
        {error && <div className="small err">{error}</div>}
        {!prepared && !error && <div className="small">Preparing {Math.min(ids.length, SHARE_BATCH)} photo(s) with supplier-ID labels…</div>}
        {prepared && (
          <>
            <div className="small">
              {prepared.files.length} photo(s) ready, each labelled with the supplier ID and booth.
              {isIos() ? ' In the next screen tap “Save N Images” (or “Save to Files” if it is not shown).' : ''}
              {more ? ` ${more} more will remain for the next round.` : ''}
            </div>
            <button
              className="btn btn-primary btn-big"
              data-testid="save-sheet-go"
              disabled={!prepared.files.length}
              onClick={async () => {
                try {
                  const r = await sharePrepared(prepared);
                  if (r === 'shared') toast('Sent to the share sheet');
                  if (r === 'downloaded') toast('Photos downloaded as .zip');
                  setIds(null);
                } catch (e) {
                  setError(`Could not open the share sheet: ${(e as Error).message}`);
                }
              }}
            >
              ⤓ Save {prepared.files.length} to Photos
            </button>
          </>
        )}
        <button className="btn btn-outline" onClick={() => setIds(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
