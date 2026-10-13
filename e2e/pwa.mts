// Installability check against a production build: Chrome's own verdict, plus the manifest,
// icons, service worker and offline behaviour.
//   npm run build && npm run e2e:pwa
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

// A real (persistent) profile: Chrome never offers to install from an incognito-like context.
const profile = await mkdtemp(path.join(tmpdir(), "ledger-pwa-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true, ...devices["Pixel 7"], locale: "fa-IR" });
try {
  for (let i = 0; i < 60 && !(await fetch(`${BASE}/login`).catch(() => null))?.ok; i++) await new Promise((r) => setTimeout(r, 500));

  // Manifest and icons.
  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  check(manifest.display === "standalone" && manifest.start_url === "/app" && manifest.dir === "rtl", "manifest: standalone, starts at /app, RTL");
  for (const icon of manifest.icons) {
    const res = await fetch(`${BASE}${icon.src}`);
    check(res.ok && res.headers.get("content-type") === "image/png", `icon ${icon.sizes} ${icon.purpose} serves`);
  }
  check(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable"), "has a maskable icon for Android");

  const sw = await fetch(`${BASE}/sw.js`);
  check(sw.ok && /no-store/.test(sw.headers.get("cache-control") ?? ""), "sw.js is served and never cached");

  // Chrome's own installability verdict, on an Android phone profile.
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const swReady = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10_000))]);
    return !!reg;
  });
  check(swReady, "service worker registers and activates");
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: { errorId: string }[];
  };
  check(installabilityErrors.length === 0, `Chrome reports it installable${installabilityErrors.length ? `: ${installabilityErrors.map((e) => e.errorId).join(", ")}` : ""}`);
  const theme = await page.locator('meta[name="theme-color"]').getAttribute("content");
  check(theme?.toLowerCase() === "#0f5c8c", "theme colour set for the Android status bar");

  // Offline: navigations fall back to the offline page; nothing private comes from cache.
  await page.reload({ waitUntil: "networkidle" }); // let the worker control the page
  await ctx.setOffline(true);
  await page.goto(`${BASE}/app`).catch(() => {});
  check((await page.locator("main").textContent())?.includes("اتصال به اینترنت برقرار نیست") ?? false, "offline: shows the offline page");
  await ctx.setOffline(false);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  check(cached.every((u) => u === "/offline" || u.startsWith("/_next/static/") || u.startsWith("/icons/")), `cache holds no pages or data (${cached.length} entries)`);
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await ctx.close();
  await rm(profile, { recursive: true, force: true });
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
