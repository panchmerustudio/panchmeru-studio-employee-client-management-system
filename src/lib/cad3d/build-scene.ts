"use client";

/**
 * CAD entities (the locked, measurement-true structured database — see
 * src/db/schema/cad.ts) -> real 3D geometry. Deterministic, code-driven
 * extrusion — nothing here is AI-generated or approximate beyond what's
 * already been explicitly resolved (floor/door/window heights, default
 * wall thickness). "CAD measurements are the source of truth": every box
 * this module creates is sized directly from a cadEntities row.
 *
 * Coordinate convention: CAD plan coordinates are (x, y) in millimeters;
 * height is a separate z (mm) axis. Three.js is Y-up, so everywhere in this
 * file a plan point {x, y} with height h maps to THREE (x, h, y) — height
 * becomes Three's Y, plan-Y becomes Three's Z. This mapping is applied
 * consistently so the whole scene, camera, and controls agree.
 */
import * as THREE from "three";

export type CadEntityInput = {
  id: string;
  type: "wall" | "door" | "window" | "column" | "stair" | "furniture" | "room" | "unclassified";
  layerName: string;
  label?: string | null;
  geometry: unknown;
  widthMm?: number | null;
  depthMm?: number | null;
  heightMm?: number | null;
  rotationDeg?: number | null;
};

export type ValidationRow = { id: string; type: string; label: string; dimension: string; cadValue: number; modelValue: number };

const MM = 1 / 1000; // Three scene units are meters; CAD data is millimeters
const COLORS = {
  wall: 0xd8d2c4,
  door: 0x8a5a35,
  window: 0x7fb8d9,
  column: 0x888888,
  furniture: 0xb7a48c,
  stair: 0x9a9a9a,
  room: 0xf3ead7,
};

function toThree(x: number, y: number, z = 0) {
  return new THREE.Vector3(x * MM, z * MM, y * MM);
}

type Pt = { x: number; y: number };

function box(lengthMm: number, thicknessMm: number, heightMm: number, color: number) {
  const geo = new THREE.BoxGeometry(Math.max(lengthMm, 1) * MM, Math.max(heightMm, 1) * MM, Math.max(thicknessMm, 1) * MM);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
  return new THREE.Mesh(geo, mat);
}

type WallInput = CadEntityInput & { geometry: { start: Pt; end: Pt } };
type OpeningInput = CadEntityInput & { geometry: { position: Pt } };

/** Assigns each door/window to whichever wall it sits closest to (openings are matched to walls purely by proximity — an opening's own position + the wall's line, both already exact CAD measurements). */
function assignOpeningsToWalls(walls: WallInput[], openings: OpeningInput[]) {
  const byWall = new Map<number, OpeningInput[]>();
  for (const o of openings) {
    let bestIdx = -1;
    let bestDist = Infinity;
    walls.forEach((w, i) => {
      const { start, end } = w.geometry;
      const dx = end.x - start.x,
        dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1e-6;
      const t = ((o.geometry.position.x - start.x) * dx + (o.geometry.position.y - start.y) * dy) / (len * len);
      if (t < -0.05 || t > 1.05) return; // well outside this wall's span
      const perpDist = Math.abs((o.geometry.position.x - start.x) * dy - (o.geometry.position.y - start.y) * dx) / len;
      if (perpDist < bestDist) {
        bestDist = perpDist;
        bestIdx = i;
      }
    });
    const thicknessTolerance = (walls[bestIdx]?.depthMm ?? 300) + 200;
    if (bestIdx >= 0 && bestDist < thicknessTolerance) {
      if (!byWall.has(bestIdx)) byWall.set(bestIdx, []);
      byWall.get(bestIdx)!.push(o);
    }
  }
  return byWall;
}

function buildWall(wall: WallInput, openings: OpeningInput[], windowSillMm: number): THREE.Group {
  const group = new THREE.Group();
  const { start, end } = wall.geometry;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return group;
  const angle = Math.atan2(dy, dx);
  const ux = dx / length,
    uy = dy / length;
  const thickness = wall.depthMm ?? 230;
  const wallHeight = wall.heightMm ?? 3000;

  type Span = { t1: number; t2: number; z1: number; z2: number };
  const spans: Span[] = [];

  const openingSpans = openings
    .map((o) => {
      const t = (o.geometry.position.x - start.x) * ux + (o.geometry.position.y - start.y) * uy;
      const half = (o.widthMm ?? 900) / 2;
      return { t1: Math.max(0, t - half), t2: Math.min(length, t + half), opening: o };
    })
    .sort((a, b) => a.t1 - b.t1);

  let cursor = 0;
  for (const s of openingSpans) {
    if (s.t1 > cursor) spans.push({ t1: cursor, t2: s.t1, z1: 0, z2: wallHeight });
    if (s.opening.type === "door") {
      const doorHeight = s.opening.heightMm ?? wallHeight;
      if (doorHeight < wallHeight - 1) spans.push({ t1: s.t1, t2: s.t2, z1: doorHeight, z2: wallHeight });
    } else {
      const sill = Math.max(0, windowSillMm);
      const winHeight = s.opening.heightMm ?? 1200;
      if (sill > 1) spans.push({ t1: s.t1, t2: s.t2, z1: 0, z2: sill });
      if (sill + winHeight < wallHeight - 1) spans.push({ t1: s.t1, t2: s.t2, z1: sill + winHeight, z2: wallHeight });
    }
    cursor = Math.max(cursor, s.t2);
  }
  if (cursor < length) spans.push({ t1: cursor, t2: length, z1: 0, z2: wallHeight });
  if (spans.length === 0) spans.push({ t1: 0, t2: length, z1: 0, z2: wallHeight });

  for (const s of spans) {
    const segLen = s.t2 - s.t1;
    if (segLen < 1) continue;
    const segHeight = s.z2 - s.z1;
    const midT = (s.t1 + s.t2) / 2;
    const midZ = (s.z1 + s.z2) / 2;
    const mesh = box(segLen, thickness, segHeight, COLORS.wall);
    const center = toThree(start.x + ux * midT, start.y + uy * midT, midZ);
    mesh.position.copy(center);
    mesh.rotation.y = -angle;
    mesh.userData = { cadEntityId: wall.id, cadType: "wall" };
    group.add(mesh);
  }
  return group;
}

function buildOpening(o: OpeningInput, wallThicknessMm: number, windowSillMm: number): THREE.Mesh {
  const width = o.widthMm ?? 900;
  const depth = Math.max(o.depthMm ?? 50, Math.min(wallThicknessMm, 250));
  const height = o.heightMm ?? (o.type === "door" ? 2100 : 1200);
  const zBottom = o.type === "window" ? windowSillMm : 0;
  const mesh = box(width, depth, height, o.type === "door" ? COLORS.door : COLORS.window);
  if (o.type === "window") {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0.55;
  }
  const pos = o.geometry.position;
  mesh.position.copy(toThree(pos.x, pos.y, zBottom + height / 2));
  mesh.rotation.y = -((o.rotationDeg ?? 0) * Math.PI) / 180;
  mesh.userData = { cadEntityId: o.id, cadType: o.type };
  return mesh;
}

function buildPointMass(e: CadEntityInput, defaultHeight: number, color: number): THREE.Mesh | null {
  const geo = e.geometry as { position?: Pt };
  if (!geo.position) return null;
  const width = e.widthMm ?? 300;
  const depth = e.depthMm ?? 300;
  const height = e.heightMm ?? defaultHeight;
  const mesh = box(width, depth, height, color);
  mesh.position.copy(toThree(geo.position.x, geo.position.y, height / 2));
  mesh.rotation.y = -((e.rotationDeg ?? 0) * Math.PI) / 180;
  mesh.userData = { cadEntityId: e.id, cadType: e.type };
  return mesh;
}

function buildFlatPolygon(points: Pt[], heightMm: number, color: number): THREE.Mesh | null {
  if (points.length < 3) return null;
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x * MM, p.y * MM)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(heightMm, 10) * MM, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // Shape is drawn in XY; rotate flat onto the ground plane (Three's XZ)
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  return mesh;
}

export function buildScene(entities: CadEntityInput[], opts: { windowSillMm: number }): { group: THREE.Group; validation: ValidationRow[] } {
  const group = new THREE.Group();
  const validation: ValidationRow[] = [];

  const walls = entities.filter((e): e is WallInput => e.type === "wall") as WallInput[];
  const openings = entities.filter((e): e is OpeningInput => e.type === "door" || e.type === "window") as OpeningInput[];
  const byWall = assignOpeningsToWalls(walls, openings);

  walls.forEach((w, i) => {
    const wallOpenings = byWall.get(i) ?? [];
    const wg = buildWall(w, wallOpenings, opts.windowSillMm);
    group.add(wg);
    const box3 = new THREE.Box3().setFromObject(wg);
    const size = box3.getSize(new THREE.Vector3());
    const lengthMm = Math.hypot(w.geometry.end.x - w.geometry.start.x, w.geometry.end.y - w.geometry.start.y);
    validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "length", cadValue: Math.round(lengthMm), modelValue: Math.round(Math.max(size.x, size.z) / MM) });
    if (w.depthMm) validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "thickness", cadValue: Math.round(w.depthMm), modelValue: Math.round(Math.min(size.x, size.z) / MM) });
    if (w.heightMm) validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "height", cadValue: Math.round(w.heightMm), modelValue: Math.round(size.y / MM) });
  });

  for (const [wallIdx, wallOpenings] of byWall) {
    const wallThickness = walls[wallIdx]?.depthMm ?? 230;
    for (const o of wallOpenings) {
      const mesh = buildOpening(o, wallThickness, opts.windowSillMm);
      group.add(mesh);
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      const label = `${o.type === "door" ? "Door" : "Window"} ${o.label ?? ""}`.trim();
      if (o.widthMm) validation.push({ id: o.id, type: o.type, label, dimension: "width", cadValue: Math.round(o.widthMm), modelValue: Math.round(size.x / MM) });
      if (o.heightMm) validation.push({ id: o.id, type: o.type, label, dimension: "height", cadValue: Math.round(o.heightMm), modelValue: Math.round(size.y / MM) });
    }
  }

  for (const e of entities) {
    if (e.type === "column" || e.type === "furniture") {
      const defaultHeight = e.type === "column" ? 3000 : 750;
      const mesh = buildPointMass(e, defaultHeight, e.type === "column" ? COLORS.column : COLORS.furniture);
      if (!mesh) continue;
      group.add(mesh);
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      const label = `${e.type === "column" ? "Column" : "Furniture"} ${e.label ?? ""}`.trim();
      if (e.widthMm) validation.push({ id: e.id, type: e.type, label, dimension: "width", cadValue: Math.round(e.widthMm), modelValue: Math.round(size.x / MM) });
      if (e.depthMm) validation.push({ id: e.id, type: e.type, label, dimension: "depth", cadValue: Math.round(e.depthMm), modelValue: Math.round(size.z / MM) });
    } else if (e.type === "room") {
      const geo = e.geometry as { points?: Pt[] };
      if (!geo.points) continue;
      const mesh = buildFlatPolygon(geo.points, 20, COLORS.room);
      if (!mesh) continue;
      mesh.userData = { cadEntityId: e.id, cadType: "room" };
      group.add(mesh);
    } else if (e.type === "stair") {
      const geo = e.geometry as { points?: Pt[] };
      if (!geo.points) continue;
      const mesh = buildFlatPolygon(geo.points, e.heightMm ?? 3000, COLORS.stair);
      if (!mesh) continue;
      mesh.userData = { cadEntityId: e.id, cadType: "stair", note: "simplified mass — not individual treads" };
      group.add(mesh);
    }
  }

  return { group, validation };
}
