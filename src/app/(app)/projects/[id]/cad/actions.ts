"use server";

/**
 * AI CAD -> 3D architectural modeler, Phase 1 (DXF only). Upload/parse ->
 * resolve missing information (never invented, see src/lib/dxf/classify.ts)
 * -> approve. 3D geometry generation itself happens client-side (Three.js,
 * see src/lib/cad3d) from the locked cadEntities this produces — the
 * server's job is strictly parsing + the structured, measurement-locked
 * database, matching the spec's "CAD measurements are the source of truth"
 * principle end to end.
 */

import { revalidatePath } from "next/cache";
import { eq, and, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { cadModels, cadEntities, cadMissingInputs, projects } from "@/db/schema";
import { requireUser, requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { registerUploadedFile, readStoredFile } from "@/lib/storage";
import { parseDxfFile, looksLikeDxf, type CadUnits, type UnitsResolution, type ElevationView } from "@/lib/dxf";
import { parseDwgBuffer } from "@/lib/dxf/dwg";
import type { ClassificationResult, ClassifiedEntity } from "@/lib/dxf/classify";

const FURNITURE_PLACEHOLDER_HEIGHT_MM = 750; // footprint-only mass (Phase 1 has no 3D furniture library yet) — never presented as a real furniture height

// An elevation view's own measured height (see extractElevationViews in
// classify.ts) is a REAL measurement, not a guess — but only worth using as
// this building's floor-to-ceiling height when it's plausibly a single
// storey's worth. A file drawn as a taller multi-storey elevation (this
// codebase doesn't model multiple storeys yet) would otherwise silently
// apply its WHOLE height as if it were one floor's, which is a genuine
// misapplication of a true number, not merely an invented one — so outside
// this range the ordinary floor_height missing-input question is asked
// instead, exactly as if no elevation existed.
const PLAUSIBLE_FLOOR_HEIGHT_MM = { min: 2200, max: 4500 };

type MissingInputSpec = { kind: "floor_height" | "door_height" | "window_height" | "window_sill_height" | "wall_default_thickness"; question: string };

function buildMissingInputs(result: ClassificationResult): MissingInputSpec[] {
  const specs: MissingInputSpec[] = [
    { kind: "floor_height", question: "Floor-to-floor height isn't in a plan-view drawing. What is it for this level?" },
  ];
  if (result.hasUnpairedWalls) {
    specs.push({ kind: "wall_default_thickness", question: "Some walls are drawn as a single line — no thickness could be measured. What default thickness should apply to them?" });
  }
  if (result.hasDoors) {
    specs.push({ kind: "door_height", question: "What is the standard door height in this drawing?" });
  }
  if (result.hasWindows) {
    specs.push({ kind: "window_height", question: "What is the standard window height?" });
    specs.push({ kind: "window_sill_height", question: "What is the window sill height (window bottom above floor)?" });
  }
  return specs;
}

// Sensible, commonly-correct construction defaults — applied automatically
// at upload so a person is never BLOCKED on answering these before seeing
// a 3D model ("it should be optional for a human whether he wants to enter
// dimensions or not"). Every one of these stays visible and editable
// afterwards on the model page ("Assumed measurements") — nothing here is
// hidden or treated as final, it's just no longer a gate. Ordinary
// residential practice: ~9'10"/3.0m floor height, 7'/2.1m door, 4'/1.2m
// window, 3'/0.9m sill, 9in/230mm brick wall.
const DEFAULT_MM: Record<MissingInputSpec["kind"], number> = {
  floor_height: 3000,
  door_height: 2100,
  window_height: 1200,
  window_sill_height: 900,
  wall_default_thickness: 230,
};

/**
 * Applies one resolved measurement to the model row + its cadEntities rows
 * — shared by the automatic-default pass at upload time and by a person
 * changing a value afterwards through resolveMissingInput, so both paths
 * stay in sync and a later manual edit re-applies correctly. For
 * wall_default_thickness specifically, re-applying a CHANGED default must
 * only touch walls that got the PREVIOUS default, not ones with a real
 * measured thickness — matching on the model's previous
 * wallDefaultThicknessMm value (in addition to NULL, for the very first
 * apply) does that without needing a schema column to mark "this was a
 * guess, not a measurement."
 */
async function applyMissingInputValue(modelId: string, kind: MissingInputSpec["kind"], valueMm: number) {
  switch (kind) {
    case "floor_height":
      await db.update(cadModels).set({ floorHeightMm: valueMm }).where(eq(cadModels.id, modelId));
      await db
        .update(cadEntities)
        .set({ heightMm: valueMm })
        .where(and(eq(cadEntities.modelId, modelId), inArray(cadEntities.type, ["wall", "column", "stair"])));
      break;
    case "door_height":
      await db.update(cadModels).set({ doorHeightMm: valueMm }).where(eq(cadModels.id, modelId));
      await db.update(cadEntities).set({ heightMm: valueMm }).where(and(eq(cadEntities.modelId, modelId), eq(cadEntities.type, "door")));
      break;
    case "window_height":
      await db.update(cadModels).set({ windowHeightMm: valueMm }).where(eq(cadModels.id, modelId));
      await db.update(cadEntities).set({ heightMm: valueMm }).where(and(eq(cadEntities.modelId, modelId), eq(cadEntities.type, "window")));
      break;
    case "window_sill_height":
      await db.update(cadModels).set({ windowSillMm: valueMm }).where(eq(cadModels.id, modelId));
      break;
    case "wall_default_thickness": {
      const model = await db.query.cadModels.findFirst({ where: eq(cadModels.id, modelId) });
      const previousDefault = model?.wallDefaultThicknessMm ?? null;
      await db.update(cadModels).set({ wallDefaultThicknessMm: valueMm }).where(eq(cadModels.id, modelId));
      const wallMatch = previousDefault != null ? or(isNull(cadEntities.depthMm), eq(cadEntities.depthMm, previousDefault)) : isNull(cadEntities.depthMm);
      await db.update(cadEntities).set({ depthMm: valueMm }).where(and(eq(cadEntities.modelId, modelId), eq(cadEntities.type, "wall"), wallMatch));
      break;
    }
  }
}

function entityToRow(modelId: string, e: ClassifiedEntity) {
  switch (e.type) {
    case "wall": {
      const lengthMm = Math.round(Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y));
      return {
        modelId,
        type: "wall" as const,
        layerName: e.layerName,
        geometry: { start: e.start, end: e.end },
        widthMm: lengthMm,
        depthMm: e.thicknessMm,
        heightMm: null,
        sourceHandle: e.handle,
      };
    }
    case "door":
    case "window":
      return {
        modelId,
        type: e.type,
        layerName: e.layerName,
        label: e.label,
        geometry: { position: e.position },
        widthMm: e.widthMm,
        depthMm: e.depthMm,
        heightMm: null,
        rotationDeg: e.rotationDeg,
        sourceHandle: e.handle,
      };
    case "column":
      return {
        modelId,
        type: "column" as const,
        layerName: e.layerName,
        label: e.label,
        geometry: { position: e.position },
        widthMm: e.widthMm,
        depthMm: e.depthMm,
        heightMm: null, // runs floor-to-floor, resolved with floor_height
        rotationDeg: e.rotationDeg,
        sourceHandle: e.handle,
      };
    case "furniture":
      return {
        modelId,
        type: "furniture" as const,
        layerName: e.layerName,
        label: e.label,
        geometry: { position: e.position },
        widthMm: e.widthMm,
        depthMm: e.depthMm,
        heightMm: FURNITURE_PLACEHOLDER_HEIGHT_MM, // footprint marker only — see module doc
        rotationDeg: e.rotationDeg,
        sourceHandle: e.handle,
      };
    case "room": {
      const xs = e.points.map((p) => p.x);
      const ys = e.points.map((p) => p.y);
      return {
        modelId,
        type: "room" as const,
        layerName: e.layerName,
        label: e.label,
        geometry: { points: e.points },
        widthMm: Math.round(Math.max(...xs) - Math.min(...xs)),
        depthMm: Math.round(Math.max(...ys) - Math.min(...ys)),
        heightMm: null,
        sourceHandle: e.handle,
      };
    }
    case "stair": {
      const xs = e.points.map((p) => p.x);
      const ys = e.points.map((p) => p.y);
      return {
        modelId,
        type: "stair" as const,
        layerName: e.layerName,
        geometry: { points: e.points },
        widthMm: Math.round(Math.max(...xs) - Math.min(...xs)),
        depthMm: Math.round(Math.max(...ys) - Math.min(...ys)),
        heightMm: null, // simplified single-mass placeholder, resolved with floor_height
        sourceHandle: e.handle,
      };
    }
    case "unclassified":
      return {
        modelId,
        type: "unclassified" as const,
        layerName: e.layerName,
        label: e.label,
        geometry: { points: e.points },
        locked: false,
        sourceHandle: e.handle,
      };
  }
}

function elevationViewToRow(modelId: string, view: ElevationView) {
  return {
    modelId,
    type: "elevation_panel" as const,
    layerName: "0",
    geometry: { widthMm: view.widthMm, heightMm: view.heightMm, openings: view.openings },
    widthMm: view.widthMm,
    depthMm: view.heightMm, // this row has no plan position, so widthMm/depthMm double as the panel's own width/height rather than a footprint
    heightMm: null,
  };
}

export async function uploadCadModel(projectId: string, formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.CAD_CREATE);
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) throw new Error("Project not found.");

  const fileKey = formData.get("fileKey") as string | null;
  const fileOriginalName = formData.get("fileOriginalName") as string | null;
  const units = (formData.get("units") as CadUnits | null) ?? "mm";
  const name = (formData.get("name") as string | null)?.trim() || fileOriginalName || "CAD import";
  if (!fileKey || !fileOriginalName) throw new Error("Choose and upload a DXF or DWG file first.");
  const lowerName = fileOriginalName.toLowerCase();
  const isDwg = lowerName.endsWith(".dwg");
  if (!lowerName.endsWith(".dxf") && !isDwg) throw new Error("Only DXF and DWG files are supported.");

  const savedFile = await registerUploadedFile({
    key: fileKey,
    originalName: fileOriginalName,
    mimeType: isDwg ? "application/dwg" : "application/dxf",
    kind: "drawing",
    uploadedBy: actor.id,
    relatedEntityType: "cad_model",
  });

  // Everything from here through parseDxfFile()/parseDwgBuffer() can fail
  // on a bad/foreign file, an unsupported DWG version, or a drawing that
  // just isn't a floor plan (see detectNonPlanDrawing in classify.ts). This
  // used to only catch the DXF-text parse step — a failure earlier, in the
  // (now-removed) CloudConvert conversion call, was left to throw straight
  // out of this Server Action uncaught, which Next.js then reports to the
  // browser as a generic digested/minified error ("Minified React error
  // #441") instead of ever showing the real message. One try/catch around
  // the whole "turn the upload into a classified model" sequence means
  // every failure in it becomes a normal `status: "failed"` model with a
  // readable `parseError`, whichever format the file was.
  let result: ClassificationResult;
  let unitsResolution: UnitsResolution;
  let elevationViews: ElevationView[];
  let otherLevelTitles: string[];
  let otherLevelEntityCount: number;
  try {
    if (isDwg) {
      // DWG is Autodesk's proprietary binary format, but read directly here
      // — no third-party conversion service, no API key, no network call.
      // See src/lib/dxf/dwg.ts for how (and why dwg_write_dxf specifically
      // is avoided) and its doc comment for the GPL-3.0 licensing note on
      // the parser this uses.
      const buffer = await readStoredFile(fileKey);
      ({ result, unitsResolution, elevationViews, otherLevelTitles, otherLevelEntityCount } = await parseDwgBuffer(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
        units
      ));
    } else {
      const buffer = await readStoredFile(fileKey);
      const text = buffer.toString("utf-8");
      if (!looksLikeDxf(text)) {
        throw new Error("This doesn't look like a valid DXF file. Make sure it was exported as DXF, not DWG.");
      }
      ({ result, unitsResolution, elevationViews, otherLevelTitles, otherLevelEntityCount } = parseDxfFile(text, units));
    }
  } catch (err) {
    console.error("[cad] uploadCadModel failed:", err);
    const [model] = await db
      .insert(cadModels)
      .values({ projectId, name, sourceFileId: savedFile.id, units, status: "failed", parseError: err instanceof Error ? err.message : "Couldn't read this file.", createdBy: actor.id })
      .returning();
    await recordAudit({ actor, action: "cad.upload_failed", entityType: "cad_model", entityId: model.id, newState: { error: model.parseError } });
    revalidatePath(`/projects/${projectId}/cad`);
    return model;
  }

  // The drawing's own $INSUNITS header beat the uploader's dropdown pick
  // (see resolveUnits() in src/lib/dxf/index.ts) — most likely because the
  // file is genuinely drawn in a different unit than what was selected.
  // There's no schema field for a general "heads up" note on a model, so
  // this makes the correction impossible to miss the only two places it
  // could otherwise stay silent: the stored `units` (now the unit that was
  // actually used to scale the building, so it's never wrong on screen)
  // and the model's name, which is shown everywhere in the CAD list/detail
  // UI without any template changes needed.
  const unitsOverridden = unitsResolution.source === "file";
  // Same reasoning for a multi-storey sheet (see partitionByViewTitles in
  // classify.ts): this app only ever models ONE plan-kind view (no
  // multi-storey extrusion), so when a sheet also carried other floor
  // levels' own titled plans, that's surfaced here rather than the extra
  // floors just silently vanishing with no trace of why.
  const otherLevelsNote = otherLevelTitles.length > 0 ? ` (also on this sheet, not modeled — multi-storey isn't supported yet: ${otherLevelTitles.join(", ")})` : "";
  const displayName = `${name}${unitsOverridden ? ` (units auto-corrected: ${unitsResolution.requested} → ${unitsResolution.effective})` : ""}${otherLevelsNote}`;

  // An elevation view's own measured height stands in for the floor_height
  // missing-input's DEFAULT when it's plausibly a single storey (see
  // PLAUSIBLE_FLOOR_HEIGHT_MM's doc) — a real measurement beats an assumed
  // default. This still goes through the normal cadMissingInputs row (with
  // a question that says so) rather than being applied invisibly, so it
  // stays reviewable/editable from the model page exactly like every other
  // assumed value — "never invented" cuts both ways: silently overriding
  // floor height with no visible trace would be just as opaque as guessing.
  const elevationFloorHeightMm = elevationViews.find((v) => v.heightMm >= PLAUSIBLE_FLOOR_HEIGHT_MM.min && v.heightMm <= PLAUSIBLE_FLOOR_HEIGHT_MM.max)?.heightMm;
  const valueForSpec = (s: MissingInputSpec) => (s.kind === "floor_height" && elevationFloorHeightMm != null ? elevationFloorHeightMm : DEFAULT_MM[s.kind]);

  // "Needs info" no longer blocks 3D generation — see DEFAULT_MM/
  // applyMissingInputValue above. The model goes straight to "ready" and
  // every measurement a plan-view drawing can't contain gets a sensible,
  // commonly-correct default applied automatically; a person can still
  // review and change any of them afterwards from the model page, they
  // just never have to before seeing a model.
  const missingSpecs = buildMissingInputs(result).map((s) =>
    s.kind === "floor_height" && elevationFloorHeightMm != null ? { ...s, question: "Floor-to-ceiling height, measured from the elevation view in this file." } : s
  );
  const [model] = await db
    .insert(cadModels)
    .values({
      projectId,
      name: displayName,
      sourceFileId: savedFile.id,
      units: unitsResolution.effective,
      status: "ready",
      entityCounts: elevationViews.length > 0 ? { ...result.entityCounts, elevation_view: elevationViews.length } : result.entityCounts,
      unclassifiedCount: result.unclassifiedCount,
      ignoredAnnotationCount: result.ignoredAnnotationCount,
      createdBy: actor.id,
    })
    .returning();

  if (result.entities.length > 0) {
    await db.insert(cadEntities).values(result.entities.map((e) => entityToRow(model.id, e)));
  }
  if (elevationViews.length > 0) {
    await db.insert(cadEntities).values(elevationViews.map((v) => elevationViewToRow(model.id, v)));
  }
  if (missingSpecs.length > 0) {
    for (const s of missingSpecs) await applyMissingInputValue(model.id, s.kind, valueForSpec(s));
    await db.insert(cadMissingInputs).values(
      missingSpecs.map((s) => ({ modelId: model.id, kind: s.kind, question: s.question, resolvedValueMm: valueForSpec(s), resolvedAt: new Date() }))
    );
  }

  await recordAudit({
    actor,
    action: "cad.uploaded",
    entityType: "cad_model",
    entityId: model.id,
    newState: {
      entityCounts: result.entityCounts,
      unclassifiedCount: result.unclassifiedCount,
      unitsResolution,
      autoAssumedDefaults: Object.fromEntries(missingSpecs.map((s) => [s.kind, valueForSpec(s)])),
      elevationViews: elevationViews.map((v) => ({ widthMm: v.widthMm, heightMm: v.heightMm, openings: v.openings.length })),
      elevationFloorHeightMm: elevationFloorHeightMm ?? null,
      otherLevelTitles,
      otherLevelEntityCount,
    },
  });
  revalidatePath(`/projects/${projectId}/cad`);
  return model;
}

export async function resolveMissingInput(modelId: string, inputId: string, valueMm: number) {
  const actor = await requirePermission(PERMISSIONS.CAD_CREATE);
  if (!Number.isFinite(valueMm) || valueMm <= 0) throw new Error("Enter a valid positive measurement.");

  const model = await db.query.cadModels.findFirst({ where: eq(cadModels.id, modelId) });
  if (!model) throw new Error("Model not found.");
  const input = await db.query.cadMissingInputs.findFirst({ where: and(eq(cadMissingInputs.id, inputId), eq(cadMissingInputs.modelId, modelId)) });
  if (!input) throw new Error("Question not found.");

  // A person confirming or overriding a value (resolvedBy set to their own
  // id) is distinct from the automatic default applied at upload
  // (resolvedBy left null, see uploadCadModel) — the model page uses that
  // difference to show "Assumed" vs "Confirmed".
  await db.update(cadMissingInputs).set({ resolvedValueMm: valueMm, resolvedBy: actor.id, resolvedAt: new Date() }).where(eq(cadMissingInputs.id, inputId));
  await applyMissingInputValue(modelId, input.kind, valueMm);

  const stillPending = await db.query.cadMissingInputs.findFirst({ where: and(eq(cadMissingInputs.modelId, modelId), isNull(cadMissingInputs.resolvedValueMm)) });
  if (!stillPending && model.status === "needs_info") {
    await db.update(cadModels).set({ status: "ready" }).where(eq(cadModels.id, modelId));
  }

  await recordAudit({ actor, action: "cad.missing_input_resolved", entityType: "cad_model", entityId: modelId, newState: { kind: input.kind, valueMm } });
  revalidatePath(`/projects/${model.projectId}/cad/${modelId}`);
}

/**
 * Deletes a CAD import outright — for a model that was uploaded against the
 * wrong drawing, parsed into garbage, or is otherwise not worth keeping.
 * cadEntities/cadMissingInputs cascade-delete with it (onDelete: "cascade"
 * on both, see src/db/schema/cad.ts) — nothing is left orphaned. An
 * approved model represents signed-off work, so deleting one needs
 * CAD_APPROVE, not just CAD_CREATE; anything short of approved only needs
 * the same permission that let someone upload it in the first place.
 */
export async function deleteCadModel(modelId: string) {
  const actor = await requirePermission(PERMISSIONS.CAD_CREATE);
  const model = await db.query.cadModels.findFirst({ where: eq(cadModels.id, modelId) });
  if (!model) throw new Error("Model not found.");
  if (model.status === "approved" && !actor.permissions.includes(PERMISSIONS.CAD_APPROVE)) {
    throw new Error("This model has been approved — only someone who can approve models can delete it.");
  }

  await db.delete(cadModels).where(eq(cadModels.id, modelId));
  await recordAudit({ actor, action: "cad.deleted", entityType: "cad_model", entityId: modelId, previousState: { name: model.name, status: model.status } });
  revalidatePath(`/projects/${model.projectId}/cad`);
  return { projectId: model.projectId };
}

export async function approveCadModel(modelId: string) {
  const actor = await requirePermission(PERMISSIONS.CAD_APPROVE);
  const model = await db.query.cadModels.findFirst({ where: eq(cadModels.id, modelId) });
  if (!model) throw new Error("Model not found.");
  if (model.status !== "ready") throw new Error(`This model is ${model.status.replace("_", " ")} — it needs to be ready before it can be approved.`);

  await db.update(cadModels).set({ status: "approved", approvedBy: actor.id, approvedAt: new Date() }).where(eq(cadModels.id, modelId));
  await recordAudit({ actor, action: "cad.approved", entityType: "cad_model", entityId: modelId });
  revalidatePath(`/projects/${model.projectId}/cad/${modelId}`);
  revalidatePath(`/projects/${model.projectId}/cad`);
}
