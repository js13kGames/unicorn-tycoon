/* Interface cycle, using DOM interactions where possible.
 * Title screen -> construction -> opening -> hint -> report -> day 2.
 */
const { boot, strip, check, report } = require('./harness');
const FILE = process.argv[2] || 'src/index.html';
const g = boot(FILE);

console.log("Title screen");
check("the modal opens at startup", g.el('l').className, 'M');
const card = strip(g.el('z').innerHTML);
check("the title is present", /U ?n ?i ?c ?o ?r ?n/.test(card));
check("the start button is present", /Tap to start/.test(card));
g.run(60);
check("the modal stays open until tapped", g.el('l').className, 'M');
check("the game runs in the background", g.el('r').textContent, '120');

console.log("\nStarting");
g.el('w').onclick();
check("the modal closes", g.el('l').className, '');
check("the gesture requests audio", g.audioAsked(), true);

console.log("\nOpening button");
g.run(30);
check("hidden until the first building is placed", g.el('o').style.display, 'none');
g.api.order('toilets', 12, 12);
g.run(400);
check("appears after the first placement", g.el('o').style.display, 'block');
check("the building exists", g.api.BUILD.length, 3);

console.log("\nDaytime");
g.el('o').onclick();
g.run(20);
check("the park enters the open phase", g.api.state().PH, 1);
check("the button disappears", g.el('o').style.display, 'none');

console.log("\nMaintenance hint");
let tips = 0, last = '';
for (let i = 0; i < 5000; i++) {
  g.run(1);
  const h = g.el('h').textContent;
  if (h === 'Tap to repair' && last !== h) tips++;
  last = h;
}
check("appears exactly once", tips, 1);

console.log("\nEvening report");
check("the modal reopens", g.el('l').className, 'M');
const rep = strip(g.el('z').innerHTML);
check("the report has the correct title", /Evening of day 1/.test(rep));
check("all five gauges are present",
      ['Have fun', 'Eat', 'Drink', 'Toilets', 'Rest'].every(n => rep.includes(n)));
g.el('w').onclick();
g.run(5);
check("the game advances to day 2", g.el('d').textContent, 'Day 2/13');
check("the button returns", g.el('o').style.display, 'block');

report("interface cycle");
