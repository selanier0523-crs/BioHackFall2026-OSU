import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function enter(page: Page, role = "caregiver") {
  await page.goto("/?local");
  await page
    .getByRole("button", {
      name: `Enter ${role === "clinician" ? "Clinician" : role} demo`,
      exact: true,
    })
    .click();
}
const state = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("ng-tube-assistant-v1")!),
  );
async function controls(page: Page) {
  const d = page.locator(".demo-controls");
  if ((await d.getAttribute("open")) === null)
    await d.locator("summary").click();
  return d;
}
async function configure(page: Page, id = "P01") {
  await page.getByRole("button", { name: "Clinician", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  const d = await controls(page);
  await d
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption(id);
  await d
    .getByRole("combobox", { name: "Playback speed", exact: true })
    .selectOption("20");
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
}
async function check(page: Page) {
  await page
    .getByRole("button", { name: "Check tube placement", exact: true })
    .click();
  await page.clock.runFor(1300);
  await expect(
    page.getByRole("button", { name: "Continue to feeding", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue to feeding", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start feeding", exact: true }),
  ).toBeVisible();
}
test("caregiver follows check, feeding, monitoring and a later fresh check without videos", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto("/?local");
  await page.getByLabel("Username").fill("caregiver");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Enter demo", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("password 123");
  await page.getByLabel("Password", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Enter demo", exact: true }).click();
  await expect(page.locator(".patient")).toHaveText("Caregiver");
  await expect(page.getByText("Alex Demo", { exact: true })).toHaveCount(0);
  await expect(
    page.locator(".demo-controls, .storage-strip, .sensor-details"),
  ).toHaveCount(0);
  await expect(page.locator(".sidebar nav button")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Feeding reminder" }),
  ).toContainText("Feeding in 5 min");
  await expect(
    page.getByRole("region", { name: "Feeding reminder" }),
  ).toContainText("Instructions from Clinician");
  await expect(
    page.getByRole("region", { name: "Feeding reminder" }),
  ).toContainText("Placement confirmation is a separate required workflow.");
  await configure(page);
  await check(page);
  expect(
    (await state(page)).assignments.every(
      (a: { viewed: boolean }) => !a.viewed,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Start feeding", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Feeding in progress.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Feeding reminder" }),
  ).toContainText("Instructions from Clinician");
  await expect(
    page.getByRole("region", { name: "Feeding reminder" }),
  ).not.toContainText("Feeding due");
  await page
    .getByRole("button", { name: "Pause feeding", exact: true })
    .click();
  const paused = await state(page);
  await page.clock.runFor(1000);
  expect((await state(page)).sessions[0].volume).toBe(
    paused.sessions[0].volume,
  );
  expect((await state(page)).index).toBe(paused.index);
  await page.getByRole("button", { name: "Clinician", exact: true }).click();
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  expect((await state(page)).index).toBe(paused.index);
  await page
    .getByRole("button", { name: "Resume feeding", exact: true })
    .click();
  await page.clock.runFor(91000);
  const done = await state(page);
  expect(done.sessions[0].status).toBe("COMPLETED");
  expect(done.sessions[0].volume).toBeCloseTo(30, 6);
  await expect(
    page.getByRole("heading", { name: "Feeding complete.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start feeding", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check tube for next feed", exact: true })
    .click();
  await page.clock.runFor(1300);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue to feeding", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start feeding", exact: true })
    .click();
  expect((await state(page)).checks[1].kind).toBe("Pre-feed");
  expect((await state(page)).tubeInserted).toBe(true);
  await page
    .getByRole("button", { name: "Pause feeding", exact: true })
    .click();
  const saved = await state(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume feeding", exact: true }),
  ).toBeVisible();
  expect((await state(page)).index).toBe(saved.index);
  await page
    .getByRole("button", { name: "Resume feeding", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop feeding", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Feeding ended.", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("Videos are separate and have no demo controls in either view", async ({
  page,
}) => {
  await enter(page);
  await page.getByRole("button", { name: "Videos", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your videos", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-controls, .install")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open resource", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("No actual video is playing.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark viewed", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Feeding", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check tube placement", exact: true }),
  ).toBeVisible();
  expect((await state(page)).checks).toHaveLength(0);
  await page.getByRole("button", { name: "Clinician", exact: true }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.locator(".demo-controls")).toHaveCount(0);
});
test("unsafe and incomplete placement blocks caregiver feeding", async ({
  page,
}) => {
  await page.clock.install();
  await enter(page);
  for (const [id, text] of [
    ["P02", "Do not proceed — possible airway placement"],
    ["P08", "Do not proceed — possible airway placement"],
    ["P03", "Do not proceed — placement check incomplete"],
    ["P04", "Do not proceed — placement check incomplete"],
    ["P05", "Indicators compatible with stomach placement"],
    ["P06", "Do not proceed — sensor data unavailable"],
  ]) {
    await configure(page, id);
    await page
      .getByRole("button", { name: "Check tube placement", exact: true })
      .click();
    await page.clock.runFor(id === "P06" ? 1000 : 1400);
    await expect(
      page.getByRole("heading", { name: text, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start feeding", exact: true }),
    ).toHaveCount(0);
    if (id !== "P05")
      await expect(
        page.getByRole("button", { name: "Continue to feeding", exact: true }),
      ).toHaveCount(0);
  }
});
test("clinician plan edits and video assignments reach caregiver", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?local");
  await page.getByLabel("Username").fill("clinician");
  await page.getByLabel("Password", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Enter demo", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit plan", exact: true })
    .first()
    .click();
  await page.getByLabel("Amount (mL)", { exact: true }).fill("45");
  await page.getByLabel("Written instructions").fill("Fictional updated plan.");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Feeding reminder" }),
  ).toContainText("Fictional updated plan.");
  await configure(page);
  await check(page);
  await expect(
    page.getByText("Fictional updated plan.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clinician", exact: true }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Topic", exact: true })
    .selectOption("Responding to an alert");
  await page.getByLabel("Short note").fill("Review demo alert actions.");
  await page
    .getByRole("button", { name: "Assign resource", exact: true })
    .click();
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  await expect(
    page.getByText("Review demo alert actions.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark viewed", exact: true })
    .last()
    .click();
  expect((await state(page)).assignments.at(-1).viewed).toBe(true);
  await page.getByLabel("Search resources").fill("equipment");
  await expect(page.locator(".resource")).toHaveCount(1);
});
test("feeding fault freezes replay and can be cleared without restarting feeding", async ({
  page,
}) => {
  await page.clock.install();
  await enter(page);
  await configure(page);
  await check(page);
  await page.getByRole("button", { name: "Clinician", exact: true }).click();
  await page.getByRole("button", { name: "Feeding", exact: true }).click();
  await page
    .getByRole("combobox", {
      name: "Feeding scenario",
      exact: true,
    })
    .selectOption("F05");
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  await page
    .getByRole("button", { name: "Start feeding", exact: true })
    .click();
  await page.clock.runFor(5000);
  expect((await state(page)).sessions[0].status).toBe("STOPPED");
  await expect(
    page.getByRole("heading", { name: "Feeding stopped.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Acknowledge warning", exact: true })
    .click();
  await expect(
    page.getByText("Acknowledged; cause remains unresolved.", { exact: false }),
  ).toBeVisible();
  const volume = (await state(page)).sessions[0].volume;
  const stopped = await state(page);
  expect(stopped.playing).toBe(false);
  expect(stopped.index).toBe(stopped.sessions[0].records.length);
  await page.clock.runFor(2000);
  const later = await state(page);
  expect(later.sessions[0].volume).toBe(volume);
  expect(later.analysis).toEqual(stopped.analysis);
  expect(later.index).toBe(stopped.index);
  expect(later.demoSeconds).toBe(stopped.demoSeconds);
  expect(later.sessions[0].records).toEqual(stopped.sessions[0].records);
  expect(later.analysis.latched).toBe(stopped.analysis.latched);
  await page
    .getByRole("button", { name: "Clear warning", exact: true })
    .click();
  await expect(page.locator(".active-alert")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Feeding stopped.", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(2000);
  const cleared = await state(page);
  expect(cleared.playing).toBe(false);
  expect(cleared.analysis).toEqual(stopped.analysis);
  expect(cleared.sessions[0].status).toBe("STOPPED");
  expect(cleared.alerts[0].active).toBe(false);
  expect(cleared.alerts[0].state).toBe(stopped.alerts[0].state);
});
test("clinician uploads CSV and caregiver workflow works offline on mobile", async ({
  page,
  context,
}) => {
  await enter(page, "clinician");
  await controls(page);
  await page.getByLabel("Upload replacement sensor CSV").setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("scenario_id,ph\nTEST,3"),
  });
  await expect(page.getByRole("alert")).toContainText("Missing columns");
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page.getByLabel("Upload replacement sensor CSV").setInputFiles({
    name: "placement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(readFileSync("public/data/placement_inputs.csv")),
  });
  expect((await state(page)).uploads).toHaveLength(8);
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".browser/caregiver-workflow.png",
    fullPage: true,
  });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check tube placement", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check tube placement", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Checking placement…", exact: true }),
  ).toBeVisible();
});
test("clinician retains detailed feeding replay for every scenario", async ({
  page,
}) => {
  await page.clock.install();
  await enter(page, "clinician");
  await page.getByRole("button", { name: "Feeding", exact: true }).click();
  for (const [id, expected] of [
    ["F02", "FEEDING_NORMAL"],
    ["F03", "FEEDING_NORMAL"],
    ["F04", "POSSIBLE_OBSTRUCTION"],
    ["F06", "DELIVERY_MISMATCH"],
    ["F07", "FEEDING_NORMAL"],
    ["F08", "HIGH_RESISTANCE"],
    ["F09", "FEEDING_NORMAL"],
  ]) {
    const d = await controls(page);
    await d
      .getByRole("combobox", { name: "Scenario", exact: true })
      .selectOption(id);
    await d
      .getByRole("combobox", { name: "Playback speed", exact: true })
      .selectOption("20");
    await page
      .getByRole("button", { name: "Play replay", exact: true })
      .click();
    await page.clock.runFor(9100);
    const s = await state(page);
    expect(s.analysis.state, id).toBe(expected);
    expect(s.index).toBe(180);
    if (id === "F07") expect(s.analysis.metrics.missingIntervals).toBe(20);
    expect(s.sessions).toHaveLength(0);
  }
});
