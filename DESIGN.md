---
name: Family Hub
description: Board Book, the management app's world. The day drawn in flat primary shapes a tired parent reads in one look.
colors:
  cobalt: "#1F4FD8"
  cobalt-deep: "#173DA8"
  cobalt-pressed: "#12318A"
  cobalt-tint: "#DCE5FF"
  tomato: "#D4381F"
  sunflower: "#F7C21B"
  sun-ink: "#3D3000"
  grass: "#2E9E4F"
  grass-ink: "#1D6B35"
  ink: "#1B1B1F"
  paper: "#FFFFFF"
  wash: "#F4F5F8"
  line: "#E4E5EA"
  line-strong: "#C9CAD2"
  soft: "#5A5A66"
  dark-ink: "#F2F2F5"
  dark-paper: "#121317"
  dark-wash: "#1D1E24"
  dark-line: "#2D2E37"
  dark-soft: "#A9AAB5"
  dark-cobalt: "#2B5BE6"
  dark-grass-ink: "#6FD08F"
  dark-focus: "#8FB0FF"
typography:
  display:
    fontFamily: "Lexend, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "84px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Lexend, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Lexend, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Lexend, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    letterSpacing: "0"
    fontFeature: "tnum"
  body-small:
    fontFamily: "Lexend, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    letterSpacing: "0"
  label:
    fontFamily: "Lexend, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0"
rounded:
  block: "24px"
  section: "20px"
  soft: "16px"
  field: "14px"
  tile: "12px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  gutter: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body-small}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.wash}"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "38px"
  text-button:
    textColor: "{colors.cobalt}"
    height: "44px"
  next-event:
    backgroundColor: "{colors.sunflower}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "18px 20px 20px"
  when-pill:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sunflower}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  note:
    backgroundColor: "{colors.sunflower}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "16px 20px"
  quiet-block:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "16px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
  shell-header:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.paper}"
    padding: "18px 20px 20px"
  rail-item:
    textColor: "{colors.cobalt-tint}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "44px"
  rail-item-current:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.cobalt}"
  tab-bar-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    height: "52px"
  tab-bar-item-current:
    textColor: "{colors.cobalt}"
  round-check:
    rounded: "{rounded.pill}"
    size: "26px"
  round-check-done:
    backgroundColor: "{colors.grass}"
    textColor: "{colors.paper}"
---

# Design System: Family Hub

## Overview

**Creative North Star: "Board Book"**

The management app is drawn like a children's board book: a white page, black ink, and a few big flat shapes in four primary hues. Each shape carries one fact (the next event, whose it is, when), sized so a tired parent reads it in one look on a phone. Colour is information, not decoration: a block is in a hue because the event or member is.

Density is low and the hierarchy is steep. One huge time figure, then a size-ramped strip of discs, then plain ruled rows. Everything is flat; depth comes from fills against white and hairline rules, never from shadow. The world rejects the cozy cream-and-serif family-app card grid and the grey SaaS dashboard.

Board Book applies only while its shell is mounted (`body.bb-on` on `.fh-scope`, which also covers portalled dialogs). It remaps OpenFamily's Tailwind tokens inside the shell so inherited pages (Settings sections, Budget, Chores) speak the same palette. Board Book is on trial behind a per-browser Look switch; the original Classic look (the default during the trial) is not governed by this file, nor are the ambient photo-frame display and the fictional prototype.

**Key Characteristics:**
- White ground, ink text, cobalt shell; tomato, sunflower and grass as member and group hues.
- One family, Lexend, with tabular figures and no italics.
- Chunky 24px blocks, pill controls, 2.5px ink outlines on controls, 1.5px hairline rules everywhere else.
- No shadows. Depth is fill against white.
- Size carries order: 84/60px time, then a 40/26/14 disc ramp.

## Colors

Four flat primaries on white and ink, with greys only for rules, washes and secondary text.

### Primary
- **Shell Cobalt** (cobalt): owns the shell, the phone header and the desktop rail, plus links, text buttons, current tab and the focus ring. Deep Cobalt (cobalt-deep) is the hover fill on cobalt; Cobalt Tint (cobalt-tint) is secondary text on cobalt.

### Secondary
- **Tomato** (tomato): a member and event hue and the Household settings group. Deepened from a brighter red so white text on it passes contrast; it also stands in as the destructive/danger colour inside the shell.
- **Sunflower** (sunflower): a member and event hue, the default note and next-event fill, the Display settings group, the brand tile and text selection. Always takes ink text; Sun Ink (sun-ink) is its soft secondary text.
- **Grass** (grass): a member and event hue, the Data settings group, completed checks and switches. Takes ink text when filled; Grass Ink (grass-ink) is green text on white ("Done today").

### Neutral
- **Ink** (ink): all text, primary-button fill, control outlines, the Advanced group hue, the "when" pill.
- **Paper** (paper): the page ground and every surface.
- **Wash** (wash): quiet blocks (empty states, daycare, the account card), secondary hover.
- **Line** (line): 1.5px rules between rows, card borders, the strip track, field borders. Line Strong (line-strong) is the stronger Tailwind border.
- **Soft** (soft): secondary text, inactive tabs, labels; also the neutral disc for grey calendar colours.

### Dark
The dark set swaps ink and paper (dark-ink on dark-paper), raises cobalt slightly (dark-cobalt), and turns blue text and the focus ring to dark-focus. Tomato, sunflower and grass do not change.

### Named Rules
**The Four Hues Rule.** Event colours are mapped onto the four world hues (cobalt, tomato, sunflower, grass) by hue angle; greys stay Soft. No fifth hue appears in a block or disc.

**The Ink-Or-White Rule.** Text on any hue is chosen by contrast, ink or white, never hand-picked. Sunflower and grass take ink; cobalt and tomato take white.

**The Cobalt Shell Rule.** Cobalt fills the shell (header, rail) and marks the current place; content blocks get cobalt only when the event or group is cobalt.

## Typography

**Display Font:** Lexend (with -apple-system, BlinkMacSystemFont, sans-serif)
**Body Font:** Lexend, same family
**Label/Mono Font:** none distinct

**Character:** One rounded, wide, highly legible geometric sans at weights 400 to 800, self-hosted as a variable font. Weight and size do all the work; there is no second face and no italic.

### Hierarchy
- **Display** (800, 84px desktop / 60px phone, line-height 1, -0.03em): the next-event time only; its AM/PM sits beside it at 22px 700.
- **Headline** (700, 40px desktop, 1.1, -0.025em): the page title in the main column. On a phone the title moves into the cobalt header at 26px 700, -0.02em. Settings group heads use 28px 700.
- **Title** (700, 20px, -0.01em): section heads on Home, the More sheet, card headings. Event title in the next-event block 22px (28px desktop); flat Settings section heads 17px.
- **Body** (500, 16px): rows, to-dos, member names; 15px is the shell base size and quieter copy.
- **Label** (600, 13px, no tracking, sentence case): times, captions, legends, dot labels at 12px, tab labels at 11px.

### Named Rules
**The One Family Rule.** Every heading, including OpenFamily's Fraunces headings inside the shell, is set in Lexend. `em` stays upright.

**The Tabular Rule.** Figures are tabular across the shell so times line up in rows.

## Layout

Phone first, one column, 16px page padding, sections 32px apart. A cobalt header carries the page title, a fixed bottom tab bar shows four destinations plus More (a bottom sheet with the rest, Look, theme and sign-out), and the main area clears the bar with 104px plus the safe area.

At 900px and up the shell becomes a two-column grid: a 248px sticky cobalt rail and a main column padded 32px 40px, capped at 1200px. Home splits 1.35fr / 1fr with a 40px gutter (Today on the left; to-dos, daycare and the rest on the right). Settings becomes a 280px group list beside the open group panel; on a phone the list and panel are separate views with a back link. Flat Settings sections become a 240px label column beside the controls at 900px.

Rhythm runs on 4px steps: 4, 8, 12, 16, 20, 24, 32, 40. Touch targets are at least 44px (rows and tabs 48 to 64px).

## Elevation & Depth

Board Book is flat. Shadows are set to none on cards, dialogs, buttons and OpenFamily surfaces inside the shell. Depth comes from a hue or wash fill against white, 1.5px line rules and borders, and a 45% ink scrim (rgba(17, 18, 23, .45)) behind dialogs and the More sheet.

### Named Rules
**The Flat Page Rule.** No box-shadow at rest or on hover. If something needs to stand apart, fill it or rule it.

## Shapes

Big soft rectangles and circles. Blocks (next event, notes, cards, dialogs, panels, sheets) round at 24px; OpenFamily settings sections at 20px; callouts and empty states at 16px; fields and menu items at 14px; small icon tiles at 12px. Every button, tab highlight, rail item and select is a full pill. People and events are circles: the strip discs, row dots, chore discs and avatar.

Lines have two weights: 2.5px ink outlines on controls (buttons, round checks; 2px on small buttons and fields), and 1.5px Line rules for rows, cards and panels.

### Named Rules
**The Disc Ramp Rule.** The day strip sizes discs by order, not by duration: next 40px with a 4px ink ring, later 26px, tomorrow 14px in Line.

## Components

### Buttons
Chunky, inked and pill-shaped.
- **Shape:** full pill (999px), 48px tall, 2.5px ink outline, 700 weight.
- **Primary:** ink fill, paper text; hover drops to 90% opacity.
- **Secondary:** paper fill, ink text and outline; hover fills Wash.
- **Small:** 38px, 2px outline, 14px text.
- **Text button:** cobalt (dark-focus in dark) 14px 600, no box, 44px target.
- **Disabled:** 45% opacity.
- **Focus:** 3px cobalt outline, 2px offset, for every button, link, field and summary (dark-focus in dark).

### Chips
- **Member chip:** Wash pill with a 30px member disc (initial, ink-or-white) and the name in 600. Coded for Settings, Household; not yet confirmed rendered.
- **Currency pills:** 2px ink outline, pressed state fills ink.

### Cards / Containers
- **Corner Style:** 24px.
- **Background:** Paper with a 1.5px Line border, or a flat Wash fill for quiet blocks.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Internal Padding:** 16 to 20px; 24 to 28px on desktop heads.

### Inputs / Fields
- **Style:** Paper fill, 2px Line border, 14px radius; labels 14px 600 ink; placeholders Soft.
- **Focus:** border turns cobalt plus the 3px cobalt ring.
- **Checks:** round 26px ink-outlined check that fills grass with a white tick; household module switch is a 52 by 32 pill that fills grass.

### Navigation
- **Phone:** cobalt header (title 26px, subtitle in Cobalt Tint, tools and avatar in white), white bottom tab bar with 1.5px top rule, 24px icons over 11px labels, Soft inactive and cobalt current. More opens a 24px-topped bottom sheet that slides up in .24s (off under reduced motion).
- **Desktop:** cobalt rail with a sunflower brand tile, pill items in Cobalt Tint, Deep Cobalt on hover, and a white pill with cobalt text for the current page.

### Next-event block
The signature: a full-width 24px block filled with the event's world hue, the time at Display size, the title below, and an ink "when" pill in sunflower text at top right. Empty state falls back to Wash.

### Day strip and rows
A 3px Line track with the disc ramp above 12px labels, then ruled rows: a 64px time column, a 14px hue dot, the title with a Soft subline. Tomorrow's rows go Soft with Line dots.

### Settings groups
Five groups each own a hue: You cobalt, Household tomato, Display sunflower, Data grass, Advanced ink (inverted in dark). The list shows a hue tile per group; the open panel's head is filled with its hue, ink-or-white text, and flat ruled sections beneath instead of accordions.

### Notes
Sunflower 24px blocks with 17px 600 text; tomato and grass variants follow the Ink-Or-White Rule.

## Do's and Don'ts

### Do:
- **Do** pick every hue from the four world hues and every on-hue text colour with the ink-or-white contrast test.
- **Do** keep white text off sunflower and grass; use ink.
- **Do** give every control a 3px cobalt focus ring with 2px offset (dark-focus in dark).
- **Do** give every drag a keyboard and touch alternative, as Arrange Home does for card order.
- **Do** keep touch targets at 44px or more.
- **Do** set figures tabular and keep times large and words small.
- **Do** honour reduced motion; the only motion is the sheet slide and the switch thumb.

### Don't:
- **Don't** add shadows to cards, dialogs, buttons or blocks.
- **Don't** use a second typeface, Fraunces headings, or italics inside the shell.
- **Don't** bring back cream grounds, serif headings or a grid of identical cards.
- **Don't** use grey SaaS chrome: grey toolbars, grey panels, many small muted widgets.
- **Don't** introduce a fifth content hue or tint the primaries for decoration.
- **Don't** put uppercase tracked labels above headings.
