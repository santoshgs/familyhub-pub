import { describe, expect, it } from 'vitest';
import { parseBackupStatus } from '../../src/services/familyhub/adminCredentials';

// backup-status.json is written by the Pi's offsite-backup.sh into a shared
// folder; only known, bounded fields reach Settings.
describe('off-site backup status', () => {
    it('passes through a successful run', () => {
        expect(parseBackupStatus({ destination: 'Cloudflare R2', state: 'ok', message: 'Backed up', attemptedAt: '2026-11-08T08:30:00Z',
            lastSuccessAt: '2026-11-08T08:30:00Z', snapshot: 'abc', sizeBytes: 1234, snapshots: 3, extra: 'ignored' })).toEqual({
            destination: 'Cloudflare R2', state: 'ok', message: 'Backed up', attemptedAt: '2026-11-08T08:30:00Z',
            lastSuccessAt: '2026-11-08T08:30:00Z', sizeBytes: 1234, snapshots: 3 });
    });
    it('treats anything unexpected as failed or missing', () => {
        expect(parseBackupStatus(null)).toBeNull();
        expect(parseBackupStatus('nope')).toBeNull();
        const odd = parseBackupStatus({ state: 'weird', message: 'x'.repeat(500), lastSuccessAt: 'yesterday', sizeBytes: -1, snapshots: 'many' })!;
        expect(odd).toMatchObject({ state: 'failed', lastSuccessAt: null, sizeBytes: null, snapshots: null, destination: 'Off-site' });
        expect(odd.message).toHaveLength(300);
    });
});
