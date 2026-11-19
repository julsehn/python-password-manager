import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "test-login.html");
const script = await readFile(join(here, "content.js"), "utf8");
const iconUrl = pathToFileURL(join(here, "icons/icon128.png")).href;

async function openFixture(
  page,
  choices = [{ username: "alice", domain: "example.test" }],
) {
  await page.goto(`file://${fixture}`);
  await page.evaluate(
    ({ contentScript, imageUrl, choices }) => {
      const attachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) {
        const root = attachShadow.call(this, options);
        if (this.id === "sherlock-field-icons")
          window.__sherlockTestRoot = root;
        return root;
      };
      window.chrome = {
        runtime: {
          getURL: () => imageUrl,
          sendMessage: async (message) => {
            if (message.action === "sherlockGetCredentialChoices") {
              return {
                success: true,
                choices,
              };
            }
            if (message.action === "sherlockSelectCredential") {
              return {
                success: true,
                credential: {
                  username: message.username || "alice",
                  password: `${message.username || "alice"}-secret`,
                },
              };
            }
            return { success: false };
          },
          onMessage: { addListener() {} },
        },
      };
      (0, eval)(contentScript);
    },
    { contentScript: script, imageUrl: iconUrl, choices },
  );
  await page.locator("#sherlock-field-icons").waitFor();
  await page.waitForTimeout(350);
}

test("clicking the SherLock icon fills the login fields", async ({ page }) => {
  await openFixture(page);
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  const rect = await email.boundingBox();
  expect(rect).not.toBeNull();
  // The icon is centered 20 px from the right edge for a typical 40 px field.
  await page.mouse.click(rect.x + rect.width - 20, rect.y + rect.height / 2);
  await expect(email).toHaveValue("alice");
  await expect(password).toHaveValue("alice-secret");
  await page.screenshot({
    path: "test-results/sherlock-icon-click.png",
    fullPage: true,
  });
});

test("multiple matches show a username-only chooser before filling", async ({
  page,
}) => {
  await openFixture(page, [
    { username: "alice", domain: "example.test" },
    { username: "bob", domain: "example.test" },
  ]);
  const email = page.locator('input[type="email"]').first();
  const rect = await email.boundingBox();
  await page.mouse.click(rect.x + rect.width - 20, rect.y + rect.height / 2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__sherlockTestRoot.querySelectorAll(".sherlock-menu button")
            .length,
      ),
    )
    .toBe(2);
  const menuText = await page.evaluate(
    () => window.__sherlockTestRoot.querySelector(".sherlock-menu").textContent,
  );
  expect(menuText).toContain("alice");
  expect(menuText).toContain("bob");
  expect(menuText).not.toContain("secret");
  await page.evaluate(() =>
    window.__sherlockTestRoot
      .querySelectorAll(".sherlock-menu button")[1]
      .click(),
  );
  await expect(email).toHaveValue("bob");
  await expect(page.locator('input[type="password"]').first()).toHaveValue(
    "bob-secret",
  );
});

test("discovers open shadow-root and dynamically added login fields", async ({
  page,
}) => {
  await openFixture(page);
  const initialCount = await page.evaluate(
    () =>
      window.__sherlockTestRoot.querySelectorAll(".sherlock-icon-btn").length,
  );
  await page.evaluate(() => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const shadowField = document.createElement("input");
    shadowField.type = "email";
    shadowField.name = "email";
    shadowField.style.cssText = "width:240px;height:40px";
    root.append(shadowField);
    document.body.append(host);
    setTimeout(() => {
      const lateField = document.createElement("input");
      lateField.type = "text";
      lateField.name = "username";
      lateField.style.cssText = "width:240px;height:40px";
      document.body.append(lateField);
    }, 1800);
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__sherlockTestRoot.querySelectorAll(".sherlock-icon-btn")
              .length,
        ),
      { timeout: 3500 },
    )
    .toBe(initialCount + 1);
  await page.waitForTimeout(2100);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__sherlockTestRoot.querySelectorAll(".sherlock-icon-btn")
            .length,
      ),
    )
    .toBe(initialCount + 2);
});

test("icons align with fields of different heights", async ({ page }) => {
  await openFixture(page);
  for (const [fieldId, buttonIndex] of [
    ["email2", 2],
    ["email3", 4],
    ["email4", 6],
  ]) {
    const field = page.locator(`#${fieldId}`);
    await field.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const geometry = await page.evaluate(
      ({ id, index }) => {
        const input = document.getElementById(id);
        const button =
          window.__sherlockTestRoot.querySelectorAll(".sherlock-icon-btn")[
            index
          ];
        const a = input.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        return { field: a.toJSON(), icon: b.toJSON(), hidden: button.hidden };
      },
      { id: fieldId, index: buttonIndex },
    );
    const margin = Math.max(4, Math.min(geometry.field.height * 0.15, 8));
    const size = Math.max(18, Math.min(geometry.field.height - margin * 2, 40));
    expect(geometry.hidden).toBe(false);
    expect(geometry.icon.width).toBeCloseTo(size, 1);
    expect(geometry.icon.x).toBeCloseTo(
      geometry.field.right - size - margin,
      1,
    );
    expect(geometry.icon.y + geometry.icon.height / 2).toBeCloseTo(
      geometry.field.top + geometry.field.height / 2,
      1,
    );
    await page.screenshot({ path: `test-results/sherlock-${fieldId}.png` });
  }

  await page.locator("#email5").scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  await page.screenshot({ path: "test-results/sherlock-dark-theme.png" });

  await page.locator("#pass6").scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const togglePositions = await page.evaluate(() => {
    const icon =
      window.__sherlockTestRoot.querySelectorAll(".sherlock-icon-btn")[11];
    const field = document.getElementById("pass6").getBoundingClientRect();
    const toggle = document
      .querySelector(".password-wrapper button")
      .getBoundingClientRect();
    return {
      icon: icon.getBoundingClientRect().toJSON(),
      field: field.toJSON(),
      toggle: toggle.toJSON(),
    };
  });
  expect(togglePositions.icon.right).toBeLessThanOrEqual(
    togglePositions.toggle.left,
  );
  expect(togglePositions.icon.left).toBeGreaterThanOrEqual(
    togglePositions.field.left,
  );
  await page.screenshot({ path: "test-results/sherlock-toggle-control.png" });
});
