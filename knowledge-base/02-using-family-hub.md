# Using Family Hub

[Knowledge base index](README.md) · [Accounts and access](03-accounts-and-access.md) · [Google integration](04-google-calendar-tasks.md)

Connect your device to the household Tailscale network, open the private Family Hub HTTPS address, and sign in with your Family Hub account. Your Google account is a separate integration. If the page cannot be found, start with [Tailscale and DNS](08-tailscale-networking.md).

## Navigation

This section describes the **Classic** look. A redesigned look, **Board Book**, can be chosen per browser from the **Look** menu during a trial; see [Classic and Board Book looks](18-management-look.md).

The top bar shows as many destinations as fit the screen and moves the rest into **More**. The order is yours: **Settings → You → Menu order** (v1.5.2) stores it on your account, so other members keep their own. By default the order is Home, Calendar, To-dos, Chores, Daycare, School, then enabled modules.

| Desktop | Phone |
| --- | --- |
| <img src="../docs/familyhub/images/nav-desktop.png" alt="Navigation on a wide screen" width="520"> | <img src="../docs/familyhub/images/nav-phone.png" alt="Navigation on a phone with the More menu open" width="220"> |

## Overview and layout

The overview summarizes calendar events, tasks, family notes, daycare and other enabled cards. Open a card or its action for details. Notes can be added directly from the overview; the Notes page offers a fuller view.

Use **Arrange cards** to move cards with the up/down controls. Those controls also work with touch and keyboard; desktop users can drag card headings. Card order is stored per signed-in member, so another family member can have a different order. The reading and focus order follows the visual order.

Choose **Light**, **Dark**, or **System** from the theme control. The preference is saved in that browser; System follows the device's appearance setting.

## Calendar and its color legend

The overview shows a short upcoming summary. Open Calendar for month, week and day views, previous/next navigation, Today and refresh. This view reads the **one selected shared Google calendar**, not every calendar in the account. It preserves Google event colors where available, with fallback colors if Google's color metadata is unavailable. Creating an event writes to that calendar.

Parents can **edit or delete** an event from its details (v1.5.0). Changes go to Google: title, time, location and colour. In a repeating series, only that occurrence changes. Editing is limited to parents and the saved calendar.

Event colours come from Google. Google's API does not name its colours, so the labels you see come from Family Hub's **Calendar colours legend**, which parents edit beneath the overview calendar card (for example, a colour that stands for one person). Labels are stored for the household; editing them does not change Google events or infer a person's identity.

## To-Dos and notes

To-Do operations use the selected Google Tasks list. Create, edit, complete, reopen or delete tasks in Family Hub, then refresh or check the same list in the dedicated account's native Google Tasks app. Google Tasks scheduling in this integration is date-based; do not assume precise reminder-time parity.

Notes are stored in Family Hub's database. Parents can create and update notes, and notes can be pinned where the interface offers that control. Unlike Calendar and Tasks, notes are not synchronized to Google.

## Budget, pocket money and optional modules

**Chores** (in the navigation) are OpenFamily's household tasks: add a chore, assign family members, set a due date and, optionally, points. Chores due today appear on the family display. Budget and Pocket money reuse the original OpenFamily pages. Budget includes its classic, analytics/limits and Kakeibo views. Pocket money supports points, approvals, balances and goals; completing a Google To-Do does not automatically award points.

Parents can use **Settings → Modules** to switch modules on or off for the household: To-dos, Chores, Pocket money, Daycare, School, Notes, Budget, AI assistant, and (off for new households) Shopping, Weekly routines and Integrations. A module that is switched off is hidden and also closed on the server (its API answers 403 `MODULE_DISABLED`). Its records are kept and return when it is switched back on. Each person can also untick **Show** to leave a module out of their own menu and overview without affecting anyone else. Card order is per member. Family Hub is available in English and French. Existing portable upstream JSON exports do not include all Family Hub-specific preferences; database backups do. See [MODULES](../docs/familyhub/MODULES.md).

### Sharing expenses (v1.5)

Budget can split shared costs between members. For each expense, choose who paid and who shares it; the default split is equal between the chosen members, and leftover cents go to the people who did not pay. Each row shows the payer and monthly totals show what each member has paid. **Who owes whom** lists the simplified debts, **Settle up** records a payment between members, and **expense groups** keep their own balances and can be filtered. The Analytics page shows owed and paid totals.

Budget has 39 fixed categories in five groups, each with an icon. Categories can no longer be customised. Rows are compact: tap one to edit it, and delete it from the edit sheet. The classic view ends with a compact current-balance card (v1.5.2).

**Import from Splitwise (v1.5.1):** Budget → Groups → **Import from Splitwise** reads a Splitwise CSV export in your browser. You match people, categories and other currencies, and the file never leaves your device except the mapped items. Uneven splits are approximated as equal ones with one balance adjustment, so the balance still matches Splitwise. Importing again adds nothing that is already present. Keep the export out of shared folders and Git.

Budget groups, settlements and sharing fields are not yet in the portable data export (a known gap). Database backups keep them.

Daycare and AI have their own guides: [daycare](05-daycare-gmail.md) and [AI](06-ai-assistant.md). A read-only display has restricted controls; see [accounts and access](03-accounts-and-access.md).

## Your name

**Settings → Your name** changes the name shown in greetings, including "Good evening, …" on the family display. It applies to the account you are signed in as.

<img src="../docs/familyhub/images/settings-name.png" alt="Your name field in Settings" width="640">

## The family display

Parents set up the display in **Settings → Display** (v1.5.2 merged the former Display setup page into it): the **Display layout**, the weather city, night dimming and paired frames, then the extras. **More → Ambient display** previews it in your browser. The older `/display-settings` address redirects there.

| Choose cards | Night mode |
| --- | --- |
| <img src="../docs/familyhub/images/setup-cards.png" alt="Display cards checklist" width="380"> | <img src="../docs/familyhub/images/setup-night.png" alt="Night dimming schedule" width="380"> |

The **Display layout** gives each module one of three states: a card, a quick pill, or off. Up to six cards appear, in the order you set. The first row holds half the cards (rounded up, at most three); three or fewer cards use one row. A seventh card turns the last card into a pill. The frame shows the result and cannot change it. See [the photo frame](16-photo-frame.md) for the device itself.

### Settings → Display (v1.2, extended in v1.5.2)

Parents set up the display's extras in **Settings → Display**, one collapsible section each:

* **Weather and Formula 1:** the weather panel adds feels-like, wind, humidity, air quality, sunrise and sunset, the moon phase and a 7- or 14-day forecast; Formula 1 adds driver and constructor standings with a favourite highlight beside the weekend schedule.
* **Guest Wi-Fi:** a QR code and the network name and password, generated on the Pi.
* **Countdown:** a title, a date and time, and a checklist.
* **Markets:** stocks (needs a Finnhub API key that you add; it is write-only afterwards) and crypto (CoinGecko).
* **Photos:** upload pictures from your phone for a slideshow (up to 200 per household, 25 MB each); the Pi scales them to 1280 × 800 and removes location and camera details.

The **quick bar** above the footer shows one pill each for Wi-Fi, the countdown, markets and photos, and a pill appears only once that feature is set up. Tapping a pill or a card opens its detail panel. The display stays read-only, so the countdown checklist cannot be ticked on the frame. Details and endpoints are in [AMBIENT_DISPLAY](../docs/familyhub/AMBIENT_DISPLAY.md).

## Software updates

**Settings → Advanced → Software updates** (server administrator only) shows the release running on the Pi and the newest stable release, and can ask the Pi to **check now** or **install now** without waiting for the hourly check. The Pi still picks the version, takes the backup, checks health and rolls back on failure by itself; the app cannot choose a version. See [releases and updates](09-releases-updates.md).

## Restarting the server

**Settings → Advanced → Restart Family Hub** (server administrator only, v1.5.3) restarts the server, which clears its caches. The page waits for the server to come back and then reloads. Use it only when something seems stuck; it does not change data.
