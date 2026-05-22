"""Snapshot the new dashboard for visual review.

Usage:
    python scripts/snapshot.py [--out logs/screenshots]

Renders the top-level views at viewport 1440x900 to PNGs, plus opens a
drawer to capture the verdict detail.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

VIEWPORT = {"width": 1440, "height": 900}
SHOTS = [
    ("live", "#/live"),
    ("live_filtered_block", "#/live?v=BLOCK"),
    ("escalations", "#/escalations"),
    ("packs", "#/packs"),
    ("packs_deal", "#/packs/twenty.deal_stage_move"),
    ("audit", "#/audit"),
    ("integrations", "#/integrations"),
    ("settings", "#/settings"),
    ("onboarding", "#/onboarding"),
]


async def main(out: Path, base_url: str) -> int:
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(viewport=VIEWPORT, device_scale_factor=1.5)
        page = await ctx.new_page()
        for name, route in SHOTS:
            await page.goto(f"{base_url}/dashboard{route}", wait_until="networkidle")
            await page.wait_for_timeout(700)
            target = out / f"{name}.png"
            await page.screenshot(path=str(target), full_page=False)
            print(f"  ✓ {target}")
        # Drawer shot: open the first feed row on Live.
        await page.goto(f"{base_url}/dashboard#/live", wait_until="networkidle")
        await page.wait_for_timeout(900)
        row = await page.query_selector(".feed-row")
        if row:
            await row.click()
            await page.wait_for_timeout(800)
            target = out / "live_drawer.png"
            await page.screenshot(path=str(target), full_page=True)
            print(f"  ✓ {target}")
        await browser.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="logs/screenshots")
    ap.add_argument("--url", default="http://localhost:8080")
    args = ap.parse_args()
    rc = asyncio.run(main(Path(args.out), args.url.rstrip("/")))
    sys.exit(rc)
