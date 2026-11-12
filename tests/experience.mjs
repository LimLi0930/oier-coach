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
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
});
await context.addInitScript(() =>
  localStorage.setItem("oier-coach-notice", "2026-11-csp-scoring-v2"),
);
await mockVisits(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("test-results/screenshots", { recursive: true });
const query = (name) => new URL(page.url()).searchParams.get(name);
async function settled() {
  await expect(page.locator(".route-frame")).toHaveCount(1);
}
async function scrollAt(y) {
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 3);
  assert.ok(Math.abs((await page.evaluate(() => scrollY)) - y) < 3);
}
async function theme(name) {
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
try {
  await page.goto(
    `${origin}/?type=students&province=${encodeURIComponent("浙江")}&page=2`,
  );
  await expect(page.locator(".person-card")).toHaveCount(30);
  const card = page.locator(".person-card").nth(21);
  const personName = await card.locator("h3").innerText();
  const personPath = await card.getAttribute("href");
  await card.scrollIntoViewIfNeeded();
  const originalY = await page.evaluate(() => scrollY);
  await card.click();
  await expect(
    page.getByRole("dialog", { name: personName, exact: true }),
  ).toBeVisible();
  assert.ok(query("preview"));
  assert.equal(query("page"), "2");
  await expect(page.locator(".preview-metrics")).toBeVisible();
  await expect(page.locator(".preview-relations")).toBeVisible();
  await page.getByRole("link", { name: "查看完整主页" }).click();
  await expect(
    page.getByRole("heading", { name: personName, level: 1, exact: true }),
  ).toBeVisible();
  await settled();
  await expect(page.locator(".back-link")).toHaveText("返回搜索结果");
  await page.getByRole("combobox", { name: "查看年份" }).click();
  await page.getByRole("option", { name: "2025 年", exact: true }).click();
  await page.locator(".back-link").click();
  await expect(
    page.getByRole("dialog", { name: personName, exact: true }),
  ).toBeVisible();
  await settled();
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator(".person-preview")).toHaveCount(0);
  await scrollAt(originalY);
  assert.equal(query("page"), "2");
  assert.equal(query("province"), "浙江");
  await expect(
    page.locator(`.person-card[href="${personPath}"]`),
  ).toBeFocused();

  // Browser history and refresh restore the list and its preview.
  await page.locator(`.person-card[href="${personPath}"]`).click();
  const previewUrl = page.url();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: personName, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看完整主页" }).click();
  await expect(
    page.getByRole("heading", { name: personName, level: 1, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: personName, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator(".person-preview")).toHaveCount(0);
  await settled();
  await scrollAt(originalY);
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: personName, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".person-preview")).toHaveCount(0);
  await scrollAt(originalY);
  await page.reload();
  await expect(page.locator(".person-card")).toHaveCount(30);
  await scrollAt(originalY);

  // A shared preview has no prior local list history and closes safely in place.
  const shared = await browser.newPage();
  await mockVisits(shared.context());
  await shared.addInitScript(() =>
    localStorage.setItem("oier-coach-notice", "2026-11-csp-scoring-v2"),
  );
  await shared.goto(previewUrl);
  await expect(
    shared.getByRole("dialog", { name: personName, exact: true }),
  ).toBeVisible();
  await shared.getByRole("button", { name: "关闭预览" }).click();
  await expect(shared.locator(".person-preview")).toHaveCount(0);
  assert.equal(new URL(shared.url()).pathname, "/");
  assert.equal(new URL(shared.url()).searchParams.get("page"), "2");
  await shared.close();

  // Related-person trail remains in one preview history entry.
  await page.goto(origin + "/rankings/coaches");
  await expect(page.locator(".coach-row")).toHaveCount(30);
  await page.locator(".coach-identity").first().click();
  await expect(page.locator(".preview-related")).toHaveCount(3);
  const coachName = await page
    .locator('.preview-card[data-card-current="true"] .preview-person h2')
    .innerText();
  const historyCount = await page.evaluate(() => history.length);
  await page.locator(".preview-related").first().click();
  await expect(page.locator(".preview-stage")).not.toHaveCount(0);
  await expect(page.locator(".card-retreating")).toHaveCount(0);
  assert.equal(await page.evaluate(() => history.length), historyCount);
  await page.getByRole("button", { name: "返回上一位" }).click();
  await expect(
    page.locator('.preview-card[data-card-current="true"] .preview-person h2'),
  ).toHaveText(coachName);
  await page.getByRole("link", { name: "查看完整主页" }).click();
  await expect(page.locator(".back-link")).toHaveText("返回教练榜");
  await page.locator(".back-link").click();
  await expect(
    page.getByRole("dialog", { name: coachName, exact: true }),
  ).toBeVisible();
  await page.mouse.click(4, 200);
  await expect(page.locator(".person-preview")).toHaveCount(0);
  await page.goto(origin + "/student/oier-149374");
  await expect(page.locator(".back-link")).toHaveText("返回学生榜");

  // Province Chinese/pinyin/initial queries, keyboard, IME and cancellation.
  await page.goto(origin);
  const province = page.getByRole("combobox", { name: "省份", exact: true });
  for (const text of ["浙江", "zhejiang", "ZJ"]) {
    await province.click();
    await province.fill(text);
    await expect(
      page.getByRole("option", { name: "浙江", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(1);
    await province.press("Enter");
    await expect(province).toHaveValue("浙江");
  }
  await province.click();
  await province.fill("江");
  await expect(page.getByRole("option")).toHaveCount(4);
  await province.press("Escape");
  await expect(province).toHaveValue("浙江");
  await province.click();
  await province.fill("zzzz");
  await expect(page.getByText("没有匹配的省份")).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(province).toHaveValue("浙江");
  await province.click();
  await province.dispatchEvent("compositionstart");
  await province.fill("四川");
  await province.press("Enter");
  assert.equal(query("province"), "浙江");
  await province.dispatchEvent("compositionend", { data: "四川" });
  await province.press("Enter");
  await expect(province).toHaveValue("四川");
  await province.click();
  await province.fill("cq");
  await province.press("ArrowDown");
  await province.press("Enter");
  await expect(province).toHaveValue("重庆");
  await province.click();
  await province.fill("all");
  await province.press("Enter");
  await expect(page.locator(".search-start")).toBeVisible();

  // Persisted theme, automatic system changes and all responsive preview states.
  await theme("深色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await theme("跟随系统");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["浅色", "深色"]) {
      await page.goto(origin);
      await expect(page.locator(".search-start")).toBeVisible();
      await theme(mode);
      const footer = await page.locator(".site-footer").boundingBox();
      assert.ok(
        Math.abs(footer.y + footer.height - 900) < 2,
        `Footer is not bottom aligned at ${width}`,
      );
      for (const name of ["搜索", "教练榜", "学生榜"])
        await expect(
          page.getByRole("navigation").getByRole("link", { name, exact: true }),
        ).toBeVisible();
      await page.screenshot({
        path: `test-results/screenshots/theme-${mode}-${width}-search.png`,
      });
      await province.click();
      await province.fill("h");
      await page.screenshot({
        path: `test-results/screenshots/theme-${mode}-${width}-province.png`,
      });
      await province.press("Escape");
      await page.goto(origin + "/rankings/students");
      await expect(page.locator(".coach-row")).toHaveCount(30);
      await page.screenshot({
        path: `test-results/screenshots/theme-${mode}-${width}-students.png`,
      });
      await page.locator(".coach-identity").first().click();
      await expect(page.locator(".preview-stage")).not.toHaveCount(0);
      await page
        .locator(".person-preview")
        .evaluate((element) =>
          Promise.all(
            element
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished.catch(() => {})),
          ),
        );
      await page.screenshot({
        path: `test-results/screenshots/theme-${mode}-${width}-preview.png`,
      });
      const modal = await page.locator(".person-preview").boundingBox();
      assert.ok(
        modal.x >= 0 &&
          modal.x + modal.width <= width &&
          modal.y >= 0 &&
          modal.y + modal.height <= 901,
      );
      if (width === 390) assert.ok(Math.abs(modal.y + modal.height - 900) < 2);
      await page.getByRole("link", { name: "查看完整主页" }).click();
      await settled();
      await expect(page.locator(".profile-metrics")).toBeVisible();
      await page.screenshot({
        path: `test-results/screenshots/theme-${mode}-${width}-profile.png`,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
  }
  // Cached preview relationships are available even when the full-detail endpoint fails.
  const manifest = await (
    await page.request.get(origin + "/data/manifest.json", { timeout: 60000 })
  ).json();
  const failingDetail = `${origin}${manifest.dataPath}students/oier-149374.json`;
  await page.route(failingDetail, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto(`${origin}/?type=students&q=${encodeURIComponent("蒋明睿")}`);
  await page.locator(".person-card").first().click();
  await expect(
    page.getByRole("dialog", { name: "蒋明睿", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".preview-metrics")).toContainText("68,596.43");
  await expect(
    page.getByRole("heading", { name: "资料暂时加载失败" }),
  ).toHaveCount(0);
  await page.unroute(failingDetail);
  await expect(page.locator(".preview-stage")).not.toHaveCount(0);
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement?.closest(".person-preview"),
      ),
      true,
    );
  }
  await page.getByRole("button", { name: "关闭预览" }).click();

  // Modified clicks retain ordinary anchor behavior.
  const popupPromise = context.waitForEvent("page");
  await page
    .locator(".person-card")
    .first()
    .click({ modifiers: ["Control"] });
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { name: "蒋明睿", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".person-preview")).toHaveCount(0);
  await popup.close();

  // Both directions of the actual card animation, at every supported width.
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/?type=students&preview=student:oier-149374`);
    await expect(page.locator(".preview-stage a").first()).toBeVisible();
    await page
      .locator(".person-preview")
      .evaluate((element) =>
        Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
    await page.locator(".preview-stage a").first().click();
    await expect(page.locator(".card-arriving")).toBeVisible();
    const names = await page
      .locator(".preview-deck")
      .evaluate((deck) =>
        [...deck.querySelectorAll(".preview-card")].flatMap((card) =>
          card.getAnimations().map((animation) => animation.animationName),
        ),
      );
    assert.deepEqual(names.sort(), ["card-behind", "card-rise"]);
    assert.deepEqual(
      await page
        .locator(".preview-deck .preview-body")
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).scrollbarWidth),
        ),
      ["none", "none"],
    );
    assert.equal(
      await page.locator(".card-retreating").evaluate((card) => card.inert),
      true,
    );
    await page.locator(".preview-deck").evaluate((deck) =>
      deck.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause();
        animation.currentTime = 110;
      }),
    );
    await page.screenshot({
      path: `test-results/screenshots/card-transition-${width}.png`,
    });
    await page
      .locator(".preview-deck")
      .evaluate((deck) =>
        deck
          .getAnimations({ subtree: true })
          .forEach((animation) => animation.play()),
      );
    await expect(page.locator(".preview-card")).toHaveCount(1);
    assert.equal(
      await page
        .locator(".preview-card .preview-body")
        .evaluate((element) => getComputedStyle(element).scrollbarWidth),
      "auto",
    );
    await page.getByRole("button", { name: "返回上一位" }).click();
    await expect(page.locator(".card-arriving")).toBeVisible();
    assert.equal(
      await page.locator(".preview-deck").getAttribute("data-direction"),
      "backward",
    );
    await expect(page.locator(".preview-card")).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "蒋明睿", exact: true }),
    ).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".preview-stage a").first().click();
  await expect(page.getByRole("button", { name: "返回上一位" })).toBeVisible();
  await expect(page.locator(".preview-card")).toHaveCount(1);
  await expect(page.locator(".card-arriving,.card-retreating")).toHaveCount(0);
  await page.goto(origin + "/student/oier-104711");
  await expect(
    page.getByRole("heading", { name: "刘家炜", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "历学年指导教练", exact: true }),
  ).toBeVisible();
  const firstYear = page.locator(".guidance-stage").filter({
    has: page.getByRole("heading", {
      name: /^2023/,
    }),
  });
  await expect(firstYear.locator(".guidance-coach")).toHaveCount(2);
  const lastYear = page.locator(".guidance-stage").filter({
    has: page.getByRole("heading", {
      name: /^2025/,
    }),
  });
  await expect(lastYear.locator(".guidance-coach")).toHaveCount(3);
  const ioi = page
    .locator(".student-results-panel .result-row")
    .filter({ hasText: "IOI2026" });
  for (const name of ["黄新军", "刘雨俊", "党东"])
    await expect(ioi.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(ioi).toContainText("28,785.89");

  await page.goto(origin + "/student/oier-82575");
  await expect(
    page.getByRole("heading", { name: "许淇文", level: 1, exact: true }),
  ).toBeVisible();
  const xuIoi = page
    .locator(".student-results-panel .result-row")
    .filter({ hasText: "IOI2026" });
  await expect(xuIoi.locator(".result-coaches a")).toHaveCount(3);
  for (const name of ["曹蓉", "张超", "于露"])
    await expect(xuIoi.getByRole("link", { name, exact: true })).toBeVisible();

  // Empty search is one screen; filtering restores ordinary document scrolling.
  for (const [width, height] of [
    [1440, 900],
    [1440, 768],
    [1134, 783],
    [1280, 600],
    [768, 700],
    [390, 844],
    [390, 667],
    [375, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await expect(page.locator(".search-start")).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollHeight),
      height,
    );
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 500);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.getByLabel("姓名或拼音首字母").fill("黄");
    await expect(page.locator(".person-card")).toHaveCount(30);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollHeight > innerHeight,
      ),
    );
    await page.evaluate(() => window.scrollTo(0, 500));
    assert.ok(await page.evaluate(() => scrollY > 0));
    await page.getByRole("button", { name: "清空筛选", exact: true }).click();
    await expect(page.locator(".search-start")).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollHeight),
      height,
    );
    assert.equal(await page.evaluate(() => scrollY), 0);
  }

  await expect(page.locator(".visitor-counts")).toContainText("今日访问 12 人");
  await expect(page.locator(".visitor-counts")).toContainText("总访问 345 人");

  // Real touch targets for the province filter and phone sheet.
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await touchContext.addInitScript(() =>
    localStorage.setItem("oier-coach-notice", "2026-11-csp-scoring-v2"),
  );
  await mockVisits(touchContext);
  const touch = await touchContext.newPage();
  await touch.goto(origin);
  await touch.getByRole("combobox", { name: "省份", exact: true }).tap();
  await touch.getByRole("combobox", { name: "省份", exact: true }).fill("zj");
  await touch.getByRole("option", { name: "浙江", exact: true }).tap();
  await expect(touch.locator(".person-card")).toHaveCount(30);
  await touch.locator(".person-card").first().tap();
  await expect(touch.locator(".person-preview")).toBeVisible();
  await touch.getByRole("button", { name: "关闭预览" }).tap();
  await expect(touch.locator(".person-preview")).toHaveCount(0);
  await touchContext.close();
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/experience.json",
    JSON.stringify(
      {
        passed: true,
        widths: [1440, 768, 390],
        themes: ["light", "dark"],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Experience checks passed: preview trails, complete profiles, return/refresh/history scroll and focus, shared links, searchable province/IME, theme persistence/system and responsive screenshots.",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/screenshots/experience-failure.png",
    fullPage: true,
  });
  console.error("Failure URL", page.url());
  throw error;
} finally {
  await browser.close();
}
