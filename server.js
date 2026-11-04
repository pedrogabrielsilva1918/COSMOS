import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = dirname(fileURLToPath(import.meta.url));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const safeUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, sector_id: user.sector_id });
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
async function readBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Envie JSON.');
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 24000) fail(413, 'Conteúdo muito grande.');
  }
  try { const body = JSON.parse(data); if (!body || Array.isArray(body) || typeof body !== 'object') throw Error(); return body; }
  catch { fail(400, 'JSON inválido.'); }
}

export function createApp({ databasePath = process.env.DATABASE_PATH || join(root, 'data/cosmos.sqlite'), secure = process.env.COOKIE_SECURE === 'true' } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS organizations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('publica','privada')));
    CREATE TABLE IF NOT EXISTS sectors(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, UNIQUE(org_id,name));
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), sector_id INTEGER REFERENCES sectors(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','colaborador')));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), user_id INTEGER NOT NULL REFERENCES users(id), sector_id INTEGER NOT NULL REFERENCES sectors(id), title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('normal','alta','urgente')), status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aprovada','recusada')), decision TEXT, decided_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), decided_at TEXT);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id), actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE INDEX IF NOT EXISTS requests_org ON requests(org_id,user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
  const rate = new Map();
  const janitor = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rate) if (entry.until < now) rate.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
  }, 60000); janitor.unref();
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  function audit(user, action) { db.prepare('INSERT INTO audit(org_id,actor_id,action) VALUES (?,?,?)').run(user.org_id, user.id, action); }
  function admin(user) { if (user.role !== 'admin') fail(403, 'Acesso restrito ao administrador.'); }
  function sector(id, org) {
    if (!Number.isSafeInteger(id) || !db.prepare('SELECT id FROM sectors WHERE id=? AND org_id=?').get(id, org)) fail(400, 'Selecione um setor da organização.');
    return id;
  }
  function issueSession(res, user) {
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
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET') fail(405, 'Método não permitido.');
        const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
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
        const key = `${req.socket.remoteAddress}:${['/api/login', '/api/register', '/api/account/password'].includes(path) ? 'auth' : 'write'}`;
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
          const sec = Number(db.prepare('INSERT INTO sectors(org_id,name) VALUES (?,?)').run(org, 'Administração').lastInsertRowid);
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
        if (!user || !matches) fail(401, 'E-mail ou senha incorretos.');
        issueSession(res, user); return json(200, safeUser(user));
      }
      const token = /(?:^|;\s*)cosmos=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const user = token && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token), Date.now());
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
      if (req.method === 'GET' && path === '/api/workspace') {
        const organization = db.prepare('SELECT * FROM organizations WHERE id=?').get(user.org_id);
        const sectors = db.prepare('SELECT id,name FROM sectors WHERE org_id=? ORDER BY name').all(user.org_id);
        const users = user.role === 'admin' ? db.prepare('SELECT u.id,u.name,u.email,u.role,s.name AS sector FROM users u LEFT JOIN sectors s ON s.id=u.sector_id WHERE u.org_id=? ORDER BY u.name').all(user.org_id) : [];
        const requests = db.prepare(`SELECT r.*,u.name AS author,s.name AS sector,d.name AS reviewer FROM requests r JOIN users u ON u.id=r.user_id JOIN sectors s ON s.id=r.sector_id LEFT JOIN users d ON d.id=r.decided_by WHERE r.org_id=? ${user.role === 'admin' ? '' : 'AND r.user_id=?'} ORDER BY r.id DESC`).all(...(user.role === 'admin' ? [user.org_id] : [user.org_id, user.id]));
        const history = user.role === 'admin' ? db.prepare('SELECT a.action,a.created_at,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.org_id=? ORDER BY a.id DESC LIMIT 50').all(user.org_id) : [];
        return json(200, { user: safeUser(user), organization, sectors, users, requests, history });
      }
      if (req.method === 'POST' && path === '/api/sectors') {
        admin(user); const body = await readBody(req); const name = field(body, 'name', 120);
        transaction(() => { if (db.prepare('SELECT id FROM sectors WHERE org_id=? AND name=?').get(user.org_id, name)) fail(409, 'Este setor já existe.'); db.prepare('INSERT INTO sectors(org_id,name) VALUES (?,?)').run(user.org_id, name); audit(user, `Setor criado: ${name}`); });
        return json(201, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/users') {
        admin(user); const body = await readBody(req); const { email, password } = credentials(body); const name = field(body, 'name', 120);
        if (!['admin', 'colaborador'].includes(body.role)) fail(400, 'Perfil inválido.');
        const sec = sector(body.sector_id, user.org_id); const digest = await passwordHash(password);
        transaction(() => { if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Este e-mail já está cadastrado.'); db.prepare('INSERT INTO users(org_id,sector_id,name,email,password,role) VALUES (?,?,?,?,?,?)').run(user.org_id, sec, name, email, digest, body.role); audit(user, `Usuário cadastrado: ${name}`); });
        return json(201, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/requests') {
        const body = await readBody(req); const title = field(body, 'title', 160); const description = field(body, 'description', 5000); const sec = sector(body.sector_id, user.org_id);
        if (!['normal', 'alta', 'urgente'].includes(body.priority)) fail(400, 'Prioridade inválida.');
        const id = transaction(() => { const id = Number(db.prepare('INSERT INTO requests(org_id,user_id,sector_id,title,description,priority) VALUES (?,?,?,?,?,?)').run(user.org_id, user.id, sec, title, description, body.priority).lastInsertRowid); audit(user, `Solicitação #${id} criada: ${title}`); return id; });
        return json(201, { id });
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
          audit(user, `Solicitação #${request.id} ${body.status}: ${decision}`);
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
  const server = createApp(); const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`COSMOS disponível na porta ${port}`));
}
