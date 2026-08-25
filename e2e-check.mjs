// Scripted end-to-end walkthrough of the Section 86 acceptance flow using a real
// headless Chromium (via Playwright) against the running dev server.
import { chromium } from "playwright";
import fs from "fs";

// In this sandbox, Chromium is pre-installed at /opt/pw-browsers (network downloads are
// blocked). On a normal machine with `npx playwright install` already run, this path won't
// exist, so we fall back to Playwright's default browser resolution.
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM, headless: true } : { headless: true };

const BASE = "http://localhost:3000";
const SHOTS_DIR = "/root/panchmeru-studio/e2e-shots";
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const OFFICE = { latitude: 30.901, longitude: 75.8573, accuracy: 15 };
let shotIndex = 0;
async function shot(page, name) {
  shotIndex += 1;
  await page.screenshot({ path: `${SHOTS_DIR}/${String(shotIndex).padStart(2, "0")}-${name}.png`, fullPage: true });
}

function log(step, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${step}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

async function login(context, email, password, expectedPath = "/home") {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="text"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Login always client-redirects to /home first; owner/manager accounts then
  // get server-redirected on to /dashboard — wait for the final settled URL.
  await page.waitForURL(new RegExp(expectedPath.replace("/", "\\/") + "$"), { timeout: 10000 });
  return page;
}

async function main() {
  const browser = await chromium.launch(launchOptions);

  // ---------- Owner session ----------
  const ownerCtx = await browser.newContext({ geolocation: OFFICE, permissions: ["geolocation"] });
  const owner = await login(ownerCtx, "owner@panchmeru.studio", "Panchmeru@123", "/dashboard");
  log("Owner logs in and lands on dashboard", owner.url().includes("/dashboard"));
  await shot(owner, "owner-dashboard");

  // Add employee
  await owner.goto(`${BASE}/employees/new`);
  const uniqueSuffix = Date.now().toString().slice(-6);
  const newEmail = `e2e.test.${uniqueSuffix}@panchmeru.studio`;
  await owner.fill('input[name="name"]', `E2E Employee ${uniqueSuffix}`);
  await owner.fill('input[name="mobile"]', String(9000000000 + Number(uniqueSuffix)));
  await owner.fill('input[name="email"]', newEmail);
  await owner.fill('input[name="designation"]', "QA Tester");
  await owner.selectOption('select[name="roleKey"]', "employee");
  await owner.click('button[type="submit"]');
  await owner.waitForSelector("text=Employee added", { timeout: 10000 });
  const tempPasswordEl = await owner.locator(".font-mono").first();
  const tempPassword = (await tempPasswordEl.textContent())?.trim();
  log("Owner adds a new employee (onboarding)", !!tempPassword, `temp password captured: ${!!tempPassword}`);
  await shot(owner, "employee-added");

  await owner.goto(`${BASE}/employees`);
  const employeeListed = await owner.locator(`text=E2E Employee ${uniqueSuffix}`).count();
  log("New employee appears in employee directory", employeeListed > 0);

  // Create a site (own coordinates so we can test GPS check-in against it)
  const SITE = { latitude: 30.905, longitude: 75.86, accuracy: 15 };
  await owner.goto(`${BASE}/sites/new`);
  await owner.fill('input[name="name"]', `E2E Test Site ${uniqueSuffix}`);
  const projectOptions = await owner.locator('select[name="projectId"] option').allTextContents();
  await owner.selectOption('select[name="projectId"]', { index: 1 });
  await owner.fill('input[name="city"]', "Ludhiana");
  await owner.fill('input[name="latitude"]', String(SITE.latitude));
  await owner.fill('input[name="longitude"]', String(SITE.longitude));
  await owner.click('button[type="submit"]');
  await owner.waitForURL(/\/sites\/[a-f0-9-]+$/, { timeout: 10000 });
  const siteId = owner.url().split("/sites/")[1];
  log("Owner creates a new site", !!siteId, `siteId=${siteId}`);
  await shot(owner, "site-created");

  // Assign the new employee to the site
  const employeeSelect = owner.locator('select').filter({ hasText: "Choose employee" }).first();
  await employeeSelect.selectOption({ label: `E2E Employee ${uniqueSuffix}` });
  await owner.locator('button:has-text("Assign")').click();
  await owner.waitForTimeout(500);
  const assigned = await owner.locator(`text=E2E Employee ${uniqueSuffix}`).count();
  log("Owner assigns the employee to the site", assigned > 0);
  await shot(owner, "site-assigned");

  // Create + assign a task to the new employee
  await owner.goto(`${BASE}/tasks/new`);
  await owner.fill('input[name="title"]', `E2E Verify Task ${uniqueSuffix}`);
  await owner.selectOption('select[name="assignedToId"]', { label: `E2E Employee ${uniqueSuffix}` });
  await owner.click('button[type="submit"]');
  await owner.waitForURL(/\/tasks$/, { timeout: 10000 });
  const taskListed = await owner.locator(`text=E2E Verify Task ${uniqueSuffix}`).count();
  log("Owner creates and assigns a task", taskListed > 0);
  await owner.click(`text=E2E Verify Task ${uniqueSuffix}`);
  await owner.waitForURL(/\/tasks\/[a-f0-9-]+$/);
  const taskId = owner.url().split("/tasks/")[1];
  await shot(owner, "task-created");

  // ---------- New employee session ----------
  const empCtx = await browser.newContext({ geolocation: OFFICE, permissions: ["geolocation"] });
  const emp = await login(empCtx, newEmail, tempPassword);
  log("New employee logs in with temp password and lands on home", emp.url().includes("/home"));
  await shot(emp, "employee-home");

  // Employee sees the assigned task
  await emp.goto(`${BASE}/tasks/${taskId}`);
  const seesTask = await emp.locator(`text=E2E Verify Task ${uniqueSuffix}`).count();
  log("Employee can see the task assigned to them", seesTask > 0);

  // Employee submits work
  await emp.fill("textarea", "Completed the QA verification pass.");
  await emp.click('button:has-text("Submit for review")');
  await emp.waitForTimeout(800);
  const submittedBadge = await emp.locator("text=Submitted").count();
  log("Employee submits work for review", submittedBadge > 0);
  await shot(emp, "task-submitted");

  // Employee checks into the office (GPS mocked at office geofence)
  await emp.goto(`${BASE}/attendance`);
  await emp.click('button:has-text("Check in")');
  await emp.waitForTimeout(2000);
  const checkedInMsg = await emp.locator("text=Checked in successfully").count();
  log("Employee checks in with GPS (within office geofence)", checkedInMsg > 0);
  await shot(emp, "attendance-checkin");

  // Employee applies for leave
  await emp.goto(`${BASE}/leave`);
  const leaveTypeOptions = await emp.locator('select[name="leaveTypeId"] option').count();
  await emp.selectOption('select[name="leaveTypeId"]', { index: 1 });
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await emp.fill('input[name="startDate"]', tomorrow);
  await emp.fill('input[name="endDate"]', tomorrow);
  await emp.fill('textarea[name="reason"]', "E2E test leave request");
  await emp.click('button:has-text("Apply for leave")');
  await emp.waitForTimeout(800);
  const leaveConfirm = await emp.locator("text=Leave request submitted").count();
  log("Employee applies for leave", leaveConfirm > 0);
  await shot(emp, "leave-applied");

  // Employee starts a site visit at the new site (GPS mocked at site coords)
  await empCtx.setGeolocation(SITE);
  await emp.goto(`${BASE}/sites/${siteId}`);
  const startVisitBtn = emp.locator('button:has-text("Start site visit")');
  const hasStartBtn = await startVisitBtn.count();
  if (hasStartBtn > 0) {
    await startVisitBtn.click();
    await emp.waitForURL(/\/sites\/[a-f0-9-]+\/visit$/, { timeout: 10000 });
    log("Employee starts a site visit with GPS check-in", true);
    await shot(emp, "site-visit-active");

    await emp.fill('textarea >> nth=0', "Measured the site and took photos.");
    await emp.fill('textarea >> nth=1', "Discussed layout with client rep on call.");
    await emp.click('button:has-text("Check out & save report")');
    await emp.waitForURL(new RegExp(`/sites/${siteId}$`), { timeout: 10000 });
    log("Employee checks out and saves site report", true);
    await shot(emp, "site-visit-checked-out");
  } else {
    log("Employee starts a site visit with GPS check-in", false, "Start button not found");
  }

  // ---------- Back to owner: verify everything shows up ----------
  await owner.goto(`${BASE}/tasks/${taskId}`);
  await owner.waitForTimeout(300);
  const reviewPanel = await owner.locator('button:has-text("Approve")').count();
  log("Owner sees submission awaiting review", reviewPanel > 0);
  if (reviewPanel > 0) {
    await owner.click('button:has-text("Approve")');
    await owner.waitForTimeout(600);
    const approvedBadge = await owner.locator("text=Approved").count();
    log("Owner approves the submitted task", approvedBadge > 0);
  }
  await shot(owner, "task-approved");

  await owner.goto(`${BASE}/leave`);
  const pendingApprovalRow = await owner.locator(`text=E2E Employee ${uniqueSuffix}`).count();
  log("Owner sees the leave request in pending approvals", pendingApprovalRow > 0);
  await shot(owner, "leave-pending-approval");

  await owner.goto(`${BASE}/attendance/team`);
  const presentToday = await owner.locator(`text=E2E Employee ${uniqueSuffix}`).count();
  log("Owner sees the new employee marked present today", presentToday > 0);
  await shot(owner, "attendance-team");

  await owner.goto(`${BASE}/sites/${siteId}`);
  const visitHistory = await owner.locator(`text=E2E Employee ${uniqueSuffix}`).count();
  log("Owner sees the completed site visit in site history", visitHistory > 0);
  await shot(owner, "site-visit-history");

  await owner.goto(`${BASE}/dashboard`);
  await shot(owner, "dashboard-final");
  log("Owner dashboard loads after full workflow", owner.url().includes("/dashboard"));

  await browser.close();
  console.log("\nDone. Screenshots saved to", SHOTS_DIR);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
