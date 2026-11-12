import { useEffect, useState } from 'react';

/** Minimal hash router: works on any static host and from the home-screen app with no server config. */
export interface Route {
  path: string; // e.g. "/s/123"
  query: URLSearchParams;
  raw: string;
}

function parse(): Route {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || ''), raw: h };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

let depth = 0;

export function navigate(to: string, replace = false) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    depth++;
    window.location.hash = target;
  }
}

/** Go back inside the app if possible, otherwise to `fallback`. */
export function back(fallback = '/') {
  if (depth > 0) {
    depth--;
    history.back();
  } else navigate(fallback, true);
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
