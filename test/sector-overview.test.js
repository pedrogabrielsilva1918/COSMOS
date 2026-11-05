import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { summarizeSectors } from '../public/sector-overview.js';

test('resumo por setor conta pendências, preserva inativos e ignora urgência de decisões encerradas', () => {
  const sectors=[{id:1,name:'Administração',active:1},{id:2,name:'Tecnologia',active:1},{id:3,name:'Arquivo antigo',active:0},{id:4,name:'Sem pedidos',active:1}];
  const requests=[{id:1,sector_id:1,status:'pendente',priority:'urgente',is_overdue:true},{id:2,sector_id:1,status:'aprovada',priority:'urgente',is_overdue:true},{id:3,sector_id:2,status:'pendente',priority:'normal',is_overdue:false},{id:4,sector_id:2,status:'pendente',priority:'alta',is_overdue:true},{id:5,sector_id:3,status:'recusada',priority:'urgente',is_overdue:false},{id:6,sector_id:999,status:'pendente',priority:'urgente',is_overdue:true}];
  const original=structuredClone({sectors,requests});
  assert.deepEqual(summarizeSectors(sectors,requests),[
    {id:2,name:'Tecnologia',active:1,total:2,pending:2,overdue:1,urgent:0},
    {id:1,name:'Administração',active:1,total:2,pending:1,overdue:1,urgent:1},
    {id:3,name:'Arquivo antigo',active:0,total:1,pending:0,overdue:0,urgent:0}
  ]);
  assert.deepEqual({sectors,requests},original);assert.deepEqual(summarizeSectors(sectors,[]),[]);
  const tied=[{id:9,name:'Beta',active:1},{id:8,name:'Água',active:1}];
  assert.deepEqual(summarizeSectors(tied,tied.map(s=>({sector_id:s.id,status:'pendente',priority:'normal'}))).map(s=>s.name),['Água','Beta']);
});

test('resumo usa somente pedidos fornecidos pelo workspace autorizado', async t => {
  const app=createApp({databasePath:':memory:'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
  const base=`http://127.0.0.1:${app.address().port}`;
  async function call(path,body,cookie='') {const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const password='Resumo-setor-2026';
  const admin=await call('/api/register',{name:'Admin',organization:'Uma',type:'privada',email:'resumo@uma.com',password});
  const other=await call('/api/register',{name:'Outro',organization:'Outra',type:'publica',email:'resumo@outra.com',password});
  await call('/api/sectors',{name:'Segundo setor'},admin.cookie);
  const initial=(await call('/api/workspace',undefined,admin.cookie)).data;const [first,second]=initial.sectors;
  const otherSector=(await call('/api/workspace',undefined,other.cookie)).data.sectors[0];
  for(const [name,email] of [['Autor','resumo-autor@uma.com'],['Colega','resumo-colega@uma.com']])await call('/api/users',{name,email,password,role:'colaborador',sector_id:first.id},admin.cookie);
  const author=await call('/api/login',{email:'resumo-autor@uma.com',password});const colleague=await call('/api/login',{email:'resumo-colega@uma.com',password});
  async function request(cookie,sector_id,priority='normal'){return call('/api/requests',{title:'Pedido de teste',description:'Resumo por destino',priority,sector_id},cookie);}
  const late=await request(author.cookie,first.id,'urgente');await call(`/api/requests/${late.data.id}/deadline`,{due_date:'2020-01-01'},admin.cookie);
  await request(admin.cookie,first.id);
  const approved=await request(author.cookie,second.id,'urgente');await call(`/api/requests/${approved.data.id}/decision`,{status:'aprovada',decision:'Autorizado'},admin.cookie);
  await request(colleague.cookie,second.id,'alta');await request(other.cookie,otherSector.id,'urgente');
  async function summary(cookie){const w=(await call('/api/workspace',undefined,cookie)).data;return summarizeSectors(w.sectors,w.requests);}
  const team=await summary(admin.cookie);assert.equal(team.length,2);
  assert.deepEqual(team.map(s=>[s.id,s.total,s.pending,s.overdue,s.urgent]),[[first.id,2,2,1,1],[second.id,2,1,0,0]]);
  assert.deepEqual((await summary(author.cookie)).map(s=>[s.id,s.total,s.pending,s.overdue,s.urgent]),[[first.id,1,1,1,1],[second.id,1,0,0,0]]);
  const foreign=await summary(other.cookie);assert.equal(foreign.length,1);assert.equal(foreign[0].id,otherSector.id);assert.equal(foreign[0].total,1);
  const asset=await fetch(base+'/sector-overview.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/text\/javascript/);
});
