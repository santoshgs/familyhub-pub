# Backup and restore

Family Hub keeps three kinds of data, and each is protected differently:

| Data | Where it lives | Protection |
| --- | --- | --- |
| Calendar events, Google Tasks to-dos and shopping lists | Google | Google is the source of truth; nothing to restore |
| Budget, notes, chores, rewards, family profiles, display settings, frame photos | PostgreSQL and the uploads volume on the Pi | **Nightly encrypted off-site backup to Cloudflare R2** (below), plus a local copy before every update |
| Keys that decrypt stored credentials (`JWT_SECRET`, `FAMILYHUB_TOKEN_KEY`) | `/opt/familyhub/private.env` on the Pi | Inside every off-site backup |

## Nightly off-site backup (Cloudflare R2)

Added in v1.6. Each night at about 03:23 the Pi runs
`/opt/familyhub/offsite-backup.sh`, which collects:

- `database.dump`, a consistent `pg_dump` of the whole database;
- `readable/*.csv`, with the budget (entries, recurring items, limits, groups,
  settle-up payments, sharing), notes, shopping and family profile tables as
  plain CSV that opens in any spreadsheet without Family Hub (account rows
  carry names and e-mails only, never password hashes);
- `uploads.tar.gz` (frame photos and avatars);
- `private.env` and the running release number;
- `SHA256SUMS` over all of the above.

[restic](https://restic.net) encrypts and deduplicates them before upload, so R2 only
ever holds ciphertext. It keeps 14 daily, 8 weekly and 12 monthly snapshots and,
on Sundays, downloads 5% of the stored data to prove it is readable. Settings →
Advanced → Server credentials shows the last successful backup; a failed run
sends an ntfy push (if `setup-ntfy.sh` was run), and the daily renewal check
warns when no backup has succeeded for two nights.

### Set it up (once)

1. In the Cloudflare dashboard, create an R2 bucket (for example
   `familyhub-backup`) and an R2 API token with **Object Read & Write** applied
   to **that bucket only**. Note the Account ID, Access Key ID and Secret Access
   Key.
2. Copy the updated `deploy/familyhub/admin/` folder to the Pi and run
   `sudo bash setup-offsite-backup.sh` from it. Answer the prompts.
3. **Store the encryption key it prints in your password manager**, together
   with the repository line and the R2 keys. The backups cannot be read without
   it, and the copy on the Pi is lost with the Pi.
4. Prove a restore works: `sudo /opt/familyhub/restore-offsite-backup.sh --drill`.
   It downloads the latest snapshot, checks the checksums, loads it into a
   throwaway PostgreSQL container with no network, prints row counts for the
   budget and notes tables, and deletes everything again. Repeat the drill now
   and then (for example after each minor release).

The token can write and delete objects in the bucket because restic prunes old
snapshots. Someone in control of the Pi could therefore delete the backups.
That is accepted for a household server. For protection against it, take an
occasional extra copy elsewhere (`restore-offsite-backup.sh --to` on the Mac).

### Recover on a new Pi

When the Pi or its SD card dies:

1. Prepare the new host as in `DEPLOYMENT.md` → "Preparing a new host" (OS,
   Docker, Tailscale), but do not start Family Hub yet.
2. Install restic and unpack the latest snapshot. Without
   `/etc/familyhub-backup.env`, the script asks for the repository, R2 keys and
   encryption key, and keeps them only for that run:
   `sudo bash restore-offsite-backup.sh --to /root/familyhub-restore`
3. Put `private.env` from the snapshot at `/opt/familyhub/private.env` (root,
   0600). Do not generate new keys: the old ones decrypt the stored Google and
   server credentials.
4. Install the release named in `release.json` with the updater, then stop the
   server container, restore the database and uploads, and start it again:

   ```sh
   docker compose -p familyhub exec -T postgres dropdb -U familyhub familyhub
   docker compose -p familyhub exec -T postgres createdb -U familyhub familyhub
   docker compose -p familyhub exec -T postgres pg_restore -U familyhub -d familyhub --no-owner < database.dump
   docker compose -p familyhub exec -T server tar -xzf - -C /app/uploads < uploads.tar.gz
   ```

5. Sign in and check the budget and notes. Google data reappears by itself.
   Re-pair the photo frame, then run `setup-offsite-backup.sh` again on the new
   Pi with the **same** key, so the nightly backups continue in the same repository.

If only the budget matters and no Pi is at hand, `readable/budget_*.csv` opens
directly in a spreadsheet.

## Before every update (on the Pi)

The hourly updater (`release.py`) also takes a database, uploads and env backup
before migrating, in `/opt/familyhub/state/pre-update-*`. It protects against a
bad update, not a dead Pi: it stays on the same SD card.

## Local backup and restore (Mac development stack)

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
