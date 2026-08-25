/**
 * Roles & permissions (spec section 23 "System" + section 59). Kept as
 * plain TypeScript constants for the seed data to load into the
 * `roles`/`permissions`/`role_permissions` tables — the source of truth
 * at runtime is always the database (so an owner can regrant permissions
 * later without a code deploy), this file just seeds sensible defaults.
 */

export const ROLE_KEYS = ["owner", "manager", "supervisor", "employee"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const PERMISSIONS = {
  EMPLOYEE_MANAGE: "employee.manage",
  EMPLOYEE_VIEW: "employee.view",
  ATTENDANCE_VIEW_ALL: "attendance.view_all",
  ATTENDANCE_SELF: "attendance.self",
  TASK_CREATE: "task.create",
  TASK_APPROVE: "task.approve",
  TASK_VIEW_ALL: "task.view_all",
  LEAVE_APPLY: "leave.apply",
  LEAVE_APPROVE: "leave.approve",
  SITE_MANAGE: "site.manage",
  SITE_VIEW_ALL: "site.view_all",
  SITE_VISIT: "site.visit",
  DOCUMENT_MANAGE: "document.manage",
  DOCUMENT_UPLOAD: "document.upload",
  MATERIAL_REQUEST: "material.request",
  MATERIAL_APPROVE: "material.approve",
  REPORT_VIEW: "report.view",
  AUDIT_VIEW: "audit.view",
  SETTINGS_MANAGE: "settings.manage",
  DASHBOARD_OWNER: "dashboard.owner",
  RECRUITMENT_MANAGE: "recruitment.manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: { key: PermissionKey; description: string }[] = [
  { key: PERMISSIONS.EMPLOYEE_MANAGE, description: "Add, edit, activate/deactivate employees" },
  { key: PERMISSIONS.EMPLOYEE_VIEW, description: "View employee directory & profiles" },
  { key: PERMISSIONS.ATTENDANCE_VIEW_ALL, description: "View attendance for all employees" },
  { key: PERMISSIONS.ATTENDANCE_SELF, description: "Check in / check out for oneself" },
  { key: PERMISSIONS.TASK_CREATE, description: "Create and assign tasks" },
  { key: PERMISSIONS.TASK_APPROVE, description: "Approve or request modification on submitted work" },
  { key: PERMISSIONS.TASK_VIEW_ALL, description: "View all tasks across the studio" },
  { key: PERMISSIONS.LEAVE_APPLY, description: "Apply for leave" },
  { key: PERMISSIONS.LEAVE_APPROVE, description: "Approve or reject leave requests" },
  { key: PERMISSIONS.SITE_MANAGE, description: "Create/edit sites, assign employees" },
  { key: PERMISSIONS.SITE_VIEW_ALL, description: "View all sites, not just assigned ones" },
  { key: PERMISSIONS.SITE_VISIT, description: "Check in/out of a site visit" },
  { key: PERMISSIONS.DOCUMENT_MANAGE, description: "Manage document/drawing versions & visibility" },
  { key: PERMISSIONS.DOCUMENT_UPLOAD, description: "Upload documents/drawings" },
  { key: PERMISSIONS.MATERIAL_REQUEST, description: "Raise a material request" },
  { key: PERMISSIONS.MATERIAL_APPROVE, description: "Approve/reject/order material requests" },
  { key: PERMISSIONS.REPORT_VIEW, description: "View reports" },
  { key: PERMISSIONS.AUDIT_VIEW, description: "View the audit log" },
  { key: PERMISSIONS.SETTINGS_MANAGE, description: "Manage feature flags & studio settings" },
  { key: PERMISSIONS.DASHBOARD_OWNER, description: "View the owner operations dashboard" },
  { key: PERMISSIONS.RECRUITMENT_MANAGE, description: "Review job applications submitted through the public careers page" },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  owner: ALL_PERMISSIONS.map((p) => p.key),
  manager: [
    PERMISSIONS.EMPLOYEE_MANAGE,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.ATTENDANCE_VIEW_ALL,
    PERMISSIONS.ATTENDANCE_SELF,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_APPROVE,
    PERMISSIONS.TASK_VIEW_ALL,
    PERMISSIONS.LEAVE_APPLY,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.SITE_MANAGE,
    PERMISSIONS.SITE_VIEW_ALL,
    PERMISSIONS.SITE_VISIT,
    PERMISSIONS.DOCUMENT_MANAGE,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.MATERIAL_APPROVE,
    PERMISSIONS.MATERIAL_REQUEST,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.DASHBOARD_OWNER,
  ],
  supervisor: [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.ATTENDANCE_SELF,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_APPROVE,
    PERMISSIONS.TASK_VIEW_ALL,
    PERMISSIONS.LEAVE_APPLY,
    PERMISSIONS.SITE_VIEW_ALL,
    PERMISSIONS.SITE_VISIT,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.MATERIAL_REQUEST,
    PERMISSIONS.REPORT_VIEW,
  ],
  employee: [
    PERMISSIONS.ATTENDANCE_SELF,
    PERMISSIONS.LEAVE_APPLY,
    PERMISSIONS.SITE_VISIT,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.MATERIAL_REQUEST,
  ],
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Site Supervisor",
  employee: "Employee",
};
