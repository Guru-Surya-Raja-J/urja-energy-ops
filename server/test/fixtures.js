/** A meter on DT-001 with a clean path, shaped exactly like a /portal/export row. */
export function rawMeter(meterId, overrides = {}) {
  const { hierarchy, ...rest } = overrides;
  return {
    meterId,
    serialNo: `SE${meterId.slice(-5)}`,
    make: 'Genus',
    phaseType: 'single',
    installStatus: 'Installed',
    installType: 'Whole Current',
    build: 'legacy',
    dtCode: 'DT-001',
    geo: { lat: 26.9, lng: 75.8 },
    ...rest,
    hierarchy: {
      zone: { name: 'Jaipur Zone 1', code: 'Z-01' },
      circle: { name: 'Circle 1', code: 'C-01' },
      division: { name: 'Division 1', code: 'D-01' },
      subdivision: { name: 'Subdivision 1', code: 'SD-01' },
      substation: { name: 'Substation 1', code: 'SS-01' },
      feeder: { name: 'Feeder 1', code: 'F-001' },
      dt: { name: 'Malviya Nagar DT 1', code: 'DT-001' },
      ...hierarchy,
    },
  };
}

export const transformers = [
  { code: 'DT-001', name: 'Malviya Nagar DT 1', feederCode: 'F-001', capacityKva: 100 },
  { code: 'DT-002', name: 'Mansarovar DT 2', feederCode: 'F-002', capacityKva: 63 },
];

const dt2 = {
  zone: { name: 'Jaipur Zone 2', code: 'Z-02' },
  circle: { name: 'Circle 2', code: 'C-02' },
  // D-01 reused under a different circle, as the real portal does
  division: { name: 'Division 1', code: 'D-01' },
  subdivision: { name: 'Subdivision 2', code: 'SD-02' },
  substation: { name: 'Substation 2', code: 'SS-02' },
  feeder: { name: 'Feeder 2', code: 'F-002' },
  dt: { name: 'Mansarovar DT 2', code: 'DT-002' },
};

/** Five meters covering the quirks seen in the real data. */
export const meters = [
  rawMeter('J100000'),
  rawMeter('J100001', { installStatus: 'Faulty', make: 'L&T', hierarchy: { circle: { name: 'Circle 1', code: '' } } }),
  rawMeter('J100002', { installStatus: 'Decommissioned', hierarchy: { feeder: { name: '', code: 'F-001' } } }),
  rawMeter('J100003', { hierarchy: { dt: { name: 'Old Malviya Nagar Xfmr', code: 'DT-001' } } }),
  rawMeter('J100004', { dtCode: 'DT-002', phaseType: 'three', build: 'v2', geo: { lat: 27.0, lng: 75.9 }, hierarchy: dt2 }),
];

const pad = (n) => String(n).padStart(2, '0');

/** Portal-format rows starting 01/06/2026: a cumulative register rising `perStep` kWh each step. */
export function rawReadings({ days, stepMinutes, perStep, start = 1000 }) {
  const rows = [];
  const steps = (days * 1440) / stepMinutes;
  for (let i = 0; i <= steps; i++) {
    const t = new Date(Date.UTC(2026, 5, 1) + i * stepMinutes * 60_000);
    const kwh = start + i * perStep;
    rows.push({
      timestamp: `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
      kwh: kwh.toFixed(2),
      kvah: (kwh * 1.08).toFixed(2),
      voltR: '230',
    });
  }
  return rows;
}
