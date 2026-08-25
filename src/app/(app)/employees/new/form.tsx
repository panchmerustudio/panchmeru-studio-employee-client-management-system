"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createEmployee, type FormState } from "../actions";
import { PageHeader, SectionCard } from "@/components/ui";
import { Icon } from "@/components/icon";

const initialState: FormState = {};

export function NewEmployeeForm() {
  const [state, formAction, pending] = useActionState(createEmployee, initialState);

  if (state.ok && state.tempPassword) {
    return (
      <div className="mx-auto max-w-md">
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="check-circle" className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold">Employee added</h2>
            <p className="text-sm text-muted">Share this temporary password with them — they&apos;ll be asked to change it on first login.</p>
            <div className="rounded-lg border border-border bg-background px-4 py-2 font-mono text-base">{state.tempPassword}</div>
            <div className="mt-2 flex gap-2">
              <Link href="/employees" className="btn btn-secondary">Back to employees</Link>
              <Link href="/employees/new" className="btn btn-primary">Add another</Link>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Add employee" subtitle="Onboard a new team member" />
      <form action={formAction} className="card space-y-4 p-5">
        <Field label="Full name" name="name" required placeholder="Ankit Sharma" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile" name="mobile" required placeholder="98765xxxxx" />
          <Field label="Email" name="email" type="email" placeholder="name@panchmeru.studio" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation" name="designation" placeholder="Interior Designer" />
          <Field label="Department" name="department" placeholder="Design" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" name="city" placeholder="Ludhiana" />
          <div>
            <label className="mb-1.5 block text-sm font-medium">Employment type</label>
            <select name="employmentType" className="input" defaultValue="full_time">
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Role</label>
            <select name="roleKey" className="input" defaultValue="employee">
              <option value="employee">Employee</option>
              <option value="supervisor">Site Supervisor</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Monthly salary (₹)</label>
            <input className="input" type="number" min="0" step="1" name="monthlySalary" placeholder="35000" />
          </div>
        </div>
        <p className="text-xs text-muted">
          Salary is only visible to owners/managers — it&apos;s used to calculate the per-day deduction if approved leave exceeds the 8 sick + 15 annual day allocation.
        </p>

        {state.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}

        <button type="submit" disabled={pending} className="btn btn-accent w-full">
          {pending ? "Adding…" : "Add employee"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, name, type = "text", required, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <input className="input" type={type} name={name} required={required} placeholder={placeholder} />
    </div>
  );
}
