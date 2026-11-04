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

test('gestão de pessoas isola organizações, revoga acessos e preserva administrador e histórico', async t => {
  const app = createApp({ databasePath: ':memory:' }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outra', organization: 'Órgão', type: 'publica', email: 'b@empresa.com', password });
  const workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  const sector = workspace.sectors[0].id;
  const otherSector = (await call('/api/workspace', undefined, b.cookie)).data.sectors[0].id;
  await call('/api/users', { name: 'Carlos', email: 'c@empresa.com', password, role: 'colaborador', sector_id: sector }, a.cookie);
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  const c2 = await call('/api/login', { email: 'c@empresa.com', password });
  const edit = { name: 'Carlos Atualizado', sector_id: sector, role: 'colaborador', active: true };
  assert.equal((await call(`/api/users/${c.data.id}`, edit)).status, 401);
  assert.equal((await call(`/api/users/${c.data.id}`, edit, c.cookie)).status, 403);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...edit, sector_id: otherSector }, b.cookie)).status, 404);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...edit, sector_id: otherSector }, a.cookie)).status, 400);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...edit, active: 'false' }, a.cookie)).status, 400);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...edit, role: 'superadmin' }, a.cookie)).status, 400);
  assert.equal((await call(`/api/users/${a.data.id}`, { ...edit, role: 'admin', active: false }, a.cookie)).status, 409);
  assert.equal((await call(`/api/users/${a.data.id}`, edit, a.cookie)).status, 409);
  assert.equal((await call(`/api/users/${c.data.id}`, edit, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, c.cookie)).data.user.name, edit.name);
  const request = await call('/api/requests', { title: 'Pedido preservado', description: 'Descrição', priority: 'normal', sector_id: sector }, c.cookie);
  assert.equal(request.status, 201);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...edit, active: false }, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, c.cookie)).status, 401);
  assert.equal((await call('/api/workspace', undefined, c2.cookie)).status, 401);
  assert.equal((await call('/api/login', { email: 'c@empresa.com', password })).status, 401);
  let updated = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(updated.requests.find(r => r.id === request.data.id).title, 'Pedido preservado');
  assert.equal(updated.users.find(u => u.id === c.data.id).active, 0);
  assert.ok(updated.history.some(h => h.action.includes('acesso desativado')));
  assert.equal((await call(`/api/users/${c.data.id}`, edit, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, c.cookie)).status, 401);
  const reactivated = await call('/api/login', { email: 'c@empresa.com', password }); assert.equal(reactivated.status, 200);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...edit, role: 'admin' }, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, reactivated.cookie)).status, 401);
  const promoted = await call('/api/login', { email: 'c@empresa.com', password });
  assert.equal((await call('/api/workspace', undefined, promoted.cookie)).data.user.role, 'admin');
  assert.equal((await call(`/api/users/${a.data.id}`, { ...edit, role: 'admin', active: false }, a.cookie)).status, 409);
  assert.equal((await call(`/api/users/${a.data.id}`, { name: 'Admin', sector_id: sector, role: 'colaborador', active: true }, promoted.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, a.cookie)).status, 401);
  assert.equal((await call('/api/workspace', undefined, b.cookie)).data.organization.name, 'Órgão');
});

test('migração adiciona acesso ativo a banco antigo sem perder cadastros nem sessões', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-migration-')); const databasePath = join(dir, 'old.sqlite');
  let app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const registered = await fetch(`http://127.0.0.1:${app.address().port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Existente', organization: 'Legado', type: 'privada', email: 'legado@empresa.com', password: 'Senha-antiga-2026' }) });
  assert.equal(registered.status, 201); const cookie = registered.headers.get('set-cookie').split(';')[0]; await registered.json();
  await new Promise(resolve => app.close(resolve));
  // Simula exatamente a tabela de usuários da versão anterior.
  const legacy = new DatabaseSync(databasePath); legacy.exec('ALTER TABLE users DROP COLUMN active'); legacy.close();
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  let response = await fetch(`http://127.0.0.1:${app.address().port}/api/workspace`, { headers: { cookie } });
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.organization.name, 'Legado'); assert.equal(data.user.active, 1); assert.equal(data.user.name, 'Existente');
  // Uma segunda inicialização não repete a migração.
  await new Promise(resolve => app.close(resolve)); app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  response = await fetch(`http://127.0.0.1:${app.address().port}/api/workspace`, { headers: { cookie } }); assert.equal(response.status, 200); await response.json();
});

test('comentários respeitam visibilidade, limites, paginação e persistência', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-comments-')); const databasePath = join(dir, 'comments.sqlite');
  let app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  let base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro admin', organization: 'Outra', type: 'publica', email: 'b@empresa.com', password });
  const sector = (await call('/api/workspace', undefined, a.cookie)).data.sectors[0].id;
  for (const [name, email] of [['Carlos', 'c@empresa.com'], ['Dani', 'd@empresa.com']]) {
    assert.equal((await call('/api/users', { name, email, password, role: 'colaborador', sector_id: sector }, a.cookie)).status, 201);
  }
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  const d = await call('/api/login', { email: 'd@empresa.com', password });
  const request = await call('/api/requests', { title: 'Pedido', description: 'Justificativa', priority: 'normal', sector_id: sector }, c.cookie);
  const path = `/api/requests/${request.data.id}/comments`;
  assert.equal((await call(path)).status, 401);
  assert.deepEqual((await call(path, undefined, c.cookie)).data, { comments: [], nextBefore: null });
  for (const cookie of [b.cookie, d.cookie]) {
    assert.equal((await call(path, undefined, cookie)).status, 404);
    assert.equal((await call(path, { content: 'Tentativa' }, cookie)).status, 404);
  }
  assert.equal((await call('/api/requests/999999/comments', undefined, a.cookie)).status, 404);
  assert.equal((await call(path, { content: '   ' }, c.cookie)).status, 400);
  assert.equal((await call(path, { content: 'x'.repeat(2001) }, c.cookie)).status, 400);
  assert.equal((await call(path + '?before=invalido', undefined, a.cookie)).status, 400);
  assert.equal((await call(path + '?before=0', undefined, a.cookie)).status, 400);
  const original = '<script>texto literal</script>\nSegunda linha';
  assert.equal((await call(path, { content: original }, c.cookie)).status, 201);
  assert.equal((await call(path, { content: 'Recebido pela administração.' }, a.cookie)).status, 201);
  for (let i = 0; i < 50; i++) assert.equal((await call(path, { content: `Mensagem ${i}` }, c.cookie)).status, 201);
  const latest = (await call(path, undefined, a.cookie)).data;
  assert.equal(latest.comments.length, 50); assert.ok(latest.nextBefore);
  assert.equal(latest.comments[0].content, 'Mensagem 0'); assert.equal(latest.comments[49].content, 'Mensagem 49');
  const previous = (await call(path + `?before=${latest.nextBefore}`, undefined, c.cookie)).data;
  assert.equal(previous.comments.length, 2); assert.equal(previous.nextBefore, null);
  assert.equal(previous.comments[0].content, original); assert.equal(previous.comments[0].author, 'Carlos');
  assert.ok(previous.comments[0].created_at); assert.equal(previous.comments[1].author, 'Admin');
  assert.equal(new Set([...previous.comments, ...latest.comments].map(comment => comment.id)).size, 52);
  assert.equal((await call(`/api/requests/${request.data.id}/decision`, { status: 'aprovada', decision: 'Autorizado' }, a.cookie)).status, 200);
  assert.equal((await call(path, { content: 'Obrigado após a aprovação.' }, c.cookie)).status, 201);
  await new Promise(resolve => app.close(resolve));
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await call(path, undefined, c.cookie)).data.comments.at(-1).content, 'Obrigado após a aprovação.');
  assert.equal((await call(`/api/users/${c.data.id}`, { name: 'Carlos', role: 'colaborador', active: false, sector_id: sector }, a.cookie)).status, 200);
  assert.equal((await call(path, undefined, c.cookie)).status, 401);
  assert.equal((await call(path, { content: 'Bloqueado' }, c.cookie)).status, 401);
  assert.equal((await call(path, undefined, a.cookie)).data.comments.length, 50);
  const workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.ok(workspace.history.some(event => event.action.includes('Comentário adicionado')));
  assert.equal(JSON.stringify(workspace).includes(original), false);
});

test('CSV respeita filtros e acessos, preserva caracteres e neutraliza fórmulas', async t => {
  const app = createApp({ databasePath: ':memory:' }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function exportCSV(query, cookie) {
    const response = await fetch(base + '/api/requests/export.csv' + query, { headers: { cookie } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    // Todos os campos do contrato CSV são entre aspas; inclui quebras dentro de campos.
    const cells = [...text.matchAll(/"((?:[^"]|"")*)"(?:;|\r\n|$)/g)].map(match => match[1].replace(/""/g, '"'));
    const rows = []; for (let i = 0; i < cells.length; i += 11) rows.push(cells.slice(i, i + 11));
    return { response, bytes, text, rows };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro', organization: 'Outra', type: 'publica', email: 'b@empresa.com', password });
  const sector = (await call('/api/workspace', undefined, a.cookie)).data.sectors[0].id;
  const otherSector = (await call('/api/workspace', undefined, b.cookie)).data.sectors[0].id;
  for (const [name, email] of [['@Carlos', 'c@empresa.com'], ['Dani', 'd@empresa.com']]) await call('/api/users', { name, email, password, role: 'colaborador', sector_id: sector }, a.cookie);
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  const d = await call('/api/login', { email: 'd@empresa.com', password });
  const request = await call('/api/requests', { title: 'Água; "cotação"', description: '=1+1\nTexto; "entre aspas"', priority: 'alta', sector_id: sector }, c.cookie);
  const id = request.data.id;
  await call(`/api/requests/${id}/comments`, { content: 'SEGREDO-COMENTARIO' }, c.cookie);
  await call(`/api/requests/${id}/decision`, { status: 'aprovada', decision: '-teste; "parecer"' }, a.cookie);
  await call('/api/requests', { title: 'Pedido pendente', description: 'Da Dani', priority: 'normal', sector_id: sector }, d.cookie);
  await call('/api/requests', { title: '=1+1', description: 'Pedido do admin', priority: 'normal', sector_id: sector }, a.cookie);
  await call('/api/requests', { title: 'PEDIDO-OUTRA-ORGANIZACAO', description: 'Não exportar para A', priority: 'normal', sector_id: otherSector }, b.cookie);
  assert.equal((await call('/api/requests/export.csv')).status, 401);
  assert.equal((await call('/api/requests/export.csv?status=invalida', undefined, a.cookie)).status, 400);
  assert.equal((await call('/api/requests/export.csv?q=' + 'x'.repeat(201), undefined, a.cookie)).status, 400);
  const all = await exportCSV('', a.cookie);
  assert.equal(all.response.status, 200); assert.deepEqual([...all.bytes.slice(0, 3)], [239, 187, 191]);
  assert.equal(all.response.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(all.response.headers.get('content-disposition'), /attachment; filename="cosmos-solicitacoes.csv"/);
  assert.equal(all.response.headers.get('cache-control'), 'no-store');
  assert.equal(all.rows.length, 4); assert.equal(all.rows[0][0], 'Protocolo');
  assert.equal(all.rows[1][1], "'=1+1");
  assert.equal(all.text.includes('PEDIDO-OUTRA-ORGANIZACAO'), false);
  assert.equal(all.text.includes('SEGREDO-COMENTARIO'), false);
  assert.equal(all.text.includes('c@empresa.com'), false);
  const own = await exportCSV('', c.cookie); assert.equal(own.rows.length, 2);
  const row = own.rows[1];
  assert.equal(row[0], `COS-${String(id).padStart(5, '0')}`); assert.equal(row[1], 'Água; "cotação"');
  assert.equal(row[2], "'@Carlos"); assert.equal(row[4], 'Aprovada'); assert.equal(row[5], 'Alta');
  assert.equal(row[6], "'=1+1\nTexto; \"entre aspas\""); assert.ok(row[7].endsWith('Z')); assert.ok(row[8].endsWith('Z'));
  assert.equal(row[9], 'Admin'); assert.equal(row[10], "'-teste; \"parecer\"");
  const filtered = await exportCSV('?status=aprovada&q=' + encodeURIComponent('ÁGUA'), a.cookie);
  assert.deepEqual(filtered.rows, own.rows);
  const protocol = await exportCSV('?q=COS-' + String(id).padStart(5, '0'), a.cookie); assert.deepEqual(protocol.rows, own.rows);
  assert.equal((await exportCSV('?status=pendente', c.cookie)).rows.length, 1);
  assert.equal((await exportCSV('?q=inexistente', a.cookie)).rows.length, 1);
  assert.equal((await exportCSV('', b.cookie)).rows.length, 2);
  await call(`/api/users/${c.data.id}`, { name: '@Carlos', role: 'colaborador', active: false, sector_id: sector }, a.cookie);
  assert.equal((await call('/api/requests/export.csv', undefined, c.cookie)).status, 401);
});
