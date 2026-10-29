"""In-world segments (story v7 pilot): each chapter whose beat is a mini-game plays its game on the level tank.
A bot wins each one; an idle run must lose. usage: python3 tests/segments.py dist/index.html"""
import asyncio, os, sys
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'dist/index.html')
CHS = [int(x) for x in os.environ.get("CHS", "2,5,6,16,18,20,21,28").split(",")]
BOT = """(mode) => { const D = window.__dc; let st = D.segState(); let k = 0;
  while (st && st.phase !== 'play' && k++ < 4000) { D.segTick(1/30); st = D.segState(); }
  if (!st) return 'no segment';
  // lines take wall-clock time; advance until the game is up
  const kind = st.kind; let i = 0;
  while (st && st.phase === 'play' && i++ < 20000) {
    const M = st.M;
    if (mode === 'bot') {
      if (M.kind === 'beat' && Math.abs(M.ph - 0.5) < 0.05 && !M._d && M.presses < M.total) { M._d = 1; D.segIn('down'); }
      if (M.kind === 'beat' && Math.abs(M.ph - 0.5) > 0.2) M._d = 0;
      if (M.kind === 'catch') { const low = M.pearls.reduce((a, p) => (!a || p.y > a.y ? p : a), null); if (low) { const d = Math.sign(low.lane - M.lane); if (d) D.segIn('lane', d); } }
      if (M.kind === 'sneak') { const c = M.t % 2.2; if (c > 0.7 && c < 1.1 && !M._t) { M._t = 1; D.segIn('down'); } if (c < 0.5) M._t = 0; }
    }
    D.segTick(1/30); st = D.segState();
  }
  return { kind, res: st && st.res };
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 640, 'height': 360}); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        seed = "{v:2, introSeen:1, unlocked:30, coins:1840, stars:{}, trait:{funny:2,kind:1}, tutSeen:{0:1,1:1,2:1,4:1,5:1,8:1,11:1}, name:'Noor', settings:{gfx:'low'}}"
        await pg.add_init_script("localStorage.setItem('dc-save', JSON.stringify(" + seed + ")); window.__origRAF = window.requestAnimationFrame; window.requestAnimationFrame = (f) => window.__freeze ? 0 : window.__origRAF(f);")
        await pg.goto('file://' + HTML, wait_until='commit')
        for _ in range(180):
            await pg.wait_for_timeout(1000)
            if await pg.evaluate("!!window.__dc && !document.querySelector('#loader')"): break
        await pg.evaluate('window.__freeze = true')
        fails = []
        for n in CHS:
            res = {}
            for mode in ('bot', 'idle'):
                await pg.evaluate("window.__dc.go('home')")
                await pg.evaluate(f"window.__dc.startIndex({n - 1})")
                await pg.evaluate(f"window.__dc.seg({n})")
                for _ in range(40):   # let the two spoken lines run (wall clock)
                    await pg.wait_for_timeout(250)
                    if await pg.evaluate("(window.__dc.segState()||{}).phase === 'play'"): break
                res[mode] = await pg.evaluate(f"({BOT})('{mode}')")
                for _ in range(120):   # the outcome lines run (wall clock) until the segment hands back to the level
                    await pg.wait_for_timeout(250)
                    if await pg.evaluate("window.__dc.segState() === null"): break
                res[mode]['end'] = await pg.evaluate("window.__dc.segState() === null")
            ok = res['bot'].get('res') == 'ok' and res['idle'].get('res') == 'no' and res['bot'].get('end') and res['idle'].get('end')
            print(f"seg {n:2d} bot={res['bot']} idle={res['idle']} {'OK' if ok else 'CHECK'}", flush=True)
            if not ok: fails.append(n)
        print('page errors', errs); print('not finished', fails)
        await b.close()
asyncio.run(main())
