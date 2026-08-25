import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn, createdAtOnly } from "./common";
import { users } from "./identity";
import { sites } from "./sites";
import { files } from "./files";

export const materialRequests = sqliteTable("material_requests", {
  id: idColumn(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  requestedBy: text("requested_by")
    .notNull()
    .references(() => users.id),
  requiredDate: integer("required_date", { mode: "timestamp" }),
  reason: text("reason"),
  status: text("status", {
    enum: ["pending", "approved", "rejected", "ordered", "received"],
  })
    .notNull()
    .default("pending"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  reviewComment: text("review_comment"),
  ...createdAtOnly(),
});

export const materialRequestItems = sqliteTable("material_request_items", {
  id: idColumn(),
  materialRequestId: text("material_request_id")
    .notNull()
    .references(() => materialRequests.id, { onDelete: "cascade" }),
  materialName: text("material_name").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull(),
  photoFileId: text("photo_file_id").references(() => files.id),
});
