import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

test('autenticação, isolamento, permissões, decisões e persistência', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-')); const databasePath = join(dir, 'test.sqlite');
  let app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  let base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  async function call(path, body, cookie = '', extra = {}) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Teste-seguro-2026!';
  assert.equal((await call('/api/workspace')).status, 401);
  assert.equal((await call('/api/register', { name: 'Ana', organization: 'A', type: 'privada', email: 'a@exemplo.com', password: 'curta' })).status, 400);
  const a = await call('/api/register', { name: 'Ana', organization: 'Empresa A', type: 'privada', email: 'a@exemplo.com', password });
  assert.equal(a.status, 201);
  assert.equal((await call('/api/register', { name: 'Ana', organization: 'Duplicada', type: 'privada', email: 'a@exemplo.com', password })).status, 409);
  const b = await call('/api/register', { name: 'Bia', organization: 'Órgão B', type: 'publica', email: 'b@exemplo.com', password });
  assert.equal(b.status, 201);
  let workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  const sector = workspace.sectors[0].id;
  const otherSector = (await call('/api/workspace', undefined, b.cookie)).data.sectors[0].id;
  assert.equal(workspace.organization.name, 'Empresa A');
  assert.equal(JSON.stringify(workspace).includes('password'), false);
  assert.equal((await call('/api/sectors', { name: 'Tecnologia' }, a.cookie)).status, 201);
  assert.equal((await call('/api/sectors', { name: 'Tecnologia' }, a.cookie)).status, 409);
  assert.equal((await call('/api/users', { name: 'Carlos', email: 'c@exemplo.com', password, role: 'colaborador', sector_id: otherSector }, a.cookie)).status, 400);
  assert.equal((await call('/api/users', { name: 'Carlos', email: 'c@exemplo.com', password, role: 'colaborador', sector_id: sector }, a.cookie)).status, 201);
  assert.equal((await call('/api/login', { email: 'c@exemplo.com', password: 'incorreta' })).status, 401);
  const c = await call('/api/login', { email: 'c@exemplo.com', password }); assert.equal(c.status, 200);
  assert.equal((await call('/api/sectors', { name: 'Invasão' }, c.cookie)).status, 403);
  assert.equal((await call('/api/users', { name: 'Invasor' }, c.cookie)).status, 403);
  assert.equal((await call('/api/requests', { title: 'Pedido', description: 'Teste', priority: 'normal', sector_id: otherSector }, c.cookie)).status, 400);
  const request = await call('/api/requests', { title: '<script>exemplo</script>', description: 'Computador para a equipe', priority: 'alta', sector_id: sector }, c.cookie);
  assert.equal(request.status, 201);
  const id = request.data.id;
  assert.equal((await call(`/api/requests/${id}/decision`, { status: 'aprovada', decision: 'ok' }, c.cookie)).status, 403);
  assert.equal((await call(`/api/requests/${id}/decision`, { status: 'aprovada', decision: 'ok' }, b.cookie)).status, 404);
  assert.equal((await call('/api/workspace', undefined, b.cookie)).data.requests.length, 0);
  assert.equal((await call(`/api/requests/${id}/decision`, { status: 'aprovada', decision: '' }, a.cookie)).status, 400);
  assert.equal((await call(`/api/requests/${id}/decision`, { status: 'aprovada', decision: 'Aquisição autorizada.' }, a.cookie)).status, 200);
  assert.equal((await call(`/api/requests/${id}/decision`, { status: 'recusada', decision: 'Alterar' }, a.cookie)).status, 409);
  const own = await call('/api/requests', { title: 'Meu pedido', description: 'Papel', priority: 'normal', sector_id: sector }, a.cookie);
  assert.equal((await call(`/api/requests/${own.data.id}/decision`, { status: 'aprovada', decision: 'Autorizo' }, a.cookie)).status, 403);
  const rejected = await call('/api/requests', { title: 'Outro pedido', description: 'Sem justificativa', priority: 'normal', sector_id: sector }, c.cookie);
  assert.equal((await call(`/api/requests/${rejected.data.id}/decision`, { status: 'recusada', decision: 'Falta justificativa.' }, a.cookie)).status, 200);
  const visible = (await call('/api/workspace', undefined, c.cookie)).data;
  assert.equal(visible.requests.length, 2); assert.equal(visible.users.length, 0); assert.equal(visible.history.length, 0);
  assert.equal(visible.requests.find(r => r.id === id).decision, 'Aquisição autorizada.');
  assert.equal((await call('/api/sectors', { name: 'CSRF' }, a.cookie, { origin: 'https://outro.exemplo' })).status, 403);
  const huge = await call('/api/requests', { title: 'x'.repeat(25000) }, a.cookie); assert.equal(huge.status, 413);
  await new Promise(resolve => app.close(resolve));
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(workspace.requests.length, 3); assert.ok(workspace.history.some(h => h.action.includes('Aquisição autorizada.')));
  const page = await fetch(base); assert.equal(page.status, 200); assert.ok((await page.text()).includes('COSMOS'));
  assert.ok(page.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await call('/api/logout', {}, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, a.cookie)).status, 401);
});

test('cookies seguros e limite de tentativas', async t => {
  const app = createApp({ databasePath: ':memory:', secure: true }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const registered = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Admin', organization: 'Teste', type: 'privada', email: 'test@exemplo.com', password: 'senha-comprida-123' }) });
  assert.equal(registered.status, 201); assert.match(registered.headers.get('set-cookie'), /HttpOnly; SameSite=Strict;.*Secure/); await registered.json();
  let response;
  for (let i = 0; i < 20; i++) { response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await response.json(); }
  assert.equal(response.status, 429);
});

test('troca de senha exige senha atual e encerra somente as sessões da própria conta', async t => {
  const app = createApp({ databasePath: ':memory:' }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const oldPassword = 'Senha-original-2026'; const newPassword = 'Nova-senha-segura-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'admin@exemplo.com', password: oldPassword });
  const sector = (await call('/api/workspace', undefined, a.cookie)).data.sectors[0].id;
  await call('/api/users', { name: 'Colaborador', email: 'colab@exemplo.com', password: oldPassword, role: 'colaborador', sector_id: sector }, a.cookie);
  const c = await call('/api/login', { email: 'colab@exemplo.com', password: oldPassword });
  const c2 = await call('/api/login', { email: 'colab@exemplo.com', password: oldPassword });
  assert.equal((await call('/api/account/password', { currentPassword: oldPassword, newPassword })).status, 401);
  assert.equal((await call('/api/account/password', { currentPassword: 'errada', newPassword }, c.cookie)).status, 400);
  assert.equal((await call('/api/account/password', { currentPassword: oldPassword, newPassword: 'curta' }, c.cookie)).status, 400);
  assert.equal((await call('/api/account/password', { currentPassword: oldPassword, newPassword: oldPassword }, c.cookie)).status, 400);
  assert.equal((await call('/api/workspace', undefined, c2.cookie)).status, 200);
  // Um user_id enviado no corpo não permite trocar a senha de outro usuário.
  const changed = await call('/api/account/password', { currentPassword: oldPassword, newPassword, user_id: a.data.id }, c.cookie);
  assert.equal(changed.status, 200); assert.equal(changed.cookie, 'cosmos=');
  assert.equal((await call('/api/workspace', undefined, c.cookie)).status, 401);
  assert.equal((await call('/api/workspace', undefined, c2.cookie)).status, 401);
  assert.equal((await call('/api/login', { email: 'colab@exemplo.com', password: oldPassword })).status, 401);
  assert.equal((await call('/api/login', { email: 'colab@exemplo.com', password: newPassword })).status, 200);
  assert.equal((await call('/api/workspace', undefined, a.cookie)).status, 200);
  assert.equal((await call('/api/login', { email: 'admin@exemplo.com', password: oldPassword })).status, 200);
  const history = (await call('/api/workspace', undefined, a.cookie)).data.history;
  assert.ok(history.some(h => h.action.includes('Senha da própria conta alterada')));
  assert.equal(JSON.stringify(history).includes(newPassword), false);
});
