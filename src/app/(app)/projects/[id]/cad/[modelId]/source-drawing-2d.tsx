"use client";

import { useMemo, useState } from "react";
import type { CadEntityInput } from "@/lib/cad3d/build-scene";

/**
 * A flat 2D read-out of the SAME structured entities the 3D model is built
 * from — not a raster of the original DWG/DXF file (this app has no DWG/DXF
 * rendering engine), but the identical wall/door/window/elevation-stroke
 * data, laid out exactly as it was measured off the drawing, with nothing
 * added or reinterpreted. Built for one specific request: "let me see that
 * drawing next to the 3D model so I can compare whether it's generating it
 * right" — this is what lets a mismatch between the source geometry and the
 * 3D output actually be spotted, since both views come from the same rows.
 *
 * Two independent modes because a sheet can carry both: PLAN (walls seen
 * from above) and ELEVATION (a facade panel's own real drawn linework —
 * see extractElevationStrokes' doc in classify.ts). Values are plotted
 * directly in raw millimeters as the SVG viewBox's own units, so nothing
 * here can silently rescale or distort a real measurement.
 */

type Pt = { x: number; y: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function expand(b: Bounds | null, x: number, y: number): Bounds {
  if (!b) return { minX: x, minY: y, maxX: x, maxY: y };
  return { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) };
}

function rotatedCorners(cx: number, cy: number, w: number, d: number, rotationDeg: number): Pt[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const hw = w / 2,
    hd = d / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

function polyPoints(pts: Pt[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

/** One elevation panel's own outline, opening cutouts, and every real traced stroke — see buildElevationPanel's doc in build-scene.ts for what this mirrors in 3D. */
function ElevationSvg({ entity }: { entity: CadEntityInput }) {
  const geo = entity.geometry as {
    widthMm?: number;
    heightMm?: number;
    openings?: { xMm: number; zMm: number; widthMm: number; heightMm: number; kind: string }[];
    strokes?: { x1: number; y1: number; x2: number; y2: number }[];
  };
  const width = geo.widthMm ?? entity.widthMm ?? 0;
  const height = geo.heightMm ?? entity.depthMm ?? 0;
  if (width < 1 || height < 1) return null;
  const margin = Math.max(width, height) * 0.04;
  const strokePath = (geo.strokes ?? []).map((s) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join("");

  return (
    <svg viewBox={`${-margin} ${-height - margin} ${width + margin * 2} ${height + margin * 2}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {/* flip so local y (0 = ground, growing up) reads top-up like a real elevation, not SVG's own down-growing y */}
      <g transform="scale(1 -1)">
        <rect x={0} y={0} width={width} height={height} fill="#faf7ef" stroke="#3a3226" strokeWidth={Math.max(width, height) * 0.0025} />
        {strokePath && <path d={strokePath} stroke="#3a3226" strokeWidth={Math.max(width, height) * 0.0012} fill="none" />}
        {(geo.openings ?? []).map((o, i) => (
          <rect key={i} x={o.xMm} y={o.zMm} width={o.widthMm} height={o.heightMm} fill={o.kind === "door" ? "#c9a86a33" : "#6ea8c933"} stroke="#8a6d3b" strokeWidth={Math.max(width, height) * 0.0015} />
        ))}
      </g>
    </svg>
  );
}

/** Every plan-view entity (walls/doors/windows/columns/furniture/rooms/stairs) drawn to real scale, top-down. */
function PlanSvg({ entities }: { entities: CadEntityInput[] }) {
  let bounds: Bounds | null = null;
  const walls = entities.filter((e) => e.type === "wall");
  for (const w of walls) {
    const g = w.geometry as { start?: Pt; end?: Pt };
    if (g.start) bounds = expand(bounds, g.start.x, g.start.y);
    if (g.end) bounds = expand(bounds, g.end.x, g.end.y);
  }
  const points = entities.filter((e) => e.type === "door" || e.type === "window" || e.type === "column" || e.type === "furniture");
  for (const p of points) {
    const g = p.geometry as { position?: Pt };
    if (g.position) bounds = expand(bounds, g.position.x, g.position.y);
  }
  const shapes = entities.filter((e) => e.type === "room" || e.type === "stair");
  for (const s of shapes) {
    const g = s.geometry as { points?: Pt[] };
    for (const pt of g.points ?? []) bounds = expand(bounds, pt.x, pt.y);
  }
  if (!bounds) return <p className="p-4 text-center text-xs text-muted">No plan-view geometry to show.</p>;

  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const margin = Math.max(w, h) * 0.06;
  const strokeUnit = Math.max(w, h) * 0.0015;

  return (
    <svg
      viewBox={`${bounds.minX - margin} ${-bounds.maxY - margin} ${w + margin * 2} ${h + margin * 2}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* flip so CAD's Y-up reads top-up on screen, not SVG's own down-growing y */}
      <g transform="scale(1 -1)">
        {shapes.map((s) => {
          const g = s.geometry as { points?: Pt[] };
          if (!g.points || g.points.length < 3) return null;
          return <polygon key={s.id} points={polyPoints(g.points)} fill={s.type === "room" ? "#f3ead766" : "#e2e2e266"} stroke="#a89e86" strokeWidth={strokeUnit} />;
        })}
        {walls.map((wall) => {
          const g = wall.geometry as { start?: Pt; end?: Pt };
          if (!g.start || !g.end) return null;
          return (
            <line
              key={wall.id}
              x1={g.start.x}
              y1={g.start.y}
              x2={g.end.x}
              y2={g.end.y}
              stroke="#4a463c"
              strokeWidth={wall.depthMm && wall.depthMm > 0 ? wall.depthMm : Math.max(w, h) * 0.004}
              strokeLinecap="butt"
            />
          );
        })}
        {points.map((e) => {
          const g = e.geometry as { position?: Pt };
          if (!g.position) return null;
          const wMm = e.widthMm ?? 300;
          const dMm = e.depthMm ?? 300;
          const rot = e.rotationDeg ?? 0;
          const fill = e.type === "door" ? "#c9a86a" : e.type === "window" ? "#6ea8c9" : e.type === "column" ? "#888888" : "#b7a48c";
          return <polygon key={e.id} points={polyPoints(rotatedCorners(g.position.x, g.position.y, wMm, dMm, rot))} fill={fill} fillOpacity={0.85} stroke="#33302a" strokeWidth={strokeUnit} />;
        })}
      </g>
    </svg>
  );
}

export function SourceDrawing2D({ entities }: { entities: CadEntityInput[] }) {
  const elevationPanels = useMemo(() => entities.filter((e) => e.type === "elevation_panel"), [entities]);
  const hasPlan = useMemo(() => entities.some((e) => e.type === "wall" || e.type === "room"), [entities]);
  const [mode, setMode] = useState<"elevation" | "plan">(elevationPanels.length > 0 ? "elevation" : "plan");
  const [panelIndex, setPanelIndex] = useState(0);

  if (elevationPanels.length === 0 && !hasPlan) return null;

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-medium text-muted">Source drawing (2D, as read off your file)</p>
        {elevationPanels.length > 0 && hasPlan && (
          <div className="flex gap-1 text-xs">
            <button type="button" onClick={() => setMode("elevation")} className={`rounded px-2 py-1 ${mode === "elevation" ? "bg-slate-800 text-white" : "bg-slate-100 text-foreground"}`}>
              Elevation
            </button>
            <button type="button" onClick={() => setMode("plan")} className={`rounded px-2 py-1 ${mode === "plan" ? "bg-slate-800 text-white" : "bg-slate-100 text-foreground"}`}>
              Plan
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-[#f3f1ea]">
        {mode === "elevation" && elevationPanels.length > 0 ? (
          <ElevationSvg entity={elevationPanels[panelIndex]} />
        ) : (
          <PlanSvg entities={entities} />
        )}
      </div>
      {mode === "elevation" && elevationPanels.length > 1 && (
        <div className="flex justify-center gap-1 border-t border-slate-100 py-1.5 text-xs">
          {elevationPanels.map((_, i) => (
            <button key={i} type="button" onClick={() => setPanelIndex(i)} className={`rounded px-2 py-0.5 ${i === panelIndex ? "bg-slate-800 text-white" : "bg-slate-100 text-foreground"}`}>
              View {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
