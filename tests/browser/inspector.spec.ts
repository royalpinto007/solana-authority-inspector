import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Inspection } from "../../src/types.js";

const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("inspect a mint and export the same exact snapshot", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Mint address", { exact: true }).fill(usdc);
  await page.getByLabel("Mint address", { exact: true }).press("Enter");
  await expect(page.locator(".badge.live")).toHaveText("Live RPC snapshot");
  await expect(
    page.locator('[data-authority="mint"] .authority-status'),
  ).toHaveText("Set");
  await expect(
    page.locator('[data-authority="freeze"] .authority-status'),
  ).toHaveText("Set");
  await expect(page.locator(".facts")).toContainText("18446744073709.551615");
  await expect(page.locator(".snapshot-meta")).toContainText("123,456,789");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, "utf8")) as Inspection;
  expect(exported.address).toBe(usdc);
  expect(exported.source).toBe("rpc");
  expect(exported.supply.raw).toBe("18446744073709551615");
  expect(exported.slot).toBe(123456789);
  await expect(page.locator("#toast")).toHaveText("JSON snapshot exported");
});

test("Token-2022 preserves extensions and displays metadata as text", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/");
  await page.locator('[data-mint="pyusd"]').click();
  await expect(page.locator(".badge.program")).toHaveText("Token-2022");
  await page.getByTestId("extensions").locator(":scope > summary").click();
  await page
    .locator(".extension-item")
    .filter({ hasText: "permanentDelegate" })
    .locator("summary")
    .click();
  await expect(
    page.locator(".extension-item").filter({ hasText: "permanentDelegate" }),
  ).toContainText(usdc);
  await page
    .locator(".extension-item")
    .filter({ hasText: "tokenMetadata" })
    .locator("summary")
    .click();
  await expect(
    page
      .getByTestId("extensions")
      .locator(".json-block")
      .filter({ hasText: "window.pwned" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "pwned")),
  ).toBeUndefined();
  expect(
    requested.every((url) => url.startsWith("http://127.0.0.1:4420/")),
  ).toBe(true);
});

test("native mint supply caveat is visible without expanding a disclosure", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-mint="wsol"]').click();
  await expect(
    page.locator('[data-authority="mint"] .authority-status'),
  ).toHaveText("Not set");
  await expect(
    page.locator('[data-authority="freeze"] .authority-status'),
  ).toHaveText("Not set");
  await expect(page.locator(".facts")).toContainText("0");
  await expect(
    page.getByText(/Native mint field; not circulating supply/),
  ).toBeVisible();
});

test("offline examples and exports remain explicitly synthetic", async ({
  page,
}) => {
  let liveRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/inspect")) liveRequests++;
  });
  await page.goto("/");
  await page.locator('[data-example="extensions"]').click();
  await expect(page.locator(".badge.example")).toHaveText("Example snapshot");
  await expect(page.locator(".example-notice")).toContainText("No chain read");
  const downloaded = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const download = await downloaded;
  const result = JSON.parse(
    await readFile((await download.path())!, "utf8"),
  ) as Inspection;
  expect(result.source).toBe("example");
  expect(result.slot).toBeNull();
  expect(result.observedAt).toBeNull();
  expect(download.suggestedFilename()).toContain("example");
  expect(liveRequests).toBe(0);
});

test("validation and API errors give an actionable retry", async ({ page }) => {
  await page.goto("/");
  await page.locator("#mint-address").fill("not-a-mint");
  await page.locator("#inspect-button").click();
  await expect(page.locator("#mint-address")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("#message")).toContainText("base58");
  await page.route("**/api/inspect", (route) =>
    route.fulfill({
      status: 504,
      json: {
        error: {
          code: "RPC_TIMEOUT",
          message: "The RPC did not respond in time. Try again.",
        },
      },
    }),
  );
  await page.locator('[data-mint="usdc"]').click();
  await expect(page.locator(".error-code")).toHaveText("RPC_TIMEOUT");
  await page.unroute("**/api/inspect");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".badge.live")).toBeVisible();
});

test("changing networks cancels in-flight reads and keeps the previous network label", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    // Simulate a transport that cannot cancel, so the request-ID guard must reject a late response.
    window.fetch = (input, init) =>
      original(
        input,
        typeof input === "string" && input.endsWith("/api/inspect")
          ? { ...init, signal: null }
          : init,
      );
  });
  const example = await request.get("/api/examples/managed");
  const snapshot = (await example.json()) as Inspection;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/inspect", async (route) => {
    const payload = route.request().postDataJSON() as {
      network: Inspection["network"];
    };
    if (payload.network === "devnet") {
      await gate;
    }
    await route.fulfill({
      json: {
        ...snapshot,
        source: "rpc",
        network: payload.network,
        address: usdc,
        slot: 11,
        observedAt: "2026-10-26T00:00:00Z",
      },
    });
  });
  await page.goto("/");
  await page.locator('[data-mint="usdc"]').click();
  await expect(page.locator(".badge.live")).toBeVisible();
  await page.locator("#network").selectOption("devnet");
  await expect(page.locator("#message")).toContainText(
    "snapshot below is from Mainnet",
  );
  await expect(page.locator(".result-labels")).toContainText("Mainnet");
  await page.locator("#inspect-button").click();
  await expect(page.locator("#cancel-button")).toBeVisible();
  const lateResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/inspect") &&
      response.request().postDataJSON().network === "devnet",
  );
  await page.locator("#network").selectOption("mainnet-beta");
  release();
  await lateResponse;
  await expect(page.locator("#inspect-button")).toBeEnabled();
  await expect(page.locator(".result-labels")).toContainText("Mainnet");
  await expect(page.locator(".result-labels")).not.toContainText("Devnet");
});

test("architecture and guide work in-app and keyboard input stays usable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Architecture", exact: true }).click();
  await expect(page.locator(".docs-content img")).toBeVisible();
  expect(
    await page
      .locator(".docs-content img")
      .evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Back to inspector" }).click();
  await page
    .getByRole("link", { name: "What do these authorities mean?" })
    .click();
  await expect(page.locator("#read-the-fields")).toBeVisible();
  await page.getByRole("link", { name: "Back to inspector" }).click();
  await page.locator("#network").focus();
  await page.keyboard.press("d");
  await page.keyboard.press("Enter");
  await expect(page.locator("#network")).toHaveValue("devnet");
});

test("layout fits narrow and intermediate viewports with complete addresses", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-example="managed"]').click();
  await expect(page.locator("#export-button")).toBeVisible();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const role of await page.locator(".authority-role").all()) {
      const box = await role.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
  }
});
