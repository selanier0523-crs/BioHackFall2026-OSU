import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function enter(page: Page, role = "caregiver") {
  await page.goto("/?local");
  await page
    .getByRole("button", { name: `Enter ${role} demo`, exact: true })
    .click();
}
async function controls(page: Page) {
  const details = page.locator(".demo-controls");
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
  return details;
}
async function choose(page: Page, id: string) {
  const d = await controls(page);
  await d
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption(id);
  await d
    .getByRole("combobox", { name: "Playback speed", exact: true })
    .selectOption("20");
}
async function check(page: Page, kind = "Insertion", id = "P01") {
  await choose(page, id);
  await page.getByRole("button", { name: "Placement", exact: true }).click();
  await page
    .getByRole("button", { name: "Collect fresh readings", exact: true })
    .click();
  await page.clock.runFor(600);
  // Native clock advances wall time; sensor step integration remains at recorded timing.
  await page.clock.runFor(700);
  await expect(
    page.getByRole("heading", {
      name: "Indicators compatible with stomach placement",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue demo", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue demo", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start simulated feed", exact: true }),
  ).toBeEnabled();
}
const state = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("ng-tube-assistant-v1")!),
  );
test("credentials, insertion, role switch, normal completion and later abbreviated check", async ({
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
  await expect(
    page.getByRole("button", {
      name: "Insert or replace NG tube",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Insert or replace NG tube", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Help & tutorial", exact: true })
    .click();
  await expect(
    page.getByText("No actual video is playing.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Placement", exact: true }).click();
  await controls(page);
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.getByRole("button", { name: "Clinician", exact: true }).click();
  const before = await state(page);
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  expect((await state(page)).index).toBe(before.index);
  // Record this unfinished check, then start a fresh one.
  await choose(page, "P02");
  await choose(page, "P01");
  await check(page);
  await page
    .getByRole("button", { name: "Start simulated feed", exact: true })
    .click();
  await page.clock.runFor(91000);
  const done = await state(page);
  expect(done.sessions[0].status).toBe("COMPLETED");
  expect(done.sessions[0].volume).toBeCloseTo(30, 6);
  expect(done.sessions[0].missing).toBe(0);
  expect(done.tubeInserted).toBe(true);
  await expect(
    page.getByRole("button", { name: "Start simulated feed", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Check tube before feeding", exact: true })
    .click();
  await expect(
    page.getByText("FRESH CHECK BEFORE FEEDING", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(1300);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start simulated feed", exact: true })
    .click();
  expect((await state(page)).sessions).toHaveLength(2);
  expect((await state(page)).checks[1].kind).toBe("Pre-feed");
  await page
    .getByRole("button", { name: "Pause simulated feed", exact: true })
    .click();
  const volume = (await state(page)).sessions[1].volume;
  await page.clock.runFor(1000);
  expect((await state(page)).sessions[1].volume).toBe(volume);
  await page
    .getByRole("button", { name: "Resume simulated feed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop simulated feed", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const saved = await state(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Today", exact: true }),
  ).toBeVisible();
  expect((await state(page)).sessions).toHaveLength(2);
  expect((await state(page)).index).toBe(saved.index);
  expect((await state(page)).playing).toBe(false);
  expect(errors).toEqual([]);
});
test("airway, weak airway, ambiguous, reflux and dropout placement results", async ({
  page,
}) => {
  await page.clock.install();
  await enter(page);
  await page.getByRole("button", { name: "Placement", exact: true }).click();
  for (const [id, text] of [
    ["P02", "Do not proceed — possible airway placement"],
    ["P08", "Do not proceed — possible airway placement"],
    ["P03", "Do not proceed — placement check incomplete"],
    ["P04", "Do not proceed — placement check incomplete"],
    ["P05", "Indicators compatible with stomach placement"],
    ["P06", "Do not proceed — sensor data unavailable"],
  ]) {
    await choose(page, id);
    await page
      .getByRole("button", { name: "Collect fresh readings", exact: true })
      .click();
    await page.clock.runFor(id === "P06" ? 1000 : 1400);
    await expect(
      page.getByRole("heading", { name: text, exact: true }),
    ).toBeVisible();
    if (id !== "P05")
      await expect(
        page.getByRole("button", { name: "Continue demo", exact: true }),
      ).toHaveCount(0);
  }
});
test("clinician credentials, plan edits, tutorial assignment and viewed state", async ({
  page,
}) => {
  await page.goto("/?local");
  await page.getByLabel("Username").fill("clinician");
  await page.getByLabel("Password", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Enter demo", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit plan", exact: true })
    .first()
    .click();
  await page.getByLabel("Amount (mL)", { exact: true }).fill("45");
  await page
    .getByLabel("Written instructions")
    .fill("Fictional updated plan for browser test.");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  await expect(
    page.getByText("Fictional updated plan for browser test.", { exact: true }),
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
test("feeding fault stops simulation, keeps replay running and acknowledgment retains warning", async ({
  page,
}) => {
  await page.clock.install();
  await enter(page);
  await check(page);
  await page
    .getByRole("combobox", {
      name: "Feeding fixture (sequenced after the placement check)",
      exact: true,
    })
    .selectOption("F05");
  await page
    .getByRole("button", { name: "Start simulated feed", exact: true })
    .click();
  await page.clock.runFor(5000);
  const s = await state(page);
  expect(s.sessions[0].status).toBe("STOPPED");
  expect(s.alerts).toHaveLength(1);
  await expect(page.getByText("Replay running", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Acknowledge warning", exact: true })
    .click();
  await expect(
    page.getByText("Acknowledged; cause remains unresolved.", { exact: false }),
  ).toBeVisible();
  const volume = (await state(page)).sessions[0].volume;
  await page.clock.runFor(2000);
  expect((await state(page)).sessions[0].volume).toBe(volume);
  expect((await state(page)).analysis.latched).toBe(true);
  await page.getByRole("button", { name: "Alert help", exact: true }).click();
  await expect(
    page.getByText("No actual video is playing.", { exact: true }),
  ).toBeVisible();
});
test("uploaded CSV validation, mobile fit and offline shell after production load", async ({
  page,
  context,
}) => {
  await enter(page);
  await controls(page);
  await page
    .getByLabel("Upload replacement sensor CSV")
    .setInputFiles({
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("scenario_id,ph\nTEST,3"),
    });
  await expect(page.getByRole("alert")).toContainText("Missing columns");
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page
    .getByLabel("Upload replacement sensor CSV")
    .setInputFiles({
      name: "placement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(readFileSync("public/data/placement_inputs.csv")),
    });
  expect((await state(page)).uploads).toHaveLength(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".browser/mobile.png", fullPage: true });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Today", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Insert or replace NG tube", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Follow the placement indicators.",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const manifest = await page.evaluate(async () => {
    const r = await fetch("/manifest.webmanifest");
    return r.json();
  });
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toHaveLength(2);
});
test("feeding replay displays resistance, mismatch, gravity, pauses and missing data", async ({
  page,
}) => {
  await page.clock.install();
  await enter(page);
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
    await choose(page, id);
    await page
      .getByRole("button", { name: "Play replay", exact: true })
      .click();
    await page.clock.runFor(9100);
    const s = await state(page);
    expect(s.analysis.state, id).toBe(expected);
    expect(s.index, id).toBe(180);
    if (id === "F07") {
      expect(s.analysis.metrics.missingIntervals).toBe(20);
      expect(s.analysis.metrics.knownVolume).toBeLessThan(3);
    }
    expect(s.sessions).toHaveLength(0);
  }
});
