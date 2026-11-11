import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const origin = process.env.TEST_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch(
  process.platform === "win32"
    ? { channel: "msedge", headless: true }
    : { headless: true },
);
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const manifest = await (await fetch(`${origin}/data/manifest.json`)).json();
const coaches = await (
  await fetch(origin + manifest.dataPath + manifest.index)
).json();
const students = await (
  await fetch(origin + manifest.dataPath + manifest.studentIndex)
).json();
const huang = coaches.find(
  (person) => person.name === "黄新军" && person.province === "重庆",
);
const jiang = students.find((person) => person.id === "oier-149374");
const unassigned = students.find(
  (person) => person.score !== null && person.coachCount === 0,
);
const pending = students.find(
  (person) => person.score === null && person.identityStatus !== "confirmed",
);
await mkdir("test-results/screenshots", { recursive: true });

const parameter = (name) => new URL(page.url()).searchParams.get(name);
async function select(label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function cleanLayout() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    `Horizontal overflow at ${page.viewportSize().width}px on ${page.url()}`,
  );
  await expect(page.locator("select:visible")).toHaveCount(0);
  const text = await page.locator("#main").innerText();
  assert.doesNotMatch(
    text,
    /归属依据与来源|资料来源与修订|按分数确定|上游完整赛事记录数|记录 ID|计分版本|数据更新于|名单原文|修订这场归属/,
  );
  if (new URL(page.url()).pathname !== "/rules")
    assert.doesNotMatch(text, /排名系数/);
}
async function screenshot(name) {
  await cleanLayout();
  await page.screenshot({
    path: `test-results/screenshots/${name}.png`,
    fullPage: !/select|tooltip/.test(name),
  });
}
async function profile(path, name) {
  await page.goto(origin + path);
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
}
async function board(entity) {
  await page.goto(`${origin}/rankings/${entity}`);
  await expect(page.locator(".coach-row")).toHaveCount(30);
  await expect(
    page.getByRole("link", { name: `Find ${entity}`, exact: true }),
  ).toHaveAttribute("href", `/?type=${entity}`);
}
async function alignedNavigation() {
  await expect
    .poll(() =>
      page.locator("nav").evaluate((nav) => {
        const active = nav
          .querySelector('[aria-current="page"]')
          .getBoundingClientRect();
        const indicator = nav
          .querySelector(".nav-indicator")
          .getBoundingClientRect();
        return (
          Math.abs(active.x - indicator.x) < 1 &&
          Math.abs(active.width - indicator.width) < 1
        );
      }),
    )
    .toBe(true);
}
async function verifyRows(expected) {
  await expect
    .poll(() =>
      page
        .locator(".coach-row .coach-identity")
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("href").split("/").pop()),
        ),
    )
    .toEqual(
      expected.slice(0, 30).map((person) => encodeURIComponent(person.id)),
    );
}
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "搜索教练与学生" }),
  ).toBeVisible();
  await expect(page.locator(".person-card")).toHaveCount(0);
  await expect(page.locator(".coach-row")).toHaveCount(0);
  await alignedNavigation();
  const motion = await page.locator("nav").evaluate(async (nav) => {
    nav.querySelector('a[href="/rankings/students"]').click();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return {
      navigation: nav
        .querySelector(".nav-indicator")
        .getAnimations()
        .map((animation) => animation.transitionProperty),
      pages: [...document.querySelectorAll(".route-frame")].flatMap((frame) =>
        frame.getAnimations().map((animation) => animation.animationName),
      ),
      outgoingInert: document.querySelector(".is-exiting")?.inert,
    };
  });
  assert.ok(
    motion.navigation.includes("transform"),
    "Navigation underline should animate horizontally",
  );
  assert.deepEqual(motion.pages.sort(), ["page-enter-right", "page-exit-left"]);
  assert.equal(motion.outgoingInert, true);
  await alignedNavigation();
  await expect(page.locator(".route-frame")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator(".page-viewport")).toHaveAttribute(
    "data-direction",
    "backward",
  );
  await expect(page.locator(".search-start")).toBeVisible();
  await alignedNavigation();
  await expect(page.locator(".route-frame")).toHaveCount(1);
  const search = page.getByLabel("姓名或拼音首字母");
  await page.goForward();
  await expect(page.locator(".page-viewport")).toHaveAttribute(
    "data-direction",
    "forward",
  );
  await expect(page.locator(".route-frame")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator(".page-viewport")).toHaveAttribute(
    "data-direction",
    "backward",
  );
  await expect(page.locator(".route-frame")).toHaveCount(1);
  const initialHistory = await page.evaluate(() => history.length);
  await search.fill("hx");
  await expect.poll(() => parameter("q")).toBe("hx");
  await expect(page.locator(".route-frame")).toHaveCount(1);
  await expect(page.locator(".is-entering, .is-exiting")).toHaveCount(0);
  await search.fill("hxj");
  await expect.poll(() => parameter("q")).toBe("hxj");
  assert.equal(await page.evaluate(() => history.length), initialHistory);
  await select("省份", "重庆");
  await expect(page.locator(".person-card")).toHaveCount(1);
  await expect(page.locator(".person-card")).toContainText("黄新军");
  await page.getByRole("button", { name: "学生", exact: true }).click();
  assert.equal(parameter("q"), "hxj");
  assert.equal(parameter("province"), "重庆");
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "教练", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "省份" })).toHaveValue(
    "全国 · 全部省份",
  );
  await search.fill("新军");
  await expect(page.getByText("没有找到符合条件的人物")).toBeVisible();
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(page.locator(".search-start")).toBeVisible();
  await search.dispatchEvent("compositionstart");
  await search.fill("黄");
  await page.waitForTimeout(350);
  assert.equal(parameter("q"), null);
  await search.dispatchEvent("compositionend", { data: "黄" });
  await expect.poll(() => parameter("q")).toBe("黄");
  await expect(page.locator(".person-card")).toHaveCount(30);
  const expectedSearch = coaches
    .filter((person) => person.name.startsWith("黄"))
    .sort(
      (a, b) =>
        (a.currentRank ?? Infinity) - (b.currentRank ?? Infinity) ||
        a.name.localeCompare(b.name, "zh-CN-u-co-pinyin") ||
        a.id.localeCompare(b.id),
    );
  assert.deepEqual(
    await page.locator(".person-card h3").allTextContents(),
    expectedSearch.slice(0, 30).map((person) => person.name),
  );
  await page.getByRole("button", { name: "下一页" }).click();
  assert.equal(parameter("page"), "2");
  await page.goBack();
  await expect.poll(() => parameter("page")).toBe(null);
  await search.fill("");
  await expect(page.locator(".search-start")).toBeVisible();
  await select("省份", "浙江");
  await expect(page.locator(".person-card")).toHaveCount(30);
  await page.getByRole("button", { name: "学生", exact: true }).click();
  await expect(page.locator(".person-card")).toHaveCount(30);
  assert.equal(parameter("province"), "浙江");
  const studentSearch = students
    .filter((person) => person.provinces.includes("浙江"))
    .sort(
      (a, b) =>
        (a.currentRank ?? Infinity) - (b.currentRank ?? Infinity) ||
        a.name.localeCompare(b.name, "zh-CN-u-co-pinyin") ||
        a.id.localeCompare(b.id),
    );
  await expect(page.locator(".person-card").first()).toHaveAttribute(
    "href",
    `/student/${studentSearch[0].id}`,
  );
  assert.deepEqual(
    await page.locator(".person-card h3").allTextContents(),
    studentSearch.slice(0, 30).map((person) => person.name),
  );
  await page.getByRole("button", { name: "清空筛选" }).click();
  await search.fill("jmr");
  await expect(
    page.locator(".person-card").filter({ hasText: "蒋明睿" }),
  ).toBeVisible();
  await page.locator(".person-card").filter({ hasText: "蒋明睿" }).click();
  await page.getByRole("link", { name: "查看完整主页" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "蒋明睿" }),
  ).toBeVisible();
  await expect(page.locator(".profile-metrics")).toContainText("68,596.43");

  for (const [entity, index] of [
    ["coaches", coaches],
    ["students", students],
  ]) {
    await board(entity);
    await verifyRows(index);
    await page.getByRole("button", { name: "下一页" }).click();
    await verifyRows(index.slice(30));
    await page.goBack();
    await verifyRows(index);
    await select("省份", "重庆");
    const filtered = index.filter((person) =>
      (person.provinces || [person.province]).includes("重庆"),
    );
    await verifyRows(filtered);
    await expect(
      page.locator(".coach-row").first().locator(".rank"),
    ).toHaveText(`#${filtered[0].currentRank.toLocaleString("zh-CN")}`);
    await page.getByRole("button", { name: "巅峰榜" }).click();
    const peak = [...filtered].sort(
      (a, b) =>
        (a.peakRank ?? Infinity) - (b.peakRank ?? Infinity) ||
        (a.currentRank ?? Infinity) - (b.currentRank ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
    await verifyRows(peak);
    await cleanLayout();
  }
  const crossProvince = students.find(
    (person) => person.currentRank !== null && person.provinces.length > 1,
  );
  for (const province of crossProvince.provinces) {
    await page.goto(
      `${origin}/?type=students&q=${encodeURIComponent(crossProvince.name)}&province=${encodeURIComponent(province)}`,
    );
    await expect(
      page.locator(`.person-card[href="/student/${crossProvince.id}"]`),
    ).toBeVisible();
  }
  await page.goto(`${origin}/?q=hxj`);
  await expect(
    page.locator(".person-card").filter({ hasText: "黄新军" }),
  ).toBeVisible();
  await page.goto(
    `${origin}/?board=peak&province=${encodeURIComponent("浙江")}`,
  );
  await expect(page).toHaveURL(/\/rankings\/coaches\?/);
  await expect(page.getByRole("button", { name: "巅峰榜" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  for (const [path, name] of [
    [`/coach/${huang.id}`, "黄新军"],
    [`/student/${jiang.id}`, "蒋明睿"],
  ]) {
    await profile(path, name);
    const chart = page.locator(".rank-chart");
    await chart.scrollIntoViewIfNeeded();
    const bounds = await chart.boundingBox();
    await page.mouse.move(bounds.x + 40, bounds.y + 80);
    await expect(page.getByRole("tooltip")).toContainText("全国名次");
    assert.equal(parameter("year"), null);
    await page.mouse.move(bounds.x + bounds.width - 16, bounds.y + 80);
    await expect(page.getByRole("tooltip")).toContainText("2026 年");
    const tooltip = await page.getByRole("tooltip").boundingBox();
    assert.ok(
      tooltip.x >= 0 && tooltip.x + tooltip.width <= page.viewportSize().width,
    );
    await page.setViewportSize({ width: 1440, height: 600 });
    await chart.evaluate((element) =>
      window.scrollBy(
        0,
        element.getBoundingClientRect().top - (innerHeight - 32),
      ),
    );
    const edge = await chart.boundingBox();
    await page.mouse.move(edge.x + 60, edge.y + 16);
    await expect(page.getByRole("tooltip")).toBeVisible();
    const edgeTooltip = await page.getByRole("tooltip").boundingBox();
    assert.ok(edgeTooltip.y >= 0 && edgeTooltip.y + edgeTooltip.height <= 600);
    await page.setViewportSize({ width: 1440, height: 900 });
    await chart.scrollIntoViewIfNeeded();
    await chart.focus();
    await page.keyboard.press("Home");
    const firstYearText = await page
      .getByRole("tooltip")
      .locator("strong")
      .innerText();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    assert.equal(
      Number(parameter("year")),
      Number(firstYearText.slice(0, 4)) + 1,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await select("查看年份", "2024 年");
    await expect(page.locator(".year-summary")).toContainText("2024 年");
    await page.getByRole("combobox", { name: "查看年份" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.getByRole("combobox", { name: "查看年份" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.mouse.click(3, 3);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await cleanLayout();
  }
  await profile(`/student/${jiang.id}`, "蒋明睿");
  const teacherLink = page.locator(".guidance-coach summary a").first();
  const teacherName = await teacherLink.innerText();
  await teacherLink.click();
  await expect(
    page.getByRole("heading", { level: 1, name: teacherName }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看全部学生" }).click();
  await page.locator(".student-info a").filter({ hasText: "蒋明睿" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "蒋明睿" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "OIerDB 主页" })).toHaveAttribute(
    "href",
    /149374$/,
  );
  await select("查看年份", "2025 年");
  await expect(page.locator(".student-results-panel .result-row")).toHaveCount(
    3,
  );
  for (const text of await page
    .locator(".student-results-panel .result-heading strong")
    .allTextContents()) {
    assert.ok(Number(text.match(/20\d\d/)[0]) <= 2025);
  }
  await profile(`/student/${unassigned.id}`, unassigned.name);
  await expect(page.locator(".student-results-panel")).toContainText(
    "教练待补充",
  );
  await expect(page.locator(".primary-metric")).not.toContainText("待补充");
  await profile(`/student/${encodeURIComponent(pending.id)}`, pending.name);
  await expect(page.locator(".chart-empty")).toContainText("暂无可计分");
  await expect(page.locator(".primary-metric")).toContainText("待补充");

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await expect(page.locator(".search-start")).toBeVisible();
    for (const name of ["搜索", "教练榜", "学生榜"]) {
      await expect(
        page.locator("nav").getByRole("link", { name, exact: true }),
      ).toBeVisible();
    }
    await screenshot(`search-start-${width}`);
    await alignedNavigation();
    const controls = await page
      .locator(".search-controls")
      .evaluate((element) => {
        const input = element
          .querySelector(".instant-search")
          .getBoundingClientRect();
        const select = element
          .querySelector(".select-trigger")
          .getBoundingClientRect();
        const label = element
          .querySelector(".province-control input")
          .getBoundingClientRect();
        const icon = element
          .querySelector(".province-control button")
          .getBoundingClientRect();
        return {
          inputHeight: input.height,
          selectHeight: select.height,
          inputTop: input.y,
          selectTop: select.y,
          inputLeft: input.x,
          selectLeft: select.x,
          labelCenter: label.y + label.height / 2,
          iconCenter: icon.y + icon.height / 2,
        };
      });
    assert.equal(controls.inputHeight, controls.selectHeight);
    assert.ok(Math.abs(controls.labelCenter - controls.iconCenter) < 1);
    assert.ok(
      width > 640
        ? controls.inputTop === controls.selectTop
        : controls.inputLeft === controls.selectLeft,
    );
    await search.fill("黄");
    await expect(page.locator(".person-card")).toHaveCount(30);
    await screenshot(`search-results-${width}`);
    await page.getByRole("combobox", { name: "省份" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await screenshot(`province-select-${width}`);
    await page.keyboard.press("Escape");
    for (const entity of ["coaches", "students"]) {
      await board(entity);
      if (entity === "students") {
        const heights = await page
          .locator(".coach-row")
          .evaluateAll((rows) =>
            rows.map((row) => row.getBoundingClientRect().height),
          );
        assert.equal(
          new Set(heights).size,
          1,
          `Student rows have different heights at ${width}px`,
        );
        for (const person of students
          .slice(0, 30)
          .filter((person) => person.coachCount > 0)) {
          const row = page.locator(".coach-row").filter({
            has: page.locator(`.coach-identity[href="/student/${person.id}"]`),
          });
          await expect(row.locator(".coach-names a")).toHaveCount(
            Math.min(2, person.coachCount),
          );
          await expect(row.locator(".coach-total")).toHaveText(
            `共 ${person.coachCount} 位`,
          );
        }
      }
      await screenshot(`${entity}-current-${width}`);
      await page.getByRole("button", { name: "巅峰榜" }).click();
      await screenshot(`${entity}-peak-${width}`);
    }
    for (const [kind, person] of [
      ["coach", huang],
      ["student", jiang],
    ]) {
      await profile(`/${kind}/${person.id}`, person.name);
      await screenshot(`${kind}-profile-${width}`);
      await page.locator(".rank-chart").scrollIntoViewIfNeeded();
      await page.locator(".rank-chart").focus();
      await page.keyboard.press("End");
      await screenshot(`${kind}-tooltip-${width}`);
      await page.keyboard.press("Escape");
    }
  }
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(`${origin}/student/${jiang.id}`);
  const touchChart = touchPage.locator(".rank-chart");
  await touchChart.scrollIntoViewIfNeeded();
  const touchBounds = await touchChart.boundingBox();
  await touchPage.touchscreen.tap(touchBounds.x + 40, touchBounds.y + 80);
  await expect(touchPage.getByRole("tooltip")).toBeVisible();
  await expect(touchPage).toHaveURL(/year=20\d\d/);
  await touchPage.screenshot({
    path: "test-results/screenshots/student-touch-390.png",
    fullPage: true,
  });
  await touchContext.close();
  await page.goto(`${origin}/?q=zzzz-no-match`);
  await expect(page.getByText("没有找到符合条件的人物")).toBeVisible();
  await screenshot("empty-390");
  const fail = `${origin}${manifest.dataPath}students/${jiang.id}.json`;
  await page.route(fail, (route) =>
    route.fulfill({ status: 503, body: "Temporary failure" }),
  );
  await page.goto(`${origin}/student/${jiang.id}`);
  await expect(
    page.getByRole("heading", { name: "资料暂时加载失败" }),
  ).toBeVisible();
  await screenshot("error-390");
  await page.unroute(fail);
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "蒋明睿" }),
  ).toBeVisible();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(fail, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`${origin}/student/${jiang.id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("status")).toBeVisible();
  await screenshot("loading-390");
  release();
  await expect(
    page.getByRole("heading", { level: 1, name: "蒋明睿" }),
  ).toBeVisible();
  await page.unroute(fail);
  for (const route of [
    "/rules",
    "/contribute",
    "/coach/invalid",
    "/student/invalid",
  ]) {
    await page.goto(origin + route);
    await page.locator("h1").waitFor();
    await cleanLayout();
  }
  const cachePage = await context.newPage();
  const requests = { coaches: 0, students: 0 };
  cachePage.on("request", (request) => {
    for (const entity of ["coaches", "students"]) {
      if (request.url() === `${origin}${manifest.dataPath}${entity}.json`)
        requests[entity] += 1;
    }
  });
  await cachePage.goto(origin);
  for (const name of ["教练榜", "学生榜", "搜索", "教练榜", "学生榜"]) {
    await cachePage
      .locator("nav")
      .getByRole("link", { name, exact: true })
      .click();
    if (name !== "搜索")
      await expect(cachePage.locator(".coach-row")).toHaveCount(30);
  }
  assert.deepEqual(requests, { coaches: 1, students: 1 });
  for (const target of ["/", "/rankings/coaches", "/rankings/students"]) {
    await cachePage
      .locator(`nav a[href="${target}"]`)
      .evaluate((link) => link.click());
    await cachePage.waitForTimeout(40);
  }
  await expect(cachePage.locator(".route-frame")).toHaveCount(1);
  await expect(
    cachePage.getByRole("heading", { name: "学生榜", exact: true }),
  ).toBeVisible();
  await expect(cachePage.locator("[inert]")).toHaveCount(0);
  await cachePage.close();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin);
  await page.locator('nav a[href="/rankings/coaches"]').click();
  await alignedNavigation();
  await expect(page.locator(".route-frame")).toHaveCount(1);
  await expect(page.locator(".is-entering, .is-exiting")).toHaveCount(0);
  assert.equal(
    await page
      .locator(".nav-indicator")
      .evaluate((element) => getComputedStyle(element).transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/browser.json",
    JSON.stringify(
      {
        passed: true,
        widths: [1440, 768, 390],
        consoleErrors: errors,
        dataVersion: manifest.version,
      },
      null,
      2,
    ),
  );
  console.log(
    "Browser checks passed: instant/IME search, prefix matching, URL history, both entity boards, current/peak ranks, historic provinces, profiles, bidirectional links, custom selects, hover/keyboard/touch chart, pending/empty/error/retry/loading states and responsive screenshots.",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/screenshots/failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
