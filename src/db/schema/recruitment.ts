import { pgTable, real, text } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./common";
import { files } from "./files";
import { users } from "./identity";

/**
 * Submitted from the public, no-login /apply page — see
 * src/app/apply/actions.ts. Nothing here requires an authenticated
 * `users` row for the applicant (there isn't one); resumeFileId /
 * portfolioFileId point at files uploaded anonymously (files.uploadedBy
 * is nullable specifically to allow this — see files.ts).
 */
export const jobApplications = pgTable("job_applications", {
  id: idColumn(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  positionAppliedFor: text("position_applied_for").notNull(),
  experienceYears: real("experience_years"),
  portfolioUrl: text("portfolio_url"), // e.g. Behance/website link, in addition to (or instead of) an uploaded file
  coverNote: text("cover_note"),
  resumeFileId: text("resume_file_id").references(() => files.id),
  portfolioFileId: text("portfolio_file_id").references(() => files.id),
  status: text("status", { enum: ["new", "reviewing", "shortlisted", "rejected", "hired"] })
    .notNull()
    .default("new"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewNote: text("review_note"),
  ...timestamps(),
});
