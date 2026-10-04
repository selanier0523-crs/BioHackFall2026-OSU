import { test, expect } from "@playwright/test";
test("Supabase sync between independent caregiver and clinician browsers, offline queue and reconnect", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Enter clinician demo", exact: true })
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
  await expect(
    caregiver.getByText("Synchronized with Supabase · synthetic demo only", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Edit plan", exact: true })
    .first()
    .click();
  const original = await page.getByLabel("Written instructions").inputValue();
  const note = `Fictional cloud synchronization test ${Date.now()}`;
  await page.getByLabel("Written instructions").fill(note);
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(caregiver.getByText(note, { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await caregiver.reload();
  await expect(caregiver.getByText(note, { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await page
    .getByRole("button", { name: "Edit plan", exact: true })
    .first()
    .click();
  await page.getByLabel("Written instructions").fill(original);
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByText(/Saved locally · pending/)).toBeVisible();
  await page.context().setOffline(false);
  await expect(caregiver.getByText(original, { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await caregiverContext.close();
});
