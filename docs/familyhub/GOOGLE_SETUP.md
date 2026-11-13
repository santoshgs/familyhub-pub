# Connect the dedicated Google account

Calendar, Tasks, and daycare Gmail use one dedicated Family Hub Google account. OpenFamily login remains separate. The user has authorized this integration work; actual Google consent, account configuration, and live-data acceptance are still required. Do not describe a passing mock test or a configured client ID as a working live connection.

Use this guide locally on the development Mac first. No Raspberry Pi change is required. Never paste passwords, client secrets, encryption keys, authorization codes, or tokens into chat.

## 1. Prepare the dedicated account and calendar

1. Use the dedicated Family Hub Google account, not a primary personal Gmail account.
2. Share the existing family calendar with it. Because the approved dashboard can create events, grant **Make changes to events**. Permission to manage calendar sharing is unnecessary. Accept the sharing invitation in that account before connecting. [Calendar sharing permissions](https://support.google.com/calendar/answer/37082)
3. Create or choose a Google Tasks list in the dedicated account. Native Google Tasks access requires switching to that account, which the user has accepted.
4. Send Lillio notifications to this account. The daycare integration processes the exact sender `no-reply@himama.com`; meals, milk/feeding, naps, activities, and parent messages appear only when the email actually contains them.

## 2. Configure a Google Cloud project

In [Google Cloud Console](https://console.cloud.google.com/), create/select a project for this household app and enable **Google Calendar API**, **Google Tasks API**, and **Gmail API**. Enabling an API alone does not authorize access to an account.

Configure the Google Auth Platform branding/audience and developer contact details. For initial development with a consumer Google account, select the external audience and add the dedicated account as a test user while the project is in Testing. Keep production and experimental projects distinct where practical.

Create an OAuth client of type **Web application**. Add this exact authorized redirect URI for the local backend:

```text
http://127.0.0.1:53001/api/familyhub/google/callback
```

The scheme, hostname, port, path, and trailing-slash behavior must match `GOOGLE_REDIRECT_URI`. `localhost` and `127.0.0.1` are different redirect strings. This is a server authorization-code flow; do not put the client secret in a frontend `VITE_…` variable. [Google web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server)

The connection requests these scopes:

| Scope | Purpose |
| --- | --- |
| `openid` and `email` | Verify the selected Google subject and email against the configured dedicated account |
| `https://www.googleapis.com/auth/calendar.events` | Read and create events in the selected shared calendar |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | List calendars so the household can select its existing calendar |
| `https://www.googleapis.com/auth/tasks` | Read and mutate the selected account's tasks |
| `https://www.googleapis.com/auth/gmail.readonly` | Optional additional consent for daycare email bodies |

Calendar and Tasks permissions can cover more than the calendar/list selected inside Family Hub; the application limits its operations to the saved household selections. Gmail read permission covers the mailbox, not only one sender. The sender filter is an application processing limit, not a narrower Google OAuth permission. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Tasks scopes](https://developers.google.com/workspace/tasks/auth), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

## 3. Store server configuration locally

On this prepared Mac, `.familyhub-local/google.env` already contains a private template, the local callback URI, and a generated encryption key. Fill in its three blank fields (client ID, client secret, and dedicated account email) using a local editor. Preserve the generated key. For a fresh environment, create the file using the template below. The entire `.familyhub-local/` directory is ignored by Git. Supply these values locally:

```dotenv
GOOGLE_CLIENT_ID=replace-with-your-web-client-id
GOOGLE_CLIENT_SECRET=replace-locally-with-your-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:53001/api/familyhub/google/callback
FAMILYHUB_GOOGLE_EMAIL=dedicated-account@example.com
FAMILYHUB_TOKEN_KEY=replace-locally-with-a-base64-encoded-32-byte-key
```

Replace every placeholder; the expected email is configuration, not a password. The server refuses authorization for a different Google account and binds the connection to Google's verified subject and email.

If a key has not already been generated for this environment, generate it locally with:

```sh
openssl rand -base64 32
```

Copy the resulting value directly into the local env file. Generate it independently of `JWT_SECRET`; do not reuse the signing secret. Restrict local file access:

```sh
chmod 700 .familyhub-local
chmod 600 .familyhub-local/google.env
```

The local runner reads this file server-side through dotenv. Restart `npm run dev:familyhub:local` after configuration changes. For later Docker/production use, supply the same variables through server environment configuration (the Compose file forwards them), set `FAMILYHUB_APP_URL` to the frontend root, set `VITE_FAMILYHUB_LOCAL=true`, and rebuild the client; never bake them into the client image or source.

Back up the encryption key securely with protected database backups. Changing or losing it makes stored Google credentials unreadable; there is no automatic key-rotation migration. Disconnect/reconnect deliberately if a key must change. Keys, Google tokens, local database contents, and this env file do not belong in Git or an AGPL source archive.

## 4. Start the local application

Run from `~/FamilyHub`:

```sh
npm run dev:familyhub:local
```

Use the frontend URL printed by Vite (normally `http://127.0.0.1:5174`). The backend listens on `127.0.0.1:53001`. The isolated PostgreSQL cluster uses `127.0.0.1:55432`; its existing generated configuration is under ignored `.familyhub-local/`.

If the runner reports that the already-initialized local database is stopped, start that cluster explicitly:

```sh
"$(brew --prefix postgresql@16)/bin/pg_ctl" \
  -D "$PWD/.familyhub-local/postgres" \
  -l "$PWD/.familyhub-local/postgres.log" \
  -o "-h 127.0.0.1 -p 55432" start
```

Do not run `initdb` over an existing cluster. The local runner/configuration and test commands keep `familyhub_test` separate from development data. This loopback setup is for the Mac; an iPhone/iPad cannot use the Mac's `127.0.0.1`. LAN/HTTPS device access and a corresponding registered OAuth callback belong to the later deployment configuration.

## 5. Complete consent and choose data sources

1. Sign into Family Hub with an authorized OpenFamily parent account.
2. Open the Google connection section of Family Hub settings and choose the connect action. Finish the Google account selection/consent yourself, using the dedicated account specified by `FAMILYHUB_GOOGLE_EMAIL`.
3. After the callback, confirm the displayed connected email is correct. Select the shared calendar, task list, and household time zone (`America/New_York` unless the household chooses otherwise).
4. Use the separate Gmail/daycare consent action when ready. It adds optional Gmail read access to the same dedicated connection; it does not connect an unrelated mailbox.
5. Confirm visible data and freshness/error status before relying on the dashboard. A display session can read permitted dashboard data but cannot connect Google, change selections, or invoke calendar/task mutations.

The development agent can implement and test the flow using fictional inputs. It cannot grant your Google account consent or establish successful live authorization without your participation. Do not send callback URLs containing codes or tokens into chat.

## Testing mode, restricted Gmail access, and long-running use

For an external OAuth app in **Testing**, Google refresh tokens for these service scopes expire after seven days. Testing is suitable for development, but needs recurring reconnection and is unsuitable as an assumed permanent unattended setup. Switching publishing status is separate from completing Google's verification process. [Refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

**Still needed after Google sign-in was removed (v1.4.2).** Signing in to Family Hub is email and password only, but Calendar, Tasks (to-dos and shopping lists) and daycare Gmail are still read through this OAuth client with a stored refresh token. To stop the weekly expiry: Google Auth Platform → Audience → **Publish app** (In production), then reconnect once in Family Hub so a new refresh token is issued. Without verification Google shows an "unverified app" warning on the consent screen (continue only after recognising your own project) and caps the project at 100 users, which a household never reaches. [Manage app audience](https://support.google.com/cloud/answer/15549945)

`gmail.readonly` is a restricted scope. Google documents a personal-use verification exception for a sole user or a few users personally known to the developer. Check that the actual household project qualifies before long-running use; an unverified-app warning and user cap may still apply. If the app is made available more widely, verification and a security assessment for server-handled restricted data may be required. Self-hosting alone does not establish an exemption. [Verification exceptions and requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#exceptions)

Only continue through a Google consent warning after independently recognizing your own Cloud project, dedicated account, and requested scopes. No changes to browser certificate/security warnings are part of this guide.

## Live verification still required

- Confirm a wrong Google account is refused and the correct dedicated account connects.
- Read the selected calendar; create a clearly labeled disposable event and confirm it appears in Google Calendar in the expected time zone.
- Create/edit/complete/reopen a disposable task in Family Hub and verify it in native Google Tasks; make a native change and verify subsequent refresh in Family Hub.
- Check DST/all-day calendar behavior, reconnect after revoked/expired authorization, and distinguish stale cache from fresh data.
- Confirm the tablet token cannot perform protected writes or Google setup operations.
- Authorize Gmail, then inspect available representative Lillio emails locally. Verify sender filtering, activity/message extraction, duplicate handling, safe link-only fallback, and no attachment-fetch requests or retained photos.
- Keep children's email content out of external AI. Existing AI task proposals must use the same Google Tasks operations after user review; daycare email content is not automatically sent to that assistant.

Passing unit/integration tests with fixtures does not complete these checks. Real Lillio email formats, actual Google consent/refresh, physical iOS Safari, and Pi operation must be recorded separately in the roadmap.

Retain OpenFamily's AGPL notices and provide matching deployed Corresponding Source to network users when deploying the modified service. That source offer excludes secrets and household runtime records.
