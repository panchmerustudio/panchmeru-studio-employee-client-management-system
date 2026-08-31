import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { vendorActivities } from "@/db/schema";
import { getCurrentVendor } from "@/lib/vendor-auth";
import { getVendorDrawingByVersionId } from "@/lib/vendor-portal";
import { PageHeader } from "@/components/ui";
import { ProtectedViewer } from "@/components/protected-viewer";
import { LogoutButton } from "../../logout-button";
import { VendorNav } from "../../vendor-nav";

export default async function VendorDrawingPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const vendor = await getCurrentVendor();
  if (!vendor) redirect("/vendor/login");

  const drawing = await getVendorDrawingByVersionId(vendor.vendorId, versionId);
  if (!drawing) notFound();

  await db.insert(vendorActivities).values({
    vendorId: vendor.vendorId,
    activityType: "viewed_drawing",
    description: `Viewed ${drawing.documentName} (v${drawing.versionNumber}).`,
    relatedEntityType: "document_version",
    relatedEntityId: drawing.versionId,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title={drawing.documentName} subtitle={`Version ${drawing.versionNumber} · ${drawing.categoryName ?? "Uncategorized"}`} action={<LogoutButton />} />

      <ProtectedViewer
        fileId={drawing.fileId}
        mimeType={drawing.mimeType}
        originalName={drawing.documentName}
        watermarkLines={[vendor.vendorName, vendor.email]}
        downloadHref={`/api/files/${drawing.fileId}?download=1`}
      />

      <VendorNav active="/vendor/drawings" />
    </div>
  );
}
