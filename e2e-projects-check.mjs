import { chromium } from "playwright";
import fs from "fs";

const BASE = "http://localhost:3000";
const launchOptions = fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium", headless: true } : { headless: true };

function log(step, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${step}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const browser = await chromium.launch(launchOptions);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="text"]', "owner@panchmeru.studio");
  await page.fill('input[type="password"]', "Panchmeru@123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 10000 });

  const suffix = Date.now().toString().slice(-6);
  await page.goto(`${BASE}/projects/new`);
  await page.fill('input[name="name"]', `E2E Project ${suffix}`);
  await page.click('button:has-text("Create project")');
  await page.waitForURL(/\/projects\/[a-f0-9-]+$/, { timeout: 10000 });
  log("Owner creates a project and lands on its detail page", true, page.url());

  await page.fill('input[name="name"]', "Design brief signed off");
  await page.click('button:has-text("Add")');
  await page.waitForTimeout(500);
  const milestoneShown = await page.locator("text=Design brief signed off").count();
  log("Owner adds a milestone", milestoneShown > 0);

  await page.locator("li", { hasText: "Design brief signed off" }).locator("button").click();
  await page.waitForTimeout(500);
  const cycled = await page.locator("text=in progress").count();
  log("Milestone status cycles on click", cycled > 0);

  const select = page.locator("select").filter({ hasText: "Choose employee" }).first();
  await select.selectOption({ label: "Ankit Sharma" });
  await page.locator('button:has-text("Add")').last().click();
  await page.waitForTimeout(500);
  const memberShown = await page.locator("text=Ankit Sharma").count();
  log("Owner adds a team member to the project", memberShown > 0);

  await page.goto(`${BASE}/projects`);
  const listed = await page.locator(`text=E2E Project ${suffix}`).count();
  log("New project appears in the projects list", listed > 0);

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
