import { describe, expect, it } from 'vitest';
import { toMeter } from '../src/domain/meters.js';
import { buildHierarchy, repairNetwork } from '../src/domain/network.js';
import { meters, transformers } from './fixtures.js';

describe('repairNetwork', () => {
  const { paths, issues } = repairNetwork(meters, transformers);

  it('fills a blank code from peers on the same transformer', () => {
    expect(paths.get('J100001').circle).toEqual({ code: 'C-01', name: 'Circle 1' });
    expect(issues).toContainEqual(expect.objectContaining({ type: 'missing_code', meterId: 'J100001', level: 'circle', repaired: true }));
  });

  it('fills a blank name from peers on the same transformer', () => {
    expect(paths.get('J100002').feeder).toEqual({ code: 'F-001', name: 'Feeder 1' });
    expect(issues).toContainEqual(expect.objectContaining({ type: 'missing_name', meterId: 'J100002', repaired: true }));
  });

  it('uses the transformer master list name over an alias on some meters', () => {
    expect(paths.get('J100003').transformer).toEqual({ code: 'DT-001', name: 'Malviya Nagar DT 1' });
    expect(issues).toContainEqual(expect.objectContaining({ type: 'name_conflict', meterId: 'J100003', level: 'transformer' }));
  });

  it('reports codes that appear under more than one parent', () => {
    expect(issues).toContainEqual(expect.objectContaining({ type: 'code_reused_across_parents', level: 'division', code: 'D-01' }));
  });

  it('leaves clean meters alone', () => {
    expect(issues.filter((i) => i.meterId === 'J100000')).toEqual([]);
  });
});

describe('buildHierarchy', () => {
  it('keeps reused codes apart by scoping node ids to their path', () => {
    const { paths } = repairNetwork(meters, transformers);
    const tree = buildHierarchy(meters.map((m) => toMeter(m, paths.get(m.meterId))));

    expect(tree.map((z) => z.id)).toEqual(['Z-01', 'Z-02']);
    const divisions = tree.map((zone) => zone.children[0].children[0]);
    expect(divisions.map((d) => d.id)).toEqual(['Z-01/C-01/D-01', 'Z-02/C-02/D-01']);
    expect(tree[0]).toMatchObject({ meterCount: 4, statusCounts: { installed: 2, faulty: 1, decommissioned: 1 } });
  });
});
