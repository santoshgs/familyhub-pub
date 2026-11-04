# Authenticated Family Hub on this Mac

The existing checkout has an isolated PostgreSQL 16 cluster under ignored
`.familyhub-local/`, with separate `familyhub_dev` and `familyhub_test` databases.
Its generated database credentials and JWT signing secret stay in private local
configuration. Do not share or commit that directory.

Start the authenticated dashboard from the repository root:

```sh
npm run dev:familyhub:local
```

The runner starts the existing cluster if needed. Open
`http://127.0.0.1:5174/`; Express listens on `127.0.0.1:53001`, and PostgreSQL on
`127.0.0.1:55432`. This is separate from `npm run dev:familyhub`, the fictional
browser-only prototype on port 5173. Sign up for your own OpenFamily household
account locally, or use an existing local account. Google authorization is a
separate connection made by a signed-in parent.

Without Google configuration, real calendar/task/daycare cards show disconnected
states. They never substitute fictional household records. Notes use the existing
OpenFamily database and authenticated author. The temporary fictional review
account used for QA is development data, not the dedicated Google account.

Follow [GOOGLE_SETUP.md](GOOGLE_SETUP.md) to configure the Cloud project and store
server-only configuration in ignored `.familyhub-local/google.env`. Restart the
runner after editing that file. Never paste credentials into chat.

## Develop branch preview at /develop

Patches and new features land on the `develop` branch before they are merged
into `familyhub/prototype` and released to the Pi. To try them on this Mac,
check out `develop` and run:

```sh
npm run dev:familyhub:develop
```

Then open `http://127.0.0.1:5174/develop/`. It is the same authenticated runner
and local database as `dev:familyhub:local`, served under the `/develop/` base
path. Run only one of the two at a time; they share ports 5174/53001. The
footer shows the checkout's version, e.g. `Family Hub v0.3.7-2-gabc1234` (two
commits after v0.3.7), so a preview is easy to tell apart from the Pi. The Pi,
the photo frame and production builds are unaffected: the base path stays `/`
unless `VITE_FAMILYHUB_BASE` is set.

Validation commands:

```sh
npm run test:familyhub:local
node scripts/familyhub-local.mjs test-all
npm run test:familyhub
node --test scripts/service-worker.test.mjs
npm run build:familyhub:local
```

The test runner explicitly selects `familyhub_test`. The suites reject database
names without the `_test` suffix before destructive fixture cleanup. Never point
tests at a household database.

Run the local command only once: it starts both the frontend and backend.
The runner checks ports 5174/53001 before starting and stops its full child
process group on exit. If it reports an occupied port, stop the earlier launch
before restarting; do not start another frontend/backend pair on different ports.

Stop the development servers with Ctrl+C. PostgreSQL is a separate process;
stopping it is optional after all local app/test processes have stopped:

```sh
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D "$PWD/.familyhub-local/postgres" stop
```

The native PostgreSQL runner defaults to the Homebrew Apple Silicon installation.
Set `FAMILYHUB_PG_CTL` for another installed `pg_ctl` path. A fresh clone does not
contain the private cluster/configuration; this runner is for the prepared Mac.
Fresh environments can use the existing Docker/PostgreSQL installation flow
instead. Set the non-secret build flag `VITE_FAMILYHUB_LOCAL=true` and rebuild the
client to select the authenticated Family Hub dashboard in Docker. Supply the
documented Google configuration to the server container, and register its actual
HTTPS callback. Docker/ARM64 and Pi deployment remain unverified.

Do not expose this loopback development setup to household devices with real
data. A later HTTPS deployment must verify device access, backups/restore,
service-worker updates, and physical Safari behavior.

Local database backup and isolated restore commands are available; follow
[BACKUP_RESTORE.md](BACKUP_RESTORE.md). The restore drill uses only newly created
fictional databases and does not switch the app's active database.
