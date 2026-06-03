const EARTH_RADIUS_KM = 6371;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points (kilometres).
 * Used as the zero-cost default when no Google Maps key is configured.
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Distance from a guard to a site. Currently Haversine.
 * Phase 2: swap in Google Maps Distance Matrix for driving distance.
 */
export function distanceToSiteKm(guard, site) {
  if (
    guard.lat == null ||
    guard.lng == null ||
    site.lat == null ||
    site.lng == null
  ) {
    return null;
  }
  return haversineKm(guard.lat, guard.lng, site.lat, site.lng);
}
