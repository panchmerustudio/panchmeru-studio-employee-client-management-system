/**
 * Unit handling for DXF/DWG import — split out from index.ts (which is
 * marked "server-only" and can't be imported from a plain Node test
 * script) so this pure, side-effect-free logic stays independently
 * testable. See scripts/test-dxf-units.ts.
 */

export type CadUnits = "mm" | "cm" | "m" | "in" | "ft";

/** Converts one drawing unit to millimeters — the canonical internal unit everywhere past this module. */
export const UNIT_TO_MM: Record<CadUnits, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/**
 * DXF/DWG's $INSUNITS header variable — written automatically by the CAD
 * software from the drawing's own template/settings, not something a
 * drafter fills in by hand. AutoCAD's enum (only the values we can act on;
 * everything else — 0 "Unitless", miles, microns, astronomical units, etc.
 * — is left out on purpose, see the fallback below).
 */
const INSUNITS_TO_CAD_UNITS: Record<number, CadUnits> = {
  1: "in",
  2: "ft",
  4: "mm",
  5: "cm",
  6: "m",
};

export type UnitsResolution = {
  requested: CadUnits; // what the uploader picked in the upload form
  effective: CadUnits; // what was actually used to scale the drawing to mm
  source: "file" | "user";
  fileDeclaredInsunits?: number; // raw $INSUNITS value, for diagnostics/audit
};

/**
 * A person uploading someone else's drawing is guessing a unit from a
 * 5-item dropdown; the drawing itself already knows, via $INSUNITS, because
 * AutoCAD (and everything that round-trips through it) writes that header
 * automatically from the file's real template/settings. When the two
 * disagree and the file's value is one we support, trust the file — a
 * wrong dropdown pick otherwise silently scales an entire building by a
 * fixed, wrong factor (e.g. picking "ft" for a file whose native unit is
 * "in" renders everything exactly 12x too big) with no visible symptom
 * beyond "the 3D model looks wrong/huge/scattered", which is very hard for
 * a non-technical user to diagnose themselves.
 */
export function resolveUnits(dxf: { header?: Record<string, unknown> }, requested: CadUnits): UnitsResolution {
  const raw = dxf.header?.["$INSUNITS"];
  const insunits = typeof raw === "number" ? raw : undefined;
  const fileUnits = insunits !== undefined ? INSUNITS_TO_CAD_UNITS[insunits] : undefined;
  if (fileUnits && fileUnits !== requested) {
    return { requested, effective: fileUnits, source: "file", fileDeclaredInsunits: insunits };
  }
  return { requested, effective: requested, source: "user", fileDeclaredInsunits: insunits };
}
