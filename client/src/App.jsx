import { BookOpen, Gauge, Map as MapIcon, Monitor, Moon, Network, Search, ShieldCheck, Sun, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api';
import { CommandPalette } from './components/CommandPalette';
import { Kpi, STATUS_COLOR, STATUSES, StatusBar, StatusLegend, timeAgo } from './components/common';
import { Logo } from './components/Logo';
import { useAsync, useNow, usePoll, useTheme } from './hooks';
import { IssuesView } from './views/IssuesView';
import { MapView } from './views/MapView';
import { NetworkView } from './views/NetworkView';

const TABS = {
  map: { label: 'Meters', icon: MapIcon },
  network: { label: 'Network & load', icon: Network },
  issues: { label: 'Data quality', icon: ShieldCheck },
};

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
];

// The view and selection live in the URL hash, so any meter or transformer can be linked to
// directly: /#map/J100003, /#network/DT-007, /#issues.
function parseHash() {
  const [tab, id] = location.hash.slice(1).split('/');
  return { tab: tab in TABS ? tab : 'map', id: id ? decodeURIComponent(id) : null };
}

const pct = (n, total) => `${Math.round((n / total) * 100)}% of fleet`;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function App() {
  const [route, setRouteState] = useState(parseHash);
  const setRoute = (tab, id = null) => {
    history.replaceState(null, '', `#${tab}${id ? `/${encodeURIComponent(id)}` : ''}`);
    setRouteState({ tab, id });
  };
  const { tab } = route;
  const select = (id) => setRoute(tab, id);

  const theme = useTheme();
  const [statuses, setStatuses] = useState(STATUSES);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const stats = useAsync(() => api.stats(), []);
  const issues = useAsync(() => api.issues(), []);

  // Links inside the app (and the browser's back button) change the hash directly.
  useEffect(() => {
    const onHash = () => setRouteState(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPick = (item) => {
    if (item.kind === 'meter') {
      setStatuses(STATUSES); // make sure the picked meter isn't hidden by a filter
      setRoute('map', item.id);
    } else if (item.kind === 'transformer') setRoute('network', item.id);
    else setRoute(item.tab);
  };

  const filterStatus = (s) => {
    const only = s ? [s] : STATUSES;
    setStatuses((cur) => (s && cur.length === 1 && cur[0] === s ? STATUSES : only));
    if (tab !== 'map') setRoute('map');
  };
  const only = statuses.length === 1 ? statuses[0] : null;

  const s = stats.data;
  const status = s && { installed: s.byStatus.installed ?? 0, faulty: s.byStatus.faulty ?? 0, decommissioned: s.byStatus.decommissioned ?? 0 };

  return (
    <div className="app">
      <header className="top">
        <Logo />
        <nav className="tabs" aria-label="Views">
          {Object.entries(TABS).map(([key, { label, icon: Icon }]) => (
            <button key={key} className={tab === key ? 'on' : ''} onClick={() => setRoute(key)} aria-current={tab === key ? 'page' : undefined}>
              <Icon size={16} />
              <span>{label}</span>
              {key === 'issues' && issues.data && <span className="count-pill">{issues.data.total}</span>}
            </button>
          ))}
        </nav>

        <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
          <Search size={15} />
          <span>Search meters, transformers…</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <div className="top-right">
          <HealthPill />
          <div className="segmented icon-only" role="radiogroup" aria-label="Theme">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={theme.pref === value ? 'on' : ''}
                onClick={() => theme.setPref(value)}
                role="radio"
                aria-checked={theme.pref === value}
                title={`${label} theme`}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
          <a className="docs" href="/api/docs" target="_blank" rel="noreferrer">
            <BookOpen size={15} /> API docs
          </a>
        </div>
      </header>

      {s && (
        <section className="overview">
          <Kpi
            icon={Gauge}
            label="Meters"
            value={s.meters.toLocaleString('en-IN')}
            sub={`${Object.keys(s.byMake).length} makes · ${Object.keys(s.byZone).length} zones`}
            onClick={() => filterStatus(null)}
            active={statuses.length === STATUSES.length && tab === 'map'}
          />
          {STATUSES.map((st) => (
            <Kpi
              key={st}
              dot={STATUS_COLOR[st]}
              label={st[0].toUpperCase() + st.slice(1)}
              value={status[st]}
              sub={pct(status[st], s.meters)}
              onClick={() => filterStatus(st)}
              active={only === st && tab === 'map'}
            />
          ))}
          <Kpi icon={Zap} label="Transformers" value={s.transformers} sub={`~${Math.round(s.meters / s.transformers)} meters each`} onClick={() => setRoute('network')} active={tab === 'network'} />
          <div className="fleet card">
            <span className="kpi-label">Fleet status</span>
            <StatusBar counts={status} />
            <StatusLegend />
          </div>
        </section>
      )}
      {stats.error && <p className="error banner">API unreachable: {stats.error}</p>}

      <main>
        {tab === 'map' && <MapView selectedId={route.id} onSelect={select} statuses={statuses} setStatuses={setStatuses} dark={theme.dark} />}
        {tab === 'network' && <NetworkView selectedCode={route.id} onSelect={select} />}
        {tab === 'issues' && <IssuesView />}
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onPick={onPick} />
    </div>
  );
}

/** Polls /api/health: catalogue age, and whether the last portal sync failed. */
function HealthPill() {
  const health = usePoll(api.health, 60_000);
  const now = useNow();
  const h = health.data;
  const state = health.error ? 'down' : h?.status === 'ok' ? 'ok' : h ? 'degraded' : 'pending';
  const text = { ok: 'Live', degraded: 'Degraded', down: 'API offline', pending: 'Connecting' }[state];
  const title = health.error
    ? `Cannot reach the API: ${health.error}`
    : h?.catalog.lastError
      ? `Last portal sync failed: ${h.catalog.lastError}`
      : h?.catalog.syncedAt
        ? `Catalogue synced from the portal at ${new Date(h.catalog.syncedAt).toLocaleString()}`
        : '';
  return (
    <span className={`health health-${state}`} title={title}>
      <span className="health-dot" />
      <span>{text}</span>
      {h?.catalog.syncedAt && <span className="health-age">· synced {timeAgo(h.catalog.syncedAt, now)}</span>}
    </span>
  );
}
