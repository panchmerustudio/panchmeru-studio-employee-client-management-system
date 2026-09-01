/**
 * Regression check for the units auto-correction in src/lib/dxf/index.ts.
 *
 * Real-world bug this guards against: a user uploads someone else's DWG/DXF
 * and picks a unit from the upload form's dropdown by eyeballing the
 * drawing — easy to get wrong. The file itself already knows its own unit
 * via the $INSUNITS header (written automatically by the CAD software, not
 * guessed), so parseDxfFile() must prefer that over the form's dropdown
 * whenever the two disagree and the header value is one we support.
 *
 * The K.K. Sharma production file that surfaced this: header declares
 * $INSUNITS=1 (Inches), user selected "ft" at upload — a 12x scale error
 * (304.8mm/ft vs 25.4mm/in) that silently rendered the entire building,
 * and every piece of furniture in it, 12x too large. That's what made the
 * 3D model "look wrong" (flat, furniture invisible, scattered across
 * hundreds of meters) even after the classification/rendering fixes.
 *
 * Run with: npx tsx scripts/test-dxf-units.ts
 *
 * Exercises resolveUnits() directly (from src/lib/dxf/units.ts, which has
 * no "server-only" guard) rather than the full parseDxfFile()/index.ts
 * entry point, which is marked server-only and can't be imported from a
 * plain Node script — same reason scripts/test-cad-classify.ts imports
 * classify.ts directly instead of going through index.ts.
 */
import DxfParser from "dxf-parser";
import { resolveUnits } from "../src/lib/dxf/units";

function dxfWithInsunits(insunits: number | null) {
  const lines = ["0", "SECTION", "2", "HEADER"];
  if (insunits !== null) lines.push("9", "$INSUNITS", "70", String(insunits));
  lines.push("0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF");
  const parser = new DxfParser();
  const dxf = parser.parseSync(lines.join("\n"));
  if (!dxf) throw new Error("test fixture failed to parse as DXF");
  return dxf;
}

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
}

// File says Inches (1), user picked "ft" — must override to "in".
{
  const unitsResolution = resolveUnits(dxfWithInsunits(1), "ft");
  check("file declares inches, user picked ft -> effective is in", unitsResolution.effective === "in");
  check("override recorded as coming from the file", unitsResolution.source === "file");
  check("original user pick preserved for the audit trail", unitsResolution.requested === "ft");
}

// File says Millimeters (4), user also picked "mm" — no override, no false "source: file" flag.
{
  const unitsResolution = resolveUnits(dxfWithInsunits(4), "mm");
  check("file and user agree (mm) -> effective is mm", unitsResolution.effective === "mm");
  check("agreement is NOT reported as an override", unitsResolution.source === "user");
}

// File says Unitless (0) — never a real signal, must not override a real user pick.
{
  const unitsResolution = resolveUnits(dxfWithInsunits(0), "cm");
  check("file is unitless (0) -> keeps the user's cm pick", unitsResolution.effective === "cm" && unitsResolution.source === "user");
}

// File declares a unit we don't support in the CadUnits enum (e.g. 3 = Miles) — keep the user's pick rather than crash or silently misconvert.
{
  const unitsResolution = resolveUnits(dxfWithInsunits(3), "m");
  check("unsupported header unit (miles) -> keeps the user's m pick", unitsResolution.effective === "m" && unitsResolution.source === "user");
}

// No $INSUNITS header at all (older/minimal DXFs) — keep the user's pick.
{
  const unitsResolution = resolveUnits(dxfWithInsunits(null), "ft");
  check("missing $INSUNITS header -> keeps the user's ft pick", unitsResolution.effective === "ft" && unitsResolution.source === "user");
}

// Feet (2) declared, user picked mm — must override to ft.
{
  const unitsResolution = resolveUnits(dxfWithInsunits(2), "mm");
  check("file declares feet, user picked mm -> effective is ft", unitsResolution.effective === "ft" && unitsResolution.source === "file");
}
