import { CircleCheck, CircleMinus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { ErrorNote, Loading } from '../components/common';
import { useAsync } from '../hooks';

const EXPLAIN = {
  missing_code: 'A network level had a name but no code. Filled from other meters on the same transformer.',
  missing_name: 'A network level had a code but no name. Filled from other meters on the same transformer.',
  name_conflict: 'The same code carries a different name on some meters. The transformer master list wins.',
  path_conflict: 'A meter disagrees with its transformer peers about a code. Left as-is.',
  transformer_feeder_mismatch: "The transformer list and the transformer's meters disagree about its feeder.",
  code_reused_across_parents: 'The same code appears under several parents, so codes are not globally unique. Informational.',
  unknown_transformer: 'Meters point at a transformer that is not in the transformer list.',
};

const label = (type) => type.replaceAll('_', ' ');

export function IssuesView() {
  const issues = useAsync(() => api.issues(), []);
  const [type, setType] = useState(null);
  if (issues.loading) return <Loading what="data issues" />;
  if (issues.error) return <ErrorNote error={issues.error} />;
  const { byType, data } = issues.data;
  const shown = type ? data.filter((i) => i.type === type) : data;
  const repaired = data.filter((i) => i.repaired).length;

  return (
    <div className="issues">
      <div>
        <span className="eyebrow">
          <ShieldCheck size={13} /> Data quality
        </span>
        <p className="muted" style={{ marginTop: 4 }}>
          {data.length} findings in the portal's data, {repaired} repaired automatically. The API serves the repaired values. Pick a card to filter.
        </p>
      </div>
      <div className="issue-cards">
        {Object.entries(byType).map(([t, n]) => (
          <button key={t} className={`issue-card card ${type === t ? 'on' : ''}`} onClick={() => setType(type === t ? null : t)}>
            <strong>{n}</strong>
            <span>{label(t)}</span>
            <small>{EXPLAIN[t]}</small>
          </button>
        ))}
      </div>
      <div className="table-card card">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Where</th>
              <th>Detail</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i, idx) => (
              <tr key={idx}>
                <td style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{label(i.type)}</td>
                <td>
                  <code>{i.meterId ?? i.code ?? '—'}</code>
                </td>
                <td>{i.detail}</td>
                <td>
                  {i.repaired ? (
                    <span className="tick">
                      <CircleCheck size={14} /> Repaired
                    </span>
                  ) : (
                    <span className="muted tick">
                      <CircleMinus size={14} /> Flagged only
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
