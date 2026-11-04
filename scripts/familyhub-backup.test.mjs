import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { localDatabaseTools, backupDatabase, restoreDatabase } from './familyhub-backup.mjs';

// Explicitly invoked integration test against two newly created fictional DBs.
test('backup round trip preserves fictional records, rejects tampering, and leaves source intact', () => {
    const { run } = localDatabaseTools();
    const source = `familyhub_restore_fixture_${randomBytes(6).toString('hex')}`;
    let target;
    run('createdb', ['--no-password', '--template=template0', source]);
    const query = (database, sql) => run('psql', ['--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--dbname', database, '--command', sql]).trim();
    try {
        query(source, "CREATE TABLE fictional_notes (id integer PRIMARY KEY, body text); INSERT INTO fictional_notes VALUES (1, 'Jamie: fictional picnic Saturday');");
        const dir = backupDatabase(source);
        assert.equal(statSync(dir).mode & 0o777, 0o700);
        const file = path.join(dir, 'database.dump');
        assert.equal(statSync(file).mode & 0o777, 0o600);
        target = restoreDatabase(dir);
        assert.notEqual(target, source);
        assert.equal(query(target, 'SELECT body FROM fictional_notes WHERE id=1'), 'Jamie: fictional picnic Saturday');
        assert.equal(query(source, 'SELECT count(*) FROM fictional_notes'), '1');
        const manifestPath = path.join(dir, 'manifest.json');
        const original = readFileSync(manifestPath, 'utf8');
        writeFileSync(manifestPath, original.replace(/"sha256": "[a-f0-9]+"/, '"sha256": "invalid"'));
        assert.throws(() => restoreDatabase(dir), /checksum/);
        writeFileSync(manifestPath, original);
        console.log('Fictional backup retained for inspection:', dir);
    } finally {
        // Exact, newly created fixture targets only. Never the running app DB.
        if (target) run('dropdb', ['--no-password', target]);
        run('dropdb', ['--no-password', source]);
    }
});
