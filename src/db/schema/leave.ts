import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn, createdAtOnly } from "./common";
import { employees } from "./employees";
import { users } from "./identity";
import { files } from "./files";

export const leaveTypes = sqliteTable("leave_types", {
  id: idColumn(),
  key: text("key").notNull().unique(), // "sick", "annual", ...
  name: text("name").notNull(),
  paid: integer("paid", { mode: "boolean" }).notNull().default(true),
  maxDaysPerYear: integer("max_days_per_year"), // studio policy: sick = 8/yr, annual = 15/yr
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const leaveRequests = sqliteTable("leave_requests", {
  id: idColumn(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  leaveTypeId: text("leave_type_id")
    .notNull()
    .references(() => leaveTypes.id),
  startDate: integer("start_date", { mode: "timestamp" }).notNull(),
  endDate: integer("end_date", { mode: "timestamp" }).notNull(),
  isHalfDay: integer("is_half_day", { mode: "boolean" }).notNull().default(false),
  reason: text("reason").notNull(),
  attachmentFileId: text("attachment_file_id").references(() => files.id),
  status: text("status", { enum: ["pending", "approved", "rejected", "cancelled"] })
    .notNull()
    .default("pending"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  reviewComment: text("review_comment"),

  // Days requested, counted at apply time (half day = 0.5). paidDays/unpaidDays/
  // deductionAmount are only ever finalized at approval time, against the
  // employee's remaining balance for that leave type/year — see
  // src/lib/leave-policy.ts. Null until reviewed.
  workingDays: real("working_days").notNull().default(0),
  paidDays: real("paid_days"),
  unpaidDays: real("unpaid_days"),
  deductionAmount: real("deduction_amount"),
  ...createdAtOnly(),
});
