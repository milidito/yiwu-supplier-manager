import { useMemo, useState } from 'react';
import { Empty, Header } from '../ui/components';
import { useSuppliers } from '../ui/hooks';
import { SupplierCard, useCoverPhotos } from './SupplierList';

/** Browse suppliers by market location: District → Floor → Street → Booth. */
export function Locations() {
  const suppliers = useSuppliers();
  const covers = useCoverPhotos();
  const [district, setDistrict] = useState('');
  const [booth, setBooth] = useState('');
  const tree = useMemo(() => {
    const m = new Map<string, Map<string, typeof suppliers>>();
    for (const s of suppliers ?? []) {
      if (district && s.district !== district) continue;
      if (booth && !`${s.booth} ${s.street}`.toLowerCase().includes(booth.toLowerCase())) continue;
      const d = s.district || 'No district';
      const f = s.floor ? `Floor ${s.floor}` : 'No floor';
      if (!m.has(d)) m.set(d, new Map());
      const fm = m.get(d)!;
      if (!fm.has(f)) fm.set(f, []);
      fm.get(f)!.push(s);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    return [...m.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([d, fm]) => ({
        d,
        floors: [...fm.entries()]
          .sort(([a], [b]) => cmp(a, b))
          .map(([f, list]) => ({ f, list: list!.sort((a, b) => cmp(`${a.street} ${a.booth}`, `${b.street} ${b.booth}`)) })),
      }));
  }, [suppliers, district, booth]);
  const districts = [...new Set((suppliers ?? []).map((s) => s.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="screen">
      <Header title="Locations" backTo="/more" />
      <div className="chips pad">
        <button className={`chip ${!district ? 'chip-on' : ''}`} onClick={() => setDistrict('')}>
          All
        </button>
        {districts.map((d) => (
          <button key={d} className={`chip ${district === d ? 'chip-on' : ''}`} onClick={() => setDistrict(d)}>
            {d}
          </button>
        ))}
      </div>
      <div className="searchbar">
        <input type="search" placeholder="Booth or street number…" value={booth} onChange={(e) => setBooth(e.target.value)} inputMode="search" />
      </div>
      {suppliers && !suppliers.length && <Empty>No suppliers yet.</Empty>}
      {tree.map(({ d, floors }) => (
        <section key={d} className="card">
          <div className="card-hd">
            <h2>{d}</h2>
            <span className="small muted">{floors.reduce((n, f) => n + f.list.length, 0)}</span>
          </div>
          {floors.map(({ f, list }) => (
            <div key={f}>
              <div className="subhd">{f}</div>
              {list.map((s) => (
                <SupplierCard key={s.id} s={s} photo={covers.get(s.id)} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
