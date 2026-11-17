# Family Updates from Gmail

[Knowledge base index](README.md) · [Google Calendar and Tasks](04-google-calendar-tasks.md) · [AI assistant](06-ai-assistant.md) · [Privacy](13-security-privacy.md)

Family Updates (called Daycare before v2.2) shows emails from the daycare app, the school and similar senders as clean text, on the dashboard and, if you choose, on the kitchen display. It uses the optional Gmail permission on the **same dedicated family Google connection** used for Calendar and Tasks. Internally the module is still keyed `daycare`, so older layouts and links keep working.

## Sources

**Settings → Household → Family Updates** (parents) chooses what the module reads:

- **Lillio (daycare app)**: the built-in source for `no-reply@himama.com`. It can be switched off or renamed. Meals, milk, naps and activities are recognized as before.
- **Gmail labels**: up to eight of the account's own labels, for example one for the school's mailing list. What goes into a label is managed in Gmail, usually with a filter (for example, "emails from the school board's domain → apply label Family/School"). Tick **Also apply filter to matching conversations** when creating it so the last 30 days appear at once.

For each source you choose:

- the **name on the card** (for example, "School");
- **Show on the kitchen display**: off keeps that source's emails off the frame entirely;
- **Only senders Gmail verified** (labels, on by default): hides an email unless Gmail's own check (DMARC) passed for the domain in its From address, so a forged email cannot appear;
- **AI summaries and suggestions** (v2.3, off by default): see below.

The section shows how many emails the last refresh showed and hid for each source. Hidden emails usually failed the sender check; switch it off for that label only if you trust everything the filter puts there.

School mass-mail services often share one `List-Id` across many schools, so Family Hub never uses the mailing-list header to recognize a sender; use a Gmail filter on the school's address or domain instead.

## How emails are shown

Emails from the last 30 days, at most 100 across all sources, refreshed about every five minutes. Each is shown as plain text: paragraphs and bullet lists, with unsubscribe and "you are receiving this" footers, tracking links and images removed, and the sender's name and the source's name above the subject. The only link kept is one to the sender's own website (for Lillio, the Lillio app). No email HTML is ever rendered. An email already read is not downloaded again.

The frame shows the five most recent emails from sources allowed on the display, with the source name beside the time.

## AI summaries and suggestions (optional)

With AI on for a source and the [AI assistant](06-ai-assistant.md) set up, each new email from that source is sent once to the household's AI provider. It returns:

- a short **summary**, shown under the email (marked "AI summary") and, on the frame, in place of the first line;
- up to five **suggested events or to-dos**, such as a class trip or a form due on Friday.

Suggestions appear at the top of the Family Updates page as **Suggested from emails**, with the date, the email they came from and the sentence quoted from it. Parents tap **Add to calendar** / **Add to to-dos** or **Dismiss**. Nothing reaches Google until someone adds it. An added event uses the household's event length and notification settings.

Family Hub checks every suggestion before showing it: the quoted sentence must really be in the email (a made-up event has no quote and is dropped), the date must be real and from today on, and the same item from two emails (a notice and its reminder) is shown once. Suggestions whose date has passed expire. Adding is safe to repeat: a double tap, or the app and a chat at the same time, adds it once.

**Where the text goes.** The subject and cleaned text of those emails (never the sender's address) go to the provider you chose. With Gemini, OpenAI or Anthropic that is the company's servers; paid API tiers say they do not train on it, Google's free Gemini tier does use it to improve its products, and providers may keep requests for a while to check for abuse. For private family information use a paid API key or a model you host yourself (Ollama), or leave AI off. Leaving AI off changes nothing else in the module.

## Nightly digest in Telegram (ZeroG)

The household's ZeroG bridge can send the waiting suggestions once a day in Telegram, with **Add** and **Skip** buttons (ZeroG v0.3.5 and later; `/digest` sends it on demand). A tap by an allowed parent adds or dismisses that one item through Family Hub, and is recorded as a decision by a connected app. Setup is in ZeroG's own documentation; the Family Hub side is a connected app in **Settings → Agents** with read access to `/api/familyhub/family-updates/*` and the two suggestion writes (see [`AGENT_API.md`](../docs/familyhub/AGENT_API.md)).

## Privacy and permissions

The optional `gmail.readonly` scope can read the whole mailbox, not just the chosen sources. The source settings limit what Family Hub processes and shows; they do not narrow Google's permission. Google treats this as a restricted scope; see [Google's restricted-scope guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). Attachments are never downloaded. Family Hub keeps a disposable cache of the shown emails and, for AI sources, the summaries and suggestions; the email text itself is not stored a second time.

## What has been tested

Automated tests cover the label parser (with a fictional school email shaped like a mass-notification message), the sender check, the settings, the AI checks with fixed answers, accepting and dismissing, and connected-app access. On the Pi (owner, November 16–17, 2026): a label email appeared in v2.2, AI suggestions were produced in v2.3, and ZeroG's digest listed them. The screens have not been reviewed in a browser by an agent. If something is missing, see [troubleshooting](11-troubleshooting.md).
