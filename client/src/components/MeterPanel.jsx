import { Check, Copy, Download, LoaderCircle, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, downloadReadingsCsv, LEVELS } from '../api';
import { useAsync } from '../hooks';
import { Callouts, ErrorNote, fmt, Kpi, Loading, RangePicker, StatusBadge } from './common';
import { DailyChart } from './DailyChart';

const INTERVAL_LABEL = { PT30M: 'Half-hourly meter', P1D: 'Daily meter' };

export function MeterPanel({ meter, onClose }) {
  const [range, setRange] = useState({});
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const consumption = useAsync(() => api.consumption(meter.meterId, range), [meter.meterId, range.from, range.to]);
  const c = consumption.data;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(meter.meterId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (e.g. insecure context): nothing useful to do
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadReadingsCsv(meter.meterId, range);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside className="drawer card" aria-label={`Meter ${meter.meterId}`}>
      <header className="drawer-head">
        <div>
          <h2>
            {meter.meterId} <StatusBadge status={meter.status} />
          </h2>
          <p className="muted small">
            {meter.make} · {meter.phase === 'three' ? 'Three' : 'Single'}-phase · {meter.installationType === 'ct_operated' ? 'CT operated' : 'Whole current'}
          </p>
        </div>
        <div className="drawer-actions">
          <button className="icon-btn" onClick={copyId} title="Copy meter ID" aria-label="Copy meter ID">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button className="icon-btn" onClick={exportCsv} disabled={exporting} title="Download readings for this window (CSV)" aria-label="Download readings as CSV">
            {exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
          </button>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X size={17} />
          </button>
        </div>
      </header>
      {exportError && <ErrorNote error={`Export failed: ${exportError}`} />}

      <dl className="facts">
        <div>
          <dt>Serial no.</dt>
          <dd>{meter.serialNo}</dd>
        </div>
        <div>
          <dt>Transformer</dt>
          <dd>
            <a className="inline-link" href={`#network/${encodeURIComponent(meter.transformerCode)}`} title="Open this transformer's load">
              <Zap size={13} /> {meter.transformerCode}
            </a>
          </dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd>
            {meter.location.lat.toFixed(5)}, {meter.location.lng.toFixed(5)}
          </dd>
        </div>
        <div>
          <dt>Record format</dt>
          <dd>{meter.recordFormat}</dd>
        </div>
      </dl>

      <h3 className="section-title">Daily consumption</h3>
      <RangePicker value={range} onChange={setRange} />
      {consumption.loading && <Loading what="consumption" />}
      {consumption.error && <ErrorNote error={consumption.error} />}
      {c && (
        <>
          <div className="kpis-inline">
            <Kpi label="Total in window" value={`${fmt(c.summary.totalKwh)} kWh`} />
            <Kpi label="Average per day" value={`${fmt(c.summary.avgDailyKwh)} kWh`} />
            <Kpi label="Power factor" value={fmt(c.summary.powerFactor, 3)} />
            <Kpi label="Voltage (R phase)" value={c.summary.voltageR ? `${c.summary.voltageR.min}–${c.summary.voltageR.max} V` : '—'} />
          </div>
          {c.days.length > 0 ? (
            <DailyChart days={c.days} average={c.summary.avgDailyKwh} />
          ) : (
            <p className="muted small" style={{ marginTop: 12 }}>
              No consumption in this window.
            </p>
          )}
          <p className="muted small">
            {INTERVAL_LABEL[c.interval] ?? c.interval} · {c.summary.readingCount} readings
            {c.stale && ' · served from cache (portal unavailable)'}
          </p>
          <Callouts items={c.warnings} />
        </>
      )}

      <h3 className="section-title">Network path</h3>
      <ol className="path">
        {LEVELS.map((l) => (
          <li key={l}>
            <span className="lvl">{l}</span>
            <span>{meter.network[l].name ?? '—'}</span>
            <code>{meter.network[l].code ?? '?'}</code>
          </li>
        ))}
      </ol>
    </aside>
  );
}
