import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { orderRequests } from '../public/request-order.js';

test('ordenação mantém empates previsíveis, datas vencidas e pedidos sem prazo', () => {
  const requests=[{id:1,priority:'normal',due_date:null},{id:2,priority:'urgente',due_date:'2030-02-01'},{id:3,priority:'alta',due_date:'2020-01-01'},{id:4,priority:'urgente',due_date:'2020-01-01'},{id:5,priority:'urgente',due_date:'2020-01-01'},{id:6,priority:'alta',due_date:null}];
  const original=structuredClone(requests);
  const ids=order=>orderRequests(requests,order).map(r=>r.id);
  assert.deepEqual(ids('recent'),[6,5,4,3,2,1]);assert.deepEqual(ids('oldest'),[1,2,3,4,5,6]);
  assert.deepEqual(ids('priority'),[2,4,5,3,6,1]);assert.deepEqual(ids('deadline'),[4,5,3,2,6,1]);
  assert.deepEqual(requests,original);assert.deepEqual(orderRequests([],'deadline'),[]);
  assert.throws(()=>orderRequests(requests,'arbitraria'),/Ordenação inválida/);
});

test('CSV segue ordenação combinada com filtros e mantém isolamento por conta e organização', async t => {
  const app=createApp({databasePath:':memory:'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
  const base=`http://127.0.0.1:${app.address().port}`;
  async function call(path,body,cookie='') {const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const password='Ordenacao-segura-2026';
  const admin=await call('/api/register',{name:'Admin',organization:'Uma',type:'privada',email:'ordem@uma.com',password});
  const other=await call('/api/register',{name:'Outro',organization:'Outra',type:'publica',email:'ordem@outra.com',password});
  const sector=(await call('/api/workspace',undefined,admin.cookie)).data.sectors[0].id;
  const otherSector=(await call('/api/workspace',undefined,other.cookie)).data.sectors[0].id;
  await call('/api/users',{name:'Pessoa',email:'ordem-pessoa@uma.com',password,role:'colaborador',sector_id:sector},admin.cookie);
  const author=await call('/api/login',{email:'ordem-pessoa@uma.com',password});
  const specs=[['normal',null],['urgente','2030-02-01'],['alta','2020-01-01'],['urgente','2020-01-01'],['urgente','2020-01-01'],['alta',null]];const ids=[];
  for(let i=0;i<specs.length;i++) {const [priority,due_date]=specs[i];const created=await call('/api/requests',{title:'Pedido '+i,description:'Ordenação',priority,sector_id:sector},i===5?admin.cookie:author.cookie);ids.push(created.data.id);if(due_date)await call(`/api/requests/${created.data.id}/deadline`,{due_date},admin.cookie);}
  await call(`/api/requests/${ids[3]}/assignee`,{assigned_to:admin.data.id},admin.cookie);
  const foreign=await call('/api/requests',{title:'Pedido de outra organização',description:'Isolamento',priority:'urgente',sector_id:otherSector},other.cookie);
  async function csv(query,cookie=admin.cookie) {const r=await fetch(base+'/api/requests/export.csv?'+query,{headers:{cookie}});assert.equal(r.status,200);return [...(await r.text()).matchAll(/^"COS-(\d+)"/gm)].map(m=>Number(m[1]));}
  const expected=indexes=>indexes.map(i=>ids[i]);
  assert.deepEqual(await csv(''),expected([5,4,3,2,1,0]));assert.deepEqual(await csv('order=recent'),expected([5,4,3,2,1,0]));
  assert.deepEqual(await csv('order=oldest'),ids);assert.deepEqual(await csv('order=priority'),expected([1,3,4,2,5,0]));assert.deepEqual(await csv('order=deadline'),expected([3,4,2,1,5,0]));
  assert.deepEqual(await csv(`order=deadline&sector_id=${sector}&status=pendente&deadline=overdue`),expected([3,4,2]));
  assert.deepEqual(await csv('order=deadline&priority=urgente'),expected([3,4,1]));
  assert.deepEqual(await csv('order=deadline&assignment=mine'),expected([3]));assert.deepEqual(await csv('order=oldest&q=Pedido%202'),expected([1,2]));
  assert.deepEqual(await csv('order=deadline',author.cookie),expected([3,4,2,1,0]));assert.deepEqual(await csv('order=priority',other.cookie),[foreign.data.id]);
  for(const order of ['invalido','RECENT','id DESC','__proto__']) assert.equal((await call('/api/requests/export.csv?order='+encodeURIComponent(order),undefined,admin.cookie)).status,400);
  assert.equal((await call('/api/requests/export.csv?order=oldest')).status,401);
  assert.deepEqual((await call('/api/workspace',undefined,admin.cookie)).data.requests.map(r=>r.id),expected([5,4,3,2,1,0]));
  const asset=await fetch(base+'/request-order.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/text\/javascript/);
});
