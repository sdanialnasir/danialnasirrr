#!/usr/bin/env python3
"""Build the single-file game: dist/index.html (+ PWA manifest and icons).
The single file is what gets published (claude.ai artifact) or uploaded to any static host."""
import os, re, shutil, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SRC = os.path.join(ROOT, 'src'); DIST = os.path.join(ROOT, 'dist')
def main():
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'build_assets.py')])
    # keep the in-game hint routes in step with the verified routes
    import json; gp = os.path.join(SRC, 'game.js'); g = open(gp).read(); routes = json.dumps(json.load(open(os.path.join(ROOT, 'tests', 'routes.json'))), separators=(',', ':'))
    g2 = re.sub(r'/\*routes\*/.*?/\*end\*/', lambda m: '/*routes*/' + routes + '/*end*/', g, count=1, flags=re.S)
    # Daily Dive puzzles: every tools/solver/daily/*.json (verified with the solver tools) in file order
    import glob; daily = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'tools', 'solver', 'daily', '*.json'))):
        for d in json.load(open(f)): daily.append({k: d[k] for k in ('name', 'time', 'hint', 'map', 'route') if k in d})
    dj = json.dumps(daily, separators=(',', ':'), ensure_ascii=False)
    g2 = re.sub(r'/\*daily\*/.*?/\*end\*/', lambda m: '/*daily*/' + dj + '/*end*/', g2, count=1, flags=re.S)
    if g2 != g: open(gp, 'w').write(g2); print('synced ROUTES / DAILY_LEVELS')
    html = open(os.path.join(SRC, 'index.html')).read()
    def inline(m):
        body = open(os.path.join(SRC, m.group(1))).read()
        assert '</script>' not in body, m.group(1) + ' contains </script>'
        return '<script>' + body + '</script>'
    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
    os.makedirs(DIST, exist_ok=True); open(os.path.join(DIST, 'index.html'), 'w').write(html)
    shutil.copy(os.path.join(SRC, 'manifest.json'), DIST); shutil.copytree(os.path.join(SRC, 'icons'), os.path.join(DIST, 'icons'), dirs_exist_ok=True)
    print('built', os.path.join(DIST, 'index.html'), os.path.getsize(os.path.join(DIST, 'index.html')) // 1024, 'KB')
if __name__ == '__main__': main()
