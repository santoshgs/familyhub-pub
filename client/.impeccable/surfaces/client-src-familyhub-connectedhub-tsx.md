---
version: 1
slug: "client-src-familyhub-connectedhub-tsx"
primary_target: "client/src/familyhub/ConnectedHub.tsx"
related_targets: ["client/src/pages/Settings.tsx"]
---

# Management app: Home and Settings

Mode: Operate. Platform: web (Safari on iPhone and iPad first, Mac second).

## Scope
The signed-in management interface: Home (ConnectedHub) and Settings, with the shell (navigation) they share. The ambient frame display is out of scope.

## Task
- Home on a phone answers "what's next today" and offers one-tap quick add (to-do, note, event). Daycare, chores and the rest sit below.
- Settings is grouped: You, Household, Display, Data, Advanced (server administrator only). A side list on desktop; a drill-in list on phone.
- Important states: Google disconnected, nothing left today, module switched off, display (read-only) session.

## Constraints
Product truth is in PRODUCT.md. Mockups come first and need the user's approval before any source change; the user approved .impeccable/mocks/management/home.html and settings.html on 2026-11-05 ("Build it"). All data is fictional.

## Direction contract
THESIS: The day drawn in flat primary shapes a tired parent reads in one look. It refuses the cozy cream-and-serif family-app card grid, and the grey SaaS dashboard.
OWN-WORLD: White ground and ink #1B1B1F. Cobalt #1F4FD8 owns the shell header; tomato #D4381F, sunflower #F7C21B and grass #2E9E4F are member colours and Settings group hues. Lexend in one family with tabular figures and no italics. Chunky radius 24 on blocks, pills on buttons, 2.5px ink outlines, no shadows.
STORY: Open the phone and know the next event, who it's for and when, then add a to-do in one tap. In Settings, find a setting by group without scrolling fifteen accordions.
FIRST VIEWPORT: Phone: cobalt header (date, greeting, avatar); a full-width block in the next event's member colour with the time at about 60px; a day strip of discs sized on a fixed ramp; later rows; three quick-add pills (To-do primary); a bottom tab bar (Home, Calendar, To-dos, Chores, More). Desktop: a left rail for navigation; the next block and day strip span the main column; to-dos and daycare sit in the right column.
FORM: Board Book (flat board-book graphics), 7th of 7 on the grounded list, assigned by the roll. Raises: a fixed size ramp for importance (star atlas); done items stay marked until midnight (ticket wallet); one hue per Settings group, with the open group extended (manual tabs); one type family (design annual); tabular figures (datamatics). seed:1f60b0f6952665d7
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
