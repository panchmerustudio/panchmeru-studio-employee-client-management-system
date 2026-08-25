import { notFound, redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, siteVisits, webauthnCredentials } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ActiveVisit } from "./active-visit";

export default async function SiteVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.employeeId) redirect(`/sites/${id}`);

  const site = await db.query.sites.findFirst({ where: eq(sites.id, id) });
  if (!site) notFound();

  const visit = await db.query.siteVisits.findFirst({
    where: and(eq(siteVisits.siteId, id), eq(siteVisits.employeeId, user.employeeId), eq(siteVisits.status, "active")),
  });
  if (!visit) redirect(`/sites/${id}`);

  const cred = await db.query.webauthnCredentials.findFirst({ where: eq(webauthnCredentials.userId, user.id) });

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={site.name} subtitle={site.city} />
      <ActiveVisit siteId={id} siteVisitId={visit.id} siteName={site.name} hasBiometric={!!cred} startedAt={visit.startedAt.toISOString()} />
    </div>
  );
}
