import type { CadUnits } from "./dxf";

/**
 * Display/entry helpers for the missing-information questions (CAD model
 * page). Every measurement is still stored and submitted in millimeters —
 * "CAD measurements are the source of truth" (see src/lib/cad3d/build-scene.ts)
 * — but a drawing authored in feet shouldn't force an architect to think in
 * "2700 mm" when answering "what's the floor-to-floor height?". These
 * convert to/from the same unit the drawing itself was uploaded in
 * (cadModels.units), purely for what's shown/typed on screen.
 */

const MM_PER_UNIT: Record<CadUnits, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export function mmToUnitValue(mm: number, unit: CadUnits): number {
  return mm / MM_PER_UNIT[unit];
}

export function unitValueToMm(value: number, unit: CadUnits): number {
  return value * MM_PER_UNIT[unit];
}

/** Human-readable label for a millimeter measurement, in the drawing's own unit. Feet get architectural feet-inches notation (e.g. 9'-0"); everything else is decimal with the unit suffix. */
export function formatMm(mm: number, unit: CadUnits): string {
  switch (unit) {
    case "ft": {
      const totalInches = mm / 25.4;
      let feet = Math.floor(totalInches / 12);
      let inches = Math.round(totalInches - feet * 12);
      if (inches === 12) {
        feet += 1;
        inches = 0;
      }
      return `${feet}'-${inches}"`;
    }
    case "in":
      return `${round(mm / 25.4, 1)}"`;
    case "m":
      return `${round(mm / 1000, 2)} m`;
    case "cm":
      return `${round(mm / 10, 1)} cm`;
    default:
      return `${Math.round(mm)} mm`;
  }
}

/** Short label for input placeholders/suffixes — same unit strings the drawing was uploaded with. */
export function unitSuffix(unit: CadUnits): string {
  return unit === "ft" ? "ft (decimal)" : unit;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
