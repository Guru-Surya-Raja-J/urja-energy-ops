import { MongoClient } from 'mongodb';

/*
 * Collections
 *   meters          one doc per meter: the API's Meter shape + _id, geo (GeoJSON, 2dsphere),
 *                   searchText (lower-cased id + serial) and syncId
 *   transformers    one doc per DT from the portal's master list
 *   catalog_state   a single doc { _id: 'catalog', syncedAt, hierarchy, issues, counts }
 *   readings_cache  one doc per (meter, window): normalised readings + daily consumption
 */

// Stale cached readings are still served if the portal is down; Mongo drops them after a day.
const READINGS_HARD_EXPIRY_SECONDS = 24 * 60 * 60;

export async function connect(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  return { client, db: client.db() };
}

export async function getCollections(db) {
  const col = {
    meters: db.collection('meters'),
    transformers: db.collection('transformers'),
    state: db.collection('catalog_state'),
    readings: db.collection('readings_cache'),
  };
  await Promise.all([
    col.meters.createIndex({ geo: '2dsphere' }),
    col.meters.createIndex({ transformerCode: 1 }),
    col.meters.createIndex({ status: 1, make: 1, phase: 1 }),
    col.meters.createIndex({ 'network.feeder.code': 1 }),
    col.readings.createIndex({ fetchedAt: 1 }, { expireAfterSeconds: READINGS_HARD_EXPIRY_SECONDS }),
  ]);
  return col;
}
