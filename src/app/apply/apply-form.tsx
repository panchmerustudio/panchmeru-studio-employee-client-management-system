"use client";

import { useActionState, useRef, useState } from "react";
import { submitJobApplication, type FormState } from "./actions";
import { uploadFileDirect } from "@/lib/upload-client";
import { fileTooLarge, MAX_PUBLIC_UPLOAD_BYTES, MAX_PUBLIC_UPLOAD_LABEL } from "@/lib/upload-limits";

const initialState: FormState = {};

export function ApplyForm() {
  const [state, formAction, pending] = useActionState(submitJobApplication, initialState);
  const [uploading, setUploading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const portfolioInput = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);

    const resumeFile = resumeInput.current?.files?.[0];
    if (!resumeFile) {
      setClientError("Please attach your resume/CV.");
      return;
    }
    if (fileTooLarge(resumeFile, MAX_PUBLIC_UPLOAD_BYTES)) {
      setClientError(`Your resume is too large (max ${MAX_PUBLIC_UPLOAD_LABEL}).`);
      return;
    }
    const portfolioFile = portfolioInput.current?.files?.[0];
    if (portfolioFile && fileTooLarge(portfolioFile, MAX_PUBLIC_UPLOAD_BYTES)) {
      setClientError(`Your portfolio file is too large (max ${MAX_PUBLIC_UPLOAD_LABEL}).`);
      return;
    }

    const fd = new FormData(e.currentTarget);
    setUploading(true);
    try {
      const uploadedResume = await uploadFileDirect(resumeFile, "/api/uploads/presign-public");
      fd.set("resumeFileKey", uploadedResume.key);
      fd.set("resumeFileMimeType", uploadedResume.mimeType);
      fd.set("resumeFileOriginalName", uploadedResume.originalName);

      if (portfolioFile) {
        const uploadedPortfolio = await uploadFileDirect(portfolioFile, "/api/uploads/presign-public");
        fd.set("portfolioFileKey", uploadedPortfolio.key);
        fd.set("portfolioFileMimeType", uploadedPortfolio.mimeType);
        fd.set("portfolioFileOriginalName", uploadedPortfolio.originalName);
      }

      fd.delete("resume");
      fd.delete("portfolioFile");
      formAction(fd);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Couldn't upload your file. Please check its type/size and try again.");
    } finally {
      setUploading(false);
    }
  }

  if (state.ok) {
    return (
      <div className="card p-6 text-center shadow-sm">
        <p className="text-lg font-semibold text-foreground">Application received</p>
        <p className="mt-1 text-sm text-muted">Thanks for applying to Panchmeru Studio — we&apos;ll be in touch if it&apos;s a fit.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6 shadow-sm">
      {/* Honeypot — hidden from real visitors, left for bots that fill every field. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="hp_confirm">Leave this field blank</label>
        <input id="hp_confirm" name="hp_confirm" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Full name</label>
          <input className="input" type="text" name="fullName" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Position applying for</label>
          <input className="input" type="text" name="positionAppliedFor" placeholder="e.g. Interior Designer, Architect, Site Supervisor" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Email</label>
          <input className="input" type="email" name="email" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Phone</label>
          <input className="input" type="tel" name="phone" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Years of experience (optional)</label>
          <input className="input" type="number" min="0" step="0.5" name="experienceYears" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Portfolio link (optional)</label>
          <input className="input" type="url" name="portfolioUrl" placeholder="Behance, website, Instagram…" />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Cover note (optional)</label>
        <textarea className="input" name="coverNote" rows={3} placeholder="Tell us a bit about yourself and why you'd like to join." />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Resume / CV</label>
          <input ref={resumeInput} className="w-full text-xs" type="file" name="resume" accept=".pdf,.doc,.docx" required />
          <p className="mt-1 text-[11px] text-muted">PDF or Word, up to {MAX_PUBLIC_UPLOAD_LABEL}.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Portfolio file (optional)</label>
          <input ref={portfolioInput} className="w-full text-xs" type="file" name="portfolioFile" accept=".pdf,.doc,.docx,image/*" />
          <p className="mt-1 text-[11px] text-muted">If you don't have an online link above.</p>
        </div>
      </div>

      {(clientError || state.error) && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {clientError || state.error}
        </div>
      )}

      <button type="submit" disabled={pending || uploading} className="btn btn-accent w-full">
        {uploading ? "Uploading…" : pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
