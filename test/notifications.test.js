import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

const password='Notificacoes-seguras-2026';
async function start(databasePath) {const app=createApp({databasePath});app.listen(0,'127.0.0.1');await once(app,'listening');return {app,base:`http://127.0.0.1:${app.address().port}`};}
const stop=app=>new Promise(resolve=>app.close(resolve));
async function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'cosmos-notifications-')),databasePath=join(dir,'test.sqlite');const ctx=await start(databasePath);ctx.databasePath=databasePath;
  t.after(async()=>{if(ctx.app.listening)await stop(ctx.app);rmSync(dir,{recursive:true,force:true});});
  ctx.call=async(path,body,cookie='')=>{const r=await fetch(ctx.base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  ctx.admin=await ctx.call('/api/register',{name:'Ana de teste',organization:'Uma',type:'privada',email:'notificacao@uma.com',password});
  ctx.sector=(await ctx.call('/api/workspace',undefined,ctx.admin.cookie)).data.sectors[0].id;
  ctx.person=async(email,role='colaborador')=>{await ctx.call('/api/users',{name:email.split('@')[0],email,password,role,sector_id:ctx.sector},ctx.admin.cookie);return ctx.call('/api/login',{email,password});};
  ctx.request=(cookie,title='Pedido de teste')=>ctx.call('/api/requests',{title,description:'Teste de notificação',priority:'normal',sector_id:ctx.sector},cookie);
  ctx.decide=(id,status='aprovada')=>ctx.call(`/api/requests/${id}/decision`,{status,decision:'Parecer de teste'},ctx.admin.cookie);
  return ctx;
}

test('notificações: migração, destinatário exclusivo, decisões e leitura persistente',async t=>{
  const c=await setup(t);const author=await c.person('solicitante@uma.com');const colleague=await c.person('colega@uma.com');
  const other=await c.call('/api/register',{name:'Externo',organization:'Outra',type:'publica',email:'notificacao@outra.com',password});
  const old=await c.request(author.cookie);assert.equal((await c.decide(old.data.id)).status,200);
  await stop(c.app);const legacy=new DatabaseSync(c.databasePath);legacy.exec('DROP TABLE notifications');legacy.close();Object.assign(c,await start(c.databasePath));
  const migrated=await c.call('/api/notifications',undefined,author.cookie);assert.deepEqual(migrated.data,{notifications:[],unreadCount:0,nextBefore:null});
  assert.equal((await c.call('/api/workspace',undefined,author.cookie)).data.requests.find(r=>r.id===old.data.id).status,'aprovada');
  const request=await c.request(author.cookie);assert.equal((await c.decide(request.data.id,'recusada')).status,200);
  const notes=(await c.call('/api/notifications',undefined,author.cookie)).data;assert.equal(notes.notifications.length,1);assert.equal(notes.unreadCount,1);
  const n=notes.notifications[0];assert.equal(n.request_id,request.data.id);assert.match(n.message,/recusada/);assert.equal(n.actor,'Ana de teste');assert.equal(n.read_at,null);
  assert.equal((await c.call('/api/workspace',undefined,author.cookie)).data.notification_unread,1);
  for(const user of [c.admin,colleague,other]) {
    const r=await c.call('/api/notifications',undefined,user.cookie);assert.deepEqual(r.data.notifications,[]);assert.equal(r.data.unreadCount,0);
    assert.equal((await c.call(`/api/notifications/${n.id}/read`,{},user.cookie)).status,404);
  }
  assert.equal((await c.decide(request.data.id)).status,409);assert.equal((await c.call('/api/notifications',undefined,author.cookie)).data.notifications.length,1);
  assert.equal((await c.call('/api/notifications')).status,401);assert.equal((await c.call(`/api/notifications/${n.id}/read`,{})).status,401);
  const read=await c.call(`/api/notifications/${n.id}/read`,{},author.cookie);assert.equal(read.status,200);assert.equal(read.data.unreadCount,0);
  const stamp=(await c.call('/api/notifications',undefined,author.cookie)).data.notifications[0].read_at;assert.ok(stamp);
  await c.call(`/api/notifications/${n.id}/read`,{},author.cookie);assert.equal((await c.call('/api/notifications',undefined,author.cookie)).data.notifications[0].read_at,stamp);
  await stop(c.app);Object.assign(c,await start(c.databasePath));
  const restored=(await c.call('/api/notifications',undefined,author.cookie)).data;assert.equal(restored.unreadCount,0);assert.equal(restored.notifications[0].read_at,stamp);
  assert.equal((await c.call('/api/workspace',undefined,author.cookie)).data.notification_unread,0);
});

test('notificações: administrador recebe apenas decisões próprias, com páginas de 50',async t=>{
  const c=await setup(t);const author=await c.person('admin-solicitante@uma.com','admin');
  for(let i=0;i<55;i++){const r=await c.request(author.cookie,'Pedido '+i);assert.equal((await c.decide(r.data.id)).status,200);}
  const first=(await c.call('/api/notifications',undefined,author.cookie)).data;assert.equal(first.notifications.length,50);assert.equal(first.unreadCount,55);assert.ok(first.nextBefore);
  const second=(await c.call('/api/notifications?before='+first.nextBefore,undefined,author.cookie)).data;assert.equal(second.notifications.length,5);assert.equal(second.nextBefore,null);
  const all=[...first.notifications,...second.notifications];assert.equal(new Set(all.map(n=>n.id)).size,55);for(let i=1;i<all.length;i++)assert.ok(all[i-1].id>all[i].id);
  assert.deepEqual((await c.call('/api/notifications',undefined,c.admin.cookie)).data.notifications,[]);
  for(const before of ['0','-1','1.5','1e3','01','9007199254740992',''])assert.equal((await c.call('/api/notifications?before='+encodeURIComponent(before),undefined,author.cookie)).status,400);
  const response=await fetch(c.base+'/api/notifications',{headers:{cookie:author.cookie}});assert.equal(response.headers.get('cache-control'),'no-store');
});

test('decisão e histórico são revertidos se a gravação da notificação falhar',async t=>{
  const c=await setup(t);const author=await c.person('rollback@uma.com');const r=await c.request(author.cookie);
  const before=(await c.call('/api/workspace',undefined,c.admin.cookie)).data.history;
  const db=new DatabaseSync(c.databasePath);db.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'falha simulada'); END");db.close();
  assert.equal((await c.decide(r.data.id)).status,500);
  const workspace=(await c.call('/api/workspace',undefined,c.admin.cookie)).data;assert.equal(workspace.requests.find(x=>x.id===r.data.id).status,'pendente');assert.deepEqual(workspace.history,before);
  assert.equal((await c.call('/api/notifications',undefined,author.cookie)).data.unreadCount,0);
  const repair=new DatabaseSync(c.databasePath);repair.exec('DROP TRIGGER fail_notification');repair.close();
  assert.equal((await c.decide(r.data.id)).status,200);assert.equal((await c.call('/api/notifications',undefined,author.cookie)).data.unreadCount,1);
});
