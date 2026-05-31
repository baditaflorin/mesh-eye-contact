import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("arm screen advertises Face Detection availability or fallback", async ({ page, baseURL }) => {
  await page.goto(baseURL ?? "");
  await expect(page.getByRole("button", { name: /arm front camera/i })).toBeVisible();
  // Either the API is available message or the manual-mode fallback message renders.
  const apiText = page.getByText(/Face Detection API/);
  const fallbackText = page.getByText(/manual mode/i);
  await expect(apiText.or(fallbackText)).toBeVisible();
});

test("empty meet list is shown until a 5-second mutual hold lands", async ({ page, baseURL }) => {
  await page.goto(baseURL ?? "");
  await expect(page.getByText(/no mutual 5-second holds yet/i)).toBeVisible();
});

// THE LOAD-BEARING CROSS-PEER ASSERTION.
// Advertised: "mutual face-detect mints an ephemeral 'we met' token … in both
// phones." This drives the real advertised action on BOTH peers — each arms a
// (fake) front camera and holds for 5s — then proves a single shared "we met"
// token mints into the cross-peer `meets` map and appears on the OTHER peer's
// `.ec-meets` list. Needs both peers because a meet is, by definition, mutual:
// one peer alone can never mint a token.
//
// Headless Chromium has no FaceDetector, so the app runs in manual mode
// (camera on === face on). The fake media stream (launchOptions in
// playwright.config.ts) makes getUserMedia() resolve, and we grant the camera
// permission on the shared context so neither peer hits the perm-denied path.
test("mutual 5-second hold mints one shared 'we met' token on both peers", async ({
  browser,
  baseURL,
}) => {
  const { context, a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  // Grant camera up front so getUserMedia() resolves for both peers' pages.
  await context.grantPermissions(["camera"], { origin: baseURL ?? undefined });
  try {
    await a.locator(".ec-name").fill("alice");
    await b.locator(".ec-name").fill("bob");

    // Both peers arm. Manual mode => faceVisible flips true as soon as the
    // (fake) camera produces frames; each peer's faceSince starts ticking.
    await a.getByRole("button", { name: /arm front camera/i }).click();
    await b.getByRole("button", { name: /arm front camera/i }).click();

    // Both previews must come up (proves getUserMedia resolved on each peer).
    await expect(a.locator(".ec-preview")).toBeVisible();
    await expect(b.locator(".ec-preview")).toBeVisible();

    // Each peer must observe its OWN face held — proves the local detect loop
    // is running and writing presence (the input to the mutual-hold mint).
    await expect(a.locator(".ec-readout")).toContainText(/held/i, { timeout: 12_000 });
    await expect(b.locator(".ec-readout")).toContainText(/held/i, { timeout: 12_000 });

    // CROSS-PEER MINT: after both peers cross MUTUAL_HOLD_MS (5s) while seeing
    // each other's presence, exactly one shared token is written to the `meets`
    // map. It must surface on BOTH peers' lists — the empty-state line is gone
    // and the pair "alice ↔ bob" (in either order) renders on each peer.
    const pairRe = /alice\s*↔\s*bob|bob\s*↔\s*alice/i;
    await expect(a.locator(".ec-meets")).toContainText(pairRe, { timeout: 15_000 });
    await expect(b.locator(".ec-meets")).toContainText(pairRe, { timeout: 15_000 });

    // The empty-state placeholder must be gone on both peers.
    await expect(a.locator(".ec-empty")).toHaveCount(0);
    await expect(b.locator(".ec-empty")).toHaveCount(0);

    // And it's the SAME single token (one mutual meet, not two one-sided ones):
    // each peer renders exactly one meet row, marked as theirs.
    await expect(a.locator(".ec-meets li.is-mine")).toHaveCount(1);
    await expect(b.locator(".ec-meets li.is-mine")).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
