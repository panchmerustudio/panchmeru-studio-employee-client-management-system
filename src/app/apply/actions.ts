"use server";

import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { jobApplications, notifications, roles, users } from "@/db/schema";
import { saveFile } from "@/lib/storage";

const schema = z.object({
  fullName: z.string().min(2, "Enter your full name."),
  email: z.string().email("Enter a valid email address."),
  phone: z.string().min(6, "Enter a valid phone number."),
  positionAppliedFor: z.string().min(2, "Tell us which role you're applying for."),
  experienceYears: z.string().optional(),
  portfolioUrl: z.string().optional(),
  coverNote: z.string().optional(),
  // Honeypot: hidden via CSS on the page, so a real visitor never sees or fills it — a bot filling
  // every input will. Caught here and treated as a silent no-op rather than tipping the bot off.
  hp_confirm: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean };

export async function submitJobApplication(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;

  if (data.hp_confirm) return { ok: true };

  const resumeFile = formData.get("resume") as File | null;
  if (!resumeFile || resumeFile.size === 0) return { error: "Please attach your resume/CV." };

  let resumeFileId: string;
  let portfolioFileId: string | undefined;
  try {
    const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());
    const savedResume = await saveFile({
      buffer: resumeBuffer,
      originalName: resumeFile.name,
      mimeType: resumeFile.type || "application/octet-stream",
      kind: "document",
      relatedEntityType: "job_application",
    });
    resumeFileId = savedResume.id;

    const portfolioFile = formData.get("portfolioFile") as File | null;
    if (portfolioFile && portfolioFile.size > 0) {
      const portfolioBuffer = Buffer.from(await portfolioFile.arrayBuffer());
      const savedPortfolio = await saveFile({
        buffer: portfolioBuffer,
        originalName: portfolioFile.name,
        mimeType: portfolioFile.type || "application/octet-stream",
        kind: "document",
        relatedEntityType: "job_application",
      });
      portfolioFileId = savedPortfolio.id;
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't upload your file. Please check its type/size and try again." };
  }

  const [application] = await db
    .insert(jobApplications)
    .values({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      positionAppliedFor: data.positionAppliedFor,
      experienceYears: data.experienceYears ? Number(data.experienceYears) : null,
      portfolioUrl: data.portfolioUrl || null,
      coverNote: data.coverNote || null,
      resumeFileId,
      portfolioFileId,
      status: "new",
    })
    .returning();

  const owners = await db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(inArray(roles.key, ["owner"]));
  if (owners.length > 0) {
    await db.insert(notifications).values(
      owners.map((o) => ({
        recipientId: o.id,
        type: "job_application",
        title: "New job application",
        message: `${data.fullName} applied for ${data.positionAppliedFor}.`,
        relatedEntityType: "job_application",
        relatedEntityId: application.id,
      }))
    );
  }

  return { ok: true };
}
