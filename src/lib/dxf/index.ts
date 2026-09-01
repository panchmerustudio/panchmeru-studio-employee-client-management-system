import "server-only";
import DxfParser from "dxf-parser";
import { classifyDxf, detectNonPlanDrawing, extractViews, type ClassificationResult, type ElevationView, type DeclaredDrawingType } from "./classify";
import { resolveUnits, UNIT_TO_MM, type CadUnits, type UnitsResolution } from "./units";

export function parseDxfFile(
  dxfText: string,
  units: CadUnits,
  drawingHints?: { declaredType?: DeclaredDrawingType; preferredLevelKeyword?: string }
): { result: ClassificationResult; unitsResolution: UnitsResolution; elevationViews: ElevationView[]; otherLevelTitles: string[]; otherLevelEntityCount: number } {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf) throw new Error("Couldn't read this file as DXF — make sure it was saved/exported as DXF (not DWG) from AutoCAD.");
  const unitsResolution = resolveUnits(dxf, units);
  const scale = UNIT_TO_MM[unitsResolution.effective];

  // Isolate any elevation view(s), and any OTHER floor level's plan on the
  // same sheet, BEFORE plan classification runs — see extractViews' doc in
  // classify.ts. drawingHints carries what a person explicitly said about
  // the file (see uploadCadModel's "drawing type"/"floor level" fields).
  const { elevationViews, excludeHandles, otherLevelTitles, otherLevelEntityCount } = extractViews(dxf, scale, drawingHints);
  const result = classifyDxf(dxf, scale, { excludeHandles });

  // "recognize the type of drawing and work accordingly" — a plan-view
  // floor layout gets modeled as before; an elevation view now builds a
  // real facade panel instead of being rejected. A genuinely section-only
  // (or elevation-titled-but-unextractable) sheet is still reported
  // clearly instead of silently producing an empty model — see
  // detectNonPlanDrawing's doc in classify.ts. A declared "plan" skips
  // this rejection outright — see parseDwgBuffer's matching comment.
  const nonPlanReason = drawingHints?.declaredType === "plan" ? null : detectNonPlanDrawing(dxf, result);
  if (nonPlanReason && elevationViews.length === 0) throw new Error(nonPlanReason);
  return { result, unitsResolution, elevationViews, otherLevelTitles, otherLevelEntityCount };
}

/** Light heuristic check before we even hand the buffer to the real parser — DXF is ASCII/text, starting with a "0" / "SECTION" group-code pair. Gives a clear error fast instead of a confusing parser exception for e.g. an accidentally-uploaded DWG. */
export function looksLikeDxf(text: string) {
  const head = text.slice(0, 200);
  return /^\s*0\s*[\r\n]+\s*SECTION/i.test(head) || head.includes("ENTITIES") || head.includes("HEADER");
}

export { classifyDxf, UNIT_TO_MM };
export type { CadUnits, UnitsResolution } from "./units";
export type { ClassificationResult, ClassifiedEntity, ElevationView, ElevationOpening, DeclaredDrawingType } from "./classify";
