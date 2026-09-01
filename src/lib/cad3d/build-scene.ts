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
function makeTileTexture(base = "#d9cfb4", grout = "#a89a7c"): THREE.Texture {
  return createCanvasTexture(256, (ctx, s) => {
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

type BuiltWall = { group: THREE.Group; length: number; thickness: number; height: number; angleRad: number };

function buildWall(wall: WallInput, openings: OpeningInput[], windowSillMm: number): BuiltWall {
  const group = new THREE.Group();
  const { start, end } = wall.geometry;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const fallbackThickness = wall.depthMm ?? 230;
  const fallbackHeight = wall.heightMm ?? 3000;
  if (length < 1) return { group, length, thickness: fallbackThickness, height: fallbackHeight, angleRad: 0 };
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
  return { group, length, thickness, height: wallHeight, angleRad: angle };
}

type BuiltOpening = { object: THREE.Object3D; width: number; height: number };

/**
 * A proper door: two jambs + a lintel (light trim/casing) around a stained
 * wood leaf with a raised panel and a handle — not a single flat-colored
 * box. Built with its local origin at floor level / horizontal center, so
 * the caller just positions+rotates the whole group like any other opening.
 */
function buildDoorGroup(widthMm: number, heightMm: number, wallThicknessMm: number): THREE.Group {
  const g = new THREE.Group();
  const w = Math.max(widthMm, 200) * MM;
  const h = Math.max(heightMm, 200) * MM;
  const wallT = Math.max(wallThicknessMm, 40) * MM;
  const frameMat = furnMat(0xf0e6d2, 0.55, 0.04); // light casing/trim
  const leafMat = furnMat(0x7a4a2a, 0.45, 0.04); // stained wood
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xd8b26a, roughness: 0.25, metalness: 0.75 });

  const frameThick = Math.min(w * 0.07, 0.06);
  for (const s of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(frameThick, h, wallT * 1.04), frameMat);
    jamb.position.set(s * (w / 2 - frameThick / 2), h / 2, 0);
    g.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(w, frameThick, wallT * 1.04), frameMat);
  lintel.position.set(0, h - frameThick / 2, 0);
  g.add(lintel);

  const leafW = Math.max(w - frameThick * 2 - 0.01, 0.05);
  const leafH = Math.max(h - frameThick - 0.01, 0.05);
  const leafDepth = Math.min(wallT * 0.5, 0.045);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, leafDepth), leafMat);
  leaf.position.set(0, leafH / 2, 0);
  g.add(leaf);
  // raised center panel — reads as "a door", not a flat slab, even from a distance
  const panel = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.72, leafH * 0.55, leafDepth * 1.6), leafMat);
  panel.position.set(0, leafH * 0.56, 0);
  g.add(panel);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(Math.min(0.03, leafW * 0.06), 10, 10), handleMat);
  handle.position.set(leafW * 0.38, leafH * 0.45, leafDepth / 2 + 0.018);
  g.add(handle);

  return g;
}

/**
 * A proper window: light-colored frame with a header/sill/two jambs, a
 * tinted glass pane split by a cross-mullion, and a protruding sill ledge —
 * not a single flat translucent box. Local origin sits at the sill (window
 * bottom) / horizontal center, matching where the caller positions it.
 */
function buildWindowGroup(widthMm: number, heightMm: number, wallThicknessMm: number): THREE.Group {
  const g = new THREE.Group();
  const w = Math.max(widthMm, 200) * MM;
  const h = Math.max(heightMm, 200) * MM;
  const wallT = Math.max(wallThicknessMm, 40) * MM;
  const frameMat = furnMat(0xf5f3ec, 0.5, 0.08); // white/uPVC-style frame
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xaed7ea, roughness: 0.05, metalness: 0.05, transparent: true, opacity: 0.4, transmission: 0.35 });
  const sillMat = furnMat(0xe9e1cd, 0.6, 0.04);

  const frameThick = Math.min(Math.min(w, h) * 0.08, 0.05) + 0.01;
  for (const s of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(frameThick, h, wallT * 1.02), frameMat);
    jamb.position.set(s * (w / 2 - frameThick / 2), h / 2, 0);
    g.add(jamb);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(w, frameThick, wallT * 1.02), frameMat);
  header.position.set(0, h - frameThick / 2, 0);
  g.add(header);
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, frameThick, wallT * 1.02), frameMat);
  base.position.set(0, frameThick / 2, 0);
  g.add(base);

  const paneW = Math.max(w - frameThick * 2, 0.05);
  const paneH = Math.max(h - frameThick * 2, 0.05);
  const paneDepth = Math.min(wallT * 0.22, 0.018);
  const pane = new THREE.Mesh(new THREE.BoxGeometry(paneW, paneH, paneDepth), glassMat);
  pane.position.set(0, h / 2, 0);
  g.add(pane);
  const mullionDepth = Math.min(wallT * 0.3, 0.025);
  const vMullion = new THREE.Mesh(new THREE.BoxGeometry(Math.min(paneW * 0.07, 0.03), paneH, mullionDepth), frameMat);
  vMullion.position.set(0, h / 2, 0);
  g.add(vMullion);
  const hMullion = new THREE.Mesh(new THREE.BoxGeometry(paneW, Math.min(paneH * 0.07, 0.03), mullionDepth), frameMat);
  hMullion.position.set(0, h / 2, 0);
  g.add(hMullion);

  // sill ledge, protruding past the wall face — the single most recognizable "this is a window" cue
  const sillDepth = wallT * 1.4;
  const sillH = Math.min(h * 0.05, 0.035);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + frameThick * 1.6, sillH, sillDepth), sillMat);
  sill.position.set(0, -sillH / 2, 0);
  g.add(sill);

  return g;
}

/**
 * Door/window rotation MUST come from the host wall's own angle, not the
 * block's own CAD rotationDeg. An opening is always physically coplanar
 * with the wall it's cut into — but the INSERT's own rotation in the DXF
 * reflects however that particular block happened to be drawn/mirrored,
 * which is frequently NOT the same as the wall's run direction. Using it
 * directly is what produced the reported "door renders as a diagonal
 * slab, not fitted to the wall" bug: the wall gap was always cut correctly
 * (buildWall works entirely in the wall's own frame), but the door/window
 * mesh itself came out rotated to some unrelated angle, so it looked like
 * a stray diagonal object slicing across the corner of the opening instead
 * of neatly filling it. Deriving the rotation from the wall guarantees the
 * opening is always flush, for any file, not just this one.
 */
function buildOpening(o: OpeningInput, wallThicknessMm: number, windowSillMm: number, wallAngleRad: number): BuiltOpening {
  const width = o.widthMm ?? 900;
  const height = o.heightMm ?? (o.type === "door" ? 2100 : 1200);
  const zBottom = o.type === "window" ? windowSillMm : 0;
  const object = o.type === "door" ? buildDoorGroup(width, height, wallThicknessMm) : buildWindowGroup(width, height, wallThicknessMm);
  const pos = o.geometry.position;
  object.position.copy(toThree(pos.x, pos.y, zBottom));
  object.rotation.y = -wallAngleRad;
  object.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.castShadow = o.type === "door";
      c.receiveShadow = true;
    }
  });
  object.userData = { cadEntityId: o.id, cadType: o.type };
  return { object, width, height };
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

// Matte satin porcelain, not polished stone — roughness ~0.45 with near-zero
// metalness reads as ceramic under the scene's lighting; the earlier
// roughness (0.25) was reflective enough that a plain white box read as a
// glossy marble slab instead of a bathroom fixture ("bathroom... looking
// weird with the white marble" — that gloss was the whole problem, not the
// color, which is why the fix here is a rougher finish plus a rounder
// shape, not a different color).
const PORCELAIN_ROUGHNESS = 0.45;
const PORCELAIN_METALNESS = 0.03;

/** A toilet — cylindrical bowl + a torus rim (reads as a seat opening from any angle) + a tank behind, instead of a plain box. Used for WC/urinal/bidet-type fixtures specifically; see buildBasin for wash basins/sinks. */
function buildToilet(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const porcelain = furnMat(0xf6f4ee, PORCELAIN_ROUGHNESS, PORCELAIN_METALNESS);
  const seatMat = furnMat(0xffffff, 0.35, 0.02);

  const tankH = h * 0.5;
  const tank = new THREE.Mesh(new THREE.BoxGeometry(w * 0.76, tankH, d * 0.26), porcelain);
  tank.position.set(0, h - tankH / 2, -d * 0.37);
  g.add(tank);

  const bowlR = Math.min(w, d) * 0.36;
  const bowlH = h * 0.42;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(bowlR, bowlR * 0.7, bowlH, 16), porcelain);
  bowl.position.set(0, bowlH / 2, d * 0.06);
  g.add(bowl);

  const seat = new THREE.Mesh(new THREE.TorusGeometry(Math.max(bowlR * 0.75, 0.02), Math.max(bowlR * 0.16, 0.006), 8, 20), seatMat);
  seat.rotation.x = Math.PI / 2;
  seat.position.set(0, bowlH + 0.008, d * 0.06);
  g.add(seat);

  return g;
}

/** A wash basin/sink — a counter slab with a recessed round bowl and a low splashback, instead of a plain box. */
function buildBasin(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const porcelain = furnMat(0xf6f4ee, PORCELAIN_ROUGHNESS, PORCELAIN_METALNESS);
  const bowlMat = furnMat(0xffffff, 0.3, 0.02);

  const counterH = h * 0.52;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(w, counterH, d), porcelain);
  counter.position.y = counterH / 2;
  g.add(counter);

  const bowlR = Math.min(w, d) * 0.33;
  const bowlH = counterH * 0.5;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(bowlR, bowlR * 0.8, bowlH, 16), bowlMat);
  bowl.position.y = counterH - bowlH * 0.55;
  g.add(bowl);

  const splash = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h * 0.3, Math.max(d * 0.035, 0.012)), porcelain);
  splash.position.set(0, counterH + (h * 0.3) / 2, -d / 2 + 0.006);
  g.add(splash);

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
      // "sanitary" (from FURNITURE_KIND_PATTERNS) covers WC/urinal/bidet AND
      // basin/sink alike — they need visually distinct shapes, so re-check
      // the finer distinction here rather than adding a whole new kind just
      // for shape selection.
      g = /\bwc\b|toilet|commode|urinal|bidet/i.test(label) ? buildToilet(w, d, h) : buildBasin(w, d, h);
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

/*
  ---- Small floating text labels ----
  "So anyone can easily judge where is the bed, kitchen, toilet" without
  needing to recognize furniture silhouettes — a small always-camera-facing
  tag drawn on a canvas and applied to a Sprite. Gated behind canUseCanvas()
  for the same headless-Node-test reason as the wall/floor textures above.
*/
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeLabelSprite(text: string, worldHeightM = 0.22): THREE.Sprite | null {
  if (!canUseCanvas() || !text) return null;
  const fontPx = 44;
  const paddingX = 16;
  const paddingY = 12;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `700 ${fontPx}px system-ui, sans-serif`;
  const textWidth = measure.measureText(text).width;
  const c = document.createElement("canvas");
  c.width = Math.ceil(textWidth + paddingX * 2);
  c.height = fontPx + paddingY * 2;
  const ctx = c.getContext("2d")!;
  ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(24,22,18,0.78)";
  roundRectPath(ctx, 0, 0, c.width, c.height, 10);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999; // always readable, never buried behind a wall/furniture mesh
  const aspect = c.width / c.height;
  sprite.scale.set(worldHeightM * aspect, worldHeightM, 1);
  return sprite;
}

// Short, human-legible tags for the label sprite — deliberately finer-grained
// than FURNITURE_KIND_PATTERNS (which only needs to pick a 3D shape): a
// toilet and a wash basin get the same "sanitary" shape but should read as
// different words on screen so a bathroom's fixtures are individually
// identifiable, matching "where is the ... toilet" in the request.
const FURNITURE_LABEL_OVERRIDES: [RegExp, string][] = [
  [/\bwc\b|toilet|commode/i, "WC"],
  [/wash\s*basin|\bbasin\b|\bsink\b/i, "BASIN"],
  [/urinal/i, "URINAL"],
  [/bidet/i, "BIDET"],
  [/oven|\brange\b|stove|hob|cooktop/i, "STOVE"],
  [/refrigerator|\bfridge\b/i, "FRIDGE"],
  [/sofa|couch|settee/i, "SOFA"],
  [/\bbed\b/i, "BED"],
  [/dining/i, "DINING TABLE"],
  [/\btable\b/i, "TABLE"],
  [/\bdesk\b/i, "DESK"],
  [/wardrobe|almirah|cupboard/i, "WARDROBE"],
  [/cabinet/i, "CABINET"],
  [/\bchair\b/i, "CHAIR"],
  [/plant|planter/i, "PLANT"],
];

export function furnitureLabelText(label: string | null | undefined): string {
  const trimmed = (label ?? "").trim();
  for (const [re, text] of FURNITURE_LABEL_OVERRIDES) if (re.test(trimmed)) return text;
  // Fall back to the CAD block's own name if it's short and not internal
  // AutoCAD bookkeeping (classify.ts already keeps those out of `furniture`
  // entities, but stay defensive here too).
  if (trimmed && trimmed.length <= 16 && !/^\*|^A\$C/i.test(trimmed)) return trimmed.toUpperCase();
  const kind = furnitureKind(trimmed);
  return kind ? kind.toUpperCase() : "FURNITURE";
}

/**
 * A soft, semi-transparent color wash on the floor under a piece of
 * furniture — a cheap, robust substitute for real room-by-room coloring
 * (most real DXFs have no room-boundary polygons at all, see
 * buildFloorSlab's doc, so there's no "bathroom polygon" to tint). Tinting
 * the ground right under the fixture that DEFINES a room's use (a toilet,
 * a bed, a stove) gives the same "glance at the plan and see which room is
 * which" result without needing to know the room's actual outline.
 * Restricted to the three kinds the request explicitly named — coloring
 * every chair/table too would just be visual noise, not a clearer legend.
 */
const ZONE_TINT_BY_KIND: Record<string, number> = {
  sanitary: 0x8ecbe6, // toilet/bathroom — blue
  appliance: 0xf0c96b, // kitchen — warm yellow
  bed: 0xe3a8c8, // bedroom — pink
};

function buildZoneTint(kind: string, widthMm: number, depthMm: number): THREE.Mesh | null {
  const color = ZONE_TINT_BY_KIND[kind];
  if (!color) return null;
  const marginMm = 350;
  const w = Math.max(widthMm + marginMm * 2, 400) * MM;
  const d = Math.max(depthMm + marginMm * 2, 400) * MM;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006; // a hair above the floor slab to avoid z-fighting
  mesh.renderOrder = 1;
  return mesh;
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

// Room polygons are rare in real DXFs (see buildFloorSlab's doc) but when a
// ROOM/AREA layer with a legible name does exist, tint it and tag it
// instead of the same flat beige every room got before — "colorful ...
// where is the bed, kitchen, toilet" applies here too, not just furniture.
const ROOM_TINTS: [RegExp, number][] = [
  [/bed/i, 0xf1d9e6],
  [/toilet|bath|wc|wash/i, 0xcfeaf5],
  [/kitchen/i, 0xf8e6b8],
  [/living|lounge|drawing/i, 0xdcefd4],
  [/dining/i, 0xeee0cf],
  [/stair/i, 0xe2ded4],
];
function roomColor(label: string): number {
  for (const [re, color] of ROOM_TINTS) if (re.test(label)) return color;
  return COLORS.room;
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

/*
  ---- Floor finish catalog: tiles and paints the user can pick per room ----
  A small, curated set rather than a full color wheel — enough variety to
  tell rooms apart at a glance ("give the different options of the tiles or
  the color paints") without turning the picker into a paint-store SKU
  list. Every non-paint finish is a procedural canvas texture (no network
  asset dependency, same approach as the existing tile floor).
*/
export type FloorFinish = { id: string; label: string; swatch: string };
export const FLOOR_FINISHES: FloorFinish[] = [
  { id: "tile-cream", label: "Ceramic Tile — Cream", swatch: "#d9cfb4" },
  { id: "tile-white", label: "Ceramic Tile — White", swatch: "#eef0ee" },
  { id: "tile-grey", label: "Ceramic Tile — Grey", swatch: "#9aa1a6" },
  { id: "wood-oak", label: "Wood Plank — Oak", swatch: "#c79a67" },
  { id: "wood-walnut", label: "Wood Plank — Walnut", swatch: "#6b4a30" },
  { id: "marble-white", label: "Marble — White & Grey", swatch: "#eeeceb" },
  { id: "paint-white", label: "Paint — White", swatch: "#f5f4f0" },
  { id: "paint-blue", label: "Paint — Sky Blue", swatch: "#a9cbe0" },
  { id: "paint-green", label: "Paint — Sage Green", swatch: "#b7c9a8" },
  { id: "paint-terracotta", label: "Paint — Terracotta", swatch: "#c98c62" },
  { id: "paint-charcoal", label: "Paint — Charcoal", swatch: "#4a4a4a" },
];

const TILE_COLOR_PRESETS: Record<string, [string, string]> = {
  cream: ["#d9cfb4", "#a89a7c"],
  white: ["#eef0ee", "#c9c9c2"],
  grey: ["#9aa1a6", "#75797d"],
};
const WOOD_COLOR_PRESETS: Record<string, [string, string]> = {
  oak: ["#c79a67", "#a97e4e"],
  walnut: ["#6b4a30", "#523524"],
};
const MARBLE_COLOR_PRESETS: Record<string, [string, string]> = {
  white: ["#eeeceb", "#9b968e"],
};
const PAINT_COLOR_PRESETS: Record<string, string> = {
  white: "#f5f4f0",
  blue: "#a9cbe0",
  green: "#b7c9a8",
  terracotta: "#c98c62",
  charcoal: "#4a4a4a",
};

function makeWoodTexture(base: string, dark: string): THREE.Texture {
  return createCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const plankH = s / 6;
    for (let i = 0; i < 6; i++) {
      const y = i * plankH;
      ctx.fillStyle = i % 2 === 0 ? base : dark;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, y, s, plankH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
      for (let g = 0; g < 6; g++) {
        const gy = y + Math.random() * plankH;
        ctx.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.06})`;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(s * 0.3, gy + 2, s * 0.7, gy - 2, s, gy);
        ctx.stroke();
      }
    }
  });
}

function makeMarbleTexture(base: string, vein: string): THREE.Texture {
  return createCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = vein;
    for (let i = 0; i < 10; i++) {
      ctx.lineWidth = 0.5 + Math.random() * 1.5;
      ctx.globalAlpha = 0.25 + Math.random() * 0.35;
      ctx.beginPath();
      let x = Math.random() * s;
      let y = Math.random() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (Math.random() - 0.5) * s * 0.5;
        y += (Math.random() - 0.5) * s * 0.5;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/** Builds a fresh, independently-repeatable material for one floor finish id (see FLOOR_FINISHES) — used both for a room's initial default finish and whenever the user repaints it from the picker. */
export function buildFloorFinishMaterial(finishId: string): THREE.MeshStandardMaterial {
  const dash = finishId.indexOf("-");
  const kind = dash === -1 ? finishId : finishId.slice(0, dash);
  const variant = dash === -1 ? "" : finishId.slice(dash + 1);

  if (kind === "paint") {
    const hex = PAINT_COLOR_PRESETS[variant] ?? PAINT_COLOR_PRESETS.white;
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.6, metalness: 0.02 });
  }
  if (!canUseCanvas()) {
    const fallback = kind === "wood" ? WOOD_COLOR_PRESETS[variant]?.[0] : kind === "marble" ? MARBLE_COLOR_PRESETS[variant]?.[0] : TILE_COLOR_PRESETS[variant]?.[0];
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(fallback ?? "#d9cfb4"), roughness: 0.5 });
  }
  let tex: THREE.Texture;
  let roughness = 0.5;
  let metalness = 0.03;
  if (kind === "wood") {
    const [base, dark] = WOOD_COLOR_PRESETS[variant] ?? WOOD_COLOR_PRESETS.oak;
    tex = makeWoodTexture(base, dark);
    roughness = 0.42;
  } else if (kind === "marble") {
    const [base, vein] = MARBLE_COLOR_PRESETS[variant] ?? MARBLE_COLOR_PRESETS.white;
    tex = makeMarbleTexture(base, vein);
    roughness = 0.22;
    metalness = 0.05;
  } else {
    const [base, grout] = TILE_COLOR_PRESETS[variant] ?? TILE_COLOR_PRESETS.cream;
    tex = makeTileTexture(base, grout);
  }
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return new THREE.MeshStandardMaterial({ map: tex, roughness, metalness });
}

// A room's furniture already tells us what it probably is (see
// inferRoomLabel below) — use that to pick a sensible starting finish
// instead of tiling every room identically cream, so a freshly-generated
// model already looks deliberate before anyone touches the picker.
const DEFAULT_FINISH_BY_ROOM: Record<string, string> = {
  BATHROOM: "tile-white",
  "WASH AREA": "tile-white",
  KITCHEN: "tile-grey",
  BEDROOM: "wood-oak",
  "LIVING ROOM": "wood-walnut",
  "DINING AREA": "wood-walnut",
};

export type FloorRegion = { id: string; object: THREE.Mesh; roomLabel: string | null; areaM2: number };

const ROOM_GRID_MAX_CELLS_PER_AXIS = 160; // caps grid resolution so even a large/irregular footprint segments in well under a second
const ROOM_GRID_MIN_CELL_MM = 90;
const ROOM_GRID_MAX_CELL_MM = 260;
const MIN_ROOM_REGION_AREA_M2 = 1.2; // filters out slivers/noise — a stray 0.3m² pocket between two walls isn't a paintable room

/*
  ---- Per-room floor regions, for the paint/tile picker ----
  "give the option to fill... one room boundary with... tiles or... color
  paints" needs an actual room BOUNDARY to fill, and — per buildFloorSlab's
  doc above — most real DXFs never draw one. This recovers room boundaries
  the same way a person reads a floor plan: rasterize the building
  footprint onto a fine grid, mark any cell a wall's centerline (+half its
  thickness) passes through as blocked, punch a clearing through that
  blocking at every doorway (a person can walk through a door, so a flood
  fill should too), and flood-fill the rest — each connected component of
  open floor IS a room, wall-separated from its neighbors, whether or not
  the DXF ever labeled it. Windows are left blocking (you can't walk
  through one), which is a reasonable approximation for exterior walls.
*/
function buildRoomFloorRegions(walls: WallInput[], doors: OpeningInput[], furnitureRefs: { position: Pt; tag: string }[]): FloorRegion[] {
  if (walls.length === 0) return [];
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
  const widthMm = maxX - minX;
  const depthMm = maxY - minY;
  if (widthMm < 500 || depthMm < 500) return [];

  const cellMm = Math.min(ROOM_GRID_MAX_CELL_MM, Math.max(ROOM_GRID_MIN_CELL_MM, Math.max(widthMm, depthMm) / ROOM_GRID_MAX_CELLS_PER_AXIS));
  const cols = Math.max(1, Math.ceil(widthMm / cellMm));
  const rows = Math.max(1, Math.ceil(depthMm / cellMm));
  if (cols * rows > 60000 || cols * rows === 0) return []; // safety valve — bail rather than build a runaway grid on some pathological input

  const blocked = new Uint8Array(cols * rows);
  const idx = (gx: number, gy: number) => gy * cols + gx;
  const cellCenter = (gx: number, gy: number): Pt => ({ x: minX + (gx + 0.5) * cellMm, y: minY + (gy + 0.5) * cellMm });
  function distToSegment(p: Pt, a: Pt, b: Pt): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby || 1e-9;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
  }

  for (const w of walls) {
    const half = (w.depthMm ?? 230) / 2 + cellMm * 0.6;
    const { start, end } = w.geometry;
    const gxMin = Math.max(0, Math.floor((Math.min(start.x, end.x) - half - minX) / cellMm));
    const gxMax = Math.min(cols - 1, Math.ceil((Math.max(start.x, end.x) + half - minX) / cellMm));
    const gyMin = Math.max(0, Math.floor((Math.min(start.y, end.y) - half - minY) / cellMm));
    const gyMax = Math.min(rows - 1, Math.ceil((Math.max(start.y, end.y) + half - minY) / cellMm));
    for (let gy = gyMin; gy <= gyMax; gy++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        if (distToSegment(cellCenter(gx, gy), start, end) <= half) blocked[idx(gx, gy)] = 1;
      }
    }
  }

  for (const d of doors) {
    const r = Math.max((d.widthMm ?? 900) / 2, 400);
    const gxMin = Math.max(0, Math.floor((d.geometry.position.x - r - minX) / cellMm));
    const gxMax = Math.min(cols - 1, Math.ceil((d.geometry.position.x + r - minX) / cellMm));
    const gyMin = Math.max(0, Math.floor((d.geometry.position.y - r - minY) / cellMm));
    const gyMax = Math.min(rows - 1, Math.ceil((d.geometry.position.y + r - minY) / cellMm));
    for (let gy = gyMin; gy <= gyMax; gy++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const c = cellCenter(gx, gy);
        if (Math.hypot(c.x - d.geometry.position.x, c.y - d.geometry.position.y) <= r) blocked[idx(gx, gy)] = 0;
      }
    }
  }

  const visited = new Uint8Array(cols * rows);
  const regionsCells: number[][] = [];
  for (let s = 0; s < cols * rows; s++) {
    if (blocked[s] || visited[s]) continue;
    const cells: number[] = [];
    const stack = [s];
    visited[s] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      cells.push(cur);
      const gx = cur % cols;
      const gy = Math.floor(cur / cols);
      const neighbors: [number, number][] = [
        [gx - 1, gy],
        [gx + 1, gy],
        [gx, gy - 1],
        [gx, gy + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = idx(nx, ny);
        if (blocked[ni] || visited[ni]) continue;
        visited[ni] = 1;
        stack.push(ni);
      }
    }
    regionsCells.push(cells);
  }
  if (regionsCells.length === 0) return [];

  // The building's open exterior (if the wall loop doesn't fully close, or
  // this cluster is a small detail sitting inside a much larger empty
  // sheet — see clusterWalls' doc) floods into one huge region touching
  // the grid's own edge — that's the surrounding void, not a room, so drop
  // it before it gets a paintable floor slab of its own.
  const cellAreaM2 = cellMm * MM * (cellMm * MM);
  const touchesEdge = (cells: number[]) =>
    cells.some((c) => {
      const gx = c % cols;
      const gy = Math.floor(c / cols);
      return gx === 0 || gy === 0 || gx === cols - 1 || gy === rows - 1;
    });
  const totalOpenCells = regionsCells.reduce((sum, c) => sum + c.length, 0);
  const rooms = regionsCells.filter((cells) => {
    const areaM2 = cells.length * cellAreaM2;
    if (areaM2 < MIN_ROOM_REGION_AREA_M2) return false;
    if (touchesEdge(cells) && cells.length > totalOpenCells * 0.5) return false; // dominant edge-touching region = the outside
    return true;
  });
  if (rooms.length === 0) return [];

  const cellRegionIndex = new Int32Array(cols * rows).fill(-1);
  rooms.forEach((cells, i) => cells.forEach((c) => (cellRegionIndex[c] = i)));

  return rooms.map((cells, i) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    let sumX = 0;
    let sumY = 0;
    for (const c of cells) {
      const gx = c % cols;
      const gy = Math.floor(c / cols);
      const x0 = (minX + gx * cellMm) * MM;
      const x1 = (minX + (gx + 1) * cellMm) * MM;
      const y0 = (minY + gy * cellMm) * MM;
      const y1 = (minY + (gy + 1) * cellMm) * MM;
      positions.push(x0, 0, y0, x1, 0, y0, x1, 0, y1, x0, 0, y0, x1, 0, y1, x0, 0, y1);
      for (let n = 0; n < 6; n++) normals.push(0, 1, 0);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      sumX += minX + (gx + 0.5) * cellMm;
      sumY += minY + (gy + 0.5) * cellMm;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

    const tagsHere = new Set<string>();
    for (const f of furnitureRefs) {
      const gx = Math.floor((f.position.x - minX) / cellMm);
      const gy = Math.floor((f.position.y - minY) / cellMm);
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      if (cellRegionIndex[idx(gx, gy)] === i) tagsHere.add(f.tag);
    }
    const roomLabel = inferRoomLabel(tagsHere);
    const areaM2 = cells.length * cellAreaM2;
    const defaultFinish = DEFAULT_FINISH_BY_ROOM[roomLabel ?? ""] ?? "tile-cream";
    const material = buildFloorFinishMaterial(defaultFinish);
    if (material.map) {
      const rep = Math.max(1, Math.round(Math.sqrt(areaM2) / 0.6));
      material.map.repeat.set(rep, rep);
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = 0.012; // above the base tiled slab (and the 0.006 zone-tint layer) to avoid z-fighting
    mesh.receiveShadow = true;
    const id = `room-${i}`;
    mesh.userData = { cadType: "floorRegion", regionId: id, roomLabel, areaM2, finishId: defaultFinish, centroidMm: { x: sumX / cells.length, y: sumY / cells.length } };
    return { id, object: mesh, roomLabel, areaM2 };
  });
}

/**
 * Groups walls into contiguous clusters by endpoint proximity (simple
 * union-find — cheap even at a few hundred walls). Real-world DWGs
 * frequently pack more than one disconnected floor plan/detail into a
 * single drawing sheet (a typical-unit toilet layout, a kitchen detail, an
 * unrelated schedule) that all land in the same "wall" layer — flattening
 * everything into one bounding box means the camera has to back out far
 * enough to fit ALL of them, which is exactly what makes a real room's
 * walls and furniture shrink to illegible flat lines. Clustering lets the
 * viewer pick just the one cluster that's actually worth looking at by
 * default.
 */
function clusterWalls(walls: WallInput[]): WallInput[][] {
  const CLUSTER_GAP_MM = 3000; // endpoints within 3m of each other are treated as the same contiguous group of rooms
  const parent = walls.map((_, i) => i);
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
  function near(a: Pt, b: Pt) {
    return Math.hypot(a.x - b.x, a.y - b.y) < CLUSTER_GAP_MM;
  }
  for (let i = 0; i < walls.length; i++) {
    const { start: as, end: ae } = walls[i].geometry;
    for (let j = i + 1; j < walls.length; j++) {
      const { start: bs, end: be } = walls[j].geometry;
      if (near(as, bs) || near(as, be) || near(ae, bs) || near(ae, be)) union(i, j);
    }
  }
  const groups = new Map<number, WallInput[]>();
  walls.forEach((w, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(w);
  });
  return [...groups.values()];
}

/*
  ---- Whole-room labels (BEDROOM / KITCHEN / BATHROOM / ...) ----
  "Bedrooms, kitchens... nothing is mentioned" — the per-item tags (BED,
  WC, STOVE, ...) added elsewhere in this file only ever mark a single
  piece of furniture, not the room it's in. Real DXFs essentially never
  carry room-boundary polygons (see buildFloorSlab's doc — this is the
  same reason there's no floor-plan "room" layer to read a name from), so
  there's no boundary to label directly. Instead this infers a room from
  furniture that's physically close together — a toilet, a basin, and
  nothing else within a few meters IS a bathroom, whether or not the DXF
  ever says so — the same way a person reads a plan.
*/
const ROOM_CLUSTER_GAP_MM = 4500; // furniture within ~4.5m of each other reads as sharing one room; real inter-room spacing (a wall's worth of distance, or more) is reliably bigger than this

export function clusterFurniturePositions(items: { position: Pt; tag: string }[]): { position: Pt; tag: string }[][] {
  const parent = items.map((_, i) => i);
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
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (Math.hypot(items[i].position.x - items[j].position.x, items[i].position.y - items[j].position.y) < ROOM_CLUSTER_GAP_MM) union(i, j);
    }
  }
  const groups = new Map<number, { position: Pt; tag: string }[]>();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(it);
  });
  return [...groups.values()];
}

// Ordered most- to least-decisive: a toilet or stove in a cluster settles
// what the room is even if a stray chair is also nearby (open-plan
// kitchen/dining), so those checks run first. A cluster whose furniture
// gives no confident signal is left unlabeled rather than guessed.
const ROOM_LABEL_RULES: [string[], string][] = [
  [["WC", "URINAL", "BIDET"], "BATHROOM"],
  [["STOVE", "FRIDGE"], "KITCHEN"],
  [["BASIN"], "WASH AREA"],
  [["BED"], "BEDROOM"],
  [["WARDROBE"], "BEDROOM"],
  [["SOFA"], "LIVING ROOM"],
  [["DINING TABLE"], "DINING AREA"],
];

export function inferRoomLabel(tags: Set<string>): string | null {
  for (const [members, roomLabel] of ROOM_LABEL_RULES) {
    if (members.some((m) => tags.has(m))) return roomLabel;
  }
  return null;
}

/**
 * Picks which cluster the camera should actually start looking at, and
 * returns its world-space bounds. Furniture is what the person actually
 * asked to check, so a cluster that has real furniture/fixtures near it
 * outweighs a larger but empty one — a big bare corridor of partition
 * walls with nothing in it isn't a more useful default view than a small
 * furnished room. Falls back to the largest wall cluster when nothing has
 * furniture nearby, and to the whole scene when there are no walls at all.
 */
function computeFocusBox(walls: WallInput[], pointEntities: CadEntityInput[]): THREE.Box3 | null {
  if (walls.length === 0) return null;
  const clusters = clusterWalls(walls);

  // Two-tier pick, not a single blended score: a cluster with even one real
  // furniture/fixture item is always preferred over one with none — a big
  // bare corridor of partition walls isn't a more useful default view than
  // a small furnished room, no matter how many more walls it has. Among
  // clusters that DO have furniture, prefer the most furnished one, then
  // the most COMPACT one as a tiebreaker (a smaller footprint reads as a
  // legible close-up room instead of a diluted overview) — favoring wall
  // count there would undo the whole point by picking a sprawling cluster
  // just because one stray fixture happens to sit inside its bounds.
  let best = clusters[0];
  let bestFurniture = -1;
  let bestSpan = Infinity;
  for (const cluster of clusters) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const w of cluster) {
      for (const p of [w.geometry.start, w.geometry.end]) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const marginMm = 1500;
    let furnitureNearby = 0;
    for (const e of pointEntities) {
      const pos = (e.geometry as { position?: Pt }).position;
      if (!pos) continue;
      if (pos.x >= minX - marginMm && pos.x <= maxX + marginMm && pos.y >= minY - marginMm && pos.y <= maxY + marginMm) furnitureNearby++;
    }
    const span = Math.max(maxX - minX, maxY - minY);

    const better =
      bestFurniture === 0 && furnitureNearby === 0
        ? cluster.length > best.length // neither has furniture yet — fall back to "most walls" among those
        : furnitureNearby > bestFurniture || (furnitureNearby === bestFurniture && furnitureNearby > 0 && span < bestSpan);
    if (better) {
      best = cluster;
      bestFurniture = furnitureNearby;
      bestSpan = span;
    }
  }

  const box = new THREE.Box3();
  let maxHeight = 3000;
  for (const w of best) {
    box.expandByPoint(toThree(w.geometry.start.x, w.geometry.start.y, 0));
    box.expandByPoint(toThree(w.geometry.end.x, w.geometry.end.y, 0));
    maxHeight = Math.max(maxHeight, w.heightMm ?? 3000);
  }
  box.max.y = Math.max(box.max.y, maxHeight * MM);
  return box;
}

export function buildScene(
  entities: CadEntityInput[],
  opts: { windowSillMm: number }
): { group: THREE.Group; validation: ValidationRow[]; focusBox: THREE.Box3 | null; floorRegions: FloorRegion[] } {
  const group = new THREE.Group();
  const validation: ValidationRow[] = [];

  const walls = entities.filter((e): e is WallInput => e.type === "wall") as WallInput[];
  const openings = entities.filter((e): e is OpeningInput => e.type === "door" || e.type === "window") as OpeningInput[];
  const byWall = assignOpeningsToWalls(walls, openings);

  // Collected once up front so both the paint/tile floor regions below and
  // the whole-room labels further down (see clusterFurniturePositions'
  // doc) work from the same furniture positions/tags.
  const furnitureRefs: { position: Pt; tag: string }[] = [];
  for (const e of entities) {
    if (e.type !== "furniture") continue;
    const geo = e.geometry as { position?: Pt };
    if (!geo.position) continue;
    furnitureRefs.push({ position: geo.position, tag: furnitureLabelText(e.label) });
  }

  const floor = buildFloorSlab(walls);
  if (floor) group.add(floor);

  const doors = openings.filter((o) => o.type === "door");
  const floorRegions = buildRoomFloorRegions(walls, doors, furnitureRefs);
  for (const region of floorRegions) group.add(region.object);

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
  const wallAngles: number[] = [];
  walls.forEach((w, i) => {
    const wallOpenings = byWall.get(i) ?? [];
    const built = buildWall(w, wallOpenings, opts.windowSillMm);
    group.add(built.group);
    wallAngles[i] = built.angleRad;
    validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "length", cadValue: Math.round(built.length), modelValue: Math.round(built.length) });
    if (w.depthMm) validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "thickness", cadValue: Math.round(w.depthMm), modelValue: Math.round(built.thickness) });
    if (w.heightMm) validation.push({ id: w.id, type: "wall", label: `Wall (${w.layerName ?? ""})`, dimension: "height", cadValue: Math.round(w.heightMm), modelValue: Math.round(built.height) });
  });

  for (const [wallIdx, wallOpenings] of byWall) {
    const wallThickness = walls[wallIdx]?.depthMm ?? 230;
    const wallAngle = wallAngles[wallIdx] ?? 0;
    for (const o of wallOpenings) {
      const built = buildOpening(o, wallThickness, opts.windowSillMm, wallAngle);
      group.add(built.object);
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
      if (e.type === "furniture") {
        const height = e.heightMm || furnitureDefaultHeightMm(e.label ?? "");
        const tag = makeLabelSprite(furnitureLabelText(e.label));
        if (tag) {
          tag.position.set(0, height * MM + 0.14, 0);
          built.object.add(tag);
        }
        const kind = furnitureKind(e.label ?? "");
        const zoneTint = kind ? buildZoneTint(kind, built.width, built.depth) : null;
        if (zoneTint) built.object.add(zoneTint);
      }
    } else if (e.type === "room") {
      const geo = e.geometry as { points?: Pt[] };
      if (!geo.points) continue;
      const label = e.label ?? "";
      const mesh = buildFlatPolygon(geo.points, 20, roomColor(label));
      if (!mesh) continue;
      mesh.userData = { cadEntityId: e.id, cadType: "room" };
      group.add(mesh);
      if (label) {
        const cx = geo.points.reduce((s, p) => s + p.x, 0) / geo.points.length;
        const cy = geo.points.reduce((s, p) => s + p.y, 0) / geo.points.length;
        const tag = makeLabelSprite(label.toUpperCase(), 0.32);
        if (tag) {
          tag.position.copy(toThree(cx, cy, 1500));
          group.add(tag);
        }
      }
    } else if (e.type === "stair") {
      const geo = e.geometry as { points?: Pt[] };
      if (!geo.points) continue;
      const mesh = buildFlatPolygon(geo.points, e.heightMm ?? 3000, COLORS.stair);
      if (!mesh) continue;
      mesh.userData = { cadEntityId: e.id, cadType: "stair", note: "simplified mass — not individual treads" };
      group.add(mesh);
    }
  }

  // Whole-room labels (BEDROOM / KITCHEN / BATHROOM / ...) — see
  // clusterFurniturePositions/inferRoomLabel above for why this is inferred
  // from furniture proximity rather than read off a "room" layer.
  // (furnitureRefs was already collected near the top of this function.)
  for (const cluster of clusterFurniturePositions(furnitureRefs)) {
    const tags = new Set(cluster.map((c) => c.tag));
    const roomLabel = inferRoomLabel(tags);
    if (!roomLabel) continue;
    const cx = cluster.reduce((s, c) => s + c.position.x, 0) / cluster.length;
    const cy = cluster.reduce((s, c) => s + c.position.y, 0) / cluster.length;
    const tag = makeLabelSprite(roomLabel, 0.36);
    if (tag) {
      tag.position.copy(toThree(cx, cy, 2100));
      group.add(tag);
    }
  }

  const pointEntities = entities.filter((e) => e.type === "furniture" || e.type === "column" || e.type === "door" || e.type === "window");
  const focusBox = computeFocusBox(walls, pointEntities);

  return { group, validation, focusBox, floorRegions };
}
