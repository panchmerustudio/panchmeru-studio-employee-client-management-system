import { redirect } from "next/navigation";
import { getCurrentVendor } from "@/lib/vendor-auth";
import { getVendorDrawings } from "@/lib/vendor-portal";
import { PageHeader, EmptyState } from "@/components/ui";
import { LogoutButton } from "../logout-button";
import { VendorNav } from "../vendor-nav";
import { DrawingLibrary } from "./drawing-library";

export default async function VendorDrawingsPage() {
  const vendor = await getCurrentVendor();
  if (!vendor) redirect("/vendor/login");

  const drawings = await getVendorDrawings(vendor.vendorId);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title="Drawings" subtitle={`${drawings.length} drawing${drawings.length === 1 ? "" : "s"} in your assigned categories`} action={<LogoutButton />} />

      {drawings.length === 0 ? (
        <EmptyState icon="file" title="Nothing here yet" subtitle="Drawings in your assigned project(s) and category(ies) will appear here as they're uploaded." />
      ) : (
        <DrawingLibrary drawings={drawings} />
      )}

      <VendorNav active="/vendor/drawings" />
    </div>
  );
}
