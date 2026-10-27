import { Maximize2, RotateCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { api } from '../api';
import { Dot, ErrorNote, Loading, STATUS_COLOR, STATUSES, StatusBadge, StatusLegend } from '../components/common';
import { MeterPanel } from '../components/MeterPanel';
import { useAsync } from '../hooks';

const JAIPUR = [26.91, 75.79];
const DRAWER_WIDTH = 420;

// Free OpenStreetMap tiles (no API key). styles.css mutes them, and inverts them in dark mode,
// so the status colours carry the map.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Pans to the selected meter, keeping it clear of the drawer on the right. */
function FlyToMeter({ meter }) {
  const map = useMap();
  useEffect(() => {
    if (!meter) return;
    const zoom = Math.max(map.getZoom(), 14);
    const point = map.project([meter.location.lat, meter.location.lng], zoom).add([DRAWER_WIDTH / 2, 0]);
    map.flyTo(map.unproject(point, zoom), zoom, { duration: 0.6 });
  }, [meter?.meterId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** `statuses` lives in App so the overview tiles can filter the map. */
export function MapView({ selectedId, onSelect, statuses, setStatuses, dark }) {
  const [q, setQ] = useState('');
  const [make, setMake] = useState('');
  const [phase, setPhase] = useState('');
  const [map, setMap] = useState(null);
  const filtered = q || make || phase || statuses.length !== STATUSES.length;
  const resetFilters = () => {
    setQ('');
    setMake('');
    setPhase('');
    setStatuses(STATUSES);
  };

  // The fleet is a few hundred meters, so every match fits in one page; filtering happens in the API.
  const meters = useAsync(() => api.meters({ q, status: statuses.join(','), make, phase, pageSize: 500 }), [q, statuses.join(','), make, phase]);
  const makes = useAsync(() => api.stats().then((s) => Object.keys(s.byMake)), []);
  const rows = meters.data?.data ?? [];
  // Fetched separately so a linked meter still opens when the current filters hide it.
  const selectedMeter = useAsync(() => (selectedId ? api.meter(selectedId) : Promise.resolve(null)), [selectedId]);
  const selected = rows.find((m) => m.meterId === selectedId) ?? selectedMeter.data;
  const setSelected = (m) => onSelect(m?.meterId ?? null);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((m) => m.status === s).length]));

  const toggle = (s) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const markers = useMemo(
    () =>
      rows.map((m) => {
        const isSelected = selected?.meterId === m.meterId;
        return (
          <CircleMarker
            key={m.meterId}
            center={[m.location.lat, m.location.lng]}
            radius={isSelected ? 8 : 5}
            // 2px ring in the surface colour keeps overlapping dots legible.
            pathOptions={{
              fillColor: STATUS_COLOR[m.status],
              fillOpacity: 0.9,
              color: isSelected ? 'var(--accent)' : 'var(--surface)',
              weight: isSelected ? 3 : 1.5,
            }}
            eventHandlers={{ click: () => setSelected(m) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <strong>{m.meterId}</strong> · {m.make} · {m.status} · {m.transformerCode}
            </Tooltip>
          </CircleMarker>
        );
      }),
    [rows, selected],
  );

  return (
    <div className="map-layout">
      <section className="sidebar card">
        <div className="search">
          <Search size={15} />
          <input className="input" placeholder="Filter by meter ID or serial" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chips">
          {STATUSES.map((s) => (
            <label key={s} className={`chip ${statuses.includes(s) ? 'on' : ''}`}>
              <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggle(s)} />
              <Dot color={STATUS_COLOR[s]} />
              {s}
            </label>
          ))}
        </div>
        <div className="row">
          <select value={make} onChange={(e) => setMake(e.target.value)} aria-label="Make">
            <option value="">All makes</option>
            {makes.data?.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Phase">
            <option value="">Any phase</option>
            <option value="single">Single phase</option>
            <option value="three">Three phase</option>
          </select>
        </div>
        {meters.error && <ErrorNote error={meters.error} />}
        <div className="list-head">
          <span className="eyebrow">
            {meters.loading ? 'Loading…' : `${meters.data?.total ?? 0} meters`}
          </span>
          {filtered && (
            <button className="link-btn" onClick={resetFilters}>
              <RotateCcw size={13} /> Reset filters
            </button>
          )}
        </div>
        <ul className="list">
          {rows.map((m) => (
            <li key={m.meterId} className={selected?.meterId === m.meterId ? 'active' : ''} onClick={() => setSelected(m)}>
              <span className="id">{m.meterId}</span>
              <StatusBadge status={m.status} />
              <span className="meta">
                {m.make} · {m.phase}-phase · {m.transformerCode}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="map-wrap">
        {meters.loading && !meters.data ? (
          <Loading what="map" />
        ) : (
          <MapContainer center={JAIPUR} zoom={11} ref={setMap}>
            <TileLayer key={dark ? 'dark' : 'light'} url={TILES} attribution={ATTRIBUTION} maxZoom={19} className={dark ? 'tiles-dark' : 'tiles-light'} />
            {markers}
            <FlyToMeter meter={selected} />
          </MapContainer>
        )}
        {map && rows.length > 0 && (
          <button
            className="map-btn card"
            title="Fit the map to the meters shown"
            onClick={() => map.flyToBounds(rows.map((m) => [m.location.lat, m.location.lng]), { padding: [40, 40], duration: 0.6 })}
          >
            <Maximize2 size={15} /> Fit to results
          </button>
        )}
        <div className="map-legend card">
          <StatusLegend counts={counts} />
        </div>
        {selected && <MeterPanel meter={selected} onClose={() => setSelected(null)} />}
      </section>
    </div>
  );
}
