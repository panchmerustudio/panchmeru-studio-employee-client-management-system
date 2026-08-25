import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { employees } from "./employees";
import { projects } from "./projects";
import { sites } from "./sites";
import { documentVersions } from "./documents";
import { tasks } from "./tasks";
import { files } from "./files";

/**
 * FUTURE — CLIENT MANAGEMENT (sections 6-20, 43-51, 72-80).
 *
 * These tables exist today so the eventual CLIENT -> PROJECT -> SITE ->
 * DRAWING -> SENT -> VIEWED -> REVISION -> APPROVAL chain never needs a
 * redesign. They are NOT written to or exposed in the UI while the
 * CLIENT_MANAGEMENT feature flag is off (see lib/feature-flags.ts) — no
 * employee or client ever sees them until the studio turns the module on.
 */

export const clients = sqliteTable("clients", {
  id: idColumn(),
  name: text("name").notNull(),
  companyName: text("company_name"),
  mobile: text("mobile"),
  altMobile: text("alt_mobile"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pin: text("pin"),
  communicationPreference: text("communication_preference"), // "portal" | "email" | "whatsapp" | "call"
  ...timestamps(),
});

/** A client may have several contacts: owner, spouse, architect, coordinator, rep... (section 8). */
export const clientContacts = sqliteTable("client_contacts", {
  id: idColumn(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship"), // "owner" | "spouse" | "architect" | "family_member" | "coordinator" | "company_representative"
  mobile: text("mobile"),
  email: text("email"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  ...createdAtOnly(),
});

/** Future client portal login — a deliberately separate identity space from staff `users` (section 9, 50). */
export const clientUsers = sqliteTable("client_users", {
  id: idColumn(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  clientContactId: text("client_contact_id").references(() => clientContacts.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  status: text("status", { enum: ["active", "invited", "disabled"] }).notNull().default("invited"),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  ...createdAtOnly(),
});

/**
 * Formal "who sent what to the client" record (sections 10-11, 47 — the
 * single most emphasized requirement in the future spec). Distinguishes
 * employee-sent vs owner-sent, tracks delivery/view/response per share.
 */
export const clientDrawingShares = sqliteTable("client_drawing_shares", {
  id: idColumn(),
  documentVersionId: text("document_version_id")
    .notNull()
    .references(() => documentVersions.id),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  projectId: text("project_id").references(() => projects.id),
  siteId: text("site_id").references(() => sites.id),
  sharedByUserId: text("shared_by_user_id")
    .notNull()
    .references(() => users.id),
  sharedByRole: text("shared_by_role", { enum: ["employee", "owner_manager"] }).notNull(),
  channel: text("channel", { enum: ["client_portal", "email", "whatsapp", "other"] })
    .notNull()
    .default("client_portal"),
  deliveryStatus: text("delivery_status", { enum: ["sent", "delivered", "failed"] })
    .notNull()
    .default("sent"),
  viewStatus: text("view_status", { enum: ["not_viewed", "viewed"] }).notNull().default("not_viewed"),
  viewedAt: integer("viewed_at", { mode: "timestamp" }),
  responseStatus: text("response_status", {
    enum: ["awaiting_response", "revision_requested", "approved"],
  })
    .notNull()
    .default("awaiting_response"),
  ...createdAtOnly(),
});

/** REVISION REQUEST #NNN chain (sections 12, 45, 79). */
export const clientRevisionRequests = sqliteTable("client_revision_requests", {
  id: idColumn(),
  sequenceNumber: integer("sequence_number").notNull(), // human-facing "#001"
  documentVersionId: text("document_version_id")
    .notNull()
    .references(() => documentVersions.id), // the version this revision was requested against
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  requestedByContactId: text("requested_by_contact_id").references(() => clientContacts.id),
  requestText: text("request_text").notNull(),
  attachmentFileId: text("attachment_file_id").references(() => files.id),
  status: text("status", {
    enum: ["open", "assigned", "revised", "resent", "approved", "rejected"],
  })
    .notNull()
    .default("open"),
  assignedEmployeeId: text("assigned_employee_id").references(() => employees.id),
  // the CLIENT REQUEST -> INTERNAL TASK link (section 79)
  internalTaskId: text("internal_task_id").references(() => tasks.id),
  revisedDocumentVersionId: text("revised_document_version_id").references(() => documentVersions.id),
  resubmissionDate: integer("resubmission_date", { mode: "timestamp" }),
  ...timestamps(),
});

/** Text / voice / photo / annotated-drawing / document comments from the client (section 13). */
export const clientComments = sqliteTable("client_comments", {
  id: idColumn(),
  documentVersionId: text("document_version_id").references(() => documentVersions.id),
  revisionRequestId: text("revision_request_id").references(() => clientRevisionRequests.id),
  authorContactId: text("author_contact_id")
    .notNull()
    .references(() => clientContacts.id),
  text: text("text"),
  voiceNoteId: text("voice_note_id"), // original audio + transcription both retained, see voiceNotes
  photoFileId: text("photo_file_id").references(() => files.id),
  ...createdAtOnly(),
});

/** Drawing markup — arrows / highlights / pins tied to a location on one version (section 14). */
export const clientDrawingAnnotations = sqliteTable("client_drawing_annotations", {
  id: idColumn(),
  documentVersionId: text("document_version_id")
    .notNull()
    .references(() => documentVersions.id),
  authorContactId: text("author_contact_id").references(() => clientContacts.id),
  authorUserId: text("author_user_id").references(() => users.id), // manager annotating internally
  annotationType: text("annotation_type", { enum: ["arrow", "highlight", "text", "pin"] }).notNull(),
  // normalized 0-1 coordinates against the rendered drawing, plus free-form shape data
  positionX: text("position_x"),
  positionY: text("position_y"),
  shapeData: text("shape_data", { mode: "json" }),
  comment: text("comment"),
  ...createdAtOnly(),
});

/** Final, immutable record of an approval (sections 49, 12). */
export const clientApprovals = sqliteTable("client_approvals", {
  id: idColumn(),
  documentVersionId: text("document_version_id")
    .notNull()
    .references(() => documentVersions.id),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  approvedByContactId: text("approved_by_contact_id").references(() => clientContacts.id),
  approvalMethod: text("approval_method", { enum: ["client_portal", "email", "verbal_logged_by_staff"] })
    .notNull()
    .default("client_portal"),
  approvalMessage: text("approval_message"),
  sessionMetadata: text("session_metadata", { mode: "json" }),
  ...createdAtOnly(),
});

/** Project-scoped free-form messaging (never a generic social chat, section 43). */
export const clientMessages = sqliteTable("client_messages", {
  id: idColumn(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  projectId: text("project_id").references(() => projects.id),
  siteId: text("site_id").references(() => sites.id),
  documentVersionId: text("document_version_id").references(() => documentVersions.id),
  taskId: text("task_id").references(() => tasks.id),
  senderType: text("sender_type", { enum: ["client", "employee", "owner_manager"] }).notNull(),
  senderUserId: text("sender_user_id").references(() => users.id),
  senderContactId: text("sender_contact_id").references(() => clientContacts.id),
  text: text("text"),
  voiceNoteId: text("voice_note_id"),
  fileId: text("file_id").references(() => files.id),
  ...createdAtOnly(),
});

/** The searchable per-client/per-project timeline (sections 17, 46, 74). */
export const clientActivities = sqliteTable("client_activities", {
  id: idColumn(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  projectId: text("project_id").references(() => projects.id),
  activityType: text("activity_type").notNull(), // "drawing_uploaded" | "drawing_shared" | "client_viewed" | "revision_requested" | "revised_version_uploaded" | "approved" | ...
  description: text("description").notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  ...createdAtOnly(),
});

export const clientNotifications = sqliteTable("client_notifications", {
  id: idColumn(),
  clientUserId: text("client_user_id")
    .notNull()
    .references(() => clientUsers.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  readAt: integer("read_at", { mode: "timestamp" }),
  ...createdAtOnly(),
});

export const clientMeetings = sqliteTable("client_meetings", {
  id: idColumn(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  projectId: text("project_id").references(() => projects.id),
  siteId: text("site_id").references(() => sites.id),
  meetingDate: integer("meeting_date", { mode: "timestamp" }).notNull(),
  participants: text("participants", { mode: "json" }),
  agenda: text("agenda"),
  notes: text("notes"),
  voiceNoteId: text("voice_note_id"),
  actionItemTaskIds: text("action_item_task_ids", { mode: "json" }).$type<string[]>(),
  ...createdAtOnly(),
});
