import { reviewedDecision } from '../test-support/reviewed-decision.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { renderRequestPrint } from '../request-print.js';

const password = 'Teste-seguro-2026!';

async function start(options = {}) {
  const app = createApp({ databasePath: ':memory:', ...options });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  return { app, base: `http://127.0.0.1:${app.address().port}` };
}
const stop = app => new Promise(resolve => app.close(resolve));
async function post(base, path, body, headers = {}) {
  body = await reviewedDecision(base,path,body,headers.cookie || '');
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

test('corpo JSON com caractere multibyte dividido entre blocos é preservado', async t => {
  const { app, base } = await start(); t.after(() => stop(app));
  const bytes = Buffer.from(JSON.stringify({ name: 'José Conceição', organization: 'Órgão Público', type: 'publica', email: 'jose@exemplo.com', password }));
  // Corta no meio de "ç" (2 bytes em UTF-8), forçando a divisão em dois blocos de rede.
  const cut = bytes.indexOf(Buffer.from('ç')) + 1;
  const response = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, res => {
      const parts = []; res.on('data', part => parts.push(part));
      res.on('end', () => resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0].split(';')[0], body: JSON.parse(Buffer.concat(parts).toString('utf8')) }));
    });
    req.on('error', reject);
    req.write(bytes.subarray(0, cut));
    setTimeout(() => req.end(bytes.subarray(cut)), 50);
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.name, 'José Conceição');
  const workspace = await (await fetch(base + '/api/workspace', { headers: { cookie: response.cookie } })).json();
  assert.equal(workspace.organization.name, 'Órgão Público');
});

test('cursor de comentários aceita apenas inteiros positivos', async t => {
  const { app, base } = await start(); t.after(() => stop(app));
  const admin = await post(base, '/api/register', { name: 'Ana', organization: 'Empresa', type: 'privada', email: 'ana@exemplo.com', password });
  const sector = (await (await fetch(base + '/api/workspace', { headers: { cookie: admin.cookie } })).json()).sectors[0].id;
  const created = await post(base, '/api/requests', { title: 'Pedido', description: 'Teste', priority: 'normal', sector_id: sector }, { cookie: admin.cookie });
  const get = async before => (await fetch(`${base}/api/requests/${created.data.id}/comments?before=${before}`, { headers: { cookie: admin.cookie } })).status;
  for (const invalid of ['abc', '0', '-1', '1.5', '1e3', '0x10', '']) assert.equal(await get(invalid), 400, `before=${invalid}`);
  assert.equal(await get('5'), 200);
});

test('limite de tentativas ignora X-Forwarded-For por padrão', async t => {
  const { app, base } = await start(); t.after(() => stop(app));
  const attempt = n => post(base, '/api/login', { email: 'x@exemplo.com', password: 'qualquer-senha-12' }, { 'X-Forwarded-For': `198.51.100.${n}` });
  for (let n = 1; n <= 20; n++) assert.equal((await attempt(n)).status, 401);
  // Cabeçalho forjado não escapa do limite, já que o cliente real é o mesmo.
  assert.equal((await attempt(99)).status, 429);
});

test('com TRUST_PROXY o limite usa o IP do cliente informado pelo proxy', async t => {
  const { app, base } = await start({ trustProxy: true, trustedProxyIps: ['127.0.0.1'] }); t.after(() => stop(app));
  const attempt = ip => post(base, '/api/login', { email: 'x@exemplo.com', password: 'qualquer-senha-12' }, { 'X-Forwarded-For': `203.0.113.250, ${ip}` });
  for (let n = 0; n < 20; n++) assert.equal((await attempt('10.0.0.1')).status, 401);
  assert.equal((await attempt('10.0.0.1')).status, 429);
  // Outro cliente atrás do mesmo proxy não é bloqueado junto.
  assert.equal((await attempt('10.0.0.2')).status, 401);
});

test('resumo imprimível lida com dados ausentes ou inválidos', () => {
  const html = renderRequestPrint({
    request: { id: 7, status: 'aprovada', title: '<img src=x onerror=alert(1)>', author: 'Ana', sector: 'TI', priority: 'alta', created_at: 'lixo', decided_at: 'lixo', description: 'Texto', decision: null, reviewer: null, due_date: null, assignee_name: null },
    organization: { name: '<b>Empresa</b>', type: 'privada' },
  });
  assert.ok(!html.includes('Invalid Date'));
  assert.ok(html.includes('Sem parecer registrado.'));
  assert.ok(!html.includes('<img') && html.includes('&lt;img'));
  assert.ok(!html.includes('<b>Empresa</b>'));
});

test('modo proxy exige IPs confiáveis e para no primeiro salto não confiável', async () => {
  const { createClientAddress } = await import('../client-address.js');
  assert.throws(() => createClientAddress({trustProxy:true}), /TRUSTED_PROXY_IPS/);
  for (const ips of [['*'], ['0.0.0.0/0'], ['localhost'], ['invalid'], ['127.0.0.1', '']]) assert.throws(() => createClientAddress({trustProxy:true,trustedProxyIps:ips}), /IP/);
  assert.throws(() => createClientAddress({trustProxy:'true',trustedProxyIps:['127.0.0.1']}), /TRUST_PROXY/);
  const address=createClientAddress({trustProxy:true,trustedProxyIps:['127.0.0.1','10.0.0.1']});
  const req=(socket,forwarded)=>({socket:{remoteAddress:socket},headers:forwarded===undefined?{}:{'x-forwarded-for':forwarded}});
  assert.equal(address(req('192.0.2.1','198.51.100.1')), '192.0.2.1');
  assert.equal(address(req('127.0.0.1','203.0.113.99, 198.51.100.1')), '198.51.100.1');
  assert.equal(address(req('127.0.0.1','203.0.113.99, 198.51.100.1, 10.0.0.1')), '198.51.100.1');
  assert.equal(address(req('::ffff:127.0.0.1','198.51.100.1')), '198.51.100.1');
  for (const invalid of ['', 'lixo', '198.51.100.1,', ',198.51.100.1', '198.51.100.1, lixo', '198.51.100.01', 'fe80::1%eth0', Array(33).fill('198.51.100.1').join(',')]) assert.equal(address(req('127.0.0.1',invalid)), '127.0.0.1',invalid);
  assert.equal(address(req('127.0.0.1')), '127.0.0.1');
  assert.equal(address(req('127.0.0.1','2001:0DB8:0000:0000:0000:0000:0000:0001')), '2001:db8::1');
  assert.equal(address(req('127.0.0.1','::FFFF:198.51.100.1')), '198.51.100.1');
  assert.equal(address(req('127.0.0.1','0:0:0:0:0:ffff:c633:6401')), '198.51.100.1');
});

test('cabeçalhos forjados em conexão não confiável não burlam o limite no modo proxy', async t => {
  const {app,base}=await start({trustProxy:true,trustedProxyIps:['10.0.0.1']});t.after(()=>stop(app));
  for(let n=1;n<=20;n++) assert.equal((await post(base,'/api/login',{email:'x@exemplo.com',password},{'X-Forwarded-For':`198.51.100.${n}`})).status,401);
  assert.equal((await post(base,'/api/login',{email:'x@exemplo.com',password},{'X-Forwarded-For':'198.51.100.99'})).status,429);
});

test('prefixos falsificados e grafias equivalentes não reiniciam o contador do cliente', async t => {
  const {app,base}=await start({trustProxy:true,trustedProxyIps:['127.0.0.1']});t.after(()=>stop(app));
  for(let n=1;n<=20;n++) assert.equal((await post(base,'/api/login',{email:'x@exemplo.com',password},{'X-Forwarded-For':`203.0.113.${n}, 198.51.100.1`})).status,401);
  assert.equal((await post(base,'/api/login',{email:'x@exemplo.com',password},{'X-Forwarded-For':'203.0.113.99, ::ffff:198.51.100.1'})).status,429);
  assert.equal((await post(base,'/api/login',{email:'x@exemplo.com',password},{'X-Forwarded-For':'198.51.100.2'})).status,401);
});

test('limite do corpo usa bytes: 24000 aceitos, excesso rejeitado e JSON inválido bloqueado', async t => {
  const {app,base}=await start();t.after(()=>stop(app));
  const body=JSON.stringify({email:'x@exemplo.com',password,padding:'á'.repeat(10000)});
  const remaining=24000-Buffer.byteLength(body);
  const send=content=>fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:content});
  assert.equal((await send(body+' '.repeat(remaining))).status,401);
  assert.equal((await send(body+' '.repeat(remaining+1))).status,413);
  for(const invalid of ['{','null','[]','"texto"']) assert.equal((await send(invalid)).status,400);
});

test('encerrar outros acessos preserva sessão atual e contas alheias', async t => {
  const {app,base}=await start();t.after(()=>stop(app));
  const a=await post(base,'/api/register',{name:'Ana',organization:'A',type:'privada',email:'sessao-a@exemplo.com',password});
  const b=await post(base,'/api/register',{name:'Bia',organization:'B',type:'publica',email:'sessao-b@exemplo.com',password});
  const workspace=async cookie=>fetch(base+'/api/workspace',{headers:{cookie}});
  const initial=await (await workspace(a.cookie)).json();
  await post(base,'/api/users',{name:'Colega',email:'sessao-c@exemplo.com',password,sector_id:initial.sectors[0].id,role:'colaborador'},{cookie:a.cookie});
  const c=await post(base,'/api/login',{email:'sessao-c@exemplo.com',password});
  const second=await post(base,'/api/login',{email:'sessao-a@exemplo.com',password});
  const third=await post(base,'/api/login',{email:'sessao-a@exemplo.com',password});
  assert.equal((await post(base,'/api/account/sessions/revoke-others',{})).status,401);
  const revoke=await post(base,'/api/account/sessions/revoke-others',{}, {cookie:a.cookie});
  assert.equal(revoke.status,200);assert.equal(revoke.data.revoked,2);assert.equal(revoke.cookie,undefined);
  assert.equal((await workspace(a.cookie)).status,200);
  for(const cookie of [second.cookie,third.cookie]) assert.equal((await workspace(cookie)).status,401);
  for(const cookie of [b.cookie,c.cookie]) assert.equal((await workspace(cookie)).status,200);
  const again=await post(base,'/api/account/sessions/revoke-others',{}, {cookie:a.cookie});assert.equal(again.data.revoked,0);
  assert.equal((await post(base,'/api/account/sessions/revoke-others',{}, {cookie:second.cookie})).status,401);
  const restored=await post(base,'/api/login',{email:'sessao-a@exemplo.com',password});assert.equal(restored.status,200);
  const history=(await (await workspace(a.cookie)).json()).history;
  assert.equal(history.filter(h=>h.action==='Outros acessos da própria conta encerrados').length,1);
  // A mesma operação funciona para colaborador e preserva a própria sessão dele.
  const colleagueOther=await post(base,'/api/login',{email:'sessao-c@exemplo.com',password});
  assert.equal((await post(base,'/api/account/sessions/revoke-others',{}, {cookie:c.cookie})).data.revoked,1);
  assert.equal((await workspace(colleagueOther.cookie)).status,401);assert.equal((await workspace(c.cookie)).status,200);
  assert.equal((await workspace(a.cookie)).status,200);
});

test('solicitante edita apenas pedido próprio pendente e detecta versão desatualizada',async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const admin=await post(base,'/api/register',{name:'Admin',organization:'Edição',type:'privada',email:'edit-admin@example.com',password});
  const workspace=async cookie=>(await fetch(base+'/api/workspace',{headers:{cookie}})).json();
  const sector=(await workspace(admin.cookie)).sectors[0].id;
  await post(base,'/api/users',{name:'Autor',email:'edit-author@example.com',password,role:'colaborador',sector_id:sector},{cookie:admin.cookie});
  const author=await post(base,'/api/login',{email:'edit-author@example.com',password});
  const other=await post(base,'/api/register',{name:'Outro',organization:'Outra',type:'publica',email:'edit-other@example.com',password});
  const original={title:'Título original',description:'Justificativa original'};
  const created=await post(base,'/api/requests',{...original,priority:'alta',sector_id:sector},{cookie:author.cookie});
  const path=`/api/requests/${created.data.id}/edit`,body={title:'Título corrigido',description:'Justificativa corrigida',expected:original};
  const before=(await workspace(author.cookie)).requests[0];
  assert.equal((await post(base,path,body)).status,401);
  for(const cookie of [admin.cookie,other.cookie]) assert.equal((await post(base,path,body,{cookie})).status,404);
  assert.equal((await post(base,path,{...body,title:' '},{cookie:author.cookie})).status,400);
  assert.equal((await post(base,path,{...body,title:'x'.repeat(161)},{cookie:author.cookie})).status,400);
  assert.equal((await post(base,path,{...body,expected:null},{cookie:author.cookie})).status,400);
  assert.equal((await post(base,path,body,{cookie:author.cookie})).status,200);
  let after=(await workspace(author.cookie)).requests[0];
  assert.equal(after.title,body.title);assert.equal(after.description,body.description);
  for(const key of ['id','user_id','sector_id','priority','status','created_at','due_date','assigned_to'])assert.equal(after[key],before[key]);
  assert.equal((await post(base,path,{...body,title:'É outra mudança'},{cookie:author.cookie})).status,409);
  const history=async()=>(await fetch(base+`/api/requests/${created.data.id}/history`,{headers:{cookie:author.cookie}})).json();
  let movements=(await history()).history;assert.equal(movements.filter(h=>h.action.includes('editada pelo solicitante')).length,1);
  const noChange={title:body.title,description:body.description,expected:{title:body.title,description:body.description}};
  assert.equal((await post(base,path,noChange,{cookie:author.cookie})).status,200);assert.deepEqual((await history()).history,movements);
  assert.equal((await post(base,`/api/requests/${created.data.id}/decision`,{status:'aprovada',decision:'Aprovado após correção'},{cookie:admin.cookie})).status,200);
  assert.equal((await post(base,path,{...noChange,title:'Após aprovação'},{cookie:author.cookie})).status,409);
  after=(await workspace(author.cookie)).requests[0];assert.equal(after.title,body.title);assert.equal(after.status,'aprovada');
  const own=await post(base,'/api/requests',{...original,priority:'normal',sector_id:sector},{cookie:admin.cookie});
  assert.equal((await post(base,`/api/requests/${own.data.id}/edit`,body,{cookie:admin.cookie})).status,200);
});

test('CSV usa busca ampliada e mantém isolamento de pedidos',async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const admin=await post(base,'/api/register',{name:'João',organization:'Busca',type:'privada',email:'search@example.com',password});
  const workspace=await (await fetch(base+'/api/workspace',{headers:{cookie:admin.cookie}})).json();const sector=workspace.sectors[0];
  await post(base,'/api/users',{name:'Bia',email:'search-bia@example.com',password,role:'colaborador',sector_id:sector.id},{cookie:admin.cookie});
  const bia=await post(base,'/api/login',{email:'search-bia@example.com',password});
  for(const cookie of [admin.cookie,bia.cookie])await post(base,'/api/requests',{title:'Compra de teste',description:'Reposição para a recepção',priority:'normal',sector_id:sector.id},{cookie});
  const csv=async(query,cookie)=>{const r=await fetch(base+'/api/requests/export.csv?q='+encodeURIComponent(query),{headers:{cookie}});assert.equal(r.status,200);return r.text();};
  const found=await csv('recepcao joao',admin.cookie);assert.match(found,/COS-00001/);assert.doesNotMatch(found,/COS-00002/);
  assert.doesNotMatch(await csv('recepcao joao',bia.cookie),/COS-00001/);
  assert.match(await csv('bia recepcao',bia.cookie),/COS-00002/);
  assert.match(await csv(sector.name+' recepcao',admin.cookie),/COS-00001/);
  const periodCSV=async(query,cookie=admin.cookie)=>{const r=await fetch(base+'/api/requests/export.csv?'+query,{headers:{cookie}});return {status:r.status,text:await r.text()};};
  const inPeriod=await periodCSV('from=2000-01-01&to=2099-12-31&q=recepcao%20joao');assert.equal(inPeriod.status,200);assert.match(inPeriod.text,/COS-00001/);assert.doesNotMatch(inPeriod.text,/COS-00002/);
  assert.doesNotMatch((await periodCSV('from=2099-01-01')).text,/COS-0000/);
  assert.doesNotMatch((await periodCSV('to=2000-01-01')).text,/COS-0000/);
  assert.doesNotMatch((await periodCSV('from=2000-01-01&to=2099-12-31',bia.cookie)).text,/COS-00001/);
  for(const query of ['from=2026-02-29','to=2026-04-31','from=2026-11-07&to=2026-11-06','from=abc'])assert.equal((await periodCSV(query)).status,400);
  const periodModule=await fetch(base+'/request-period.js');assert.equal(periodModule.status,200);assert.match(periodModule.headers.get('content-type'),/javascript/);
  const module=await fetch(base+'/request-search.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
});

test('resumo CSV por setor agrega somente pedidos autorizados e filtrados',async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const admin=await post(base,'/api/register',{name:'Admin',organization:'Relatórios',type:'privada',email:'summary@example.com',password});
  const other=await post(base,'/api/register',{name:'Outro',organization:'Outra',type:'publica',email:'summary-other@example.com',password});
  const workspace=await (await fetch(base+'/api/workspace',{headers:{cookie:admin.cookie}})).json();const first=workspace.sectors[0];
  await post(base,'/api/sectors',{name:'Zeta resumo'},{cookie:admin.cookie});
  const sectors=(await (await fetch(base+'/api/workspace',{headers:{cookie:admin.cookie}})).json()).sectors;const second=sectors.find(s=>s.name==='Zeta resumo');
  await post(base,'/api/users',{name:'Autor',email:'summary-author@example.com',password,role:'colaborador',sector_id:first.id},{cookie:admin.cookie});
  const author=await post(base,'/api/login',{email:'summary-author@example.com',password});
  const create=async(sector,priority,cookie)=>post(base,'/api/requests',{title:'Material relatório',description:'Teste resumo',priority,sector_id:sector},{cookie});
  const overdue=await create(first.id,'urgente',author.cookie);
  await post(base,`/api/requests/${overdue.data.id}/deadline`,{due_date:'2020-01-01'},{cookie:admin.cookie});
  const approved=await create(first.id,'normal',author.cookie);await post(base,`/api/requests/${approved.data.id}/decision`,{status:'aprovada',decision:'Aprovado'},{cookie:admin.cookie});
  const refused=await create(second.id,'urgente',author.cookie);await post(base,`/api/requests/${refused.data.id}/decision`,{status:'recusada',decision:'Recusado'},{cookie:admin.cookie});
  await create(second.id,'normal',admin.cookie);
  const report=async(query='',cookie=admin.cookie)=>{const r=await fetch(base+'/api/requests/summary.csv?'+query,{headers:{cookie}});return {status:r.status,headers:r.headers,text:await r.text()};};
  const parse=text=>text.trim().split('\r\n').slice(1).map(line=>line.split(';').map(cell=>cell.replace(/^"|"$/g,'')));
  const all=await report();assert.equal(all.status,200);assert.match(all.headers.get('content-disposition'),/cosmos-resumo-setores.csv/);assert.equal(all.headers.get('cache-control'),'no-store');
  assert.deepEqual(parse(all.text),[[first.name,'2','1','1','0','1','1'],[second.name,'2','1','0','1','0','0']]);
  assert.deepEqual(parse((await report('',author.cookie)).text),[[first.name,'2','1','1','0','1','1'],[second.name,'1','0','0','1','0','0']]);
  assert.deepEqual(parse((await report('status=aprovada')).text),[[first.name,'1','0','1','0','0','0']]);
  assert.deepEqual(parse((await report('deadline=overdue&priority=urgente')).text),[[first.name,'1','1','0','0','1','1']]);
  assert.deepEqual(parse((await report('sector_id='+second.id+'&q=material')).text),[[second.name,'2','1','0','1','0','0']]);
  for(const query of ['q=inexistente','from=2099-01-01'])assert.deepEqual(parse((await report(query)).text),[]);
  assert.deepEqual(parse((await report('',other.cookie)).text),[]);
  assert.equal((await report('from=2026-02-29')).status,400);
  assert.equal((await report('assignment=mine',author.cookie)).status,403);
  assert.equal((await report('','')).status,401);
});

test('decisão rejeita conteúdo desatualizado sem gravar decisão, histórico ou notificação',async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const admin=await post(base,'/api/register',{name:'Revisor',organization:'Revisão',type:'privada',email:'review@example.com',password});
  const workspace=async cookie=>(await fetch(base+'/api/workspace',{headers:{cookie}})).json();
  const sector=(await workspace(admin.cookie)).sectors[0].id;
  await post(base,'/api/users',{name:'Autor',email:'review-author@example.com',password,role:'colaborador',sector_id:sector},{cookie:admin.cookie});
  const author=await post(base,'/api/login',{email:'review-author@example.com',password});
  const original={title:'Material original',description:'Justificativa original'};
  const created=await post(base,'/api/requests',{...original,sector_id:sector,priority:'normal'},{cookie:author.cookie});
  const id=created.data.id,path=`/api/requests/${id}/decision`;
  const edited={title:'Material corrigido',description:original.description};
  await post(base,`/api/requests/${id}/edit`,{...edited,expected:original},{cookie:author.cookie});
  const before=await workspace(admin.cookie);
  assert.equal((await post(base,path,{status:'aprovada',decision:'Parecer sobre versão antiga',expected:original},{cookie:admin.cookie})).status,409);
  assert.equal((await post(base,path,{status:'aprovada',decision:'Sem revisão',expected:null},{cookie:admin.cookie})).status,400);
  const missing=await fetch(base+path,{method:'POST',headers:{cookie:admin.cookie,'Content-Type':'application/json'},body:JSON.stringify({status:'aprovada',decision:'Sem versão'})});assert.equal(missing.status,400);
  let current=await workspace(admin.cookie);assert.deepEqual(current.history,before.history);assert.equal(current.requests.find(r=>r.id===id).status,'pendente');
  assert.equal((await workspace(author.cookie)).notification_unread,0);
  const final={title:edited.title,description:'Justificativa revisada com novas quantidades'};
  await post(base,`/api/requests/${id}/edit`,{...final,expected:edited},{cookie:author.cookie});
  const afterEdit=await workspace(admin.cookie);
  assert.equal((await post(base,path,{status:'recusada',decision:'Parecer desatualizado',expected:edited},{cookie:admin.cookie})).status,409);
  current=await workspace(admin.cookie);assert.deepEqual(current.history,afterEdit.history);assert.equal(current.requests.find(r=>r.id===id).status,'pendente');
  assert.equal((await workspace(author.cookie)).notification_unread,0);
  assert.equal((await post(base,path,{status:'aprovada',decision:'Conteúdo atual conferido',expected:final},{cookie:admin.cookie})).status,200);
  current=await workspace(admin.cookie);assert.equal(current.requests.find(r=>r.id===id).status,'aprovada');assert.equal((await workspace(author.cookie)).notification_unread,1);
});

test('organização: somente administrador edita a própria, com validação e histórico',async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const a=await post(base,'/api/register',{name:'Admin A',organization:'Original A',type:'privada',email:'org-a@example.com',password});
  const b=await post(base,'/api/register',{name:'Admin B',organization:'Original B',type:'publica',email:'org-b@example.com',password});
  const workspace=async cookie=>(await fetch(base+'/api/workspace',{headers:{cookie}})).json();
  const before=await workspace(a.cookie),otherBefore=await workspace(b.cookie),sector=before.sectors[0].id;
  await post(base,'/api/users',{name:'Colaborador',email:'org-user@example.com',password,role:'colaborador',sector_id:sector},{cookie:a.cookie});
  const author=await post(base,'/api/login',{email:'org-user@example.com',password});
  const request=await post(base,'/api/requests',{title:'Pedido preservado',description:'Teste de cadastro',priority:'normal',sector_id:sector},{cookie:author.cookie});
  const original=(await workspace(a.cookie)).requests.find(r=>r.id===request.data.id);
  const body={name:'Organização atualizada & equipe',type:'publica',org_id:otherBefore.organization.id};
  assert.equal((await post(base,'/api/organization',body)).status,401);
  assert.equal((await post(base,'/api/organization',body,{cookie:author.cookie})).status,403);
  for(const invalid of [{...body,name:' '},{...body,name:'x'.repeat(161)},{...body,type:'outra'}])assert.equal((await post(base,'/api/organization',invalid,{cookie:a.cookie})).status,400);
  assert.equal((await post(base,'/api/organization',body,{cookie:a.cookie})).status,200);
  let after=await workspace(a.cookie);assert.equal(after.organization.name,body.name);assert.equal(after.organization.type,body.type);assert.equal(after.organization.id,before.organization.id);
  assert.deepEqual(after.requests.find(r=>r.id===request.data.id),original);
  assert.deepEqual((await workspace(b.cookie)).organization,otherBefore.organization);
  assert.equal((await workspace(author.cookie)).organization.name,body.name);
  const changes=after.history.filter(h=>h.action.startsWith('Organização atualizada:'));assert.equal(changes.length,1);assert.match(changes[0].action,/Original A/);assert.match(changes[0].action,/privada → pública/);
  await post(base,'/api/organization',body,{cookie:a.cookie});after=await workspace(a.cookie);assert.equal(after.history.filter(h=>h.action.startsWith('Organização atualizada:')).length,1);
  const printed=await fetch(base+`/api/requests/${request.data.id}/print`,{headers:{cookie:author.cookie}});assert.equal(printed.status,200);assert.match(await printed.text(),/Organização atualizada &amp; equipe/);
});

test('nome da própria conta: edição isolada, concorrência e sessões preservadas',async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const admin=await post(base,'/api/register',{name:'Admin',organization:'Perfil',type:'privada',email:'profile-admin@example.com',password});
  const other=await post(base,'/api/register',{name:'Outro',organization:'Outra',type:'publica',email:'profile-other@example.com',password});
  const workspace=async cookie=>(await fetch(base+'/api/workspace',{headers:{cookie}})).json();
  const sector=(await workspace(admin.cookie)).sectors[0].id;
  await post(base,'/api/users',{name:'Nome original',email:'profile-user@example.com',password,role:'colaborador',sector_id:sector},{cookie:admin.cookie});
  const author=await post(base,'/api/login',{email:'profile-user@example.com',password});
  const second=await post(base,'/api/login',{email:'profile-user@example.com',password});
  const before=(await workspace(author.cookie)).user,otherBefore=(await workspace(other.cookie)).user;
  const created=await post(base,'/api/requests',{title:'Pedido de perfil',description:'Teste nome',priority:'normal',sector_id:sector},{cookie:author.cookie});
  const body={name:'Nome atualizado <teste>',expectedName:before.name,id:otherBefore.id,role:'admin',sector_id:999,email:'outro@example.com'};
  assert.equal((await post(base,'/api/account/profile',body)).status,401);
  for(const invalid of [{...body,name:' '},{...body,name:'x'.repeat(121)},{name:'Novo'}])assert.equal((await post(base,'/api/account/profile',invalid,{cookie:author.cookie})).status,400);
  assert.equal((await post(base,'/api/account/profile',body,{cookie:author.cookie})).status,200);
  const after=(await workspace(author.cookie)).user;assert.equal(after.name,body.name);
  for(const key of ['id','email','role','sector_id','active'])assert.equal(after[key],before[key]);
  assert.equal((await workspace(second.cookie)).user.name,body.name);
  assert.deepEqual((await workspace(other.cookie)).user,otherBefore);
  assert.equal((await workspace(admin.cookie)).requests.find(r=>r.id===created.data.id).author,body.name);
  assert.equal((await post(base,'/api/account/profile',{name:'Sobrescrita antiga',expectedName:before.name},{cookie:author.cookie})).status,409);
  assert.equal((await post(base,'/api/account/profile',{name:body.name,expectedName:body.name},{cookie:author.cookie})).status,200);
  let history=(await workspace(admin.cookie)).history;assert.equal(history.filter(h=>h.action.startsWith('Nome da própria conta atualizado:')).length,1);
  assert.equal((await post(base,'/api/account/profile',{name:'Admin atualizado',expectedName:'Admin'},{cookie:admin.cookie})).status,200);
  assert.equal((await workspace(admin.cookie)).user.name,'Admin atualizado');
  assert.equal((await post(base,'/api/login',{email:before.email,password})).status,200);
});

test('CSV de pessoas respeita filtros, isolamento e proteção de células',async t=>{
  const {app,base}=await start();t.after(()=>stop(app));
  const a=await post(base,'/api/register',{name:'Admin',organization:'Equipe',type:'privada',email:'people-export@example.com',password});
  const b=await post(base,'/api/register',{name:'Externo',organization:'Outra',type:'privada',email:'people-external@example.com',password});
  const workspace=async cookie=>(await fetch(base+'/api/workspace',{headers:{cookie}})).json();
  const first=(await workspace(a.cookie)).sectors[0];
  const create=async(name,email)=>post(base,'/api/users',{name,email,password,role:'colaborador',sector_id:first.id},{cookie:a.cookie});
  await create('João de teste','people-joao@example.com');await create('Maria de teste','people-maria@example.com');await create('=Pessoa; "teste"','people-formula@example.com');
  const users=(await workspace(a.cookie)).users,maria=users.find(u=>u.email==='people-maria@example.com');
  await post(base,`/api/users/${maria.id}`,{name:maria.name,sector_id:first.id,role:'colaborador',active:false},{cookie:a.cookie});
  const author=await post(base,'/api/login',{email:'people-joao@example.com',password});
  const csv=async(query='',cookie=a.cookie)=>{const r=await fetch(base+'/api/users/export.csv?'+query,{headers:{cookie}});return {status:r.status,headers:r.headers,bytes:new Uint8Array(await r.arrayBuffer())};};
  const decode=r=>new TextDecoder().decode(r.bytes);
  const all=await csv();assert.equal(all.status,200);assert.deepEqual([...all.bytes.slice(0,3)],[239,187,191]);assert.equal(all.headers.get('cache-control'),'no-store');assert.match(all.headers.get('content-disposition'),/cosmos-pessoas.csv/);
  assert.match(decode(all),/"Nome";"E-mail";"Setor";"Perfil";"Acesso"/);assert.match(decode(all),/João de teste/);assert.match(decode(all),/Maria de teste/);assert.match(decode(all),/"'=Pessoa; ""teste"""/);assert.doesNotMatch(decode(all),/people-external|password|sessions|salt|org_id/);
  const found=decode(await csv('q=joao%20'+encodeURIComponent(first.name)+'&role=colaborador&access=active&sector_id='+first.id));assert.match(found,/João de teste/);assert.doesNotMatch(found,/Maria|people-export@example/);
  const inactive=decode(await csv('access=inactive'));assert.match(inactive,/Maria de teste/);assert.doesNotMatch(inactive,/João|people-export@example/);
  const empty=decode(await csv('q=naoexiste'));assert.equal(empty.trim().split('\r\n').length,1);
  assert.equal((await csv('',author.cookie)).status,403);assert.equal((await csv('','')).status,401);
  const foreign=(await workspace(b.cookie)).sectors[0].id;
  for(const query of ['role=owner','access=all','sector_id='+foreign,'sector_id=-1','q='+('x'.repeat(201))])assert.equal((await csv(query)).status,400);
  const other=decode(await csv('',b.cookie));assert.match(other,/people-external/);assert.doesNotMatch(other,/people-joao|people-maria/);
});
