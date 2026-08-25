import { randomUUID } from "crypto";
import { text, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column helpers — PostgreSQL dialect (production). This project
 * started on SQLite for zero-config local dev and was migrated to Postgres
 * for the live deployment; see README.md "Moving to Postgres for production"
 * for the history. Local dev now points at the same (or a separate) Postgres
 * database via DATABASE_URL — see src/db/client.ts.
 */

export function idColumn() {
  return text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());
}

export function timestamps() {
  return {
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  };
}

export function createdAtOnly() {
  return {
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  };
}
