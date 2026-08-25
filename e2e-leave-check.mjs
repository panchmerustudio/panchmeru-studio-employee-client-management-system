// Focused verification of the new leave-balance / loss-of-pay deduction logic:
// Sick Leave is 8 days/year. Ankit Sharma (seeded, ₹35,000/month) applies for
// 10 days of sick leave — 8 should be paid, 2 unpaid, with a deduction of
// 2 * (35000/30) ≈ ₹2333.33. We verify the math end to end through the UI.
import { chromium } from "playwright";
import fs from "fs";

const BASE = "http://localhost:3000";
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM, headless: true } : { headless: true };

function log(step, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${step}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

async function login(context, email, password) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="text"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(home|dashboard)$/, { timeout: 10000 });
  return page;
}

async function main() {
  const browser = await chromium.launch(launchOptions);

  const empCtx = await browser.newContext();
  const emp = await login(empCtx, "ankit@panchmeru.studio", "Panchmeru@123");

  await emp.goto(`${BASE}/leave`);
  const balanceText = await emp.locator("text=Your").first().count();
  log("Employee sees their leave balance widget", balanceText > 0);

  // Apply for 10 days of sick leave (allocation is 8/year), starting far
  // enough out that it won't collide with any other seeded leave request.
  const start = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 39 * 86400000).toISOString().slice(0, 10); // 10 days inclusive

  await emp.selectOption('select[name="leaveTypeId"]', { label: "Sick Leave" });
  await emp.fill('input[name="startDate"]', start);
  await emp.fill('input[name="endDate"]', end);
  await emp.fill('textarea[name="reason"]', "E2E leave-deduction verification");
  await emp.click('button:has-text("Apply for leave")');
  await emp.waitForTimeout(800);
  const applied = await emp.locator("text=Leave request submitted").count();
  log("Employee applies for 10 days of sick leave", applied > 0);

  // ---- Owner approves and we check the computed split ----
  const ownerCtx = await browser.newContext();
  const owner = await login(ownerCtx, "owner@panchmeru.studio", "Panchmeru@123");
  await owner.goto(`${BASE}/leave`);

  const preview = await owner.locator("text=/uses 8 remaining paid day/").count();
  log("Owner sees the correct paid/unpaid preview before approving (8 paid, 2 unpaid)", preview > 0);

  const rows = owner.locator(".rounded-lg.border.border-border.p-3", { hasText: "Ankit Sharma" });
  const approveBtn = rows.first().locator('button:has-text("Approve")');
  await approveBtn.click();
  await owner.waitForTimeout(800);

  await owner.goto(`${BASE}/reports`);
  const payrollRow = owner.locator("tr", { hasText: "Ankit Sharma" });
  const rowText = await payrollRow.first().innerText().catch(() => "");
  const hasTwoUnpaidDays = /\b2\b/.test(rowText);
  const hasDeduction = /₹2,333|₹2333/.test(rowText);
  log("Payroll report shows 2 unpaid days for Ankit Sharma", hasTwoUnpaidDays, `row: ${rowText.replace(/\s+/g, " ")}`);
  log("Payroll report shows the correct ~₹2,333.33 deduction", hasDeduction, `row: ${rowText.replace(/\s+/g, " ")}`);

  await owner.screenshot({ path: "/root/panchmeru-studio/e2e-shots/leave-payroll-report.png", fullPage: true });

  // ---- Employee sees the unpaid-day notice on their own request ----
  await emp.goto(`${BASE}/leave`);
  const employeeNotice = await emp.locator("text=/2 days unpaid/").count();
  log("Employee sees the unpaid-days notice on their approved request", employeeNotice > 0);

  await browser.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
