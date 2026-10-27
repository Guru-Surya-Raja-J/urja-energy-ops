import { LEVELS } from './levels.js';

// Our level name -> key in the portal's export `hierarchy` object.
const RAW_KEY = {
  zone: 'zone',
  circle: 'circle',
  division: 'division',
  subdivision: 'subdivision',
  substation: 'substation',
  feeder: 'feeder',
  transformer: 'dt',
};

const clean = (s) => (s && s.trim() !== '' ? s.trim() : null);
const key = (n) => `${n.code}\u0000${n.name}`;

function rawNode(meter, level) {
  const n = meter.hierarchy[RAW_KEY[level]];
  return { code: clean(n?.code), name: clean(n?.name) };
}

function mostCommon(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const k = keyOf(item);
    const entry = counts.get(k) ?? { item, n: 0 };
    entry.n++;
    counts.set(k, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.item;
}

/**
 * Rebuilds a consistent network path ({ zone: {code, name}, ..., transformer }) for every meter.
 *
 * Observed in the portal: every meter on a transformer shares one path, except that ~5% of
 * records have a single blank code or blank name somewhere, and one transformer carries an
 * alias name on a few meters. So the transformer is the anchor: we take the majority path of
 * its meters, use the transformer master list for the DT itself, and repair blanks from that.
 *
 * Returns { paths: Map<meterId, path>, issues: DataIssue[] }.
 */
export function repairNetwork(meters, transformers) {
  const issues = [];
  const master = new Map(transformers.map((t) => [t.code, t]));

  // Global code<->name dictionaries, only used when a transformer has no complete peer to copy from.
  const nameByCode = new Map();
  const codeByName = new Map();
  for (const m of meters) {
    for (const level of LEVELS) {
      const n = rawNode(m, level);
      if (n.code && n.name) {
        nameByCode.set(`${level}:${n.code}`, n.name);
        codeByName.set(`${level}:${n.name}`, n.code);
      }
    }
  }

  const byTransformer = Map.groupBy(meters, (m) => m.dtCode);
  const paths = new Map();
  for (const [dtCode, group] of byTransformer) {
    const dt = master.get(dtCode);
    if (!dt) {
      issues.push({ type: 'unknown_transformer', code: dtCode, detail: `${group.length} meter(s) reference ${dtCode}, which is not in the transformer list`, repaired: false });
    }

    const canonical = {};
    for (const level of LEVELS) {
      const complete = group.map((m) => rawNode(m, level)).filter((n) => n.code && n.name);
      canonical[level] = mostCommon(complete, key) ?? { code: null, name: null };
    }
    if (dt) {
      canonical.transformer = { code: dt.code, name: dt.name };
      if (canonical.feeder.code && canonical.feeder.code !== dt.feederCode) {
        issues.push({
          type: 'transformer_feeder_mismatch',
          code: dt.code,
          detail: `Transformer list says ${dt.code} is on ${dt.feederCode}; its meters say ${canonical.feeder.code}`,
          repaired: false,
        });
      }
    }

    for (const m of group) {
      const path = {};
      for (const level of LEVELS) {
        path[level] = resolveNode(m.meterId, level, rawNode(m, level), canonical[level], { nameByCode, codeByName }, issues);
      }
      paths.set(m.meterId, path);
    }
  }

  issues.push(...findReusedCodes([...paths.values()]));
  return { paths, issues };
}

function resolveNode(meterId, level, raw, canonical, dict, issues) {
  if (raw.code && raw.name && raw.code === canonical.code && raw.name === canonical.name) return raw;

  if (!raw.code && !raw.name) {
    issues.push({ type: 'missing_code', level, meterId, detail: `${level} is blank; filled from peers on the same transformer`, repaired: !!canonical.code });
    return canonical;
  }

  if (!raw.code) {
    const code = raw.name === canonical.name ? canonical.code : (dict.codeByName.get(`${level}:${raw.name}`) ?? null);
    issues.push({ type: 'missing_code', level, meterId, detail: `${level} "${raw.name}" has no code; inferred ${code ?? 'nothing'}`, repaired: !!code });
    return { code, name: raw.name };
  }

  if (!raw.name) {
    const name = raw.code === canonical.code ? canonical.name : (dict.nameByCode.get(`${level}:${raw.code}`) ?? null);
    issues.push({ type: 'missing_name', level, meterId, code: raw.code, detail: `${level} ${raw.code} has no name; inferred "${name ?? 'nothing'}"`, repaired: !!name });
    return { code: raw.code, name };
  }

  if (raw.code === canonical.code) {
    issues.push({
      type: 'name_conflict',
      level,
      meterId,
      code: raw.code,
      detail: `${level} ${raw.code} is named "${raw.name}" here but "${canonical.name}" elsewhere; using "${canonical.name}"`,
      repaired: true,
    });
    return canonical;
  }

  issues.push({
    type: 'path_conflict',
    level,
    meterId,
    code: raw.code,
    detail: `${level} is ${raw.code} but other meters on the same transformer say ${canonical.code}; kept the meter's own value`,
    repaired: false,
  });
  return raw;
}

/** The same division/subdivision/substation/feeder code shows up under different parents. */
function findReusedCodes(paths) {
  const issues = [];
  for (let i = 1; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    const parentLevel = LEVELS[i - 1];
    const parents = new Map();
    for (const p of paths) {
      const code = p[level].code;
      const parent = p[parentLevel].code;
      if (!code || !parent) continue;
      if (!parents.has(code)) parents.set(code, new Set());
      parents.get(code).add(parent);
    }
    for (const [code, set] of parents) {
      if (set.size > 1) {
        issues.push({
          type: 'code_reused_across_parents',
          level,
          code,
          detail: `${level} ${code} appears under ${set.size} different ${parentLevel}s: ${[...set].sort().join(', ')}`,
          repaired: false,
        });
      }
    }
  }
  return issues;
}

/**
 * Zone -> ... -> transformer tree with meter counts at every node.
 * Node ids are path-scoped ("Z-01/C-04/D-10") because codes alone are not unique.
 */
export function buildHierarchy(meters) {
  const roots = [];
  for (const meter of meters) {
    let siblings = roots;
    const idParts = [];
    for (const level of LEVELS) {
      const node = meter.network[level];
      idParts.push(node.code ?? node.name ?? '?');
      const id = idParts.join('/');
      let child = siblings.find((c) => c.id === id);
      if (!child) {
        child = { id, level, code: node.code, name: node.name, meterCount: 0, statusCounts: { installed: 0, faulty: 0, decommissioned: 0 }, children: [] };
        siblings.push(child);
      }
      child.meterCount++;
      child.statusCounts[meter.status]++;
      siblings = child.children;
    }
  }
  const sort = (nodes) => {
    nodes.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
