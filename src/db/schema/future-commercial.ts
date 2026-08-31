import { pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { projects } from "./projects";
import { sites } from "./sites";
import { files } from "./files";
import { clients } from "./future-client";

/**
 * FUTURE — COMMERCIAL MODULES (section 4, 52). Kept minimal but real:
 * enough structure that Quotations/Estimates/BOQ/Contracts/Invoices/
 * Payments/Expenses/Vendors can be switched on later behind feature
 * flags without a schema redesign. Inactive and unreferenced by the
 * current UI.
 */

export const quotations = pgTable("quotations", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  quotationNumber: text("quotation_number").notNull(),
  amount: real("amount"),
  status: text("status", { enum: ["draft", "sent", "accepted", "rejected", "expired"] })
    .notNull()
    .default("draft"),
  fileId: text("file_id").references(() => files.id),
  createdBy: text("created_by").references(() => users.id),
  ...timestamps(),
});

export const estimates = pgTable("estimates", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  amount: real("amount"),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const boqs = pgTable("boqs", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const contracts = pgTable("contracts", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  title: text("title").notNull(),
  value: real("value"),
  signedDate: timestamp("signed_date"),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const invoices = pgTable("invoices", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  invoiceNumber: text("invoice_number").notNull(),
  amount: real("amount").notNull(),
  dueDate: timestamp("due_date"),
  status: text("status", { enum: ["draft", "sent", "partially_paid", "paid", "overdue"] })
    .notNull()
    .default("draft"),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const payments = pgTable("payments", {
  id: idColumn(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amount: real("amount").notNull(),
  paidAt: timestamp("paid_at").notNull(),
  method: text("method"),
  reference: text("reference"),
  ...createdAtOnly(),
});

export const expenses = pgTable("expenses", {
  id: idColumn(),
  projectId: text("project_id").references(() => projects.id),
  siteId: text("site_id").references(() => sites.id),
  category: text("category"),
  amount: real("amount").notNull(),
  incurredAt: timestamp("incurred_at").notNull(),
  note: text("note"),
  receiptFileId: text("receipt_file_id").references(() => files.id),
  createdBy: text("created_by").references(() => users.id),
  ...createdAtOnly(),
});

export const vendors = pgTable("vendors", {
  id: idColumn(),
  name: text("name").notNull(),
  category: text("category"), // trade, e.g. "Electrician" — see VENDOR_TRADE_CATEGORIES in app/(app)/vendors/actions.ts
  mobile: text("mobile"),
  email: text("email"),
  address: text("address"),
  rating: real("rating"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  ...timestamps(),
});
