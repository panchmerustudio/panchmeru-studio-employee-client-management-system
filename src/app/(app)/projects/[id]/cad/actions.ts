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
import { eq, and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { cadModels, cadEntities, cadMissingInputs, projects } from "@/db/schema";
import { requireUser, requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { registerUploadedFile, readStoredFile, createPresignedDownload } from "@/lib/storage";
import { convertDwgToDxf } from "@/lib/cloudconvert";
import { parseDxfFile, looksLikeDxf, type CadUnits, type UnitsResolution } from "@/lib/dxf";
import type { ClassificationResult, ClassifiedEntity } from "@/lib/dxf/classify";

// Note on function duration: DWG uploads wait on a third-party conversion
// (CloudConvert, see cloudconvert.ts) that can take up to a couple of
// minutes. Next.js's "use server" files can only export async actions —
// `maxDuration` can't be set here directly — so this relies on Vercel's
// platform default (Fluid compute: 300s on Hobby, effectively fixed, not
// configurable higher or lower) rather than an explicit override.
// convertDwgToDxf() enforces its own ~4-minute timeout regardless, so a
// slow conversion fails with a clear message well before Vercel would ever
// kill the request outright.

const FURNITURE_PLACEHOLDER_HEIGHT_MM = 750; // footprint-only mass (Phase 1 has no 3D furniture library yet) — never presented as a real furniture height

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

  let text: string;
  if (isDwg) {
    // DWG is Autodesk's proprietary binary format — convert to DXF via
    // CloudConvert first (see src/lib/cloudconvert.ts), then parse exactly
    // the same way a native DXF upload would be. A short-lived presigned
    // GET URL lets CloudConvert fetch the file directly from R2 without the
    // bucket ever being made public.
    const sourceUrl = await createPresignedDownload(fileKey);
    text = await convertDwgToDxf({ sourceUrl, filename: fileOriginalName });
  } else {
    const buffer = await readStoredFile(fileKey);
    text = buffer.toString("utf-8");
  }
  if (!looksLikeDxf(text)) {
    throw new Error(
      isDwg
        ? "The converted file doesn't look like a valid DXF drawing — this DWG may use an unsupported version or feature. Try exporting it as DXF directly from AutoCAD instead."
        : "This doesn't look like a valid DXF file. Make sure it was exported as DXF, not DWG."
    );
  }

  let result: ClassificationResult;
  let unitsResolution: UnitsResolution;
  try {
    ({ result, unitsResolution } = parseDxfFile(text, units));
  } catch (err) {
    const [model] = await db
      .insert(cadModels)
      .values({ projectId, name, sourceFileId: savedFile.id, units, status: "failed", parseError: err instanceof Error ? err.message : "Couldn't parse this DXF file.", createdBy: actor.id })
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
  const displayName = unitsOverridden ? `${name} (units auto-corrected: ${unitsResolution.requested} → ${unitsResolution.effective})` : name;

  const missingSpecs = buildMissingInputs(result);
  const [model] = await db
    .insert(cadModels)
    .values({
      projectId,
      name: displayName,
      sourceFileId: savedFile.id,
      units: unitsResolution.effective,
      status: missingSpecs.length > 0 ? "needs_info" : "ready",
      entityCounts: result.entityCounts,
      unclassifiedCount: result.unclassifiedCount,
      ignoredAnnotationCount: result.ignoredAnnotationCount,
      createdBy: actor.id,
    })
    .returning();

  if (result.entities.length > 0) {
    await db.insert(cadEntities).values(result.entities.map((e) => entityToRow(model.id, e)));
  }
  if (missingSpecs.length > 0) {
    await db.insert(cadMissingInputs).values(missingSpecs.map((s) => ({ modelId: model.id, kind: s.kind, question: s.question })));
  }

  await recordAudit({
    actor,
    action: "cad.uploaded",
    entityType: "cad_model",
    entityId: model.id,
    newState: { entityCounts: result.entityCounts, unclassifiedCount: result.unclassifiedCount, unitsResolution },
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

  await db.update(cadMissingInputs).set({ resolvedValueMm: valueMm, resolvedBy: actor.id, resolvedAt: new Date() }).where(eq(cadMissingInputs.id, inputId));

  switch (input.kind) {
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
    case "wall_default_thickness":
      await db.update(cadModels).set({ wallDefaultThicknessMm: valueMm }).where(eq(cadModels.id, modelId));
      await db
        .update(cadEntities)
        .set({ depthMm: valueMm })
        .where(and(eq(cadEntities.modelId, modelId), eq(cadEntities.type, "wall"), isNull(cadEntities.depthMm)));
      break;
  }

  const stillPending = await db.query.cadMissingInputs.findFirst({ where: and(eq(cadMissingInputs.modelId, modelId), isNull(cadMissingInputs.resolvedValueMm)) });
  if (!stillPending) {
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
