/**
 * Standalone sanity check for src/lib/dxf/classify.ts, run directly against
 * a hand-built IDxf-shaped object (skipping the raw-DXF-text parsing step,
 * which is dxf-parser's own well-tested job — the real risk here is our
 * classification/geometry logic). Run with: npx tsx scripts/test-cad-classify.ts
 */
import { classifyDxf, detectNonPlanDrawing, extractElevationViews, partitionByViewTitles, extractViews, type ClassifiedOpening, type ClassifiedFurniture } from "../src/lib/dxf/classify";
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

    // Regression case: a door drawn as raw LINE geometry (no BLOCK at all)
    // on a door-named layer, near the south wall around x=3300-4200 —
    // simulating the very common real-world case (this app's own reference
    // file among them) where a drafter draws the jamb tick + leaf directly
    // instead of inserting a block. No ARC here, so classification must
    // fall back to the (unambiguous) "A-DOOR" layer name.
    { type: "LINE", layer: "A-DOOR", handle: 60, vertices: [{ x: 3300, y: -T }, { x: 3300, y: T }] },
    { type: "LINE", layer: "A-DOOR", handle: 61, vertices: [{ x: 3300, y: 0 }, { x: 4200, y: 0 }] },

    // Regression case: a window drawn as two raw parallel LINEs (no arc,
    // no block) on a window-named layer, near the west wall between
    // y=1200 and y=2400.
    { type: "LINE", layer: "A-WINDOW", handle: 62, vertices: [{ x: 0, y: 1200 }, { x: 0, y: 2400 }] },
    { type: "LINE", layer: "A-WINDOW", handle: 63, vertices: [{ x: 34.5, y: 1200 }, { x: 34.5, y: 2400 }] },

    // Regression case: a door swing ARC on an AMBIGUOUS layer literally
    // named "door and window" (this app's own reference file has exactly
    // this layer name) — the arc's presence must win over the ambiguous
    // layer name and classify this as a door, not a window.
    // No startAngle/endAngle here (deliberately) — this exercises the
    // full-circle fallback in arcBoundingPoints (classify.ts), which is
    // what the neighboring jamb-tick LINE below is calibrated against.
    { type: "ARC", layer: "door and window", handle: 64, center: { x: 600, y: 0 }, radius: 450 },
    // Jamb tick touching the arc's own (approximated) bounding-box corner —
    // real touching strokes, not two unrelated marks — so this exercises
    // the actual clustering path rather than the arc alone.
    { type: "LINE", layer: "door and window", handle: 65, vertices: [{ x: 1050, y: 400 }, { x: 1050, y: 500 }] },
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

// Doors/windows drawn as raw line/arc geometry (no BLOCK) on a
// door/window-named layer — see extractOpeningSymbols in classify.ts.
const openings = result.entities.filter((e) => e.type === "door" || e.type === "window") as ClassifiedOpening[];
const geometryDoor = openings.find((o) => o.type === "door" && Math.abs(o.widthMm - 900) < 5 && o.label.includes("A-DOOR"));
check("raw-geometry door (no block) found on A-DOOR layer, ~900mm wide", !!geometryDoor);
const geometryWindow = openings.find((o) => o.type === "window" && Math.abs(o.widthMm - 1200) < 5 && o.label.includes("A-WINDOW"));
check("raw-geometry window (no block, no arc) found on A-WINDOW layer, ~1200mm wide", !!geometryWindow);
const ambiguousLayerDoor = openings.find((o) => o.type === "door" && o.label.includes("door and window"));
check('ARC on ambiguous "door and window" layer classified as door (arc wins over layer-name ambiguity)', !!ambiguousLayerDoor);
check('nothing on the ambiguous "door and window" layer misclassified as a window', !openings.some((o) => o.type === "window" && o.label.includes("door and window")));

/*
  Regression case for "it should be able to recognize the type of drawing
  and work accordingly" — see detectNonPlanDrawing's doc in classify.ts.
  An elevation/section sheet (a titled TEXT/MTEXT, essentially no wall
  structure) should be flagged instead of silently producing an empty
  model; a sheet that has BOTH real plan-view walls and an elevation-titled
  inset must NOT be flagged, since it has usable floor-plan geometry.
*/
const elevationOnlyDxf = {
  header: {},
  blocks: {},
  entities: [
    { type: "LINE", layer: "A-ELEV", handle: 200, vertices: [{ x: 0, y: 0 }, { x: 8000, y: 0 }] },
    { type: "LINE", layer: "A-ELEV", handle: 201, vertices: [{ x: 0, y: 3000 }, { x: 8000, y: 3000 }] },
    { type: "MTEXT", layer: "A-TEXT", handle: 202, text: "FRONT ELEVATION", position: { x: 4000, y: -500 } },
  ],
} as unknown as IDxf;
const elevationOnlyResult = classifyDxf(elevationOnlyDxf, 1);
check("wall-less sheet titled FRONT ELEVATION -> flagged as not a floor plan", !!detectNonPlanDrawing(elevationOnlyDxf, elevationOnlyResult) && detectNonPlanDrawing(elevationOnlyDxf, elevationOnlyResult)!.includes("elevation"));

const sectionOnlyDxf = {
  header: {},
  blocks: {},
  entities: [
    { type: "LINE", layer: "0", handle: 210, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }] },
    { type: "TEXT", layer: "A-TEXT", handle: 211, text: "SECTION A-A", startPoint: { x: 2000, y: -300 } },
  ],
} as unknown as IDxf;
const sectionOnlyResult = classifyDxf(sectionOnlyDxf, 1);
check("wall-less sheet titled SECTION A-A -> flagged as not a floor plan", !!detectNonPlanDrawing(sectionOnlyDxf, sectionOnlyResult));

// This test file's own main `dxf` fixture above IS a real floor plan (has
// walls, a door, a window, ...) — detectNonPlanDrawing must never flag it,
// with or without an elevation-titled inset added alongside the real plan.
check("a real floor plan (this file's main fixture) is never flagged as non-plan", detectNonPlanDrawing(dxf, result) === null);
const planWithElevationInsetDxf = {
  ...dxf,
  entities: [...(dxf.entities ?? []), { type: "MTEXT", layer: "A-TEXT", handle: 220, text: "KITCHEN ELEVATION", position: { x: 100000, y: 100000 } }],
} as unknown as IDxf;
const planWithInsetResult = classifyDxf(planWithElevationInsetDxf, 1);
check(
  "a real floor plan with an elevation-titled inset elsewhere on the sheet is still NOT flagged (it has usable wall geometry)",
  detectNonPlanDrawing(planWithElevationInsetDxf, planWithInsetResult) === null
);

/*
  Regression case for the real "WC" furniture block found in the K.K.
  Sharma reference DWG: a small, realistic fixture footprint (a
  400x600mm rectangle) paired with an oversized decorative/clearance ARC
  (radius 1000mm) whose actual angular sweep only grazes a corner of that
  footprint. Before arcBoundingPoints (classify.ts) existed, ANY arc was
  treated as a full circle for bbox purposes, so this same arc would have
  inflated the block's measured size to ~2000x2000mm — this asserts the
  fix keeps the measured size close to the real footprint instead.
*/
const oversizedArcBlockEntities = [
  { type: "LWPOLYLINE", layer: "0", handle: 300, shape: true, vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 600 }, { x: 0, y: 600 }] },
  // Center far below the footprint, radius large enough that a full-circle
  // approximation would span y from -1800 to 200 and x from -800 to 1200 —
  // but the real sweep (~84°-96°, i.e. nearly straight up) only reaches
  // into the footprint's own y=0..600 range.
  { type: "ARC", layer: "0", handle: 301, center: { x: 200, y: -800 }, radius: 1000, startAngle: 1.47, endAngle: 1.67 },
];
const oversizedArcDxf = {
  header: {},
  blocks: { WC_TEST: { name: "WC_TEST", entities: oversizedArcBlockEntities } },
  entities: [{ type: "INSERT", layer: "A-FURN", handle: 302, name: "WC_TEST", position: { x: 5000, y: 5000 }, rotation: 0, xScale: 1, yScale: 1 }],
} as unknown as IDxf;
const oversizedArcResult = classifyDxf(oversizedArcDxf, 1);
const wcFixture = oversizedArcResult.entities.find((e) => e.type === "furniture") as ClassifiedFurniture | undefined;
check("oversized-arc fixture found and classified as furniture", !!wcFixture);
check(
  `oversized-arc fixture measured close to its real 400x600mm footprint, not inflated by the arc's full-circle bbox (got ${wcFixture?.widthMm}x${wcFixture?.depthMm})`,
  !!wcFixture && wcFixture.widthMm <= 410 && wcFixture.depthMm <= 610
);

/*
  Regression case: a genuinely elevation-only sheet (no real floor plan at
  all) now succeeds via extractElevationViews instead of being rejected
  outright — see the module doc in classify.ts. The geometry here is a
  simple connected rectangle outline (each LINE's endpoint touches the
  next) with a title positioned near one of its own corners — real
  drawings have far denser, naturally-connected point clouds (see
  clusterEntitiesByProximity's doc), so this synthetic fixture just needs
  to be connected the same deliberate way for the proximity clustering to
  actually group it as one view.
*/
const pureElevationDxf = {
  header: {},
  blocks: {},
  entities: [
    { type: "LINE", layer: "A-ELEV", handle: 500, vertices: [{ x: 0, y: 0 }, { x: 8000, y: 0 }] },
    { type: "LINE", layer: "A-ELEV", handle: 501, vertices: [{ x: 8000, y: 0 }, { x: 8000, y: 3000 }] },
    { type: "LINE", layer: "A-ELEV", handle: 502, vertices: [{ x: 8000, y: 3000 }, { x: 0, y: 3000 }] },
    { type: "LINE", layer: "A-ELEV", handle: 503, vertices: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
    { type: "MTEXT", layer: "A-TEXT", handle: 504, text: "FRONT ELEVATION", position: { x: 200, y: 200 } },
  ],
} as unknown as IDxf;
const pureElevationViews = extractElevationViews(pureElevationDxf, 1);
check("elevation-only sheet: extractElevationViews finds exactly one view", pureElevationViews.length === 1);
check("elevation-only sheet: view size matches the drawn rectangle (8000x3000mm)", pureElevationViews[0]?.widthMm === 8000 && pureElevationViews[0]?.heightMm === 3000);
check(
  "elevation-only sheet: all 4 rectangle edges came through as strokes (traced verbatim, not discarded once the bbox was measured)",
  pureElevationViews[0]?.strokes.length === 4
);
check(
  "elevation-only sheet: a traced stroke's coordinates are local to the panel's own bottom-left corner (e.g. the x=[0,8000] bottom edge reads as (0,0)-(8000,0))",
  !!pureElevationViews[0]?.strokes.some((s) => s.x1 === 0 && s.y1 === 0 && s.x2 === 8000 && s.y2 === 0)
);

const pureElevationExclude = pureElevationViews.length > 0 ? new Set(pureElevationViews.flatMap((v) => [...v.memberHandles])) : undefined;
const pureElevationResult = classifyDxf(pureElevationDxf, 1, { excludeHandles: pureElevationExclude });
const pureElevationNonPlanReason = detectNonPlanDrawing(pureElevationDxf, pureElevationResult);
check(
  "elevation-only sheet: still no usable plan-view walls (as expected) but a real elevation view WAS extracted — this is the condition callers (dwg.ts/index.ts) use to build the facade panel instead of rejecting the upload",
  !!pureElevationNonPlanReason && pureElevationViews.length === 1
);

/*
  Regression case: a sheet with a real (if minimal) floor plan AND a
  separate elevation view sharing the same "wall"-named layer — the
  elevation's own line work must NOT get pulled into the floor plan's wall
  count. A real reference DWG did exactly this: an elevation's dense
  line/arc texture, drawn on the "wall" layer, was mis-paired by the same
  line-pairing heuristic that finds real walls, producing a bogus "floor
  plan" that was actually just the elevation's own artwork misread as
  rooms. extractElevationViews isolates the elevation cluster by REAL-
  WORLD PROXIMITY (not layer name), so classifyDxf, called with that
  cluster's handles excluded, only pairs the real plan's own wall lines.
*/
const combinedPlanElevationDxf = {
  header: {},
  blocks: { DOOR_900: { name: "DOOR_900", entities: rectBlockEntities(900, 50) } },
  entities: [
    // A minimal real 2-wall plan corner near the origin.
    { type: "LINE", layer: "A-WALL", handle: 400, vertices: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] },
    { type: "LINE", layer: "A-WALL", handle: 401, vertices: [{ x: 0, y: 200 }, { x: 3000, y: 200 }] },
    { type: "LINE", layer: "A-WALL", handle: 402, vertices: [{ x: 0, y: 0 }, { x: 0, y: 3000 }] },
    { type: "LINE", layer: "A-WALL", handle: 403, vertices: [{ x: 200, y: 0 }, { x: 200, y: 3000 }] },

    // A separate elevation view, 50m away in X. Its own close line pair
    // sits on the SAME "wall"-named layer as the real plan (mirroring the
    // real reference file) and, left un-excluded, gets mis-paired into a
    // bogus extra "wall" that isn't part of any real building.
    { type: "LINE", layer: "wall", handle: 410, vertices: [{ x: 50000, y: 0 }, { x: 58000, y: 0 }] },
    { type: "LINE", layer: "wall", handle: 411, vertices: [{ x: 50000, y: 150 }, { x: 58000, y: 150 }] },
    // Non-"wall"-layer geometry (a roofline) extending the elevation's real
    // height — clustered into the SAME view by proximity regardless of its
    // own layer name, same as the real reference file's dense texture work.
    { type: "LINE", layer: "roof", handle: 414, vertices: [{ x: 50000, y: 150 }, { x: 50000, y: 3000 }] },
    { type: "LINE", layer: "roof", handle: 415, vertices: [{ x: 50000, y: 3000 }, { x: 58000, y: 3000 }] },
    { type: "MTEXT", layer: "TEXT", handle: 412, text: "FRONT ELEVATION", position: { x: 50050, y: 200 } },
    // A door drawn within the elevation, for opening extraction.
    { type: "INSERT", layer: "door and window", handle: 413, name: "DOOR_900", position: { x: 50000, y: 0 }, rotation: 0, xScale: 1, yScale: 1 },
  ],
} as unknown as IDxf;

const combinedElevationViews = extractElevationViews(combinedPlanElevationDxf, 1);
check("combined sheet: exactly one elevation view extracted", combinedElevationViews.length === 1);
check(
  "combined sheet: view bbox matches the elevation's real extent (8000x3000mm), not the whole 58000-wide sheet",
  combinedElevationViews[0]?.widthMm === 8000 && combinedElevationViews[0]?.heightMm === 3000
);
check(
  "combined sheet: elevation view captured 1 door opening from its own DOOR_900 insert",
  combinedElevationViews[0]?.openings.length === 1 && combinedElevationViews[0]?.openings[0]?.kind === "door"
);
check(
  "combined sheet: the elevation's 4 real line strokes (2 wall-layer + 2 roof-layer) all came through — the same real linework that used to be thrown away once the bbox was measured",
  combinedElevationViews[0]?.strokes.length === 4
);

const combinedResultWithoutExclusion = classifyDxf(combinedPlanElevationDxf, 1);
const wallsWithoutExclusion = combinedResultWithoutExclusion.entities.filter((e) => e.type === "wall");
check(
  "combined sheet WITHOUT exclusion: the elevation's own close line pair DOES get mis-paired as a bogus extra wall (demonstrates why exclusion matters)",
  wallsWithoutExclusion.length === 3
);

const combinedExclude = new Set(combinedElevationViews.flatMap((v) => [...v.memberHandles]));
const combinedResultWithExclusion = classifyDxf(combinedPlanElevationDxf, 1, { excludeHandles: combinedExclude });
const wallsWithExclusion = combinedResultWithExclusion.entities.filter((e) => e.type === "wall");
check("combined sheet WITH elevation excluded: only the real plan's 2 walls remain", wallsWithExclusion.length === 2);

/*
  Regression case for a real reported file: a sheet can carry MORE than one
  plan (a real reference DWG had "GROUND FLOOR PLAN", "FIRST FLOOR PLAN",
  and "TERRACEFLOOR PLAN" — no space — plus a "FRONT ELEVATION", stacked
  close enough that proximity-connectivity fuses them into one blob). Three
  storeys + an elevation, stacked directly on top of each other with only a
  300mm gap (deliberately tighter than ELEVATION_CLUSTER_GAP_MM=1500, so a
  naive connectivity-only approach — extractElevationViews' own strategy —
  would treat this whole stack as one blob), each with its own real MTEXT
  title. Titles here also reuse the real file's own formatting-code shape
  (`\L` immediately touching the keyword, no space) to cover the
  cleanMTextLabel fix: `\bground\b` etc. would silently fail to match
  "\LGROUND..." without it, because \L's own "L" is a word character
  sitting directly against "G" with no \b transition between them.
*/
function mtextTitle(word: string) {
  return `\\A1;{\\fArial|b0|i0|c0|p0;\\L${word}}`;
}
// Two short (2000mm) parallel wall-pairs, both tucked close to (cy±800) —
// short enough to stay well clear of a neighboring level's own title, the
// same way real wall segments (a real reference file's own segments ran
// 600-3000mm) stay far shorter than the gap between two stacked views'
// titles. An earlier version of this fixture used one LINE spanning an
// entire level's full height, which put that line's own centroid roughly
// equidistant between two titles — a real, if narrow, edge case for very
// long entities in a tightly-stacked sheet, but not representative of how
// real plan geometry (many short segments) actually looks.
function levelWalls(handleBase: number, cy: number, layer = "A-WALL") {
  return [
    { type: "LINE", layer, handle: handleBase, vertices: [{ x: -1000, y: cy - 800 }, { x: 1000, y: cy - 800 }] },
    { type: "LINE", layer, handle: handleBase + 1, vertices: [{ x: -1000, y: cy - 600 }, { x: 1000, y: cy - 600 }] },
    { type: "LINE", layer, handle: handleBase + 2, vertices: [{ x: -1000, y: cy + 600 }, { x: 1000, y: cy + 600 }] },
    { type: "LINE", layer, handle: handleBase + 3, vertices: [{ x: -1000, y: cy + 800 }, { x: 1000, y: cy + 800 }] },
  ];
}
const multiStoreyDxf = {
  header: {},
  blocks: {},
  entities: [
    // GROUND FLOOR PLAN — centered y=0, the entry level, should be picked as primary.
    ...levelWalls(600, 0),
    { type: "MTEXT", layer: "TEXT", handle: 610, text: mtextTitle("GROUND FLOOR PLAN"), position: { x: 0, y: 0 } },
    // FIRST FLOOR PLAN — centered y=3000; its own nearest wall point (y=2200)
    // sits only 1400mm from ground's farthest wall point (y=800) — tighter
    // than ELEVATION_CLUSTER_GAP_MM=1500, so a naive connectivity-only
    // approach (extractElevationViews' own strategy) would fuse the two
    // levels into one blob. Nearest-title assignment still separates them
    // cleanly because each level's OWN points stay closer to its own title
    // than to the neighboring one.
    ...levelWalls(620, 3000),
    { type: "MTEXT", layer: "TEXT", handle: 630, text: mtextTitle("FIRST FLOOR PLAN"), position: { x: 0, y: 3000 } },
    // FRONT ELEVATION — a real drawn rectangle (not just short wall stubs),
    // y 5200..8200, again only 1400mm above first floor's own highest point
    // (3800). Its own title sits at the rectangle's vertical center.
    { type: "LINE", layer: "wall", handle: 640, vertices: [{ x: -2000, y: 5200 }, { x: 2000, y: 5200 }] },
    { type: "LINE", layer: "wall", handle: 641, vertices: [{ x: 2000, y: 5200 }, { x: 2000, y: 8200 }] },
    { type: "LINE", layer: "wall", handle: 642, vertices: [{ x: 2000, y: 8200 }, { x: -2000, y: 8200 }] },
    { type: "LINE", layer: "wall", handle: 643, vertices: [{ x: -2000, y: 8200 }, { x: -2000, y: 5200 }] },
    { type: "MTEXT", layer: "TEXT", handle: 650, text: mtextTitle("ELEVATION"), position: { x: 0, y: 6700 } },
    // A stray block pasted FAR away on the same sheet (a title block/logo,
    // common on real sheets) — must NOT get force-assigned to whichever
    // title happens to be nearest despite being absurdly far away (the
    // exact bug that inflated a real elevation's measured height past 10x
    // its real size before the assignment cap was added).
    { type: "LINE", layer: "0", handle: 660, vertices: [{ x: 0, y: 500000 }, { x: 100, y: 500100 }] },
  ],
} as unknown as IDxf;

const multiStoreyPartition = partitionByViewTitles(multiStoreyDxf, 1);
check("multi-storey sheet: partitionByViewTitles engages (>= 2 titles found)", !!multiStoreyPartition);
check(
  'multi-storey sheet: "GROUND FLOOR PLAN" (formatted as "\\LGROUND FLOOR PLAN", no space) is correctly read as the primary/ground level despite the MTEXT formatting code touching the keyword',
  multiStoreyPartition?.primaryPlanTitle === "GROUND FLOOR PLAN"
);
check(
  "multi-storey sheet: FIRST FLOOR PLAN is recognized as another level, not modeled",
  !!multiStoreyPartition?.otherLevelTitles.includes("FIRST FLOOR PLAN")
);
check("multi-storey sheet: exactly one elevation view extracted (the far stray block excluded)", multiStoreyPartition?.elevationViews.length === 1);
check(
  "multi-storey sheet: elevation view sized from its own 4000x3000 rectangle only — NOT inflated by the far-away stray block (which would balloon height past 490000mm)",
  multiStoreyPartition?.elevationViews[0]?.widthMm === 4000 && multiStoreyPartition?.elevationViews[0]?.heightMm === 3000
);

const multiStoreyViews = extractViews(multiStoreyDxf, 1);
check(
  '"if some drawing has two or three drawings, it should ask me which drawing" — extractViews surfaces WHICH title was picked (primaryPlanTitle), not just which others got excluded, so a caller (uploadCadModel/the model page\'s level picker) can offer the alternatives as an explicit switchable choice',
  multiStoreyViews.primaryPlanTitle === "GROUND FLOOR PLAN"
);
const multiStoreyResult = classifyDxf(multiStoreyDxf, 1, { excludeHandles: multiStoreyViews.excludeHandles });
check("multi-storey sheet: only the GROUND floor's own 2 walls are modeled (first floor + elevation excluded)", multiStoreyResult.entityCounts.wall === 2);
const multiStoreyGroundWalls = multiStoreyResult.entities.filter((e) => e.type === "wall");
check(
  "multi-storey sheet: the modeled walls are actually the ground-level ones (centered y=0), not the first floor's (centered y=3000)",
  multiStoreyGroundWalls.every((w) => w.type === "wall" && Math.abs(w.start.y) < 1000 && Math.abs(w.end.y) < 1000)
);

/*
  Regression case for "user has to mention what type of drawing it is,
  then the tool must work and generate properly" — a person can name which
  level they actually want (see uploadCadModel's "Floor level" field),
  overriding the automatic ground-preferred default. Reusing the same
  multi-storey fixture: without a preference, GROUND wins (already checked
  above); with "first" as the preference, FIRST FLOOR PLAN must win instead.
*/
const firstPreferredPartition = partitionByViewTitles(multiStoreyDxf, 1, { preferredLevelKeyword: "first" });
check("preferred level override: asking for \"first\" picks FIRST FLOOR PLAN instead of the default GROUND", firstPreferredPartition?.primaryPlanTitle === "FIRST FLOOR PLAN");
check(
  "preferred level override: GROUND FLOOR PLAN is now the one excluded as an \"other level\" instead",
  !!firstPreferredPartition?.otherLevelTitles.includes("GROUND FLOOR PLAN") && !firstPreferredPartition?.otherLevelTitles.includes("FIRST FLOOR PLAN")
);
// An unmatched preference (no plan title contains it) falls back to the
// ordinary rank-based default rather than leaving nothing modeled.
const unmatchedPreferredPartition = partitionByViewTitles(multiStoreyDxf, 1, { preferredLevelKeyword: "second" });
check("preferred level override: an unmatched preference (no \"second\" floor exists) falls back to the default GROUND", unmatchedPreferredPartition?.primaryPlanTitle === "GROUND FLOOR PLAN");

/*
  A real reference file has a "TERRACEFLOOR PLAN" — a genuinely inhabited
  level (it has its own BEDROOM/TOILET room labels), not just a roof deck —
  ranked high (100) specifically so the AUTOMATIC default never guesses it
  over a proper ground/first floor. That guard must not also block a
  person who explicitly asks for the terrace: preferredLevelKeyword
  searches every plan-kind candidate, eligible or not.
*/
const groundPlusTerraceDxf = {
  header: {},
  blocks: {},
  entities: [
    ...levelWalls(700, 0),
    { type: "MTEXT", layer: "TEXT", handle: 710, text: mtextTitle("GROUND FLOOR PLAN"), position: { x: 0, y: 0 } },
    ...levelWalls(720, 3000),
    { type: "MTEXT", layer: "TEXT", handle: 730, text: mtextTitle("TERRACE FLOOR PLAN"), position: { x: 0, y: 3000 } },
  ],
} as unknown as IDxf;
check("no preference: GROUND (rank 0) beats TERRACE (rank 100) as the automatic default", partitionByViewTitles(groundPlusTerraceDxf, 1)?.primaryPlanTitle === "GROUND FLOOR PLAN");
const terracePreferredPartition = partitionByViewTitles(groundPlusTerraceDxf, 1, { preferredLevelKeyword: "terrace" });
check(
  "explicit preference reaches a high-ranked (rank>5) level too: asking for \"terrace\" picks it despite GROUND being the automatic default",
  terracePreferredPartition?.primaryPlanTitle === "TERRACE FLOOR PLAN"
);

/*
  Regression case for a real bug caught while verifying the above against
  the actual reference file: when NO plan-kind title is eligible to be an
  automatic primary (e.g. a sheet with only a "ROOF PLAN" and a "SITE
  PLAN" — both rank>5 — and no explicit preference), primaryIdx is
  correctly null... but the exclusion loop's "if (i === primaryIdx)
  continue" only skips index === primaryIdx: since no real array index
  ever equals `null`, EVERY plan-kind group was being excluded instead of
  NONE, the opposite of "leave every plan-kind group unexcluded" this
  section's own doc comment promises. Fixed to gate exclusion on
  `primaryIdx == null` explicitly rather than relying on that comparison.
*/
const noEligiblePlanDxf = {
  header: {},
  blocks: {},
  entities: [
    ...levelWalls(800, 0),
    { type: "MTEXT", layer: "TEXT", handle: 810, text: mtextTitle("ROOF PLAN"), position: { x: 0, y: 0 } },
    ...levelWalls(820, 3000),
    { type: "MTEXT", layer: "TEXT", handle: 830, text: mtextTitle("SITE PLAN"), position: { x: 0, y: 3000 } },
  ],
} as unknown as IDxf;
const noEligiblePartition = partitionByViewTitles(noEligiblePlanDxf, 1);
check("no eligible plan title (only ROOF PLAN + SITE PLAN) and no preference: no primary chosen", noEligiblePartition?.primaryPlanTitle === null);
check("no eligible plan title: neither plan group gets excluded (both keep feeding the ordinary classifier)", noEligiblePartition?.excludeHandles.size === 0);
const noEligibleResult = classifyDxf(noEligiblePlanDxf, 1, { excludeHandles: noEligiblePartition?.excludeHandles });
check("no eligible plan title: both levels' walls (2+2=4) are still modeled, none silently dropped", noEligibleResult.entityCounts.wall === 4);

/*
  Regression case for the other half of the same request: a person can say
  "this whole file IS an elevation" even when it carries no title text at
  all (so extractElevationViews' own title-anchored search finds nothing)
  — extractViews' declaredType: "elevation" then measures every entity on
  the sheet as one whole-sheet elevation instead of the upload just being
  rejected outright.
*/
const untitledElevationDxf = {
  header: {},
  blocks: {},
  entities: [
    { type: "LINE", layer: "0", handle: 700, vertices: [{ x: 0, y: 0 }, { x: 6000, y: 0 }] },
    { type: "LINE", layer: "0", handle: 701, vertices: [{ x: 6000, y: 0 }, { x: 6000, y: 3500 }] },
    { type: "LINE", layer: "0", handle: 702, vertices: [{ x: 6000, y: 3500 }, { x: 0, y: 3500 }] },
    { type: "LINE", layer: "0", handle: 703, vertices: [{ x: 0, y: 3500 }, { x: 0, y: 0 }] },
  ],
} as unknown as IDxf;
check("untitled elevation sheet, declaredType auto: extractViews finds nothing (no title to anchor on)", extractViews(untitledElevationDxf, 1).elevationViews.length === 0);
const declaredElevationViews = extractViews(untitledElevationDxf, 1, { declaredType: "elevation" });
check("untitled elevation sheet, declaredType \"elevation\": builds one whole-sheet view instead of finding nothing", declaredElevationViews.elevationViews.length === 1);
check(
  "untitled elevation sheet, declaredType \"elevation\": sized from the sheet's own real extent (6000x3500mm)",
  declaredElevationViews.elevationViews[0]?.widthMm === 6000 && declaredElevationViews.elevationViews[0]?.heightMm === 3500
);

/*
  A single-plan (or plan+one-elevation) sheet — the overwhelming common
  case — has 0 or 1 view titles, not >= 2, so partitionByViewTitles must
  stay OUT of the way entirely and let extractElevationViews' proximity
  approach handle it exactly as before this multi-view partitioning was
  added (checked here directly against the file's own main fixture, which
  has no view titles at all).
*/
check("ordinary single-plan sheet (no view titles): partitionByViewTitles returns null, doesn't engage", partitionByViewTitles(dxf, 1) === null);
check("ordinary single-plan sheet: extractViews reports primaryPlanTitle null (nothing to pick among, so no picker should show)", extractViews(dxf, 1).primaryPlanTitle === null);

/*
  Regression case for "it should learn about the moldings, the gates, the
  balcony, the designs, the carvings" — a real reference file's elevation
  draws ALL of its facade detail (arches, rails, ornament) as bare ARC/LINE
  geometry on one generic "wall" layer, never as a named door/window block
  — so `openings` stays empty no matter what. `strokes` is what actually
  recovers that detail: every real ARC/LINE in the cluster, traced as its
  own exact coordinates, minus dimension-annotation entities (tick marks,
  extension lines) which are measurement notation, not drawn facade art.
*/
const decoratedElevationDxf = {
  header: {},
  blocks: {},
  entities: [
    // A gate-like arched opening, drawn as a bare arc + two jamb lines —
    // exactly the "untagged line/arc" pattern the real reference file uses,
    // with nothing that would let openings-extraction recognize it as a door.
    { type: "ARC", layer: "wall", handle: 900, center: { x: 4000, y: 1000 }, radius: 1000, startAngle: 0, endAngle: Math.PI },
    { type: "LINE", layer: "wall", handle: 901, vertices: [{ x: 3000, y: 0 }, { x: 3000, y: 1000 }] },
    { type: "LINE", layer: "wall", handle: 902, vertices: [{ x: 5000, y: 0 }, { x: 5000, y: 1000 }] },
    // A dimension line's tick-mark arcs on a "dim1" layer, right next to the
    // gate — real annotation, not drawn building detail, must be excluded.
    { type: "ARC", layer: "dim1", handle: 903, center: { x: 3000, y: 2500 }, radius: 15, startAngle: 0, endAngle: Math.PI / 2 },
    { type: "LINE", layer: "dim1", handle: 904, vertices: [{ x: 2000, y: 2500 }, { x: 6000, y: 2500 }] },
    // The rest of the rectangle (its bottom edge split around the gate, so
    // each half's own endpoint physically touches a jamb line's foot —
    // same "real geometry actually connects" requirement documented on
    // levelWalls above, not just sitting in the same rough neighborhood),
    // so this reads as one real elevation-sized cluster.
    { type: "LINE", layer: "wall", handle: 905, vertices: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] },
    { type: "LINE", layer: "wall", handle: 9051, vertices: [{ x: 5000, y: 0 }, { x: 9000, y: 0 }] },
    { type: "LINE", layer: "wall", handle: 906, vertices: [{ x: 9000, y: 0 }, { x: 9000, y: 4000 }] },
    { type: "LINE", layer: "wall", handle: 907, vertices: [{ x: 9000, y: 4000 }, { x: 0, y: 4000 }] },
    { type: "LINE", layer: "wall", handle: 908, vertices: [{ x: 0, y: 4000 }, { x: 0, y: 0 }] },
    { type: "MTEXT", layer: "TEXT", handle: 909, text: "FRONT ELEVATION", position: { x: 200, y: 200 } },
  ],
} as unknown as IDxf;
const decoratedElevationViews = extractElevationViews(decoratedElevationDxf, 1);
check("decorated elevation: exactly one view extracted", decoratedElevationViews.length === 1);
check(
  "decorated elevation: an untagged arch/gate drawn as bare ARC+LINE geometry still comes through as real strokes (multiple tessellated segments from the arc, plus the 2 jamb lines)",
  (decoratedElevationViews[0]?.strokes.length ?? 0) >= 6
);
check(
  "decorated elevation: the dimension tick-mark arc and its extension line (\"dim1\" layer, at local y=2500) are excluded from the trace — they're measurement notation, not drawn facade detail",
  !!decoratedElevationViews[0] && decoratedElevationViews[0].strokes.every((s) => s.y1 !== 2500 && s.y2 !== 2500)
);

/*
  Regression case for "see in this drawing only elevation is properly and
  detailed explained" — MANPREET_SINGH_ELEVATION.dwg's real window/door
  openings turned out to be drawn as plain closed rectangles directly on a
  "door and window" layer, no INSERT block at all, which the INSERT-only
  loop above never looks at. This exercises that same layer-based rectangle
  path, including the ambiguous-layer-name ("door and window" matches both
  DOOR_RE and WINDOW_RE) floor-touch disambiguation: a door reaches the
  floor, a window doesn't.
*/
const layerRectElevationDxf = {
  header: {},
  blocks: {},
  entities: [
    { type: "LINE", layer: "wall", handle: 700, vertices: [{ x: 0, y: 0 }, { x: 6000, y: 0 }] },
    { type: "LINE", layer: "wall", handle: 701, vertices: [{ x: 6000, y: 0 }, { x: 6000, y: 4000 }] },
    { type: "LINE", layer: "wall", handle: 702, vertices: [{ x: 6000, y: 4000 }, { x: 0, y: 4000 }] },
    { type: "LINE", layer: "wall", handle: 703, vertices: [{ x: 0, y: 4000 }, { x: 0, y: 0 }] },
    { type: "MTEXT", layer: "TEXT", handle: 704, text: "FRONT ELEVATION", position: { x: 200, y: 200 } },
    // A door: closed rectangle on the ambiguous "door and window" layer,
    // reaching all the way down to the elevation's own floor line (y=0) —
    // the floor-touch heuristic must call this a door despite the layer
    // name matching WINDOW_RE too.
    { type: "LWPOLYLINE", layer: "door and window", handle: 705, shape: true, vertices: [{ x: 1000, y: 0 }, { x: 1900, y: 0 }, { x: 1900, y: 2100 }, { x: 1000, y: 2100 }] },
    // A window: same ambiguous layer, but sitting well above the floor —
    // must be called a window by the same heuristic.
    { type: "LWPOLYLINE", layer: "door and window", handle: 706, shape: true, vertices: [{ x: 3000, y: 1200 }, { x: 4200, y: 1200 }, { x: 4200, y: 2400 }, { x: 3000, y: 2400 }] },
    // Too small to be a real opening (a sill/mullion detail on the same
    // layer, not the opening's own outer frame) — must be excluded.
    { type: "LWPOLYLINE", layer: "door and window", handle: 707, shape: true, vertices: [{ x: 5000, y: 3900 }, { x: 5050, y: 3900 }, { x: 5050, y: 3950 }, { x: 5000, y: 3950 }] },
    // Genuinely open (not closed) — must NOT be read as an opening even
    // though it's a large, floor-touching, door/window-layer rectangle
    // shape (matches the real file's un-closed partial outlines).
    { type: "LWPOLYLINE", layer: "door and window", handle: 708, shape: false, vertices: [{ x: 2000, y: 0 }, { x: 2900, y: 0 }, { x: 2900, y: 2000 }] },
    // Unambiguous "window"-only layer name, but positioned at floor level —
    // the layer name alone must win, not the floor-touch fallback (which
    // only applies when the name itself is ambiguous).
    { type: "LWPOLYLINE", layer: "WINDOW", handle: 709, shape: true, vertices: [{ x: 100, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 1200 }, { x: 100, y: 1200 }] },
  ],
} as unknown as IDxf;
const layerRectViews = extractElevationViews(layerRectElevationDxf, 1);
const layerRectOpenings = layerRectViews[0]?.openings ?? [];
check(
  "layer-only rectangle openings: exactly 3 real openings recognized (2 on the ambiguous layer + 1 on an unambiguous layer), the too-small and open-shape rectangles excluded",
  layerRectOpenings.length === 3
);
const layerRectDoor = layerRectOpenings.find((o) => o.xMm === 1000);
const layerRectWindow = layerRectOpenings.find((o) => o.xMm === 3000);
const layerRectNamedWindow = layerRectOpenings.find((o) => o.xMm === 100);
check("layer-only rectangle: the floor-touching one on the ambiguous 'door and window' layer is classified as a door", layerRectDoor?.kind === "door");
check("layer-only rectangle: its measured size matches the drawn rectangle (900x2100mm), not fabricated", layerRectDoor?.widthMm === 900 && layerRectDoor?.heightMm === 2100);
check("layer-only rectangle: the one sitting above the floor on the same ambiguous layer is classified as a window", layerRectWindow?.kind === "window");
check("layer-only rectangle: its measured size matches the drawn rectangle (1200x1200mm)", layerRectWindow?.widthMm === 1200 && layerRectWindow?.heightMm === 1200);
check(
  "layer-only rectangle: an unambiguous 'WINDOW'-only layer name wins even when the rectangle itself touches the floor — the floor-touch heuristic only applies when the name is genuinely ambiguous",
  layerRectNamedWindow?.kind === "window"
);
check(
  "layer-only rectangle: a too-small rectangle on the same layer (50x50mm) is excluded as a sill/mullion detail, not a real opening",
  !layerRectOpenings.some((o) => o.widthMm === 50)
);
check("layer-only rectangle: a genuinely open (not closed) rectangle-shaped outline on the same layer is not read as an opening", !layerRectOpenings.some((o) => o.xMm === 2000));

/*
  Regression case for "still wrong see that it made" (the fan/star-shaped
  broken wall render) — nearest-title assignment compares each entity's
  centroid to a title's own TEXT position, which breaks when a title is
  stamped at the far EDGE of its own view rather than near its middle. A
  real file titles "FRONT ELEVATION" right at the very bottom of that
  facade; real elevation content near the roofline (drawn on the plain
  "wall" layer, not a door/window-named one) ends up geometrically nearer
  to a completely different title ("GROUND FLOOR PLAN", sitting between
  the two views) than to its own — and gets wall-paired into nonsense
  triangular geometry alongside genuine ground-floor walls as a result.
*/
const edgeTitleDxf = {
  header: {},
  blocks: {},
  entities: [
    // GROUND FLOOR PLAN: title near the origin, with a small real room.
    { type: "MTEXT", layer: "TEXT", handle: 800, text: "GROUND FLOOR PLAN", position: { x: 0, y: 0 } },
    { type: "LINE", layer: "wall", handle: 801, vertices: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
    { type: "LINE", layer: "wall", handle: 802, vertices: [{ x: 4000, y: 0 }, { x: 4000, y: -2500 }] },
    { type: "LINE", layer: "wall", handle: 803, vertices: [{ x: 4000, y: -2500 }, { x: 0, y: -2500 }] },
    { type: "LINE", layer: "wall", handle: 804, vertices: [{ x: 0, y: -2500 }, { x: 0, y: 0 }] },
    // FRONT ELEVATION: a tall facade outline, but its OWN title is
    // stamped near the BOTTOM edge (y=-9800), far from the roofline.
    { type: "MTEXT", layer: "TEXT", handle: 810, text: "FRONT ELEVATION", position: { x: 200, y: -9800 } },
    { type: "LINE", layer: "wall", handle: 811, vertices: [{ x: 0, y: -9500 }, { x: 8000, y: -9500 }] },
    { type: "LINE", layer: "wall", handle: 812, vertices: [{ x: 8000, y: -9500 }, { x: 8000, y: -3000 }] },
    { type: "LINE", layer: "wall", handle: 813, vertices: [{ x: 8000, y: -3000 }, { x: 0, y: -3000 }] },
    { type: "LINE", layer: "wall", handle: 814, vertices: [{ x: 0, y: -3000 }, { x: 0, y: -9500 }] },
    // A real piece of the elevation's own window-frame linework, up near
    // its roofline (y=-3200 to -3700) — geometrically much closer to
    // GROUND FLOOR PLAN's title (0,0) than to FRONT ELEVATION's own title
    // (200,-9800), so nearest-title-to-entity assignment alone puts it in
    // the WRONG group.
    { type: "LINE", layer: "wall", handle: 820, vertices: [{ x: 3000, y: -3200 }, { x: 3000, y: -3700 }] },
  ],
} as unknown as IDxf;
const edgeTitlePartition = partitionByViewTitles(edgeTitleDxf, 1);
check("edge-titled elevation: partitionByViewTitles engages (2 titles found)", edgeTitlePartition !== null);
check(
  "edge-titled elevation: the roofline linework (nearer to the WRONG title by raw distance) is still reclaimed into the elevation, not left polluting the plan",
  !!edgeTitlePartition?.excludeHandles.has("820")
);
check(
  "edge-titled elevation: the reclaimed roofline linework is measured as real elevation detail (a stroke), not just discarded",
  (edgeTitlePartition?.elevationViews[0]?.strokes.length ?? 0) >= 5 // 4 outline edges + the reclaimed roofline segment
);
check(
  "edge-titled elevation: the real ground-floor room's own walls are NOT swept into the elevation — only content actually inside its measured footprint is reclaimed",
  !edgeTitlePartition?.excludeHandles.has("801") && !edgeTitlePartition?.excludeHandles.has("802") && !edgeTitlePartition?.excludeHandles.has("803") && !edgeTitlePartition?.excludeHandles.has("804")
);
const edgeTitleGroundResult = classifyDxf(edgeTitleDxf, 1, { excludeHandles: edgeTitlePartition?.excludeHandles });
const edgeTitleGroundWalls = edgeTitleGroundResult.entities.filter((e) => e.type === "wall");
check(
  "edge-titled elevation: the ground floor plan itself still classifies its own real 4 walls, nothing missing and nothing extra from the elevation",
  edgeTitleGroundWalls.length === 4
);

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
}
