#!/usr/bin/env python3
"""Plays verified winning routes (tests/routes.json) inside the real build; every route must end 'won'.
Route letters: U D L R = a move per tick, '.' = wait one tick (exact-tick routes from the solver).
Usage: python tests/play_routes.py dist/index.html"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
from _browser import launch, open_game
routes = json.load(open(os.path.join(os.path.dirname(__file__), 'routes.json')))
JS = """(async ([idx, seq]) => { const w = window.__dc.world; window.__dc.startIndex(idx); const e = window.__dc.engine; let now = performance.now(); const M = {U:'up',D:'down',L:'left',R:'right'}; const errs = [];
  const tick = () => { now += e.tickMs; e.step(); w.onTick(e, now); for (let f = 0; f < 3; f++) w.update(e.tickMs / 3000, now); };
  try { const exact = /\\./.test(seq); for (const c of seq) { if (c !== '.') e.press(M[c]); tick(); if (!exact) for (let k = 0; k < 6 && e.state === 'playing'; k++) { let mv = false; for (const o of e.objects.values()) if (o.falling) mv = true; if (!mv) break; tick(); } if (e.state !== 'playing') break; }
    for (let k = 0; k < 10 && e.state === 'playing'; k++) tick(); } catch (er) { errs.push(String(er)); }
  return { state: e.state, balls: e.ballsIn + '/' + e.ballsTotal, errs }; })"""
async def main(path):
    async with async_playwright() as p:
        b = await launch(p); pg, perrs = await open_game(b, path, (480, 300)); fails = 0
        for lvl in sorted(routes, key=int):
            r = await pg.evaluate(JS, [int(lvl) - 1, routes[lvl]]); ok = r['state'] == 'won' and not r['errs']; fails += not ok
            print(f"level {int(lvl):2d}: {r['state']} {r['balls']} {'' if ok else r['errs']}")
        print('failures:', fails); await b.close(); sys.exit(1 if fails else 0)
asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'dist/index.html'))
