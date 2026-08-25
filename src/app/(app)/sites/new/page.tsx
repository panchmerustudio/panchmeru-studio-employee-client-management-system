import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { projects } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { NewSiteForm } from "./form";

export default async function NewSitePage() {
  const user = await requirePermission(PERMISSIONS.SITE_MANAGE).catch(() => null);
  if (!user) redirect("/sites");

  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Add site" subtitle="Register a new project site" />
      <NewSiteForm projects={projectRows} />
    </div>
  );
}
