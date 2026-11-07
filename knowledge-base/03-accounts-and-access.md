# Accounts and access

[Knowledge base index](README.md) · [Security and privacy](13-security-privacy.md) · [Troubleshooting](11-troubleshooting.md)

## Two separate accounts

Your **Family Hub account** signs you into the application and controls household membership. The **dedicated Google account** authorizes Calendar, Tasks and optional Gmail access. Changing the Family Hub login email does not change the Google account. Check the connected Google identity in Family Hub settings rather than assuming the current browser's Google session is correct.

Parents manage household settings, Google connections and protected changes. The **server administrator** additionally manages server credentials and software updates (Settings → Advanced; see [renewals](17-renewals-and-credentials.md)). Since v1.1 that is the account whose email is set as `FAMILYHUB_ADMIN_EMAIL` in the Pi's private environment, otherwise the first account ever created; a household's owner no longer gets this power just by owning a family. Switching a module off closes it on the server; unticking **Show** only hides it for you.

## Signing in

Family Hub signs in with email and password. Sign in with Google (single sign-on, added in v1.0) was removed in v1.4.2 at the owner's request: the household uses one shared Google account on every device, so it added nothing, and existing links were cleared. The Google connection that feeds the calendar, to-dos and daycare email is separate and unaffected. An account without a password gets one with `authAdmin set-password` on the server (see [troubleshooting](11-troubleshooting.md)).

## Joining, leaving and removal

Since v1.1, access ends with membership. When someone leaves a family or is removed, the shared calendar feed link is replaced and that account's push subscriptions are deleted. Joining a family by invitation or request ends the account's older sessions, so members who joined before v1.1.0 sign in again once. Members no longer see the owner's join-request notifications.

The app can remove a member from a family but cannot delete an account. To clear a leftover login (a review or test account, say), the server operator runs `remove-account.sh` on the Pi: a dry run reports what would go, an account that other accounts joined as their family is refused, the database is backed up first, and the address must be retyped to confirm. See [the admin helpers](../deploy/familyhub/admin/README.md).

## Displays and photo frames

A display never uses a person's password. Two ways to start one:

* **Pair a frame** — Settings → Display → Paired displays → **Create pairing code**, then enter the 8-digit code on the frame. Codes are single-use and last five minutes; failed attempts are rate limited.
* **Start protected display on this device** — turns the current browser into a display.

Each display gets a read-only token tied to its own session. The server allows it only the display's data, renews it whenever the display loads, and refuses it everywhere else. **Remove** in Paired displays signs out that display alone. On a display, a 2-second **Hold to exit** leaves display mode: a browser returns to sign-in, a frame returns to its pairing screen.

<img src="../docs/familyhub/images/hold-to-exit.png" alt="Hold to exit button while held" width="270">

## Change an existing password

For the deployed Docker installation, connect to the Pi over SSH and run the existing interactive recovery tool. Replace the example email with the **actual Family Hub login email**, not necessarily the Google account:

```sh
sudo docker exec -it familyhub-server-1 \
  node /app/server/dist/scripts/authAdmin.js set-password \
  --email 'person@example.com'
```

The tool displays the matching account and asks you to type its email to confirm. Enter the new password twice at the hidden prompts; it must be at least eight characters. Do not put the password in the command, terminal history, chat, an issue, or documentation. The tool replaces its password and revokes existing sessions, so the account must sign in again on each device.

The current Family Hub UI does not provide a general login-email change workflow. A direct database change was used once to correct the owner's existing account; it is an administrative operation, not a routine UI feature. Verify the target and uniqueness, back up first, preserve the account ID and household links, and arrange session revocation. Do not create a second account as a substitute without understanding its family ownership and permissions.

## SSH is a different login

The Pi's operating-system username and password are separate from Family Hub. The deployment SSH key is stored privately on the authorized Mac; a plain `ssh` command may not select it. See [Raspberry Pi deployment](07-raspberry-pi.md). A fresh OS installation generates a new SSH host identity. Verify its fingerprint using a trusted local Pi console before trusting it; do not disable host-key checking.

## Lost access

If the Family Hub password is forgotten, a server operator can use the interactive tool above. If the Pi account is inaccessible, do not guess or post passwords. Use a locally attached screen/keyboard and the Pi's documented recovery path. Keep the dedicated Google account recovery independent of both.
