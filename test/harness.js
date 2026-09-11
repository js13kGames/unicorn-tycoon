/* Sandbox for running the game outside a browser.
 *
 * Load the game in its own VM context and use DOM interactions wherever
 * possible. Terser preserves element IDs and click handlers, but this
 * harness also exposes internal names, so it targets the readable source.
 * Check the compressed build separately in real browsers.
 */
const fs = require('fs');
const vm = require('vm');

function boot(file, opts) {
  opts = opts || {};
  let raf = null, draws = 0, audioAsked = false;

  const ctx = () => new Proxy({
    setTransform(){}, save(){}, restore(){}, beginPath(){}, moveTo(){}, lineTo(){},
    closePath(){}, arc(){draws++;}, ellipse(){}, quadraticCurveTo(){},
    fillRect(){draws++;}, fill(){draws++;}, stroke(){draws++;}, clip(){},
    translate(){}, scale(){}, rotate(){}, strokeText(){}, fillText(){},
    createLinearGradient: () => ({ addColorStop(){} }),
    measureText: () => ({ width: 10 })
  }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });

  const mk = id => {
    const e = { id, style:{}, className:'', innerHTML:'', textContent:'',
                disabled:false, children:[], width:0, height:0, onclick:null,
                getContext: ctx, closest: () => null,
                addEventListener(){}, setPointerCapture(){} };
    e.appendChild = c => e.children.push(c);
    return e;
  };
  const els = {}, $ = id => els[id] || (els[id] = mk(id));

  const sandbox = {
    document: { getElementById: $, createElement: mk, addEventListener(){},
                head: mk('head'), body: mk('body') },
    window: { AudioContext: function(){ audioAsked = true; throw new Error("audio disabled in tests"); } },
    innerWidth: opts.w || 390, innerHeight: opts.h || 844, devicePixelRatio: 2,
    addEventListener(){}, requestAnimationFrame: f => { raf = f; return 0; },
    performance: { now: () => Date.now() },
    setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0,
    location: { reload(){} },
    Math, Date, Object, Array, JSON, String, Number, console
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.Wavedash = opts.wavedash;
  sandbox.localStorage = opts.storage;

  const src = opts.script || fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  // Expose internals for checks that cannot use the DOM, such as game state
  // inspection and direct building placement.
  const context = vm.createContext(sandbox);
  vm.runInContext(src + (opts.noApi ? '' : `
    ;globalThis.__api = { draw, fit, TY, BUILD, VIS, PL, mk, order, repair,
      openPark, nextDay, render,
      state(){ return { PH, DAY, CR, REPB, NB, visitors: VIS.length }; },
      stats(){ return DS; }, setCredits(v){ CR = v; } };`),
    context);

  let t = 0;
  return {
    el: $,
    api: sandbox.__api,
    audioAsked: () => audioAsked,
    draws: () => draws,
    evaluate(code) { return vm.runInContext(code, context); },
    run(n) {
      for (let i = 0; i < n; i++) {
        const f = raf;
        if (!f) return;
        raf = null; t += 16.7; f(t);
      }
    }
  };
}

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let failures = 0;
function check(label, got, want) {
  const ok = want === undefined ? !!got : String(got) === String(want);
  if (!ok) failures++;
  console.log((ok ? '  ok   ' : "  FAIL ") + '  ' + label +
              (ok ? '' : "   expected " + want + ", got " + got));
}
function report(title) {
  console.log(failures ? '\n' + failures + " failure(s): " + title
                       : "\nall checks passed: " + title);
  process.exit(failures ? 1 : 0);
}

module.exports = { boot, strip, check, report };
