import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

export const quotations = sqliteTable("quotations", {
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

export const estimates = sqliteTable("estimates", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  amount: real("amount"),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const boqs = sqliteTable("boqs", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const contracts = sqliteTable("contracts", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  title: text("title").notNull(),
  value: real("value"),
  signedDate: integer("signed_date", { mode: "timestamp" }),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const invoices = sqliteTable("invoices", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  invoiceNumber: text("invoice_number").notNull(),
  amount: real("amount").notNull(),
  dueDate: integer("due_date", { mode: "timestamp" }),
  status: text("status", { enum: ["draft", "sent", "partially_paid", "paid", "overdue"] })
    .notNull()
    .default("draft"),
  fileId: text("file_id").references(() => files.id),
  ...timestamps(),
});

export const payments = sqliteTable("payments", {
  id: idColumn(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amount: real("amount").notNull(),
  paidAt: integer("paid_at", { mode: "timestamp" }).notNull(),
  method: text("method"),
  reference: text("reference"),
  ...createdAtOnly(),
});

export const expenses = sqliteTable("expenses", {
  id: idColumn(),
  projectId: text("project_id").references(() => projects.id),
  siteId: text("site_id").references(() => sites.id),
  category: text("category"),
  amount: real("amount").notNull(),
  incurredAt: integer("incurred_at", { mode: "timestamp" }).notNull(),
  note: text("note"),
  receiptFileId: text("receipt_file_id").references(() => files.id),
  createdBy: text("created_by").references(() => users.id),
  ...createdAtOnly(),
});

export const vendors = sqliteTable("vendors", {
  id: idColumn(),
  name: text("name").notNull(),
  category: text("category"),
  mobile: text("mobile"),
  email: text("email"),
  address: text("address"),
  rating: real("rating"),
  ...timestamps(),
});
