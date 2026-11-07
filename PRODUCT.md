# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Scope of this record

This record covers the **management interface**: the signed-in app family members
open on phones, iPads and the Mac over the household Tailscale network (Home,
Calendar, To-dos, Chores, Daycare, School, the optional modules, Display setup
and Settings). The read-only **ambient display** on the photo frame
(`client/src/familyhub/AmbientDisplay.tsx`, `ambient.css`) is out of scope for
design work driven by this record. Management screens that configure the display
(Display setup, Settings → Display, pairing) are in scope; the display itself is not.

## Users

- **Primary: our own household.** Parents manage the family's calendar, to-dos,
  chores, notes, daycare updates and the display, usually in short moments on a
  phone and sometimes at length on the Mac.
- **Roles:** parents manage household settings, Google connections, modules and
  protected changes. The **server administrator** (the `FAMILYHUB_ADMIN_EMAIL`
  account) also manages server credentials and software updates. Other members
  use what parents enable, and can hide modules from their own menu with **Show**.
- **Secondary: other families self-hosting from the public repo**
  (`santoshgs/familyhub-pub`). Their needs come second to our household's.

## Product Purpose

Make the household's next appointment, outstanding to-dos, chores, notes and
daycare updates understandable at a glance, and make changing them quick, from
the family's own self-hosted server rather than a hosted service. Success means
a parent can check or update the day in a few seconds on a phone, and can set up
the display, modules and credentials without opening a terminal.

## Positioning

A personal, self-hosted fork of OpenFamily (AGPL-3.0), and its own product since
v1.0. Google stays authoritative for the calendar and tasks while everything else
lives on a Raspberry Pi in the house. Management is reachable only over the
household's private Tailscale network.

## Operating Context

- Clients: Safari on iPhone and iPad, plus browsers on the Mac. Validate phone,
  8-inch and 10-inch tablet, and desktop widths, in portrait and landscape where
  useful. Real iOS Safari testing is still needed after desktop browser checks;
  do not claim physical iOS verification that has not happened.
- Navigation shows as many destinations as fit (Home, Calendar, To-dos, Chores,
  Daycare, School, then enabled modules) and moves the rest, in order, into **More**.
- Home is an overview of cards. **Arrange cards** reorders them with up/down
  controls for touch and keyboard, plus heading drag on desktop. Order is stored
  per member.
- The theme control offers Light, Dark and System, saved per browser.
- Hosting: a Raspberry Pi 4 (4 GB) running Raspberry Pi OS Lite 64-bit
  (Debian 13) from `familyhub-v*` releases, which updates itself hourly with a
  backup first. Development stays separate from production data, and
  development data is fictional.

## Capabilities and Constraints

### Data ownership

| Feature | Authoritative source |
| --- | --- |
| Calendar | One selected shared Google Calendar |
| To-dos | Google Tasks list owned by the dedicated Family Hub account |
| Notes | Family Hub (OpenFamily) PostgreSQL |
| Daycare notifications | Lillio/HiMama emails in the dedicated Gmail account |
| Parsed daycare records | Minimal disposable cache in PostgreSQL, keyed by Gmail message ID |
| Classroom/School | Google Classroom, subject to school/account permission |
| Accounts, family membership, preferences | Family Hub (OpenFamily) |

### Google behaviour (confirmed October 29, 2026)

- One dedicated family Google account backs Calendar, Tasks and optional Gmail.
  Verify the authorized identity against the configured family account, bind the
  connection to Google's verified subject and email, and never silently use
  another account selected in the browser.
- Calendar reads the selected shared calendar and creates events in it. Editing
  and deleting events are not offered. Google is authoritative and local copies
  are disposable caches.
- To-dos read and write Google Tasks in the same account. Card controls and the
  AI assistant use the same Google task operations. AI never creates a competing
  local task, and AI changes keep the proposal/review step before they run.
  Google Tasks scheduling is date-only, so never promise reminder-time parity.
- Daycare reads only mail from `no-reply@himama.com`, extracts activities
  (including milk/feeding) and parent messages, deduplicates by Gmail message ID,
  never invents missing fields, and turns link-only emails into link entries.
  Parsing is deterministic, and no email or child data goes to external AI by default.
- Google authorization is separate from Family Hub login. Family permissions apply
  to every Google read and write, including AI. Display sessions never write.

### Product facts

- Modules (Settings → Modules): To-dos, Chores, Pocket money, Daycare, School,
  Notes, Budget, AI assistant (on for new households); Shopping, Weekly routines,
  Integrations (off for new households). Home, Calendar, the display and Settings
  are always on. A disabled module is hidden and closed on the server
  (`403 MODULE_DISABLED`), and its data comes back when it is re-enabled.
- The interface ships in English and French; every new string needs both.
- Sign in with Google is optional, sits alongside passwords, and still requires
  an invitation. It has not yet been verified on the household Pi.
- Displays pair with single-use, 8-digit, 5-minute codes and get read-only,
  revocable sessions. Management never shares a person's password with a display.
- The UI is React 19, Vite, Tailwind 3 and Radix primitives, using OpenFamily's
  self-hosted fonts. Family Hub code lives in `client/src/familyhub/`.
- Deferred: real Classroom access, home automation beyond the Integrations
  module, advanced layout personalization, e-ink.

## Brand Commitments

- Name: **Family Hub** (written "FamilyHub" in the public README).
- Calm, readable at a glance and touch-friendly. Colours and fonts belong to the
  design system and theme picker, not to this record.
- Preserve OpenFamily's AGPL notices and credit.

## Evidence on Hand

- Screenshots with fictional data: `docs/familyhub/images/` (navigation on
  desktop and phone, settings, display setup, pairing, server credentials).
- Operating guide: `knowledge-base/`. Design notes: `docs/familyhub/`.
- No real household records, testimonials or usage metrics belong in the repo or
  in designs. Use fictional data everywhere.

## Product Principles

1. **Glance first, then act.** The next thing that matters is readable in seconds,
   and the common change (add a to-do, tick a chore, add a note) is one step away.
2. **Google stays the truth.** Never show a local copy as authoritative or promise
   behaviour the Google APIs do not provide.
3. **Private by construction.** Management lives on Tailscale, displays are
   read-only, and child and email data stays on the Pi.
4. **The household chooses.** Modules switch off cleanly for everyone and hide per
   person, and the interface adapts instead of showing dead ends.
5. **Our family first.** Optimise for how this household actually uses it, while
   keeping it workable for self-hosters.

## Accessibility & Inclusion

- Touch-friendly controls on phone and tablet. Every drag interaction has a
  keyboard and touch alternative (as Arrange cards does), and reading and focus
  order follow the visual order.
- Light, Dark and System themes must all hold accessible contrast.
- English and French parity, so layouts must tolerate longer French strings.
