/** Strip storage-only fields before a meter leaves the API. */
export function toApiMeter(doc) {
  const { _id, geo, searchText, syncId, distanceM, ...meter } = doc;
  return distanceM === undefined ? meter : { ...meter, distanceKm: Math.round(distanceM) / 1000 };
}
