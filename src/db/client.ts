import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Production/shared database — PostgreSQL via `DATABASE_URL` (a free
 * Supabase or Neon project works well). This project started on SQLite
 * for zero-config local dev; see README.md "Moving to Postgres for
 * production" for that history. Local dev now points at a Postgres
 * database too (the same one, or a separate free project) via the same
 * env var, so there is only ever one code path.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Set it to a Postgres connection string (see README.md \"Moving to Postgres for production\")."
  );
}

const client = postgres(process.env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
export type DB = typeof db;
