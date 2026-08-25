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
 *
 * The `postgres` client below is lazy — it doesn't open a connection until
 * the first query — so we deliberately don't throw here if DATABASE_URL is
 * missing. Throwing at module-load time breaks `next build`, which
 * imports every route module to collect its config even though it never
 * runs a query. A missing DATABASE_URL will still fail loudly, just at the
 * first real database call instead of at build time.
 */
if (!process.env.DATABASE_URL) {
  console.warn(
    'DATABASE_URL is not set. Set it to a Postgres connection string (see README.md "Moving to Postgres for production") — any database call will fail until it is.'
  );
}

const client = postgres(process.env.DATABASE_URL ?? "postgres://unset:unset@localhost:5432/unset", { prepare: false });

export const db = drizzle(client, { schema });
export type DB = typeof db;
