import { redirect } from "next/navigation";
import { getCurrentVendor } from "@/lib/vendor-auth";
import { getVendorDrawings, getVendorScope } from "@/lib/vendor-portal";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { LogoutButton } from "./logout-button";
import { VendorNav } from "./vendor-nav";
import { DrawingCard } from "./drawing-card";

export default async function VendorHomePage() {
  const vendor = await getCurrentVendor();
  if (!vendor) redirect("/vendor/login");

  const scope = await getVendorScope(vendor.vendorId);
  const drawings = await getVendorDrawings(vendor.vendorId);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title={vendor.vendorName} subtitle={vendor.category ? `${vendor.category} · signed in as ${vendor.email}` : vendor.email} action={<LogoutButton />} />

      {scope.projectIds.length === 0 || scope.categoryIds.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Not set up yet"
          subtitle="The studio hasn't assigned you to a project or granted a drawing category yet. Once they do, drawings for your trade will show up here."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Assigned projects" value={scope.projectIds.length} icon="briefcase" />
            <StatCard label="Drawing categories" value={scope.categoryIds.length} icon="folder" />
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Latest drawings</h2>
            {drawings.length === 0 ? (
              <EmptyState icon="file" title="No drawings yet" subtitle="Nothing has been uploaded to your category on this project yet — check back later." />
            ) : (
              <div className="space-y-2">
                {drawings.slice(0, 6).map((d) => (
                  <DrawingCard key={d.versionId} drawing={d} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <VendorNav active="/vendor" />
    </div>
  );
}
