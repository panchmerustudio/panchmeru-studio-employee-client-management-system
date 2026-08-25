import Link from "next/link";
import { redirect } from "next/navigation";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, users, tasks, sites, projects, documents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { PageHeader, EmptyState, SectionCard } from "@/components/ui";
import { Icon } from "@/components/icon";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  const { q } = await searchParams;
  const term = q?.trim();
  const like_ = term ? `%${term}%` : null;

  const [employeeResults, taskResults, siteResults, projectResults, documentResults] = like_
    ? await Promise.all([
        db.select({ id: employees.id, name: users.name }).from(employees).innerJoin(users, eq(users.id, employees.userId)).where(like(users.name, like_)).limit(10),
        db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(like(tasks.title, like_)).limit(10),
        db.select({ id: sites.id, name: sites.name }).from(sites).where(like(sites.name, like_)).limit(10),
        db.select({ id: projects.id, name: projects.name }).from(projects).where(like(projects.name, like_)).limit(10),
        db.select({ id: documents.id, name: documents.name }).from(documents).where(like(documents.name, like_)).limit(10),
      ])
    : [[], [], [], [], []];

  const totalResults = employeeResults.length + taskResults.length + siteResults.length + projectResults.length + documentResults.length;

  return (
    <div>
      <PageHeader title="Search" subtitle="Employees, tasks, sites, projects & documents" />
      <form className="mb-6" action="/search">
        <input className="input" type="search" name="q" defaultValue={term} placeholder="Search everything…" autoFocus />
      </form>

      {!term ? (
        <EmptyState icon="search" title="Search across the whole studio" subtitle="Type a name, task title, or site to get started." />
      ) : totalResults === 0 ? (
        <EmptyState icon="search" title={`No results for "${term}"`} />
      ) : (
        <div className="space-y-4">
          <ResultSection title="Employees" icon="users" items={employeeResults.map((e) => ({ id: e.id, label: e.name, href: `/employees/${e.id}` }))} />
          <ResultSection title="Tasks" icon="check" items={taskResults.map((t) => ({ id: t.id, label: t.title, href: `/tasks/${t.id}` }))} />
          <ResultSection title="Sites" icon="map" items={siteResults.map((s) => ({ id: s.id, label: s.name, href: `/sites/${s.id}` }))} />
          <ResultSection title="Projects" icon="folder" items={projectResults.map((p) => ({ id: p.id, label: p.name, href: `/projects` }))} />
          <ResultSection title="Documents" icon="file" items={documentResults.map((d) => ({ id: d.id, label: d.name, href: `/documents/${d.id}` }))} />
        </div>
      )}
    </div>
  );
}

function ResultSection({ title, icon, items }: { title: string; icon: string; items: { id: string; label: string; href: string }[] }) {
  if (items.length === 0) return null;
  return (
    <SectionCard title={title}>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="flex items-center gap-2 py-2 text-sm hover:opacity-80">
              <Icon name={icon} className="h-4 w-4 text-muted" /> {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
