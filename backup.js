import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));

export async function createBackup({ databasePath = process.env.DATABASE_PATH || join(root, 'data/cosmos.sqlite'), outputDirectory = join(root, 'backups') } = {}) {
  if (!databasePath || databasePath === ':memory:') throw new Error('Informe o caminho de um banco COSMOS persistente.');
  const sourcePath = resolve(databasePath);
  if (!statSync(sourcePath).isFile()) throw new Error('O caminho de origem deve apontar para um arquivo SQLite.');
  const source = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5000 });
  let temporaryDirectory;
  try {
    const tables = source.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name);
    if (!['organizations', 'users', 'sectors', 'requests', 'audit', 'sessions'].every(name => tables.includes(name))) throw new Error('A origem não contém as tabelas esperadas de um banco COSMOS.');
    const directory = resolve(outputDirectory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    temporaryDirectory = mkdtempSync(join(directory, '.cosmos-backup-'));
    chmodSync(temporaryDirectory, 0o700);
    const temporaryPath = join(temporaryDirectory, 'snapshot.sqlite');
    const pages = await backup(source, temporaryPath);
    // A cópia deve ser autônoma: nenhum WAL/SHM é necessário para restaurá-la.
    const copy = new DatabaseSync(temporaryPath);
    try {
      copy.exec('PRAGMA journal_mode=DELETE');
      const checks = copy.prepare('PRAGMA integrity_check').all();
      if (checks.length !== 1 || checks[0].integrity_check !== 'ok') throw new Error('A cópia não passou na verificação de integridade.');
      if (copy.prepare('PRAGMA foreign_key_check').all().length) throw new Error('A cópia contém vínculos inválidos entre registros.');
    } finally { copy.close(); }
    chmodSync(temporaryPath, 0o600);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(directory, `cosmos-${stamp}-${randomUUID()}.sqlite`);
    // Publicação exclusiva: uma cópia existente nunca é substituída.
    linkSync(temporaryPath, path);
    return { path, bytes: statSync(path).size, pages };
  } finally {
    source.close();
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { database: { type: 'string' }, 'output-dir': { type: 'string' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false });
    if (values.help) console.log('Uso: npm run backup -- [--database caminho.sqlite] [--output-dir pasta]\nPadrão: DATABASE_PATH ou data/cosmos.sqlite; saída em backups/. O arquivo .env não é carregado automaticamente.');
    else {
      const result = await createBackup({ databasePath: values.database, outputDirectory: values['output-dir'] });
      console.log(`Backup concluído e integridade verificada:\n${result.path}\n${result.bytes} bytes · ${result.pages} páginas`);
    }
  } catch (error) {
    const message = error.code === 'ENOENT' ? 'Banco de origem ou pasta não encontrado. Confira --database ou DATABASE_PATH.' : error.code === 'EACCES' ? 'Sem permissão para ler a origem ou gravar o backup.' : error.message;
    console.error(`Backup não concluído: ${message}`); process.exitCode = 1;
  }
}
