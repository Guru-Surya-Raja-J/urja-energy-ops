import { useEffect, useState } from 'react';

/** Runs `load` whenever `deps` change; ignores responses that arrive after a newer request. */
export function useAsync(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => current && setState({ data, error: null, loading: false }),
      (err) => current && setState({ data: null, error: err.message, loading: false }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPref() {
  try {
    return localStorage.getItem('theme') ?? 'system';
  } catch {
    return 'system';
  }
}

/**
 * Theme preference: 'system' | 'light' | 'dark', remembered per browser.
 * Applies data-theme on <html> (CSS tokens key off it) and returns whether dark is in effect,
 * so non-CSS pieces like the map tiles can follow.
 */
export function useTheme() {
  const [pref, setPref] = useState(readPref);
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);

  useEffect(() => {
    const q = darkQuery();
    const onChange = (e) => setSystemDark(e.matches);
    q.addEventListener('change', onChange);
    return () => q.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (pref === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = pref;
    try {
      localStorage.setItem('theme', pref);
    } catch {
      // storage unavailable (private mode): the preference just won't persist
    }
  }, [pref]);

  return { pref, setPref, dark: pref === 'dark' || (pref === 'system' && systemDark) };
}

/** Re-runs `load` every `ms` and returns the latest result (or the last error). */
export function usePoll(load, ms) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    const tick = () =>
      load().then(
        (data) => alive && setState({ data, error: null }),
        (err) => alive && setState((s) => ({ data: s.data, error: err.message })),
      );
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
  return state;
}

/** Ticks every `ms` so relative times ("3 min ago") stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
