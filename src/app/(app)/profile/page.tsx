import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq, and, isNull, gt, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { userSessions, webauthnCredentials, employees } from "@/db/schema";
import { requireUser, SESSION_COOKIE_NAME } from "@/lib/auth";
import { PageHeader, SectionCard } from "@/components/ui";
import { WebauthnRegister } from "./webauthn-register";
import { PasswordForm } from "./password-form";
import { SessionsList, CredentialsList } from "./manage-lists";

export default async function ProfilePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const currentToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  const sessions = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, user.id), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())))
    .orderBy(desc(userSessions.createdAt));

  const credentials = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id));
  const employee = user.employeeId ? await db.query.employees.findFirst({ where: eq(employees.id, user.employeeId) }) : null;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader title="Profile" subtitle={`${user.name} · ${user.roleName}`} />

      <SectionCard title="About you">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Email</dt>
            <dd className="font-medium">{user.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Mobile</dt>
            <dd className="font-medium">{employee?.mobile ?? user.phone ?? "—"}</dd>
          </div>
          {employee && (
            <>
              <div>
                <dt className="text-xs text-muted">Designation</dt>
                <dd className="font-medium">{employee.designation ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Employee code</dt>
                <dd className="font-medium">{employee.employeeCode}</dd>
              </div>
            </>
          )}
        </dl>
      </SectionCard>

      <SectionCard title="Biometric sign-in" action={<WebauthnRegister />}>
        {credentials.length === 0 ? (
          <p className="text-sm text-muted">No devices registered yet — register this device for faster, more secure check-ins.</p>
        ) : (
          <CredentialsList credentials={credentials} />
        )}
      </SectionCard>

      <SectionCard title="Active sessions / devices">
        <SessionsList sessions={sessions} currentToken={currentToken} />
      </SectionCard>

      <SectionCard title="Change password">
        <PasswordForm />
      </SectionCard>
    </div>
  );
}
