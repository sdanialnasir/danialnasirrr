"""Shared helpers: launch Chromium (Playwright's bundled one, or CHROME_PATH), open the game, freeze its render loop."""
import os
from playwright.async_api import async_playwright
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
async def launch(p):
    exe = os.environ.get('CHROME_PATH')
    return await p.chromium.launch(**({'executable_path': exe} if exe else {}), args=ARGS)
async def open_game(browser, path, viewport=(960, 540), freeze=True):
    pg = await (await browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]})).new_page()
    errors = []; pg.on('pageerror', lambda e: errors.append(str(e)[:300]))
    # lets tests stop the game's own requestAnimationFrame loop and drive frames deterministically
    await pg.add_init_script("window.__origRAF = window.requestAnimationFrame; window.requestAnimationFrame = (f) => window.__freeze ? 0 : window.__origRAF(f);")
    await pg.goto('file://' + os.path.abspath(path), wait_until='commit'); await pg.wait_for_timeout(7000)
    if freeze: await pg.evaluate("window.__freeze = true"); await pg.wait_for_timeout(300)
    return pg, errors
