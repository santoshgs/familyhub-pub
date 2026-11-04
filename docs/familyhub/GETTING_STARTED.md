# Review the Family Hub prototype

For the authenticated dashboard and Google integration, use
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) and [GOOGLE_SETUP.md](GOOGLE_SETUP.md).
The command below intentionally opens the separate fictional prototype.

## Local development

From the existing checkout at `~/FamilyHub`:

```sh
npm ci
npm run dev:familyhub
```

Open the localhost URL printed by Vite. The prototype uses fictional data and resets changes on reload. No database, Docker, Google credentials, or Pi access is needed for this browser-only milestone. The display toggle changes presentation; it is not a production authorization feature.

Check both build modes with:

```sh
npm run build
npm run build:familyhub
npm run test:familyhub
```

## Private GitHub repository

GitHub cannot make a native fork of public OpenFamily private. Instead, preserve the existing checkout/history and publish it as a new private repository, while keeping the `upstream` remote. Do not start a fresh repository inside this folder or clone another `FamilyHub` folder into it.

Choose **one** of these routes; do not both pre-create a repository and ask Desktop to publish a new repository with the same name.

### Route A — GitHub Desktop creates the repository

1. Sign in to GitHub Desktop as `santoshgs`.
2. Choose **File → Add Local Repository** and select `~/FamilyHub`.
3. Confirm the branch is `familyhub/prototype`. Review and commit the Family Hub changes when ready.
4. Choose **Publish repository**, name it `FamilyHub`, and keep **Keep this code private** checked. Publish to the `santoshgs` account.
5. Verify GitHub shows `santoshgs/FamilyHub` as **Private**. Confirm the original `upstream` remote remains.

### Route B — create an empty repository on GitHub first

1. Under `santoshgs`, create a repository named `FamilyHub` with visibility **Private**.
2. Leave README, `.gitignore`, and license initialization unchecked: those files/history already exist locally.
3. From the existing checkout, connect the new repository after confirming it exists and is private:

```sh
git remote add origin https://github.com/santoshgs/FamilyHub.git
git remote -v
```

4. Add the existing checkout to GitHub Desktop through **File → Add Local Repository**, review/commit changes, then use **Publish branch** / **Push origin**. Authentication stays in GitHub Desktop; do not paste tokens into chat.
5. Alternatively, after committing, push the current branch from a configured authenticated terminal:

```sh
git push -u origin familyhub/prototype
```

The expected remotes are `origin` → private `santoshgs/FamilyHub` and `upstream` → public `NexaFlowFrance/OpenFamily`. Never push Family Hub changes to `upstream`. Do not force-push to resolve an unexpected remote history.

## Review and device checks

Use the top navigation (or bottom navigation on a phone) for Overview, Calendar,
Tasks, and Notes. Quick add creates a task or note. Click events and assignments
for details; open “See the day” for the fictional daycare timeline. Prototype
settings let you hide cards, simulate loading/offline/empty states, and reset
all fixtures. All real integrations remain disconnected.

The default preview binds to `127.0.0.1` and is reachable only on this Mac. To
review fictional data on an iPhone/iPad on the same trusted Wi-Fi, run this
explicit command from the checkout:

```sh
VITE_FAMILYHUB=true VITE_DEMO=true VITE_DEMO_BASE=/ npm run dev --workspace=@openfamily/client -- --host 0.0.0.0
```

Use Vite's printed Network URL in Safari, allow the local firewall prompt if
appropriate, and stop the server with Ctrl+C afterwards. This exposes only the
fictional prototype on the local network; it is not the production deployment.

Review event details, adding/completing tasks, note create/edit/delete, and the daycare timeline. Check portrait/landscape iPad layouts and iPhone touch targets, keyboard behavior, scrolling, and safe-area spacing. In-app responsive checks passed; native Safari automation timed out, and physical iOS Safari has not been independently verified. See [QA.md](QA.md).

The Pi now runs production on Raspberry Pi OS Lite 64-bit (Debian 13), reimaged on October 30, 2026; see [DEPLOYMENT.md](DEPLOYMENT.md) and [RELEASES.md](RELEASES.md). This guide's prototype steps do not touch it.

## Source, secrets, and privacy

Retain OpenFamily's AGPL license and attribution. Offer the deployed modified version's Corresponding Source to its network users; a private repository does not remove that requirement. Keep credentials, `.env`, family records, email content, and database backups out of Git and source archives.
