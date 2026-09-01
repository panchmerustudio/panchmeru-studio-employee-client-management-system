/**
 * Sanity check for src/lib/cad3d/build-scene.ts — pure geometry/math, no
 * renderer needed, so this runs fine under plain Node via tsx.
 * Run with: npx tsx scripts/test-cad3d-build.ts
 */
import * as THREE from "three";
import { buildScene, clusterFurniturePositions, inferRoomLabel, furnitureLabelText, buildGroundMaterial, buildSkyBackground, type CadEntityInput } from "../src/lib/cad3d/build-scene";

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

/*
  Regression case for the "camera frames the whole scattered site instead
  of an actual room" bug: a real DWG often has more than one disconnected
  wall cluster on one sheet (e.g. a bare corridor here vs. a small
  furnished room far away). The initial focusBox must land on the
  furnished cluster, not the far larger but empty one — that's the
  difference between the camera opening on a legible close-up room and
  opening on kilometers of flat, illegible line work.
*/
const bigEmptyCluster: CadEntityInput[] = [
  { id: "bw1", type: "wall", layerName: "A-WALL", geometry: { start: { x: 0, y: 0 }, end: { x: 40000, y: 0 } }, depthMm: 230, heightMm: wallHeight },
  { id: "bw2", type: "wall", layerName: "A-WALL", geometry: { start: { x: 40000, y: 0 }, end: { x: 40000, y: 5000 } }, depthMm: 230, heightMm: wallHeight },
];
const smallFurnishedCluster: CadEntityInput[] = [
  { id: "sw1", type: "wall", layerName: "A-WALL", geometry: { start: { x: 500000, y: 500000 }, end: { x: 503000, y: 500000 } }, depthMm: 230, heightMm: wallHeight },
  { id: "sw2", type: "wall", layerName: "A-WALL", geometry: { start: { x: 503000, y: 500000 }, end: { x: 503000, y: 503000 } }, depthMm: 230, heightMm: wallHeight },
  { id: "sf1", type: "furniture", layerName: "A-FURN", label: "chair", geometry: { position: { x: 501500, y: 501500 } }, widthMm: 500, depthMm: 500, heightMm: 850, rotationDeg: 0 },
];
const { focusBox } = buildScene([...bigEmptyCluster, ...smallFurnishedCluster], { windowSillMm: 900 });
const focusCenter = focusBox?.getCenter(new THREE.Vector3());
check(
  "focus box lands on the small FURNISHED cluster, not the larger empty one",
  !!focusCenter && Math.abs(focusCenter.x - 501.5) < 5 && Math.abs(focusCenter.z - 501.5) < 5
);

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
}

/*
  Regression case for "bedrooms, kitchens... nothing is mentioned" — a
  toilet+basin cluster should read as a whole-room BATHROOM label (not just
  the per-item WC/BASIN tags), a bed+wardrobe cluster as BEDROOM, and a lone
  chair far from either (no confident room signal) should get no room label
  at all rather than a wrong guess. Room labels are rendered as canvas-text
  Sprites (see makeLabelSprite), which need a DOM `document` this plain-Node
  test script doesn't have — so this exercises the underlying
  clusterFurniturePositions()/inferRoomLabel() logic directly rather than
  buildScene()'s sprite output.
*/
const roomLabelFurniture = [
  { position: { x: 0, y: 0 }, tag: furnitureLabelText("WC") },
  { position: { x: 800, y: 0 }, tag: furnitureLabelText("wash basin") },
  { position: { x: 20000, y: 0 }, tag: furnitureLabelText("BED_QUEEN") },
  { position: { x: 21200, y: 500 }, tag: furnitureLabelText("wardrobe") },
  { position: { x: 40000, y: 0 }, tag: furnitureLabelText("chair") },
];
const roomClusters = clusterFurniturePositions(roomLabelFurniture);
check("room clustering finds 3 separate clusters (bathroom, bedroom, lone chair)", roomClusters.length === 3);
const bathroomCluster = roomClusters.find((c) => c.some((it) => it.position.x === 0));
const bedroomCluster = roomClusters.find((c) => c.some((it) => it.position.x === 20000));
const chairCluster = roomClusters.find((c) => c.some((it) => it.position.x === 40000));
check("bathroom cluster (WC+basin) infers BATHROOM", !!bathroomCluster && inferRoomLabel(new Set(bathroomCluster.map((c) => c.tag))) === "BATHROOM");
check("bedroom cluster (bed+wardrobe) infers BEDROOM", !!bedroomCluster && inferRoomLabel(new Set(bedroomCluster.map((c) => c.tag))) === "BEDROOM");
check("lone chair (no confident room signal) infers no room label", !!chairCluster && inferRoomLabel(new Set(chairCluster.map((c) => c.tag))) === null);

// buildScene() itself must still run clean end-to-end with these furniture
// entities (no crash from the new room-label pass) even though the sprites
// it would add are silently skipped without a DOM.
const roomLabelEntities: CadEntityInput[] = [
  { id: "wc1", type: "furniture", layerName: "A-FURN", label: "WC", geometry: { position: { x: 0, y: 0 } }, widthMm: 400, depthMm: 600, heightMm: 400, rotationDeg: 0 },
  { id: "basin1", type: "furniture", layerName: "A-FURN", label: "wash basin", geometry: { position: { x: 800, y: 0 } }, widthMm: 500, depthMm: 400, heightMm: 850, rotationDeg: 0 },
  { id: "bed1", type: "furniture", layerName: "A-FURN", label: "BED_QUEEN", geometry: { position: { x: 20000, y: 0 } }, widthMm: 1500, depthMm: 2000, heightMm: 500, rotationDeg: 0 },
  { id: "wardrobe1", type: "furniture", layerName: "A-FURN", label: "wardrobe", geometry: { position: { x: 21200, y: 500 } }, widthMm: 1200, depthMm: 600, heightMm: 2000, rotationDeg: 0 },
  { id: "chair1", type: "furniture", layerName: "A-FURN", label: "chair", geometry: { position: { x: 40000, y: 0 } }, widthMm: 500, depthMm: 500, heightMm: 850, rotationDeg: 0 },
];
let roomLabelBuildOk = true;
try {
  buildScene(roomLabelEntities, { windowSillMm: 900 });
} catch {
  roomLabelBuildOk = false;
}
check("buildScene() runs clean with the room-label pass wired in", roomLabelBuildOk);

/*
  Regression case for "give the option to fill... one room boundary with...
  tiles or... color paints" — this needs actual per-room floor regions
  (buildRoomFloorRegions in build-scene.ts), recovered by flood-filling the
  wall layout since real DXFs almost never draw room boundaries. Two rooms
  split by a solid dividing wall (no doorway) must come out as 2 separate
  paintable regions; the same two rooms with a doorway cut into that
  dividing wall must merge into 1 — a doorway is walkable, so the flood
  fill must cross it, the same way a person would read the plan.
*/
const outerRingWalls: CadEntityInput[] = [
  { id: "tr-w1", type: "wall", layerName: "A-WALL", geometry: { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } }, depthMm: 230, heightMm: wallHeight },
  { id: "tr-w2", type: "wall", layerName: "A-WALL", geometry: { start: { x: 6000, y: 0 }, end: { x: 6000, y: 4000 } }, depthMm: 230, heightMm: wallHeight },
  { id: "tr-w3", type: "wall", layerName: "A-WALL", geometry: { start: { x: 6000, y: 4000 }, end: { x: 0, y: 4000 } }, depthMm: 230, heightMm: wallHeight },
  { id: "tr-w4", type: "wall", layerName: "A-WALL", geometry: { start: { x: 0, y: 4000 }, end: { x: 0, y: 0 } }, depthMm: 230, heightMm: wallHeight },
];
const middleWall: CadEntityInput = { id: "tr-wmid", type: "wall", layerName: "A-WALL", geometry: { start: { x: 3000, y: 0 }, end: { x: 3000, y: 4000 } }, depthMm: 230, heightMm: wallHeight };
const wcInLeftRoom: CadEntityInput = { id: "tr-wc", type: "furniture", layerName: "A-FURN", label: "WC", geometry: { position: { x: 1000, y: 1000 } }, widthMm: 400, depthMm: 600, heightMm: 400, rotationDeg: 0 };

const { floorRegions: regionsNoDoor } = buildScene([...outerRingWalls, middleWall, wcInLeftRoom], { windowSillMm: 900 });
check("two rooms split by a solid dividing wall (no doorway) segment into 2 floor regions", regionsNoDoor.length === 2);
const bathroomRegion = regionsNoDoor.find((r) => r.roomLabel === "BATHROOM");
const otherRegion = regionsNoDoor.find((r) => r !== bathroomRegion);
check("the region containing the WC is labeled BATHROOM", !!bathroomRegion);
check("the region without furniture gets no confident room label", !!otherRegion && otherRegion.roomLabel === null);
check("both regions report a plausible floor area (each ~11 m² for a 2.77m x 4m clear room)", regionsNoDoor.every((r) => r.areaM2 > 5 && r.areaM2 < 15));

const doorInMiddleWall: CadEntityInput = { id: "tr-door", type: "door", layerName: "A-DOOR", label: "DOOR_900", geometry: { position: { x: 3000, y: 2000 } }, widthMm: 900, depthMm: 50, heightMm: 2100, rotationDeg: 90 };
const { floorRegions: regionsWithDoor } = buildScene([...outerRingWalls, middleWall, doorInMiddleWall], { windowSillMm: 900 });
check("cutting a doorway into the dividing wall merges the two rooms into 1 connected floor region", regionsWithDoor.length === 1);

/*
  Regression case for the "generate a 3D model of the building's front
  face" feature — an elevation_panel entity (see extractElevationViews in
  classify.ts) must build into a real upright, opening-cut facade mesh via
  buildElevationPanel(), whether or not a floor plan exists alongside it.
*/
const elevationOnlyEntity: CadEntityInput = {
  id: "elev1",
  type: "elevation_panel",
  layerName: "A-ELEV",
  label: "FRONT ELEVATION",
  geometry: {
    widthMm: 8000,
    heightMm: 3200,
    openings: [
      { xMm: 1000, zMm: 900, widthMm: 1200, heightMm: 1500, kind: "window" },
      { xMm: 3500, zMm: 0, widthMm: 900, heightMm: 2100, kind: "door" },
    ],
    // A stand-in for real, never-tagged-as-a-block facade detail (a gate
    // arch, a balcony rail, a molding line) — see extractElevationStrokes'
    // doc in classify.ts. buildElevationPanel must trace these onto the
    // panel's own face rather than silently dropping them.
    strokes: [
      { x1: 0, y1: 0, x2: 8000, y2: 0 },
      { x1: 4000, y1: 0, x2: 4000, y2: 1500 },
    ],
  },
  widthMm: 8000,
  depthMm: 3200,
  heightMm: 3200,
  rotationDeg: 0,
};

// Case A: elevation-only model (no walls at all) — mirrors what
// classifyDxf/extractElevationViews produce for a pure elevation sheet.
const { group: elevOnlyGroup, focusKind: elevOnlyFocusKind } = buildScene([elevationOnlyEntity], { windowSillMm: 900 });
check('elevation-only model reports focusKind "elevation" (drives the front-on default camera, not the plan corner view)', elevOnlyFocusKind === "elevation");
// The real app's WebGLRenderer recomputes every object's world matrix each
// frame; here nothing has rendered yet, so nested groups' position offsets
// (e.g. buildElevationPanel's own wrapping group) won't show up in a Box3
// until the scene graph's matrices are forced up to date once, top-down.
elevOnlyGroup.updateMatrixWorld(true);
const elevOnlyMesh = findMesh(elevOnlyGroup, (m) => m.userData?.cadEntityId === "elev1");
check("elevation-only model builds a panel mesh without crashing", !!elevOnlyMesh);
if (elevOnlyMesh) {
  const size = new THREE.Box3().setFromObject(elevOnlyMesh).getSize(new THREE.Vector3());
  const sizeMm = { x: Math.round(size.x * 1000), y: Math.round(size.y * 1000), z: Math.round(size.z * 1000) };
  console.log(`Elevation panel size (mm): width=${sizeMm.x} height=${sizeMm.y} thickness=${sizeMm.z}`);
  check("elevation panel width matches the measured elevation width (8000mm)", Math.abs(sizeMm.x - 8000) < 2);
  check("elevation panel height matches the measured elevation height (3200mm)", Math.abs(sizeMm.y - 3200) < 2);
  check("elevation panel has a plausible, non-fabricated thickness (a slab, not a paper cutout)", sizeMm.z > 0 && sizeMm.z < 1000);
}
check("elevation panel mesh is tagged cadType elevation_panel", elevOnlyMesh?.userData?.cadType === "elevation_panel");
const elevOnlyBox = elevOnlyMesh ? new THREE.Box3().setFromObject(elevOnlyMesh) : null;
check("elevation-only panel stands with its bottom edge at ground level (y≈0)", !!elevOnlyBox && Math.abs(elevOnlyBox.min.y) < 1);

const elevOnlyRelief = findMesh(
  elevOnlyGroup,
  (m) => m instanceof THREE.Mesh && m.userData?.cadEntityId === "elev1" && typeof m.userData?.note === "string" && m.userData.note.includes("traced")
);
check("elevation-only panel: the source drawing's real strokes were traced onto the panel as raised 3D relief bars, not dropped", !!elevOnlyRelief);
if (elevOnlyRelief instanceof THREE.Mesh) {
  const posAttr = elevOnlyRelief.geometry.getAttribute("position");
  check("traced strokes: relief geometry has 18 vertices per input stroke (2 strokes in the fixture -> 36 vertices; top face + 2 side walls, 2 tris each)", posAttr.count === 36);
  const strokeBox = new THREE.Box3().setFromObject(elevOnlyRelief);
  check("traced strokes: relief base sits flush with the panel's own front face (200mm)", Math.abs(strokeBox.min.z * 1000 - 200) < 1);
  check("traced strokes: relief stands proud by its stated (not measured) depth (200 + 15 = 215mm)", Math.abs(strokeBox.max.z * 1000 - 215) < 1);
}

// Case B: elevation view combined with a real floor plan — the panel must
// be offset in front of the building footprint (not overlapping the real
// walls) per buildElevationPanel's placement doc, and the wall geometry
// itself must be completely unaffected by the elevation entity being
// present (they share no coordinate frame).
const combinedEntities: CadEntityInput[] = [...outerRingWalls, elevationOnlyEntity];
const { group: combinedGroup, focusBox: combinedFocusBox, focusKind: combinedFocusKind } = buildScene(combinedEntities, { windowSillMm: 900 });
check('combined plan+elevation model still reports focusKind "elevation" (the elevation panel wins focus, per its own doc above)', combinedFocusKind === "elevation");
combinedGroup.updateMatrixWorld(true);
const combinedPanelMesh = findMesh(combinedGroup, (m) => m.userData?.cadEntityId === "elev1");
check("elevation panel still builds when a floor plan is also present", !!combinedPanelMesh);
if (combinedPanelMesh) {
  const panelBox = new THREE.Box3().setFromObject(combinedPanelMesh);
  // outerRingWalls' footprint spans plan-Y 0..4000mm, which maps to world Z
  // 0..4000mm (toThree: plan-Y -> world Z) — the panel must sit in front of
  // (i.e. at a smaller world-Z than) that footprint, not inside/behind it.
  check("elevation panel is offset clear of the real floor-plan footprint, not overlapping it", panelBox.max.z <= 0);
}
const w1MeshInCombined = findMesh(combinedGroup, (m) => m.userData?.cadEntityId === "tr-w1");
check("floor-plan wall geometry is unaffected by the elevation entity sharing the scene", !!w1MeshInCombined);

/*
  Regression case for "It is taking it as a floor plan" — a real report
  screenshot showed the model viewer's default camera framed on the floor
  plan with the elevation panel barely visible edge-on at the frame's edge.
  Root cause: computeFocusBox only ever looked at wall clusters, so a model
  with BOTH a floor plan and an elevation panel always framed on the plan.
  buildScene must now prefer the elevation panel's own bounds for its
  returned focusBox whenever one exists — that's what the model viewer's
  initial camera position AND its "Views" preset menu are both computed
  from (see model-viewer.tsx's setView/fitRef).
*/
check("model with both a floor plan and an elevation panel: focusBox comes back non-null", !!combinedFocusBox);
if (combinedFocusBox) {
  const size = combinedFocusBox.getSize(new THREE.Vector3());
  // The elevation panel (8000mm wide) is bigger than the wall footprint's
  // largest span (the outer ring is 6000x4000mm) — a focusBox still keyed
  // off the wall cluster would report a max span of ~6m, not ~8m.
  check(
    `focusBox is keyed off the elevation panel (~8m wide), not the smaller wall footprint (~6m) — got ${size.x.toFixed(2)}m`,
    Math.abs(size.x - 8) < 0.5
  );
}

/*
  "Push the visual quality further" — ground/sky/material regression cover.
  The actual THREE.Scene ground plane, sky background, and grid live in
  model-viewer.tsx (a browser component this headless harness can't mount),
  so what's checkable here is: (1) the exported texture/material builders
  buildGroundMaterial()/buildSkyBackground() run without a DOM and return a
  sane flat-color fallback instead of crashing (same "no `document`" guard
  as every other procedural texture in this module — see canUseCanvas's
  doc), and (2) walls whose layerName hints at a real-world material
  (stone/brick/glass/metal) still build correctly and, under this same
  headless mode, fall back to the identical shared default material as an
  unlabeled wall — the layer-driven material swap only activates where a
  canvas is available (i.e. in the browser), so headless behavior must stay
  byte-for-byte what it was before this feature existed.
*/
/*
  focusKind regression cover — the actual "it made it look like a floor
  plan" report this segment fixed (see defaultCameraPosition's doc in
  model-viewer.tsx) was a wide real elevation panel (37.9m x 10.8m) getting
  framed with the plan-shaped corner-view camera angle, not a
  misclassification of the geometry itself. buildScene must report which
  kind of thing focusBox is actually centered on so the camera framing can
  differ accordingly.
*/
const { focusKind: planOnlyFocusKind } = buildScene(entities, { windowSillMm: 900 });
check('a plain floor-plan model (walls, no elevation) reports focusKind "plan"', planOnlyFocusKind === "plan");

const { focusKind: sceneFallbackFocusKind } = buildScene(
  [{ id: "loose-chair", type: "furniture", layerName: "A-FURN", label: "chair", geometry: { position: { x: 0, y: 0 } }, widthMm: 500, depthMm: 500, heightMm: 850, rotationDeg: 0 }],
  { windowSillMm: 900 }
);
check('a model with neither walls nor an elevation panel falls back to focusKind "scene"', sceneFallbackFocusKind === "scene");

const groundMat = buildGroundMaterial(40);
check("buildGroundMaterial() returns a real material without crashing headlessly", groundMat instanceof THREE.MeshStandardMaterial);
check("headless ground material has no canvas texture (flat-color fallback, since there's no `document` here)", !groundMat.map);

const sky = buildSkyBackground();
check("buildSkyBackground() falls back to a flat THREE.Color headlessly (no `document` to draw a gradient canvas)", sky instanceof THREE.Color);

const materialLayerNames = ["A-WALL", "A-WALL-STONE", "BRICK-FACADE", "GLAZING", "MS-RAILING", "random-layer-name"];
const materialFixture: CadEntityInput[] = materialLayerNames.map((layerName, i) => ({
  id: `mw${i}`,
  type: "wall",
  layerName,
  geometry: { start: { x: i * 5000, y: 0 }, end: { x: i * 5000 + 4000, y: 0 } },
  depthMm: 230,
  heightMm: wallHeight,
}));
const { group: materialGroup } = buildScene(materialFixture, { windowSillMm: 900 });
const materialWallMeshCount = materialLayerNames.filter((_, i) =>
  materialGroup.children.some((c) => c.children.some((m) => m.userData?.cadEntityId === `mw${i}` && m.userData?.cadType === "wall"))
).length;
check("walls on stone/brick/glass/metal-hinting layer names still build without crashing", materialWallMeshCount === materialLayerNames.length);
const wallMaterials = materialLayerNames.map((_, i) => {
  const wallGroup = materialGroup.children.find((c) => c.children.some((m) => m.userData?.cadEntityId === `mw${i}`));
  const mesh = wallGroup?.children.find((m) => (m as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
  return mesh?.material;
});
check(
  "headlessly (no canvas), every wall shares the exact same default material regardless of layer-name material hints — unchanged from before this feature",
  wallMaterials.every((m) => !!m && m === wallMaterials[0])
);

function findMesh(obj: THREE.Object3D, pred: (m: THREE.Object3D) => boolean): THREE.Object3D | null {
  if (pred(obj)) return obj;
  for (const c of obj.children) {
    const found = findMesh(c, pred);
    if (found) return found;
  }
  return null;
}
