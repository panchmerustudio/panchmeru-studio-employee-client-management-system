import { notFound, redirect } from "next/navigation";
import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import {
  tasks,
  employees,
  users,
  projects,
  sites,
  taskComments,
  taskSubmissions,
  taskSubmissionAttachments,
  taskHistory,
  voiceNotes,
  files as filesTable,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, Badge, SectionCard } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/format";
import { Icon } from "@/components/icon";
import { CommentBox } from "./comment-box";
import { SubmitWorkPanel, ReviewPanel, ManagerToolsPanel } from "./action-panels";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!task) notFound();

  const assigneeEmployee = await db.query.employees.findFirst({ where: eq(employees.id, task.assignedToId) });
  const assigneeUser = assigneeEmployee ? await db.query.users.findFirst({ where: eq(users.id, assigneeEmployee.userId) }) : null;
  const assignerUser = await db.query.users.findFirst({ where: eq(users.id, task.assignedById) });
  const project = task.projectId ? await db.query.projects.findFirst({ where: eq(projects.id, task.projectId) }) : null;
  const site = task.siteId ? await db.query.sites.findFirst({ where: eq(sites.id, task.siteId) }) : null;

  const isAssignee = user.employeeId === task.assignedToId;
  const canApprove = user.permissions.includes(PERMISSIONS.TASK_APPROVE);
  const canManage = user.permissions.includes(PERMISSIONS.TASK_CREATE);
  const canView = isAssignee || user.permissions.includes(PERMISSIONS.TASK_VIEW_ALL);
  if (!canView) redirect("/tasks");

  const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, id)).orderBy(asc(taskComments.createdAt));
  const commentAuthors = await Promise.all(comments.map((c) => db.query.users.findFirst({ where: eq(users.id, c.authorId) })));
  const commentVoiceNotes = await Promise.all(
    comments.map((c) => (c.voiceNoteId ? db.query.voiceNotes.findFirst({ where: eq(voiceNotes.id, c.voiceNoteId) }) : null))
  );
  const commentFiles = await Promise.all(comments.map((c) => (c.fileId ? db.query.files.findFirst({ where: eq(filesTable.id, c.fileId) }) : null)));

  const submissions = await db.select().from(taskSubmissions).where(eq(taskSubmissions.taskId, id)).orderBy(desc(taskSubmissions.submittedAt));
  const submissionAttachments = await Promise.all(
    submissions.map((s) => db.select().from(taskSubmissionAttachments).where(eq(taskSubmissionAttachments.submissionId, s.id)))
  );

  const history = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id)).orderBy(desc(taskHistory.createdAt));

  const canSubmit = isAssignee && ["to_do", "in_progress", "modification_required"].includes(task.status);
  const canReview = canApprove && task.status === "submitted";

  return (
    <div className="space-y-5">
      <PageHeader
        title={task.title}
        subtitle={[project?.name, site?.name].filter(Boolean).join(" · ") || "No project/site linked"}
        action={<Badge status={task.status} />}
      />

      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-5 md:col-span-2">
          <SectionCard title="Details">
            {task.description && <p className="mb-3 text-sm text-foreground">{task.description}</p>}
            {task.instructions && (
              <div className="mb-3 rounded-lg bg-background p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-muted">Instructions</div>
                {task.instructions}
              </div>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Assigned to</dt>
                <dd className="font-medium">{assigneeUser?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Assigned by</dt>
                <dd className="font-medium">{assignerUser?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Priority</dt>
                <dd className="font-medium capitalize">{task.priority}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Due date</dt>
                <dd className="font-medium">{task.dueDate ? formatDateTime(task.dueDate) : "—"}</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title="Submissions">
            {submissions.length === 0 ? (
              <p className="text-sm text-muted">No work submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {submissions.map((s, i) => (
                  <div key={s.id} className="rounded-lg border border-border p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted">Version {s.version}</span>
                      <Badge status={s.status} />
                    </div>
                    {s.note && <p className="mb-2 text-sm">{s.note}</p>}
                    {submissionAttachments[i]?.length > 0 && (
                      <ul className="mb-2 flex flex-wrap gap-2">
                        {submissionAttachments[i].map((a) => (
                          <li key={a.id}>
                            <a href={`/api/files/${a.fileId}`} target="_blank" rel="noreferrer" className="badge bg-slate-100 text-slate-700">
                              <Icon name="file" className="h-3 w-3" /> attachment
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="text-xs text-muted">Submitted {timeAgo(s.submittedAt)}</div>
                    {s.reviewNote && <div className="mt-1 rounded bg-background p-2 text-xs">Review note: {s.reviewNote}</div>}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Conversation">
            <div className="space-y-3">
              {comments.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
              {comments.map((c, i) => (
                <div key={c.id} className="flex gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">
                    {commentAuthors[i]?.name?.[0] ?? "?"}
                  </div>
                  <div className="flex-1 rounded-lg bg-background px-3 py-2">
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="text-xs font-semibold">{commentAuthors[i]?.name}</span>
                      <span className="text-[10px] text-muted">{timeAgo(c.createdAt)}</span>
                    </div>
                    {c.type === "text" && <p className="text-sm">{c.text_}</p>}
                    {c.type === "photo" && commentFiles[i] && (
                      <a href={`/api/files/${c.fileId}`} target="_blank" rel="noreferrer">
                        <img src={`/api/files/${c.fileId}`} alt="attachment" className="mt-1 max-h-48 rounded-lg border border-border" />
                      </a>
                    )}
                    {c.type === "document" && commentFiles[i] && (
                      <a href={`/api/files/${c.fileId}`} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 text-sm font-medium text-accent">
                        <Icon name="file" className="h-4 w-4" /> {commentFiles[i]?.originalName}
                      </a>
                    )}
                    {c.type === "voice" && commentVoiceNotes[i] && (
                      <div className="mt-1">
                        <audio controls src={`/api/files/${commentVoiceNotes[i]?.audioFileId}`} className="h-9 w-full max-w-xs" />
                        {commentVoiceNotes[i]?.transcript && <p className="mt-1 text-xs italic text-muted">&quot;{commentVoiceNotes[i]?.transcript}&quot;</p>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <CommentBox taskId={id} />
          </SectionCard>
        </div>

        <div className="space-y-5">
          {canSubmit && <SubmitWorkPanel taskId={id} />}
          {canReview && <ReviewPanel taskId={id} />}
          {canManage && task.status !== "cancelled" && <ManagerToolsPanel taskId={id} />}

          <SectionCard title="History">
            <ul className="space-y-2 text-xs">
              {history.map((h) => (
                <li key={h.id} className="text-muted">
                  <span className="font-medium text-foreground">{h.action.replace(/_/g, " ")}</span> · {timeAgo(h.createdAt)}
                  {h.note && <div className="mt-0.5 text-foreground">{h.note}</div>}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
