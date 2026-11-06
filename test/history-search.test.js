import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

async function start(databasePath=':memory:') {const app=createApp({databasePath});app.listen(0,'127.0.0.1');await once(app,'listening');return {app,base:`http://127.0.0.1:${app.address().port}`};}
const stop=app=>new Promise(resolve=>app.close(resolve));
async function call(base,path,body,cookie='') {const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const password='Historico-completo-2026';

test('histórico completo pagina registros antigos, preserva cursor e isola organizações e perfis', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cosmos-history-search-')),databasePath=join(dir,'test.sqlite');let running=await start(databasePath);
  t.after(async()=>{if(running.app.listening)await stop(running.app);rmSync(dir,{recursive:true,force:true});});
  const a=await call(running.base,'/api/register',{name:'José',organization:'Uma',type:'privada',email:'historico@uma.com',password});
  const b=await call(running.base,'/api/register',{name:'Pessoa externa',organization:'Outra',type:'publica',email:'historico@outra.com',password});
  const w=(await call(running.base,'/api/workspace',undefined,a.cookie)).data;
  await call(running.base,'/api/users',{name:'João',email:'historico-joao@uma.com',password,role:'colaborador',sector_id:w.sectors[0].id},a.cookie);
  const collaborator=await call(running.base,'/api/login',{email:'historico-joao@uma.com',password});
  const person=(await call(running.base,'/api/workspace',undefined,a.cookie)).data.users.find(u=>u.email==='historico-joao@uma.com');
  const otherOrg=(await call(running.base,'/api/workspace',undefined,b.cookie)).data.organization.id;
  await stop(running.app);
  const seed=new DatabaseSync(databasePath);seed.exec('DROP INDEX audit_org_cursor');
  const insert=seed.prepare('INSERT INTO audit(org_id,actor_id,action) VALUES (?,?,?)');const ids=[];
  for(let i=0;i<123;i++) ids.push(Number(insert.run(w.organization.id,i===40?person.id:a.data.id,`Registro histórico item ${String(i).padStart(3,'0')}`).lastInsertRowid));
  const externalId=Number(insert.run(otherOrg,b.data.id,'Registro externo reservado').lastInsertRowid);seed.close();
  running=await start(databasePath); // recria índice, sem substituir registros ou sessões
  const inspect=new DatabaseSync(databasePath,{readOnly:true});assert.ok(inspect.prepare("SELECT name FROM sqlite_schema WHERE name='audit_org_cursor'").get());inspect.close();
  const get=query=>call(running.base,'/api/history?'+query,undefined,a.cookie);
  const first=await get('q=registro');assert.equal(first.status,200);assert.deepEqual(first.data.history.map(h=>h.id),ids.slice(-50).reverse());assert.equal(first.data.nextBefore,first.data.history.at(-1).id);
  const concurrent=new DatabaseSync(databasePath);const newest=Number(concurrent.prepare('INSERT INTO audit(org_id,actor_id,action) VALUES (?,?,?)').run(w.organization.id,a.data.id,'Registro novo durante consulta').lastInsertRowid);concurrent.close();
  const second=await get('q=registro&before='+first.data.nextBefore);assert.equal(second.data.history.length,50);
  const third=await get('q=registro&before='+second.data.nextBefore);assert.equal(third.data.history.length,23);assert.equal(third.data.nextBefore,null);
  const all=[...first.data.history,...second.data.history,...third.data.history];assert.deepEqual(all.map(h=>h.id),[...ids].reverse());assert.equal(new Set(all.map(h=>h.id)).size,123);
  assert.equal((await get('q=registro')).data.history[0].id,newest);
  const actor=await get('q=REGISTRO%20JOAO');assert.equal(actor.data.history.length,1);assert.equal(actor.data.history[0].actor,'João');assert.match(actor.data.history[0].action,/040/);
  const old=await get('q=historico%20item%20000');assert.deepEqual(old.data.history.map(h=>h.id),[ids[0]]);
  const foreign=await call(running.base,'/api/history?q=registro&org_id='+w.organization.id,undefined,b.cookie);assert.deepEqual(foreign.data.history.map(h=>h.id),[externalId]);
  assert.equal((await call(running.base,'/api/history')).status,401);assert.equal((await call(running.base,'/api/history',undefined,collaborator.cookie)).status,403);
  assert.equal((await call(running.base,'/api/workspace',undefined,a.cookie)).data.history.length,50);
  const count=new DatabaseSync(databasePath,{readOnly:true});assert.equal(count.prepare('SELECT COUNT(*) AS n FROM audit WHERE org_id=?').get(w.organization.id).n,126);count.close();
});

test('busca do histórico trata sinais como texto e valida cursores e tamanho', async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const admin=await call(base,'/api/register',{name:'José',organization:'Uma',type:'privada',email:'historico-parametros@uma.com',password});
  await call(base,'/api/sectors',{name:"Setor %_ O'Reilly"},admin.cookie);
  const get=query=>call(base,'/api/history?'+query,undefined,admin.cookie);
  for(const cursor of ['0','-1','1.5','01','1e3','0x10','9007199254740992',''])assert.equal((await get('before='+encodeURIComponent(cursor))).status,400,cursor);
  assert.equal((await get('q='+('a'.repeat(201)))).status,400);
  const literal=await get('q='+encodeURIComponent("%_ O'Reilly"));assert.equal(literal.data.history.length,1);assert.ok(literal.data.history[0].action.includes("%_ O'Reilly"));
  const attack=await get('q='+encodeURIComponent("' OR 1=1 --"));assert.equal(attack.status,200);assert.deepEqual(attack.data.history,[]);
  const accents=await get('q=CRIADO%20JOSE');assert.equal(accents.data.history.length,1);
  const response=await fetch(base+'/api/history',{headers:{cookie:admin.cookie}});assert.equal(response.headers.get('cache-control'),'no-store');
});
