# Sign in with Google

Family Hub v1.0 can sign people in with their Google account (OpenID Connect).
It is off until the owner turns it on, and password sign-in keeps working until
the owner turns it off. The goal is Google-only sign-in once every household
account has linked Google.

The photo frame is not affected: it pairs with a one-time code and uses a
read-only display session, never a password or a Google account.

## 1. Authorize the redirect URI in Google Cloud

Reuse the OAuth client Family Hub already uses for Calendar and Tasks.

1. Google Cloud Console → **APIs & Services → Credentials** → open that OAuth 2.0 client.
2. Under **Authorized redirect URIs**, add
   `https://<your Family Hub host>/api/auth/oidc/callback`
   (keep the existing `/api/familyhub/google/callback` entry).
3. Save. No new scopes are needed: sign-in asks only for `openid email profile`.

If the consent screen is in **Testing**, add each family member as a test user.

## 2. Turn it on

On the Pi:

```sh
sudo bash deploy/familyhub/admin/google-signin.sh enable
```

Press Enter to reuse the Calendar/Tasks client, or paste another client's ID and
secret. The script writes the settings to `/opt/familyhub/private.env` (0600) and
restarts the running release. The sign-in page now shows **Continue with Google**.

## 3. Link each account

Each person signs in with their password once, then opens
**Settings → Sign-in → Link Google**. An account is matched to Google by its
Google identity, never by email address, so linking is always deliberate.

New accounts still need an invitation: a Google sign-in alone never creates one
(`OIDC_REGISTRATION_ENABLED=false`). An invited person can accept the invitation
with Google directly.

## 4. Go Google-only (later)

When every account shows "Your account is linked to Google":

```sh
sudo bash deploy/familyhub/admin/google-signin.sh google-only
```

The server refuses to turn passwords off unless Google sign-in is fully
configured, so it can never lock everyone out. To undo:
`sudo bash deploy/familyhub/admin/google-signin.sh passwords-on`.
`status` shows the current state; `disable` removes Google sign-in.

## Settings reference

| Setting | Meaning |
| --- | --- |
| `OIDC_ISSUER_URL` | `https://accounts.google.com`; empty = off |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The OAuth client (may equal `GOOGLE_CLIENT_ID`/`SECRET`) |
| `OIDC_PROVIDER_NAME` | Button label, default `Google` |
| `OIDC_REGISTRATION_ENABLED` | `false`: Google sign-in never creates an account without an invite |
| `PASSWORD_LOGIN_ENABLED` | `false` = Google only (ignored until Google sign-in is configured) |

The flow itself is OpenFamily's tested single sign-on: PKCE, a one-time handoff
code bound to the tab that started it, verified email required, and per-IP rate
limits (`server/src/routes/oidc.ts`).
