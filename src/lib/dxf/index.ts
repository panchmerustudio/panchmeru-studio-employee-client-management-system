import "server-only";
import DxfParser from "dxf-parser";
import { classifyDxf, detectNonPlanDrawing, type ClassificationResult } from "./classify";
import { resolveUnits, UNIT_TO_MM, type CadUnits, type UnitsResolution } from "./units";

export function parseDxfFile(dxfText: string, units: CadUnits): { result: ClassificationResult; unitsResolution: UnitsResolution } {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf) throw new Error("Couldn't read this file as DXF — make sure it was saved/exported as DXF (not DWG) from AutoCAD.");
  const unitsResolution = resolveUnits(dxf, units);
  const result = classifyDxf(dxf, UNIT_TO_MM[unitsResolution.effective]);
  // "recognize the type of drawing and work accordingly" — a plan-view
  // floor layout gets modeled as before; an elevation/section sheet (see
  // detectNonPlanDrawing's doc in classify.ts) is reported clearly instead
  // of silently producing an empty model.
  const nonPlanReason = detectNonPlanDrawing(dxf, result);
  if (nonPlanReason) throw new Error(nonPlanReason);
  return { result, unitsResolution };
}

/** Light heuristic check before we even hand the buffer to the real parser — DXF is ASCII/text, starting with a "0" / "SECTION" group-code pair. Gives a clear error fast instead of a confusing parser exception for e.g. an accidentally-uploaded DWG. */
export function looksLikeDxf(text: string) {
  const head = text.slice(0, 200);
  return /^\s*0\s*[\r\n]+\s*SECTION/i.test(head) || head.includes("ENTITIES") || head.includes("HEADER");
}

export { classifyDxf, UNIT_TO_MM };
export type { CadUnits, UnitsResolution } from "./units";
export type { ClassificationResult, ClassifiedEntity } from "./classify";
