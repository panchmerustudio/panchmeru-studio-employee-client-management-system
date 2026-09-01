import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { cadModels, cadEntities, cadMissingInputs, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatDateTime } from "@/lib/format";
import { MissingInfoForm } from "./missing-info-form";
import { ModelViewerClient } from "./model-viewer-client";
import { DeleteModelButton } from "./delete-model-button";

const TYPE_LABELS: Record<string, string> = {
  wall: "Walls",
  door: "Doors",
  window: "Windows",
  column: "Columns",
  furniture: "Furniture",
  room: "Rooms",
  stair: "Stairs",
  unclassified: "Unclassified",
  elevation_panel: "Elevation panel",
};

export default async function CadModelPage({ params }: { params: Promise<{ id: string; modelId: string }> }) {
  const { id, modelId } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const canCreate = user.permissions.includes(PERMISSIONS.CAD_CREATE);
  const canApprove = user.permissions.includes(PERMISSIONS.CAD_APPROVE);
  const canDownload = user.permissions.includes(PERMISSIONS.FILE_DOWNLOAD);
  if (!canCreate && !canApprove) redirect(`/projects/${id}`);

  const model = await db.query.cadModels.findFirst({ where: eq(cadModels.id, modelId) });
  if (!model || model.projectId !== id) notFound();

  const uploader = await db.query.users.findFirst({ where: eq(users.id, model.createdBy) });
  const allMissingInputs = await db.query.cadMissingInputs.findMany({ where: eq(cadMissingInputs.modelId, modelId) });
  const pendingInputs = allMissingInputs.filter((m) => m.resolvedValueMm == null);
  const resolvedInputs = allMissingInputs.filter((m) => m.resolvedValueMm != null);
  const entities = model.status === "ready" || model.status === "approved" ? await db.query.cadEntities.findMany({ where: eq(cadEntities.modelId, modelId) }) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={model.name}
        subtitle={`Uploaded by ${uploader?.name ?? "—"} · ${formatDateTime(model.createdAt)} · units: ${model.units}`}
        action={
          <div className="flex items-center gap-2">
            <Badge status={model.status} />
            <Link href={`/projects/${id}/cad`} className="btn btn-secondary">
              <Icon name="arrow-left" className="h-4 w-4" /> Back
            </Link>
            {(canCreate || canApprove) && <DeleteModelButton modelId={modelId} modelName={model.name} />}
          </div>
        }
      />

      {model.status === "failed" && (
        <SectionCard title="Couldn't parse this file">
          <p className="text-sm text-red-600">{model.parseError}</p>
          <Link href={`/projects/${id}/cad`} className="btn btn-secondary mt-3">
            Try another upload
          </Link>
        </SectionCard>
      )}

      {model.entityCounts && (
        <SectionCard title="Structured building database" action={<span className="text-xs text-muted">read directly from CAD — every dimension locked 🔒</span>}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(model.entityCounts).map(([type, count]) => (
              <span key={type} className="badge bg-slate-100 text-slate-700">
                {TYPE_LABELS[type] ?? type}: {count}
              </span>
            ))}
          </div>
          {(model.unclassifiedCount > 0 || model.ignoredAnnotationCount > 0) && (
            <p className="mt-2 text-xs text-muted">
              {model.unclassifiedCount > 0 && `${model.unclassifiedCount} entit${model.unclassifiedCount === 1 ? "y" : "ies"} couldn't be confidently classified and weren't modeled — nothing was guessed. `}
              {model.ignoredAnnotationCount > 0 && `${model.ignoredAnnotationCount} dimension/text/hatch annotations were ignored (not building geometry).`}
            </p>
          )}
        </SectionCard>
      )}

      {model.status === "needs_info" && pendingInputs.length > 0 && (
        <SectionCard title="Missing information">
          <MissingInfoForm
            modelId={modelId}
            inputs={pendingInputs.map((p) => ({ id: p.id, kind: p.kind, question: p.question, resolvedValueMm: p.resolvedValueMm, confirmed: p.resolvedBy != null }))}
            units={model.units}
            blocking={true}
          />
        </SectionCard>
      )}

      {(model.status === "ready" || model.status === "approved") && (
        <SectionCard title="3D model">
          <ModelViewerClient
            modelId={modelId}
            modelName={model.name}
            entities={entities.map((e) => ({
              id: e.id,
              type: e.type,
              layerName: e.layerName,
              label: e.label,
              geometry: e.geometry,
              widthMm: e.widthMm,
              depthMm: e.depthMm,
              heightMm: e.heightMm,
              rotationDeg: e.rotationDeg,
            }))}
            windowSillMm={model.windowSillMm ?? 900}
            canApprove={canApprove}
            canDownload={canDownload}
            status={model.status}
          />
        </SectionCard>
      )}

      {(model.status === "ready" || model.status === "approved") && resolvedInputs.length > 0 && (
        <SectionCard title="Assumed measurements" action={<span className="text-xs text-muted">not in the plan-view drawing — review and change if this one&apos;s different</span>}>
          <MissingInfoForm
            modelId={modelId}
            inputs={resolvedInputs.map((r) => ({ id: r.id, kind: r.kind, question: r.question, resolvedValueMm: r.resolvedValueMm, confirmed: r.resolvedBy != null }))}
            units={model.units}
            blocking={false}
          />
        </SectionCard>
      )}

      <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
        Approximate 3D representation generated from your CAD drawing — not a substitute for structural/professional drawings.
      </p>
    </div>
  );
}
