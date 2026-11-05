import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, existsSync, readdirSync, copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';
import { createBackup } from '../backup.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../backup.js', import.meta.url));
const stop = app => new Promise(resolve => app.close(resolve));
function folder(t) { const path=mkdtempSync(join(tmpdir(),'cosmos-backup-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path; }
async function server(path) { const app=createApp({databasePath:path});app.listen(0,'127.0.0.1');await once(app,'listening');return {app,base:`http://127.0.0.1:${app.address().port}`}; }
async function call(base,path,body,cookie='') { const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}; }

test('backup com servidor aberto preserva WAL, restaura login e pedidos e não altera cópias anteriores', async t => {
  const dir=folder(t),source=join(dir,'source.sqlite'),output=join(dir,'cópias com espaço');
  const {app,base}=await server(source);let restored;
  t.after(async()=>{if(app.listening) await stop(app);if(restored?.app.listening)await stop(restored.app);});
  const password='Backup-seguro-2026';
  const admin=await call(base,'/api/register',{name:'Ana',organization:'Organização de teste',type:'publica',email:'backup@example.com',password});
  const sector=(await call(base,'/api/workspace',undefined,admin.cookie)).data.sectors[0].id;
  const request=await call(base,'/api/requests',{title:'Pedido com acentos 🌌',description:'Descrição para restauração',priority:'alta',sector_id:sector},admin.cookie);
  await call(base,`/api/requests/${request.data.id}/comments`,{content:'Mensagem preservada'},admin.cookie);
  const before=(await call(base,'/api/workspace',undefined,admin.cookie)).data;
  assert.ok(existsSync(source+'-wal'));assert.ok(statSync(source+'-wal').size>0);
  const first=await createBackup({databasePath:source,outputDirectory:output});
  assert.ok(first.pages>0);assert.ok(first.bytes>0);assert.equal(statSync(first.path).mode&0o777,0o600);
  assert.equal(statSync(output).mode&0o777,0o700);
  assert.deepEqual(readdirSync(output),[first.path.split('/').at(-1)]);
  assert.deepEqual((await call(base,'/api/workspace',undefined,admin.cookie)).data,before);
  const originalCopy=readFileSync(first.path);
  const restorePath=join(dir,'restauracao','cosmos.sqlite');
  // Copia somente o arquivo final: WAL/SHM da origem não são necessários.
  const {mkdirSync}=await import('node:fs');mkdirSync(dirname(restorePath));copyFileSync(first.path,restorePath);
  restored=await server(restorePath);
  const login=await call(restored.base,'/api/login',{email:'backup@example.com',password});assert.equal(login.status,200);
  const workspace=(await call(restored.base,'/api/workspace',undefined,login.cookie)).data;
  assert.deepEqual(workspace.requests,before.requests);assert.deepEqual(workspace.sectors,before.sectors);assert.deepEqual(workspace.users,before.users);assert.deepEqual(workspace.history,before.history);
  assert.equal((await call(restored.base,`/api/requests/${request.data.id}/comments`,undefined,login.cookie)).data.comments[0].content,'Mensagem preservada');
  await call(base,`/api/requests/${request.data.id}/comments`,{content:'Mensagem posterior'},admin.cookie);
  const second=await createBackup({databasePath:source,outputDirectory:output});assert.notEqual(second.path,first.path);
  assert.deepEqual(readFileSync(first.path),originalCopy);
  const copied=new DatabaseSync(second.path,{readOnly:true});assert.equal(copied.prepare('SELECT COUNT(*) AS n FROM request_comments').get().n,2);copied.close();
  assert.equal(readdirSync(output).length,2);
});

test('backup rejeita origem ausente, inválida ou sem tabelas COSMOS sem criar arquivos finais', async t => {
  const dir=folder(t),output=join(dir,'copies'),missing=join(dir,'missing.sqlite');
  await assert.rejects(createBackup({databasePath:missing,outputDirectory:output}));assert.equal(existsSync(missing),false);assert.equal(existsSync(output),false);
  await assert.rejects(createBackup({databasePath:':memory:',outputDirectory:output}),/persistente/);
  const bad=join(dir,'bad.sqlite');writeFileSync(bad,'isto não é SQLite');
  await assert.rejects(createBackup({databasePath:bad,outputDirectory:output}));assert.equal(existsSync(output),false);
  const empty=join(dir,'empty.sqlite');const db=new DatabaseSync(empty);db.close();
  await assert.rejects(createBackup({databasePath:empty,outputDirectory:output}),/tabelas esperadas/);assert.equal(existsSync(output),false);
});

test('backup com vínculos inválidos falha e remove a cópia temporária', async t => {
  const dir=folder(t),source=join(dir,'source.sqlite'),output=join(dir,'copies');
  const {app}=await server(source);await stop(app);
  const db=new DatabaseSync(source);db.exec("PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES ('token-invalido',999,9999999999999)");db.close();
  await assert.rejects(createBackup({databasePath:source,outputDirectory:output}),/vínculos inválidos/);
  assert.deepEqual(readdirSync(output),[]);
  const check=new DatabaseSync(source,{readOnly:true});assert.equal(check.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);check.close();
});

test('CLI de backup respeita opções e DATABASE_PATH e sinaliza falhas', async t => {
  const dir=folder(t),source=join(dir,'source.sqlite'),output=join(dir,'backups');
  const {app}=await server(source);await stop(app);
  const env={...process.env,DATABASE_PATH:source};
  const help=await run(process.execPath,[cli,'--help'],{env});assert.match(help.stdout,/Uso:/);assert.equal(existsSync(output),false);
  const first=await run(process.execPath,[cli,'--output-dir',output],{env});assert.match(first.stdout,/integridade verificada/);assert.equal(readdirSync(output).length,1);
  await run(process.execPath,[cli,'--database',source,'--output-dir',output],{env:{...env,DATABASE_PATH:join(dir,'missing.sqlite')}});assert.equal(readdirSync(output).length,2);
  await assert.rejects(run(process.execPath,[cli,'--database',join(dir,'missing.sqlite'),'--output-dir',output],{env}),error=>error.code===1&&/Backup não concluído/.test(error.stderr));
  await assert.rejects(run(process.execPath,[cli,'--opcao-inexistente'],{env}),error=>error.code===1);
  assert.equal(readdirSync(output).length,2);
});
