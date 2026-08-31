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
import { registerUploadedFile, readStoredFile } from "@/lib/storage";
import { parseDxfFile, looksLikeDxf, type CadUnits } from "@/lib/dxf";
import type { ClassificationResult, ClassifiedEntity } from "@/lib/dxf/classify";

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
  if (!fileKey || !fileOriginalName) throw new Error("Choose and upload a DXF file first.");
  if (!fileOriginalName.toLowerCase().endsWith(".dxf")) throw new Error("Only DXF files are supported right now — export/save-as DXF from AutoCAD first.");

  const savedFile = await registerUploadedFile({
    key: fileKey,
    originalName: fileOriginalName,
    mimeType: "application/dxf",
    kind: "drawing",
    uploadedBy: actor.id,
    relatedEntityType: "cad_model",
  });

  const buffer = await readStoredFile(fileKey);
  const text = buffer.toString("utf-8");
  if (!looksLikeDxf(text)) throw new Error("This doesn't look like a valid DXF file. Make sure it was exported as DXF, not DWG.");

  let result: ClassificationResult;
  let parseError: string | null = null;
  try {
    result = parseDxfFile(text, units);
  } catch (err) {
    const [model] = await db
      .insert(cadModels)
      .values({ projectId, name, sourceFileId: savedFile.id, units, status: "failed", parseError: err instanceof Error ? err.message : "Couldn't parse this DXF file.", createdBy: actor.id })
      .returning();
    await recordAudit({ actor, action: "cad.upload_failed", entityType: "cad_model", entityId: model.id, newState: { error: model.parseError } });
    revalidatePath(`/projects/${projectId}/cad`);
    return model;
  }

  const missingSpecs = buildMissingInputs(result);
  const [model] = await db
    .insert(cadModels)
    .values({
      projectId,
      name,
      sourceFileId: savedFile.id,
      units,
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

  await recordAudit({ actor, action: "cad.uploaded", entityType: "cad_model", entityId: model.id, newState: { entityCounts: result.entityCounts, unclassifiedCount: result.unclassifiedCount } });
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
