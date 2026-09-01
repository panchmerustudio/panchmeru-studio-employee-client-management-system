/**
 * Sanity check for src/lib/cad3d/build-scene.ts — pure geometry/math, no
 * renderer needed, so this runs fine under plain Node via tsx.
 * Run with: npx tsx scripts/test-cad3d-build.ts
 */
import * as THREE from "three";
import { buildScene, type CadEntityInput } from "../src/lib/cad3d/build-scene";

const wallHeight = 3000;

const entities: CadEntityInput[] = [
  // A 4200mm wall, 230mm thick, with a 900mm door centered at x=1850 (matching the classify test).
  { id: "w1", type: "wall", layerName: "A-WALL", geometry: { start: { x: 0, y: 0 }, end: { x: 4200, y: 0 } }, depthMm: 230, heightMm: wallHeight },
  { id: "d1", type: "door", layerName: "A-DOOR", label: "DOOR_900", geometry: { position: { x: 1850, y: 0 } }, widthMm: 900, depthMm: 50, heightMm: 2100, rotationDeg: 0 },
  // A second wall with no openings.
  { id: "w2", type: "wall", layerName: "A-WALL", geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 3600 } }, depthMm: 230, heightMm: wallHeight },
  // A column.
  { id: "c1", type: "column", layerName: "A-COL", geometry: { position: { x: 4200, y: 3600 } }, widthMm: 300, depthMm: 300, heightMm: wallHeight, rotationDeg: 0 },
  // A room.
  { id: "r1", type: "room", layerName: "A-AREA", label: "Living Room", geometry: { points: [{ x: 115, y: 115 }, { x: 4085, y: 115 }, { x: 4085, y: 3485 }, { x: 115, y: 3485 }] } },
  // A DIAGONAL wall (45°, thin — 150mm thick, 3182mm long): this is the
  // regression case for the CAD<->3D "length/thickness swapped" bug. The
  // old validation measured a rotated wall's world-space AABB and picked
  // whichever axis was bigger as "length" — for any non-axis-aligned wall
  // that's a real distortion, not just floating-point noise, so this case
  // would previously fail even though the geometry was built correctly.
  { id: "w3", type: "wall", layerName: "A-WALL", geometry: { start: { x: 0, y: 0 }, end: { x: 2250, y: 2250 } }, depthMm: 150, heightMm: wallHeight },
  // Furniture, placed at an angle — exercises buildFurniture()'s kind
  // matching (from the block label) and confirms a rotated piece still
  // reports its true CAD width/depth rather than a rotated-AABB guess.
  { id: "f1", type: "furniture", layerName: "A-FURN", label: "SOFA_2S", geometry: { position: { x: 1000, y: 500 } }, widthMm: 1800, depthMm: 850, heightMm: 800, rotationDeg: 35 },
];

const { group, validation } = buildScene(entities, { windowSillMm: 900 });

console.log(`Total objects in scene: ${countMeshes(group)}`);
const w1Group = group.children.find((c) => c.children.some((m) => m.userData.cadEntityId === "w1"));
const w1SegCount = w1Group ? w1Group.children.length : 0;
console.log(`Wall w1 (has a door) split into ${w1SegCount} box segments (expect 3: left of door, above door, right of door)`);

const doorMesh = group.children.find((c) => c.userData?.cadEntityId === "d1");
console.log("Door mesh found:", !!doorMesh);
if (doorMesh) {
  const size = new THREE.Box3().setFromObject(doorMesh).getSize(new THREE.Vector3());
  console.log(`Door mesh size (mm): width=${Math.round(size.x * 1000)} height=${Math.round(size.y * 1000)} depth=${Math.round(size.z * 1000)}`);
}

console.log("\nValidation rows:");
for (const v of validation) {
  const ok = v.cadValue === v.modelValue;
  console.log(`${ok ? "PASS" : "FAIL"} ${v.label} ${v.dimension}: CAD=${v.cadValue} 3D=${v.modelValue}`);
  if (!ok) process.exitCode = 1;
}

function countMeshes(obj: THREE.Object3D): number {
  let n = obj.type === "Mesh" ? 1 : 0;
  for (const c of obj.children) n += countMeshes(c);
  return n;
}

check("wall with door split into 3 segments", w1SegCount === 3);
check("door mesh exists", !!doorMesh);

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
}
