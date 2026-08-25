"use client";

import { useActionState } from "react";
import { submitJobApplication, type FormState } from "./actions";

const initialState: FormState = {};

export function ApplyForm() {
  const [state, formAction, pending] = useActionState(submitJobApplication, initialState);

  if (state.ok) {
    return (
      <div className="card p-6 text-center shadow-sm">
        <p className="text-lg font-semibold text-foreground">Application received</p>
        <p className="mt-1 text-sm text-muted">Thanks for applying to Panchmeru Studio — we&apos;ll be in touch if it&apos;s a fit.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-4 p-6 shadow-sm">
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
          <input className="w-full text-xs" type="file" name="resume" accept=".pdf,.doc,.docx" required />
          <p className="mt-1 text-[11px] text-muted">PDF or Word, up to 25MB.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Portfolio file (optional)</label>
          <input className="w-full text-xs" type="file" name="portfolioFile" accept=".pdf,.doc,.docx,image/*" />
          <p className="mt-1 text-[11px] text-muted">If you don't have an online link above.</p>
        </div>
      </div>

      {state.error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
