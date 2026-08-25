import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { documentCategories, projects, sites } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { NewDocumentForm } from "./form";

export default async function NewDocumentPage() {
  const user = await requirePermission(PERMISSIONS.DOCUMENT_UPLOAD).catch(() => null);
  if (!user) redirect("/documents");

  const categories = await db.select().from(documentCategories);
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects);
  const siteRows = await db.select({ id: sites.id, name: sites.name }).from(sites);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Upload document" subtitle="Drawings, working documents, and other project files" />
      <NewDocumentForm categories={categories} projects={projectRows} sites={siteRows} />
    </div>
  );
}
