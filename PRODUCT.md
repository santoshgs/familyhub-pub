# Family Hub product brief

Family Hub is a calm, attractive household dashboard built by customizing OpenFamily. Its primary job is to make the next appointment, outstanding tasks, recent family notes, and daycare updates understandable at a glance.

## Accepted prototype and active scope

The five-card fictional prototype was accepted October 29, 2026. It remains available independently of the authenticated local/live experience, with reload-resetting mock state. Phase 2 local notes/privacy/display work, Phase 3 Google connection/Calendar/Tasks, and daycare Gmail development are authorized. Real connection setup and live acceptance still require the user's Google consent and validation.

Use warm surfaces, restrained green accents, clear typography, consistent spacing, accessible contrast, and touch-friendly controls. Reuse OpenFamily's self-hosted fonts and UI primitives where sensible. Tablet layouts should show several useful cards together; phone layouts emphasize the next event and quick task/note actions. Expanded details use a consistent interaction pattern. The mock display toggle is presentational; authenticated tablet sessions require backend-enforced read-only scope.

Initial clients are Safari on iPhones and iPads. Validate representative phone, 8-inch tablet, 10-inch tablet, and desktop widths, including portrait and landscape where useful. Actual iOS Safari testing remains necessary even after desktop browser checks.

## Data ownership

| Feature | Authoritative source |
| --- | --- |
| Calendar | Existing shared Google Calendar |
| Tasks | Google Tasks owned by the dedicated Family Hub account |
| Family notes | OpenFamily PostgreSQL database |
| Daycare notifications | Lillio emails in the dedicated Gmail account |
| Parsed daycare records | Minimal disposable cache in OpenFamily PostgreSQL, keyed by Gmail message ID |
| Classroom | Google Classroom, subject to school/account permission |
| Authentication and family accounts | OpenFamily |
| Dashboard preferences | OpenFamily |

Switching to the dedicated account in Google's native Tasks app is acceptable to the user. No access to the primary personal Gmail account is requested. Google Tasks API scheduling is date-only; do not promise precise reminder-time parity.

## Hosting target

Raspberry Pi 4, 4 GB RAM. It was reimaged with Raspberry Pi OS Lite 64-bit (Debian 13) and runs production from `familyhub-v*` releases (see `docs/familyhub/RELEASES.md`). Develop independently of production data and services.

## Confirmed Google behavior — October 29, 2026

- Connect one dedicated family Google account for Calendar, Tasks and optional Gmail daycare access.
  Verify the authorized Google identity against the configured family account;
  never silently use another account selected in the browser. Bind the connection
  to Google's verified subject identifier and verified email at authorization.
- Calendar reads the selected existing shared Google Calendar and creates events
  in that same calendar. The family account must have permission to add events.
  This supersedes the original read-only-first Calendar requirement. Google is
  authoritative; local copies are disposable caches.
- To-Dos read and write Google Tasks in the same account. Both card controls and
  OpenFamily's existing AI assistant must use the same Google task operations.
  AI must not create a competing local task. Preserve existing proposal/review
  behavior before executing an AI-requested change.
- Daycare reads messages in that same account matching the exact sender
  `no-reply@himama.com`. Extract available activities (including milk/feeding)
  and parent messages/announcements, deduplicate by Gmail message ID, and display
  both update types. Do not invent fields missing from an email. Link-only emails
  become notification/link entries. Deterministic parsing is the starting point;
  no email/child data goes to external AI by default.
- Google service authorization is distinct from OpenFamily household login.
  Existing family permissions apply to every Google read/write, including AI.
  Display sessions never perform writes.

## Deferred

Classroom remains fictional until account/school access is feasible. Optional weather, Bitcoin, home automation, advanced layout personalization, and e-ink require separate prioritization. Persistent mock state is unnecessary. Real Google authorization is an outstanding setup/verification step for the authorized integration, not a claim of completion or an additional phase gate. See `docs/familyhub/GOOGLE_SETUP.md`.
