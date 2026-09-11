const assert = require('assert/strict');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { minify } = require('terser');
const { boot } = require('./harness');
const options = require('../tools/minify.cjs');
const definitions = JSON.parse(fs.readFileSync('achievements.json', 'utf8'));
const ids = definitions.achievements.map(a => a.identifier);
const names = ['happiest-park-v1','rainbow-tycoon-v1','crowd-pleaser-v1'];
const flush = () => new Promise(resolve => setImmediate(resolve));

// The same test bridge is transformed WITH the game, so the release's exact
// top-level AND property mangling options remain enabled in this test.
const bridge = `
globalThis.__api = {
  identifiers(){ return ACH.join(','); },
  mask(){ return AM; },
  construct(i){
    CR=10000; order(ORDER[i],3,3); PL.x=PL.tx; PL.y=PL.ty;
    stepPlayer(1.2);
  },
  pending(){ CR=10000; order(ORDER[11],3,3); },
  fix(w){ BUILD[1].wear=w; repair(BUILD[1]); },
  closing(a){
    openPark(); DS.vis=a[0]; DS.happy=a[1]; DS.angry=a[2]; DS.brokeN=a[3];
    DS.n=a[0]; DS.sat=Array(5).fill(a[0]*a[4]); DS.mood=a[0]*a[5]; DS.income=a[6];
    endDay();
  },
  advance(){ nextDay(); },
  repeated(){ endDay(); openPark(); endDay(); },
  earned(i){ award(i); },
  paint(){ fit(); render(0); },
  showToast(){ step(.01); },
  recap(){ return el('z').innerHTML; },
  totals(){ return RUN.join(',')+':'+DAYS; },
  play(){
    openPark();
    for(var t=0;t<10000 && PH===1;t++){
      BUILD.forEach(function(b){ if(b.wear>.55) repair(b); }); step(1/30);
    }
    if(PH!==2) throw Error('Day did not finish');
  }
};`;

function sdk() {
  const calls = { init:0, awarded:[], scores:[], created:[], invalid:[] };
  const got = new Set();
  let ready = false;
  function valid(condition, message) {
    if (!condition) { calls.invalid.push(message); throw Error(message); }
  }
  const wd = {
    init(){ calls.init++; return true; },
    async requestStats(){ ready=true; return {success:true,data:true}; },
    getAchievement(id){ valid(ready,'stats not ready'); return got.has(id); },
    setAchievement(id, storeNow){
      valid(ready && ids.includes(id),'unknown achievement / stats not ready');
      valid(typeof storeNow==='boolean' && storeNow,'storeNow must be boolean true');
      calls.awarded.push(id); got.add(id); return true;
    },
    async getOrCreateLeaderboard(name, sort, display){
      valid(names.includes(name) && sort===1 && display===0,'leaderboard schema');
      calls.created.push(name);
      return {success:true,data:{id:name,created:true,name,totalEntries:0}};
    },
    async uploadLeaderboardScore(id, score, keepBest){
      valid(names.includes(id),'expected data.id');
      valid(Number.isSafeInteger(score) && score>=0,'nonnegative integer score');
      valid(typeof keepBest==='boolean' && keepBest,'keepBest must be boolean true');
      calls.scores.push([id,score]); return {success:true,data:{}};
    }
  };
  return {wd,calls,got,setReady(){ready=true;}};
}

async function suite(script, label) {
  const fresh = opts => boot(null, {script,noApi:true,...opts});
  const a = fresh();
  assert.equal(a.api.identifiers(),ids.join(','));
  assert.equal(a.api.mask(),0,'initial free buildings do not award');
  a.api.pending(); assert.equal(a.api.mask(),0,'order alone does not award');
  const b = fresh();
  b.api.construct(11); assert.equal(b.api.mask(),1);
  b.api.showToast(); assert.match(b.el('ac').textContent,/FIRST SPARK/);
  [6,8,10].forEach(i=>b.api.construct(i));
  assert(b.api.mask() & 2,'all five needs');
  b.api.construct(1); assert(!(b.api.mask() & 4),'two rides insufficient');
  b.api.construct(2); assert(b.api.mask() & 4);
  b.api.construct(3); assert(!(b.api.mask() & 8),'zoo alone insufficient');
  b.api.construct(5); assert(b.api.mask() & 8,'sign placed second');
  const zoo = fresh(); zoo.api.construct(5); zoo.api.construct(4);
  assert(zoo.api.mask() & 8,'pond placed second');
  const repair = fresh(); repair.api.fix(.99); assert.equal(repair.api.mask(),0);
  repair.api.fix(1); assert.equal(repair.api.mask(),16);
  const checkDay = (values,bit,want) => {
    const g=fresh(); g.api.closing(values); assert.equal(!!(g.api.mask() & (1<<bit)),want);
  };
  checkDay([19,9,0,0,1,1,100],5,false);
  checkDay([19,10,0,0,1,1,100],5,true);
  checkDay([19,0,0,0,1,1,100],6,false);
  checkDay([20,0,0,0,1,1,100],6,true);
  for (const values of [[14,0,0,0,1,1,0],[15,0,1,0,1,1,0],[15,0,0,1,1,1,0]])
    checkDay(values,7,false);
  checkDay([15,0,0,0,1,1,0],7,true);

  const remote=sdk(), g=fresh({wavedash:remote.wd});
  await flush();
  assert.equal(remote.calls.init,1);
  assert.equal(new Set(remote.calls.created).size,3);
  assert.equal(remote.calls.scores.length,0,'startup only prepares boards');
  for(let d=1;d<=13;d++) {
    g.api.closing([20,10,0,0,.8,1,d*10]);
    const totals=g.api.totals(); g.api.repeated(); assert.equal(g.api.totals(),totals);
    await flush();
    assert.equal(remote.calls.scores.length,d===13?3:0);
    if(d<13) assert(!(g.api.mask() & 512),'day 13 must finish');
    g.api.advance();
  }
  assert.deepEqual(remote.calls.scores,[[names[0],8000],[names[1],910],[names[2],130]]);
  assert(g.api.mask() & 512);
  assert.match(g.api.recap(),/Happiest Park: 8000/);
  assert.match(g.api.recap(),/Rainbow Tycoon: 910/);
  g.api.advance(); await flush(); assert.equal(remote.calls.scores.length,3);
  assert(g.api.mask() & 256,'80% plateau eventually reaches six bands');
  const rep=fresh();
  for(let d=0;d<3;d++){
    rep.api.closing([1,0,0,0,1,1,0]); rep.api.advance();
    if(d<2) assert(!(rep.api.mask() & 256),'five bands are insufficient');
  }
  assert(rep.api.mask() & 256,'third perfect day reaches six bands');

  // Hold stats pending while gameplay unlocks, then release them.
  const delayed=sdk(); let resolve;
  delayed.wd.requestStats=()=>new Promise(r=>resolve=r);
  const dg=fresh({wavedash:delayed.wd}); dg.api.construct(11);
  await flush(); assert.equal(delayed.calls.awarded.length,0);
  delayed.setReady(); resolve({success:true,data:true}); await flush();
  for(let i=0;i<10;i++) dg.api.earned(i);
  await flush();
  for(let i=0;i<10;i++) dg.api.earned(i);
  await flush();
  assert.deepEqual(delayed.calls.awarded.slice().sort(),ids.slice().sort());
  assert.deepEqual(delayed.calls.invalid,[]);
  assert.deepEqual(remote.calls.invalid,[]);

  const known=sdk(); known.got.add(ids[0]);
  const kg=fresh({wavedash:known.wd}); await flush(); kg.api.construct(11); await flush();
  assert.equal(known.calls.awarded.length,0,'already unlocked is not flushed');
  const data=new Map(), storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,''+v)};
  fresh({storage}).api.construct(11);
  assert.equal(fresh({storage}).api.mask(),1,'persist offline awards');
  assert.deepEqual([...data.keys()],['unicorn-tycoon.achievements.v1']);
  const badStorage={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};
  fresh({storage:badStorage}).api.construct(11);

  for(const failure of ['reject','false','missing']) {
    const broken=sdk();
    if(failure==='missing') broken.wd={};
    else for(const method of Object.keys(broken.wd))
      broken.wd[method]=failure==='reject'?()=>Promise.reject(Error('offline')):()=>({success:false});
    const game=fresh({wavedash:broken.wd});
    game.api.construct(11); game.api.paint();
    for(let d=0;d<13;d++){ game.api.closing([1,0,0,0,1,1,0]); game.api.advance(); }
    await flush(); assert(game.api.mask() & 512,'broken SDK must not stop game');
  }
  // One failed board must not suppress the other two.
  const partial=sdk(), create=partial.wd.getOrCreateLeaderboard;
  partial.wd.getOrCreateLeaderboard=(n,...args)=>n===names[0]?Promise.reject(Error('one board')):create(n,...args);
  const pg=fresh({wavedash:partial.wd});
  for(let d=0;d<13;d++){pg.api.closing([1,0,0,0,1,1,0]);pg.api.advance();}
  await flush();assert.equal(partial.calls.scores.length,2);
  const uploadFailure=sdk();
  uploadFailure.wd.uploadLeaderboardScore=()=>Promise.reject(Error('upload failed'));
  const uf=fresh({wavedash:uploadFailure.wd});
  for(let d=0;d<13;d++){uf.api.closing([1,0,0,0,1,1,0]);uf.api.advance();}
  await flush(); assert(uf.api.mask() & 512);
  const initFailure=sdk(); initFailure.wd.init=()=>{throw Error('init unavailable');};
  const ig=fresh({wavedash:initFailure.wd}); ig.api.construct(11); await flush();
  assert.deepEqual(initFailure.calls.awarded,[ids[0]],'init failure does not skip stats');
  const unknown=sdk(); unknown.wd.setAchievement=()=>false;
  const ug=fresh({wavedash:unknown.wd}); ug.api.construct(11); await flush();
  // A false return releases the deduplication guard for a later retry.
  let retries=0; unknown.wd.setAchievement=()=>{retries++;return true;};
  ug.api.earned(0); await flush(); assert.equal(retries,1);

  // A full season using real visitors and the real closing logic.
  const real=fresh(); [6,8,10,11].forEach(i=>real.api.construct(i));
  for(let d=0;d<13;d++){real.api.play();real.api.advance();}
  assert(real.api.mask() & 512);
  assert(real.api.totals().endsWith(':13'));
  console.log(label+': achievements, 13-day scores, strict API, offline and failure cases pass');
}

(async()=>{
  assert.equal(ids.length,10); assert.equal(new Set(ids).size,10);
  assert.deepEqual(definitions.stats,[]);
  for(const a of definitions.achievements) {
    assert(a.display_name && a.description); assert.equal(a.stat_requirement,null);
  }
  const source=fs.readFileSync('src/index.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  await suite(source+bridge,'Source');
  // Run the real build preparation, including shortened private building IDs.
  const temp=fs.mkdtempSync(require('path').join(require('os').tmpdir(),'tycoon-test-'));
  try {
    execFileSync('python3',['tools/inline.py','src/index.html',temp]);
    const code=(await minify(fs.readFileSync(temp+'/app.js','utf8')+bridge,options)).code;
    await suite(code,'Release Terser options');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
