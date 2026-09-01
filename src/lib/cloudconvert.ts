import "server-only";
import CloudConvert from "cloudconvert";

/**
 * DWG -> DXF conversion, so the CAD importer (src/lib/dxf) can keep working
 * purely on text-based DXF the way it always has. DWG is Autodesk's
 * proprietary binary format — there's no reliable open-source way to parse
 * it server-side, so this hands the file to CloudConvert (a third-party
 * conversion API) and gets back plain DXF text.
 *
 * Uses CloudConvert's async job API (create -> poll -> export/url), NOT
 * their `jobs.wait()` SDK helper, which calls a "sync" endpoint CloudConvert
 * itself warns against for anything but very short jobs (it can time out
 * the underlying connection for a slow conversion). Polling our own way
 * avoids that, and lets us give a clear, bounded timeout instead of an
 * opaque network error.
 *
 * Requires CLOUDCONVERT_API_KEY (free tier: 10 conversions/day, no card
 * required — see https://cloudconvert.com/dashboard/api/v2/keys).
 */

function assertCloudConvertConfigured() {
  if (!process.env.CLOUDCONVERT_API_KEY) {
    throw new Error(
      "DWG conversion isn't configured on the server (missing CLOUDCONVERT_API_KEY). Set it in Vercel → Settings → Environment Variables, then redeploy — adding/editing env vars doesn't affect deployments already running."
    );
  }
}

/**
 * The SDK is a thin axios wrapper with no custom error type of its own, so
 * a failed request surfaces as a raw axios error — `err.response.status` +
 * `err.response.data` (CloudConvert's own JSON error body) when the request
 * reached the server, or just `err.message` (e.g. a DNS/network failure)
 * when it never did. Pulls out whatever's actually useful instead of
 * letting a generic "Couldn't start..." hide it.
 */
function describeCloudConvertError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const response = "response" in err ? (err as { response?: unknown }).response : undefined;
  let status: number | undefined;
  let bodyMessage: string | undefined;
  if (response && typeof response === "object") {
    if ("status" in response && typeof (response as { status?: unknown }).status === "number") {
      status = (response as { status: number }).status;
    }
    const data = "data" in response ? (response as { data?: unknown }).data : undefined;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.message === "string") bodyMessage = d.message;
      else if (Array.isArray(d.errors) && d.errors.length > 0) {
        const first = d.errors[0] as unknown;
        if (typeof first === "string") bodyMessage = first;
        else if (first && typeof first === "object") {
          const f = first as Record<string, unknown>;
          bodyMessage = (typeof f.detail === "string" && f.detail) || (typeof f.title === "string" && f.title) || undefined;
        }
      }
    }
  }
  if (status === 401 || status === 403) return "the CloudConvert API key was rejected (invalid, expired, or revoked)";
  if (status) return `CloudConvert returned HTTP ${status}${bodyMessage ? ` — ${bodyMessage}` : ""}`;
  if (bodyMessage) return bodyMessage;
  if ("message" in err && typeof (err as { message?: unknown }).message === "string") return (err as { message: string }).message;
  return null;
}

const POLL_INTERVAL_MS = 4000;
// Comfortably under Vercel's own 300s function ceiling on Hobby (Fluid
// compute), leaving headroom to return our own clear timeout error instead
// of the platform killing the request with a bare 504.
const MAX_WAIT_MS = 4 * 60 * 1000;

export async function convertDwgToDxf(opts: { sourceUrl: string; filename: string }): Promise<string> {
  assertCloudConvertConfigured();
  const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY!);

  let job;
  try {
    job = await cloudConvert.jobs.create({
      tasks: {
        "import-file": { operation: "import/url", url: opts.sourceUrl, filename: opts.filename },
        "convert-file": { operation: "convert", input: "import-file", input_format: "dwg", output_format: "dxf", timeout: 180 },
        "export-file": { operation: "export/url", input: "convert-file" },
      },
    });
  } catch (err) {
    // This wraps the request that CREATES the job (before any conversion
    // even starts) — a failure here almost always means the API key itself
    // is wrong/expired/revoked (a 401/403 from CloudConvert) or the request
    // never reached them at all (DNS/network), not a conversion problem.
    // Swallowing the real cause into one generic message made this
    // undiagnosable from the outside — surface CloudConvert's own status
    // code/response body (or the raw error) both to the caller and to the
    // server logs so a real failure (bad/expired key, wrong scope, network
    // block) is visible instead of always looking like a retry-and-hope.
    const detail = describeCloudConvertError(err);
    console.error("[cloudconvert] jobs.create failed:", detail, err);
    throw new Error(`Couldn't start the DWG conversion${detail ? `: ${detail}` : ""}. Please try again, or check the CLOUDCONVERT_API_KEY is still valid in the CloudConvert dashboard.`);
  }

  const startedAt = Date.now();
  let current = job;
  while (current.status !== "finished" && current.status !== "error") {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error("This DWG is taking too long to convert. Try a simpler/smaller drawing, split it by floor, or export it as DXF directly from AutoCAD instead.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await cloudConvert.jobs.get(job.id);
  }

  if (current.status === "error") {
    const failedTask = current.tasks.find((t) => t.status === "error");
    const detail = failedTask?.message ?? undefined;
    if (detail && /credit|quota|limit/i.test(detail)) {
      throw new Error("Today's free DWG conversion limit has been reached. Try again tomorrow, or export this drawing as DXF from AutoCAD instead.");
    }
    throw new Error(detail ? `Couldn't convert this DWG file: ${detail}` : "Couldn't convert this DWG file. It may be corrupted, password-protected, or an unsupported DWG version — try exporting it as DXF from AutoCAD instead.");
  }

  const [exported] = cloudConvert.jobs.getExportUrls(current);
  if (!exported?.url) throw new Error("The DWG conversion finished but produced no output file.");

  const res = await fetch(exported.url);
  if (!res.ok) throw new Error("Couldn't download the converted DXF file.");
  return await res.text();
}
