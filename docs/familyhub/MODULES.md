# Family Hub modules and full calendar

Appearance: the navigation offers Light/Dark/System themes, saved on this browser.
System mode follows operating-system theme changes. Calendar's footer includes
colour swatches and parent-editable labels (e.g. “Blue: Alex”), stored per
household. Google colours do not imply person names; no names are inferred and
Google events are not changed by editing the legend.

Overview's **Arrange cards** editor uses up/down controls for touch and keyboard.
Desktop users can also drag card headings. Order is stored for the signed-in
member, and DOM reading/focus order follows the visual order. Other family members
retain their own layouts. Protected displays can read these preferences but
cannot change order or colour labels. Database backups retain all preferences;
portable upstream JSON exports currently do not include these new tables.

## Modules (v1.0)

Home, Calendar, the family display and Settings are always on. Everything else is
a module a parent can switch on or off in **Settings → Modules**. The choice is
household-wide, stored in `familyhub_module_preferences`, and defined once in
`server/src/lib/modules.ts` (mirrored by `client/src/familyhub/modules.ts`).

| Module | What it is | New households |
| --- | --- | --- |
| To-dos | Google Tasks | on |
| Chores | Local chores (the `tasks` table), shown on the display when due | on |
| Daycare, School | Gmail-based updates | on |
| Budget | Classic, analytics/limits and Kakeibo views | on |
| Pocket money | Points, parent approvals, balances and goals from reward chores | on |
| Notes | Notes from home, also on the display | on |
| AI assistant | Provider settings and proposed actions (parents) | on |
| Shopping | Shared shopping lists | off |
| Weekly routines | Recurring weekly schedule | off |
| Integrations | Home Assistant, Nextcloud, Immich | off |

Each module row in **Settings → Modules** has two checkboxes:

- **Enabled** (household, parents only): switching a module off hides it for
  everyone and closes it on the server.
- **Show** (just you): leaves the module out of your own menu and overview.
  A hidden module keeps working; it opens from its **Open** link in Settings or
  its address, and the family display is not affected. Stored per member in
  `familyhub_dashboard_preferences.hidden_modules`
  (migration `familyhub/0010-module-visibility`).

Switching a module off hides its links, redirects its page to Settings, and
**closes its API on the server** (403 `MODULE_DISABLED`). Its records are kept and
come back when it is switched on. Pocket money manages its reward chores on the
Chores page, so chores stay reachable while Pocket money is on. Completing a
Google to-do does not grant points.

v1.0 removed OpenFamily's Recipes, Meal planning, Family posts, the original
kiosk, the Mealie/Tandoor/Grocy integrations, the Support OpenFamily card, and
every interface language except English and French. Migration
`familyhub/0009-v1-remove-openfamily-modules` dropped their tables once; the Pi
updater's pre-update dump holds the last copy.

Calendar now has month, week agenda, and day agenda modes, previous/next, Today,
and refresh. The overview retains its seven-day summary and links to the full
calendar. Browsing fetches the selected shared Google calendar for the visible
range, without creating local appointments. It does not combine every calendar
in the account. All-day end dates remain exclusive, timed events are grouped in
the household timezone, and week start follows regional preferences. Colours
come from the existing Google adapter. Click a day to see its full agenda or an
event to open its details. Add-event still writes to Google. Event editing/deletion
remain outside the current calendar UI.

Range reads use the effective household's saved source and reject windows larger
than 62 days. Display sessions may read calendar ranges but cannot change events.
Results arriving after connection changes/disconnection are rejected. Calendar
responses are no-store and never persisted as local authoritative appointments.

Fictional visual checks used a month/week/day preview that injected fixtures into
the same calendar component, with no credentials or DB (it did not validate real
Google HTTP responses). That harness and its screenshots were removed on
November 4, 2026; see the note at the top of [QA.md](QA.md).
