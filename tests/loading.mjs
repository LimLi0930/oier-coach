import { mockVisits } from "./support.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 30000 });
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch(
  process.platform === "win32"
    ? { channel: "msedge", headless: true }
    : { headless: true },
);
const manifest = await (await fetch(origin + "/data/manifest.json")).json();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await mockVisits(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const requested = [];
page.on("request", (request) => requested.push(request.url()));
await mkdir("test-results/screenshots", { recursive: true });
const waitForDirectories = async () =>
  expect
    .poll(
      () =>
        page.evaluate(async (prefix) => {
          const names = (await caches.keys()).filter((name) => name === prefix);
          if (!names.length) return 0;
          return (await (await caches.open(prefix)).keys()).length;
        }, "oier-coach-directory-" + manifest.version),
      { timeout: 30000 },
    )
    .toBe(2);
try {
  await page.goto(origin + "/?type=students&preview=student:oier-82575");
  await expect(
    page.getByRole("dialog", { name: "欢迎使用 OIer Coach", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const notice = page.locator(".site-notice");
  for (const text of [
    "CSP-J／S",
    "仅供参考娱乐，不构成实际对比和意见",
    "1.25",
    "401",
    "IOI 权重为 1",
    "NOI 及夏令营／D 类为 0.7",
    "官方公开名单",
    "PR",
  ])
    await expect(notice).toContainText(text);
  await expect(
    notice.getByRole("link", { name: "阅读贡献指南并提交 PR" }),
  ).toHaveAttribute("href", /\/blob\/main\/CONTRIBUTING.md$/);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const color of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: color });
      const box = await notice.boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.x + box.width <= width &&
          box.y >= 0 &&
          box.y + box.height <= 900,
      );
      await page.waitForTimeout(180);
      await page.screenshot({
        path: `test-results/screenshots/notice-${color}-${width}.png`,
      });
    }
  }
  await waitForDirectories();
  await page.getByRole("button", { name: "我已了解，开始使用" }).click();
  await expect(
    page.getByRole("dialog", { name: "许淇文", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".preview-stage")).not.toHaveCount(0);
  const before = requested.length;
  const related = page.locator(".preview-stage a").first();
  const teacherName = await related.innerText();
  await related.click();
  await expect(
    page.getByRole("dialog", { name: teacherName.trim(), exact: true }),
  ).toBeVisible();
  await expect(page.locator(".preview-related")).not.toHaveCount(0);
  assert.deepEqual(
    requested.slice(before).filter((url) => /\/(coaches|students)\//.test(url)),
    [],
  );
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.getByRole("button", { name: "收录公告", exact: true }).click();
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "我已了解，开始使用" }).click();

  // A new page uses the persistent directory without downloading it again.
  const reloaded = context.newPage();
  const warm = await reloaded;
  const directoryRequests = [];
  warm.on("request", (request) => {
    if (request.url().endsWith("-directory.json"))
      directoryRequests.push(request.url());
  });
  await warm.goto(origin + "/?type=students&q=" + encodeURIComponent("庄榕程"));
  await expect(warm.locator(".person-card").first()).toBeVisible();
  await expect(warm.locator(".site-notice")).toHaveCount(0);
  await warm.route("**/students/*.json", (route) => route.abort());
  await warm.route("**/coaches/*.json", (route) => route.abort());
  await warm.locator(".person-card").first().click();
  await expect(warm.locator(".preview-stage")).not.toHaveCount(0);
  await expect(
    warm.getByRole("heading", { name: "正在加载师生信息" }),
  ).toHaveCount(0);
  assert.deepEqual(directoryRequests, []);
  await warm.close();

  // New versions must fetch new directories instead of reusing old snapshots.
  const nextVersion = "0000000000000001";
  let versionRequests = 0;
  await page.route("**/data/manifest.json", (route) =>
    route.fulfill({
      json: {
        ...manifest,
        version: nextVersion,
        dataPath: `/data/${nextVersion}/`,
      },
    }),
  );
  await page.route(`**/data/${nextVersion}/*-directory.json`, async (route) => {
    versionRequests++;
    const response = await route.fetch({
      url: route
        .request()
        .url()
        .replace(`/data/${nextVersion}/`, manifest.dataPath),
    });
    await route.fulfill({ response });
  });
  await page.goto(origin + "/?type=students&q=" + encodeURIComponent("许淇文"));
  await expect(page.locator(".person-card").first()).toBeVisible();
  await expect.poll(() => versionRequests).toBe(2);
  await page.unroute("**/data/manifest.json");
  await page.unroute(`**/data/${nextVersion}/*-directory.json`);

  // Storage restrictions fall back to normal network loading.
  const restricted = await browser.newContext();
  await restricted.addInitScript(() => {
    Object.defineProperty(window, "caches", {
      value: { open: () => Promise.reject(new Error("Storage disabled")) },
    });
    localStorage.setItem("oier-coach-notice", "2026-11-csp-scoring-v2");
  });
  await mockVisits(restricted);
  const restrictedPage = await restricted.newPage();
  await restrictedPage.goto(origin + "/?q=hxj");
  await expect(
    restrictedPage.locator(".person-card").filter({ hasText: "黄新军" }),
  ).toBeVisible();
  await restricted.close();

  // A failed initial directory request is retryable while the notice is already read.
  const failed = await browser.newContext();
  await failed.addInitScript(() =>
    localStorage.setItem("oier-coach-notice", "2026-11-csp-scoring-v2"),
  );
  await mockVisits(failed);
  const failedPage = await failed.newPage();
  await failedPage.route("**/students-directory.json", (route) =>
    route.fulfill({ status: 503, body: "Temporary error" }),
  );
  await failedPage.goto(origin + "/?type=students&q=jmr");
  await expect(
    failedPage.getByRole("heading", { name: "资料暂时加载失败" }),
  ).toBeVisible();
  await failedPage.unroute("**/students-directory.json");
  await failedPage
    .getByRole("button", { name: "重新加载", exact: true })
    .click();
  await expect(
    failedPage.locator(".person-card").filter({ hasText: "蒋明睿" }),
  ).toBeVisible();
  await failed.close();
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/loading.json",
    JSON.stringify(
      {
        passed: true,
        version: manifest.version,
        warmDirectoryRequests: directoryRequests.length,
        versionRequests,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Loading checks passed: first-visit notice, re-open, cached instant relationships, new-tab persistence, version invalidation, denied storage and retry.",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/screenshots/loading-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await browser.close();
}
