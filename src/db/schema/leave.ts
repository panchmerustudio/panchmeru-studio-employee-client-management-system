import { boolean, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, createdAtOnly } from "./common";
import { employees } from "./employees";
import { users } from "./identity";
import { files } from "./files";

export const leaveTypes = pgTable("leave_types", {
  id: idColumn(),
  key: text("key").notNull().unique(), // "sick", "annual", ...
  name: text("name").notNull(),
  paid: boolean("paid").notNull().default(true),
  maxDaysPerYear: integer("max_days_per_year"), // studio policy: sick = 8/yr, annual = 15/yr
  active: boolean("active").notNull().default(true),
});

export const leaveRequests = pgTable("leave_requests", {
  id: idColumn(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  leaveTypeId: text("leave_type_id")
    .notNull()
    .references(() => leaveTypes.id),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  isHalfDay: boolean("is_half_day").notNull().default(false),
  reason: text("reason").notNull(),
  attachmentFileId: text("attachment_file_id").references(() => files.id),
  status: text("status", { enum: ["pending", "approved", "rejected", "cancelled"] })
    .notNull()
    .default("pending"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
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
