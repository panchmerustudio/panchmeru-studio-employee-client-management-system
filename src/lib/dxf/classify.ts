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

const MIN_WALL_THICKNESS_MM = 50;
const MAX_WALL_THICKNESS_MM = 600;
const ANGLE_TOLERANCE_RAD = (2 * Math.PI) / 180;
const MIN_OVERLAP_RATIO = 0.4;
const MAX_UNCLASSIFIED_STORED = 500;

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

  // 1. Walls (line-pairing for thickness).
  const wallSegs = extractWallSegments(entities, scale);
  const walls = pairWallSegments(wallSegs);
  out.push(...walls);
  for (const e of entities) {
    if (WALL_RE.test(e.layer ?? "") && (e.type === "LINE" || e.type === "LWPOLYLINE" || e.type === "POLYLINE")) consumed.add(e);
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

  // 4. Doors/windows/columns/furniture — from CAD blocks only (see module doc).
  let hasDoors = false;
  let hasWindows = false;
  for (const e of entities) {
    if (e.type !== "INSERT") continue;
    consumed.add(e);
    const classified = classifyInsert(e as IInsertEntity, blocks, scale);
    if (classified.type === "door") hasDoors = true;
    if (classified.type === "window") hasWindows = true;
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
