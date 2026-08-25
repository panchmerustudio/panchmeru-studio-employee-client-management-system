/**
 * Seeds a realistic Panchmeru Studio demo: roles/permissions, feature
 * flags (all future modules OFF), an office geofence, a small team,
 * projects + sites across the six cities from the brief, plus enough
 * sample tasks/attendance/leave/documents/materials data that the app
 * feels alive the moment you log in.
 *
 * Run with: npm run db:seed
 */
import bcrypt from "bcryptjs";
import { db } from "./client";
import {
  roles,
  permissions,
  rolePermissions,
  users,
  employees,
  featureFlags,
  leaveTypes,
  documentCategories,
  projectTypes,
  geofences,
  projects,
  sites,
  siteAssignments,
  tasks,
  taskHistory,
  leaveRequests,
  attendanceEvents,
  attendanceRecords,
  notifications,
  auditLogs,
} from "./schema";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS, ROLE_LABELS } from "../lib/rbac";
import { FEATURE_FLAG_DEFS } from "../lib/feature-flags";
import { randomUUID } from "crypto";

async function main() {
  console.log("Seeding Panchmeru Studio...");

  // ---- Roles & permissions ----
  const roleRows: Record<string, string> = {};
  for (const key of ROLE_KEYS) {
    const [row] = await db.insert(roles).values({ key, name: ROLE_LABELS[key], isSystem: true }).returning();
    roleRows[key] = row.id;
  }
  for (const p of ALL_PERMISSIONS) {
    await db.insert(permissions).values({ key: p.key, description: p.description });
  }
  for (const key of ROLE_KEYS) {
    for (const permKey of DEFAULT_ROLE_PERMISSIONS[key]) {
      await db.insert(rolePermissions).values({ roleId: roleRows[key], permissionKey: permKey });
    }
  }

  // ---- Feature flags (all OFF by default — section 66) ----
  for (const f of FEATURE_FLAG_DEFS) {
    await db.insert(featureFlags).values({ key: f.key, name: f.name, description: f.description, enabled: false });
  }

  // ---- Reference data ----
  // Studio leave policy: 8 sick days/year + 15 annual days/year. Approved
  // days beyond that allocation are unpaid and deduct from salary at
  // (monthlySalary / 30) per day — see src/lib/leave-policy.ts.
  for (const lt of [
    { key: "sick", name: "Sick Leave", paid: true, maxDaysPerYear: 8 },
    { key: "annual", name: "Annual Leave", paid: true, maxDaysPerYear: 15 },
    { key: "unpaid", name: "Leave Without Pay", paid: false, maxDaysPerYear: null },
  ]) {
    await db.insert(leaveTypes).values(lt);
  }
  for (const c of [
    { key: "architecture", name: "Architecture" },
    { key: "interior", name: "Interior" },
    { key: "working_drawing", name: "Working Drawing" },
    { key: "3d", name: "3D" },
    { key: "site", name: "Site" },
    { key: "photos", name: "Photos" },
    { key: "other", name: "Other" },
  ]) {
    await db.insert(documentCategories).values(c);
  }
  const projectTypeRows: Record<string, string> = {};
  for (const t of ["Architecture", "Interior Design", "Architecture + Interior", "Turnkey Interior", "Design + Material", "Execution", "Other"]) {
    const key = t.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const [row] = await db.insert(projectTypes).values({ key, name: t }).returning();
    projectTypeRows[t] = row.id;
  }

  // ---- Office geofence (Ludhiana HQ) ----
  const [officeGeofence] = await db
    .insert(geofences)
    .values({ name: "Panchmeru Studio — Head Office", type: "office", latitude: 30.901, longitude: 75.8573, radiusMeters: 150 })
    .returning();

  // ---- Users + employees ----
  const passwordHash = await bcrypt.hash("Panchmeru@123", 10);

  async function makeUserAndEmployee(opts: {
    name: string;
    email: string;
    mobile: string;
    roleKey: keyof typeof roleRows;
    employeeCode: string;
    designation: string;
    department: string;
    city: string;
    monthlySalary?: number;
  }) {
    const [user] = await db
      .insert(users)
      .values({ name: opts.name, email: opts.email, phone: opts.mobile, passwordHash, roleId: roleRows[opts.roleKey], status: "active" })
      .returning();
    const [employee] = await db
      .insert(employees)
      .values({
        userId: user.id,
        employeeCode: opts.employeeCode,
        mobile: opts.mobile,
        email: opts.email,
        city: opts.city,
        state: "Punjab",
        designation: opts.designation,
        department: opts.department,
        joiningDate: new Date("2023-01-10"),
        onboardingCompletedAt: new Date("2023-01-12"),
        status: "active",
        monthlySalary: opts.monthlySalary ?? null,
      })
      .returning();
    return { user, employee };
  }

  const owner = await makeUserAndEmployee({
    name: "Manpreet Singh (Owner)",
    email: "owner@panchmeru.studio",
    mobile: "9876500001",
    roleKey: "owner",
    employeeCode: "PMS-0001",
    designation: "Founder & Principal Designer",
    department: "Management",
    city: "Ludhiana",
    monthlySalary: 150000,
  });
  const manager = await makeUserAndEmployee({
    name: "Simran Kaur",
    email: "manager@panchmeru.studio",
    mobile: "9876500002",
    roleKey: "manager",
    employeeCode: "PMS-0002",
    designation: "Studio Manager",
    department: "Operations",
    city: "Ludhiana",
    monthlySalary: 65000,
  });
  const supervisor = await makeUserAndEmployee({
    name: "Rahul Verma",
    email: "supervisor@panchmeru.studio",
    mobile: "9876500003",
    roleKey: "supervisor",
    employeeCode: "PMS-0003",
    designation: "Site Supervisor",
    department: "Execution",
    city: "Mohali",
    monthlySalary: 42000,
  });
  const emp1 = await makeUserAndEmployee({
    name: "Ankit Sharma",
    email: "ankit@panchmeru.studio",
    mobile: "9876500004",
    roleKey: "employee",
    employeeCode: "PMS-0004",
    designation: "Interior Designer",
    department: "Design",
    city: "Chandigarh",
    monthlySalary: 35000,
  });
  const emp2 = await makeUserAndEmployee({
    name: "Priya Mehta",
    email: "priya@panchmeru.studio",
    mobile: "9876500005",
    roleKey: "employee",
    employeeCode: "PMS-0005",
    designation: "Junior Architect",
    department: "Design",
    city: "Khanna",
    monthlySalary: 30000,
  });
  const emp3 = await makeUserAndEmployee({
    name: "Deepak Kumar",
    email: "deepak@panchmeru.studio",
    mobile: "9876500006",
    roleKey: "employee",
    employeeCode: "PMS-0006",
    designation: "Site Engineer",
    department: "Execution",
    city: "Samrala",
    monthlySalary: 32000,
  });

  // ---- Projects & sites across the six cities ----
  const cityCoords: Record<string, { lat: number; lng: number }> = {
    Ludhiana: { lat: 30.901, lng: 75.8573 },
    Chandigarh: { lat: 30.7333, lng: 76.7794 },
    Mohali: { lat: 30.7046, lng: 76.7179 },
    Khanna: { lat: 30.705, lng: 76.2223 },
    "Mandi Gobindgarh": { lat: 30.6667, lng: 76.2833 },
    Samrala: { lat: 30.8367, lng: 76.19 },
  };

  const siteDefs = [
    { project: "Sharma Residence", type: "Interior Design", city: "Mohali", site: "Sharma Residence — Phase 2 Interiors", status: "active", health: "normal" as const, manager: supervisor.employee.id, team: [emp1.employee.id] },
    { project: "Bawa Bungalow", type: "Turnkey Interior", city: "Ludhiana", site: "Bawa Bungalow — Model Town", status: "active", health: "attention" as const, healthReason: "No site visit in 6 days", manager: supervisor.employee.id, team: [emp2.employee.id] },
    { project: "Corporate Office Fitout", type: "Architecture + Interior", city: "Chandigarh", site: "Cera Corp — Sector 34 Office", status: "active", health: "urgent" as const, healthReason: "Task overdue: Electrical layout revision", manager: manager.employee.id, team: [emp1.employee.id, emp3.employee.id] },
    { project: "Grover Farmhouse", type: "Architecture", city: "Khanna", site: "Grover Farmhouse", status: "active", health: "normal" as const, manager: supervisor.employee.id, team: [emp2.employee.id] },
    { project: "Steel Traders Showroom", type: "Design + Material", city: "Mandi Gobindgarh", site: "Steel Traders Showroom Fitout", status: "active", health: "attention" as const, healthReason: "Material request pending 3 days", manager: manager.employee.id, team: [emp3.employee.id] },
    { project: "Aggarwal Residence", type: "Interior Design", city: "Samrala", site: "Aggarwal Residence — Ground Floor", status: "active", health: "normal" as const, manager: supervisor.employee.id, team: [emp3.employee.id] },
    { project: "Bansal Residence", type: "Turnkey Interior", city: "Ludhiana", site: "Bansal Residence — Sarabha Nagar", status: "on_hold", health: "normal" as const, manager: manager.employee.id, team: [] },
    { project: "Cityscape Cafe", type: "Interior Design", city: "Chandigarh", site: "Cityscape Cafe — Sector 17", status: "completed", health: "normal" as const, manager: manager.employee.id, team: [] },
  ];

  let siteCounter = 0;
  for (const def of siteDefs) {
    const [project] = await db
      .insert(projects)
      .values({
        name: def.project,
        projectTypeId: projectTypeRows[def.type],
        status: def.status as "active" | "on_hold" | "completed",
        startDate: new Date("2026-03-01"),
        expectedCompletion: new Date("2026-12-31"),
        createdBy: owner.user.id,
      })
      .returning();

    const coord = cityCoords[def.city];
    const jitter = () => (Math.random() - 0.5) * 0.02;
    const lat = coord.lat + jitter();
    const lng = coord.lng + jitter();

    const [siteGeofence] = await db
      .insert(geofences)
      .values({ name: `${def.site} — geofence`, type: "site", latitude: lat, longitude: lng, radiusMeters: 100 })
      .returning();

    const [site] = await db
      .insert(sites)
      .values({
        name: def.site,
        projectId: project.id,
        geofenceId: siteGeofence.id,
        city: def.city,
        state: "Punjab",
        latitude: lat,
        longitude: lng,
        status: def.status === "completed" ? "completed" : def.status === "on_hold" ? "on_hold" : "active",
        healthStatus: def.health,
        healthReason: def.healthReason,
        startDate: new Date("2026-03-15"),
        expectedCompletion: new Date("2026-12-15"),
        siteManagerId: def.manager,
      })
      .returning();
    siteCounter++;

    for (const empId of def.team) {
      await db.insert(siteAssignments).values({ siteId: site.id, employeeId: empId, role: "team_member" });
    }
    if (!def.team.includes(def.manager)) {
      await db.insert(siteAssignments).values({ siteId: site.id, employeeId: def.manager, role: "site_manager" });
    }

    // one representative task per site
    if (def.status === "active") {
      const assignee = def.team[0] ?? def.manager;
      const [task] = await db
        .insert(tasks)
        .values({
          title: siteCounter % 3 === 0 ? "Prepare kitchen layout drawing" : siteCounter % 3 === 1 ? "Submit material requirement list" : "Site measurement & photo documentation",
          description: "Auto-generated demo task.",
          projectId: project.id,
          siteId: site.id,
          assignedToId: assignee,
          assignedById: manager.user.id,
          priority: def.health === "urgent" ? "urgent" : "normal",
          dueDate: new Date(Date.now() + (def.health === "urgent" ? -1 : 3) * 24 * 60 * 60 * 1000),
          status: def.health === "urgent" ? "overdue" : siteCounter % 4 === 0 ? "submitted" : "to_do",
        })
        .returning();
      await db.insert(taskHistory).values({ taskId: task.id, action: "created", toStatus: task.status, actorId: manager.user.id });
    }
  }

  // ---- Sample leave request ----
  const annualLeave = await db.query.leaveTypes.findFirst({ where: (lt, { eq }) => eq(lt.key, "annual") });
  if (annualLeave) {
    await db.insert(leaveRequests).values({
      employeeId: emp2.employee.id,
      leaveTypeId: annualLeave.id,
      startDate: new Date(Date.now() + 2 * 86400000),
      endDate: new Date(Date.now() + 2 * 86400000),
      isHalfDay: false,
      reason: "Family function",
      status: "pending",
      workingDays: 1,
    });
  }

  // ---- Today's attendance for the team (demo) ----
  const today = new Date().toISOString().slice(0, 10);
  for (const person of [owner, manager, supervisor, emp1, emp3]) {
    const clientEventId = randomUUID();
    const [checkIn] = await db
      .insert(attendanceEvents)
      .values({
        employeeId: person.employee.id,
        type: "check_in",
        source: "office",
        latitude: 30.901,
        longitude: 75.8573,
        accuracy: 12,
        address: "Panchmeru Studio, Model Town, Ludhiana, Punjab, India",
        geofenceId: officeGeofence.id,
        withinGeofence: true,
        distanceMeters: 8,
        authMethod: "password_session",
        clientEventId,
        capturedAtClient: new Date(new Date().setHours(9, 30, 0, 0)),
      })
      .returning();
    await db.insert(attendanceRecords).values({
      employeeId: person.employee.id,
      date: today,
      checkInEventId: checkIn.id,
      status: "present",
    });
  }
  // emp2 on leave, deepak absent today (both demo states so the dashboard has variety)
  await db.insert(attendanceRecords).values({ employeeId: emp2.employee.id, date: today, status: "on_leave" });

  // ---- Notifications ----
  await db.insert(notifications).values([
    {
      recipientId: manager.user.id,
      type: "leave_requested",
      title: "New leave request",
      message: "Priya Mehta requested casual leave.",
      relatedEntityType: "leave_request",
    },
    {
      recipientId: emp1.user.id,
      type: "task_assigned",
      title: "New task assigned",
      message: "You've been assigned: Site measurement & photo documentation.",
      relatedEntityType: "task",
    },
  ]);

  // ---- Sample audit entries ----
  await db.insert(auditLogs).values([
    { actorId: owner.user.id, actorRole: "owner", action: "employee.created", entityType: "employee", entityId: emp3.employee.id, newState: { name: "Deepak Kumar" } },
    { actorId: manager.user.id, actorRole: "manager", action: "site.created", entityType: "site", entityId: "seed", newState: { note: "Seed data" } },
  ]);

  console.log("Seed complete.");
  console.log("");
  console.log("Demo logins (password: Panchmeru@123):");
  console.log("  Owner:      owner@panchmeru.studio");
  console.log("  Manager:    manager@panchmeru.studio");
  console.log("  Supervisor: supervisor@panchmeru.studio");
  console.log("  Employee:   ankit@panchmeru.studio / priya@panchmeru.studio / deepak@panchmeru.studio");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
