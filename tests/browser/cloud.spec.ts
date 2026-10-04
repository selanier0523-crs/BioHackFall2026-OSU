import { test, expect } from "@playwright/test";
test("Supabase sync between independent caregiver and clinician browsers, offline queue and reconnect", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Enter Clinician demo", exact: true })
    .click();
  await expect(
    page.getByText("Synchronized with Supabase · synthetic demo only", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  const caregiverContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const caregiver = await caregiverContext.newPage();
  await caregiver.goto("/");
  await caregiver
    .getByRole("button", { name: "Enter caregiver demo", exact: true })
    .click();
  await expect
    .poll(
      () =>
        caregiver.evaluate(
          () =>
            JSON.parse(localStorage.getItem("ng-tube-assistant-v1")!).revision,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Edit plan", exact: true })
    .first()
    .click();
  const original = await page.getByLabel("Written instructions").inputValue();
  const note = `Fictional cloud synchronization test ${Date.now()}`;
  await page.getByLabel("Written instructions").fill(note);
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  const caregiverInstructions = () =>
    caregiver.evaluate(
      () =>
        JSON.parse(localStorage.getItem("ng-tube-assistant-v1")!).plans[0]
          .instructions,
    );
  await expect.poll(caregiverInstructions, { timeout: 15000 }).toBe(note);
  await caregiver.reload();
  await expect.poll(caregiverInstructions).toBe(note);
  await page.context().setOffline(true);
  await page
    .getByRole("button", { name: "Edit plan", exact: true })
    .first()
    .click();
  await page.getByLabel("Written instructions").fill(original);
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByText(/Saved locally · pending/)).toBeVisible();
  await page.context().setOffline(false);
  await expect.poll(caregiverInstructions, { timeout: 15000 }).toBe(original);
  await caregiverContext.close();
});
