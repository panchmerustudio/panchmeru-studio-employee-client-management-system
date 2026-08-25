import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { roles, users, employees, projects, sites, tasks, leaveRequests, auditLogs } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Diagnostic-only: reports row counts for the tables the seed script
 * populates, gated behind the same SETUP_SECRET as /api/setup/seed. Exists
 * so seeding completeness (all sections ran, not just the first one before
 * a serverless timeout) can be confirmed without going through the UI.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.SETUP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SETUP_SECRET is not configured." }, { status: 403 });
  }
  const provided = req.nextUrl.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Invalid or missing secret." }, { status: 401 });
  }

  const count = async (table: Parameters<typeof db.select>[0] extends never ? never : any) => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    return row?.n ?? 0;
  };

  try {
    const [rolesN, usersN, employeesN, projectsN, sitesN, tasksN, leaveN, auditN] = await Promise.all([
      count(roles),
      count(users),
      count(employees),
      count(projects),
      count(sites),
      count(tasks),
      count(leaveRequests),
      count(auditLogs),
    ]);
    return NextResponse.json({
      roles: rolesN,
      users: usersN,
      employees: employeesN,
      projects: projectsN,
      sites: sitesN,
      tasks: tasksN,
      leaveRequests: leaveN,
      auditLogs: auditN,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
