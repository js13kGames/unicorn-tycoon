#!/usr/bin/env python3
"""Stage a populated park in the real source game; never included in the build.

python3 tools/capture-park.py
Requires Python Playwright and its Chromium browser. Credits and day are changed
only in this isolated browser. The game source and player saves are untouched.
"""
import json
import functools
import http.server
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "media" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "src")))
threading.Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.add_init_script("""
      window.__nativeRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = () => 0;
      window.AudioContext = window.webkitAudioContext = function(){throw Error('silent capture')};
    """)
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    state = page.evaluate("""() => {
      el('l').className = ''; closeMenu(); GH = null;
      CR = 5000; DAY = 11; REP = .92; REPB = 7;
      const layout = [
        ['wheel',6,6], ['merryGoRound',10,6], ['meadow',13,8],
        ['pond',5,10], ['fountain',11,12],
        ['icecream',8,8], ['lemonade',9,8], ['sandwich',10,9],
        ['shop',13,12], ['toilets',8,13], ['toilets',14,11],
        ['bench',8,11], ['bench',13,14], ['bench',11,9],
        ['bin',8,9], ['bin',14,12], ['sign',13,10],
        ['icecream',7,13], ['lemonade',11,15], ['bench',6,13]
      ];
      for (const [id,x,y] of layout) {
        if (!canPlace(id,x,y)) throw Error('Invalid staging placement: '+id+' '+x+','+y);
        mk(id,x,y);
      }
      cam.z=1.5; fit();
      for(let i=0;i<15;i++){ PL.x=PL.tx=12.8; PL.y=PL.ty=15; }
      openPark();
      for(let i=0;i<1000;i++) {
        fit(); step(1/30);
        for(const b of BUILD) if(b.wear>.48) b.wear=0;
        SPARK.length=BEAM.length=POP.length=0;
      }
      PL.x=PL.tx=12.9; PL.y=PL.ty=14.8; PL.idle=999;
      el('h').className='A';
      cam.x=cam.y=0;
      let c=P(10.5,10.6,0); cam.x=W*.5-c[0]; cam.y=H*.55-c[1];
      upd(); render(0);
      return {day:DAY,credits:CR,visitors:VIS.length,canvas:[C.width,C.height],pixel:Array.from(X.getImageData(800,500,1,1).data),buildings:BUILD.map(b=>({type:b.t,x:b.x,y:b.y})),errors:[]};
    }""")
    def settle():
        page.evaluate("() => new Promise(r => __nativeRAF(() => __nativeRAF(r)))")
    settle()
    page.screenshot(path=str(OUT / "01-park-overview.png"))
    page.evaluate("""() => {
      el('t').style.display='none'; el('o').style.display='none';
      render(0);
    }""")
    settle()
    page.screenshot(path=str(OUT / "park-reference.png"))
    page.set_viewport_size({"width":1600,"height":900})
    settle()
    page.evaluate("""() => {
      resize(); cam.z=1.42; fit(); cam.x=cam.y=0;
      let c=P(10.5,10.6,0); cam.x=W*.5-c[0]; cam.y=H*.55-c[1];
      el('t').style.display='flex'; render(0);
    }""")
    settle()
    page.screenshot(path=str(OUT / "02-park-landscape.png"))
    page.evaluate("""() => {
      cam.z=2.2; fit();cam.x=cam.y=0;
      let c=P(11.8,13.4,0);cam.x=W*.5-c[0];cam.y=H*.52-c[1];
      render(0);
    }""")
    settle()
    page.screenshot(path=str(OUT / "03-park-closeup.png"))
    state["errors"] = errors
    (OUT / "park-state.json").write_text(json.dumps(state, indent=2)+"\n")
    browser.close()
    server.shutdown()
    print(json.dumps(state, indent=2))
    if errors:
        raise SystemExit(1)
