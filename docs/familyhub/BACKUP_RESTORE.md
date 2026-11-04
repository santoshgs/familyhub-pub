# Local backup and restore

This workflow is for the prepared Mac PostgreSQL installation. It does not deploy
to the Raspberry Pi. PostgreSQL must already be running. Run from the repository
root:

```sh
npm run backup:familyhub:local
```

The command saves a consistent custom-format PostgreSQL dump and SHA-256 manifest
inside a new `.familyhub-local/backups/<timestamp>-<random>/` directory. The
directory is private (0700), and files are owner-only (0600). This directory is
already excluded from Git and Docker build contexts. Backups contain household
records and encrypted credentials; they are **not encrypted backup archives**.
Keep any off-machine copy in encrypted storage, including the manifest.

Restore using the exact directory printed by the backup command:

```sh
npm run restore:familyhub:local -- /absolute/path/to/.familyhub-local/backups/<backup-directory>
```

The tool verifies the checksum before creating a database. It restores in one
transaction into a newly named `familyhub_restore_<timestamp>_<random>` database.
It never drops, overwrites, or switches the active application database. On failure,
the separate database remains for inspection. Only locally generated backups
directly inside this checkout's backup directory are accepted. Restore only trusted
backups: PostgreSQL archives can contain executable SQL.

Use PostgreSQL 16 binaries by default on this Mac. Set `FAMILYHUB_PG_BIN` to another
PostgreSQL binary directory if necessary; use the same or newer compatible tool
version for restore. Database credentials are read privately from
`.familyhub-local/config.json`, never passed as command-line arguments or printed.

## What recovery also requires

The database dump does not include local configuration, encryption keys, uploaded
files, source code, or Docker volumes. Preserve these separately in encrypted
storage before relying on backups:

- `.familyhub-local/config.json`, including `JWT_SECRET` (also used to encrypt
  existing AI provider credentials).
- `.familyhub-local/google.env`, especially `FAMILYHUB_TOKEN_KEY`, plus OAuth
  client configuration required to decrypt and use saved Google connections.
- Any files in `server/uploads/` used by upstream OpenFamily features.
- The matching application source/version and deployment configuration.

Do not regenerate keys during recovery and expect old credentials to decrypt.
Google Calendar and Tasks stay authoritative; restored local snapshots may be
stale. A database restore does not undo any Google writes or reinstate revoked
Google access.

Inspect the separate restored database before deciding to switch the application.
Avoid starting a second application with restored Google credentials, since its
background synchronization could contact the real provider. Cutover, account
reconnection, off-machine encrypted backup verification, and production recovery
remain separate deployment steps.

## Verified local drill

```sh
npm run test:familyhub:backup
```

The drill creates a temporary database containing one fictional note, backs it
up, restores it into a second database, verifies the record and source database,
and verifies that a tampered checksum is rejected. It removes only those two newly
created test databases afterward. The small fictional backup is retained privately
for inspection. This does not back up or alter the active household database, and
does not establish full production disaster recovery.
