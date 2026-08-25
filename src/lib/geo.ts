import * as turf from "@turf/turf";

/**
 * Section 25/57: attendance must validate location + accuracy against a
 * geofence, and never trust a single poor-accuracy GPS reading blindly.
 */
export const MIN_ACCEPTABLE_ACCURACY_METERS = 100; // beyond this we ask the user to move to open sky and retry
export const ACCURACY_BUFFER_METERS = 30; // add reported GPS accuracy to the allowed radius, generously

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const from = turf.point([a.lng, a.lat]);
  const to = turf.point([b.lng, b.lat]);
  return turf.distance(from, to, { units: "meters" });
}

export function isWithinGeofence(
  point: { lat: number; lng: number; accuracy: number },
  fence: { lat: number; lng: number; radiusMeters: number }
): { within: boolean; distance: number; effectiveRadius: number } {
  const distance = distanceMeters(point, fence);
  // be generous: allow for the device's own reported uncertainty rather than
  // rejecting a genuine on-site check-in because of a noisy GPS fix
  const effectiveRadius = fence.radiusMeters + Math.min(point.accuracy, ACCURACY_BUFFER_METERS * 2);
  return { within: distance <= effectiveRadius, distance, effectiveRadius };
}

export function isAccuracyAcceptable(accuracy: number) {
  // A GPS fix reporting 0m accuracy is an excellent (not invalid) reading —
  // only reject negative/garbage values or genuinely low-precision fixes.
  return accuracy >= 0 && accuracy <= MIN_ACCEPTABLE_ACCURACY_METERS;
}

/** Walk-the-boundary capture -> polygon area/perimeter (section 34). Approximate — never a legal survey. */
export function computeBoundaryStats(points: { lat: number; lng: number }[]) {
  if (points.length < 3) return { areaSqFt: null, perimeterFt: null };
  const coords = points.map((p) => [p.lng, p.lat]);
  coords.push(coords[0]); // close the ring
  const polygon = turf.polygon([coords]);
  const areaSqMeters = turf.area(polygon);
  const line = turf.lineString(coords);
  const perimeterMeters = turf.length(line, { units: "meters" });
  return {
    areaSqFt: Math.round(areaSqMeters * 10.7639),
    perimeterFt: Math.round(perimeterMeters * 3.28084),
  };
}

export function metersToFeet(m: number) {
  return Math.round(m * 3.28084);
}
