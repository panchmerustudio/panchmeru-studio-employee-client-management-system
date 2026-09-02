/**
 * Regression cover for the "let me see that drawing next to the 3D model
 * so I can compare whether it's generating it right" feature — a flat SVG
 * read-out of the exact same CadEntityInput rows the 3D model is built
 * from (see source-drawing-2d.tsx's doc). Rendered headless via
 * react-dom/server (no browser/jsdom needed for a pure SVG tree) and
 * checked by looking for the SVG primitives each fixture should produce.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { SourceDrawing2D } from "../src/app/(app)/projects/[id]/cad/[modelId]/source-drawing-2d";
import type { CadEntityInput } from "../src/lib/cad3d/build-scene";

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
}

const planEntities: CadEntityInput[] = [
  { id: "w1", type: "wall", layerName: "A-WALL", geometry: { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } }, depthMm: 200, heightMm: 3000 },
  { id: "w2", type: "wall", layerName: "A-WALL", geometry: { start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 } }, depthMm: 200, heightMm: 3000 },
  { id: "d1", type: "door", layerName: "A-DOOR", geometry: { position: { x: 2000, y: 0 } }, widthMm: 900, depthMm: 50, rotationDeg: 0 },
  { id: "c1", type: "column", layerName: "A-COL", geometry: { position: { x: 500, y: 500 } }, widthMm: 300, depthMm: 300 },
  { id: "r1", type: "room", layerName: "A-ROOM", geometry: { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] } },
];
const noop = () => {};
const planHtml = renderToStaticMarkup(<SourceDrawing2D entities={planEntities} mode="plan" onModeChange={noop} />);
check("plan-only fixture renders without throwing", planHtml.length > 0);
check("plan-only fixture includes an SVG", planHtml.includes("<svg"));
check("plan-only fixture draws a wall <line>", planHtml.includes("<line"));
check("plan-only fixture draws the room polygon", planHtml.includes("<polygon"));
check("plan-only fixture has no mode toggle (only plan exists)", !planHtml.includes("Elevation</button>"));

const elevationEntities: CadEntityInput[] = [
  {
    id: "elev1",
    type: "elevation_panel",
    layerName: "0",
    geometry: {
      widthMm: 8000,
      heightMm: 3200,
      openings: [{ xMm: 1000, zMm: 900, widthMm: 1200, heightMm: 1500, kind: "window" }],
      // Real elevations rarely tag their gate/balcony/molding detail as
      // named blocks (see extractElevationStrokes' doc in classify.ts) —
      // this is the same "traced verbatim" data the 3D panel now shows.
      strokes: [
        { x1: 0, y1: 0, x2: 8000, y2: 0 },
        { x1: 4000, y1: 0, x2: 4000, y2: 1500 },
      ],
    },
    widthMm: 8000,
    depthMm: 3200,
  },
];
const elevHtml = renderToStaticMarkup(<SourceDrawing2D entities={elevationEntities} mode="elevation" onModeChange={noop} />);
check("elevation-only fixture renders without throwing", elevHtml.length > 0);
check("elevation-only fixture draws the traced strokes as a single <path>", elevHtml.includes("<path"));
check("elevation-only fixture draws the window opening as a <rect>", elevHtml.includes("<rect"));
check("elevation-only fixture has no mode toggle (only elevation exists)", !elevHtml.includes("Plan</button>"));

const combinedEntities = [...planEntities, ...elevationEntities];
const combinedElevHtml = renderToStaticMarkup(<SourceDrawing2D entities={combinedEntities} mode="elevation" onModeChange={noop} />);
check("combined fixture (plan + elevation both present) shows the Plan/Elevation toggle", combinedElevHtml.includes("Elevation</button>") && combinedElevHtml.includes("Plan</button>"));
check("combined fixture in elevation mode draws the elevation panel, not the plan", combinedElevHtml.includes("<path") && !combinedElevHtml.includes("<line"));
const combinedPlanHtml = renderToStaticMarkup(<SourceDrawing2D entities={combinedEntities} mode="plan" onModeChange={noop} />);
check(
  // Same toggle now also decides what the 3D scene builds from (see
  // model-viewer.tsx's sceneEntities) — this is the flat 2D half of that
  // same "one coherent view at a time" behavior, so it's worth its own
  // explicit case rather than just trusting the default.
  "combined fixture in plan mode draws the plan's walls, not the elevation",
  combinedPlanHtml.includes("<line") && !combinedPlanHtml.includes("<path")
);

const emptyHtml = renderToStaticMarkup(<SourceDrawing2D entities={[]} mode="plan" onModeChange={noop} />);
check("a model with nothing plan- or elevation-shaped renders nothing (no empty card)", emptyHtml === "");
