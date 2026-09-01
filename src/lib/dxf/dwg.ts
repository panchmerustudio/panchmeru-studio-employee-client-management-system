import "server-only";
import { LibreDwg, Dwg_File_Type } from "@mlightcad/libredwg-web";
import { classifyDxf, detectNonPlanDrawing, extractViews, type ClassificationResult, type ElevationView, type DeclaredDrawingType } from "./classify";
import { resolveUnits, UNIT_TO_MM, type CadUnits, type UnitsResolution } from "./units";
import { dwgDatabaseToIDxf, type DwgDatabaseLike } from "./from-dwg";

/**
 * Reads a DWG file directly — no third-party conversion service. DWG is
 * Autodesk's proprietary binary format, but @mlightcad/libredwg-web ships
 * a WASM build of the open-source libredwg project that reads it straight
 * into a plain JS object (a "DwgDatabase") in-process, so this runs inside
 * the same server action as a DXF upload: no outbound API call, no API
 * key, no per-day quota, no network failure mode to diagnose (this
 * used to go through a third-party conversion API — see this file's
 * git log for that history — which this replaces for DWG uploads
 * entirely; DXF uploads never needed it in the first place).
 *
 * @mlightcad/libredwg-web is GPL-3.0-licensed. That's a real consideration
 * for a closed-source product — GPL's copyleft obligations are generally
 * understood to trigger on *distributing* the combined work, and this
 * runs only server-side (nothing built on it ships to end users), which is
 * the common reading under which plenty of commercial SaaS backends bundle
 * GPL server tooling — but that's not legal advice, and worth a licensing
 * check with counsel if it matters for this business.
 *
 * The WASM module is real, native-code-derived C — dwg_write_dxf (its
 * DWG->DXF-text export) segfaults on at least one real-world file tested
 * against this codebase ("memory access out of bounds"), so this
 * deliberately never calls it. dwg_read_data + convert() (turning the
 * parsed native structure into a plain JS DwgDatabase) is the path that's
 * actually been verified against a real file and is what's used here.
 */

let libredwgPromise: Promise<LibreDwg> | null = null;
/** The WASM module is expensive enough to instantiate that it's cached per warm server instance rather than reloaded on every upload. */
function getLibreDwg(): Promise<LibreDwg> {
  if (!libredwgPromise) libredwgPromise = LibreDwg.create();
  return libredwgPromise;
}

function countEntities(db: DwgDatabaseLike): number {
  const modelSpace = db.tables?.BLOCK_RECORD?.entries?.find((r) => r.name === "*Model_Space");
  return (modelSpace?.entities ?? db.entities ?? []).length;
}

export async function parseDwgBuffer(
  fileContent: ArrayBuffer,
  units: CadUnits,
  drawingHints?: { declaredType?: DeclaredDrawingType; preferredLevelKeyword?: string }
): Promise<{ result: ClassificationResult; unitsResolution: UnitsResolution; elevationViews: ElevationView[]; otherLevelTitles: string[]; otherLevelEntityCount: number; primaryPlanTitle: string | null }> {
  const libredwg = await getLibreDwg();

  let dataPtr: number | undefined;
  try {
    dataPtr = libredwg.dwg_read_data(fileContent, Dwg_File_Type.DWG);
  } catch (err) {
    throw new Error(`Couldn't read this DWG file: ${err instanceof Error ? err.message : String(err)}. It may be corrupted or use an unsupported DWG version — try exporting it as DXF from AutoCAD instead.`);
  }
  if (dataPtr === undefined || dataPtr === 0) {
    throw new Error("Couldn't read this DWG file — it doesn't look like valid DWG data. Try exporting it as DXF from AutoCAD instead.");
  }

  let db: DwgDatabaseLike;
  try {
    db = libredwg.convert(dataPtr) as unknown as DwgDatabaseLike;
  } catch (err) {
    throw new Error(`Couldn't read this DWG file: ${err instanceof Error ? err.message : String(err)}. It may be corrupted or use an unsupported DWG version — try exporting it as DXF from AutoCAD instead.`);
  } finally {
    // dwg_read_data's native structure isn't needed once convert() has
    // copied everything into the plain DwgDatabase above — freeing it now
    // keeps the WASM heap from growing across many uploads in one warm
    // server instance (see getLibreDwg's caching above).
    try {
      libredwg.dwg_free(dataPtr);
    } catch {
      // best-effort cleanup — never let a free() failure mask the real result/error above
    }
  }

  // A malformed or unrelated file can still produce a "successful" read
  // with a valid-looking pointer but essentially no content (verified
  // empirically: 100 bytes of garbage parses "successfully" into an empty
  // DwgDatabase rather than throwing) — this is the equivalent of
  // looksLikeDxf()'s sanity check for the DXF path.
  if (countEntities(db) === 0) {
    throw new Error("Couldn't find any drawing content in this DWG file — it may be empty, corrupted, or use a DWG version this importer doesn't support. Try exporting it as DXF from AutoCAD instead.");
  }

  const dxf = dwgDatabaseToIDxf(db);
  const unitsResolution = resolveUnits(dxf, units);
  const scale = UNIT_TO_MM[unitsResolution.effective];

  // Isolate any elevation view(s), and any OTHER floor level's plan on the
  // same sheet, BEFORE plan classification runs, so none of that geometry
  // can get mis-paired into this floor's bogus "walls" — see extractViews'
  // doc in classify.ts. drawingHints carries what a person explicitly said
  // about the file (see uploadCadModel's "drawing type"/"floor level"
  // fields) — used when the drawing's own titles can't answer that alone.
  const { elevationViews, excludeHandles, otherLevelTitles, otherLevelEntityCount, primaryPlanTitle } = extractViews(dxf, scale, drawingHints);
  const result = classifyDxf(dxf, scale, { excludeHandles });

  // "recognize the type of drawing and work accordingly": a sheet with no
  // usable plan-view wall structure used to always be rejected outright.
  // Now it's only rejected when no elevation view could be built from it
  // either — a real elevation-only upload succeeds with just the facade
  // panel instead (a genuinely section-only sheet still has nothing this
  // codebase can build, so it keeps being rejected). A declared "plan"
  // skips this rejection outright — a person who already knows what the
  // drawing is shouldn't be second-guessed by a title-wording heuristic.
  const nonPlanReason = drawingHints?.declaredType === "plan" ? null : detectNonPlanDrawing(dxf, result);
  if (nonPlanReason && elevationViews.length === 0) throw new Error(nonPlanReason);
  return { result, unitsResolution, elevationViews, otherLevelTitles, otherLevelEntityCount, primaryPlanTitle };
}
