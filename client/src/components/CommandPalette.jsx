import { CornerDownLeft, Gauge, Map as MapIcon, Network, Search, ShieldCheck, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { StatusBadge } from './common';

const VIEWS = [
  { kind: 'view', tab: 'map', label: 'Meters map', icon: MapIcon },
  { kind: 'view', tab: 'network', label: 'Network & load', icon: Network },
  { kind: 'view', tab: 'issues', label: 'Data quality', icon: ShieldCheck },
];

/**
 * Ctrl/⌘+K quick jump to any meter, transformer or view.
 * `onPick` receives { kind: 'meter', id } | { kind: 'transformer', id } | { kind: 'view', tab }.
 */
export function CommandPalette({ open, onClose, onPick }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [meters, setMeters] = useState([]);
  const [transformers, setTransformers] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
    if (transformers.length === 0) api.transformers().then((r) => setTransformers(r.data), () => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced) return setMeters([]);
    let current = true;
    api.meters({ q: debounced, pageSize: 6 }).then((r) => current && setMeters(r.data), () => {});
    return () => {
      current = false;
    };
  }, [debounced]);

  const items = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return VIEWS;
    const dts = transformers.filter((t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)).slice(0, 5);
    return [
      ...meters.map((m) => ({ kind: 'meter', id: m.meterId, meter: m })),
      ...dts.map((t) => ({ kind: 'transformer', id: t.code, dt: t })),
      ...VIEWS.filter((v) => v.label.toLowerCase().includes(q)),
    ];
  }, [debounced, meters, transformers]);

  useEffect(() => setActive(0), [items]);

  if (!open) return null;

  const pick = (item) => {
    onPick(item);
    onClose();
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && items[active]) {
      pick(items[active]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette card" role="dialog" aria-label="Quick search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a meter ID, serial, transformer or view…"
            aria-label="Search"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {items.length === 0 && <li className="palette-empty">No matches for “{debounced}”</li>}
          {items.map((item, i) => (
            <li
              key={`${item.kind}-${item.id ?? item.tab}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
            >
              <PaletteRow item={item} />
              {i === active && <CornerDownLeft size={14} className="palette-enter" />}
            </li>
          ))}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({ item }) {
  if (item.kind === 'meter') {
    const m = item.meter;
    return (
      <>
        <span className="palette-icon">
          <Gauge size={16} />
        </span>
        <span className="palette-main">
          <strong>{m.meterId}</strong>
          <small>
            {m.make} · serial {m.serialNo} · {m.transformerCode}
          </small>
        </span>
        <StatusBadge status={m.status} />
      </>
    );
  }
  if (item.kind === 'transformer') {
    return (
      <>
        <span className="palette-icon">
          <Zap size={16} />
        </span>
        <span className="palette-main">
          <strong>{item.dt.name}</strong>
          <small>
            {item.dt.code} · {item.dt.capacityKva} kVA · {item.dt.meterCount} meters
          </small>
        </span>
      </>
    );
  }
  const Icon = item.icon;
  return (
    <>
      <span className="palette-icon">
        <Icon size={16} />
      </span>
      <span className="palette-main">
        <strong>{item.label}</strong>
        <small>Go to view</small>
      </span>
    </>
  );
}
