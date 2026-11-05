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
  const legacy = new DatabaseSync(databasePath); legacy.exec('ALTER TABLE users DROP COLUMN active; ALTER TABLE sectors DROP COLUMN active; ALTER TABLE requests DROP COLUMN due_date; ALTER TABLE requests DROP COLUMN assigned_to'); legacy.close();
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  let response = await fetch(`http://127.0.0.1:${app.address().port}/api/workspace`, { headers: { cookie } });
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.organization.name, 'Legado'); assert.equal(data.sectors[0].active, 1); assert.equal(data.user.active, 1); assert.equal(data.user.name, 'Existente');
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
    const rows = []; for (let i = 0; i < cells.length; i += 13) rows.push(cells.slice(i, i + 13));
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

test('setores: edição isolada, dependências, desativação e reativação sem apagar vínculos', async t => {
  const app = createApp({ databasePath: ':memory:' }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro', organization: 'Outra', type: 'publica', email: 'b@empresa.com', password });
  assert.equal((await call('/api/sectors', { name: 'Compras' }, a.cookie)).status, 201);
  let workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  const adminSector = workspace.sectors.find(s => s.name === 'Administração').id;
  const sector = workspace.sectors.find(s => s.name === 'Compras').id;
  assert.equal((await call('/api/users', { name: 'Carlos', email: 'c@empresa.com', password, role: 'colaborador', sector_id: sector }, a.cookie)).status, 201);
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  const path = `/api/sectors/${sector}`;
  assert.equal((await call(path, { name: 'Suprimentos', active: true })).status, 401);
  assert.equal((await call(path, { name: 'Suprimentos', active: true }, c.cookie)).status, 403);
  assert.equal((await call(path, { name: 'Suprimentos', active: true }, b.cookie)).status, 404);
  assert.equal((await call(path, { name: ' ', active: true }, a.cookie)).status, 400);
  assert.equal((await call(path, { name: 'Suprimentos', active: 'false' }, a.cookie)).status, 400);
  assert.equal((await call(path, { name: 'Administração', active: true }, a.cookie)).status, 409);
  assert.equal((await call(path, { name: 'Suprimentos', active: true }, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, a.cookie)).data.users.find(u => u.id === c.data.id).sector, 'Suprimentos');
  const request = await call('/api/requests', { title: 'Papel', description: 'Para a equipe', priority: 'normal', sector_id: sector }, c.cookie);
  assert.equal((await call(path, { name: 'Não deve salvar', active: false }, a.cookie)).status, 409);
  const person = { name: 'Carlos', sector_id: sector, role: 'colaborador', active: false };
  assert.equal((await call(`/api/users/${c.data.id}`, person, a.cookie)).status, 200);
  // Mesmo sem pessoas ativas, pedidos pendentes impedem desativação.
  const blocked = await call(path, { name: 'Não deve salvar', active: false }, a.cookie);
  assert.equal(blocked.status, 409); assert.match(blocked.data.error, /solicitações pendentes/);
  assert.equal((await call(`/api/requests/${request.data.id}/decision`, { status: 'aprovada', decision: 'Autorizado' }, a.cookie)).status, 200);
  assert.equal((await call(path, { name: 'Suprimentos antigo', active: false }, a.cookie)).status, 200);
  workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(workspace.sectors.find(s => s.id === sector).active, 0);
  assert.equal(workspace.requests.find(r => r.id === request.data.id).sector, 'Suprimentos antigo');
  assert.ok(workspace.history.some(h => h.action.includes('Setor #') && h.action.includes('desativado')));
  assert.equal((await call('/api/requests', { title: 'Bloqueado', description: 'Teste', priority: 'normal', sector_id: sector }, a.cookie)).status, 400);
  assert.equal((await call('/api/users', { name: 'Nova', email: 'nova@empresa.com', password, role: 'colaborador', sector_id: sector }, a.cookie)).status, 400);
  // A pessoa já desativada pode manter o vínculo para consulta, mas não voltar a atuar nesse setor.
  assert.equal((await call(`/api/users/${c.data.id}`, { ...person, name: 'Carlos Inativo' }, a.cookie)).status, 200);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...person, active: true }, a.cookie)).status, 400);
  assert.equal((await call(`/api/users/${c.data.id}`, { ...person, sector_id: adminSector, active: true }, a.cookie)).status, 200);
  const returned = await call('/api/login', { email: 'c@empresa.com', password }); assert.equal(returned.status, 200);
  assert.equal((await call(path, { name: 'Suprimentos', active: true }, a.cookie)).status, 200);
  assert.equal((await call('/api/requests', { title: 'Novo pedido', description: 'Teste após reativação', priority: 'normal', sector_id: sector }, returned.cookie)).status, 201);
  assert.equal((await call('/api/workspace', undefined, b.cookie)).data.sectors.length, 1);
});

test('inicialização respeita host e porta explícitos usados por prévias', { timeout: 15000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-cli-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url)), '--host', '127.0.0.1', '--port', '0', '--strictPort'], {
    env: { ...process.env, PORT: 'invalid-environment-value', DATABASE_PATH: join(dir, 'cli.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = ''; child.stderr.on('data', data => { diagnostics += data; });
  t.after(async () => { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } rmSync(dir, { recursive: true, force: true }); });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = /COSMOS disponível na porta (\d+)/.exec(output); if (match) resolve(Number(match[1])); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`Servidor encerrou (${code}): ${diagnostics}`)));
  });
  assert.ok(port > 0);
  const page = await fetch(`http://127.0.0.1:${port}/`); assert.equal(page.status, 200); assert.ok((await page.text()).includes('COSMOS'));
});

test('prazo usa a virada do dia em Brasília e somente pedidos pendentes vencem', async () => {
  const { brazilDay, isRequestOverdue } = await import('../server.js');
  const beforeMidnight = brazilDay(new Date('2026-11-05T02:59:59.000Z'));
  const afterMidnight = brazilDay(new Date('2026-11-05T03:00:00.000Z'));
  assert.equal(beforeMidnight, '2026-11-04'); assert.equal(afterMidnight, '2026-11-05');
  const request = { status: 'pendente', due_date: '2026-11-04' };
  assert.equal(isRequestOverdue(request, beforeMidnight), false);
  assert.equal(isRequestOverdue(request, afterMidnight), true);
  assert.equal(isRequestOverdue({ ...request, status: 'aprovada' }, afterMidnight), false);
  assert.equal(isRequestOverdue({ ...request, status: 'recusada' }, afterMidnight), false);
  assert.equal(isRequestOverdue({ status: 'pendente', due_date: null }, afterMidnight), false);
});

test('prazos: migração, permissões, datas válidas, filtro CSV e persistência', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const { brazilDay } = await import('../server.js');
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-deadlines-')); const databasePath = join(dir, 'deadlines.sqlite');
  let app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  let base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro', organization: 'Outra', type: 'publica', email: 'b@empresa.com', password });
  const sector = (await call('/api/workspace', undefined, a.cookie)).data.sectors[0].id;
  await call('/api/users', { name: 'Carlos', email: 'c@empresa.com', password, role: 'colaborador', sector_id: sector }, a.cookie);
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  const ids = [];
  for (const title of ['Pedido vencido', 'Pedido para hoje', 'Pedido sem prazo']) {
    const response = await call('/api/requests', { title, description: 'Teste de prazos', priority: 'normal', sector_id: sector }, c.cookie);
    assert.equal(response.status, 201); ids.push(response.data.id);
  }
  // Banco de uma versão anterior, já com pedidos e contas.
  await new Promise(resolve => app.close(resolve));
  const old = new DatabaseSync(databasePath); old.exec('ALTER TABLE requests DROP COLUMN due_date; ALTER TABLE requests DROP COLUMN assigned_to'); old.close();
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  let workspace = (await call('/api/workspace', undefined, c.cookie)).data;
  assert.equal(workspace.requests.length, 3); assert.ok(workspace.requests.every(r => r.due_date === null && r.is_overdue === false));
  const path = `/api/requests/${ids[0]}/deadline`;
  assert.equal((await call(path, { due_date: '2028-02-29' })).status, 401);
  assert.equal((await call(path, { due_date: '2028-02-29' }, c.cookie)).status, 403);
  assert.equal((await call(path, { due_date: '2028-02-29' }, b.cookie)).status, 404);
  assert.equal((await call('/api/requests/999999/deadline', { due_date: '2028-02-29' }, a.cookie)).status, 404);
  for (const due_date of [undefined, '', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-1-01', '2026-11-04T00:00:00Z', '0000-01-01', 55]) {
    assert.equal((await call(path, { due_date }, a.cookie)).status, 400);
  }
  assert.equal((await call(path, { due_date: '2028-02-29' }, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, c.cookie)).data.requests.find(r => r.id === ids[0]).due_date, '2028-02-29');
  assert.equal((await call(path, { due_date: null }, a.cookie)).status, 200);
  const today = brazilDay();
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  assert.equal((await call(path, { due_date: yesterday }, a.cookie)).status, 200);
  assert.equal((await call(`/api/requests/${ids[1]}/deadline`, { due_date: today }, a.cookie)).status, 200);
  workspace = (await call('/api/workspace', undefined, c.cookie)).data;
  assert.equal(workspace.requests.find(r => r.id === ids[0]).is_overdue, true);
  assert.equal(workspace.requests.find(r => r.id === ids[1]).is_overdue, false);
  assert.equal(workspace.requests.find(r => r.id === ids[2]).is_overdue, false);
  const csvResponse = await fetch(base + '/api/requests/export.csv?deadline=overdue', { headers: { cookie: c.cookie } });
  assert.equal(csvResponse.status, 200); const csv = await csvResponse.text();
  assert.ok(csv.includes('Prazo (AAAA-MM-DD)')); assert.ok(csv.includes(yesterday)); assert.ok(csv.includes('Pedido vencido'));
  assert.equal(csv.includes('Pedido para hoje'), false); assert.equal(csv.includes('Pedido sem prazo'), false);
  const otherCSV = await fetch(base + '/api/requests/export.csv?deadline=overdue', { headers: { cookie: b.cookie } });
  assert.equal((await otherCSV.text()).includes('Pedido vencido'), false);
  assert.equal((await call('/api/requests/export.csv?deadline=invalido', undefined, a.cookie)).status, 400);
  assert.equal((await call(`/api/requests/${ids[0]}/decision`, { status: 'aprovada', decision: 'Autorizado' }, a.cookie)).status, 200);
  assert.equal((await call(path, { due_date: null }, a.cookie)).status, 409);
  workspace = (await call('/api/workspace', undefined, c.cookie)).data;
  assert.equal(workspace.requests.find(r => r.id === ids[0]).due_date, yesterday);
  assert.equal(workspace.requests.find(r => r.id === ids[0]).is_overdue, false);
  await new Promise(resolve => app.close(resolve));
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(workspace.requests.find(r => r.id === ids[1]).due_date, today);
  assert.ok(workspace.history.some(h => h.action.includes(`Prazo da solicitação #${ids[0]}`) && h.action.includes(yesterday)));
});

test('três setores sugeridos: administrador, organização conectada e repetição sem duplicar', async t => {
  const app = createApp({ databasePath: ':memory:' }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa A', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro', organization: 'Empresa B', type: 'publica', email: 'b@empresa.com', password });
  const wa = (await call('/api/workspace', undefined, a.cookie)).data;
  const wb = (await call('/api/workspace', undefined, b.cookie)).data;
  await call('/api/users', { name: 'Colaborador', email: 'c@empresa.com', password, role: 'colaborador', sector_id: wa.sectors[0].id }, a.cookie);
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  assert.equal((await call('/api/sectors/suggested', {})).status, 401);
  assert.equal((await call('/api/sectors/suggested', {}, c.cookie)).status, 403);
  const created = await call('/api/sectors/suggested', { org_id: wb.organization.id }, a.cookie);
  assert.equal(created.status, 201); assert.deepEqual(created.data.created.map(s => s.name), ['Jurídico', 'Compras e Licitações', 'Patrimônio e Almoxarifado']);
  assert.equal(created.data.existing.length, 0);
  let workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(workspace.sectors.length, 4); assert.equal(workspace.history.filter(h => h.action.startsWith('Setor criado:')).length, 3);
  assert.equal((await call('/api/workspace', undefined, b.cookie)).data.sectors.length, 1);
  const repeated = await call('/api/sectors/suggested', {}, a.cookie);
  assert.equal(repeated.status, 200); assert.equal(repeated.data.created.length, 0); assert.equal(repeated.data.existing.length, 3);
  workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(workspace.sectors.length, 4); assert.equal(workspace.history.filter(h => h.action.startsWith('Setor criado:')).length, 3);
  // Acentos, caixa, espaços e situação original não causam duplicação ou reativação.
  await call('/api/sectors', { name: 'JURIDICO' }, b.cookie);
  await call('/api/sectors', { name: 'Compras  e   Licitacoes' }, b.cookie);
  let other = (await call('/api/workspace', undefined, b.cookie)).data;
  const juridico = other.sectors.find(s => s.name === 'JURIDICO');
  await call(`/api/sectors/${juridico.id}`, { name: juridico.name, active: false }, b.cookie);
  const partial = await call('/api/sectors/suggested', {}, b.cookie);
  assert.equal(partial.status, 201); assert.equal(partial.data.created.length, 1); assert.equal(partial.data.existing.length, 2);
  assert.equal(partial.data.created[0].name, 'Patrimônio e Almoxarifado');
  other = (await call('/api/workspace', undefined, b.cookie)).data;
  assert.equal(other.sectors.length, 4); assert.equal(other.sectors.find(s => s.id === juridico.id).active, 0);
  assert.ok(other.sectors.some(s => s.name === 'Compras  e   Licitacoes'));
  assert.equal((await call('/api/workspace', undefined, a.cookie)).data.sectors.length, 4);
});

test('falha no lote de setores não deixa cadastros nem registros parciais', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-sector-batch-')); const databasePath = join(dir, 'batch.sqlite');
  const app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { await new Promise(resolve => app.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const registered = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Admin', organization: 'Teste', type: 'privada', email: 'batch@empresa.com', password: 'Senha-de-teste-2026' }) });
  const cookie = registered.headers.get('set-cookie').split(';')[0]; await registered.json();
  const inspection = new DatabaseSync(databasePath);
  inspection.exec("CREATE TRIGGER fail_batch BEFORE INSERT ON sectors WHEN NEW.name='Patrimônio e Almoxarifado' BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  const response = await fetch(base + '/api/sectors/suggested', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
  assert.equal(response.status, 500); await response.json();
  assert.equal(inspection.prepare('SELECT COUNT(*) AS total FROM sectors').get().total, 1);
  assert.equal(inspection.prepare("SELECT COUNT(*) AS total FROM audit WHERE action LIKE 'Setor criado:%'").get().total, 0);
  inspection.close();
});

test('descrições: migração dos setores, edição autorizada e preservação dos textos', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-descriptions-')); const databasePath = join(dir, 'descriptions.sqlite');
  let app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  let base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro', organization: 'Outra', type: 'publica', email: 'b@empresa.com', password });
  const names = ['Documentação','Financeiro','Gestão Financeira e Serviços - GFS','Marketing e Desenvolvimento de Soluções - MDS','Mobiliário','Recursos Humano','Suporte','Tecnologia','Jurídico','Compras e Licitações','Patrimônio e Almoxarifado'];
  for (const name of names) assert.equal((await call('/api/sectors', { name }, a.cookie)).status, 201);
  await call('/api/sectors', { name: 'Pesquisa' }, a.cookie);
  const firstWorkspace = (await call('/api/workspace', undefined, a.cookie)).data;
  const adminSector = firstWorkspace.sectors.find(s => s.name === 'Administração');
  await call('/api/users', { name: 'Carlos', email: 'c@empresa.com', password, role: 'colaborador', sector_id: adminSector.id }, a.cookie);
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  const request = await call('/api/requests', { title: 'Pedido preservado', description: 'Justificativa', priority: 'normal', sector_id: adminSector.id }, c.cookie);
  // Simula banco anterior a descrições, incluindo os 12 setores da organização.
  await new Promise(resolve => app.close(resolve));
  const legacy = new DatabaseSync(databasePath); legacy.exec('ALTER TABLE sectors DROP COLUMN description'); legacy.close();
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  let workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(workspace.sectors.length, 13); assert.equal(workspace.users.length, 2);
  assert.equal(workspace.requests.find(r => r.id === request.data.id).title, 'Pedido preservado');
  for (const name of ['Administração', ...names]) {
    const sector = workspace.sectors.find(s => s.name === name); assert.ok(sector.description.length > 30); assert.ok(sector.description.length <= 300); assert.equal(sector.active, 1);
  }
  assert.equal(workspace.sectors.find(s => s.name === 'Pesquisa').description, '');
  const doc = workspace.sectors.find(s => s.name === 'Documentação');
  const path = `/api/sectors/${doc.id}`;
  const edit = { name: doc.name, active: true, description: 'Descrição específica da organização.' };
  assert.equal((await call(path, edit)).status, 401);
  assert.equal((await call(path, edit, c.cookie)).status, 403);
  assert.equal((await call(path, edit, b.cookie)).status, 404);
  assert.equal((await call(path, { ...edit, description: 'x'.repeat(301) }, a.cookie)).status, 400);
  assert.equal((await call(path, { ...edit, description: null }, a.cookie)).status, 400);
  assert.equal((await call(path, edit, a.cookie)).status, 200);
  assert.equal((await call(path, { name: doc.name, active: true }, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, c.cookie)).data.sectors.find(s => s.id === doc.id).description, edit.description);
  assert.equal((await call('/api/sectors', { name: 'Novo setor', description: '<b>Texto literal</b>' }, a.cookie)).status, 201);
  assert.equal((await call('/api/sectors', { name: 'Inválido', description: 'x'.repeat(301) }, a.cookie)).status, 400);
  const juridico = workspace.sectors.find(s => s.name === 'Jurídico');
  assert.equal((await call(`/api/sectors/${juridico.id}`, { name: juridico.name, active: true, description: '' }, a.cookie)).status, 200);
  await new Promise(resolve => app.close(resolve));
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assert.equal(workspace.sectors.find(s => s.id === doc.id).description, edit.description);
  assert.equal(workspace.sectors.find(s => s.id === juridico.id).description, '');
  assert.equal(workspace.sectors.find(s => s.name === 'Novo setor').description, '<b>Texto literal</b>');
  assert.ok(workspace.history.some(h => h.action.includes('descrição atualizada')));
});

test('responsáveis: migração, isolamento, elegibilidade, transferência e decisões preservadas', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-assignees-')); const databasePath = join(dir, 'assignees.sqlite');
  let app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  let base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro', organization: 'Outra', type: 'publica', email: 'b@empresa.com', password });
  let workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  const sector = workspace.sectors[0].id;
  for (const [name, email, role] of [['Carlos','c@empresa.com','colaborador'],['=Analista de teste','d@empresa.com','admin'],['Eva','e@empresa.com','admin'],['Inativo','i@empresa.com','admin']]) {
    assert.equal((await call('/api/users', { name, email, role, sector_id: sector, password }, a.cookie)).status, 201);
  }
  workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  const d = workspace.users.find(u => u.email === 'd@empresa.com'); const e = workspace.users.find(u => u.email === 'e@empresa.com'); const inactive = workspace.users.find(u => u.email === 'i@empresa.com');
  await call(`/api/users/${inactive.id}`, { name: inactive.name, role: 'admin', sector_id: sector, active: false }, a.cookie);
  const c = await call('/api/login', { email: 'c@empresa.com', password });
  const request = await call('/api/requests', { title: 'Pedido para análise', description: 'Justificativa', priority: 'alta', sector_id: sector }, c.cookie);
  const own = await call('/api/requests', { title: 'Pedido próprio do admin', description: 'Justificativa', priority: 'normal', sector_id: sector }, a.cookie);
  const path = `/api/requests/${request.data.id}/assignee`;
  // Um banco anterior é atualizado sem perder os pedidos e sem atribuição automática.
  await new Promise(resolve => app.close(resolve));
  const legacy = new DatabaseSync(databasePath); legacy.exec('ALTER TABLE requests DROP COLUMN assigned_to'); legacy.close();
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  assert.ok((await call('/api/workspace', undefined, a.cookie)).data.requests.every(r => r.assigned_to === null));
  assert.equal((await call(path, { assigned_to: d.id })).status, 401);
  assert.equal((await call(path, { assigned_to: d.id }, c.cookie)).status, 403);
  assert.equal((await call(path, { assigned_to: d.id }, b.cookie)).status, 404);
  for (const assigned_to of [undefined, '1', 0, -1, 999999, b.data.id, c.data.id, inactive.id]) {
    assert.equal((await call(path, { assigned_to }, a.cookie)).status, 400);
  }
  assert.equal((await call('/api/requests/999999/assignee', { assigned_to: d.id }, a.cookie)).status, 404);
  assert.equal((await call(path, { assigned_to: d.id }, a.cookie)).status, 200);
  const countEvents = async () => (await call('/api/workspace', undefined, a.cookie)).data.history.filter(h => h.action.startsWith('Responsável pela análise')).length;
  const before = await countEvents();
  assert.equal((await call(path, { assigned_to: d.id }, a.cookie)).status, 200); assert.equal(await countEvents(), before);
  let visible = (await call('/api/workspace', undefined, c.cookie)).data;
  let assigned = visible.requests.find(r => r.id === request.data.id);
  assert.equal(assigned.assignee_name, d.name); assert.equal(assigned.assignee_available, 1); assert.equal(assigned.status, 'pendente');
  assert.equal(visible.users.length, 0);
  assert.equal((await call(path, { assigned_to: e.id }, a.cookie)).status, 200);
  assert.equal((await call(path, { assigned_to: null }, a.cookie)).status, 200);
  assert.equal((await call('/api/workspace', undefined, c.cookie)).data.requests.find(r => r.id === request.data.id).assigned_to, null);
  await call(path, { assigned_to: d.id }, a.cookie);
  const csvResponse = await fetch(base + '/api/requests/export.csv', { headers: { cookie: c.cookie } }); const csv = await csvResponse.text();
  assert.ok(csv.includes('Responsável pela análise')); assert.ok(csv.includes("'=Analista de teste"));
  await call(`/api/users/${d.id}`, { name: d.name, role: 'admin', sector_id: sector, active: false }, a.cookie);
  assigned = (await call('/api/workspace', undefined, c.cookie)).data.requests.find(r => r.id === request.data.id);
  assert.equal(assigned.assigned_to, d.id); assert.equal(assigned.assignee_available, 0);
  assert.equal((await call(path, { assigned_to: d.id }, a.cookie)).status, 400);
  await call(`/api/users/${d.id}`, { name: d.name, role: 'colaborador', sector_id: sector, active: true }, a.cookie);
  assert.equal((await call('/api/workspace', undefined, c.cookie)).data.requests.find(r => r.id === request.data.id).assignee_available, 0);
  assert.equal((await call(path, { assigned_to: d.id }, a.cookie)).status, 400);
  await call(`/api/users/${d.id}`, { name: d.name, role: 'admin', sector_id: sector, active: true }, a.cookie);
  await call(path, { assigned_to: e.id }, a.cookie);
  // A atribuição não impede outro administrador de decidir nem permite autoaprovação.
  assert.equal((await call(`/api/requests/${request.data.id}/decision`, { status: 'aprovada', decision: 'Autorizado' }, a.cookie)).status, 200);
  assert.equal((await call(path, { assigned_to: null }, a.cookie)).status, 409);
  assert.equal((await call(`/api/requests/${own.data.id}/assignee`, { assigned_to: a.data.id }, a.cookie)).status, 400);
  assert.equal((await call(`/api/requests/${own.data.id}/assignee`, { assigned_to: d.id }, a.cookie)).status, 200);
  assert.equal((await call(`/api/requests/${own.data.id}/decision`, { status: 'aprovada', decision: 'Autorizo' }, a.cookie)).status, 403);
  const loggedD = await call('/api/login', { email: 'd@empresa.com', password });
  assert.equal((await call(`/api/requests/${own.data.id}/decision`, { status: 'aprovada', decision: 'Analisado pelo responsável' }, loggedD.cookie)).status, 200);
  await new Promise(resolve => app.close(resolve));
  app = createApp({ databasePath }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); base = `http://127.0.0.1:${app.address().port}`;
  workspace = (await call('/api/workspace', undefined, a.cookie)).data;
  assigned = workspace.requests.find(r => r.id === request.data.id);
  assert.equal(assigned.assigned_to, e.id); assert.equal(assigned.assignee_name, 'Eva'); assert.equal(assigned.status, 'aprovada');
  assert.ok(workspace.history.some(h => h.action.startsWith('Responsável pela análise')));
  assert.equal((await call('/api/workspace', undefined, b.cookie)).data.requests.length, 0);
});

test('fila de análise: filtros CSV, combinação com prazo e restrição ao administrador', async t => {
  const { brazilDay } = await import('../server.js');
  const app = createApp({ databasePath: ':memory:' }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, body, cookie = '') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'Senha-de-teste-2026';
  const a = await call('/api/register', { name: 'Admin', organization: 'Empresa', type: 'privada', email: 'a@empresa.com', password });
  const b = await call('/api/register', { name: 'Outro', organization: 'Outra', type: 'publica', email: 'b@empresa.com', password });
  const sector = (await call('/api/workspace', undefined, a.cookie)).data.sectors[0].id;
  const otherSector = (await call('/api/workspace', undefined, b.cookie)).data.sectors[0].id;
  for (const [name,email,role] of [['Carlos','c@empresa.com','colaborador'],['Dani','d@empresa.com','admin'],['Ivo','i@empresa.com','admin']]) await call('/api/users', { name,email,role,password,sector_id:sector }, a.cookie);
  const people = (await call('/api/workspace', undefined, a.cookie)).data.users;
  const d = people.find(u => u.email === 'd@empresa.com'); const i = people.find(u => u.email === 'i@empresa.com');
  const c = await call('/api/login', { email:'c@empresa.com',password }); const loggedD = await call('/api/login', {email:'d@empresa.com',password});
  const titles = ['Meu pendente vencido','Outro responsável','Sem atribuição','Responsável indisponível','Meu aprovado','Meu pendente hoje'];
  const ids=[];
  for(const title of titles){ const r=await call('/api/requests',{title,description:'Teste de fila',priority:'normal',sector_id:sector},c.cookie);ids.push(r.data.id); }
  for(const [index,assigned_to] of [[0,a.data.id],[1,d.id],[3,i.id],[4,a.data.id],[5,a.data.id]]) await call(`/api/requests/${ids[index]}/assignee`,{assigned_to},a.cookie);
  const today=brazilDay(); const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  await call(`/api/requests/${ids[0]}/deadline`,{due_date:yesterday},a.cookie);
  await call(`/api/requests/${ids[5]}/deadline`,{due_date:today},a.cookie);
  await call(`/api/requests/${ids[4]}/decision`,{status:'aprovada',decision:'Autorizado'},a.cookie);
  await call(`/api/users/${i.id}`,{name:i.name,role:'colaborador',active:true,sector_id:sector},a.cookie);
  await call('/api/requests',{title:'Pedido de outra organização',description:'Isolamento',priority:'normal',sector_id:otherSector},b.cookie);
  async function csv(query,cookie=a.cookie){const response=await fetch(base+'/api/requests/export.csv?'+query,{headers:{cookie}});assert.equal(response.status,200);return response.text();}
  function assertTitles(text,expected){for(let j=0;j<titles.length;j++) assert.equal(text.includes('"'+titles[j]+'"'),expected.includes(j),titles[j]);assert.equal(text.includes('Pedido de outra organização'),false);}
  assertTitles(await csv('assignment=mine'),[0,5]);
  assertTitles(await csv('assignment=mine',loggedD.cookie),[1]);
  assertTitles(await csv('assignment=unassigned'),[2,3]);
  assertTitles(await csv('assignment=mine&deadline=overdue'),[0]);
  assertTitles(await csv('assignment=mine&q=hoje'),[5]);
  assertTitles(await csv('assignment=mine&status=aprovada'),[]);
  assertTitles(await csv('',c.cookie),[0,1,2,3,4,5]);
  const other=await csv('assignment=unassigned',b.cookie);assert.ok(other.includes('Pedido de outra organização'));for(const title of titles)assert.equal(other.includes('"'+title+'"'),false);
  assert.equal((await call('/api/requests/export.csv?assignment=mine',undefined,c.cookie)).status,403);
  assert.equal((await call('/api/requests/export.csv?assignment=unassigned',undefined,c.cookie)).status,403);
  assert.equal((await call('/api/requests/export.csv?assignment=1',undefined,a.cookie)).status,400);
  await call(`/api/users/${i.id}`,{name:i.name,role:'admin',active:true,sector_id:sector},a.cookie);
  assertTitles(await csv('assignment=unassigned'),[2]);
  const ws=(await call('/api/workspace',undefined,a.cookie)).data;
  assert.equal(ws.requests.find(r=>r.id===ids[4]).status,'aprovada');assert.equal(ws.requests.find(r=>r.id===ids[0]).assigned_to,a.data.id);
});

test('movimentações por pedido: migração, persistência, paginação e isolamento', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-history-')); const databasePath = join(dir, 'test.sqlite');
  let app; let base;
  async function start() { app=createApp({databasePath}); app.listen(0,'127.0.0.1'); await once(app,'listening'); base=`http://127.0.0.1:${app.address().port}`; }
  async function stop() { await new Promise(resolve=>app.close(resolve)); }
  t.after(async()=>{if(app?.listening) await stop();rmSync(dir,{recursive:true,force:true});});
  async function call(path,body,cookie='') { const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}; }
  await start();
  const password='Teste-historico-2026';
  const a=await call('/api/register',{name:'Admin',organization:'Uma',type:'privada',email:'hist@uma.com',password});
  const b=await call('/api/register',{name:'Outra',organization:'Outra',type:'publica',email:'hist@outra.com',password});
  const sector=(await call('/api/workspace',undefined,a.cookie)).data.sectors[0].id;
  await call('/api/users',{name:'Autor',email:'autor@uma.com',password,role:'colaborador',sector_id:sector},a.cookie);
  await call('/api/users',{name:'Colega',email:'colega@uma.com',password,role:'colaborador',sector_id:sector},a.cookie);
  const author=await call('/api/login',{email:'autor@uma.com',password}); const colleague=await call('/api/login',{email:'colega@uma.com',password});
  const body={title:'Pedido histórico',description:'Teste',priority:'normal',sector_id:sector};
  const old=await call('/api/requests',body,author.cookie);
  await stop();
  const db=new DatabaseSync(databasePath);db.exec('DROP INDEX audit_request; ALTER TABLE audit DROP COLUMN request_id');db.close();
  await start();
  assert.deepEqual((await call(`/api/requests/${old.data.id}/history`,undefined,author.cookie)).data.history,[]);
  assert.ok((await call('/api/workspace',undefined,a.cookie)).data.history.some(h=>h.action.includes('Pedido histórico')));
  const created=await call('/api/requests',body,author.cookie);const id=created.data.id;const path=`/api/requests/${id}/history`;
  assert.equal((await call(path)).status,401);
  assert.equal((await call(path,undefined,colleague.cookie)).status,404);
  assert.equal((await call(path,undefined,b.cookie)).status,404);
  assert.equal((await call('/api/requests/99999/history',undefined,a.cookie)).status,404);
  for(const cursor of ['0','-1','abc','1.5','9007199254740992','']) assert.equal((await call(path+'?before='+cursor,undefined,a.cookie)).status,400);
  await call(`/api/requests/${id}/deadline`,{due_date:'2026-12-01'},a.cookie);
  await call(`/api/requests/${id}/assignee`,{assigned_to:a.data.id},a.cookie);
  await call(`/api/requests/${id}/assignee`,{assigned_to:a.data.id},a.cookie); // no-op não duplica ação
  await call(`/api/requests/${id}/deadline`,{due_date:'2026-12-01'},a.cookie);
  await call(`/api/requests/${id}/deadline`,{due_date:'inválido'},a.cookie); // falha não gera ação
  for(let i=0;i<51;i++) assert.equal((await call(`/api/requests/${id}/comments`,{content:'Mensagem '+i},author.cookie)).status,201);
  await call(`/api/requests/${id}/decision`,{status:'aprovada',decision:'De acordo'},a.cookie);
  const first=(await call(path,undefined,author.cookie)).data;
  assert.equal(first.history.length,50);assert.ok(first.nextBefore);assert.match(first.history[0].action,/aprovada/);
  const second=(await call(path+'?before='+first.nextBefore,undefined,a.cookie)).data;
  assert.equal(second.history.length,5);assert.equal(second.nextBefore,null);
  const all=[...first.history,...second.history];assert.equal(new Set(all.map(h=>h.id)).size,55);
  assert.match(all.at(-1).action,/criada/);assert.equal(all.at(-1).actor,'Autor');
  assert.equal(all.filter(h=>h.action.startsWith('Prazo')).length,1);assert.equal(all.filter(h=>h.action.startsWith('Responsável')).length,1);
  for(let i=1;i<all.length;i++) assert.ok(all[i-1].id>all[i].id);
  await stop();await start();
  assert.deepEqual((await call(path,undefined,author.cookie)).data,first);
});

test('filtros de setor e prioridade: combinações, setores antigos e exportação autorizada', async t => {
  const { brazilDay } = await import('../server.js');
  const app=createApp({databasePath:':memory:'}); app.listen(0,'127.0.0.1');await once(app,'listening');
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const base=`http://127.0.0.1:${app.address().port}`;
  async function call(path,body,cookie='') {const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const password='Senha-filtros-2026';
  const admin=await call('/api/register',{name:'Admin',organization:'Empresa',type:'privada',email:'filtro@empresa.com',password});
  const other=await call('/api/register',{name:'Outra',organization:'Outra',type:'publica',email:'filtro@outra.com',password});
  assert.equal((await call('/api/sectors',{name:'Arquivo de teste',description:'Setor para consulta de pedidos antigos'},admin.cookie)).status,201);
  const sectors=(await call('/api/workspace',undefined,admin.cookie)).data.sectors;
  const first=sectors[0].id, second=sectors[1].id;
  const otherSector=(await call('/api/workspace',undefined,other.cookie)).data.sectors[0].id;
  await call('/api/users',{name:'Autor',email:'filtro-autor@empresa.com',password,role:'colaborador',sector_id:first},admin.cookie);
  await call('/api/users',{name:'Colega',email:'filtro-colega@empresa.com',password,role:'colaborador',sector_id:first},admin.cookie);
  const author=await call('/api/login',{email:'filtro-autor@empresa.com',password});
  const colleague=await call('/api/login',{email:'filtro-colega@empresa.com',password});
  const titles=['Urgente do primeiro setor','Alta do primeiro setor','Normal do primeiro setor','Urgente do segundo setor','Arquivo do segundo setor','Pedido do colega','Pedido externo'];
  const ids=[];
  for(const [i,priority,sector_id,cookie] of [[0,'urgente',first,author.cookie],[1,'alta',first,author.cookie],[2,'normal',first,author.cookie],[3,'urgente',second,author.cookie],[4,'normal',second,author.cookie],[5,'urgente',first,colleague.cookie],[6,'urgente',otherSector,other.cookie]]) {
    const r=await call('/api/requests',{title:titles[i],description:'Filtro combinado',priority,sector_id},cookie);assert.equal(r.status,201);ids.push(r.data.id);
  }
  const yesterday=new Date(Date.parse(brazilDay()+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  await call(`/api/requests/${ids[0]}/deadline`,{due_date:yesterday},admin.cookie);
  await call(`/api/requests/${ids[0]}/assignee`,{assigned_to:admin.data.id},admin.cookie);
  await call(`/api/requests/${ids[4]}/decision`,{status:'aprovada',decision:'Autorizado'},admin.cookie);
  async function csv(query,cookie=admin.cookie) {const r=await fetch(base+'/api/requests/export.csv?'+query,{headers:{cookie}});assert.equal(r.status,200);return r.text();}
  function containsOnly(text,indexes) {for(let i=0;i<titles.length;i++) assert.equal(text.includes('"'+titles[i]+'"'),indexes.includes(i),titles[i]);}
  containsOnly(await csv('sector_id='+first),[0,1,2,5]);
  containsOnly(await csv('priority=urgente'),[0,3,5]);
  containsOnly(await csv(`sector_id=${first}&priority=urgente&status=pendente&deadline=overdue&assignment=mine&q=primeiro`),[0]);
  containsOnly(await csv(`sector_id=${first}&priority=alta`),[1]);
  containsOnly(await csv(`sector_id=${second}&priority=normal&status=aprovada`),[4]);
  containsOnly(await csv(`sector_id=${second}&priority=alta`),[]);
  containsOnly(await csv('sector_id=&priority='),[0,1,2,3,4,5]);
  containsOnly(await csv(`sector_id=${first}&priority=urgente`,author.cookie),[0]);
  containsOnly(await csv(`sector_id=${first}&priority=urgente`,colleague.cookie),[5]);
  const user=(await call('/api/workspace',undefined,admin.cookie)).data.users.find(u=>u.email==='filtro-autor@empresa.com');
  await call(`/api/users/${user.id}`,{name:user.name,role:'colaborador',active:true,sector_id:second},admin.cookie);
  containsOnly(await csv('sector_id='+first,author.cookie),[0,1,2]); // usa destino do pedido, não o cadastro atual
  await call(`/api/requests/${ids[3]}/decision`,{status:'aprovada',decision:'Autorizado'},admin.cookie);
  // Segundo setor só pode ser desativado depois de transferir a pessoa ativa.
  await call(`/api/users/${user.id}`,{name:user.name,role:'colaborador',active:true,sector_id:first},admin.cookie);
  const secondInfo=sectors.find(s=>s.id===second);
  assert.equal((await call(`/api/sectors/${second}`,{name:secondInfo.name,description:secondInfo.description,active:false},admin.cookie)).status,200);
  containsOnly(await csv(`sector_id=${second}&priority=normal`),[4]);
  for(const query of ['priority=emergencia','priority=URGENTE','sector_id=0','sector_id=-1','sector_id=1.2','sector_id=1e0','sector_id=01','sector_id=9007199254740992','sector_id=999999',`sector_id=${otherSector}`]) assert.equal((await call('/api/requests/export.csv?'+query,undefined,admin.cookie)).status,400,query);
  assert.equal((await call(`/api/requests/export.csv?sector_id=${first}`,undefined,other.cookie)).status,400);
  assert.equal((await call('/api/requests/export.csv?priority=alta')).status,401);
  containsOnly(await csv(`sector_id=${otherSector}&priority=urgente`,other.cookie),[6]);
});

test('impressão do pedido: autorização, dados atuais, HTML seguro e ausência de alterações', async t => {
  const app=createApp({databasePath:':memory:'});app.listen(0,'127.0.0.1');await once(app,'listening');
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const base=`http://127.0.0.1:${app.address().port}`;
  async function call(path,body,cookie='') {const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function print(id,cookie='') {const response=await fetch(`${base}/api/requests/${id}/print`,{headers:{cookie}});return {response,text:await response.text()};}
  const password='Impressao-teste-2026';
  const a=await call('/api/register',{name:'Admin & análise',organization:'Empresa <exemplo>',type:'privada',email:'impressao@empresa.com',password});
  const b=await call('/api/register',{name:'Admin externo',organization:'Outra',type:'publica',email:'impressao@outra.com',password});
  const sector=(await call('/api/workspace',undefined,a.cookie)).data.sectors[0].id;
  await call('/api/users',{name:'Autor <teste>',email:'impressao-autor@empresa.com',password,role:'colaborador',sector_id:sector},a.cookie);
  await call('/api/users',{name:'Colega',email:'impressao-colega@empresa.com',password,role:'colaborador',sector_id:sector},a.cookie);
  const author=await call('/api/login',{email:'impressao-autor@empresa.com',password});const colleague=await call('/api/login',{email:'impressao-colega@empresa.com',password});
  const title='<script>alert("teste")</script>';
  const description='Primeira linha & detalhes\nSegunda linha <img src=x onerror=alert(1)>';
  const created=await call('/api/requests',{title,description,priority:'urgente',sector_id:sector},author.cookie);const id=created.data.id;
  assert.equal((await print(id)).response.status,401);
  assert.equal((await print(id,colleague.cookie)).response.status,404);
  assert.equal((await print(id,b.cookie)).response.status,404);
  assert.equal((await print(999999,a.cookie)).response.status,404);
  assert.equal((await print('9007199254740992',a.cookie)).response.status,400);
  const pending=await print(id,author.cookie);assert.equal(pending.response.status,200);
  assert.match(pending.response.headers.get('content-type'),/text\/html/);assert.equal(pending.response.headers.get('cache-control'),'no-store');
  assert.match(pending.response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.match(pending.text,/Aguardando análise/);assert.match(pending.text,/Sem prazo/);assert.match(pending.text,/Não definido/);
  assert.ok(pending.text.includes('&lt;script&gt;alert(&quot;teste&quot;)&lt;/script&gt;'));
  assert.ok(pending.text.includes('Primeira linha &amp; detalhes\nSegunda linha &lt;img'));
  assert.ok(pending.text.includes('Empresa &lt;exemplo&gt;'));assert.ok(pending.text.includes('Autor &lt;teste&gt;'));
  assert.equal(pending.text.includes('<script>alert'),false);assert.equal(pending.text.includes('<img'),false);
  assert.equal(pending.text.includes('impressao-autor@empresa.com'),false);
  assert.match(pending.text,/COS-00001/);assert.match(pending.text,/Urgente/);assert.match(pending.text,/não possui assinatura digital/);
  await call(`/api/requests/${id}/deadline`,{due_date:'2026-12-15'},a.cookie);
  await call(`/api/requests/${id}/assignee`,{assigned_to:a.data.id},a.cookie);
  await call(`/api/requests/${id}/decision`,{status:'aprovada',decision:'Aprovado <com ressalva> & conferido'},a.cookie);
  const before=(await call('/api/workspace',undefined,a.cookie)).data;
  const approved=await print(id,a.cookie);assert.equal(approved.response.status,200);
  assert.match(approved.text,/Aprovada/);assert.match(approved.text,/15\/12\/2026/);assert.match(approved.text,/Admin &amp; análise/);
  assert.match(approved.text,/Aprovado &lt;com ressalva&gt; &amp; conferido/);assert.match(approved.text,/Decidida em · Brasília/);
  assert.equal(approved.text.includes('Aguardando análise.'),false);
  assert.deepEqual((await call('/api/workspace',undefined,a.cookie)).data,before);
  for(const [path,mime] of [['/print.css','text/css'],['/print.js','text/javascript']]) {const r=await fetch(base+path);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').startsWith(mime));}
  const refused=await call('/api/requests',{title:'Segundo pedido',description:'Outro',priority:'normal',sector_id:sector},author.cookie);
  await call(`/api/requests/${refused.data.id}/decision`,{status:'recusada',decision:'Rever quantidades'},a.cookie);
  assert.match((await print(refused.data.id,author.cookie)).text,/Recusada/);
  await call('/api/logout',{},author.cookie);assert.equal((await print(id,author.cookie)).response.status,401);
});

test('resumo imprimível usa Brasília e preserva a data do prazo sem fuso', async () => {
  const { renderRequestPrint }=await import('../request-print.js');
  const html=renderRequestPrint({organization:{name:'Órgão',type:'publica'},generatedAt:new Date('2026-11-06T01:30:00Z'),request:{id:25,title:'Pedido',author:'Pessoa',sector:'Setor',priority:'alta',status:'pendente',created_at:'2026-11-06T01:30:00Z',due_date:'2026-11-06',description:'Descrição'}});
  assert.match(html,/05\/11\/2026, 22:30:00/);assert.match(html,/06\/11\/2026<\/dd>/);assert.match(html,/Organização pública/);assert.match(html,/COS-00025/);
});
