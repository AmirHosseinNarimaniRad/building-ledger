// End-to-end smoke test in real Chrome. Starts its own dev server, logs in with the code the
// console SMS sender prints, and walks the manager flows built so far.
//   npm run e2e            (needs Postgres up and migrated; Chrome installed)
//   E2E_SHOTS=dir npm run e2e   saves screenshots
//   Against a running deployment instead of a dev server:
//   E2E_BASE_URL=https://localhost:8443 E2E_LOG_CMD="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs -f --no-log-prefix app" npm run e2e
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const PORT = 3100;
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
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

// --- dev server (or a deployment's log stream), watched for SMS codes ---
const server = process.env.E2E_BASE_URL
  ? spawn("sh", ["-c", process.env.E2E_LOG_CMD ?? "true"], { stdio: ["ignore", "pipe", "pipe"] })
  : spawn("npx", ["next", "dev", "-p", String(PORT)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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
// Local deployments use a self-signed certificate.
const tls = { ignoreHTTPSErrors: BASE.startsWith("https://localhost") };
try {
  if (tls.ignoreHTTPSErrors) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  await waitFor(async () => ((await fetch(`${BASE}/login`).catch(() => null))?.ok ? true : undefined), "server");
  // No reverse proxy in dev: give this run its own client address, as nginx would via X-Real-IP,
  // so repeated runs don't hit the 5-codes-an-hour login limit.
  const runIp = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
  const context = await browser.newContext({
    ...tls,
    locale: "fa-IR",
    viewport: { width: 420, height: 900 },
    extraHTTPHeaders: { "x-real-ip": runIp },
  });
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

  // 7. Editing a draft changes it in place: no "edited" badge.
  await page.locator("article", { hasText: "پرداخت واحد ۱۰۱" }).getByRole("link", { name: "ویرایش" }).click();
  check(!(await page.getByLabel("دلیل تغییر").isVisible()), "draft edit asks for no reason");
  await page.getByLabel("مبلغ (تومان)").fill("600000");
  await page.getByRole("button", { name: "ذخیره" }).click();
  await page.waitForURL(/\/ledger$/);
  const pay = page.locator("article", { hasText: "پرداخت واحد ۱۰۱" });
  check((await pay.textContent())?.includes("۶۰۰٬۰۰۰") ?? false, "draft edit saved the new amount");
  check((await pay.getByText("ویرایش شده").count()) === 0, "draft edit leaves no edited badge");
  await shot(page, "06-ledger");

  // 8. Document images: the manager gets them; nobody else does.
  const docHref = await page.locator("a", { hasText: "تصویر سند" }).first().getAttribute("href");
  const mine = await page.request.get(`${BASE}${docHref}`);
  check(mine.status() === 200 && mine.headers()["content-type"] === "image/png", "manager can open the document");
  const stranger = await (await browser.newContext(tls)).request.get(`${BASE}${docHref}`);
  check(stranger.status() === 404, "no session → 404 for the document");

  // ---------------- step 5: charge, SMS link, resident page ----------------
  // 9. Give unit 101 a phone so it gets the SMS.
  const residentPhone = `0912${String(randomInt(10_000_000)).padStart(7, "0")}`;
  await page.goto(`${buildingUrl}/units`);
  await page.locator("tr", { hasText: "۱۰۱" }).first().getByRole("link", { name: "ویرایش" }).click();
  await page.getByLabel("موبایل ساکن").fill(residentPhone);
  await page.getByRole("button", { name: "ذخیره" }).click();
  await page.waitForURL(/\/units$/);

  // 10. Issue this month's charge: preview first, then confirm.
  await page.goto(`${buildingUrl}/charges/new`);
  await page.getByLabel("مبلغ کل شارژ ماه (تومان)").fill("20000000");
  check(await page.getByRole("button", { name: /تأیید، صدور/ }).isDisabled(), "confirm is disabled until a preview is shown");
  await page.getByRole("button", { name: "پیش‌نمایش سهم هر واحد" }).click();
  await page.locator("td", { hasText: "جمع" }).waitFor();
  const previewRows = await page.locator("tbody tr").count();
  const previewTotal = await page.locator("tr", { hasText: "جمع" }).locator("td").nth(1).textContent();
  check(previewRows === 21 && previewTotal === "۲۰٬۰۰۰٬۰۰۰ تومان", "preview lists 20 units and sums to exactly the total");
  await shot(page, "07-charge-preview");
  await page.getByRole("button", { name: /تأیید، صدور/ }).click();
  await page.waitForURL(/\/charges\?sent=1/);
  check(await page.getByText("برای ۱ واحد پیامک فرستاده شد").isVisible(), "charge issued, 1 SMS sent");

  // 11. The SMS carries the resident link.
  const smsE164 = `+98${residentPhone.slice(1)}`;
  // Two lines: the amount, then the link.
  const sms = await waitFor(() => new RegExp(`\\[sms → \\${smsE164}\\] (شارژ [^\\n]*\\n[^\\n]*/r/[A-Za-z0-9_-]{22})`).exec(log)?.[1], "charge SMS");
  const link = /(http\S+\/r\/[A-Za-z0-9_-]{22})$/.exec(sms)?.[1];
  check(!!link && sms.length <= 134, `charge SMS has the link and fits 2 parts (${sms.length} chars)`);
  const residentPath = new URL(link!).pathname;

  // 12. A fresh expense after the charge: still a draft until a resident sees it.
  await page.goto(`${buildingUrl}/expenses/new`);
  await page.getByRole("button", { name: "دستی" }).click();
  await page.getByLabel("مبلغ (تومان)").fill("350000");
  await page.getByLabel("بابت").fill("خرید لامپ");
  await page.getByRole("button", { name: "ثبت هزینه" }).click();
  await page.waitForURL(/\/ledger$/);
  check(await page.locator("article", { hasText: "خرید لامپ" }).getByText(/دقیقه قابل ویرایش/).isVisible(), "new expense is a draft");

  // 13. Open the link as a stranger: no login, no cookies.
  const residentCtx = await browser.newContext({ ...tls, locale: "fa-IR", viewport: { width: 420, height: 900 } });
  const resident = await residentCtx.newPage();
  const resp = await resident.goto(`${BASE}${residentPath}`);
  const h = resp!.headers();
  check(resp!.status() === 200, "resident link opens without login");
  check(h["x-robots-tag"]?.includes("noindex") && h["referrer-policy"] === "no-referrer", "noindex + no-referrer headers on /r/*");
  const body = (await resident.locator("main").textContent()) ?? "";
  check(body.includes("واحد ۱۰۱") && body.includes("سهم شما") && body.includes("نحوه محاسبه"), "shows this unit's bill and how it was calculated");
  check(body.includes("خرید لامپ") && body.includes("نظافت راه‌پله") && body.includes("مانده صندوق"), "shows the building's expenses and fund balance");
  check(!/واحد (۱۰[234]|[۲-۵]۰[۱-۴])/.test(body), "no other unit appears anywhere on the page");
  check((await resident.locator('a[href^="/app"]').count()) === 0, "no link into the manager's space");
  check(!body.includes("قابل ویرایش"), "residents never see a draft badge");
  await shot(resident, "08-resident");

  // 14. Documents through the link; a made-up token gets nothing.
  const rDoc = await resident.locator("a", { hasText: "تصویر سند" }).first().getAttribute("href");
  check((await resident.request.get(`${BASE}${rDoc}`)).status() === 200, "resident can open a document image");
  const forged = rDoc!.replace(/\/r\/[^/]+\//, "/r/AAAAAAAAAAAAAAAAAAAAAA/");
  check((await resident.request.get(`${BASE}${forged}`)).status() === 404, "forged token → 404 for the document");

  // 15. What the resident saw is now locked: the draft badge is gone for the manager.
  await page.goto(`${buildingUrl}/ledger`);
  check((await page.locator("article", { hasText: "خرید لامپ" }).getByText(/دقیقه قابل ویرایش/).count()) === 0, "viewing the resident page locked the draft");

  // 16. Unknown and revoked links look exactly the same.
  await resident.goto(`${BASE}/r/AAAAAAAAAAAAAAAAAAAAAA`);
  const unknownText = await resident.locator("main").textContent();
  await resident.goto(`${BASE}/r/not-even-a-token`);
  check(unknownText?.includes("این لینک معتبر نیست") === true && (await resident.locator("main").textContent()) === unknownText, "invalid links all get the same page");

  // ---------------- step 6: arrears, reminders, report ----------------
  // 18. Unit 101 was charged 1,000,000 and paid 600,000: it owes 400,000.
  await page.goto(`${buildingUrl}/arrears`);
  const owe = page.locator("div.rounded-2xl", { hasText: "واحد ۱۰۱" });
  check((await owe.textContent())?.includes("۴۰۰٬۰۰۰ تومان") ?? false, "arrears lists ۱۰۱ owing ۴۰۰٬۰۰۰");
  const remindStart = log.length;
  await owe.getByRole("button", { name: "یادآور پیامکی" }).click();
  await page.waitForURL(/\/arrears\?sent=1/);
  const reminder = await waitFor(() => new RegExp(`\\[sms → \\${smsE164}\\] (یادآوری بدهی[^\\n]*\\n[^\\n]*/r/[A-Za-z0-9_-]{22})`).exec(log.slice(remindStart))?.[1], "reminder SMS");
  check(reminder.startsWith("یادآوری بدهی شارژ ساختمان: ۴۰۰٬۰۰۰ تومان\n") && reminder.endsWith(residentPath), "reminder SMS has the debt and the same link");
  check(await page.locator("div.rounded-2xl", { hasText: "واحد ۱۰۱" }).getByText(/یادآور فرستاده شد/).isVisible(), "a second reminder is held back for 24 hours");
  await shot(page, "09-arrears");

  // 19. Monthly report reconciles on screen, and prints without the app chrome.
  await page.goto(`${buildingUrl}/report`);
  const report = (await page.locator("article").textContent()) ?? "";
  check(report.includes("مانده صندوق در ابتدای ماه") && report.includes("مانده صندوق در پایان ماه"), "report shows opening and closing balance");
  check(report.includes("خرید لامپ") && report.includes("نظافت راه‌پله"), "report lists the month's expenses");
  await page.emulateMedia({ media: "print" });
  check(!(await page.getByText("دفتر شفاف ساختمان").first().isVisible()) && !(await page.getByRole("button", { name: /چاپ/ }).isVisible()), "print view hides the header, nav and buttons");
  await shot(page, "10-report-print");
  await page.pdf({ path: path.join(SHOTS ?? "/tmp", "report.pdf"), format: "A4" }).catch(() => {});
  await page.emulateMedia({ media: "screen" });

  // 17. Rate limit: 30 a minute per IP on /r/*.
  const codes: number[] = [];
  for (let i = 0; i < 35; i++) codes.push((await fetch(`${BASE}/r/AAAAAAAAAAAAAAAAAAAAAA`)).status);
  check(codes.includes(429), "rate limit kicks in on /r/*");
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
