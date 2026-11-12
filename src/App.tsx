import { Compare } from './screens/Compare';
import { Dashboard } from './screens/Dashboard';
import { Help } from './screens/Help';
import { Trash } from './screens/Trash';
import { Locations } from './screens/Locations';
import { ProductDetail, ProductEditor, ProductsList, QuoteEditor } from './screens/Products';
import { More, Settings, SyncScreen } from './screens/Settings';
import { SupplierDetail } from './screens/SupplierDetail';
import { SupplierEditor } from './screens/SupplierEditor';
import { SupplierList } from './screens/SupplierList';
import { match, navigate, useRoute } from './router';
import { ToastHost } from './ui/components';
import { SaveSheetHost } from './ui/saveSheet';
import { useOnline } from './ui/hooks';

function Screen() {
  const r = useRoute();
  const p = r.path;
  let m: Record<string, string> | null;
  if (p === '/' || p === '') return <Dashboard />;
  if (p === '/add') return <SupplierEditor key={`add-${r.query.get('n') ?? ''}`} isNew />;
  if ((m = match('/s/:id/edit', p))) return <SupplierEditor key={`edit-${m.id}`} id={m.id} isNew={false} />;
  if ((m = match('/s/:id', p))) return <SupplierDetail key={m.id} id={m.id} />;
  if (p === '/suppliers') return <SupplierList initialQuery={r.query.get('q') ?? ''} />;
  if (p === '/products') return <ProductsList />;
  if (p === '/p/new') return <ProductEditor key={`pnew-${r.query.get('supplier')}`} supplierId={r.query.get('supplier') ?? undefined} />;
  if ((m = match('/p/:id/edit', p))) return <ProductEditor key={`pedit-${m.id}`} id={m.id} />;
  if ((m = match('/p/:id', p))) return <ProductDetail key={m.id} id={m.id} />;
  if (p === '/q/new') return <QuoteEditor key={`qnew-${r.query.get('product')}`} productId={r.query.get('product') ?? undefined} />;
  if ((m = match('/q/:id/edit', p))) return <QuoteEditor key={`qedit-${m.id}`} id={m.id} />;
  if (p === '/compare') return <Compare key={r.query.get('q') ?? ''} initialQuery={r.query.get('q') ?? ''} />;
  if (p === '/locations') return <Locations />;
  if (p === '/more') return <More />;
  if (p === '/settings') return <Settings />;
  if (p === '/sync') return <SyncScreen />;
  if (p === '/help') return <Help />;
  if (p === '/trash') return <Trash />;
  return <Dashboard />;
}

function Nav() {
  const { path } = useRoute();
  const active = (prefixes: string[]) => prefixes.some((x) => (x === '/' ? path === '/' : path.startsWith(x)));
  return (
    <nav className="nav">
      <a href="#/" className={active(['/']) ? 'on' : ''}>
        <span>🏠</span>Home
      </a>
      <a href="#/suppliers" className={active(['/suppliers', '/s/']) ? 'on' : ''}>
        <span>📇</span>Suppliers
      </a>
      <button className="nav-add" aria-label="Add supplier" data-testid="nav-add" onClick={() => navigate(`/add?n=${Date.now()}`)}>
        ＋
      </button>
      <a href="#/compare" className={active(['/compare']) ? 'on' : ''}>
        <span>⚖️</span>Compare
      </a>
      <a href="#/more" className={active(['/more', '/settings', '/sync', '/products', '/p/', '/q/', '/locations', '/help', '/trash']) ? 'on' : ''}>
        <span>☰</span>More
      </a>
    </nav>
  );
}

export function App() {
  const online = useOnline();
  return (
    <div className="app">
      {!online && (
        <div className="offline-bar" data-testid="offline-bar">
          Offline — everything is saved on this phone
        </div>
      )}
      <main>
        <Screen />
      </main>
      <Nav />
      <ToastHost />
      <SaveSheetHost />
    </div>
  );
}
