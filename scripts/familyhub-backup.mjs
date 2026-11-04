// Local PostgreSQL backups. Restore always creates a separate database.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, chmodSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const local = path.join(root, '.familyhub-local');
const backups = path.join(local, 'backups');

export function localDatabaseTools() {
    const config = JSON.parse(readFileSync(path.join(local, 'config.json'), 'utf8'));
    const bin = process.env.FAMILYHUB_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin';
    const env = { ...process.env, PGHOST: config.POSTGRES_HOST || '127.0.0.1',
        PGPORT: String(config.POSTGRES_PORT || 55432), PGUSER: config.POSTGRES_USER,
        PGPASSWORD: config.POSTGRES_PASSWORD, PGCONNECT_TIMEOUT: '10' };
    if (!['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST)) throw new Error('This tool only supports the local Mac database.');
    function run(tool, args) {
        const result = spawnSync(path.join(bin, tool), args, { env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
        // Do not print raw PostgreSQL diagnostics: they may contain household data.
        if (result.error || result.status !== 0) throw new Error(`${tool} failed. Check that local PostgreSQL is running and the private configuration is valid.`);
        return result.stdout;
    }
    return { run, database: config.POSTGRES_DB || 'familyhub_dev' };
}

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const safeDatabase = (name, configured) => name === configured || name === 'familyhub_test' || /^familyhub_restore_[a-z0-9_]+$/.test(name);

export function backupDatabase(database) {
    const tools = localDatabaseTools();
    const source = database || tools.database;
    if (!safeDatabase(source, tools.database)) throw new Error('Database is outside the local Family Hub namespace.');
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    chmodSync(backups, 0o700);
    const dir = mkdtempSync(path.join(backups, `${new Date().toISOString().replace(/[:.]/g, '-')}-`));
    chmodSync(dir, 0o700);
    const file = path.join(dir, 'database.dump');
    tools.run('pg_dump', ['--no-password', '--format=custom', '--no-owner', '--no-acl', '--file', file, '--dbname', source]);
    chmodSync(file, 0o600);
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(),
        database: source, sha256: digest(file), format: 'postgres-custom' }, null, 2) + '\n', { mode: 0o600 });
    return dir;
}

export function restoreDatabase(directory) {
    const base = realpathSync(backups);
    const dir = realpathSync(path.resolve(directory));
    if (path.dirname(dir) !== base) throw new Error('Select a backup directory directly inside .familyhub-local/backups.');
    const file = path.join(dir, 'database.dump');
    if (path.dirname(realpathSync(file)) !== dir) throw new Error('Backup file must remain inside its backup directory.');
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (manifest.version !== 1 || manifest.format !== 'postgres-custom' || digest(file) !== manifest.sha256) {
        throw new Error('Backup checksum or format is invalid. No restore database was created.');
    }
    const target = `familyhub_restore_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const { run } = localDatabaseTools();
    run('createdb', ['--no-password', '--template=template0', target]);
    try {
        run('pg_restore', ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', target, file]);
    } catch {
        throw new Error(`Restore failed. The separate database ${target} was retained for inspection; the active database was not changed.`);
    }
    return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [mode, arg, ...extra] = process.argv.slice(2);
        if (extra.length || !['backup', 'restore'].includes(mode) || (mode === 'restore' && !arg)) {
            throw new Error('Use: node scripts/familyhub-backup.mjs backup [database] | restore <backup-directory>');
        }
        if (mode === 'backup') console.log(`Backup saved privately to ${backupDatabase(arg)}`);
        else console.log(`Restored into separate database ${restoreDatabase(arg)}. Active app configuration was not changed.`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
