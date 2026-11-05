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
  const { app, base } = await start({ trustProxy: true }); t.after(() => stop(app));
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
