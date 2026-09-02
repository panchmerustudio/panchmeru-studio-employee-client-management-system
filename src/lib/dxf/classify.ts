import type { IDxf, IBlock, IEntity, ILineEntity, ILwpolylineEntity, IPolylineEntity, IInsertEntity, ICircleEntity, IArcEntity, ITextEntity, IMtextEntity } from "dxf-parser";
import { type Pt, dist, normalizedAngle, pointToLineDistance, projectScalar, bbox, isClosed, pointInPolygon } from "./geometry-utils";

/**
 * DXF -> structured building database (spec section 3/4). Classification is
 * heuristic (layer name + block name conventions) and deliberately
 * conservative: anything the classifier can't confidently identify, or
 * can't measure from the geometry itself, is surfaced as "unclassified" or
 * a missing-input question — never guessed. See the module doc in
 * src/db/schema/cad.ts for the full rationale.
 *
 * Scope (Phase 1): doors/windows/columns/furniture are recognized from CAD
 * BLOCKS (INSERT entities) only — the standard professional convention, and
 * the same "block -> position/scale/rotation" path the spec's own DESK_01
 * example describes. Raw line/arc door-swing symbols that aren't blocks are
 * left unclassified rather than guessed at. Walls are recognized from
 * layer-tagged line/polyline geometry; where two roughly-parallel wall
 * lines are found, their gap gives an exact thickness measurement — a
 * single unpaired wall line has no measurable thickness and is flagged for
 * the user to supply a default (see cadMissingInputs "wall_default_thickness").
 */

const WALL_RE = /wall/i;
const DOOR_RE = /door/i;
const WINDOW_RE = /wind|glaz/i;
const COLUMN_RE = /\bcol(umn)?\b/i;
const STAIR_RE = /stair/i;
const ROOM_RE = /room|area|\bspace\b/i;

// AutoCAD's own internal bookkeeping blocks — anonymous instances it creates
// for hatch/dimension/array associativity, never something a drafter placed
// on purpose. Standard naming conventions: "*U123"/"*D456" for anonymous
// dynamic-block instances, "A$C" + hex handle for anonymous blocks saved to
// disk (the on-disk form of the same thing, e.g. what a hatch's associative
// boundary gets stored as). A real furniture/fixture block is always
// human-named ("sofa", "DESK_01", "Range-Oven - 30 in top"); nothing a user
// intentionally inserts starts with either prefix, so these are always safe
// to treat as internal geometry rather than a placeable real-world object.
const SYSTEM_BLOCK_RE = /^(\*|A\$C)/i;

const MIN_WALL_THICKNESS_MM = 50;
const MAX_WALL_THICKNESS_MM = 600;
// Below this, a "wall" found by line-pairing is almost never a real wall —
// it's a door/window jamb reveal stub, a plaster-return tick mark, or some
// other short drafting artifact that happens to be two roughly-parallel
// lines close together. Real load-bearing/partition walls are essentially
// never physically shorter than this. Keeping these out of the wall count
// (they surface as "unclassified" instead) is what stops a real floor plan
// from rendering as a field of tiny floating slabs at every opening.
const MIN_WALL_LENGTH_MM = 250;
const ANGLE_TOLERANCE_RAD = (2 * Math.PI) / 180;
const MIN_OVERLAP_RATIO = 0.4;
const MAX_UNCLASSIFIED_STORED = 500;
// How far outside the walls' own bounding box a door/window/column/furniture
// block can sit before it's treated as belonging to some other part of the
// same DWG sheet (a schedule, a detail callout, a second floor plan) rather
// than this building — expressed as a fraction of the footprint's larger
// dimension, generous enough to comfortably hold real bay windows/porches on
// an oddly-shaped plan while still catching content that's nowhere near it.
const FOOTPRINT_OUTLIER_MARGIN_RATIO = 0.5;

// Many real-world drawings (this codebase's own reference file among them)
// never insert doors/windows as named BLOCKs at all — a drafter just draws
// a swing arc + jamb line, or a couple of parallel glazing lines, straight
// into the wall gap on a "door"/"window"-named layer. classifyInsert()
// above only ever sees INSERT entities, so those raw strokes previously
// fell through to "unclassified" — meaning no door/window object existed,
// no gap ever got cut in the wall, and the wall rendered as one unbroken
// slab exactly where an opening should be. extractOpeningSymbols() (below)
// recovers these the same way a person reads the drawing: by finding
// clusters of raw line/arc geometry on a door/window layer and measuring
// how far each cluster spans along its nearest wall.
// A door/window symbol's own strokes (jamb tick, swing arc, leaf line, or
// a window's parallel mullion lines) are drawn touching or a few mm/cm
// apart; the real gap to the NEXT opening is a wall's width away at
// minimum — far bigger than this, so it safely merges one symbol's parts
// without merging two separate openings.
const OPENING_SYMBOL_CLUSTER_GAP_MM = 350;
// Sanity bounds so a stray dimension/hatch line that happens to share a
// door/window-named layer can't be misread as a 30mm or 30-meter "opening"
// — real doors/windows the world over fall well inside this range.
const MIN_OPENING_WIDTH_MM = 300;
const MAX_OPENING_WIDTH_MM = 3000;

const ANNOTATION_TYPES = new Set(["DIMENSION", "HATCH", "TEXT", "MTEXT", "POINT", "ATTDEF", "ATTRIB", "VIEWPORT"]);
const GEOMETRIC_TYPES = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "SPLINE", "3DFACE", "SOLID", "ELLIPSE"]);

export type ClassifiedWall = { type: "wall"; layerName: string; handle: string; start: Pt; end: Pt; thicknessMm: number | null };
export type ClassifiedOpening = { type: "door" | "window"; layerName: string; handle: string; label: string; position: Pt; rotationDeg: number; widthMm: number; depthMm: number };
export type ClassifiedColumn = { type: "column"; layerName: string; handle: string; label?: string; position: Pt; rotationDeg: number; widthMm: number; depthMm: number };
export type ClassifiedFurniture = { type: "furniture"; layerName: string; handle: string; label: string; position: Pt; rotationDeg: number; widthMm: number; depthMm: number };
export type ClassifiedRoom = { type: "room"; layerName: string; handle: string; label?: string; points: Pt[] };
export type ClassifiedStair = { type: "stair"; layerName: string; handle: string; points: Pt[] };
export type ClassifiedUnknown = { type: "unclassified"; layerName: string; handle: string; label: string; points: Pt[] };
export type ClassifiedEntity = ClassifiedWall | ClassifiedOpening | ClassifiedColumn | ClassifiedFurniture | ClassifiedRoom | ClassifiedStair | ClassifiedUnknown;

export type ClassificationResult = {
  entities: ClassifiedEntity[];
  entityCounts: Record<string, number>;
  unclassifiedCount: number; // true total, may exceed how many "unclassified" rows were actually stored
  ignoredAnnotationCount: number;
  hasUnpairedWalls: boolean;
  hasDoors: boolean;
  hasWindows: boolean;
};

function scalePt(p: { x: number; y: number }, scale: number): Pt {
  return { x: p.x * scale, y: p.y * scale };
}

function unitPerpendicular(a: Pt, b: Pt) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  return { x: -dy / len, y: dx / len };
}

function signOfSide(p: Pt, a: Pt, b: Pt) {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross >= 0 ? 1 : -1;
}

type WallSeg = { start: Pt; end: Pt; layerName: string; handle: string };

function extractWallSegments(entities: IEntity[], scale: number): WallSeg[] {
  const segs: WallSeg[] = [];
  for (const e of entities) {
    if (!WALL_RE.test(e.layer ?? "")) continue;
    if (e.type === "LINE") {
      const line = e as ILineEntity;
      if (line.vertices?.length >= 2) {
        segs.push({ start: scalePt(line.vertices[0], scale), end: scalePt(line.vertices[1], scale), layerName: e.layer, handle: String(e.handle) });
      }
    } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const poly = e as ILwpolylineEntity | IPolylineEntity;
      const verts = (poly.vertices ?? []).map((v) => scalePt(v, scale));
      for (let i = 0; i < verts.length - 1; i++) {
        segs.push({ start: verts[i], end: verts[i + 1], layerName: e.layer, handle: `${e.handle}-${i}` });
      }
      if ((poly as { shape?: boolean }).shape && verts.length > 2 && dist(verts[0], verts[verts.length - 1]) > 1) {
        segs.push({ start: verts[verts.length - 1], end: verts[0], layerName: e.layer, handle: `${e.handle}-close` });
      }
    }
  }
  return segs;
}

/** Pairs roughly-parallel wall lines into thickness-measured centerline walls; unpaired lines become single-line walls with thicknessMm: null (resolved later from a user-supplied default). */
function pairWallSegments(segments: WallSeg[]): ClassifiedWall[] {
  const used = new Array(segments.length).fill(false);
  const walls: ClassifiedWall[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i] || dist(segments[i].start, segments[i].end) < 10) continue;
    const a = segments[i];
    const aLen = dist(a.start, a.end);
    const angleA = normalizedAngle(a.start, a.end);

    let bestJ = -1;
    let bestThickness = Infinity;

    for (let j = i + 1; j < segments.length; j++) {
      if (used[j]) continue;
      const b = segments[j];
      const bLen = dist(b.start, b.end);
      if (bLen < 10) continue;
      const angleDiff = Math.abs(angleA - normalizedAngle(b.start, b.end));
      if (angleDiff > ANGLE_TOLERANCE_RAD && Math.abs(angleDiff - Math.PI) > ANGLE_TOLERANCE_RAD) continue;

      const thickness = pointToLineDistance(b.start, a.start, a.end);
      if (thickness < MIN_WALL_THICKNESS_MM || thickness > MAX_WALL_THICKNESS_MM) continue;

      const t1 = projectScalar(b.start, a.start, a.end) * aLen;
      const t2 = projectScalar(b.end, a.start, a.end) * aLen;
      const overlapStart = Math.max(0, Math.min(t1, t2));
      const overlapEnd = Math.min(aLen, Math.max(t1, t2));
      const overlap = Math.max(0, overlapEnd - overlapStart);
      if (overlap / Math.min(aLen, bLen) < MIN_OVERLAP_RATIO) continue;

      if (thickness < bestThickness) {
        bestThickness = thickness;
        bestJ = j;
      }
    }

    if (bestJ >= 0) {
      const b = segments[bestJ];
      used[i] = true;
      used[bestJ] = true;

      const t1 = projectScalar(b.start, a.start, a.end);
      const t2 = projectScalar(b.end, a.start, a.end);
      const tStart = Math.max(0, Math.min(t1, t2));
      const tEnd = Math.min(1, Math.max(t1, t2));
      const dirX = a.end.x - a.start.x,
        dirY = a.end.y - a.start.y;
      const atStart = { x: a.start.x + dirX * tStart, y: a.start.y + dirY * tStart };
      const atEnd = { x: a.start.x + dirX * tEnd, y: a.start.y + dirY * tEnd };

      const perp = unitPerpendicular(a.start, a.end);
      const sign = signOfSide(b.start, a.start, a.end);
      const half = bestThickness / 2;
      const off = { x: perp.x * half * sign, y: perp.y * half * sign };

      walls.push({
        type: "wall",
        layerName: a.layerName,
        handle: `${a.handle}+${b.handle}`,
        start: { x: atStart.x + off.x, y: atStart.y + off.y },
        end: { x: atEnd.x + off.x, y: atEnd.y + off.y },
        thicknessMm: Math.round(bestThickness),
      });
    }
  }

  for (let i = 0; i < segments.length; i++) {
    if (used[i] || dist(segments[i].start, segments[i].end) < 10) continue;
    const a = segments[i];
    walls.push({ type: "wall", layerName: a.layerName, handle: a.handle, start: a.start, end: a.end, thicknessMm: null });
  }

  return walls;
}

/**
 * True bounding-box corners of an arc's actual angular sweep, not a full
 * circle around its center. A naive full-circle approximation (the old
 * behavior here) badly over-measures any arc whose sweep is a small slice
 * of its circle — found via a real furniture block ("WC") in a real DWG
 * file that pairs a small toilet-outline polyline with an oversized
 * decorative/clearance arc (radius ~1465 drawing units): treated as a full
 * circle, that arc alone inflated the block's measured bbox from a
 * realistic fixture size to 3+ meters wide. Angles are radians here,
 * matching both dxf-parser's real ARC.startAngle/endAngle output (it
 * converts DXF's raw degree group codes to radians on parse) and the DWG
 * adapter's passthrough (see from-dwg.ts — unlike INSERT.rotation, DWG's
 * raw ARC angles are already radians, so no conversion was needed there).
 * Falls back to the old full-circle approximation when angle data is
 * missing/invalid, so entities without real sweep info keep prior behavior.
 */
function arcBoundingPoints(center: Pt, radius: number, startAngle: number | undefined, endAngle: number | undefined): Pt[] {
  if (startAngle == null || endAngle == null || !Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
    return [
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius },
    ];
  }
  const TWO_PI = Math.PI * 2;
  const start = ((startAngle % TWO_PI) + TWO_PI) % TWO_PI;
  let end = ((endAngle % TWO_PI) + TWO_PI) % TWO_PI;
  if (end <= start) end += TWO_PI;
  const pts: Pt[] = [
    { x: center.x + radius * Math.cos(start), y: center.y + radius * Math.sin(start) },
    { x: center.x + radius * Math.cos(end), y: center.y + radius * Math.sin(end) },
  ];
  for (const axis of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    let a = axis;
    while (a < start) a += TWO_PI;
    if (a <= end) pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

function collectEntityPoints(e: IEntity, out: Pt[]) {
  switch (e.type) {
    case "LINE":
      (e as ILineEntity).vertices?.forEach((v) => out.push({ x: v.x, y: v.y }));
      break;
    case "LWPOLYLINE":
      (e as ILwpolylineEntity).vertices?.forEach((v) => out.push({ x: v.x, y: v.y }));
      break;
    case "POLYLINE":
      (e as IPolylineEntity).vertices?.forEach((v) => out.push({ x: v.x, y: v.y }));
      break;
    case "CIRCLE": {
      const c = e as ICircleEntity;
      if (c.center) out.push({ x: c.center.x - c.radius, y: c.center.y - c.radius }, { x: c.center.x + c.radius, y: c.center.y + c.radius });
      break;
    }
    case "ARC": {
      const a = e as IArcEntity & { center: { x: number; y: number }; radius: number };
      if (a.center) out.push(...arcBoundingPoints(a.center, a.radius, a.startAngle, a.endAngle));
      break;
    }
    default:
      break;
  }
}

const OPENING_SYMBOL_ENTITY_TYPES = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE"]);

/**
 * Recovers door/window openings drawn as raw line/arc geometry on a
 * door/window-named layer instead of as a BLOCK — see the module doc on
 * OPENING_SYMBOL_CLUSTER_GAP_MM above for why this exists. `walls` must
 * already be the same measurement-true wall list classifyDxf builds in
 * step 1, since an opening's width/position here are measured directly
 * against its host wall's own line, exactly like a real opening is always
 * physically coplanar with its wall (the same principle the 3D builder
 * uses to fix a door/window's rotation — see build-scene.ts's buildOpening
 * doc). Consumes the entities it uses from `consumed` so they aren't also
 * counted as generic unclassified geometry afterwards.
 */
function extractOpeningSymbols(entities: IEntity[], walls: ClassifiedWall[], scale: number, consumed: Set<IEntity>): ClassifiedEntity[] {
  const candidates = entities.filter((e) => OPENING_SYMBOL_ENTITY_TYPES.has(e.type) && !consumed.has(e) && (DOOR_RE.test(e.layer ?? "") || WINDOW_RE.test(e.layer ?? "")));
  if (candidates.length === 0 || walls.length === 0) return [];

  const pointsByEntity = candidates.map((e) => {
    const pts: Pt[] = [];
    collectEntityPoints(e, pts);
    return pts.map((p) => scalePt(p, scale));
  });

  // Union-find: any two candidate entities with a point pair closer than
  // OPENING_SYMBOL_CLUSTER_GAP_MM are strokes of the same physical symbol.
  const parent = candidates.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  function anyClose(a: Pt[], b: Pt[]) {
    for (const pa of a) for (const pb of b) if (dist(pa, pb) < OPENING_SYMBOL_CLUSTER_GAP_MM) return true;
    return false;
  }
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (anyClose(pointsByEntity[i], pointsByEntity[j])) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  candidates.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });

  const openings: ClassifiedEntity[] = [];
  for (const idxs of groups.values()) {
    const groupEntities = idxs.map((i) => candidates[i]);
    const groupPoints = idxs.flatMap((i) => pointsByEntity[i]);
    if (groupPoints.length < 2) continue;

    const cx = groupPoints.reduce((s, p) => s + p.x, 0) / groupPoints.length;
    const cy = groupPoints.reduce((s, p) => s + p.y, 0) / groupPoints.length;
    const centroid = { x: cx, y: cy };

    let bestWall: ClassifiedWall | null = null;
    let bestDist = Infinity;
    for (const w of walls) {
      const t = projectScalar(centroid, w.start, w.end);
      if (t < -0.15 || t > 1.15) continue; // well outside this wall's own span
      const d = pointToLineDistance(centroid, w.start, w.end);
      if (d < bestDist) {
        bestDist = d;
        bestWall = w;
      }
    }
    if (!bestWall) continue; // no nearby wall to host this — leave for the general unclassified pass
    // Real hand-drawn symbols are rarely drawn perfectly on the wall's own
    // centerline (sill ticks, swing-direction marks, and reveal lines
    // routinely sit a further stroke or two off it) — generous enough to
    // catch those without reaching across a room to a wall that isn't
    // actually this opening's host.
    if (bestDist > (bestWall.thicknessMm ?? 300) + 900) continue;

    // Width = how far the symbol's own points spread ALONG the host wall's
    // direction, clamped to the wall's own extent — not the cluster's raw
    // bbox diagonal, which a door's swing arc would inflate well past the
    // true opening width. Both ends are clamped into [0,1] BEFORE taking
    // the difference (not clamped independently after Math.min/Math.max —
    // that inverts the order into a bogus negative width whenever the
    // whole cluster projects past one end of the wall) and the result is
    // floored at 0 so a cluster that lands entirely off the wall's own
    // span reads as "no width" and gets rejected by the sanity bounds
    // below, not as a nonsensical negative one.
    const wallLen = dist(bestWall.start, bestWall.end) || 1e-6;
    const ts = groupPoints.map((p) => projectScalar(p, bestWall!.start, bestWall!.end));
    const tMin = Math.min(1, Math.max(0, Math.min(...ts)));
    const tMax = Math.min(1, Math.max(0, Math.max(...ts)));
    const widthMm = Math.max(0, tMax - tMin) * wallLen;
    if (widthMm < MIN_OPENING_WIDTH_MM || widthMm > MAX_OPENING_WIDTH_MM) continue;

    const midT = (tMin + tMax) / 2;
    const dx = bestWall.end.x - bestWall.start.x,
      dy = bestWall.end.y - bestWall.start.y;
    const position = { x: bestWall.start.x + dx * midT, y: bestWall.start.y + dy * midT };

    // A swing arc is the near-universal AutoCAD convention for "this is a
    // door" — far more reliable than the layer name alone (this file's own
    // door/window layer is literally named "door and window"). Fall back
    // to the layer name only when no arc is present (a typical window
    // symbol: parallel glazing lines, no arc).
    const hasArc = groupEntities.some((e) => e.type === "ARC" || e.type === "CIRCLE");
    const layerName = groupEntities[0].layer ?? "";
    const type: "door" | "window" = hasArc ? "door" : WINDOW_RE.test(layerName) ? "window" : "door";

    for (const e of groupEntities) consumed.add(e);
    openings.push({
      type,
      layerName,
      handle: String(groupEntities[0].handle),
      label: `drawn on "${layerName}"`,
      position,
      rotationDeg: 0,
      widthMm: Math.round(widthMm),
      depthMm: 50,
    });
  }
  return openings;
}

/** Bounding box of a block's own local geometry, in the block's raw (un-normalized) drawing units — the insert's scale + our unit normalization are applied by the caller. */
function blockLocalBBox(block: IBlock | undefined) {
  if (!block) return null;
  const pts: Pt[] = [];
  for (const e of block.entities ?? []) collectEntityPoints(e, pts);
  return bbox(pts);
}

function classifyInsert(insert: IInsertEntity, blocks: Record<string, IBlock>, scale: number): ClassifiedEntity {
  const layer = insert.layer ?? "";
  const name = insert.name ?? "unnamed block";
  const handle = String(insert.handle);
  const position = scalePt(insert.position ?? { x: 0, y: 0 }, scale);
  const rotationDeg = insert.rotation ?? 0;

  if (SYSTEM_BLOCK_RE.test(name)) {
    return { type: "unclassified", layerName: layer, handle, label: `Internal AutoCAD block "${name}" (hatch/dimension associativity, not a real object)`, points: [position] };
  }

  const raw = blockLocalBBox(blocks[insert.name]);
  const rawWidth = raw ? raw.maxX - raw.minX : 0;
  const rawDepth = raw ? raw.maxY - raw.minY : 0;

  if (!raw || rawWidth < 1 || rawDepth < 1) {
    return { type: "unclassified", layerName: layer, handle, label: `Block "${name}" has no measurable geometry`, points: [position] };
  }

  const widthMm = Math.round(rawWidth * Math.abs(insert.xScale ?? 1) * scale);
  const depthMm = Math.round(rawDepth * Math.abs(insert.yScale ?? 1) * scale);

  const isDoor = DOOR_RE.test(name) || DOOR_RE.test(layer);
  const isWindow = !isDoor && (WINDOW_RE.test(name) || WINDOW_RE.test(layer));
  const isColumn = !isDoor && !isWindow && (COLUMN_RE.test(name) || COLUMN_RE.test(layer));

  if (isDoor || isWindow) {
    return { type: isDoor ? "door" : "window", layerName: layer, handle, label: name, position, rotationDeg, widthMm, depthMm };
  }
  if (isColumn) {
    return { type: "column", layerName: layer, handle, label: name, position, rotationDeg, widthMm, depthMm };
  }
  return { type: "furniture", layerName: layer, handle, label: name, position, rotationDeg, widthMm, depthMm };
}

function extractClosedPolylines(entities: IEntity[], scale: number, layerTest: RegExp) {
  const results: { points: Pt[]; layerName: string; handle: string }[] = [];
  for (const e of entities) {
    if (!layerTest.test(e.layer ?? "")) continue;
    if (e.type !== "LWPOLYLINE" && e.type !== "POLYLINE") continue;
    const poly = e as ILwpolylineEntity | IPolylineEntity;
    const verts = (poly.vertices ?? []).map((v) => scalePt(v, scale));
    if (verts.length < 3) continue;
    if ((poly as { shape?: boolean }).shape || isClosed(verts, 5)) {
      results.push({ points: verts, layerName: e.layer, handle: String(e.handle) });
    }
  }
  return results;
}

function collectTexts(entities: IEntity[], scale: number) {
  const texts: { text: string; position: Pt }[] = [];
  for (const e of entities) {
    if (e.type === "TEXT") {
      const t = e as ITextEntity;
      if (t.text && t.startPoint) texts.push({ text: t.text.trim(), position: scalePt(t.startPoint, scale) });
    } else if (e.type === "MTEXT") {
      const t = e as IMtextEntity;
      if (t.text && t.position) texts.push({ text: t.text.trim().replace(/\\P/g, " "), position: scalePt(t.position, scale) });
    }
  }
  return texts;
}

export function classifyDxf(dxf: IDxf, scale: number, opts?: { excludeHandles?: Set<string> }): ClassificationResult {
  // excludeHandles lets a caller remove an already-identified elevation
  // view's own entities before plan-view classification runs — see
  // extractElevationViews' doc above. Without this, an elevation's own
  // line/arc texture work (drawn on the same "wall"-named layer as real
  // walls, in at least one real reference file) gets mis-paired into
  // bogus "walls" that don't belong to any real floor plan.
  const excludeHandles = opts?.excludeHandles;
  const entities = (dxf.entities ?? []).filter((e) => !excludeHandles?.has(String(e.handle)));
  const blocks = dxf.blocks ?? {};
  const consumed = new Set<IEntity>();
  const out: ClassifiedEntity[] = [];

  // 1. Walls (line-pairing for thickness). Segments too short to be a real
  // wall (see MIN_WALL_LENGTH_MM's doc — jamb reveals, plaster returns,
  // other short line-pair artifacts) are kept out of the wall count and
  // surfaced as unclassified instead of silently dropped.
  const wallSegs = extractWallSegments(entities, scale);
  const pairedWalls = pairWallSegments(wallSegs);
  const walls = pairedWalls.filter((w) => dist(w.start, w.end) >= MIN_WALL_LENGTH_MM);
  const tinyWallFragments = pairedWalls.filter((w) => dist(w.start, w.end) < MIN_WALL_LENGTH_MM);
  out.push(...walls);
  for (const t of tinyWallFragments) {
    out.push({
      type: "unclassified",
      layerName: t.layerName,
      handle: t.handle,
      label: `Wall fragment too short to be a real wall (${Math.round(dist(t.start, t.end))}mm — likely a jamb/reveal line, not a wall)`,
      points: [t.start, t.end],
    });
  }
  for (const e of entities) {
    if (WALL_RE.test(e.layer ?? "") && (e.type === "LINE" || e.type === "LWPOLYLINE" || e.type === "POLYLINE")) consumed.add(e);
  }

  // The walls' own bounding box anchors "where this building actually is" —
  // used below to catch door/window/column/furniture blocks that belong to
  // some other part of the same DWG sheet (a schedule, a detail callout, a
  // second floor plan sharing the same modelspace) rather than this one.
  const wallFootprint = bbox(walls.flatMap((w) => [w.start, w.end]));
  const footprintMarginMm = wallFootprint
    ? Math.max(wallFootprint.maxX - wallFootprint.minX, wallFootprint.maxY - wallFootprint.minY) * FOOTPRINT_OUTLIER_MARGIN_RATIO
    : 0;
  function withinFootprint(p: Pt): boolean {
    if (!wallFootprint) return true; // no wall geometry to anchor against — don't filter
    return (
      p.x >= wallFootprint.minX - footprintMarginMm &&
      p.x <= wallFootprint.maxX + footprintMarginMm &&
      p.y >= wallFootprint.minY - footprintMarginMm &&
      p.y <= wallFootprint.maxY + footprintMarginMm
    );
  }

  // 2. Rooms (closed polylines on a room/area layer) + label from any TEXT/MTEXT inside.
  const texts = collectTexts(entities, scale);
  const roomPolys = extractClosedPolylines(entities, scale, ROOM_RE);
  for (const r of roomPolys) {
    out.push({ type: "room", layerName: r.layerName, handle: r.handle, label: texts.find((t) => pointInPolygon(t.position, r.points))?.text, points: r.points });
  }

  // 3. Stairs (closed polylines on a stair layer) — simplified footprint mass, not individual treads.
  const stairPolys = extractClosedPolylines(entities, scale, STAIR_RE);
  for (const s of stairPolys) {
    out.push({ type: "stair", layerName: s.layerName, handle: s.handle, points: s.points });
  }
  for (const e of entities) {
    if ((ROOM_RE.test(e.layer ?? "") || STAIR_RE.test(e.layer ?? "")) && (e.type === "LWPOLYLINE" || e.type === "POLYLINE")) consumed.add(e);
  }

  let hasDoors = false;
  let hasWindows = false;

  // 3b. Doors/windows drawn as raw line/arc geometry (swing arc, jamb tick,
  // parallel glazing lines) on a door/window-named layer instead of as a
  // BLOCK — see extractOpeningSymbols' doc. Runs before the BLOCK-based
  // pass below so a file that mixes both styles doesn't double-count.
  const geometryOpenings = extractOpeningSymbols(entities, walls, scale, consumed);
  for (const o of geometryOpenings) {
    if (o.type === "door") hasDoors = true;
    if (o.type === "window") hasWindows = true;
    out.push(o);
  }

  // 4. Doors/windows/columns/furniture — from CAD blocks (see module doc).
  for (const e of entities) {
    if (e.type !== "INSERT") continue;
    consumed.add(e);
    const classified = classifyInsert(e as IInsertEntity, blocks, scale);
    if (classified.type === "door" || classified.type === "window" || classified.type === "column" || classified.type === "furniture") {
      if (!withinFootprint(classified.position)) {
        out.push({
          type: "unclassified",
          layerName: classified.layerName,
          handle: classified.handle,
          label: `${classified.label} (far outside the building's walls — likely a different drawing/schedule on the same sheet)`,
          points: [classified.position],
        });
        continue;
      }
      if (classified.type === "door") hasDoors = true;
      if (classified.type === "window") hasWindows = true;
    }
    out.push(classified);
  }

  // 5. Everything else: annotation types are expected clutter (dimensions, hatches, text) and are
  // just counted; remaining geometric entities are surfaced as "unclassified" for manual review
  // rather than silently dropped.
  let ignoredAnnotationCount = 0;
  let unclassifiedCount = 0;
  for (const e of entities) {
    if (consumed.has(e)) continue;
    if (ANNOTATION_TYPES.has(e.type)) {
      ignoredAnnotationCount++;
      continue;
    }
    if (!GEOMETRIC_TYPES.has(e.type)) continue;
    unclassifiedCount++;
    if (unclassifiedCount <= MAX_UNCLASSIFIED_STORED) {
      const pts: Pt[] = [];
      collectEntityPoints(e, pts);
      out.push({ type: "unclassified", layerName: e.layer ?? "0", handle: String(e.handle), label: e.type, points: pts.map((p) => scalePt(p, scale)) });
    }
  }
  // Unmeasurable block instances (already pushed as "unclassified" in step 4) also count toward the total.
  unclassifiedCount += out.filter((o) => o.type === "unclassified" && o.label.startsWith('Block "')).length;
  // Same for the three exclusion categories pushed directly to `out` in
  // steps 1 and 4 (short wall fragments, AutoCAD system blocks, and
  // footprint outliers) — they're excluded with confidence, not merely
  // "couldn't tell what this is", but the "N entities couldn't be
  // confidently classified" total should still reflect that they exist.
  unclassifiedCount +=
    tinyWallFragments.length +
    out.filter((o) => o.type === "unclassified" && (o.label.startsWith("Internal AutoCAD block") || o.label.includes("far outside the building's walls"))).length;

  const entityCounts: Record<string, number> = {};
  for (const o of out) entityCounts[o.type] = (entityCounts[o.type] ?? 0) + 1;

  return {
    entities: out,
    entityCounts,
    unclassifiedCount,
    ignoredAnnotationCount,
    hasUnpairedWalls: walls.some((w) => w.thicknessMm == null),
    hasDoors,
    hasWindows,
  };
}

/*
  ---- Drawing-type sanity check: floor plan vs. elevation/section ----
  Everything above only knows how to build 3D from a PLAN-VIEW floor
  layout — walls seen from directly above, with doors/windows cut into
  them. A section (a vertical cut-through) uses a completely different
  drafting convention — no walkable wall network at all — and forcing one
  through the plan-view classifier above wouldn't produce a wrong model,
  it'd produce an empty or near-empty one with no obvious explanation why.
  Real architectural sheets conventionally title each view with a large
  TEXT/MTEXT label near it ("FRONT ELEVATION", "SECTION A-A", ...) — that's
  a reliable signal, but only paired with confirming the plan-view
  classifier above found essentially no usable wall structure. A sheet
  that has BOTH a floor plan and, say, a small elevation inset always
  keeps being modeled normally, because the wall-count half of this check
  won't fire — this only ever blocks a sheet that's actually unusable
  as-is, never one that merely mentions "elevation"/"section" somewhere.

  Elevation specifically is no longer a hard rejection — see
  extractElevationViews below, which builds a real (if simplified) 3D
  facade panel from an elevation view instead. detectNonPlanDrawing stays
  as the fallback: a genuine section-only sheet still has nothing this
  codebase can build from, and an elevation-titled sheet whose geometry
  extractElevationViews couldn't confidently isolate (see its own doc)
  falls back to this same clear rejection rather than silently producing
  nothing.
*/
const ELEVATION_TITLE_RE = /\belevations?\b/i;
const SECTION_TITLE_RE = /\bsection\s+[a-z]\s*[-–—]\s*[a-z]\b|\bcross[\s-]section\b/i;

/**
 * MTEXT stores its own inline rich-text formatting codes right in the
 * string (font/color/height/underline switches, `{...}` grouping) — a
 * title is very often written as e.g. `\A1;{\fStylus BT|...;\LGROUND FLOOR
 * PLAN}`, not the plain "GROUND FLOOR PLAN" a `\b...\b` keyword regex
 * expects. Left unstripped, a keyword that happens to sit immediately
 * after a formatting code with no space between them (`\LGROUND`,
 * `\LFIRST` — both real, from the same reference file) silently fails
 * every `\bkeyword\b` match, because \b only fires at a transition between
 * a word character and a non-word one, and the formatting code's own
 * letter (the "L" in `\L`) IS a word character. This strips the common
 * codes (alignment/font/color/height/paragraph-break/underline-etc.
 * toggles and the `{}` grouping) down to the plain visible text, so
 * keyword matching sees what a person reading the drawing would.
 */
function cleanMTextLabel(raw: string): string {
  return raw
    .replace(/\\P/g, " ")
    .replace(/\\A\d+;/g, "")
    .replace(/\\f[^;]*;/gi, "")
    .replace(/\\C\d+;/g, "")
    .replace(/\\H[\d.]+x?;/gi, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}
const MIN_WALLS_FOR_PLAN_VIEW = 2;

export function detectNonPlanDrawing(dxf: IDxf, result: ClassificationResult): string | null {
  if ((result.entityCounts.wall ?? 0) >= MIN_WALLS_FOR_PLAN_VIEW) return null; // real plan-view wall structure was found — model it, whatever else is on the sheet

  for (const e of dxf.entities ?? []) {
    let raw: string | undefined;
    if (e.type === "TEXT") raw = (e as ITextEntity).text;
    else if (e.type === "MTEXT") raw = (e as IMtextEntity).text;
    if (!raw) continue;
    const clean = cleanMTextLabel(raw);
    if (ELEVATION_TITLE_RE.test(clean) || SECTION_TITLE_RE.test(clean)) {
      return `This looks like an elevation or section drawing ("${clean}"), not a floor plan — no usable wall layout was found on it. The 3D modeler builds from a plan-view floor layout (walls, doors, and windows seen from directly above); upload that drawing instead, or export just the floor plan sheet as its own DXF.`;
    }
  }
  return null;
}

/*
  ---- Elevation view -> flat facade panel ----
  A DWG/DXF sheet very often carries more than one view in one shared
  modelspace — a floor plan AND a front elevation, sometimes literally
  spatially interleaved rather than tucked in a tidy corner (confirmed
  against a real reference file: an elevation's own dense line/arc
  texture work sat immediately next to that same building's room labels,
  with nothing as simple as "everything left of X is the elevation").
  What DOES reliably separate one drawn view from another is DRAWING
  CONNECTIVITY, not raw distance from a title: within one view, entities
  sit close enough to visually touch/nearly-touch; between two different
  views on the same sheet, there's a real gap — even when both sit inside
  the same loose neighborhood. clusterEntitiesByProximity below groups
  entities into connected components using a tight real-world gap
  (ELEVATION_CLUSTER_GAP_MM), verified against that same reference file to
  cleanly split a 2686-entity elevation cluster (zero room-label text
  inside it) from separate, smaller clusters that DID contain real room
  labels — where a much looser "how far from the title text" radius had
  wrongly swept nearly the whole drawing into one blob.

  What this deliberately does NOT attempt: INTERPRETING the elevation's
  raw line/arc soup — deciding which strokes form a roofline vs. a gate
  vs. a cornice vs. a stone-course texture, or reconstructing multi-storey
  floor divisions (unreliable and drafting-style-dependent — see the
  module-level "never invented, only measured" principle). The panel's
  SHAPE is the elevation's own measured bounding rectangle, and its door/
  window CUTOUTS come only where the source file tags them with a
  recognizable door/window block/layer name — a file that draws elevation
  openings as bare, untagged line rectangles (as the same reference file
  does) gets no guessed cutout there.
  What this DOES do (see extractElevationStrokes below): every real line/
  arc/polyline stroke the architect actually drew inside the elevation's
  own cluster — window/door arches, balcony rails, gate bars, moldings,
  cornices, jaali/grille patterns, whatever it is — is carried through
  verbatim as its own exact coordinates and rendered on the panel's face,
  with no interpretation of what any of it depicts. A file that never
  tags a door/window as a block (so `openings` stays empty) can still
  show its actual drawn door/window/gate/balcony shapes this way, because
  they were real ARC/LINE/LWPOLYLINE geometry in the file all along —
  this pipeline just used to throw that geometry away once the bounding
  box was measured. Dimension-annotation entities (tick marks, extension
  lines — layer names matching ANNOTATION_LAYER_RE) are excluded from
  this trace since they're measurement notation, not drawn facade detail.
*/
export type ElevationOpening = { xMm: number; zMm: number; widthMm: number; heightMm: number; kind: "door" | "window" };
export type ElevationStroke = { x1: number; y1: number; x2: number; y2: number };
export type ElevationView = { widthMm: number; heightMm: number; openings: ElevationOpening[]; strokes: ElevationStroke[]; memberHandles: Set<string> };
// Entities whose layer marks them as dimensioning/hatch annotation rather
// than real drawn facade artwork — confirmed against the reference file's
// own "dim1" layer, which is small-radius tick-mark arcs (~12-15 raw units,
// a few hundred mm) at dimension line ends, not building geometry.
const ANNOTATION_LAYER_RE = /dim|hatch/i;
// ~10° per tessellated arc segment — fine enough that even the reference
// file's smallest decorative curves (radius as low as ~1mm) still read as
// curves rather than facets, cheap enough for a file with 1000+ arcs.
const ARC_TESSELLATION_STEP_RAD = (10 * Math.PI) / 180;
// Hard cap so one pathological file can't hand the browser an unbounded
// line-segment buffer — the reference file's real elevation (1734 member
// entities, ~1200 of them arcs) comes in well under this.
const MAX_ELEVATION_STROKES = 20000;

function tessellateArc(center: Pt, radius: number, startAngle: number, endAngle: number, closed: boolean): Pt[] {
  let span = closed ? 2 * Math.PI : endAngle - startAngle;
  if (!closed) {
    while (span <= 0) span += 2 * Math.PI;
    while (span > 2 * Math.PI) span -= 2 * Math.PI;
  }
  const segments = Math.min(64, Math.max(3, Math.ceil(span / ARC_TESSELLATION_STEP_RAD)));
  const pts: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (span * i) / segments;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

function pointsToSegmentPairs(pts: Pt[], closed: boolean): [Pt, Pt][] {
  const segs: [Pt, Pt][] = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  return segs;
}

/**
 * Every real LINE/LWPOLYLINE/POLYLINE/ARC/CIRCLE stroke in the cluster,
 * reduced to straight segments in the panel's own local mm frame (same
 * bottom-left-origin convention as ElevationOpening's xMm/zMm) — see this
 * function's use in measureElevationCluster and the module doc above for
 * why this is a faithful trace, not an interpretation. Polyline bulges
 * (an arc segment embedded in a polyline) are intentionally NOT honored —
 * that vertex pair is drawn as a straight line rather than skipped or
 * guessed at, a small, honest simplification rather than a fabrication.
 */
function extractElevationStrokes(cluster: IEntity[], box: { minX: number; minY: number }, scale: number): ElevationStroke[] {
  const strokes: ElevationStroke[] = [];
  for (const e of cluster) {
    if (strokes.length >= MAX_ELEVATION_STROKES) break;
    if (ANNOTATION_LAYER_RE.test(e.layer ?? "")) continue;

    let segs: [Pt, Pt][] = [];
    if (e.type === "LINE") {
      const v = (e as ILineEntity).vertices ?? [];
      if (v.length >= 2) segs = [[v[0], v[1]]];
    } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const v = (e as ILwpolylineEntity).vertices ?? (e as unknown as IPolylineEntity).vertices ?? [];
      segs = pointsToSegmentPairs(v, isClosed(v));
    } else if (e.type === "ARC") {
      const a = e as IArcEntity;
      if (a.center && typeof a.radius === "number") segs = pointsToSegmentPairs(tessellateArc(a.center, a.radius, a.startAngle ?? 0, a.endAngle ?? 2 * Math.PI, false), false);
    } else if (e.type === "CIRCLE") {
      const c = e as ICircleEntity;
      if (c.center && typeof c.radius === "number") segs = pointsToSegmentPairs(tessellateArc(c.center, c.radius, 0, 2 * Math.PI, true), true);
    } else {
      continue;
    }

    for (const [p1, p2] of segs) {
      const s1 = scalePt(p1, scale);
      const s2 = scalePt(p2, scale);
      strokes.push({ x1: Math.round(s1.x - box.minX), y1: Math.round(s1.y - box.minY), x2: Math.round(s2.x - box.minX), y2: Math.round(s2.y - box.minY) });
      if (strokes.length >= MAX_ELEVATION_STROKES) break;
    }
  }
  return strokes;
}

// Real-world millimeters. Two entities within this gap of each other count
// as the same drawn view; found empirically (see module doc above) — loose
// enough to hold one view's own genuinely separate strokes (a window sill
// line a few hundred mm from its head line) while still stopping well short
// of the gap to an unrelated view/schedule/detail on the same sheet.
const ELEVATION_CLUSTER_GAP_MM = 1500;
// A cluster smaller than this in either dimension isn't a real building
// elevation — almost certainly a stray detail/symbol that happened to
// contain (or sit beside) matching title text.
const MIN_ELEVATION_SIZE_MM = 1000;
// A closed rectangle this small, on an otherwise door/window-named layer,
// isn't the opening itself — a sill line or mullion detail drawn on the
// same layer, not the door/window's own outer frame.
const MIN_OPENING_RECT_SIZE_MM = 100;
// "A door reaches the floor, a window doesn't" — see the doc where this is
// used, below.
const DOOR_FLOOR_TOUCH_TOLERANCE_MM = 150;

function entityClusterPoints(e: IEntity): Pt[] {
  switch (e.type) {
    case "LINE":
      return (e as ILineEntity).vertices ?? [];
    case "LWPOLYLINE":
      return (e as ILwpolylineEntity).vertices ?? [];
    case "POLYLINE":
      return (e as IPolylineEntity).vertices ?? [];
    case "CIRCLE":
    case "ARC": {
      const a = e as IArcEntity & { center: Pt; radius: number };
      if (!a.center) return [];
      return [a.center, { x: a.center.x + a.radius, y: a.center.y }, { x: a.center.x - a.radius, y: a.center.y }, { x: a.center.x, y: a.center.y + a.radius }, { x: a.center.x, y: a.center.y - a.radius }];
    }
    case "INSERT": {
      const p = (e as IInsertEntity).position;
      return p ? [p] : [];
    }
    case "TEXT": {
      const p = (e as ITextEntity).startPoint;
      return p ? [p] : [];
    }
    case "MTEXT": {
      const p = (e as IMtextEntity).position;
      return p ? [p] : [];
    }
    default:
      return [];
  }
}

/**
 * Groups entities into connected components by physical proximity in real
 * millimeters (scale-aware) — two entities are in the same group if any of
 * their own points come within `gapMm` of each other, transitively. Grid-
 * bucketed (cell size = gapMm) so it stays fast on a few thousand entities
 * instead of the naive O(n²) every-pair comparison.
 */
function clusterEntitiesByProximity(entities: IEntity[], scale: number, gapMm: number): IEntity[][] {
  const n = entities.length;
  const pts = entities.map((e) => entityClusterPoints(e).map((p) => scalePt(p, scale)));

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const cellKey = (x: number, y: number) => `${Math.floor(x / gapMm)},${Math.floor(y / gapMm)}`;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const p of pts[i]) {
      const k = cellKey(p.x, p.y);
      const bucket = buckets.get(k);
      if (bucket) bucket.push(i);
      else buckets.set(k, [i]);
    }
  }

  for (let i = 0; i < n; i++) {
    if (pts[i].length === 0) continue;
    const candidates = new Set<number>();
    for (const p of pts[i]) {
      const bx = Math.floor(p.x / gapMm),
        by = Math.floor(p.y / gapMm);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
            if (j > i) candidates.add(j);
          }
        }
      }
    }
    for (const j of candidates) {
      let close = false;
      for (const p1 of pts[i]) {
        for (const p2 of pts[j]) {
          if (dist(p1, p2) < gapMm) {
            close = true;
            break;
          }
        }
        if (close) break;
      }
      if (close) union(i, j);
    }
  }

  const groups = new Map<number, IEntity[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(entities[i]);
    else groups.set(r, [entities[i]]);
  }
  return [...groups.values()];
}

/**
 * Shared by both extraction strategies below: measures one cluster of
 * entities (already decided to belong to a single elevation view, however
 * that decision was made) into a real ElevationView — its bounding
 * rectangle plus any door/window openings the source file itself tags via
 * a recognizable block/layer name. Returns null for a cluster too small to
 * plausibly be a real building elevation (MIN_ELEVATION_SIZE_MM) rather
 * than a stray detail/symbol.
 */
function measureElevationCluster(cluster: IEntity[], blocks: Record<string, IBlock>, scale: number): ElevationView | null {
  const pts = cluster.flatMap((e) => entityClusterPoints(e).map((p) => scalePt(p, scale)));
  const box = bbox(pts);
  if (!box) return null;
  const widthMm = box.maxX - box.minX;
  const heightMm = box.maxY - box.minY;
  if (widthMm < MIN_ELEVATION_SIZE_MM || heightMm < MIN_ELEVATION_SIZE_MM) return null;

  const openings: ElevationOpening[] = [];
  for (const e of cluster) {
    if (e.type !== "INSERT") continue;
    const insert = e as IInsertEntity;
    const name = insert.name ?? "";
    const layer = insert.layer ?? "";
    if (SYSTEM_BLOCK_RE.test(name)) continue;
    const isDoor = DOOR_RE.test(name) || DOOR_RE.test(layer);
    const isWindow = !isDoor && (WINDOW_RE.test(name) || WINDOW_RE.test(layer));
    if (!isDoor && !isWindow) continue;
    const raw = blockLocalBBox(blocks[name]);
    if (!raw) continue;
    const rawWidth = raw.maxX - raw.minX;
    const rawHeight = raw.maxY - raw.minY; // the block's own local "depth" axis reads as height in an elevation view
    if (rawWidth < 1 || rawHeight < 1) continue;
    const pos = scalePt(insert.position ?? { x: 0, y: 0 }, scale);
    openings.push({
      xMm: Math.round(pos.x - box.minX),
      zMm: Math.round(pos.y - box.minY),
      widthMm: Math.round(rawWidth * Math.abs(insert.xScale ?? 1) * scale),
      heightMm: Math.round(rawHeight * Math.abs(insert.yScale ?? 1) * scale),
      kind: isDoor ? "door" : "window",
    });
  }

  // A drawing doesn't always tag its openings as named INSERT blocks (the
  // loop above) — a real reference file draws each window/door as a plain
  // closed rectangle directly on its own "door and window" layer, no block
  // involved at all. This reads the SAME layer-name signal the plan-view
  // classifier already trusts for doors/windows (DOOR_RE/WINDOW_RE),
  // applied here to the elevation's own closed rectangles instead of block
  // instances — still reading what the file itself calls the layer, not
  // guessing at the geometry's purpose. Kept alongside the strokes below
  // (not excluded from them) rather than instead of them: the rectangle
  // still traces as a raised outline (its frame), while ALSO cutting a real
  // opening through the panel here, instead of a solid wall with a
  // decorative outline on it.
  //
  // A layer that names BOTH categories together ("door and window", the
  // real example this was built for) can't be told apart by name alone —
  // DOOR_RE and WINDOW_RE both match it. Rather than guess from the name,
  // this falls back to another real measurement instead of an assumption:
  // a door reaches the floor, a window doesn't — so a rectangle whose own
  // bottom edge sits within a hand's width of this elevation's ground line
  // is called a door, everything else a window.
  for (const rect of extractClosedPolylines(cluster, scale, /door|wind|glaz/i)) {
    const rectBox = bbox(rect.points);
    if (!rectBox) continue;
    const rectWidthMm = rectBox.maxX - rectBox.minX;
    const rectHeightMm = rectBox.maxY - rectBox.minY;
    if (rectWidthMm < MIN_OPENING_RECT_SIZE_MM || rectHeightMm < MIN_OPENING_RECT_SIZE_MM) continue;
    const isDoorOnly = DOOR_RE.test(rect.layerName) && !WINDOW_RE.test(rect.layerName);
    const isWindowOnly = WINDOW_RE.test(rect.layerName) && !DOOR_RE.test(rect.layerName);
    const zMm = rectBox.minY - box.minY;
    const touchesFloor = zMm <= DOOR_FLOOR_TOUCH_TOLERANCE_MM;
    openings.push({
      xMm: Math.round(rectBox.minX - box.minX),
      zMm: Math.round(zMm),
      widthMm: Math.round(rectWidthMm),
      heightMm: Math.round(rectHeightMm),
      kind: isDoorOnly ? "door" : isWindowOnly ? "window" : touchesFloor ? "door" : "window",
    });
  }

  const strokes = extractElevationStrokes(cluster, box, scale);

  return { widthMm: Math.round(widthMm), heightMm: Math.round(heightMm), openings, strokes, memberHandles: new Set(cluster.map((e) => String(e.handle))) };
}

export function extractElevationViews(dxf: IDxf, scale: number): ElevationView[] {
  const entities = dxf.entities ?? [];
  const blocks = dxf.blocks ?? {};

  const titleHandles = new Set<string>();
  for (const e of entities) {
    let raw: string | undefined;
    if (e.type === "TEXT") raw = (e as ITextEntity).text;
    else if (e.type === "MTEXT") raw = (e as IMtextEntity).text;
    if (!raw) continue;
    const clean = cleanMTextLabel(raw);
    // A sheet that titles a view "SECTION THROUGH ELEVATION" or similar is
    // rare and ambiguous enough to just leave to the detectNonPlanDrawing
    // fallback rather than guess at a section as if it were an elevation.
    if (ELEVATION_TITLE_RE.test(clean) && !SECTION_TITLE_RE.test(clean)) titleHandles.add(String(e.handle));
  }
  if (titleHandles.size === 0) return [];

  const clusters = clusterEntitiesByProximity(entities, scale, ELEVATION_CLUSTER_GAP_MM);
  const views: ElevationView[] = [];
  for (const cluster of clusters) {
    if (!cluster.some((e) => titleHandles.has(String(e.handle)))) continue;
    const view = measureElevationCluster(cluster, blocks, scale);
    if (view) views.push(view);
  }
  return views;
}

/*
  ---- Multi-view sheets: separating stacked floor plans/elevations by their
  own drawn titles ----
  A single sheet can carry MORE than one plan view — a real reference file
  turned out to have "GROUND FLOOR PLAN", "FIRST FLOOR PLAN", and
  "TERRACEFLOOR PLAN" (no space — real files are messy) stacked directly
  above/below each other, plus a "FRONT ELEVATION", all within the same
  loose neighborhood and, in places, close enough to be part of the same
  connected-proximity blob. clusterEntitiesByProximity's tight connectivity
  threshold (see its doc) cleanly separates genuinely distinct views when
  there's real drawn space between them, but stacked-close sheets like this
  one can fuse two adjacent views into one blob — which is exactly why that
  file's elevation cluster came out an implausible 37.9m x 11.1m (several
  floors' worth of content, not one facade) and its floor plan lost most of
  its own wall geometry to the same blob.

  Where multiple view TITLES exist (a title is unambiguous — a person wrote
  "GROUND FLOOR PLAN" specifically to say what this region of the sheet
  is), nearest-title assignment is more reliable than connectivity for
  telling views apart: every entity is assigned to whichever titled view's
  own label sits closest to it. This still can't perfectly reconstruct an
  architect's real layout intent (a mis-titled or off-center label would
  mis-assign entities near the boundary) — but it degrades far more gently
  than blob-fusion does, and it's only used at all when there are at least
  two titles to anchor it.

  This app has no multi-storey extrusion (floorHeightMm applies identically
  to every wall), so only ONE plan-kind view is modeled — the one whose
  title reads as the entry/ground level, or (lacking that) whichever
  qualifies as a specific floor level at all — every other view's entities
  (other floors, elevations, sections) are excluded from wall-pairing so
  they can't corrupt the modeled floor, exactly like a single elevation
  view already was. Which other floor levels existed but weren't modeled
  is surfaced back to the caller (see extractViews) rather than silently
  dropped.
*/
type ViewKind = "plan" | "elevation" | "section";
// Lower = more likely to be the building's entry level, and preferred as
// the ONE plan-kind view this app models. Roof/terrace/site plans are
// pushed high enough that they're never picked as the primary as long as
// any properly floor-numbered plan title also exists (see
// PRIMARY_PLAN_MAX_RANK) — a roof or site layout is a different kind of
// drawing than a building's own interior floor plan.
function planLevelRank(t: string): number {
  if (/\bsite\b/.test(t)) return 200;
  if (/\btop\b/.test(t)) return 102;
  if (/\broof\b/.test(t)) return 101;
  if (/\bterrace/.test(t)) return 100; // matches both "terrace" and the real file's un-spaced "terracefloor"
  if (/\bbasement\b/.test(t)) return -2;
  if (/\bstilt\b/.test(t)) return -1;
  if (/\bground\b/.test(t)) return 0;
  if (/\bmezzanine\b/.test(t)) return 0.5;
  if (/\bfirst\b/.test(t)) return 1;
  if (/\bsecond\b/.test(t)) return 2;
  if (/\bthird\b/.test(t)) return 3;
  if (/\bfourth\b/.test(t)) return 4;
  if (/\bfifth\b/.test(t)) return 5;
  return 0; // a bare "FLOOR PLAN"/"PLAN" with no level qualifier — assume it's the (only) main one
}
// Only a plan title in this range is ever picked as the ONE modeled floor
// — see planLevelRank's doc. Kept out of PRIMARY_PLAN_MAX_RANK's own
// selection so a sheet with only a "SITE PLAN"/"ROOF PLAN" title (and no
// real floor-level plan title) never has a non-interior drawing picked as
// if it were the building.
const PRIMARY_PLAN_MAX_RANK = 5;

function classifyViewTitle(rawText: string): { kind: ViewKind; levelRank: number } | null {
  const clean = cleanMTextLabel(rawText);
  const t = clean.toLowerCase();
  if (SECTION_TITLE_RE.test(clean)) return { kind: "section", levelRank: NaN };
  if (ELEVATION_TITLE_RE.test(clean)) return { kind: "elevation", levelRank: NaN };
  if (!/\bplan\b/.test(t)) return null; // require an explicit "...plan" label — avoid matching e.g. a room simply named "plant room"
  return { kind: "plan", levelRank: planLevelRank(t) };
}

type ViewAnchor = { title: string; kind: ViewKind; levelRank: number; position: Pt };

function centroidOf(pts: Pt[]): Pt | null {
  if (pts.length === 0) return null;
  let sx = 0,
    sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

export type ViewPartition = {
  elevationViews: ElevationView[];
  excludeHandles: Set<string>;
  primaryPlanTitle: string | null;
  otherLevelTitles: string[];
  otherLevelEntityCount: number;
};

/**
 * Only engages when the sheet has at least two of its own view titles to
 * anchor on (see this section's module doc) — a typical single-plan or
 * plan+one-elevation file has zero or one, and returns null so callers
 * fall back to extractElevationViews' proximity-based approach unchanged.
 */
export function partitionByViewTitles(dxf: IDxf, scale: number, opts?: { preferredLevelKeyword?: string }): ViewPartition | null {
  const entities = dxf.entities ?? [];
  const blocks = dxf.blocks ?? {};

  const anchors: ViewAnchor[] = [];
  for (const e of entities) {
    let raw: string | undefined;
    let pos: Pt | undefined;
    if (e.type === "TEXT") {
      raw = (e as ITextEntity).text;
      pos = (e as ITextEntity).startPoint;
    } else if (e.type === "MTEXT") {
      raw = (e as IMtextEntity).text;
      pos = (e as IMtextEntity).position;
    }
    if (!raw || !pos) continue;
    const classified = classifyViewTitle(raw);
    if (!classified) continue;
    anchors.push({ title: cleanMTextLabel(raw), kind: classified.kind, levelRank: classified.levelRank, position: scalePt(pos, scale) });
  }
  if (anchors.length < 2) return null;

  // Nearest-title assignment has no natural notion of "too far to belong
  // to ANY of these views" on its own — every entity gets assigned to
  // WHICHEVER anchor is least-far, even one a kilometer away (confirmed
  // against the real reference file: an unrelated stray block pasted far
  // off on the same sheet got swept into the elevation view this way,
  // inflating its measured size to over a kilometer). A real multi-view
  // sheet's own views sit within some bounded neighborhood of each other
  // (that's what makes them "the same sheet"); an assignment cap derived
  // from how far apart the titles THEMSELVES are — generous, but bounded —
  // tells genuine view content (however far it spreads from its own
  // caption) apart from unrelated material that just happens to be
  // nearest, in relative terms, to one particular title.
  let maxAnchorSpreadMm = 0;
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      maxAnchorSpreadMm = Math.max(maxAnchorSpreadMm, dist(anchors[i].position, anchors[j].position));
    }
  }
  const assignmentCapMm = Math.max(maxAnchorSpreadMm * 4, 20000); // floor of 20m so two titles sitting close together still get a workable radius

  // Nearest-title assignment: every entity within the cap belongs to
  // whichever titled view's own label sits closest to it (by its own
  // representative points' centroid) — see module doc for why this beats
  // connectivity when views are titled but drawn close/touching. Anything
  // farther than the cap from every title is left unassigned entirely
  // (not excluded, not counted as any view) so it passes through to the
  // ordinary classifier untouched, same as it always has — the existing
  // footprint-outlier handling there is what disposes of it.
  const groups: IEntity[][] = anchors.map(() => []);
  for (const e of entities) {
    const centroid = centroidOf(entityClusterPoints(e).map((p) => scalePt(p, scale)));
    if (!centroid) continue; // no measurable position (e.g. a HATCH with no direct points) — can't be assigned, left out of every view
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = dist(centroid, anchors[i].position);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestDist > assignmentCapMm) continue;
    groups[bestIdx].push(e);
  }

  // Nearest-title-to-ENTITY assignment (above) breaks when a title label
  // sits at the far EDGE of its own view rather than near its middle — a
  // real reference file titles its "FRONT ELEVATION" right at the very
  // bottom of that facade, so real elevation content up near the roofline
  // (window/frame outlines drawn on the plain "wall" layer, not a
  // door/window-named one) ends up geometrically NEARER to a totally
  // different title (that sheet's "GROUND FLOOR PLAN", sitting between
  // the two views) than to its own. Wall-pairing those stray outline
  // fragments alongside genuine ground-floor walls produced nonsense
  // triangular/star geometry — confirmed against that exact file's real
  // coordinates, not assumed.
  //
  // A single correction pass reclaims this: each elevation-kind anchor's
  // own group, once assigned, has a real MEASURED footprint (bbox) — a
  // stronger, more specific test than a single point-to-point title
  // distance. Anything ELSE on the sheet whose centroid falls inside that
  // footprint belongs to the elevation, regardless of which title
  // happened to be nearest by raw distance; it's moved into the
  // elevation's own group so it's measured as real elevation detail (not
  // just deleted from the plan) and stays out of every other view's
  // wall-pairing, the same as anything nearest-title assignment got right
  // the first time.
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].kind !== "elevation") continue;
    const elevationPts = groups[i].flatMap((e) => entityClusterPoints(e).map((p) => scalePt(p, scale)));
    const elevationBox = bbox(elevationPts);
    if (!elevationBox) continue;
    for (let j = 0; j < anchors.length; j++) {
      if (j === i) continue;
      const group = groups[j];
      for (let k = group.length - 1; k >= 0; k--) {
        const centroid = centroidOf(entityClusterPoints(group[k]).map((p) => scalePt(p, scale)));
        if (!centroid) continue;
        if (centroid.x >= elevationBox.minX && centroid.x <= elevationBox.maxX && centroid.y >= elevationBox.minY && centroid.y <= elevationBox.maxY) {
          groups[i].push(group[k]);
          group.splice(k, 1);
        }
      }
    }
  }

  const planIdxs = anchors.map((a, i) => i).filter((i) => anchors[i].kind === "plan");
  const eligiblePlanIdxs = planIdxs.filter((i) => anchors[i].levelRank <= PRIMARY_PLAN_MAX_RANK);
  // A person can say which level they actually want modeled (see
  // uploadCadModel's "Floor level" field) — matched against each
  // candidate's own real title text, since that's the ground truth a
  // person reading the drawing goes by. This searches ALL plan-kind
  // candidates, not just the "eligible" ones below — PRIMARY_PLAN_MAX_RANK
  // exists to stop the AUTOMATIC default from guessing a roof/site/terrace
  // plan as if it were the building's main floor; it has no business
  // blocking a person who explicitly asked for exactly that. An unmatched
  // or absent preference falls through to the automatic default unchanged.
  const preferred = opts?.preferredLevelKeyword?.trim().toLowerCase();
  const preferredIdx = preferred ? planIdxs.find((i) => anchors[i].title.toLowerCase().includes(preferred)) : undefined;
  // No properly floor-numbered plan title at all (e.g. only a "SITE PLAN"
  // or "ROOF PLAN" title exists) and no explicit preference either — don't
  // attempt to pick a "primary" among non-interior drawings; leave every
  // plan-kind group unexcluded so they all still feed the ordinary
  // classifier together, same as before this partitioning existed.
  const primaryIdx: number | null =
    preferredIdx !== undefined
      ? preferredIdx
      : eligiblePlanIdxs.length > 0
        ? eligiblePlanIdxs.reduce((best, i) => (anchors[i].levelRank < anchors[best].levelRank || (anchors[i].levelRank === anchors[best].levelRank && groups[i].length > groups[best].length) ? i : best))
        : null;

  const excludeHandles = new Set<string>();
  const otherLevelTitles: string[] = [];
  let otherLevelEntityCount = 0;
  const elevationViews: ElevationView[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const group = groups[i];
    if (anchor.kind === "elevation") {
      const view = measureElevationCluster(group, blocks, scale);
      if (view) elevationViews.push(view);
      // Either way — measured into a real panel, or too small/malformed to
      // confidently measure — this group's own dense line/arc texture must
      // stay out of the plan's wall-pairing (the original elevation-vs-plan
      // contamination bug this whole feature started from).
      for (const e of group) excludeHandles.add(String(e.handle));
      continue;
    }
    if (anchor.kind === "section") {
      for (const e of group) excludeHandles.add(String(e.handle));
      continue;
    }
    // plan-kind — only exclude/count the OTHER plan groups once an actual
    // primary was chosen (primaryIdx != null); when nothing was chosen
    // (no eligible level and no matching preference), every plan-kind
    // group is left alone, unexcluded, exactly as if this sheet had fewer
    // than 2 titles at all.
    if (primaryIdx == null || i === primaryIdx) continue;
    for (const e of group) excludeHandles.add(String(e.handle));
    otherLevelTitles.push(anchor.title);
    otherLevelEntityCount += group.length;
  }

  return {
    elevationViews,
    excludeHandles,
    primaryPlanTitle: primaryIdx != null ? anchors[primaryIdx].title : null,
    otherLevelTitles,
    otherLevelEntityCount,
  };
}

/**
 * Every piece of this pipeline up to here works from what the drawing
 * itself says (a title, a layer name, a block name) — but a sheet with NO
 * title text at all, or one worded in a way none of this recognizes, is
 * genuinely ambiguous from the geometry alone. A person looking at it
 * isn't ambiguous about it at all, so uploadCadModel offers an explicit
 * "what kind of drawing is this" choice instead of forcing a guess:
 *   "auto"      — today's behavior, entirely title-driven (default).
 *   "plan"      — trust that it's a floor plan even if detectNonPlanDrawing
 *                 would otherwise reject it on an elevation/section-sounding
 *                 title found somewhere on the sheet; still doesn't fabricate
 *                 walls that genuinely aren't there.
 *   "elevation" — when no title-anchored elevation view could be found (see
 *                 extractElevationViews/partitionByViewTitles), measure
 *                 EVERY remaining entity as one whole-sheet elevation
 *                 instead — this is what makes a genuinely untitled
 *                 elevation-only file work at all, which no amount of
 *                 smarter title-reading can do on its own.
 */
export type DeclaredDrawingType = "auto" | "plan" | "elevation";

/**
 * Single entry point for both dwg.ts and index.ts: tries the titled
 * multi-view partition first (see partitionByViewTitles), falls back to
 * the older single-elevation, proximity-based extraction when the sheet
 * doesn't carry enough of its own view titles to anchor that, and — only
 * for a declaredType of "elevation" that still found nothing — falls back
 * once more to treating the whole sheet as one elevation (see this
 * section's module doc above).
 */
export function extractViews(
  dxf: IDxf,
  scale: number,
  opts?: { declaredType?: DeclaredDrawingType; preferredLevelKeyword?: string }
): { elevationViews: ElevationView[]; excludeHandles?: Set<string>; otherLevelTitles: string[]; otherLevelEntityCount: number; primaryPlanTitle: string | null } {
  const partition = partitionByViewTitles(dxf, scale, { preferredLevelKeyword: opts?.preferredLevelKeyword });
  if (partition) {
    return {
      elevationViews: partition.elevationViews,
      excludeHandles: partition.excludeHandles.size > 0 ? partition.excludeHandles : undefined,
      otherLevelTitles: partition.otherLevelTitles,
      otherLevelEntityCount: partition.otherLevelEntityCount,
      // Which plan-kind title (if any) this sheet's OTHER titled plan-kind
      // views were excluded in favor of — null when the sheet has fewer
      // than 2 titled views at all, or when multiple plan titles exist but
      // none was eligible/preferred so nothing was excluded (see
      // partitionByViewTitles' own primaryIdx doc). Lets a caller show
      // "currently modeled: X" and offer the OTHER titles as an explicit
      // switch instead of only a passive "not modeled" note — see
      // uploadCadModel/regenerateCadModelLevel in actions.ts.
      primaryPlanTitle: partition.primaryPlanTitle,
    };
  }
  const elevationViews = extractElevationViews(dxf, scale);
  if (elevationViews.length > 0) {
    const excludeHandles = new Set(elevationViews.flatMap((v) => [...v.memberHandles]));
    return { elevationViews, excludeHandles, otherLevelTitles: [], otherLevelEntityCount: 0, primaryPlanTitle: null };
  }
  if (opts?.declaredType === "elevation") {
    const whole = measureElevationCluster(dxf.entities ?? [], dxf.blocks ?? {}, scale);
    if (whole) return { elevationViews: [whole], excludeHandles: new Set(whole.memberHandles), otherLevelTitles: [], otherLevelEntityCount: 0, primaryPlanTitle: null };
  }
  return { elevationViews: [], excludeHandles: undefined, otherLevelTitles: [], otherLevelEntityCount: 0, primaryPlanTitle: null };
}
