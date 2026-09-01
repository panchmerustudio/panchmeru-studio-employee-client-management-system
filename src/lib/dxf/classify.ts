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
      if (a.center) out.push({ x: a.center.x - a.radius, y: a.center.y - a.radius }, { x: a.center.x + a.radius, y: a.center.y + a.radius });
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

export function classifyDxf(dxf: IDxf, scale: number): ClassificationResult {
  const entities = dxf.entities ?? [];
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
