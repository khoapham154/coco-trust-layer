"""Visual smoke test for the new Twenty-side overlay.

Boots a one-shot Chromium page hosted off `data:` URL that simulates a
Twenty CRM tab. Loads coco-sdk.js + coco-inject.js from the running
gateway, then exercises three flows by dispatching synthetic verdicts
and one real /api/validate call. Saves screenshots.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

GATEWAY = "http://localhost:8080"

HTML = """
<!doctype html>
<html><head>
  <meta charset="utf-8" />
  <title>Twenty CRM (mock)</title>
  <style>
    body { font-family: Inter, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    header { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 12px 20px; display: flex; gap: 16px; align-items: center; }
    header .logo { font-weight: 700; color: #6366f1; }
    main { display: grid; grid-template-columns: 240px 1fr; min-height: calc(100vh - 49px); }
    aside { background: #fff; border-right: 1px solid #e2e8f0; padding: 16px; }
    aside ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    aside li { padding: 6px 10px; border-radius: 6px; font-size: 13px; color: #475569; cursor: pointer; }
    aside li.active { background: #eef2ff; color: #4338ca; }
    .body { padding: 20px; max-width: 720px; }
    h1 { font-size: 20px; margin: 0 0 10px; }
    .row { display: flex; gap: 12px; margin-bottom: 10px; font-size: 13px; }
    .row .k { width: 120px; color: #64748b; }
    .row .v { color: #0f172a; }
    .btn { background: #0f172a; color: #fff; border: 0; padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; }
  </style>
</head><body>
  <header>
    <span class="logo">Twenty</span>
    <span style="color:#64748b">Opportunities · Northwind Labs</span>
  </header>
  <main>
    <aside>
      <ul>
        <li>Companies</li>
        <li class="active">Opportunities</li>
        <li>People</li>
        <li>Tasks</li>
      </ul>
    </aside>
    <div class="body">
      <h1>Northwind Labs — Enterprise Trust Layer</h1>
      <div class="row"><div class="k">Stage</div><div class="v" data-testid="record-detail-stage">NEW</div></div>
      <div class="row"><div class="k">Amount</div><div class="v" data-testid="record-detail-amount">82,000</div></div>
      <div class="row"><div class="k">Owner</div><div class="v" data-testid="record-detail-owner">u_002</div></div>
      <button class="btn" id="move-stage">Move stage to Negotiation</button>
    </div>
  </main>
  <script src="GATEWAY/sdk/coco-sdk.js"></script>
  <script src="GATEWAY/sdk/inject.js" data-gateway="GATEWAY"></script>
</body></html>
""".replace("GATEWAY", GATEWAY)


async def main() -> int:
    out = Path("logs/screenshots/phase7"); out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1.5)
        page = await ctx.new_page()
        await page.set_content(HTML, wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(out / "01_badge.png"))
        print("  ✓ badge")

        # Trigger an ALLOW verdict via the SDK
        await page.evaluate("""
            window.Coco.validate('update_field', {
              record: { exists: true, archived: false },
              field_update: { required_fields_still_filled: true, email_format_valid: true }
            }, 'twenty.field_update', 'pre');
        """)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=str(out / "02_allow.png"))
        print("  ✓ allow")

        # Trigger a BLOCK verdict — over-50k deal without manager field
        await page.evaluate("""
            window.Coco.validate('move_stage', {
              deal: {
                owner: 'u_002', amount: 80000, prev_stage_tasks_completed: true,
                is_sequential_stage_move: false, manager_field_filled: false,
                target_stage: 'negotiation'
              },
              user: { role: 'sales' }
            }, 'twenty.deal_stage_move', 'pre');
        """)
        await page.wait_for_timeout(1200)
        await page.screenshot(path=str(out / "03_block_modal.png"))
        print("  ✓ block modal")

        # Click "See policy" on the modal — find via shadow DOM
        await page.evaluate("""
            const host = document.getElementById('coco-overlay-host');
            const btn = host.shadowRoot.querySelectorAll('#modal-foot .card-btn')[0];
            if (btn) btn.click();
        """)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(out / "04_policy_drawer.png"))
        print("  ✓ policy drawer")

        await browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
