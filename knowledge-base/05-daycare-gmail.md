# Daycare updates from Gmail

[Knowledge base index](README.md) · [Google Calendar and Tasks](04-google-calendar-tasks.md) · [Privacy](13-security-privacy.md)

Daycare updates use optional Gmail access on the **same dedicated family Google connection** used for Calendar and Tasks. Family Hub searches for messages associated with `no-reply@himama.com`, verifies sender headers, and parses the available text. The integration is intended to show activities such as milk/feeding or naps and messages sent to parents, but it cannot display information that is absent from an email.

## How it works

1. A parent grants the optional Gmail permission through Google connection settings. Calendar/Tasks consent by itself is not proof that Gmail access was granted.
2. The server fetches and parses eligible messages, normalizes supported activities and parent messages, and deduplicates using Gmail message IDs.
3. The dashboard displays available information, a freshness/error state, and a link-only fallback if the email contains a provider notification without usable details.

The parser is deterministic; it does not invent missing details. Email content is treated as untrusted text. Attachments and photos are not needed for this workflow and daycare content is not automatically sent to an external AI provider. Parsed snapshots are disposable, not a replacement for Gmail. Daycare snapshots have a roughly five-minute freshness window.

## Privacy and permissions

The optional `gmail.readonly` scope can read the mailbox, not just one sender. The sender check limits Family Hub's processing; it does not narrow Google's permission grant. Google treats this as a restricted scope. Check the applicable personal-use exceptions, consent status and verification requirements for the actual Cloud project before extending access; see [Google's restricted-scope guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

## What has been tested

Fictional mixed-inbox simulations exercised the actual adapter, MIME parser and dashboard presentation: feeding, nap, parent message, link-only fallback, duplicate suppression and wrong-sender exclusion. These simulations did not prove compatibility with real daycare messages, Google HTTP behavior, or every Lillio template.

For live acceptance, after consent verify representative emails on the device without sharing children's messages or screenshots. Compare the activity and parent-message categories, check duplicates and link-only entries, and confirm the freshness/error state. If no updates appear, confirm the destination mailbox, actual sender, Gmail permission and whether the message contains details. See [troubleshooting](11-troubleshooting.md).
