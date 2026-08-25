import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { projectTypes } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { NewProjectForm } from "./form";

export default async function NewProjectPage() {
  const user = await requirePermission(PERMISSIONS.SITE_MANAGE).catch(() => null);
  if (!user) redirect("/projects");

  const types = await db.select({ id: projectTypes.id, name: projectTypes.name }).from(projectTypes);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New project" subtitle="Group sites, milestones and team under one project" />
      <NewProjectForm types={types} />
    </div>
  );
}
