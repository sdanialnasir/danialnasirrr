"""Story mini-games (beat / catch / sneak): a bot plays each film's game to a win, then a 'do nothing' run must lose.
usage: python3 tests/minigames.py dist/index.html"""
import asyncio, os, sys, json
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'dist/index.html')
CHS = {5: 'beat', 6: 'beat', 21: 'beat', 28: 'beat', 2: 'catch', 18: 'catch', 16: 'sneak', 20: 'sneak'}
BOT = """(mode) => {
  const W = window.__dc.world; let S = W.story, k = 0;
  while (S && !S.qte && k++ < 20000) { W.update(1/30, performance.now()); S = W.story; }
  if (!S || !S.qte) return 'no game';
  const kind = S.qte.kind, out = { kind };
  for (let i = 0; i < 20000 && S.qte; i++) {
    const M = S.mg;
    if (mode === 'bot' && M) {
      if (M.kind === 'beat' && Math.abs(M.ph - 0.5) < 0.05 && !M.done && !(M._last === Math.floor(M.t / 1.15))) { M._last = Math.floor(M.t / 1.15); S.qteIn('down'); }
      if (M.kind === 'catch') { const low = M.pearls.reduce((a, p) => (!a || p.y > a.y ? p : a), null); if (low) { const d = Math.sign(low.lane - M.lane); if (d) S.qteIn('lane', d); } }
      if (M.kind === 'sneak') { const c = M.t % 2.2; if (c > 0.8 && c < 1.0 && !M._tap) { M._tap = 1; S.qteIn('down'); } if (c < 0.5) M._tap = 0; }
    }
    W.update(1/30, performance.now()); S = W.story; if (!S) break;
  }
  out.ok = S ? S.qOk : null; return out;
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 640, 'height': 360}); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        seed = "{v:2, introSeen:1, unlocked:30, coins:1840, stars:{}, trait:{funny:2,kind:1}, tutSeen:{0:1,1:1,2:1,4:1,5:1,8:1,11:1}, name:'Noor', settings:{gfx:'low'}}"
        await pg.add_init_script("localStorage.setItem('dc-save', JSON.stringify(" + seed + ")); window.__origRAF = window.requestAnimationFrame; window.requestAnimationFrame = (f) => window.__freeze ? 0 : window.__origRAF(f);")
        await pg.goto('file://' + HTML, wait_until='commit')
        for i in range(180):
            await pg.wait_for_timeout(1000)
            if await pg.evaluate("!!window.__dc && !document.querySelector('#loader')"): break
        await pg.evaluate('window.__freeze = true')
        fails = []
        for n, want in CHS.items():
            res = {}
            for mode in ('bot', 'idle'):
                await pg.evaluate(f"window.__dc.go('home'); window.__dc.watch({n})")
                res[mode] = await pg.evaluate(f"({BOT})('{mode}')")
            ok_bot = res['bot'].get('kind') == want and res['bot'].get('ok') is True
            ok_idle = res['idle'].get('kind') == want and res['idle'].get('ok') is False
            print(f"ch {n:2d} {want:5s} bot-> {res['bot']}  idle-> {res['idle']}  {'OK' if ok_bot and ok_idle else 'FAIL'}", flush=True)
            if not (ok_bot and ok_idle): fails.append(n)
        print('page errors', errs); print('failures', fails)
        await b.close()
        if fails or errs: sys.exit(1)
asyncio.run(main())
