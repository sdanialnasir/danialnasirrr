#!/usr/bin/env python3
"""Crash fuzzing: random play on all 30 levels inside the real build (renderer + engine).
Usage: python tests/fuzz_levels.py dist/index.html [moves_per_level=260]"""
import asyncio, sys
from playwright.async_api import async_playwright
from _browser import launch, open_game
JS = """(([idx, seed, n]) => { const w = window.__dc.world; window.__dc.startIndex(idx); let e = window.__dc.engine; let now = performance.now(); const D = ['up','down','left','right']; let s = seed; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const errs = []; let deaths = 0, wins = 0;
  try { for (let i = 0; i < n; i++) { if (e.state !== 'playing') { if (e.state === 'dead') deaths++; else wins++; window.__dc.startIndex(idx); e = window.__dc.engine; }
      if (R() < 0.8) e.press(D[(R() * 4) | 0]); now += e.tickMs; e.step(); w.onTick(e, now); w.update(e.tickMs / 1000, now); } w.render(); } catch (er) { errs.push(String(er) + ' ' + (er.stack || '').split('\\n')[1]); }
  return { deaths, wins, errs }; })"""
async def main(path, n):
    async with async_playwright() as p:
        b = await launch(p); pg, perrs = await open_game(b, path, (320, 200)); bad = 0
        for lvl in range(30):
            r = await pg.evaluate(JS, [lvl, 1000 + lvl * 7, n]); ok = not r['errs'] and not perrs; bad += not ok
            print(f"level {lvl + 1:2d}: deaths={r['deaths']} {'OK' if ok else 'ERRORS ' + str(r['errs'] or perrs)}"); perrs.clear()
        print('levels with errors:', bad); await b.close(); sys.exit(1 if bad else 0)
asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'dist/index.html', int(sys.argv[2]) if len(sys.argv) > 2 else 260))
