import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";

export const employees = sqliteTable("employees", {
  id: idColumn(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  employeeCode: text("employee_code").notNull().unique(), // e.g. PMS-0007
  photoFileId: text("photo_file_id"),
  dob: integer("dob", { mode: "timestamp" }),
  gender: text("gender"),
  mobile: text("mobile").notNull(),
  altMobile: text("alt_mobile"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pin: text("pin"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),

  // Employment
  joiningDate: integer("joining_date", { mode: "timestamp" }),
  designation: text("designation"),
  department: text("department"),
  reportingManagerId: text("reporting_manager_id"), // self-FK, see relations.ts
  employmentType: text("employment_type", {
    enum: ["full_time", "part_time", "contract", "intern"],
  }).default("full_time"),
  branch: text("branch"),
  status: text("status", { enum: ["active", "on_leave", "exited"] })
    .notNull()
    .default("active"),
  exitDate: integer("exit_date", { mode: "timestamp" }),

  // Payroll. Nullable — set by owner/manager, never shown to the employee's
  // peers. Used only to compute the per-day loss-of-pay deduction when
  // approved leave exceeds the employee's annual allocation (see
  // src/lib/leave-policy.ts). A monthly figure divided by 30 is the
  // standard convention used here; swap in a real payroll calendar before
  // this becomes the system of record for actual pay runs.
  monthlySalary: real("monthly_salary"),

  onboardingCompletedAt: integer("onboarding_completed_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const employeeDocuments = sqliteTable("employee_documents", {
  id: idColumn(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  docType: text("doc_type", {
    enum: ["identity", "pan", "resume", "qualification", "experience", "bank_details", "joining_document", "other"],
  }).notNull(),
  fileId: text("file_id").notNull(),
  number: text("number"), // e.g. PAN number, ID number (kept minimal, not validated as sensitive-store)
  issuedDate: integer("issued_date", { mode: "timestamp" }),
  expiryDate: integer("expiry_date", { mode: "timestamp" }),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  uploadedBy: text("uploaded_by").references(() => users.id),
  ...createdAtOnly(),
});
