import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema";

/**
 * Local dev database (SQLite file at project root, gitignored).
 *
 * PRODUCTION: set DATABASE_URL to a Postgres connection string (a free
 * Supabase or Neon project works well) and swap this file's contents for
 * the `drizzle-orm/postgres-js` client — see README.md "Moving to
 * Postgres for production" for the exact two-file change needed
 * (this file + drizzle.config.ts). Nothing in src/db/schema or the rest
 * of the app needs to change.
 */
const sqlite = new Database(path.join(process.cwd(), "panchmeru.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
