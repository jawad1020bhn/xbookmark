import fs from 'fs';
global.window = { M3EMedia: { formatDuration: (ms) => { const s=Math.round(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); } } };
eval(fs.readFileSync('/home/user/xbookmark/extension/dashboard/js/curator.js','utf8'));
const { curate } = window.XBCurator;

const AUTHORS = ['lenscraft','studionorth','tidefilm','motionbits','urbanlens','nightowl','archivist','maker','fieldnotes','coastline'];
const WORDS = ['sunset ridge light','portrait study sitting','waves coastline surf','looping sketch motion','city street night','film grain analog','studio lighting setup','field notes travel','archive restoration print','typography poster design'];
function makeLibrary(n, opts={}) {
  const now = opts.now || Date.parse('2026-08-21T12:00:00Z');
  const items = [];
  let rng = 1;
  const rand = () => { rng = (rng*1103515245+12345) % 2147483648; return rng/2147483648; };
  for (let i=0;i<n;i++) {
    const a = AUTHORS[Math.floor(rand()*AUTHORS.length)];
    const type = rand()<0.55 ? 'photo' : rand()<0.75 ? 'video' : 'animated_gif';
    const duration = type==='photo' ? 0 : Math.round(rand()*240000);
    const postedAt = now - Math.round(rand()*400*86400000);
    const capturedAt = now - Math.round(rand()*120*86400000);
    const opened = rand() < (a==='tidefilm' ? 0.55 : 0.08);   // one favourite account
    const perPost = 1 + Math.floor(rand()*rand()*4);
    items.push({
      id: 'i'+i, position: (i%perPost)+1,
      post: { tweet_id: 'p'+Math.floor(i/perPost), text: WORDS[Math.floor(rand()*WORDS.length)] },
      media: {}, type, aspect: [0.6,1,1.5,1.8][Math.floor(rand()*4)], duration,
      alt: rand()<0.3 ? 'described' : '', playable: rand()>0.06,
      postedAt, capturedAt, captureOrder: i+1,
      viewedAt: opened ? now-Math.round(rand()*30*86400000) : 0,
      lastOpened: opened ? now-Math.round(rand()*30*86400000) : 0,
      archived: false,
      progress: (type==='video' && rand()<0.05) ? { t: 12, d: duration/1000 } : null,
      unseen: !opened,
      author: a, authorName: a, text: WORDS[Math.floor(rand()*WORDS.length)],
      state:'available',
      eng: { likes: Math.floor(Math.pow(rand(),3)*50000), rts:0, replies:0, views: Math.floor(rand()*900000), reactions:0, rate:rand() },
    });
  }
  return items;
}
function report(label, items, ctx={}) {
  const t0 = performance.now();
  const { shelves, profile } = curate(items, ctx);
  const ms = (performance.now()-t0).toFixed(1);
  const shownCounts = new Map();
  shelves.forEach(s => s.items.slice(0,14).forEach(i => shownCounts.set(i.id,(shownCounts.get(i.id)||0)+1)));
  const visible = [...shownCounts.values()];
  const dup = visible.length ? (visible.reduce((a,b)=>a+b,0)/visible.length) : 0;
  // author concentration only means something on shelves that are NOT about an author
  const maxAuthorShare = shelves.filter(s=>s.kind!=='author'&&s.kind!=='personal').map(s => {
    const c = new Map(); s.items.slice(0,14).forEach(i=>c.set(i.author,(c.get(i.author)||0)+1));
    return Math.max(...c.values())/Math.min(14,s.items.length);
  });
  console.log(`\n${label}  (${items.length} items, ${profile.sizeClass}, ${ms}ms)`);
  console.log('  shelves:', shelves.length, '| unique items on screen:', visible.length, '| avg appearances/item:', dup.toFixed(2),
    '| worst single-author share (non-author rails):', (Math.max(...maxAuthorShare,0)*100).toFixed(0)+'%',
    '| families:', [...new Set(shelves.map(s=>s.kind))].join('/'));
  shelves.forEach((s,i)=>console.log(`   ${i+1}. ${String(s.score).padStart(5)} [${s.kind.padEnd(11)}] ${s.title}  — ${s.items.length} items · e.g. "${s.reasons[0]}"`));
  return shelves;
}

const now = Date.parse('2026-08-21T12:00:00Z');
report('TINY', makeLibrary(7), { now });
report('SMALL', makeLibrary(45), { now });
report('MEDIUM', makeLibrary(180), { now });
const big = makeLibrary(2400);
report('LARGE', big, { now });

// determinism + daily rotation
const a = curate(big, { now }).shelves.map(s=>s.id).join(',');
const b = curate(big, { now: now + 3600000 }).shelves.map(s=>s.id).join(',');
const c = curate(big, { now: now + 5*86400000 }).shelves.map(s=>s.id).join(',');
console.log('\nstable within a day:', a===b, '\nrotates across days:', a!==c);
console.log('  today:', a, '\n  +5d :', c);
