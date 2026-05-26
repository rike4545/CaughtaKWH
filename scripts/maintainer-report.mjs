import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const dataDir=path.join(root,'data');
const reportDir=path.join(root,'reports');
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
async function write(file,text){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);}
const stations=await readJson(path.join(dataDir,'stations.json'),[]);
const predictions=await readJson(path.join(dataDir,'predictions.json'),[]);
let historyFiles=[];try{historyFiles=(await fs.readdir(path.join(dataDir,'history'))).filter(f=>f.endsWith('.json'));}catch{}
const missingCoords=stations.filter(s=>typeof s.lat!=='number'||typeof s.lng!=='number');
const missingAddress=stations.filter(s=>!s.address);
const suspicious=predictions.filter(p=>p.expectedPrice<0.05||p.expectedPrice>2.5||p.ci95High<p.ci95Low);
const lowSample=predictions.filter(p=>(p.sampleCount||0)<3);
const pricedStations=new Set(predictions.map(p=>p.stationId)).size;
const issues=[];
if(stations.length<1000)issues.push(`Station directory is small: ${stations.length}.`);
if(pricedStations<100)issues.push(`Only ${pricedStations} stations have price models so far.`);
if(missingCoords.length>stations.length*0.1)issues.push(`${missingCoords.length} stations are missing coordinates.`);
if(missingAddress.length>stations.length*0.15)issues.push(`${missingAddress.length} stations are missing addresses.`);
if(suspicious.length)issues.push(`${suspicious.length} suspicious price estimates found.`);
if(lowSample.length)issues.push(`${lowSample.length} low-sample estimates need more observations.`);
const backlog=['Add state filters','Add station history chart','Add pricing unavailable badge','Add non-Tesla toggle','Add data freshness timestamp','Add map clustering','Add anomaly detection','Document My EV Companion JSON contract'];
const report=['# CaughtaKWH Maintainer Report','',`Generated: ${new Date().toISOString()}`,'','## Health','',`- Stations: ${stations.length}`,`- Stations with price models: ${pricedStations}`,`- History files: ${historyFiles.length}`,`- Missing coordinates: ${missingCoords.length}`,`- Missing addresses: ${missingAddress.length}`,`- Suspicious estimates: ${suspicious.length}`,`- Low-sample estimates: ${lowSample.length}`,'','## Issues','',...(issues.length?issues.map(i=>`- ${i}`):['- No critical issues detected.']),'','## Suggested Backlog','',...backlog.map(i=>`- ${i}`),'','## Guardrail','','Reports are advisory. Changes should be reviewed before merge.',''].join('\n');
await write(path.join(reportDir,'maintainer-report.md'),report);
console.log(report);
