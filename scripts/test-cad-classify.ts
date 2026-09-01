/**
 * Standalone sanity check for src/lib/dxf/classify.ts, run directly against
 * a hand-built IDxf-shaped object (skipping the raw-DXF-text parsing step,
 * which is dxf-parser's own well-tested job — the real risk here is our
 * classification/geometry logic). Run with: npx tsx scripts/test-cad-classify.ts
 */
import { classifyDxf, type ClassifiedOpening, type ClassifiedFurniture } from "../src/lib/dxf/classify";
import type { IDxf } from "dxf-parser";

function rectBlockEntities(w: number, h: number) {
  return [
    {
      type: "LWPOLYLINE",
      layer: "0",
      handle: 1,
      shape: true,
      vertices: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    },
  ];
}

// A 4200 x 3600mm room (outer wall centerline rectangle), 230mm thick walls,
// one door on the south wall, one window on the east wall, one desk inside.
const T = 115; // half-thickness

const dxf = {
  header: {},
  blocks: {
    DOOR_900: { name: "DOOR_900", entities: rectBlockEntities(900, 50) },
    WIN_1200: { name: "WIN_1200", entities: rectBlockEntities(1200, 50) },
    DESK_1800: { name: "DESK_1800", entities: rectBlockEntities(1800, 750) },
  },
  entities: [
    // South wall pair (outer/inner), running along x from 0 to 4200
    { type: "LINE", layer: "A-WALL", handle: 10, vertices: [{ x: 0, y: -T }, { x: 4200, y: -T }] },
    { type: "LINE", layer: "A-WALL", handle: 11, vertices: [{ x: 0, y: T }, { x: 4200, y: T }] },
    // North wall pair, y=3600
    { type: "LINE", layer: "A-WALL", handle: 12, vertices: [{ x: 0, y: 3600 + T }, { x: 4200, y: 3600 + T }] },
    { type: "LINE", layer: "A-WALL", handle: 13, vertices: [{ x: 0, y: 3600 - T }, { x: 4200, y: 3600 - T }] },
    // West wall pair, x=0
    { type: "LINE", layer: "A-WALL", handle: 14, vertices: [{ x: -T, y: 0 }, { x: -T, y: 3600 }] },
    { type: "LINE", layer: "A-WALL", handle: 15, vertices: [{ x: T, y: 0 }, { x: T, y: 3600 }] },
    // East wall pair, x=4200 — but only ONE line, to test the "unpaired" path
    { type: "LINE", layer: "A-WALL", handle: 16, vertices: [{ x: 4200 - T, y: 0 }, { x: 4200 - T, y: 3600 }] },

    // Door on south wall
    { type: "INSERT", layer: "A-DOOR", handle: 20, name: "DOOR_900", position: { x: 1850, y: 0 }, rotation: 0, xScale: 1, yScale: 1 },
    // Window on north wall
    { type: "INSERT", layer: "A-WINDOW", handle: 21, name: "WIN_1200", position: { x: 2000, y: 3600 }, rotation: 0, xScale: 1, yScale: 1 },
    // Desk (generic furniture block, no door/window/column keyword)
    { type: "INSERT", layer: "A-FURN", handle: 22, name: "DESK_1800", position: { x: 2000, y: 500 }, rotation: 0, xScale: 1, yScale: 1 },
    // Block instance whose block definition is missing entirely (edge case)
    { type: "INSERT", layer: "A-FURN", handle: 23, name: "GHOST_BLOCK", position: { x: 500, y: 500 }, rotation: 0, xScale: 1, yScale: 1 },

    // Room boundary + label
    {
      type: "LWPOLYLINE",
      layer: "A-AREA",
      handle: 30,
      shape: true,
      vertices: [
        { x: T, y: T },
        { x: 4200 - T, y: T },
        { x: 4200 - T, y: 3600 - T },
        { x: T, y: 3600 - T },
      ],
    },
    { type: "TEXT", layer: "A-TEXT", handle: 31, text: "Living Room", startPoint: { x: 2000, y: 1800 } },

    // Stray unrelated line, unclassified
    { type: "LINE", layer: "0", handle: 40, vertices: [{ x: -500, y: -500 }, { x: -100, y: -500 }] },
    // Annotation clutter — should be counted, not stored
    { type: "DIMENSION", layer: "A-DIM", handle: 41 },

    // A short jamb-reveal-style line pair on the wall layer (140mm apart,
    // matching the real-world case this filter targets) — should NOT
    // become a "wall", just unclassified.
    { type: "LINE", layer: "A-WALL", handle: 50, vertices: [{ x: 1000, y: -T }, { x: 1000, y: -T - 140 }] },
    { type: "LINE", layer: "A-WALL", handle: 51, vertices: [{ x: 1080, y: -T }, { x: 1080, y: -T - 140 }] },

    // An AutoCAD anonymous/system block (hatch associativity artifact) —
    // should never be rendered as furniture regardless of its bbox.
    { type: "INSERT", layer: "A-WALL", handle: 52, name: "A$C30F0512F", position: { x: 2000, y: 1800 }, rotation: 0, xScale: 1, yScale: 1 },

    // A furniture block positioned WAY outside the building's own walls —
    // simulating a schedule/legend/second-sheet block sharing the same
    // modelspace. Should be excluded from furniture, not scattered into
    // the 3D scene far from the building.
    { type: "INSERT", layer: "A-FURN", handle: 53, name: "DESK_1800", position: { x: 90000, y: 90000 }, rotation: 0, xScale: 1, yScale: 1 },
  ],
} as unknown as IDxf;

const result = classifyDxf(dxf, 1); // already in mm

console.log("entityCounts:", result.entityCounts);
console.log("unclassifiedCount:", result.unclassifiedCount);
console.log("ignoredAnnotationCount:", result.ignoredAnnotationCount);
console.log("hasUnpairedWalls:", result.hasUnpairedWalls);
console.log("hasDoors:", result.hasDoors, "hasWindows:", result.hasWindows);
console.log();

for (const e of result.entities) {
  if (e.type === "wall") {
    const len = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
    console.log(`WALL  len=${len.toFixed(0)}mm thickness=${e.thicknessMm ?? "UNPAIRED"}  (${e.start.x.toFixed(0)},${e.start.y.toFixed(0)}) -> (${e.end.x.toFixed(0)},${e.end.y.toFixed(0)})`);
  } else if (e.type === "door" || e.type === "window" || e.type === "column" || e.type === "furniture") {
    console.log(`${e.type.toUpperCase().padEnd(10)} label=${e.label} pos=(${e.position.x.toFixed(0)},${e.position.y.toFixed(0)}) w=${e.widthMm} d=${e.depthMm} rot=${e.rotationDeg}`);
  } else if (e.type === "room") {
    console.log(`ROOM  label=${e.label ?? "(unlabeled)"} points=${e.points.length}`);
  } else if (e.type === "unclassified") {
    console.log(`UNCLASSIFIED  layer=${e.layerName} label=${e.label}`);
  }
}

// --- Assertions ---
const walls = result.entities.filter((e) => e.type === "wall") as Extract<typeof result.entities[number], { type: "wall" }>[];
const paired = walls.filter((w) => w.thicknessMm != null);
const unpaired = walls.filter((w) => w.thicknessMm == null);
console.log("\n--- Checks ---");
check("3 walls paired (south/north/west)", paired.length === 3);
check("1 wall unpaired (east, single line)", unpaired.length === 1);
check("paired thickness ~230mm", paired.every((w) => Math.abs((w.thicknessMm ?? 0) - 230) < 2));
const door = result.entities.find((e) => e.type === "door") as ClassifiedOpening | undefined;
check("door found, width 900mm", !!door && door.widthMm === 900);
const win = result.entities.find((e) => e.type === "window") as ClassifiedOpening | undefined;
check("window found, width 1200mm", !!win && win.widthMm === 1200);
const desk = result.entities.find((e) => e.type === "furniture" && e.label === "DESK_1800") as ClassifiedFurniture | undefined;
check("desk found, 1800x750mm", !!desk && desk.widthMm === 1800 && desk.depthMm === 750);
const ghost = result.entities.find((e) => e.type === "unclassified" && e.label.includes("GHOST_BLOCK"));
check("missing block def -> unclassified, not invented", !!ghost);
const room = result.entities.find((e) => e.type === "room") as Extract<typeof result.entities[number], { type: "room" }> | undefined;
check("room found with label from nearby TEXT", !!room && room.label === "Living Room");
check("stray line -> unclassified count includes it", result.unclassifiedCount >= 2); // stray line + ghost block
check("DIMENSION + TEXT ignored as annotation clutter, not unclassified", result.ignoredAnnotationCount === 2);

// Short jamb-reveal-style wall pair (140mm apart) must not appear as a wall.
check("140mm jamb-reveal pair is NOT classified as a wall", !walls.some((w) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) < 250));
check("140mm jamb-reveal pair surfaces as unclassified instead", result.entities.some((e) => e.type === "unclassified" && e.label.includes("too short to be a real wall")));

// AutoCAD anonymous/system block must never become furniture/door/window/column.
check("A$C... anonymous block is never classified as furniture", !result.entities.some((e) => e.type === "furniture" && e.label === "A$C30F0512F"));
check("A$C... anonymous block surfaces as unclassified instead", result.entities.some((e) => e.type === "unclassified" && e.label.includes("Internal AutoCAD block")));

// Furniture block far outside the building's walls must not be placed as real furniture.
check("far-away DESK_1800 (90000,90000) excluded from furniture", !result.entities.some((e) => e.type === "furniture" && e.position.x > 50000));
check("far-away block surfaces as unclassified (footprint outlier)", result.entities.some((e) => e.type === "unclassified" && e.label.includes("far outside the building's walls")));
// The real, in-place desk (2000,500) must still come through untouched.
check("in-footprint desk still classified as furniture", !!desk);

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
}
