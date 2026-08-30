/**
 * Small 2D geometry helpers used by the DXF classifier — kept dependency-
 * free (no turf here; this operates in raw project-space millimeters, not
 * lat/lng, so turf's geodesic math doesn't apply).
 */

export type Pt = { x: number; y: number };

export function dist(a: Pt, b: Pt) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Angle of the segment a->b, folded into [0, PI) so a line and its reverse are "the same" direction. */
export function normalizedAngle(a: Pt, b: Pt) {
  const raw = Math.atan2(b.y - a.y, b.x - a.x);
  let n = raw % Math.PI;
  if (n < 0) n += Math.PI;
  return n;
}

/** Perpendicular distance from point p to the infinite line through a-b. */
export function pointToLineDistance(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Projects p onto the infinite line through a-b, returning the scalar distance along a->b (can be negative or beyond the segment). */
export function projectScalar(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

export function bbox(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function centroid(points: Pt[]): Pt {
  const n = points.length || 1;
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / n, y: sum.y / n };
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(p: Pt, polygon: Pt[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersects = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isClosed(points: Pt[], tolerance = 1) {
  if (points.length < 3) return false;
  return dist(points[0], points[points.length - 1]) <= tolerance;
}
