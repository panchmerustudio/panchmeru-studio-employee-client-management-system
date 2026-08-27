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

// ---------------------------------------------------------------------------
// Mobile GPS plot measurement / boundary survey (spec: "MOBILE PLOT
// MEASUREMENT & BOUNDARY SURVEY"). Extends the simple tap-to-point boundary
// helpers above with: per-segment length + compass direction, a shape-type
// heuristic, GPS-jump/outlier detection, intelligent point-gating so a
// continuous watchPosition stream doesn't flood storage with near-duplicate
// points, and a few unit conversions the survey UI/report need.
// ---------------------------------------------------------------------------

const COMPASS_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function bearingToCompass(bearing: number): string {
  const deg = (bearing + 360) % 360;
  return COMPASS_LABELS[Math.round(deg / 45) % 8];
}

export type Segment = { fromIndex: number; toIndex: number; label: string; lengthFt: number };

/** Per-edge length + compass direction around the closed ring (section 9/34). */
export function computeSegments(points: { lat: number; lng: number }[]): Segment[] {
  if (points.length < 2) return [];
  const segments: Segment[] = [];
  for (let i = 0; i < points.length; i++) {
    const fromIndex = i;
    const toIndex = (i + 1) % points.length;
    if (points.length === 2 && toIndex === fromIndex) break; // avoid a degenerate self-segment for 2 points
    if (points.length < 3 && toIndex <= fromIndex) break; // don't close the ring for an open 2-point line
    const from = points[fromIndex];
    const to = points[toIndex];
    const lengthM = distanceMeters(from, to);
    const bearing = turf.bearing(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat]));
    segments.push({ fromIndex, toIndex, label: bearingToCompass(bearing), lengthFt: metersToFeet(lengthM) });
  }
  return segments;
}

export type ShapeType = "square" | "rectangle" | "l_shaped" | "irregular";

/**
 * Heuristic shape classification (section 10/34) — approximate, for the
 * on-screen summary only, never a substitute for the actual coordinates.
 * 4 vertices with ~right angles and near-equal opposite sides -> square or
 * rectangle. A non-convex polygon with a modest vertex count -> l_shaped
 * (the common case for interior-design plots with a cut corner/extension).
 * Everything else -> irregular.
 */
export function detectShape(points: { lat: number; lng: number }[]): ShapeType {
  if (points.length < 3) return "irregular";
  const n = points.length;

  const angleAt = (i: number) => {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const v1 = [prev.lng - cur.lng, prev.lat - cur.lat];
    const v2 = [next.lng - cur.lng, next.lat - cur.lat];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const mag1 = Math.hypot(v1[0], v1[1]);
    const mag2 = Math.hypot(v2[0], v2[1]);
    if (mag1 === 0 || mag2 === 0) return 0;
    const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
    return (Math.acos(cos) * 180) / Math.PI;
  };

  const cross = (i: number) => {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const v1 = [cur.lng - prev.lng, cur.lat - prev.lat];
    const v2 = [next.lng - cur.lng, next.lat - cur.lat];
    return v1[0] * v2[1] - v1[1] * v2[0];
  };

  if (n === 4) {
    const angles = points.map((_, i) => angleAt(i));
    const isRightAngled = angles.every((a) => Math.abs(a - 90) <= 12);
    if (isRightAngled) {
      const segments = computeSegments(points);
      const [s0, s1, s2, s3] = segments.map((s) => s.lengthFt);
      const opposite1Close = Math.abs(s0 - s2) <= Math.max(s0, s2) * 0.1;
      const opposite2Close = Math.abs(s1 - s3) <= Math.max(s1, s3) * 0.1;
      if (opposite1Close && opposite2Close) {
        return Math.abs(s0 - s1) <= Math.max(s0, s1) * 0.1 ? "square" : "rectangle";
      }
    }
  }

  if (n <= 8) {
    const crosses = points.map((_, i) => cross(i));
    const signs = crosses.filter((c) => Math.abs(c) > 1e-12).map((c) => Math.sign(c));
    const isConvex = signs.every((s) => s === signs[0]);
    if (!isConvex) return "l_shaped";
  }

  return "irregular";
}

/** Above this implied speed between two consecutive fixes, treat it as an implausible GPS jump, not an actual walked step (section 7). */
export const IMPLAUSIBLE_WALKING_SPEED_MPS = 8; // ~29 km/h — generously above a brisk walk/jog on a plot

export function isGpsJump(
  prev: { lat: number; lng: number; capturedAt: number },
  next: { lat: number; lng: number; capturedAt: number }
): { isJump: boolean; speedMps: number } {
  const distance = distanceMeters(prev, next);
  const elapsedS = Math.max(0.001, (next.capturedAt - prev.capturedAt) / 1000);
  const speedMps = distance / elapsedS;
  return { isJump: speedMps > IMPLAUSIBLE_WALKING_SPEED_MPS, speedMps };
}

/** Point-capture gating (section 3/4) — never blindly append every watchPosition tick. */
export const MIN_CAPTURE_DISTANCE_M = 3; // capture once the user has actually moved this far from the last kept point
export const MAX_CAPTURE_INTERVAL_MS = 8000; // ...or this long has passed while still moving, so slow walking pace isn't starved

export function shouldCapturePoint(opts: {
  isFirstPoint: boolean;
  lastPoint: { lat: number; lng: number; capturedAt: number } | null;
  candidate: { lat: number; lng: number; capturedAt: number };
}): boolean {
  if (opts.isFirstPoint || !opts.lastPoint) return true;
  const distance = distanceMeters(opts.lastPoint, opts.candidate);
  if (distance >= MIN_CAPTURE_DISTANCE_M) return true;
  const elapsedMs = opts.candidate.capturedAt - opts.lastPoint.capturedAt;
  if (elapsedMs >= MAX_CAPTURE_INTERVAL_MS && distance > 0.5) return true; // still slightly moving, not just GPS jitter while stationary
  return false;
}

export function sqFtToSqM(sqFt: number) {
  return sqFt / 10.7639;
}

export function sqFtToAcres(sqFt: number) {
  return sqFt / 43560;
}

export function feetToMeters(ft: number) {
  return ft / 3.28084;
}
