#!/usr/bin/env node
/**
 * record.mjs - automatic player and gameplay recorder.
 *
 *   src/index.html
 *        |
 *        |  1. Open the page in automated Chromium (file:// works because
 *        |     the game does not load anything from the network).
 *        |  2. Override requestAnimationFrame, advance the game with a fixed
 *        |     timestep, and capture the image between steps.
 *        |  3. An automatic player uses the real game engine, so the recording
 *        |     shows actual gameplay rather than a scripted animation.
 *        |  4. ffmpeg assembles the frames into a GIF or MP4.
 *        v
 *   media/gameplay.gif
 *
 * This is not a live screen recording. Advancing the game ourselves keeps the
 * frame timing steady. The world uses a seeded generator (sr()), and --seed
 * controls the random sequence used by the recorder and automatic player.
 *
 * THIS FILE IS NOT PART OF THE BUILD. build.sh never reads it, and nothing
 * here enters the ZIP. Recording dependencies are installed separately from
 * the build tools. Install Playwright, its browser, and ffmpeg with:
 *   npm i -D playwright && npx playwright install chromium
 *   brew install ffmpeg
 *
 * Usage:
 *   node tools/record.mjs                       -> media/gameplay.gif
 *   node tools/record.mjs --dry                 play without writing frames;
 *                                               print the timeline and frame numbers
 *   node tools/record.mjs --seed=42             use a different random seed
 *   node tools/record.mjs --speed=3             encode at 3x playback speed;
 *                                               simulation timing stays unchanged
 *   node tools/record.mjs --landscape           1280x720 instead of portrait
 *   node tools/record.mjs --pace=1.5            a more relaxed automatic player
 *   node tools/record.mjs --gap=2               more space between buildings
 *   node tools/record.mjs --from=120 --take=300  keep only this frame range
 *   node tools/record.mjs --video               1280x720 MP4 instead of GIF
 *   node tools/record.mjs --keep                keep the simulated PNG frames
 *   node tools/record.mjs --encode-only --gifWidth=480 --colors=48
 *                                               re-encode without replaying
 *   node tools/record.mjs --build               record dist/js13k/index.html
 *                                               with a limited player, described below
 *   node tools/record.mjs --exe=/path/to/Chromium
 *                                               use this browser instead of the one
 *                                               installed by Playwright; the
 *                                               $CHROMIUM_PATH variable also works
 *
 * Tune a GIF in two steps: --keep preserves the frames, and --encode-only
 * re-encodes them in seconds. Replaying for each setting wastes time and
 * compares different games instead of different encoding settings.
 *
 * These commands produced the files in media/. Use the explicit settings
 * below to recreate them; running without options uses different defaults.
 *
 *   # 1. media/gameplay-landscape.mp4: the construction phase, including menus
 *   #    and placement previews, followed by opening the park. 37 s, 2.0 MB.
 *   #    --keep preserves the frames for step 2.
 *   node tools/record.mjs --landscape --secs=44 --speed=2 --keep --video \
 *        --from=20 --take=1100 --crf=24 --out=media/gameplay-landscape.mp4
 *
 *   # 2. media/gameplay-landscape.gif: a short README excerpt showing the
 *   #    final placement, park opening and first visitors. 348 KiB.
 *   node tools/record.mjs --encode-only --landscape --speed=2 \
 *        --from=890 --take=300 --gifWidth=480 --colors=32 --gifFps=10 \
 *        --out=media/gameplay-landscape.gif
 *
 *   # 3. media/gameplay.gif: the same moment in phone portrait format. 466 KiB.
 *   node tools/record.mjs --secs=44 --speed=2 --keep \
 *        --from=890 --take=300 --gifWidth=320 --colors=32 --gifFps=10 \
 *        --out=media/gameplay.gif
 *
 * Read --from frame numbers from the --dry timeline. They change when --pace,
 * --gap or --seed changes, so inspect the timeline again after each adjustment.
 * GIF size depends on frame count, not duration: --gifFps controls file size.
 * Use --video for long sequences such as a 35-second recording.
 *
 * --build records the compressed contest page. Terser has mangled the global
 * function names, so the automatic
 * player can only use DOM elements and click handlers. Its actions are limited.
 * Record the source for full gameplay control; the rendered visuals are the same.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const O = {
  seed: 20260826,   // world seed used by the released game
  secs: 24,         // simulated duration in game seconds
  fps: 30,          // simulation rate. dt = 1/fps MUST stay <= .05,
                    //   otherwise the game caps dt and silently slows the video
  w: 420, h: 860,   // viewport. 420x860 is the target phone format
  from: 0,          // first frame to keep
  take: 0,          // number of frames to keep (0 = all)
  gifWidth: 300,    // GIF width; height follows the aspect ratio
  colors: 48,       // GIF palette. The game uses flat colors; 48 are enough,
                    //   and each color removed reduces the file size.
  crf: 23,          // MP4 quality. 18 is nearly lossless and large; 23 is a good
                    //   compromise; 28 is smaller with visible artifacts in flat colors.
  gifFps: 15,       // GIF frame rate, independent of the simulation. This controls
                    //   file size: GIFs grow with frame count, not duration,
                    //   so going from 30 to 15 halves the number of frames
                    //   without changing the perceived playback speed.
  gap: 1,          // empty cells between buildings. 0 packs the park tightly for
                    //   the best score; 1 leaves enough room for clear video;
                    //   2 gives more space, but visitors walk farther
                    //   and the evening satisfaction gauges drop.
  pace: 1,          // player pause multiplier. 1 is a relaxed playing pace;
                    //   0.6 is useful for a quick draft, and 1.5 produces
                    //   a very calm demonstration.
  landscape: false, // 1280x720 instead of phone portrait
  zoom: 1.7,        // camera zoom, between .62 and 2.2 like the pinch gesture.
                    //   The game starts at 1.25, good for playing but too wide for video.
  noFollow: false,  // keep the game camera instead of following the park
  speed: 1,         // playback speed multiplier. The simulation keeps its timestep;
                    //   only the encoding rate changes. A park day lasts about
                    //   65 seconds: too long for a README GIF at 1x,
                    //   but suitable at 3x.
  out: '',          // output path; default depends on --video
  video: false,
  keep: false,
  encodeOnly: false,
  dry: false,
  build: false,
  headed: false,
  exe: '',          // path to a Chromium executable. Useful when Playwright and
                    //   downloaded browsers have mismatched versions,
                    //   or to reuse an existing Chrome installation.
                    //   Can also be set through $CHROMIUM_PATH.
};

for (const a of process.argv.slice(2)) {
  const m = /^--([a-zA-Z][\w-]*)(?:=(.*))?$/.exec(a);
  if (!m) { console.error("unknown option: " + a); process.exit(1); }
  // --encode-only and --encodeOnly refer to the same option.
  const k = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const v = m[2];
  if (!(k in O)) {
    console.error("unknown option: --" + m[1]);
    console.error("available options: " + Object.keys(O).join(', '));
    process.exit(1);
  }
  O[k] = v === undefined ? true : (typeof O[k] === 'number' ? Number(v) : v);
}
if (!O.out) O.out = O.video ? 'media/gameplay.mp4' : 'media/gameplay.gif';
if ((O.video || O.landscape) && O.w === 420) { O.w = 1280; O.h = 720; }
// In landscape, the park spreads horizontally. Zoom out and frame higher
// to avoid filling the bottom half of the image with empty ground.
if (O.w > O.h && O.zoom === 1.7) O.zoom = 1.3;

const FRAMES = join(tmpdir(), 'unicorn-tycoon-frames');
const DT = 1 / O.fps;
if (DT > 0.05) {
  console.error(`--fps=${O.fps} gives dt=${DT.toFixed(3)}s, above the game limit of .05.`);
  console.error("The video would run slower than the simulated game. Use --fps=20 or higher.");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Code injected before the game starts                                */
/* ------------------------------------------------------------------ */

// Override rAF and the clock, and mute audio. Run BEFORE the game.
function harness({ seed, dt }) {
  let vt = 0, queue = [];
  window.requestAnimationFrame = f => { queue.push(f); return queue.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => vt * 1000;
  Date.now = () => 1767225600000 + vt * 1000;     // January 1, 2026, fixed
  // Disable audio: it consumes Math.random values and is not needed here.
  window.AudioContext = window.webkitAudioContext = function () { throw new Error("muted recording"); };
  // A FIXED timestep makes the recording reproducible.
  window.__step = () => { const b = queue; queue = []; vt += dt; for (const f of b) f(vt * 1000); };
  window.__seed = seed;
  window.__log = [];
}

// The automatic player runs inside the page after the game starts.
//
// It uses the INTERFACE: tap the unicorn to open the menu, switch tabs,
// choose a thumbnail, tap the ground to move the placement preview,
// and confirm. This takes more code than calling order() directly,
// but shows the menu, preview and placement bar in the recording.
// Those interactions are a major part of the game. Calling order()
// directly would make buildings appear without showing player input.
//
// Pause after every action. Without pauses, all actions happen in one
// frame: a person cannot choose a building in 33 milliseconds.
// A seeded LCG determines pause lengths, keeping repeated
// recordings consistent.
function pilot({ useGlobals, ids, fps, pace, gap }) {
  window.__gap = gap;
  const W = window;
  const el = i => document.getElementById(i);
  const log = m => W.__log.push(m);

  // The world uses sr(), an LCG whose seed is a script variable.
  // Only the source exposes it; the build mangles its name.
  if (useGlobals && W.__seed !== undefined) { try { W._s = W.__seed; } catch (e) {} }

  const G = useGlobals ? W : null;

  // Keep player randomness separate from the game simulation.
  let rs = (W.__seed || 1) ^ 0x5f3759df;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  // A human pause: requested duration plus or minus 30%, in frames.
  const pause = sec => Math.max(1, Math.round(sec * pace * fps * (0.7 + rnd() * 0.6)));

  let wait = pause(1.2);           // allow time to read the title screen
  let state = 'boot';
  let want = null, spot = null, aims = 0;

  // A real tap: pointerdown followed by pointerup at the same position.
  // The game accepts a tap only below 11 pixels of movement and
  // 480 ms duration; these consecutive events satisfy both conditions.
  function tapAt(sx, sy) {
    const c = el('c');
    const o = { pointerId: 1, clientX: sx, clientY: sy, bubbles: true, cancelable: true };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
    c.dispatchEvent(new PointerEvent('pointerup', o));
  }
  const tapGrid = (gx, gy) => { const p = G.P(gx, gy, 0); tapAt(p[0], p[1]); };

  // Group buildings without crowding. The game rewards density: visitor
  // payments reflect their average need gauges over time, so walking
  // has a cost. canPlace() only prevents overlap. Using it alone packs
  // buildings edge to edge, which scores well but looks unclear in video.
  // Enforce spacing and search outward in a spiral around the entrance.
  function clearOf(id, x, y, gap) {
    const s = G.TY[id];
    for (const b of G.BUILD) {
      const q = G.TY[b.t];
      // both footprints, with the candidate expanded by gap cells
      if (x - gap < b.x + q.w && x + s.w + gap > b.x &&
          y - gap < b.y + q.d && y + s.d + gap > b.y) return false;
    }
    return true;
  }
  function nextSpot(id) {
    const q = G.TY[id];
    // Try the requested spacing first, then reduce it if no space remains
    // instead of returning null and stopping construction.
    for (let gap = W.__gap; gap >= 0; gap--)
      for (let r = 1; r < 13; r++)
        for (let a = 0; a < 32; a++) {
          const ang = (a / 32) * 6.283;
          const x = Math.round(G.EX + Math.cos(ang) * r) - 1;
          const y = Math.round(G.EY - 3 + Math.sin(ang) * r);
          if (x > 0 && y > 0 && x + q.w < G.GRID && y + q.d < G.GRID &&
              G.canPlace(id, x, y) && clearOf(id, x, y, gap))
            return { x, y };
        }
    return null;
  }

  // Fill the biggest gap: first meet needs with no service, then add
  // support buildings, and finally expand capacity.
  const BYNEED = { 0: ['carousel', 'merryGoRound', 'wheel', 'meadow', 'pond'],
                   1: ['sandwich', 'icecream'], 2: ['lemonade', 'fountain'],
                   3: ['toilets'], 4: ['bench'] };
  function wanted() {
    for (let n = 0; n < 5; n++)
      if (!G.HAS[n])
        for (const id of BYNEED[n]) if (G.CR >= G.price(id)) return id;
    for (const id of ['sign', 'bin', 'shop']) {
      let have = 0;
      for (const b of G.BUILD) if (b.t === id) have++;
      if (!have && G.CR >= G.price(id) * 1.5) return id;
    }
    for (let n = 0; n < 5; n++)
      for (const id of BYNEED[n]) if (G.CR >= G.price(id) * 2.2) return id;
    return null;
  }

  // Find a building thumbnail in the menu: its tab and position.
  function menuPos(id) {
    const k = G.TY[id].k;
    const inTab = G.ORDER.filter(o => G.TY[o].k === k);
    return { tab: k, idx: inTab.indexOf(id) };
  }

  W.__tick = () => {
    if (--wait > 0) return;

    // Title screen and evening report share one button with the same ID.
    if (el(ids.modal).className === ids.on) {
      const b = el(ids.nx);
      if (b && b.onclick) { b.onclick(); log("TAP screen"); }
      state = 'idle'; wait = pause(1.6);
      return;
    }

    if (!useGlobals) {                    // compiled build: limited automatic player
      const o = el(ids.open);
      if (o && o.style.display === 'block') { o.onclick(); log('OPEN'); wait = pause(3); }
      return;
    }

    if (G.PH === 0) {                     // ---- morning: construction ----
      if (G.PL.task) { wait = 2; return; }        // the unicorn is already building

      switch (state) {
        case 'boot':
        case 'idle': {
          want = wanted();
          if (!want) { state = 'toOpen'; wait = pause(1.4); return; }
          spot = nextSpot(want);
          if (!spot) { state = 'toOpen'; wait = pause(1.4); return; }
          // Tap the unicorn. She is the largest target in the game
          // and the first interaction a player learns.
          const p = G.P(G.PL.x, G.PL.y, 22);
          tapAt(p[0], p[1]);
          log('MENU');
          state = 'browse'; wait = pause(1.0);
          return;
        }
        case 'browse': {
          const { tab } = menuPos(want);
          const tb = el('b').children[tab];
          if (tb && tab !== G.TAB) { tb.onclick(); log("TAB " + G.CATN[tab]); wait = pause(0.9); }
          else wait = pause(0.4);
          state = 'pick';
          return;
        }
        case 'pick': {
          const { idx } = menuPos(want);
          const item = el('i').children[idx];
          if (!item) { state = 'idle'; wait = pause(0.5); return; }
          item.onclick();
          log("SELECT " + G.TY[want].n);
          aims = 1 + (rnd() < 0.45 ? 1 : 0);   // sometimes adjust the position once
          state = 'aim'; wait = pause(0.9);
          return;
        }
        case 'aim': {
          if (!G.GH) { state = 'idle'; wait = pause(0.6); return; }
          const q = G.TY[want];
          if (aims > 1) {
            // first tap slightly off target, as if looking for a good spot
            tapGrid(spot.x + q.w / 2 + 1.6, spot.y + q.d / 2 + 0.8);
            aims--; wait = pause(0.7);
          } else {
            tapGrid(spot.x + q.w / 2, spot.y + q.d / 2);
            state = 'confirm'; wait = pause(0.8);
          }
          return;
        }
        case 'confirm': {
          const ok = el('v');
          if (ok && !ok.disabled) { ok.onclick(); log("PLACE " + G.TY[want].n); }
          else { el('u').onclick(); log("CANCEL"); }
          state = 'wait-build'; wait = pause(0.4);
          return;
        }
        case 'wait-build': {
          if (G.PL.task) { wait = 3; return; }
          state = 'idle'; wait = pause(1.8);      // pause between placements
          return;
        }
        case 'toOpen': {
          const o = el(ids.open);
          if (o && o.style.display === 'block') { o.onclick(); log("OPEN park"); }
          state = 'idle'; wait = pause(2.0);
          return;
        }
      }
      return;
    }

    // ---- afternoon: maintenance ----
    // Allow reaction time between noticing an alert and tapping it.
    let worst = null;
    for (const b of G.BUILD)
      if (G.TY[b.t].m && b.wear >= 0.55 && (!worst || b.wear > worst.wear)) worst = b;
    if (worst) {
      const q = G.TY[worst.t];
      const p = G.P(worst.cx, worst.cy, q.hz + 16);   // target the alert bubble, not the ground
      tapAt(p[0], p[1]);
      log("REPAIR " + worst.t);
      wait = pause(1.5);
      return;
    }
    if (G.PL.idle > 4) { G.PL.tx = G.EX - 1; G.PL.ty = G.EY - 4; }
    wait = pause(0.6);
  };

  // Camera: the game starts zoomed out over a mostly empty 20x20 grid.
  // Recording that view would fill most of a README GIF with grass.
  // Frame the center of the buildings and follow it smoothly.
  // This only changes cam.x/y/z, just like a finger on the screen;
  // it does not change the simulation.
  W.__frame = (zoom, follow) => {
    if (!useGlobals || !G.cam) return;
    G.cam.z = zoom;
    // HW/HH exist only after the first fit() call, on the first frame.
    // Without this guard, the first calculation uses undefined,
    // cam.x becomes NaN, and the camera never recovers:
    // nothing is drawn, with no error.
    if (!follow || !G.HW || !G.HH || !G.BUILD.length) return;

    // Measure the existing screen positions, then move the camera
    // toward their center. Inverse projection worked in portrait
    // but drifted in landscape: the visual center differs from the
    // grid center because buildings extend hz pixels above their cells
    // and the unicorn must also fit within the frame.
    // Measuring the drawing avoids approximating its geometry.
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    const add = (gx, gy, gz) => {
      const p = G.P(gx, gy, gz);
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    };
    for (const b of G.BUILD) {
      const q = G.TY[b.t];
      add(b.cx, b.cy, 0);          // ground footprint
      add(b.cx, b.cy, q.hz);       // top of the drawing
    }
    if (G.PL) add(G.PL.x, G.PL.y, 22);

    // The construction menu occupies the bottom third of the screen.
    // Aim higher while it is open to keep the park visible above it.
    const menuOpen = document.getElementById('m').className === 'M';
    const aimY = G.H * (menuOpen ? 0.30 : 0.46);
    G.cam.x += (G.W / 2 - (minx + maxx) / 2) * 0.06;
    G.cam.y += (aimY - (miny + maxy) / 2) * 0.06;
    G.cam.vx = G.cam.vy = 0;
  };
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

function ffmpeg(args) {
  try { return execFileSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) {
    console.error("ffmpeg failed. To install it, run `brew install ffmpeg`.");
    console.error(String(e.stderr || e.message).split('\n').slice(-6).join('\n'));
    process.exit(1);
  }
}

function encode() {
  const files = readdirSync(FRAMES).filter(f => /^\d+\.png$/.test(f)).sort();
  if (!files.length) { console.error("no frames in " + FRAMES); process.exit(1); }
  // files.length counts frames, but numbering may start at O.from
  // from a previous run. Limit the range to frames that actually exist.
  const last = Number(files[files.length - 1].replace('.png', ''));
  const firstAvail = Number(files[0].replace('.png', ''));
  const first = Math.max(O.from, firstAvail);
  const count = Math.min(O.take || (last - first + 1), last - first + 1);
  if (count <= 0) {
    console.error(`--from=${O.from} exceeds the available frame range (${firstAvail} to ${last}).`);
    process.exit(1);
  }
  const out = resolve(ROOT, O.out);
  mkdirSync(dirname(out), { recursive: true });
  const rate = O.fps * O.speed;
  // -frames:v is an OUTPUT option: it must follow all inputs, or ffmpeg
  // assigns it to the next input file (the palette) and rejects it.
  const input = ['-framerate', String(rate), '-start_number', String(first),
                 '-i', join(FRAMES, '%05d.png')];
  const frames = ['-frames:v', String(count)];
  if (O.video) {
    ffmpeg(['-y', ...input, ...frames, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-crf', String(O.crf), out]);
  } else {
    const pal = join(FRAMES, 'palette.png');
    const vf = `fps=${O.gifFps * O.speed},scale=${O.gifWidth}:-1:flags=lanczos`;
    ffmpeg(['-y', ...input, ...frames,
            '-vf', `${vf},palettegen=max_colors=${O.colors}:stats_mode=diff`, pal]);
    ffmpeg(['-y', ...input, '-i', pal, ...frames, '-lavfi',
            `[0:v]${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, out]);
  }
  // du -h rounds to disk blocks and overestimates. Report actual bytes,
  // which determine the size of the file served on GitHub.
  const bytes = statSync(out).size;
  const size = bytes > 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.round(bytes / 1e3) + " kB";
  console.log(`\n  ${O.out}  ${size}  (frames ${first} to ${first + count - 1}, from ${firstAvail}-${last} available)`);
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

async function play() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (e) {
    console.error("Playwright is missing. Install the optional recording dependency:");
    console.error('  npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  const page_file = O.build ? 'dist/js13k/index.html' : 'src/index.html';
  const target = resolve(ROOT, page_file);
  if (!existsSync(target)) {
    console.error(`${page_file} not found.` + (O.build ? " Run `npm run build` first." : ''));
    process.exit(1);
  }

  // Stable IDs: Terser renames neither element IDs nor click handlers.
  // They remain the same in the source and the ZIP.
  const ids = { modal: 'l', card: 'z', nx: 'w', open: 'o', day: 'd', cr: 'r', on: 'M' };

  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  const exe = O.exe || process.env.CHROMIUM_PATH || '';
  const browser = await chromium.launch({ headless: !O.headed,
                                          ...(exe ? { executablePath: exe } : {}) });
  const page = await browser.newPage({ viewport: { width: O.w, height: O.h },
                                       deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript(harness, { seed: O.seed, dt: DT });
  await page.goto('file://' + target, { waitUntil: 'load' });
  await page.evaluate(pilot, { useGlobals: !O.build, ids, fps: O.fps, pace: O.pace, gap: O.gap });

  const total = Math.round(O.secs * O.fps);
  const timeline = [];
  let written = 0;
  for (let f = 0; f < total; f++) {
    // Order matters: __step() advances one game frame, including fit(),
    // which updates HW/HH from cam.z. __frame() frames the NEXT image.
    await page.evaluate(({ zoom, follow }) => {
      window.__tick();
      window.__step();
      window.__frame(zoom, follow);
    }, { zoom: O.zoom, follow: !O.noFollow });
    const events = await page.evaluate(() => { const l = window.__log; window.__log = []; return l; });
    for (const e of events) timeline.push(`  f${String(f).padStart(4)}  ${e}`);
    if (!O.dry) {
      const png = await page.screenshot({ type: 'png' });
      writeFileSync(join(FRAMES, String(f).padStart(5, '0') + '.png'), png);
      written++;
    }
    if (f % Math.max(1, Math.round(total / 20)) === 0)
      process.stdout.write(`\r  simulation ${Math.round((f / total) * 100)}%   `);
  }
  process.stdout.write('\r  simulation 100%      \n');

  const state = await page.evaluate(ids => ({
    day: document.getElementById(ids.day).textContent,
    cr: document.getElementById(ids.cr).textContent,
  }), ids);
  await browser.close();

  console.log(`\nTimeline (${timeline.length} events):`);
  console.log(timeline.join('\n') || "  (none)");
  console.log(`\n  simulation ended: ${state.day}, ${state.cr} credits`);
  console.log(`  ${written} frames written to ${FRAMES}`);
  if (errors.length) {
    console.log(`\n  ${errors.length} console error(s):`);
    console.log('   ' + errors.slice(0, 5).join('\n   '));
  }
  return written;
}

/* ------------------------------------------------------------------ */

if (O.encodeOnly) {
  if (!existsSync(FRAMES)) {
    console.error(`no saved frames in ${FRAMES}. Run with --keep first.`);
    process.exit(1);
  }
  encode();
} else {
  const n = await play();
  if (!O.dry && n) {
    encode();
    if (!O.keep) rmSync(FRAMES, { recursive: true, force: true });
    else console.log(`  frames saved (--keep): reuse them with --encode-only`);
  }
}
