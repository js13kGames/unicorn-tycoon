/* Drawing and game simulation.
 * Check that every building type draws, then play three days with an
 * automatic player that addresses the previous day's biggest unmet need
 * and repairs buildings that break down.
 */
const { boot, check, report } = require('./harness');
const FILE = process.argv[2] || 'src/index.html';

const TYPES = ['carousel','merryGoRound','wheel','meadow','sign','sandwich','lemonade',
               'icecream','toilets','bin','bench','fountain','pond','shop','gate'];

console.log("Drawing");
const a = boot(FILE);
a.api.fit();
const broken = [];
TYPES.forEach(id => { try { a.api.draw(id, 2.4); } catch (e) { broken.push(id + ' : ' + e.message); } });
check(TYPES.length + " types draw without errors", broken.length ? broken.join(', ') : 0, 0);

console.log("\nThree days");
const g = boot(FILE);
g.el('w').onclick();          // leave the title screen
g.api.setCredits(400);

const PLAN = { 0:['carousel','merryGoRound','wheel','meadow','pond'],
               1:['sandwich','icecream'], 2:['lemonade','fountain'],
               3:['toilets'], 4:['bench'] };
let sat = [1, 1, 1, 1, 1];

for (let day = 1; day <= 3; day++) {
  for (let n = 0; n < 10; n++) {
    const order = [0,1,2,3,4].sort((x, y) => sat[x] - sat[y]);
    let bought = 0;
    for (const need of order) {
      const cand = PLAN[need].filter(id => g.api.state().CR >= g.api.TY[id].p * 1.4);
      if (!cand.length) continue;
      const id = cand[Math.floor(Math.random() * cand.length)], q = g.api.TY[id];
      for (let r = 0; r < 30; r++) {
        const x = 1 + Math.floor(Math.random() * (18 - q.w));
        const y = 1 + Math.floor(Math.random() * (18 - q.d));
        if (g.api.order(id, x, y)) { g.run(400); bought = 1; break; }
      }
      if (bought) break;
    }
    if (!bought) break;
  }
  g.el('o').onclick();
  let guard = 0;
  while (g.api.state().PH === 1 && guard < 700) {
    g.run(10);
    g.api.BUILD.forEach(b => { if (b.wear >= .95) g.api.repair(b); });
    guard++;
  }
  const st = g.api.stats();
  sat = st.sat.slice();
  const score = Math.round(sat.reduce((p, q) => p + q, 0) / 5 * 100);
  console.log("  day " + day + ' : ' + st.vis + " visitors, gauges " + score +
              "%, income " + st.income);
  check("  the day ends", g.api.state().PH, 2);
  check("  visitors arrived", st.vis > 0, true);
  check("  the gauges have values", score > 0, true);
  g.el('w').onclick();
}
check("the game reaches day 4", g.api.state().DAY, 4);

report("drawing and simulation");
