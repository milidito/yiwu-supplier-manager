// Local stand-in for the Supabase API gateway:
//   /rest/v1/*    -> real PostgREST (+ real Postgres with the real RLS policies from supabase/schema.sql)
//   /auth/v1/*    -> tiny password auth that issues HS256 JWTs (Supabase Auth itself is not under test)
//   /storage/v1/* -> in-memory object store enforcing the same "<user_id>/..." folder rule as the SQL policies
import http from 'node:http';
import crypto from 'node:crypto';

const SECRET = process.env.JWT_SECRET;
const PGRST = process.env.PGRST_URL || 'http://127.0.0.1:3010';
const USERS = {
  'milad@example.com': { id: 'aaaaaaaa-0000-4000-8000-000000000001', pw: 'pass-milad-123' },
  'other@example.com': { id: 'bbbbbbbb-0000-4000-8000-000000000002', pw: 'pass-other-123' },
};
const files = new Map();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload);
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verify(auth) {
  const t = (auth || '').replace(/^Bearer /, '');
  const [h, p, s] = t.split('.');
  if (!s) return null;
  const ok = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') === s;
  if (!ok) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url'));
  return c.role === 'authenticated' ? c : null;
}
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
function json(res, code, o) { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const buf = await body(req);
  try {
    if (url.pathname.startsWith('/rest/v1/')) {
      const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
      const r = await fetch(PGRST + url.pathname.slice(8) + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : buf });
      const out = Buffer.from(await r.arrayBuffer());
      const h = Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(k)));
      res.writeHead(r.status, { ...h, ...cors }); return res.end(out);
    }
    if (url.pathname === '/auth/v1/settings') return json(res, 200, { external: {} });
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(buf.toString() || '{}');
      const u = USERS[b.email];
      if (!u || u.pw !== b.password) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: b.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return json(res, 200, { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: b.email, exp }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + u.id, user });
    }
    if (url.pathname === '/auth/v1/user') {
      const c = verify(req.headers.authorization);
      if (!c) return json(res, 401, { msg: 'invalid token' });
      return json(res, 200, { id: c.sub, aud: 'authenticated', role: 'authenticated', email: c.email, app_metadata: {}, user_metadata: {} });
    }
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
    if (url.pathname.startsWith('/storage/v1/object')) {
      const c = verify(req.headers.authorization);
      if (!c) return json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'not signed in' });
      if (url.pathname.startsWith('/storage/v1/object/list/')) {
        const { prefix = '' } = JSON.parse(buf.toString() || '{}');
        if (prefix.split('/')[0] !== c.sub) return json(res, 200, []);
        const items = [...files.entries()]
          .filter(([k]) => k.startsWith(prefix + '/') && !k.slice(prefix.length + 1).includes('/'))
          .map(([k, f]) => ({ name: k.slice(prefix.length + 1), id: crypto.randomUUID(), created_at: f.at, metadata: { size: f.data.length } }))
          .sort((a, b) => b.name.localeCompare(a.name));
        return json(res, 200, items);
      }
      let rest = url.pathname.replace(/^\/storage\/v1\/object\/(authenticated\/)?/, '');
      if (req.method === 'DELETE') {
        const prefixes = JSON.parse(buf.toString()).prefixes || [];
        for (const p of prefixes) if (p.split('/')[0] === c.sub) files.delete(p);
        return json(res, 200, prefixes.map((name) => ({ name })));
      }
      const [bucket, ...parts] = rest.split('/');
      const path = decodeURIComponent(parts.join('/'));
      if (bucket !== 'supplier-photos' || path.split('/')[0] !== c.sub) return json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      if (req.method === 'POST' || req.method === 'PUT') {
        if (files.has(path) && req.headers['x-upsert'] !== 'true') return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        let data = buf, type = req.headers['content-type'];
        const m = /multipart\/form-data;\s*boundary=(.+)$/.exec(type || '');
        if (m) {
          // supabase-js sends Blobs as multipart form data (like real Supabase Storage expects): extract the file part
          const boundary = Buffer.from('--' + m[1].replace(/^"|"$/g, ''));
          let pos = 0; const parts = [];
          while ((pos = buf.indexOf(boundary, pos)) !== -1) { const next = buf.indexOf(boundary, pos + boundary.length); if (next === -1) break; parts.push(buf.subarray(pos + boundary.length + 2, next - 2)); pos = next; }
          for (const part of parts) {
            const sep = part.indexOf('\r\n\r\n');
            const head = part.subarray(0, sep).toString();
            if (/filename=|content-type/i.test(head) && !/name="cacheControl"/.test(head)) { data = part.subarray(sep + 4); type = (/content-type:\s*(.+)/i.exec(head) || [])[1] || 'application/octet-stream'; }
          }
        }
        files.set(path, { data, type, at: new Date().toISOString() });
        return json(res, 200, { Key: `${bucket}/${path}`, Id: crypto.randomUUID() });
      }
      if (req.method === 'GET') {
        const f = files.get(path);
        if (!f) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        res.writeHead(200, { 'content-type': f.type || 'application/octet-stream', ...cors }); return res.end(f.data);
      }
    }
    if (url.pathname === '/__files') return json(res, 200, [...files.keys()]);
    json(res, 404, { msg: 'not found ' + url.pathname });
  } catch (e) { json(res, 500, { msg: String(e) }); }
}).listen(54321, '127.0.0.1', () => console.log('gateway on 54321'));
