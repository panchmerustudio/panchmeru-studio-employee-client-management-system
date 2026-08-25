import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { BoundaryCapture } from "./boundary-capture";

export default async function BoundaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.SITE_VISIT) && !user.permissions.includes(PERMISSIONS.SITE_MANAGE)) redirect(`/sites/${id}`);

  const site = await db.query.sites.findFirst({ where: eq(sites.id, id) });
  if (!site) notFound();

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Map site boundary" subtitle={site.name} />
      <BoundaryCapture siteId={id} />
    </div>
  );
}
