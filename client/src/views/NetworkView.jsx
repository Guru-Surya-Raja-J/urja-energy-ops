import { ChevronDown, ChevronRight, Network, Search, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { Callouts, ErrorNote, fmt, Kpi, Loading, Meter, RangePicker, StatusBadge, StatusBar, StatusLegend } from '../components/common';
import { DailyChart } from '../components/DailyChart';
import { useAsync } from '../hooks';

/** Keep only branches where some node's name or code matches `q`. */
function filterTree(nodes, q) {
  return nodes.flatMap((n) => {
    const self = `${n.name ?? ''} ${n.code ?? ''}`.toLowerCase().includes(q);
    if (self) return [n];
    const children = filterTree(n.children, q);
    return children.length ? [{ ...n, children }] : [];
  });
}

export function NetworkView({ selectedCode: selected, onSelect: setSelected }) {
  const tree = useAsync(() => api.hierarchy(), []);
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const nodes = useMemo(() => (tree.data ? (q ? filterTree(tree.data.data, q) : tree.data.data) : []), [tree.data, q]);

  return (
    <div className="network-layout">
      <section className="tree card">
        <div className="list-head" style={{ marginBottom: 6 }}>
          <span className="eyebrow">
            <Network size={13} /> Network hierarchy
          </span>
          <StatusLegend />
        </div>
        <p className="muted small" style={{ marginBottom: 10 }}>
          Zone → circle → division → subdivision → substation → feeder → transformer, rebuilt from every meter's path.
        </p>
        <div className="search" style={{ marginBottom: 8 }}>
          <Search size={15} />
          <input className="input" placeholder="Filter by name or code, e.g. Feeder 7, Bani Park" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {tree.loading && <Loading what="network" />}
        {tree.error && <ErrorNote error={tree.error} />}
        {q && nodes.length === 0 && <p className="muted small">Nothing matches “{filter}”.</p>}
        <ul>
          {nodes.map((n) => (
            // Re-mount on filter change so matching branches open.
            <TreeNode key={`${n.id}|${q}`} node={n} depth={0} selected={selected} onSelect={setSelected} forceOpen={Boolean(q)} />
          ))}
        </ul>
      </section>
      <section className="detail card">
        {selected ? (
          <TransformerDetail code={selected} />
        ) : (
          <div className="empty">
            <div>
              <span className="empty-icon">
                <Zap size={22} />
              </span>
              <strong>Select a transformer</strong>
              <span className="small">Expand the tree, or filter it, and pick a transformer to see its meters and daily load against capacity.</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const contains = (node, code) => (node.level === 'transformer' ? node.code === code : node.children.some((c) => contains(c, code)));

function TreeNode({ node, depth, selected, onSelect, forceOpen }) {
  // Start expanded at the top level, along the path to a deep-linked transformer, or when filtering.
  const [open, setOpen] = useState(() => forceOpen || depth < 1 || (selected && contains(node, selected)));
  const isLeaf = node.level === 'transformer';
  return (
    <li>
      <div
        className={`node ${isLeaf && selected === node.code ? 'active' : ''} ${isLeaf ? 'leaf' : ''}`}
        onClick={() => (isLeaf ? onSelect(node.code) : setOpen(!open))}
        title={node.id}
      >
        <span className="caret">{isLeaf ? <Zap size={14} /> : open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
        <span className="name">
          <small>{node.level}</small>
          {node.name ?? '(unnamed)'}
        </span>
        <code>{node.code ?? '?'}</code>
        <span className="count">{node.meterCount}</span>
        <StatusBar counts={node.statusCounts} small />
      </div>
      {open && !isLeaf && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} forceOpen={forceOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TransformerDetail({ code }) {
  const [range, setRange] = useState({});
  const dt = useAsync(() => api.transformer(code), [code]);
  const load = useAsync(() => api.transformerLoad(code, range), [code, range.from, range.to]);

  if (dt.loading) return <Loading what="transformer" />;
  if (dt.error) return <ErrorNote error={dt.error} />;
  const t = dt.data;
  const days = load.data?.days ?? [];
  const peak = days.length ? Math.max(...days.map((d) => d.utilizationPct)) : null;
  const totalKwh = days.reduce((s, d) => s + d.kwh, 0);
  const completeDays = days.filter((d) => d.complete);
  const avgDaily = completeDays.length ? completeDays.reduce((s, d) => s + d.kwh, 0) / completeDays.length : null;
  const kwhByMeter = new Map(load.data?.meters.map((m) => [m.meterId, m.kwh]));

  return (
    <div>
      <div className="detail-head">
        <span className="eyebrow">Distribution transformer</span>
        <h2>
          {t.name} <code>{t.code}</code>
        </h2>
        <p className="muted small">
          {t.network ? `${t.network.zone.name} › ${t.network.circle.name} › ${t.network.substation.name} › ` : ''}Feeder {t.feederCode}
        </p>
      </div>

      <div className="kpis-row">
        <Kpi label="Nameplate" value={`${t.capacityKva} kVA`} />
        <Kpi label="Meters" value={t.meterCount} sub={`${t.statusCounts.faulty} faulty · ${t.statusCounts.decommissioned} decom.`} />
        <Kpi label="Energy in window" value={load.data ? `${fmt(totalKwh, 0)} kWh` : '…'} />
        <Kpi label="Peak daily avg load" value={peak !== null ? `${fmt(peak)} %` : '…'} sub="of capacity" />
      </div>

      <h3 className="section-title">Capacity used (busiest day, daily average)</h3>
      {peak !== null && <Meter pct={peak} label="Peak daily average load as % of nameplate" />}

      <h3 className="section-title">Daily energy through this transformer (kWh)</h3>
      <RangePicker value={range} onChange={setRange} />
      {load.loading && <Loading what={`readings for ${t.meterCount} meters (one portal call each on a cold cache)`} />}
      {load.error && <ErrorNote error={load.error} />}
      {load.data && (
        <>
          <DailyChart days={days} average={avgDaily} height={220} />
          <p className="muted small">
            Load % = daily kVAh ÷ 24 h ÷ nameplate kVA. The portal has no peak-demand data, so this is an average; short peaks are invisible.
          </p>
          <Callouts items={load.data.warnings} />
        </>
      )}

      <h3 className="section-title">Meters on this transformer</h3>
      <table>
        <thead>
          <tr>
            <th>Meter</th>
            <th>Make</th>
            <th>Phase</th>
            <th>Status</th>
            <th className="num">kWh in window</th>
          </tr>
        </thead>
        <tbody>
          {t.meters.map((m) => (
            <tr key={m.meterId}>
              <td>
                <strong>{m.meterId}</strong>
              </td>
              <td>{m.make}</td>
              <td>{m.phase}</td>
              <td>
                <StatusBadge status={m.status} />
              </td>
              <td className="num">{fmt(kwhByMeter.get(m.meterId))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
