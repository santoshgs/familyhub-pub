# Backup and recovery

[Knowledge base index](README.md) · [Releases](09-releases-updates.md) · [Privacy](13-security-privacy.md)

An application image or Git repository is not a household backup. Recovery requires the database, uploads, the matching deployment configuration and keys, and a usable version of the application. Google Calendar and Tasks remain authoritative for their own data; restoring a Family Hub backup cannot undo remote Google changes.

## What to preserve

| Item | Why it matters |
| --- | --- |
| PostgreSQL database dump | Accounts, notes, preferences, cached integration state, budget/reward data and other app records |
| Uploads | Files used by applicable OpenFamily modules |
| `/opt/familyhub/private.env` | Deployment settings, database password, JWT secret and Google token-encryption key |
| Release package, image digests and matching source | Restore the appropriate application version and comply with source obligations |
| GitHub/Tailscale recovery plan | Access to images, releases and the private network after replacement |

Never regenerate `JWT_SECRET` or `FAMILYHUB_TOKEN_KEY` casually when restoring existing data. They are needed for existing encrypted credentials and sessions; changing a key can require deliberate reconnection or recovery. Store off-device copies on encrypted media with restricted access. The updater's local backup archives have private filesystem permissions but are **not encrypted archives**.

## What has been verified

At cutover, the Mac backend was stopped, a fresh PostgreSQL dump was made, and its checksum was matched after transfer to the Pi before restoring it. On the Pi, the release tool later created a fresh backup. Its database dump was restored into a separate temporary database; selected account, note and Google-connection counts matched the live database, and the temporary database was removed. The uploads archive was checked for readability.

That test did not recreate the Pi on new hardware, test every record or Google token, prove an encrypted off-device copy can be restored, or validate a full two-version rollback. A copy kept only on the Pi does not protect against loss of the Pi or card.

## Safe recovery principles

1. Stop automatic update checks during an incident and identify the exact failure. Do not overwrite the only backup.
2. Verify which release, database backup, uploads archive and configuration belong together. Preserve their checksums and encryption keys.
3. Restore a trusted database archive into a **new isolated database** first and inspect it. PostgreSQL archives may contain executable SQL; do not restore untrusted archives.
4. Test the matching application and uploads in isolation. Prevent a test instance from synchronizing or writing to real Google accounts.
5. Plan the cutover so only one active instance performs household Google synchronization. A restore or app rollback cannot reverse changes already made at Google.
6. Only after verification, use a deliberate replacement plan. Never run destructive database cleanup or reinitialize a cluster against the live database.

The local Mac-specific commands and an isolated restore workflow are documented in [BACKUP_RESTORE.md](../docs/familyhub/BACKUP_RESTORE.md). That tool uses the prepared Mac PostgreSQL cluster; it is not a generic Pi restore command. The Pi updater's backup behavior is documented in [releases](09-releases-updates.md). Off-machine encrypted backup and a full disaster-recovery drill remain recommended work.
