import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { checkoutSiteVisit, SiteVisitError } from "@/lib/site-visit-service";
import { saveVoiceNote } from "@/lib/voice";

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!user.employeeId) return NextResponse.json({ error: "No employee profile linked to your account." }, { status: 400 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const siteVisitId = String(form.get("siteVisitId") || "");
  const latitude = Number(form.get("latitude"));
  const longitude = Number(form.get("longitude"));
  const accuracy = Number(form.get("accuracy"));
  const address = (form.get("address") as string) || null;
  const authMethod = (String(form.get("authMethod") || "password_session")) as "password_session" | "webauthn";
  const clientEventId = String(form.get("clientEventId") || "");
  if (!siteVisitId || !clientEventId || Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(accuracy)) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  let voiceNoteId: string | undefined;
  const voiceFile = form.get("voice") as File | null;
  if (voiceFile && voiceFile.size > 0) {
    const note = await saveVoiceNote({
      file: voiceFile,
      transcript: (form.get("transcript") as string) || null,
      durationSeconds: form.get("duration") ? Number(form.get("duration")) : null,
      recordedBy: user.id,
    });
    voiceNoteId = note.id;
  }

  try {
    const { report, visit } = await checkoutSiteVisit({
      actor: user,
      employeeId: user.employeeId,
      siteVisitId,
      latitude,
      longitude,
      accuracy,
      address,
      authMethod,
      clientEventId,
      report: {
        workCompleted: (form.get("workCompleted") as string) || undefined,
        discussion: (form.get("discussion") as string) || undefined,
        issues: (form.get("issues") as string) || undefined,
        materialRequirement: (form.get("materialRequirement") as string) || undefined,
        nextAction: (form.get("nextAction") as string) || undefined,
        voiceNoteId,
      },
    });
    return NextResponse.json({ ok: true, report, visit });
  } catch (err) {
    if (err instanceof SiteVisitError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Couldn't check out. Please try again." }, { status: 500 });
  }
}
