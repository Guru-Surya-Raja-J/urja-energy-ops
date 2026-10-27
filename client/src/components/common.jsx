import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

export const STATUSES = ['installed', 'faulty', 'decommissioned'];

// Status palette: reserved for meter state, always shown next to a text label.
export const STATUS_COLOR = {
  installed: 'var(--good)',
  faulty: 'var(--critical)',
  decommissioned: 'var(--neutral)',
};

export const Dot = ({ color }) => <span className="dot" style={{ background: color }} />;

export function StatusBadge({ status }) {
  return (
    <span className="badge">
      <Dot color={STATUS_COLOR[status]} />
      {status}
    </span>
  );
}

/** Installed / faulty / decommissioned as a segmented bar (2px gaps, no strokes). */
export function StatusBar({ counts, small = false }) {
  const total = STATUSES.reduce((s, k) => s + counts[k], 0) || 1;
  return (
    <span className={`status-bar ${small ? 'small' : ''}`} title={STATUSES.map((s) => `${counts[s]} ${s}`).join(' · ')}>
      {STATUSES.filter((s) => counts[s] > 0).map((s) => (
        <span key={s} style={{ flexGrow: counts[s] / total, background: STATUS_COLOR[s] }} />
      ))}
    </span>
  );
}

export function StatusLegend({ counts }) {
  return (
    <div className="legend">
      {STATUSES.map((s) => (
        <span key={s}>
          <Dot color={STATUS_COLOR[s]} />
          <span style={{ textTransform: 'capitalize' }}>{s}</span>
          {counts && <strong>{counts[s] ?? 0}</strong>}
        </span>
      ))}
    </div>
  );
}

/** Stat tile. With `onClick` it becomes a filter button (`active` marks the applied filter). */
export function Kpi({ label, value, sub, dot, icon: Icon, onClick, active }) {
  const body = (
    <>
      <span className="kpi-label">
        {dot && <Dot color={dot} />}
        {Icon && <Icon size={14} />}
        {label}
      </span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </>
  );
  if (!onClick) return <div className="kpi card">{body}</div>;
  return (
    <button className={`kpi card clickable ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  );
}

/**
 * Window picker. "Latest 7 days" sends no dates (the API's default); "Custom" reveals
 * from/to inputs. `value` is { from?, to? } as YYYY-MM-DD.
 */
export function RangePicker({ value, onChange }) {
  const hasDates = Boolean(value.from || value.to);
  const [custom, setCustom] = useState(hasDates);
  useEffect(() => {
    if (hasDates) setCustom(true);
  }, [hasDates]);

  return (
    <div className="range">
      <div className="segmented">
        <button
          className={!custom ? 'on' : ''}
          onClick={() => {
            setCustom(false);
            onChange({});
          }}
        >
          Latest 7 days
        </button>
        <button className={custom ? 'on' : ''} onClick={() => setCustom(true)}>
          Custom range
        </button>
      </div>
      {custom && (
        <div className="row">
          <input type="date" value={value.from ?? ''} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} aria-label="From" />
          <input type="date" value={value.to ?? ''} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} aria-label="To" />
        </div>
      )}
    </div>
  );
}

/** Horizontal gauge; the fill colour carries severity. */
export function Meter({ pct, label }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = pct >= 90 ? 'var(--critical)' : pct >= 70 ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${clamped}%`, background: color }} />
      </div>
      <div className="meter-scale">
        <span>0%</span>
        <span>70%</span>
        <span>100% of nameplate</span>
      </div>
    </div>
  );
}

export function Callouts({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="callouts">
      {items.map((w) => (
        <li key={w}>
          <TriangleAlert size={15} />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

/** Shared recharts tooltip: value first, then the date. */
export function ChartTooltip({ active, payload, unit, note }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>
        {fmt(payload[0].value, 2)} {unit}
      </strong>
      <span className="muted">{formatDate(p.date)}</span>
      {note?.(p) && <div className="muted small">{note(p)}</div>}
    </div>
  );
}

export const fmt = (n, digits = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: digits }));

export const formatDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const Loading = ({ what }) => (
  <p className="loading muted small">
    <LoaderCircle size={14} className="spin" /> Loading {what}…
  </p>
);

export const ErrorNote = ({ error }) => (
  <p className="error small">
    <TriangleAlert size={14} /> {error}
  </p>
);

/** "just now" / "4 min ago" / "2 h ago". */
export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
