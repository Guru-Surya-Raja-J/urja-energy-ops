import { STATUSES } from './levels.js';

const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

/** Map a /portal/export row onto our clean meter shape (see Meter in api/schemas.js). */
export function toMeter(raw, network) {
  const status = slug(raw.installStatus);
  if (!STATUSES.includes(status)) {
    throw new Error(`Unknown install status "${raw.installStatus}" on ${raw.meterId}`);
  }
  return {
    meterId: raw.meterId,
    serialNo: raw.serialNo,
    make: raw.make,
    phase: slug(raw.phaseType) === 'three' ? 'three' : 'single',
    status,
    installationType: slug(raw.installType) === 'ct_operated' ? 'ct_operated' : 'whole_current',
    recordFormat: raw.build,
    transformerCode: raw.dtCode,
    network,
    location: { lat: raw.geo.lat, lng: raw.geo.lng },
  };
}
