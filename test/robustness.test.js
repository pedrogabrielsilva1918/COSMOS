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
