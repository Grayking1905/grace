import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {Database} from '../server/db.js';
import {demoWorkspace,demoUser,now} from '../server/seed.js';
const url=process.env.GRACE_MYSQL_URL||JSON.parse(await readFile('data/mysql-test.json','utf8')).url;
if(!/^grace_(integration|ci|test)[a-z0-9_]*$/i.test(new URL(url).pathname.slice(1)))throw new Error('Use a dedicated MySQL test database.');
process.env.DATABASE_URL=url;process.env.APP_ORIGIN='http://127.0.0.2:4209';process.env.DEMO_MODE='true';
const app=await createApp({db:new Database('mysql'),seed:true,mailer:async()=>{}});const owner=request.agent(app.app);const csrf={'X-Grace-CSRF':'1'};await owner.post('/api/v1/auth/demo').set(csrf);
const key='PF'+[...randomBytes(6)].map(n=>String.fromCharCode(65+n%26)).join('');const project=await owner.post('/api/v1/projects').set(csrf).send({name:'Performance fixture · 500 cards',key,template:'basic'});if(project.status!==201)throw new Error('Could not create isolated fixture project.');
const projectId=project.body.id;const status=(await app.db.one<{id:string}>('SELECT id FROM statuses WHERE project_id=? ORDER BY position LIMIT 1',[projectId]))!.id;
await app.db.transaction(async()=>{for(let n=0;n<500;n++)await app.db.insert('issues',{id:randomUUID(),workspace_id:demoWorkspace,project_id:projectId,number:n+1,key:`${key}-${n+1}`,summary:`Performance fixture card ${n+1}`,description:'<p>A controlled MySQL performance fixture.</p>',type:'task',status_id:status,priority:'medium',reporter_id:demoUser,labels:'[]',due_date:'',start_date:'',rank:(n+1)*1024,created_at:now(),updated_at:now()});await app.db.run('UPDATE projects SET next_number=501 WHERE id=?',[projectId]);});
const cases=[['paginated_bootstrap',`/api/v1/bootstrap?issue_limit=100&project_id=${projectId}`],['search',`/api/v1/search/issues?q=Performance&project_id=${projectId}&limit=50`],['report',`/api/v1/reports/summary?project_id=${projectId}&days=30`]];
const measurements=[];for(const [name,path] of cases){const samples=[];let bytes=0;for(let n=0;n<12;n++){const start=performance.now();const response=await owner.get(path);if(response.status!==200)throw new Error(`Benchmark endpoint failed: ${name}`);const ms=performance.now()-start;if(n>1)samples.push(ms);bytes=Buffer.byteLength(JSON.stringify(response.body));}samples.sort((a,b)=>a-b);measurements.push({name,p50_ms:Math.round(samples[Math.floor(samples.length*.5)]*10)/10,p95_ms:Math.round(samples[Math.ceil(samples.length*.95)-1]*10)/10,response_bytes:bytes,samples:samples.length});}
await mkdir('docs/performance',{recursive:true});await writeFile('docs/performance/latest.json',JSON.stringify({recorded_at:now(),database:'MySQL 8.4.11',dataset_cards:500,concurrency:1,scope:'Local loopback API measurements, ten warm samples. Not a production load or cluster-scale validation.',measurements,ui_render:'Browser verification recorded separately.'},null,2));
console.log(JSON.stringify({project_id:projectId,measurements,preview:`http://127.0.0.2:4209/projects/${projectId}/board`}));
if(process.argv.includes('--serve')){await new Promise<void>(done=>app.httpServer.listen(4209,'127.0.0.2',()=>done()));console.log('Isolated performance preview ready.');const stop=async()=>{app.io.close();app.httpServer.close();await app.accounts.flush();await app.db.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);}else{await app.accounts.flush();app.io.close();await app.db.close();}
