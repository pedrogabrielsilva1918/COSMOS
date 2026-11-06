import http from 'node:http';
import { orderRequests, REQUEST_ORDERS } from './public/request-order.js';
import { renderRequestPrint } from './request-print.js';
import { createClientAddress } from './client-address.js';
import { defaultSectorDescription } from './sector-descriptions.js';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify, parseArgs } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = dirname(fileURLToPath(import.meta.url));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const safeUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, sector_id: user.sector_id, active: user.active });
export function brazilDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function isRequestOverdue(request, today = brazilDay()) {
  return Boolean(request.status === 'pendente' && request.due_date && request.due_date < today);
}
function validateDeadline(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) fail(400, 'Informe uma data válida no formato AAAA-MM-DD ou null para remover.');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(400, 'A data informada não existe no calendário.');
  return value;
}
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(await scrypt(password, salt, 64)));
}
function field(body, key, max = 200) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if (!value || value.length > max) fail(400, `Preencha ${key} (até ${max} caracteres).`);
  return value;
}
function credentials(body) {
  const email = field(body, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe um e-mail válido.');
  const password = field(body, 'password', 128);
  if (password.length < 12) fail(400, 'A senha precisa ter pelo menos 12 caracteres.');
  return { email, password };
}
function csvCell(value) {
  let text = String(value ?? '').replace(/\u0000/g, '');
  // Aspas tratam separadores/quebras; apóstrofo trata fórmulas de planilhas.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function sectorDescription(body, fallback = '') {
  if (!Object.hasOwn(body, 'description')) return fallback;
  if (typeof body.description !== 'string' || body.description.trim().length > 300) fail(400, 'A descrição deve ser um texto com até 300 caracteres.');
  return body.description.trim();
}
async function readBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Envie JSON.');
  // Acumula bytes e decodifica só no final: converter cada bloco em texto corromperia
  // caracteres multibyte (acentos, emoji) divididos entre dois blocos.
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 24000) fail(413, 'Conteúdo muito grande.');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString('utf8');
  try { const body = JSON.parse(data); if (!body || Array.isArray(body) || typeof body !== 'object') throw Error(); return body; }
  catch { fail(400, 'JSON inválido.'); }
}

export function createApp({ databasePath = process.env.DATABASE_PATH || join(root, 'data/cosmos.sqlite'), secure = process.env.COOKIE_SECURE === 'true', trustProxy = process.env.TRUST_PROXY === 'true', trustedProxyIps = (process.env.TRUSTED_PROXY_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean) } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const clientAddress = createClientAddress({ trustProxy, trustedProxyIps });
  const db = new DatabaseSync(databasePath);
  db.function('cosmos_search_text', { deterministic: true }, value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS organizations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('publica','privada')));
    CREATE TABLE IF NOT EXISTS sectors(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, UNIQUE(org_id,name));
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), sector_id INTEGER REFERENCES sectors(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','colaborador')));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), user_id INTEGER NOT NULL REFERENCES users(id), sector_id INTEGER NOT NULL REFERENCES sectors(id), title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('normal','alta','urgente')), status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aprovada','recusada')), decision TEXT, decided_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), decided_at TEXT);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS request_comments(id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id), user_id INTEGER NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), user_id INTEGER NOT NULL REFERENCES users(id), request_id INTEGER NOT NULL REFERENCES requests(id), actor_id INTEGER NOT NULL REFERENCES users(id), message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(user_id,request_id));
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications(org_id,user_id,id);
    CREATE INDEX IF NOT EXISTS notifications_unread ON notifications(org_id,user_id) WHERE read_at IS NULL;
    CREATE INDEX IF NOT EXISTS comments_request ON request_comments(request_id,id);
    CREATE INDEX IF NOT EXISTS requests_org ON requests(org_id,user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
  // Migração compatível com os bancos já criados; nenhuma tabela é apagada.
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'active')) {
    db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))');
  }
  if (!db.prepare('PRAGMA table_info(sectors)').all().some(column => column.name === 'active')) {
    db.exec('ALTER TABLE sectors ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))');
  }
  if (!db.prepare('PRAGMA table_info(requests)').all().some(column => column.name === 'due_date')) {
    db.exec('ALTER TABLE requests ADD COLUMN due_date TEXT');
  }
  if (!db.prepare('PRAGMA table_info(sectors)').all().some(column => column.name === 'description')) {
    transaction(() => {
      db.exec("ALTER TABLE sectors ADD COLUMN description TEXT NOT NULL DEFAULT ''");
      for (const sector of db.prepare('SELECT id,name FROM sectors').all()) {
        db.prepare('UPDATE sectors SET description=? WHERE id=?').run(defaultSectorDescription(sector.name), sector.id);
      }
    });
  }
  if (!db.prepare('PRAGMA table_info(requests)').all().some(column => column.name === 'assigned_to')) {
    db.exec('ALTER TABLE requests ADD COLUMN assigned_to INTEGER REFERENCES users(id)');
  }
  if (!db.prepare('PRAGMA table_info(audit)').all().some(column => column.name === 'request_id')) {
    db.exec('ALTER TABLE audit ADD COLUMN request_id INTEGER REFERENCES requests(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS audit_request ON audit(org_id,request_id,id); CREATE INDEX IF NOT EXISTS audit_org_cursor ON audit(org_id,id)');
  const rate = new Map();
  const janitor = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rate) if (entry.until < now) rate.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
  }, 60000); janitor.unref();
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  function unreadNotifications(user) { return db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE org_id=? AND user_id=? AND read_at IS NULL').get(user.org_id, user.id).count; }
  function audit(user, action, requestId = null) { db.prepare('INSERT INTO audit(org_id,actor_id,action,request_id) VALUES (?,?,?,?)').run(user.org_id, user.id, action, requestId); }
  function admin(user) { const current = db.prepare('SELECT role,active FROM users WHERE id=?').get(user.id); if (!current?.active || current.role !== 'admin') fail(403, 'Acesso restrito ao administrador.'); }
  function sector(id, org, allowInactive = false) {
    if (!Number.isSafeInteger(id)) fail(400, 'Selecione um setor da organização.');
    const found = db.prepare('SELECT id,active FROM sectors WHERE id=? AND org_id=?').get(id, org);
    if (!found || (!allowInactive && !found.active)) fail(400, 'Selecione um setor ativo da organização.');
    return id;
  }
  function issueSession(res, user) {
    const current = db.prepare('SELECT password,active FROM users WHERE id=?').get(user.id);
    if (!current?.active || current.password !== user.password) fail(401, 'Entre novamente com suas credenciais atuais.');
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), user.id, Date.now() + 8 * 3600000);
    res.setHeader('Set-Cookie', `cosmos=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET') fail(405, 'Método não permitido.');
        const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/horizonte.css': ['horizonte.css', 'text/css'], '/print.css': ['print.css', 'text/css'], '/print.js': ['print.js', 'text/javascript'], '/request-order.js': ['request-order.js', 'text/javascript'], '/sector-overview.js': ['sector-overview.js', 'text/javascript'], '/sector-search.js': ['sector-search.js', 'text/javascript'], '/people-search.js': ['people-search.js', 'text/javascript'] };
        if (!assets[path]) fail(404, 'Página não encontrada.');
        const [file, mime] = assets[path];
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); return res.end(readFileSync(join(root, 'public', file)));
      }
      if (!['GET', 'POST'].includes(req.method)) fail(405, 'Método não permitido.');
      if (req.method === 'POST') {
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origem não permitida.');
        if (req.headers.origin) {
          let origin; try { origin = new URL(req.headers.origin).host; } catch { fail(403, 'Origem não permitida.'); }
          if (origin !== req.headers.host) fail(403, 'Origem não permitida.');
        }
        const key = `${clientAddress(req)}:${['/api/login', '/api/register', '/api/account/password'].includes(path) ? 'auth' : 'write'}`;
        const entry = rate.get(key) || { count: 0, until: Date.now() + 600000 };
        if (entry.until < Date.now()) { entry.count = 0; entry.until = Date.now() + 600000; }
        entry.count++; rate.set(key, entry);
        if (entry.count > (key.endsWith('auth') ? 20 : 200)) fail(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
      }
      if (req.method === 'POST' && path === '/api/register') {
        const body = await readBody(req); const { email, password } = credentials(body);
        const name = field(body, 'name', 120); const organization = field(body, 'organization', 160);
        if (!['publica', 'privada'].includes(body.type)) fail(400, 'Tipo de organização inválido.');
        const digest = await passwordHash(password);
        const user = transaction(() => {
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Este e-mail já está cadastrado.');
          const org = Number(db.prepare('INSERT INTO organizations(name,type) VALUES (?,?)').run(organization, body.type).lastInsertRowid);
          const sec = Number(db.prepare('INSERT INTO sectors(org_id,name,description) VALUES (?,?,?)').run(org, 'Administração', defaultSectorDescription('Administração')).lastInsertRowid);
          const id = Number(db.prepare('INSERT INTO users(org_id,sector_id,name,email,password,role) VALUES (?,?,?,?,?,?)').run(org, sec, name, email, digest, 'admin').lastInsertRowid);
          const user = db.prepare('SELECT * FROM users WHERE id=?').get(id); audit(user, 'Organização cadastrada'); return user;
        }); issueSession(res, user); return json(201, safeUser(user));
      }
      if (req.method === 'POST' && path === '/api/login') {
        const body = await readBody(req); const email = field(body, 'email').toLowerCase(); const password = field(body, 'password', 128);
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        // Mesmo custo de derivação para contas inexistentes.
        const dummy = '0'.repeat(32) + ':' + '0'.repeat(128);
        const matches = await passwordMatches(password, user?.password || dummy);
        if (!user || !user.active || !matches) fail(401, 'E-mail ou senha incorretos.');
        issueSession(res, user); return json(200, safeUser(user));
      }
      const token = /(?:^|;\s*)cosmos=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const user = token && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1').get(hash(token), Date.now());
      if (!user) fail(401, 'Entre na sua conta para continuar.');
      if (req.method === 'POST' && path === '/api/logout') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
        res.setHeader('Set-Cookie', `cosmos=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`); return json(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/account/password') {
        const body = await readBody(req);
        const currentPassword = field(body, 'currentPassword', 128);
        const newPassword = field(body, 'newPassword', 128);
        if (newPassword.length < 12) fail(400, 'A nova senha precisa ter pelo menos 12 caracteres.');
        if (newPassword === currentPassword) fail(400, 'Escolha uma senha diferente da atual.');
        if (!await passwordMatches(currentPassword, user.password)) fail(400, 'Senha atual incorreta.');
        const digest = await passwordHash(newPassword);
        transaction(() => {
          // Uma troca concorrente não pode sobrescrever uma senha já alterada.
          const result = db.prepare('UPDATE users SET password=? WHERE id=? AND password=?').run(digest, user.id, user.password);
          if (result.changes !== 1) fail(409, 'A senha já foi alterada. Entre novamente.');
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          audit(user, 'Senha da própria conta alterada; sessões encerradas');
        });
        res.setHeader('Set-Cookie', `cosmos=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
        return json(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/notifications') {
        const rawBefore = url.searchParams.get('before');
        if (rawBefore !== null && !/^[1-9]\d*$/.test(rawBefore)) fail(400, 'Cursor de notificações inválido.');
        const before = rawBefore === null ? Number.MAX_SAFE_INTEGER : Number(rawBefore);
        if (!Number.isSafeInteger(before) || before <= 0) fail(400, 'Cursor de notificações inválido.');
        const rows = db.prepare('SELECT n.id,n.request_id,n.message,n.read_at,n.created_at,a.name AS actor FROM notifications n JOIN requests r ON r.id=n.request_id AND r.org_id=n.org_id AND r.user_id=n.user_id JOIN users a ON a.id=n.actor_id AND a.org_id=n.org_id WHERE n.org_id=? AND n.user_id=? AND n.id<? ORDER BY n.id DESC LIMIT 51').all(user.org_id,user.id,before);
        const notifications = rows.slice(0,50);
        return json(200, { notifications, unreadCount: unreadNotifications(user), nextBefore: rows.length > 50 ? notifications.at(-1).id : null });
      }
      const notificationReadMatch = /^\/api\/notifications\/(\d+)\/read$/.exec(path);
      if (req.method === 'POST' && notificationReadMatch) {
        await readBody(req);
        const id = Number(notificationReadMatch[1]);
        if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'Notificação inválida.');
        transaction(() => {
          const notification = db.prepare('SELECT id FROM notifications WHERE id=? AND org_id=? AND user_id=?').get(id,user.org_id,user.id);
          if (!notification) fail(404, 'Notificação não encontrada.');
          db.prepare("UPDATE notifications SET read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=? AND user_id=? AND read_at IS NULL").run(id,user.org_id,user.id);
        });
        return json(200, { ok:true, unreadCount: unreadNotifications(user) });
      }
      if (req.method === 'GET' && path === '/api/history') {
        admin(user);
        const rawBefore = url.searchParams.get('before');
        if (rawBefore !== null && !/^[1-9]\d*$/.test(rawBefore)) fail(400, 'Cursor de histórico inválido.');
        const before = rawBefore === null ? Number.MAX_SAFE_INTEGER : Number(rawBefore);
        if (!Number.isSafeInteger(before) || before <= 0) fail(400, 'Cursor de histórico inválido.');
        const query = (url.searchParams.get('q') || '').trim();
        if (query.length > 200) fail(400, 'A busca deve ter até 200 caracteres.');
        const terms = query.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean);
        const params = [user.org_id, before];
        let conditions = 'a.org_id=? AND a.id<?';
        for (const term of terms) { conditions += " AND instr(cosmos_search_text(a.action || ' ' || u.name),?)>0"; params.push(term); }
        const rows = db.prepare(`SELECT a.id,a.action,a.created_at,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id AND u.org_id=a.org_id WHERE ${conditions} ORDER BY a.id DESC LIMIT 51`).all(...params);
        const history = rows.slice(0, 50);
        return json(200, { history, nextBefore: rows.length > 50 ? history.at(-1).id : null });
      }
      if (req.method === 'GET' && path === '/api/workspace') {
        const organization = db.prepare('SELECT * FROM organizations WHERE id=?').get(user.org_id);
        const sectors = db.prepare('SELECT id,name,active,description FROM sectors WHERE org_id=? ORDER BY name').all(user.org_id);
        const users = user.role === 'admin' ? db.prepare('SELECT u.id,u.name,u.email,u.role,u.active,u.sector_id,s.name AS sector FROM users u LEFT JOIN sectors s ON s.id=u.sector_id WHERE u.org_id=? ORDER BY u.name').all(user.org_id) : [];
        const requests = db.prepare(`SELECT r.*,u.name AS author,s.name AS sector,d.name AS reviewer,a.name AS assignee_name,CASE WHEN a.active=1 AND a.role='admin' THEN 1 ELSE 0 END AS assignee_available FROM requests r JOIN users u ON u.id=r.user_id JOIN sectors s ON s.id=r.sector_id LEFT JOIN users d ON d.id=r.decided_by LEFT JOIN users a ON a.id=r.assigned_to AND a.org_id=r.org_id WHERE r.org_id=? ${user.role === 'admin' ? '' : 'AND r.user_id=?'} ORDER BY r.id DESC`).all(...(user.role === 'admin' ? [user.org_id] : [user.org_id, user.id]));
        const history = user.role === 'admin' ? db.prepare('SELECT a.action,a.created_at,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.org_id=? ORDER BY a.id DESC LIMIT 50').all(user.org_id) : [];
        const today = brazilDay();
        return json(200, { user: safeUser(user), organization, sectors, users, requests: requests.map(request => ({ ...request, is_overdue: isRequestOverdue(request, today) })), history, notification_unread: unreadNotifications(user) });
      }
      if (req.method === 'GET' && path === '/api/requests/export.csv') {
        const status = url.searchParams.get('status') || '';
        const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase('pt-BR');
        const deadline = url.searchParams.get('deadline') || '';
        const assignment = url.searchParams.get('assignment') || '';
        const priority = url.searchParams.get('priority') || '';
        const sectorFilter = url.searchParams.get('sector_id') || '';
        const order = url.searchParams.get('order') || 'recent';
        if (!REQUEST_ORDERS.includes(order)) fail(400, 'Ordenação inválida.');
        if (priority && !['normal', 'alta', 'urgente'].includes(priority)) fail(400, 'Filtro de prioridade inválido.');
        if (sectorFilter && (!/^[1-9]\d*$/.test(sectorFilter) || !Number.isSafeInteger(Number(sectorFilter)))) fail(400, 'Filtro de setor inválido.');
        if (sectorFilter && !db.prepare('SELECT id FROM sectors WHERE id=? AND org_id=?').get(Number(sectorFilter), user.org_id)) fail(400, 'Filtro de setor inválido.');
        if (assignment && !['mine', 'unassigned'].includes(assignment)) fail(400, 'Filtro de responsável inválido.');
        if (assignment) admin(user);
        if (deadline && deadline !== 'overdue') fail(400, 'Filtro de prazo inválido.');
        const today = brazilDay();
        if (status && !['pendente', 'aprovada', 'recusada'].includes(status)) fail(400, 'Situação inválida.');
        if (query.length > 200) fail(400, 'A busca deve ter até 200 caracteres.');
        const params = [user.org_id];
        let conditions = 'r.org_id=?';
        if (user.role !== 'admin') { conditions += ' AND r.user_id=?'; params.push(user.id); }
        if (status) { conditions += ' AND r.status=?'; params.push(status); }
        if (priority) { conditions += ' AND r.priority=?'; params.push(priority); }
        if (sectorFilter) { conditions += ' AND r.sector_id=?'; params.push(Number(sectorFilter)); }
        const rows = db.prepare(`SELECT r.*,u.name AS author,s.name AS sector,d.name AS reviewer,a.name AS assignee_name,CASE WHEN a.active=1 AND a.role='admin' THEN 1 ELSE 0 END AS assignee_available FROM requests r JOIN users u ON u.id=r.user_id JOIN sectors s ON s.id=r.sector_id LEFT JOIN users d ON d.id=r.decided_by LEFT JOIN users a ON a.id=r.assigned_to AND a.org_id=r.org_id WHERE ${conditions} ORDER BY r.id DESC`).all(...params)
          .filter(r => `${r.title} COS-${String(r.id).padStart(5, '0')}`.toLocaleLowerCase('pt-BR').includes(query) && (!deadline || isRequestOverdue(r, today)) && (!assignment || (r.status === 'pendente' && (assignment === 'mine' ? r.assigned_to === user.id && r.assignee_available === 1 : !r.assigned_to || r.assignee_available !== 1))));
        const labels = { pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
        const header = ['Protocolo', 'Título', 'Solicitante', 'Setor', 'Situação', 'Prioridade', 'Descrição', 'Criada em (UTC)', 'Decidida em (UTC)', 'Responsável pela decisão', 'Parecer', 'Prazo (AAAA-MM-DD)', 'Responsável pela análise'];
        const csv = [header, ...orderRequests(rows, order).map(r => [`COS-${String(r.id).padStart(5, '0')}`, r.title, r.author, r.sector, labels[r.status], labels[r.priority], r.description, r.created_at, r.decided_at, r.reviewer, r.decision, r.due_date, r.assignee_name])]
          .map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="cosmos-solicitacoes.csv"',
          'Cache-Control': 'no-store',
        });
        return res.end('\uFEFF' + csv);
      }
      if (req.method === 'POST' && path === '/api/sectors/suggested') {
        admin(user); await readBody(req);
        const names = ['Jurídico', 'Compras e Licitações', 'Patrimônio e Almoxarifado'];
        const normalize = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
        const result = transaction(() => {
          admin(user);
          const sectors = db.prepare('SELECT id,name,active FROM sectors WHERE org_id=?').all(user.org_id);
          const created = []; const existing = [];
          for (const name of names) {
            const found = sectors.find(sector => normalize(sector.name) === normalize(name));
            if (found) { existing.push({ id: found.id, name: found.name, active: found.active }); continue; }
            const id = Number(db.prepare('INSERT INTO sectors(org_id,name,description) VALUES (?,?,?)').run(user.org_id, name, defaultSectorDescription(name)).lastInsertRowid);
            created.push({ id, name }); audit(user, `Setor criado: ${name}`);
          }
          return { created, existing };
        }); return json(result.created.length ? 201 : 200, result);
      }
      if (req.method === 'POST' && path === '/api/sectors') {
        admin(user); const body = await readBody(req); const name = field(body, 'name', 120);
        const description = sectorDescription(body, defaultSectorDescription(name));
        transaction(() => { if (db.prepare('SELECT id FROM sectors WHERE org_id=? AND name=?').get(user.org_id, name)) fail(409, 'Este setor já existe.'); db.prepare('INSERT INTO sectors(org_id,name,description) VALUES (?,?,?)').run(user.org_id, name, description); audit(user, `Setor criado: ${name}`); });
        return json(201, { ok: true });
      }
      const sectorMatch = /^\/api\/sectors\/(\d+)$/.exec(path);
      if (req.method === 'POST' && sectorMatch) {
        admin(user); const body = await readBody(req); const name = field(body, 'name', 120);
        if (typeof body.active !== 'boolean') fail(400, 'Informe se o setor está ativo.');
        transaction(() => {
          const target = db.prepare('SELECT * FROM sectors WHERE id=? AND org_id=?').get(Number(sectorMatch[1]), user.org_id);
          if (!target) fail(404, 'Setor não encontrado.');
          const description = sectorDescription(body, target.description);
          if (db.prepare('SELECT id FROM sectors WHERE org_id=? AND name=? AND id<>?').get(user.org_id, name, target.id)) fail(409, 'Este nome de setor já existe.');
          if (!body.active) {
            if (db.prepare('SELECT id FROM users WHERE org_id=? AND sector_id=? AND active=1 LIMIT 1').get(user.org_id, target.id)) fail(409, 'Transfira ou desative as pessoas ativas antes de desativar este setor.');
            if (db.prepare("SELECT id FROM requests WHERE org_id=? AND sector_id=? AND status='pendente' LIMIT 1").get(user.org_id, target.id)) fail(409, 'Avalie as solicitações pendentes antes de desativar este setor.');
          }
          db.prepare('UPDATE sectors SET name=?,active=?,description=? WHERE id=? AND org_id=?').run(name, body.active ? 1 : 0, description, target.id, user.org_id);
          const changes = [];
          if (target.name !== name) changes.push(`nome: ${target.name} → ${name}`);
          if (target.description !== description) changes.push('descrição atualizada');
          if (target.active !== Number(body.active)) changes.push(body.active ? 'reativado' : 'desativado');
          if (changes.length) audit(user, `Setor #${target.id} atualizado: ${changes.join('; ')}`);
        }); return json(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/users') {
        admin(user); const body = await readBody(req); const { email, password } = credentials(body); const name = field(body, 'name', 120);
        if (!['admin', 'colaborador'].includes(body.role)) fail(400, 'Perfil inválido.');
        const sec = sector(body.sector_id, user.org_id); const digest = await passwordHash(password);
        transaction(() => { admin(user); sector(sec, user.org_id); if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Este e-mail já está cadastrado.'); db.prepare('INSERT INTO users(org_id,sector_id,name,email,password,role) VALUES (?,?,?,?,?,?)').run(user.org_id, sec, name, email, digest, body.role); audit(user, `Usuário cadastrado: ${name}`); });
        return json(201, { ok: true });
      }
      const userMatch = /^\/api\/users\/(\d+)$/.exec(path);
      if (req.method === 'POST' && userMatch) {
        admin(user); const body = await readBody(req); const name = field(body, 'name', 120);
        if (!['admin', 'colaborador'].includes(body.role)) fail(400, 'Perfil inválido.');
        if (typeof body.active !== 'boolean') fail(400, 'Informe se o acesso está ativo.');
        const sec = body.sector_id;
        const targetId = Number(userMatch[1]);
        transaction(() => {
          admin(user);
          const target = db.prepare('SELECT * FROM users WHERE id=? AND org_id=?').get(targetId, user.org_id);
          if (!target) fail(404, 'Pessoa não encontrada.');
          sector(sec, user.org_id, !body.active && sec === target.sector_id);
          const reducingAccess = target.active === 1 && target.role === 'admin' && (!body.active || body.role !== 'admin');
          if (reducingAccess && db.prepare("SELECT COUNT(*) AS total FROM users WHERE org_id=? AND active=1 AND role='admin'").get(user.org_id).total <= 1) fail(409, 'A organização precisa manter um administrador ativo.');
          if (target.id === user.id && (!body.active || body.role !== 'admin')) fail(409, 'Outro administrador deve alterar seu perfil ou desativar seu acesso.');
          db.prepare('UPDATE users SET name=?,sector_id=?,role=?,active=? WHERE id=? AND org_id=?').run(name, sec, body.role, body.active ? 1 : 0, target.id, user.org_id);
          if (!body.active || target.role !== body.role) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
          const changes = [];
          if (target.name !== name) changes.push(`nome: ${target.name} → ${name}`);
          if (target.sector_id !== sec) changes.push(`setor: #${target.sector_id} → #${sec}`);
          if (target.role !== body.role) changes.push(`perfil: ${target.role} → ${body.role}`);
          if (target.active !== Number(body.active)) changes.push(body.active ? 'acesso reativado' : 'acesso desativado');
          if (changes.length) audit(user, `Pessoa #${target.id} atualizada: ${changes.join('; ')}`);
        }); return json(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/requests') {
        const body = await readBody(req); const title = field(body, 'title', 160); const description = field(body, 'description', 5000); const sec = sector(body.sector_id, user.org_id);
        if (!['normal', 'alta', 'urgente'].includes(body.priority)) fail(400, 'Prioridade inválida.');
        const id = transaction(() => { const id = Number(db.prepare('INSERT INTO requests(org_id,user_id,sector_id,title,description,priority) VALUES (?,?,?,?,?,?)').run(user.org_id, user.id, sec, title, description, body.priority).lastInsertRowid); audit(user, `Solicitação #${id} criada: ${title}`, id); return id; });
        return json(201, { id });
      }
      const assigneeMatch = /^\/api\/requests\/(\d+)\/assignee$/.exec(path);
      if (req.method === 'POST' && assigneeMatch) {
        admin(user); const body = await readBody(req); const assignedTo = body.assigned_to;
        const requestId = Number(assigneeMatch[1]);
        if (!Number.isSafeInteger(requestId) || requestId <= 0) fail(400, 'Solicitação inválida.');
        if (assignedTo !== null && (!Number.isSafeInteger(assignedTo) || assignedTo <= 0)) fail(400, 'Escolha um responsável válido ou null para remover.');
        transaction(() => {
          admin(user);
          const request = db.prepare('SELECT id,user_id,status,assigned_to FROM requests WHERE id=? AND org_id=?').get(requestId, user.org_id);
          if (!request) fail(404, 'Solicitação não encontrada.');
          if (request.status !== 'pendente') fail(409, 'Somente solicitações pendentes podem ter o responsável alterado.');
          let target = null;
          if (assignedTo !== null) {
            target = db.prepare("SELECT id,name FROM users WHERE id=? AND org_id=? AND active=1 AND role='admin'").get(assignedTo, user.org_id);
            if (!target) fail(400, 'Selecione um administrador ativo da organização.');
            if (target.id === request.user_id) fail(400, 'O solicitante não pode ser responsável pela análise do próprio pedido.');
          }
          if (request.assigned_to !== assignedTo) {
            db.prepare('UPDATE requests SET assigned_to=? WHERE id=? AND org_id=?').run(assignedTo, request.id, user.org_id);
            audit(user, `Responsável pela análise da solicitação #${request.id}: ${request.assigned_to ? '#' + request.assigned_to : 'não definido'} → ${target ? target.name + ' (#' + target.id + ')' : 'não definido'}`, request.id);
          }
        }); return json(200, { ok: true });
      }
      const deadlineMatch = /^\/api\/requests\/(\d+)\/deadline$/.exec(path);
      if (req.method === 'POST' && deadlineMatch) {
        admin(user); const body = await readBody(req); const deadline = validateDeadline(body.due_date);
        transaction(() => {
          const request = db.prepare('SELECT id,status,due_date FROM requests WHERE id=? AND org_id=?').get(Number(deadlineMatch[1]), user.org_id);
          if (!request) fail(404, 'Solicitação não encontrada.');
          if (request.status !== 'pendente') fail(409, 'Somente solicitações pendentes podem ter o prazo alterado.');
          if (request.due_date !== deadline) {
            db.prepare('UPDATE requests SET due_date=? WHERE id=? AND org_id=?').run(deadline, request.id, user.org_id);
            audit(user, `Prazo da solicitação #${request.id}: ${request.due_date || 'sem prazo'} → ${deadline || 'sem prazo'}`, request.id);
          }
        }); return json(200, { ok: true });
      }
      const printMatch = /^\/api\/requests\/(\d+)\/print$/.exec(path);
      if (req.method === 'GET' && printMatch) {
        const requestId = Number(printMatch[1]);
        if (!Number.isSafeInteger(requestId) || requestId <= 0) fail(400, 'Solicitação inválida.');
        const request = db.prepare(`SELECT r.*,u.name AS author,s.name AS sector,d.name AS reviewer,a.name AS assignee_name,CASE WHEN a.active=1 AND a.role='admin' THEN 1 ELSE 0 END AS assignee_available FROM requests r JOIN users u ON u.id=r.user_id JOIN sectors s ON s.id=r.sector_id LEFT JOIN users d ON d.id=r.decided_by LEFT JOIN users a ON a.id=r.assigned_to AND a.org_id=r.org_id WHERE r.id=? AND r.org_id=?`).get(requestId, user.org_id);
        if (!request || (user.role !== 'admin' && request.user_id !== user.id)) fail(404, 'Solicitação não encontrada.');
        const organization = db.prepare('SELECT name,type FROM organizations WHERE id=?').get(user.org_id);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(renderRequestPrint({ request, organization }));
      }
      const historyMatch = /^\/api\/requests\/(\d+)\/history$/.exec(path);
      if (req.method === 'GET' && historyMatch) {
        const requestId = Number(historyMatch[1]);
        if (!Number.isSafeInteger(requestId) || requestId <= 0) fail(400, 'Solicitação inválida.');
        const request = db.prepare('SELECT user_id FROM requests WHERE id=? AND org_id=?').get(requestId, user.org_id);
        if (!request || (user.role !== 'admin' && request.user_id !== user.id)) fail(404, 'Solicitação não encontrada.');
        const rawBefore = url.searchParams.get('before');
        if (rawBefore !== null && !/^[1-9]\d*$/.test(rawBefore)) fail(400, 'Cursor de movimentações inválido.');
        const before = rawBefore === null ? Number.MAX_SAFE_INTEGER : Number(rawBefore);
        if (!Number.isSafeInteger(before) || before <= 0) fail(400, 'Cursor de movimentações inválido.');
        const rows = db.prepare('SELECT a.id,a.action,a.created_at,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.org_id=? AND a.request_id=? AND a.id<? ORDER BY a.id DESC LIMIT 51').all(user.org_id, requestId, before);
        const history = rows.slice(0, 50);
        return json(200, { history, nextBefore: rows.length > 50 ? history.at(-1).id : null });
      }
      const commentMatch = /^\/api\/requests\/(\d+)\/comments$/.exec(path);
      if (commentMatch) {
        const requestId = Number(commentMatch[1]);
        const request = db.prepare('SELECT id,user_id FROM requests WHERE id=? AND org_id=?').get(requestId, user.org_id);
        // Não revela a existência de pedidos que o usuário não pode consultar.
        if (!request || (user.role !== 'admin' && request.user_id !== user.id)) fail(404, 'Solicitação não encontrada.');
        if (req.method === 'GET') {
          const rawBefore = url.searchParams.get('before');
          if (rawBefore !== null && !/^[1-9]\d*$/.test(rawBefore)) fail(400, 'Cursor de comentários inválido.');
          const before = rawBefore === null ? Number.MAX_SAFE_INTEGER : Number(rawBefore);
          if (!Number.isSafeInteger(before) || before <= 0) fail(400, 'Cursor de comentários inválido.');
          const rows = db.prepare('SELECT c.id,c.content,c.created_at,u.name AS author FROM request_comments c JOIN users u ON u.id=c.user_id WHERE c.request_id=? AND c.id<? ORDER BY c.id DESC LIMIT 51').all(requestId, before);
          const comments = rows.slice(0, 50).reverse();
          return json(200, { comments, nextBefore: rows.length > 50 ? comments[0].id : null });
        }
        const body = await readBody(req); const content = field(body, 'content', 2000);
        const id = transaction(() => {
          const result = db.prepare('INSERT INTO request_comments(request_id,user_id,content) VALUES (?,?,?)').run(requestId, user.id, content);
          audit(user, `Comentário adicionado à solicitação #${requestId}`, requestId);
          return Number(result.lastInsertRowid);
        }); return json(201, { id });
      }
      const match = /^\/api\/requests\/(\d+)\/decision$/.exec(path);
      if (req.method === 'POST' && match) {
        admin(user); const body = await readBody(req); const decision = field(body, 'decision', 2000);
        if (!['aprovada', 'recusada'].includes(body.status)) fail(400, 'Decisão inválida.');
        transaction(() => {
          const request = db.prepare('SELECT * FROM requests WHERE id=? AND org_id=?').get(Number(match[1]), user.org_id);
          if (!request) fail(404, 'Solicitação não encontrada.');
          if (request.user_id === user.id) fail(403, 'Outro administrador deve avaliar sua solicitação.');
          if (request.status !== 'pendente') fail(409, 'Esta solicitação já foi avaliada.');
          db.prepare("UPDATE requests SET status=?,decision=?,decided_by=?,decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?").run(body.status, decision, user.id, request.id, user.org_id);
          audit(user, `Solicitação #${request.id} ${body.status}: ${decision}`, request.id);
          const message = `Solicitação COS-${String(request.id).padStart(5, '0')} ${body.status === 'aprovada' ? 'aprovada' : 'recusada'}.`;
          db.prepare('INSERT INTO notifications(org_id,user_id,request_id,actor_id,message) VALUES (?,?,?,?,?)').run(user.org_id,request.user_id,request.id,user.id,message);
        }); return json(200, { ok: true });
      }
      fail(404, 'Recurso não encontrado.');
    } catch (error) {
      if (!error.status) console.error('Falha interna:', error.code || error.name);
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir a operação.' });
      else res.end();
    }
  });
  server.on('close', () => { clearInterval(janitor); db.close(); });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { port: { type: 'string' }, host: { type: 'string' }, strictPort: { type: 'boolean' } } });
  const portValue = values.port ?? process.env.PORT ?? '3000';
  if (!/^\d+$/.test(portValue) || Number(portValue) > 65535) throw new Error('A porta deve ser um número entre 0 e 65535.');
  const host = values.host ?? process.env.HOST ?? '0.0.0.0';
  if (!host.trim()) throw new Error('Informe um host válido.');
  const server = createApp();
  // O servidor sempre falha quando a porta está ocupada, inclusive com --strictPort.
  server.on('error', error => { console.error(`Não foi possível iniciar o COSMOS: ${error.code || error.name}`); process.exitCode = 1; server.close(); });
  server.listen(Number(portValue), host, () => console.log(`COSMOS disponível na porta ${server.address().port}`));
}
