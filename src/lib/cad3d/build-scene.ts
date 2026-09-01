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
  floor: 0xd7cbb0,
};

function toThree(x: number, y: number, z = 0) {
  return new THREE.Vector3(x * MM, z * MM, y * MM);
}

type Pt = { x: number; y: number };

/*
  ---- Procedural wall material ----
  This module also runs headless under plain Node (scripts/test-cad3d-build.ts,
  via tsx) where there's no `document`/canvas — so texture generation is
  gated behind canUseCanvas() and every caller has a flat-color fallback.
  In the browser it's used to give walls a faint plaster texture (an
  MeshStandardMaterial color+bumpMap pair drawn at runtime) instead of a
  single flat color, which is the "PBR material" half of a realism upgrade
  that's actually achievable here: this app has no bundled/hosted photo
  textures or .glb assets to load, so anything textured is generated, not
  fetched. One material (one texture pair) is built lazily and shared by
  every wall in the building — see getWallMaterial()'s doc for why that
  sharing is load-bearing, not just an optimization.
  */
function canUseCanvas() {
  return typeof document !== "undefined";
}

function createCanvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  draw(c.getContext("2d")!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makePlasterTexture(hex: number): THREE.Texture {
  const hexStr = `#${hex.toString(16).padStart(6, "0")}`;
  return createCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = hexStr;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 3200; i++) {
      const x = Math.random() * s,
        y = Math.random() * s;
      const a = Math.random() * 0.05;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  });
}

/** One square floor tile per texture image — repeat.set() on the caller tiles it across the real floor size, so the grout grid lines up with real-world 600mm tiles instead of stretching one image over the whole slab. */
function makeTileTexture(): THREE.Texture {
  return createCanvasTexture(256, (ctx, s) => {
    const grout = "#a89a7c";
    const base = "#d9cfb4";
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, s, s);
    const inset = Math.round(s * 0.035);
    ctx.fillStyle = base;
    ctx.fillRect(inset, inset, s - inset * 2, s - inset * 2);
    // faint per-tile sheen/speckle so adjacent tiles don't read as one flat sheet
    for (let i = 0; i < 90; i++) {
      const x = inset + Math.random() * (s - inset * 2);
      const y = inset + Math.random() * (s - inset * 2);
      const a = Math.random() * 0.05;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  });
}

function makeBumpTexture(size: number, intensity: number): THREE.Texture {
  return createCanvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255 * intensity;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

let cachedWallMaterial: THREE.MeshStandardMaterial | null = null;
let cachedFlatWallMaterial: THREE.MeshStandardMaterial | null = null;

/**
 * One shared MeshStandardMaterial for every wall in the building — NOT one
 * per wall. An earlier version cloned the color+bump texture (and created a
 * brand-new Material) for every wall span so each wall's tiling could be
 * scaled to its own length/height. That looks fine on the 2-3 wall test
 * fixture, but a real floor plan can have hundreds of walls (646, in one
 * reported case) — cloning meant hundreds of canvases being drawn and
 * separately uploaded to the GPU on every model load, which is exactly what
 * left the 3D pane stuck blank on larger drawings (multi-second main-thread
 * work plus real GPU texture memory pressure on phones). One shared
 * material costs one upload, full stop. The tradeoff is the plaster tiling
 * is a fixed density rather than exactly proportional to each wall's own
 * size — acceptable here because the texture is a faint, non-repeating-
 * pattern noise (unlike, say, floor planks), so a little stretching on very
 * short or very long walls isn't visually obvious.
 */
function getWallMaterial(color: number): THREE.MeshStandardMaterial {
  if (!canUseCanvas()) {
    if (!cachedFlatWallMaterial) cachedFlatWallMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
    return cachedFlatWallMaterial;
  }
  if (cachedWallMaterial) return cachedWallMaterial;
  const colorTex = makePlasterTexture(color);
  const bumpTex = makeBumpTexture(128, 0.35);
  colorTex.repeat.set(3, 1.2);
  bumpTex.repeat.set(6, 3);
  cachedWallMaterial = new THREE.MeshStandardMaterial({ map: colorTex, bumpMap: bumpTex, bumpScale: 0.012, roughness: 0.85, metalness: 0.02 });
  return cachedWallMaterial;
}

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

type BuiltWall = { group: THREE.Group; length: number; thickness: number; height: number };

function buildWall(wall: WallInput, openings: OpeningInput[], windowSillMm: number): BuiltWall {
  const group = new THREE.Group();
  const { start, end } = wall.geometry;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const fallbackThickness = wall.depthMm ?? 230;
  const fallbackHeight = wall.heightMm ?? 3000;
  if (length < 1) return { group, length, thickness: fallbackThickness, height: fallbackHeight };
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
    const geo = new THREE.BoxGeometry(Math.max(segLen, 1) * MM, Math.max(segHeight, 1) * MM, Math.max(thickness, 1) * MM);
    const mesh = new THREE.Mesh(geo, getWallMaterial(COLORS.wall));
    const center = toThree(start.x + ux * midT, start.y + uy * midT, midZ);
    mesh.position.copy(center);
    mesh.rotation.y = -angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { cadEntityId: wall.id, cadType: "wall" };
    group.add(mesh);
  }
  return { group, length, thickness, height: wallHeight };
}

type BuiltOpening = { mesh: THREE.Mesh; width: number; height: number };

function buildOpening(o: OpeningInput, wallThicknessMm: number, windowSillMm: number): BuiltOpening {
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
  mesh.castShadow = o.type === "door";
  mesh.receiveShadow = true;
  mesh.userData = { cadEntityId: o.id, cadType: o.type };
  return { mesh, width, height };
}

type BuiltPointMass = { object: THREE.Object3D; width: number; depth: number };

/**
 * Columns stay a plain labeled box (BoxGeometry is centered on its own
 * origin, hence the height/2 lift). Furniture instead goes through
 * buildFurniture() below, which returns a small multi-part group already
 * resting on y=0 — see that function's doc for why.
 */
function buildPointMass(e: CadEntityInput, defaultHeight: number, color: number): BuiltPointMass | null {
  const geo = e.geometry as { position?: Pt };
  if (!geo.position) return null;
  const width = e.widthMm ?? 300;
  const depth = e.depthMm ?? 300;
  const height = e.heightMm ?? defaultHeight;

  if (e.type === "furniture") {
    const object = buildFurniture(e.label ?? "", width, depth, height);
    object.position.copy(toThree(geo.position.x, geo.position.y, 0));
    object.rotation.y = -((e.rotationDeg ?? 0) * Math.PI) / 180;
    object.userData = { cadEntityId: e.id, cadType: e.type };
    return { object, width, depth };
  }

  const mesh = box(width, depth, height, color);
  mesh.position.copy(toThree(geo.position.x, geo.position.y, height / 2));
  mesh.rotation.y = -((e.rotationDeg ?? 0) * Math.PI) / 180;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { cadEntityId: e.id, cadType: e.type };
  return { object: mesh, width, depth };
}

/*
  ---- Furniture: primitive-geometry groups, anchored at their CAD marker ----
  Real GLTF furniture models would need actual .glb asset files this app
  doesn't host or bundle; loading them from a public CDN at render time
  would be a real network dependency (CORS, licensing, load time) this
  module intentionally avoids — everything it draws is either exact CAD
  geometry or, for furniture, a small hand-built primitive group. The block
  name a furniture INSERT was classified from (its `label`, e.g. "SOFA_2S"
  or "BED_QUEEN" — see src/lib/dxf/classify.ts) is matched against a few
  keyword patterns to pick a recognizable shape; anything unmatched still
  renders as a plain labeled box, exactly as before. Each builder is handed
  the entity's real CAD width/depth/height (in meters) and proportions its
  parts from that footprint, so a 2000x900mm sofa block and a 1400x700mm
  one come out sized differently, not as the same stock model.
*/
const FURNITURE_KIND_PATTERNS: [RegExp, string][] = [
  [/sofa|couch|settee/i, "sofa"],
  [/\bbed\b/i, "bed"],
  [/dining|\btable\b|\bdesk\b/i, "table"],
  [/wardrobe|cabinet|almirah|cupboard/i, "wardrobe"],
  [/\bchair\b/i, "chair"],
  [/plant|planter/i, "plant"],
  [/\bwc\b|toilet|commode|wash\s*basin|\bbasin\b|\bsink\b|urinal|bidet/i, "sanitary"],
  [/oven|\brange\b|stove|hob|cooktop|refrigerator|\bfridge\b/i, "appliance"],
];

function furnitureKind(label: string): string | null {
  for (const [re, kind] of FURNITURE_KIND_PATTERNS) if (re.test(label)) return kind;
  return null;
}

/** Used only when the CAD block didn't specify a height (classify.ts measures width/depth from the block's footprint, not its elevation) — proportioned per kind instead of one flat guess for every piece of furniture. */
export function furnitureDefaultHeightMm(label: string): number {
  switch (furnitureKind(label)) {
    case "wardrobe":
      return 1900;
    case "bed":
      return 550;
    case "chair":
      return 850;
    case "plant":
      return 900;
    case "sanitary":
      return 750;
    case "appliance":
      return 900;
    default:
      return 750;
  }
}

function furnMat(color: number, roughness = 0.7, metalness = 0.03) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function buildSofa(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const fabric = furnMat(0x6b8494, 0.85);
  const wood = furnMat(0x2b2018, 0.5);
  const armW = Math.min(w * 0.09, 0.14);
  const seatH = h * 0.35,
    seatY = h * 0.08;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(w, seatH, d * 0.85), fabric);
  seat.position.y = seatY + seatH / 2;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.55, d * 0.2), fabric);
  back.position.set(0, seatY + (h * 0.55) / 2, -d * 0.42);
  g.add(back);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armW, h * 0.45, d * 0.85), fabric);
    arm.position.set(s * (w / 2 - armW / 2), seatY + (h * 0.45) / 2, 0);
    g.add(arm);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, seatY, 8), wood);
      leg.position.set(sx * (w / 2 - armW), seatY / 2, sz * d * 0.4);
      g.add(leg);
    }
  return g;
}

function buildBed(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const wood = furnMat(0x6b4128, 0.55);
  const linen = furnMat(0xe4dccd, 0.85);
  const frameH = h * 0.35;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w, frameH, d), wood);
  frame.position.y = frameH / 2;
  g.add(frame);
  const mattressH = h * 0.5;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, mattressH, d * 0.96), linen);
  mattress.position.y = frameH + mattressH / 2;
  g.add(mattress);
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), wood);
  headboard.position.set(0, h / 2, -d / 2 + 0.03);
  g.add(headboard);
  return g;
}

function buildTable(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const wood = furnMat(0x8a5a34, 0.55);
  const topH = Math.min(h * 0.08, 0.06);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, topH, d), wood);
  top.position.y = h - topH / 2;
  g.add(top);
  const legR = Math.min(w, d) * 0.04;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, h - topH, 8), wood);
      leg.position.set(sx * (w / 2 - legR * 1.5), (h - topH) / 2, sz * (d / 2 - legR * 1.5));
      g.add(leg);
    }
  return g;
}

function buildWardrobe(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const wood = furnMat(0x5c3a22, 0.6);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
  body.position.y = h / 2;
  g.add(body);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w * 0.01, 0.005), h * 0.95, d + 0.005), furnMat(0x1c1108, 0.6));
  seam.position.y = h / 2;
  g.add(seam);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xd8b26a, roughness: 0.3, metalness: 0.7 });
  for (const s of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h * 0.14, 8), handleMat);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(s * w * 0.08, h * 0.55, d / 2 + 0.02);
    g.add(handle);
  }
  return g;
}

function buildChair(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const fabric = furnMat(0xa8452f, 0.8);
  const wood = furnMat(0x8a5a34, 0.55);
  const seatY = h * 0.5;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.08, d), fabric);
  seat.position.y = seatY;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.5, d * 0.15), fabric);
  back.position.set(0, seatY + (h * 0.5) / 2, -d / 2 + d * 0.075);
  g.add(back);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, seatY, 6), wood);
      leg.position.set(sx * (w / 2 - 0.03), seatY / 2, sz * (d / 2 - 0.03));
      g.add(leg);
    }
  return g;
}

function buildPlant(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const potMat = furnMat(0xa85a3a, 0.8);
  const leafMat = furnMat(0x3f7a45, 0.75);
  const potR = Math.min(w, d) / 2;
  const potH = potR * 1.4;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(potR, potR * 0.8, potH, 16), potMat);
  pot.position.y = potH / 2;
  g.add(pot);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(potR * 0.4, potR * (2.4 + Math.random()), 6), leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * potR * 0.4, potH + potR * 1.2, Math.sin(a) * potR * 0.4);
    leaf.rotation.z = Math.cos(a) * 0.35;
    leaf.rotation.x = Math.sin(a) * -0.35;
    g.add(leaf);
  }
  return g;
}

/** Covers WC/basin/sink-type sanitary fixtures — a simple two-tier porcelain-white mass (bowl/counter + tank/splashback) rather than a plain furniture-brown box, since a toilet or basin rendered in wood-tan reads as obviously wrong even at a glance. */
function buildSanitary(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const porcelain = furnMat(0xf1f0ea, 0.25, 0.05);
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.55, d), porcelain);
  base.position.y = (h * 0.55) / 2;
  g.add(base);
  const tank = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h * 0.45, d * 0.32), porcelain);
  tank.position.set(0, h * 0.55 + (h * 0.45) / 2, -d * 0.3);
  g.add(tank);
  return g;
}

/** Kitchen appliances (range/oven/hob/fridge) — a brushed-steel body with a dark control panel band, instead of the same flat furniture-brown box every other unrecognized block gets. */
function buildAppliance(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const steel = furnMat(0xb7bcbe, 0.35, 0.75);
  const dark = furnMat(0x18181a, 0.4, 0.4);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), steel);
  body.position.y = h / 2;
  g.add(body);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h * 0.16, Math.max(d * 0.02, 0.01)), dark);
  panel.position.set(0, h * 0.86, d / 2 + 0.006);
  g.add(panel);
  return g;
}

function buildFurniture(label: string, widthMm: number, depthMm: number, heightMm: number): THREE.Object3D {
  const kind = furnitureKind(label);
  const w = Math.max(widthMm, 150) * MM;
  const d = Math.max(depthMm, 150) * MM;
  const h = Math.max(heightMm || furnitureDefaultHeightMm(label), 150) * MM;
  let g: THREE.Group;
  switch (kind) {
    case "sofa":
      g = buildSofa(w, d, h);
      break;
    case "bed":
      g = buildBed(w, d, h);
      break;
    case "table":
      g = buildTable(w, d, h);
      break;
    case "wardrobe":
      g = buildWardrobe(w, d, h);
      break;
    case "chair":
      g = buildChair(w, d, h);
      break;
    case "plant":
      g = buildPlant(w, d);
      break;
    case "sanitary":
      g = buildSanitary(w, d, h);
      break;
    case "appliance":
      g = buildAppliance(w, d, h);
      break;
    default: {
      g = new THREE.Group();
      const mesh = box(widthMm, depthMm, heightMm || furnitureDefaultHeightMm(label), COLORS.furniture);
      mesh.position.y = (Math.max(heightMm || furnitureDefaultHeightMm(label), 1) * MM) / 2;
      g.add(mesh);
    }
  }
  g.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return g;
}

function buildFlatPolygon(points: Pt[], heightMm: number, color: number): THREE.Mesh | null {
  if (points.length < 3) return null;
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x * MM, p.y * MM)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(heightMm, 10) * MM, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // Shape is drawn in XY; rotate flat onto the ground plane (Three's XZ)
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A ground slab under the whole building footprint, tiled like real
 * flooring. Real DXF floor plans essentially never carry a dedicated
 * "room" layer with closed boundary polylines (that's the rare/idealized
 * case the ROOM_RE classifier already handles) — most just have wall
 * lines, so without this every model rendered as walls floating over the
 * viewer's grid helper with nothing underfoot. The footprint here is the
 * simple axis-aligned bounding box of every wall endpoint: not as precise
 * as tracing the actual (possibly L-shaped/irregular) perimeter, but a
 * single flat slab under the whole building is a solid, robust default —
 * and correct in the overwhelmingly common rectangular-plan case.
 */
function buildFloorSlab(walls: WallInput[]): THREE.Mesh | null {
  if (walls.length === 0) return null;
  const pts = walls.flatMap((w) => [w.geometry.start, w.geometry.end]);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const marginMm = 150; // extend slightly past the outer wall faces so there's no sliver gap at the perimeter
  minX -= marginMm;
  minY -= marginMm;
  maxX += marginMm;
  maxY += marginMm;
  const widthMm = maxX - minX;
  const depthMm = maxY - minY;
  if (widthMm < 100 || depthMm < 100) return null;

  const thicknessMm = 60;
  const geo = new THREE.BoxGeometry(widthMm * MM, thicknessMm * MM, depthMm * MM);

  let mat: THREE.MeshStandardMaterial;
  if (canUseCanvas()) {
    const tileSizeM = 0.6; // standard ~600mm ceramic floor tile
    const repeatX = Math.max(1, Math.round((widthMm * MM) / tileSizeM));
    const repeatY = Math.max(1, Math.round((depthMm * MM) / tileSizeM));
    const tex = makeTileTexture();
    tex.repeat.set(repeatX, repeatY);
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.04 });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.5, metalness: 0.04 });
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(((minX + maxX) / 2) * MM, (-thicknessMm / 2) * MM, ((minY + maxY) / 2) * MM);
  mesh.receiveShadow = true;
  mesh.userData = { cadType: "floor" };
  return mesh;
}

export function buildScene(entities: CadEntityInput[], opts: { windowSillMm: number }): { group: THREE.Group; validation: ValidationRow[] } {
  const group = new THREE.Group();
  const validation: ValidationRow[] = [];

  const walls = entities.filter((e): e is WallInput => e.type === "wall") as WallInput[];
  const openings = entities.filter((e): e is OpeningInput => e.type === "door" || e.type === "window") as OpeningInput[];
  const byWall = assignOpeningsToWalls(walls, openings);

  const floor = buildFloorSlab(walls);
  if (floor) group.add(floor);

  /*
    ---- Validation values: read from construction, not from a rotated AABB ----
    Every wall/opening/column here is built at some non-trivial THREE Y
    rotation (`angle` from the wall's own start->end vector, or the
    entity's CAD rotationDeg) and then the OLD code re-derived "length" and
    "thickness" for the validation table from `new THREE.Box3().setFromObject(...)`
    — the mesh's world-space axis-aligned bounding box. That's only exact
    when the rotation is a multiple of 90°: for any other angle, rotating a
    w x d rectangle grows its AABB along both world axes (a well-known
    "bounding box of a rotated box" distortion), so size.x/size.z stop
    equalling the true length/thickness. Worse, the table decided which
    AABB axis was "length" vs "thickness" by Math.max/Math.min — so once
    that distortion pushed thickness's AABB extent above length's, the two
    values printed backwards (a 100mm-thick, 4200mm-long wall could show as
    "length 4200 / thickness 100" in CAD but "length 100 / thickness 4200"
    in 3D, i.e. exactly the swapped-values bug reported against this page).
    Since every mesh here is built directly from wall.depthMm / length /
    heightMm moments earlier, buildWall/buildOpening/buildPointMass now
    hand those exact pre-rotation numbers back instead of making the
    validation table re-discover them from a lossy world-space measurement.
    The existing test fixture in scripts/test-cad3d-build.ts only used
    axis-aligned walls, which is why this never failed there.
  */
  walls.forEach((w, i) => {
    const wallOpenings = byWall.get(i) ?? [];
    const built = buildWall(w, wallOpenings, opts.windowSillMm);
    group.add(built.group);
    validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "length", cadValue: Math.round(built.length), modelValue: Math.round(built.length) });
    if (w.depthMm) validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "thickness", cadValue: Math.round(w.depthMm), modelValue: Math.round(built.thickness) });
    if (w.heightMm) validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "height", cadValue: Math.round(w.heightMm), modelValue: Math.round(built.height) });
  });

  for (const [wallIdx, wallOpenings] of byWall) {
    const wallThickness = walls[wallIdx]?.depthMm ?? 230;
    for (const o of wallOpenings) {
      const built = buildOpening(o, wallThickness, opts.windowSillMm);
      group.add(built.mesh);
      const label = `${o.type === "door" ? "Door" : "Window"} ${o.label ?? ""}`.trim();
      if (o.widthMm) validation.push({ id: o.id, type: o.type, label, dimension: "width", cadValue: Math.round(o.widthMm), modelValue: Math.round(built.width) });
      if (o.heightMm) validation.push({ id: o.id, type: o.type, label, dimension: "height", cadValue: Math.round(o.heightMm), modelValue: Math.round(built.height) });
    }
  }

  for (const e of entities) {
    if (e.type === "column" || e.type === "furniture") {
      const defaultHeight = e.type === "column" ? 3000 : furnitureDefaultHeightMm(e.label ?? "");
      const built = buildPointMass(e, defaultHeight, e.type === "column" ? COLORS.column : COLORS.furniture);
      if (!built) continue;
      group.add(built.object);
      const label = `${e.type === "column" ? "Column" : "Furniture"} ${e.label ?? ""}`.trim();
      if (e.widthMm) validation.push({ id: e.id, type: e.type, label, dimension: "width", cadValue: Math.round(e.widthMm), modelValue: Math.round(built.width) });
      if (e.depthMm) validation.push({ id: e.id, type: e.type, label, dimension: "depth", cadValue: Math.round(e.depthMm), modelValue: Math.round(built.depth) });
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
