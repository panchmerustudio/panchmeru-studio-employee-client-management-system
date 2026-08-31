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
  } catch {
    throw new Error("Couldn't start the DWG conversion. Please try again.");
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
