# The management app's look: Classic and Board Book

[Knowledge base index](README.md) · [Using Family Hub](02-using-family-hub.md) · [Development and architecture](12-development-architecture.md)

**Status (November 6, 2026):** released in v1.4.0 behind a per-browser switch. **Classic** stays the default, and the household tries **Board Book** on their phones for one to two weeks, then keeps one look and deletes the other. The ambient photo-frame display, the server's permissions and Google behaviour are the same in both looks.

## Switching looks

- **Classic** (the original sage-and-serif app): choose **Look → Board Book** next to the Theme menu in the top bar. On a portrait phone, the Look and Theme pickers are at the top of the **More** menu (v1.5.2).
- **Board Book**: **Look** sits at the bottom of the left sidebar on a wide screen, and in the **More** menu on a phone.

## Menu order and Settings (v1.5.2 and v1.5.3)

- **Menu order** (Settings → You → Menu order, collapsible) is stored per account on the server, so each person can reorder the management menu. Board Book shows the first four on a phone; Classic shows as many as fit and puts the rest under More.
- In Classic, **Settings** uses the same card sections throughout: Your name, Menu order, Display and Advanced, each collapsible. `/settings#display` opens Display.

The choice is saved in that browser only (`localStorage` key `familyhub.look`), so each phone or computer can differ. The page reloads to swap looks. Clearing site data returns that browser to Classic.

## What Board Book changes

The thesis: the day drawn in flat primary shapes that a tired parent can read in one look.

| Area | Classic | Board Book |
| --- | --- | --- |
| Navigation | Top tab row; overflow in **More** | Cobalt sidebar on a wide screen; on a phone, a cobalt header and a bottom tab bar (Home, Calendar, then two shown modules, **More** for the rest, the theme, the look and sign out) |
| Home | Five cards in a grid | **Today** first: a large block for the next event (time, "in 25 min", title, who and where), a strip of dots for the rest of today (next is largest, tomorrow smallest), later rows, and **To-do / Note / Event** quick-add buttons. To-dos, chores to approve (parents), notes, daycare and school follow in each member's saved order |
| Event colours | Google's colours | Google's colours mapped to the nearest of four hues: cobalt, tomato, sunflower and grass (greys stay grey). Colour labels still use the original Google colour |
| Calendar colour labels | Always listed, with unlabelled colours shown as hex codes | Only named colours are listed, plus one prompt to name the rest, so Home can say who each event is for |
| To-dos | Completed items in a collapsed list | Items completed **today** stay in the list, struck through; older ones collapse under **Done earlier** (the server now passes Google's completion time) |
| Daycare on Home | Long email excerpts | Title, a one-line excerpt with decorative banner rows removed, and kind · time; tapping opens the full timeline |
| Chores to approve | Only on the Chores page | Also on Home for parents, with an **Approve** button, when there are chores waiting |
| Settings | One page with collapsible sections | Five groups: **You**, **Household**, **Display**, **Data** and **Advanced** (server administrator only). On a phone, a list you tap into; on a wide screen, a side list whose open tab joins its panel. Sections show open, as labelled rows. Links such as `/settings#display` still work |
| Type and colour | Instrument Sans and Fraunces, sage | Lexend throughout (self-hosted), white ground, ink text, cobalt shell, tabular figures. Light, dark and system themes |

Arrange Home, Google connection and Use as display are at the bottom of Home in Board Book (Classic keeps them in the header). Menu order (v1.5.2) applies to both looks; Classic's Settings sections are uniform cards (v1.5.3).

## How it was designed

The work used the Impeccable design skill on November 5–6, 2026:

1. **Product record.** [`PRODUCT.md`](../PRODUCT.md) was refreshed from the October prototype brief to v1.x and scoped to the management app (not the frame display). The owner confirmed: household first, self-hosters second; "calm, readable at a glance, touch-friendly" as the brand commitment, with colours and fonts left to the design.
2. **Direction.** Four fictional phone sketches of Home were compared on a decision page (Board Book, Timetable, Terminal Yellow and the category standard). The owner chose Board Book. The direction contract lives in `client/.impeccable/surfaces/client-src-familyhub-connectedhub-tsx.md`.
3. **Mockups first.** Static HTML mockups of Home and Settings (fictional data) were reviewed and approved before any app code changed. They are in `.impeccable/mocks/management/` on the development Mac.
4. **Build and review.** The approved mockups were built into the app. An independent design review returned eight fixes (flat Settings sections, the world's switches and checks in Modules, shorter daycare rows, no raw colour codes, world hues for events, keeping today's done to-dos visible, and removing old-look leftovers). All eight were applied and sent back for a verdict.
5. **Design system.** [`DESIGN.md`](../DESIGN.md) was written from the finished build (with `.impeccable/design.json` as its machine-readable sidecar). Three small drifts it found were fixed: member colours now map to the four hues, the switch knob lost its shadow, and the last small capitalised labels above headings are hidden.
6. **Trial switch.** At the owner's request, Classic was kept and made the default, with Board Book as an opt-in look per browser.

## Where the code lives

| Path | Purpose |
| --- | --- |
| [`DESIGN.md`](../DESIGN.md), `.impeccable/design.json` | Board Book's design system: palette, type, shapes, layout, components and rules. Read it before changing a Board Book screen. Classic is not governed by it |
| `client/src/familyhub/look.tsx` | The Look switch (`getLook`, `setLook`, `LookPicker`). Delete it at the end of the trial |
| `client/src/familyhub/FamilyHubNav.tsx` | `AppShell`: the Board Book shell, and the Classic shell when Classic is chosen |
| `client/src/familyhub/ConnectedHub.tsx`, `today.ts` (+ test) | Board Book Home and its date, colour and daycare-text helpers |
| `client/src/familyhub/SettingsGroups.tsx` | Board Book Settings groups; `pages/Settings.tsx` accepts `only` to render a subset of sections |
| `client/src/components/app/SettingsSection.tsx` | `FlatSettings` context: sections render open and flat inside Board Book groups |
| `client/src/familyhub/board.css` | Board Book styles, applied only while its shell is mounted (`body.bb-on`). They also map OpenFamily's Tailwind tokens so module pages match |
| `client/src/familyhub/ClassicConnectedHub.tsx`, `ClassicNav.tsx` | Classic Home and navigation, restored unchanged from `develop` |
| `client/public/fonts/Lexend-variable-*.woff2` | Lexend (SIL Open Font License), downloaded from Google Fonts on November 5, 2026 |
| `server/src/services/familyhub/google/adapters.ts` | Google Tasks now include `completedAt` |
| `client/src/i18n/locales/{en,fr}/settings.json` | Settings group names and help (`groups.*`) in English and French |

## Ending the trial

- **Keep Board Book:** delete `ClassicConnectedHub.tsx`, `ClassicNav.tsx` and `ThemePicker.tsx`, remove the Classic branch in `AppShell` and in `App.tsx` (Home and `/settings`), then delete `look.tsx` and the Look pickers.
- **Keep Classic:** delete `DESIGN.md` and `.impeccable/design.json` (they describe Board Book), `ConnectedHub.tsx` (then rename `ClassicConnectedHub.tsx` back), `SettingsGroups.tsx`, `board.css`, `today.ts`, the `FlatSettings` context, the Board Book branch in `AppShell`, and the Lexend files and `@font-face` in `client/src/index.css`. Keep the `completedAt` field; it is harmless.

Either way, write the decision in [project history](14-history-and-verification.md).

## Verification and gaps

- Client tests (21), the Google adapter test, the TypeScript checks and `npm run build` passed. The design detector found no issues in the new files.
- Both looks were checked in the signed-in local app at 390 px and 1440 px, in light and dark. Switching Classic → Board Book → Classic was confirmed.
- Local Google sources are not set up, so Home's calendar, to-dos and daycare were filled in the browser with a fictional snapshot for those checks. No code depends on it.
- **Not yet verified:** a real iPhone or iPad in Safari, live Google data in Board Book, French text lengths in the new layouts, and chores to approve with real pending chores.
- The shell and Home are in English only, like the rest of the Family Hub screens; the new Settings group labels have French translations.
