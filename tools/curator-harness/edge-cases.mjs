import fs from 'fs';
global.window = { M3EMedia: { formatDuration: (ms)=>{const s=Math.round(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');} } };
eval(fs.readFileSync('/home/user/xbookmark/extension/dashboard/js/curator.js','utf8'));
const { curate } = window.XBCurator;
const now = Date.parse('2026-08-21T12:00:00Z');

const bare = (over={}) => Object.assign({
  id:'x'+Math.random(), position:1, post:{tweet_id:'p'+Math.random(), text:''}, media:{}, type:'photo', aspect:1,
  duration:0, alt:'', playable:true, postedAt:0, capturedAt:0, captureOrder:1, viewedAt:0, lastOpened:0,
  archived:false, progress:null, unseen:true, author:'', authorName:'', text:'', state:'available',
  eng:{likes:0,rts:0,replies:0,views:0,reactions:0,rate:0},
}, over);

const cases = {
  'empty library': [],
  'one item': [bare()],
  'five bare items (no author, no text, no dates)': Array.from({length:5},()=>bare()),
  'all archived': Array.from({length:30},()=>bare({archived:true, unseen:false})),
  'all seen, one author, no engagement': Array.from({length:40},(_,i)=>bare({author:'solo', unseen:false, viewedAt:now-i*1000, lastOpened:now-i*1000, capturedAt:now-400*86400000})),
  'null/garbage entries mixed in': [bare(), null, undefined, bare()].filter(x=>x!==undefined),
};
for (const [label, items] of Object.entries(cases)) {
  try {
    const r = curate(items.filter(Boolean), { now });
    console.log(label.padEnd(46), '→', r.shelves.length, 'shelves:', r.shelves.map(s=>s.id+'('+s.items.length+')').join(', ') || '—');
  } catch (e) { console.log(label.padEnd(46), '→ THREW', e.message); }
}

// author concentration per shelf on the large synthetic set
const AUTH=['a','b','c','d','e','f'];
const big = Array.from({length:600},(_,i)=>bare({
  id:'i'+i, author: i%9===0 ? 'dominant' : AUTH[i%AUTH.length],
  type: i%3?'photo':'video', duration: i%3?0:60000, capturedAt: now-(i%120)*86400000,
  postedAt: now-(i%300)*86400000, text:'city light study', unseen: i%4!==0,
  lastOpened: i%4===0 ? now-(i%20)*86400000 : 0, viewedAt: i%4===0 ? now : 0,
  eng:{likes:i*13%9000,rts:0,replies:0,views:i*77%50000,reactions:0,rate:0},
}));
const res = curate(big, { now });
console.log('\nper-shelf author concentration (600 items, one account owns 11%):');
res.shelves.forEach(s=>{
  const c=new Map(); s.items.slice(0,14).forEach(i=>c.set(i.author,(c.get(i.author)||0)+1));
  const top=[...c.entries()].sort((a,b)=>b[1]-a[1])[0];
  console.log('  ', s.id.padEnd(22), 'n='+String(s.items.length).padStart(3), 'top author', top[0].padEnd(9), (top[1]/Math.min(14,s.items.length)*100).toFixed(0)+'%');
});
