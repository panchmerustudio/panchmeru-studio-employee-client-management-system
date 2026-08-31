import { boolean, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { projects } from "./projects";
import { clients } from "./future-client";
import { files } from "./files";

/**
 * CLIENT PAYMENTS (sections 27-35). Deliberately NOT full accounting — no
 * ledger, no tax, no reconciliation, no invoices. A total project fee, a
 * handful of milestones against it, and a record of what's actually been
 * paid. Kept entirely separate from future-commercial.ts's invoice-based
 * quotations/estimates/boqs/contracts/invoices/payments chain — that
 * models a heavier BOQ->contract->invoice workflow this module doesn't
 * need, and stays untouched/still-inactive.
 *
 * Visibility is the whole point here (section 33): a client sees only
 * their own project(s) (gated by requireClient() + clientId match, same
 * as every other client-portal query); vendors and employees never see
 * any of this by default — nothing in the vendor portal or the general
 * staff-facing project/document pages queries these tables at all, only
 * PERMISSIONS.CLIENT_MANAGE-gated routes under /clients/[id]/payments do.
 */

/** One row per project — the per-project ON/OFF switch (section 34) plus the total fee it's tracked against. */
export const projectPaymentSettings = pgTable("project_payment_settings", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  totalFeeAmount: real("total_fee_amount"),
  currency: text("currency").notNull().default("INR"),
  ...timestamps(),
});

/** A configurable slice of the total fee (section 28) — "Booking Advance", "On Site Handover", etc. */
export const paymentMilestones = pgTable("payment_milestones", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  dueDate: timestamp("due_date"),
  sequenceOrder: integer("sequence_order").notNull().default(0),
  createdBy: text("created_by").references(() => users.id),
  ...createdAtOnly(),
});

/** What actually got paid (section 29) — optionally tied to a milestone, always tied to a project+client. */
export const paymentRecords = pgTable("payment_records", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  milestoneId: text("milestone_id").references(() => paymentMilestones.id, { onDelete: "set null" }),
  amount: real("amount").notNull(),
  paidDate: timestamp("paid_date").notNull(),
  mode: text("mode", { enum: ["cash", "cheque", "bank_transfer", "upi", "card", "other"] })
    .notNull()
    .default("bank_transfer"),
  reference: text("reference"),
  receiptFileId: text("receipt_file_id").references(() => files.id),
  notes: text("notes"),
  recordedByUserId: text("recorded_by_user_id")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});
