import "server-only";
import DxfParser from "dxf-parser";
import { classifyDxf, type ClassificationResult } from "./classify";

export type CadUnits = "mm" | "cm" | "m" | "in" | "ft";

/** Converts one drawing unit to millimeters — the canonical internal unit everywhere past this module. */
export const UNIT_TO_MM: Record<CadUnits, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

export function parseDxfFile(dxfText: string, units: CadUnits): ClassificationResult {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf) throw new Error("Couldn't read this file as DXF — make sure it was saved/exported as DXF (not DWG) from AutoCAD.");
  return classifyDxf(dxf, UNIT_TO_MM[units]);
}

/** Light heuristic check before we even hand the buffer to the real parser — DXF is ASCII/text, starting with a "0" / "SECTION" group-code pair. Gives a clear error fast instead of a confusing parser exception for e.g. an accidentally-uploaded DWG. */
export function looksLikeDxf(text: string) {
  const head = text.slice(0, 200);
  return /^\s*0\s*[\r\n]+\s*SECTION/i.test(head) || head.includes("ENTITIES") || head.includes("HEADER");
}

export { classifyDxf };
export type { ClassificationResult, ClassifiedEntity } from "./classify";
