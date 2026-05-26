import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const dataDir=path.join(root,'data');
const reportsDir=path.join(root,'reports');
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
async function write(file,text){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);}
const stations=await readJson(path.join(dataDir,'stations.json'),[]);
const byState=new Map();
for(const s of stations){const state=s.state||'Unknown';if(!byState.has(state))byState.set(state,[]);byState.get(state).push(s);}
const missing=[];const weak=[];const duplicates=new Map();
for(const s of stations){if(!s.lat||!s.lng||!s.address)missing.push(s);const key=[s.name,s.city,s.state].join('|').toLowerCase();duplicates.set(key,(duplicates.get(key)||0)+1);if(!s.url||!String(s.url).includes('tesla.com/findus'))weak.push(s);}
const duplicateCount=[...duplicates.values()].filter(v=>v>1).length;
const stateLines=[...byState.entries()].sort((a,b)=>b[1].length-a[1].length).map(([state,list])=>`- ${state}: ${list.length}`);
const report=['# Location Quality Bot Report','',`Generated: ${new Date().toISOString()}`,'',`Total stations: ${stations.length}`,`Missing address or coordinates: ${missing.length}`,`Potential duplicate groups: ${duplicateCount}`,`Locations without Tesla page URL: ${weak.length}`,'','## Stations by state','',...stateLines,'','## Recommended improvements','','- Enrich missing addresses and coordinates from trusted public directories.','- Prefer Tesla location IDs when available.','- Keep Supercharge.info metadata as discovery backup, not pricing authority.','- Add state filters and map clustering for large station lists.',''].join('\n');
await write(path.join(reportsDir,'location-quality.md'),report);
console.log(report);
