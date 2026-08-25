import { randomUUID } from "crypto";
import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Shared column helpers.
 *
 * PORTABILITY NOTE: this project runs on SQLite for zero-config local dev.
 * To move to PostgreSQL (e.g. a free Supabase/Neon project) for production:
 *   - swap `drizzle-orm/sqlite-core` imports for `drizzle-orm/pg-core`
 *   - `text('id')` -> `uuid('id')` (or keep text, both work)
 *   - `integer({ mode: 'timestamp' })` -> `timestamp()`
 *   - `integer({ mode: 'boolean' })` -> `boolean()`
 *   - `text({ mode: 'json' })` -> `jsonb()`
 * The schema is intentionally written in a dialect-light style to make that
 * migration mechanical. See README.md "Moving to Postgres for production".
 */

export function idColumn() {
  return text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());
}

export function timestamps() {
  return {
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  };
}

export function createdAtOnly() {
  return {
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  };
}
