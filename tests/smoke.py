#!/usr/bin/env python3
"""Smoke test: the page loads, every level starts, no JS errors. Usage: python tests/smoke.py dist/index.html"""
import asyncio, sys
from playwright.async_api import async_playwright
from _browser import launch, open_game
async def main(path):
    async with async_playwright() as p:
        b = await launch(p); pg, errs = await open_game(b, path)
        bad = await pg.evaluate("""(() => { const bad = []; for (let i = 0; i < 30; i++) { try { window.__dc.startIndex(i); const e = window.__dc.engine; if (!e || e.state !== 'playing') bad.push(i + 1); } catch (er) { bad.push((i + 1) + ': ' + er); } } return bad; })()""")
        print('levels failing to start:', bad or 'none'); print('page errors:', errs or 'none'); await b.close()
        sys.exit(1 if bad or errs else 0)
asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'dist/index.html'))
