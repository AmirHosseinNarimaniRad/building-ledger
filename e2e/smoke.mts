// End-to-end smoke test in real Chrome. Starts its own dev server, logs in with the code the
// console SMS sender prints, and walks the manager flows built so far.
//   npm run e2e            (needs Postgres up and migrated; Chrome installed)
//   E2E_SHOTS=dir npm run e2e   saves screenshots
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS;
// A 1×1 PNG: enough for upload, sniffing and serving.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

// --- dev server, with its stdout watched for SMS codes ---
const server = spawn("npx", ["next", "dev", "-p", String(PORT)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, what: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await waitFor(async () => ((await fetch(`${BASE}/login`).catch(() => null))?.ok ? true : undefined), "dev server");
  const context = await browser.newContext({ locale: "fa-IR", viewport: { width: 420, height: 900 } });
  const page = await context.newPage();

  // 1. Login with a fresh phone number.
  const phone = `0935${String(randomInt(10_000_000)).padStart(7, "0")}`;
  const e164 = `+98${phone.slice(1)}`;
  await page.goto(`${BASE}/app`);
  check(page.url().endsWith("/login"), "no session → /login");
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  const code = await waitFor(
    () => new RegExp(`\\[sms → \\${e164}\\] کد ورود شما: (\\d{6})`).exec(log)?.[1],
    "OTP in server log",
  );
  await page.getByLabel("کد ورود").fill(code);
  await shot(page, "01-login-code");
  await page.getByRole("button", { name: "ورود" }).click();
  await page.waitForURL("**/app/b/new");
  check(true, "OTP login → new building page");

  // 2. Building, then 20 units through the bulk grid.
  await page.getByLabel("نام ساختمان").fill("ساختمان تست e2e");
  await page.getByRole("button", { name: /ساخت و رفتن/ }).click();
  await page.waitForURL("**/units/bulk");
  const t0 = Date.now();
  await page.getByLabel("تعداد طبقه").fill("5");
  await page.getByLabel("واحد در هر طبقه").fill("4");
  await page.getByRole("button", { name: /ساخت ردیف‌ها/ }).click();
  // Type the area column top to bottom using Enter, like a person would.
  const rows = page.locator("tbody tr");
  await rows.nth(0).locator("input").nth(1).click();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.type(String(70 + i * 3));
    await page.keyboard.press("Enter");
  }
  await shot(page, "02-bulk-grid");
  await page.getByRole("button", { name: /ثبت ۲۰ واحد/ }).click();
  await page.waitForURL(/\/units$/);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  check((await page.getByRole("heading", { name: /واحدها/ }).textContent())?.includes("۲۰") ?? false, `20 units saved (${seconds}s scripted)`);
  await shot(page, "03-units");
  const areas = await page.locator("tbody tr td:nth-child(2)").allTextContents();
  const expected = Array.from({ length: 20 }, (_, i) => new Intl.NumberFormat("fa-IR").format(70 + i * 3));
  check(JSON.stringify(areas) === JSON.stringify(expected), "every typed area landed on its own unit");
  const buildingUrl = page.url().replace(/\/units$/, "");

  // 3. Manual expense, no document.
  await page.goto(`${buildingUrl}/expenses/new`);
  await page.getByRole("button", { name: "دستی" }).click();
  await page.getByLabel("مبلغ (تومان)").fill("۱٬۲۰۰٬۰۰۰");
  await page.getByLabel("بابت").fill("نظافت راه‌پله");
  await page.getByRole("button", { name: "ثبت هزینه" }).click();
  await page.waitForURL(/\/ledger$/);
  const cleaning = page.locator("article", { hasText: "نظافت راه‌پله" });
  check(await cleaning.getByText("سند بعداً می‌آید").isVisible(), "manual expense shows «سند بعداً می‌آید»");
  check(await cleaning.getByText(/دقیقه قابل ویرایش/).isVisible(), "new entry shows the draft badge");

  // 4. Attach its document later: a new event, the label turns green.
  await cleaning.getByRole("link", { name: "افزودن سند" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
  await page.waitForURL(/\/ledger$/);
  const cleaned = page.locator("article", { hasText: "نظافت راه‌پله" });
  check(await cleaned.getByText("مستند").isVisible(), "after attaching, label is «مستند»");
  await cleaned.getByText("تاریخچه تغییرات").click();
  check(await cleaned.getByText("ثبت اولیه").isVisible(), "history shows the original entry");
  check(await cleaned.getByText("سند اضافه شد").isVisible(), "history shows the document event");
  await shot(page, "04-ledger-after-attach");

  // 5. Expense from a photo: mock reader pre-fills, manager confirms.
  await page.goto(`${buildingUrl}/expenses/new`);
  await page.locator('input[type="file"]').setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "ثبت هزینه با سند" }).waitFor();
  check((await page.getByLabel("مبلغ (تومان)").inputValue()) === "۱٬۲۵۰٬۰۰۰", "photo pre-fills the amount");
  await shot(page, "05-photo-confirm");
  await page.getByRole("button", { name: "ثبت هزینه با سند" }).click();
  await page.waitForURL(/\/ledger$/);
  check(await page.locator("article", { hasText: "فروشگاه نمونه" }).getByText("مستند").isVisible(), "photo expense is «مستند»");

  // 6. A payment from a unit.
  await page.goto(`${buildingUrl}/payments/new`);
  await page.locator("select[name=unitId]").selectOption({ label: "۱۰۱" });
  await page.getByLabel("مبلغ (تومان)").fill("500000");
  await page.getByRole("button", { name: "ثبت دریافتی" }).click();
  await page.waitForURL(/\/ledger$/);
  check(await page.getByText("پرداخت واحد ۱۰۱").isVisible(), "payment appears in the ledger");

  // 7. Editing a draft changes it in place: no «ویرایش شده».
  await page.locator("article", { hasText: "پرداخت واحد ۱۰۱" }).getByRole("link", { name: "ویرایش" }).click();
  check(!(await page.getByLabel("دلیل تغییر").isVisible()), "draft edit asks for no reason");
  await page.getByLabel("مبلغ (تومان)").fill("600000");
  await page.getByRole("button", { name: "ذخیره" }).click();
  await page.waitForURL(/\/ledger$/);
  const pay = page.locator("article", { hasText: "پرداخت واحد ۱۰۱" });
  check((await pay.textContent())?.includes("۶۰۰٬۰۰۰") ?? false, "draft edit saved the new amount");
  check((await pay.getByText("ویرایش شده").count()) === 0, "draft edit leaves no «ویرایش شده»");
  await shot(page, "06-ledger");

  // 8. Document images: the manager gets them; nobody else does.
  const docHref = await page.locator("a", { hasText: "تصویر سند" }).first().getAttribute("href");
  const mine = await page.request.get(`${BASE}${docHref}`);
  check(mine.status() === 200 && mine.headers()["content-type"] === "image/png", "manager can open the document");
  const stranger = await (await browser.newContext()).request.get(`${BASE}${docHref}`);
  check(stranger.status() === 404, "no session → 404 for the document");
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
  server.kill();
}

if (/⨯|Unhandled|Error:/.test(log)) {
  console.log("--- server log had errors ---\n" + log.split("\n").filter((l) => /⨯|Error/.test(l)).slice(0, 10).join("\n"));
  failures++;
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
