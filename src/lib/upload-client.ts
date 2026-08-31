"use client";

/**
 * Browser-side half of the direct-to-R2 upload (see storage.ts for the
 * server half). Call this instead of shipping the raw File to a server
 * action — it asks the server for a short-lived presigned URL, PUTs the
 * bytes straight to R2 from the browser (never touching this app's own
 * server, so Vercel's 4.5MB request-body limit doesn't apply), and
 * returns a small descriptor. Pass that descriptor's fields to whatever
 * server action finalizes the upload (it calls registerUploadedFile()).
 */
export type UploadedFileDescriptor = {
  key: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
};

export async function uploadFileDirect(
  file: File,
  presignEndpoint: string = "/api/uploads/presign",
  // Browsers often report no MIME type (or a wrong/generic one) for
  // formats they don't natively recognize, e.g. .dxf frequently comes
  // through as "" or "application/octet-stream" — pass the format's real
  // MIME type explicitly in those cases rather than trusting file.type.
  mimeTypeOverride?: string
): Promise<UploadedFileDescriptor> {
  const mimeType = mimeTypeOverride || file.type || "application/octet-stream";

  const presignRes = await fetch(presignEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType, originalName: file.name, sizeBytes: file.size }),
  });
  if (!presignRes.ok) {
    const data = await presignRes.json().catch(() => null);
    throw new Error(data?.error || "Couldn't prepare this upload.");
  }
  const { uploadUrl, key } = (await presignRes.json()) as { uploadUrl: string; key: string };

  const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: file });
  if (!putRes.ok) {
    throw new Error("Uploading the file failed — check your connection and try again.");
  }

  return { key, mimeType, originalName: file.name, sizeBytes: file.size };
}
