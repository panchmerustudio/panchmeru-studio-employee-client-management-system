import type { Metadata } from "next";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = {
  title: "Careers — Panchmeru Studio",
  description: "Apply for a role at Panchmeru Studio.",
};

/** Public, no-login careers/application page — see actions.ts for where submissions go. */
export default function ApplyPage() {
  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-ink text-xl font-bold text-white">PS</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Join Panchmeru Studio</h1>
          <p className="mt-1 text-sm text-muted">Tell us a bit about yourself — we review every application.</p>
        </div>
        <ApplyForm />
      </div>
    </div>
  );
}
