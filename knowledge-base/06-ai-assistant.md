# AI assistant

[Knowledge base index](README.md) · [Google Calendar and Tasks](04-google-calendar-tasks.md) · [Security and privacy](13-security-privacy.md)

Family Hub exposes OpenFamily's existing AI assistant and provider settings. Parents can choose a supported provider and model, test the connection, and use the assistant to draft requests. The existing review-before-saving flow remains important: inspect the proposal before applying any task or calendar action.

Provider choices inspected during development included Ollama, OpenAI-compatible providers, Anthropic and Gemini. Availability depends on the provider, model name, credentials, network and service configuration. A model name alone does not install a model or start a server. A hosted provider receives the prompt and any information included in it. Family Updates emails are sent only for the sources where a parent switched **AI summaries and suggestions** on (v2.3, see below).

## Where your text goes

The AI provider settings say this too (English and French). With OpenAI, Anthropic or Google Gemini, what the assistant reads is sent to that company. Their paid APIs say they do not use it to train models; Google's free Gemini tier does use it to improve its products; providers may keep requests for a while to check for abuse. For private family information, use a paid API key (for Gemini, a key from a Google Cloud project with billing enabled) or a model you host yourself (Ollama), or leave AI off. The choice is the household's.

## Family Updates (v2.3)

For each Family Updates source with AI on, each new email is sent once to this provider in the background (up to three a minute) for a short summary and suggested events or to-dos. Suggestions are checked by Family Hub and wait for a parent to add or dismiss them; see [Family Updates](05-daycare-gmail.md). A provider failure is retried after 15 and then 30 minutes. Only an error code is logged, never the email or the model's answer.

## Day summary (v2.5)

With AI on, the household's provider also writes a short summary of today: a headline and two sentences. It is sent the titles, times, places and colour-label names of today's events, the titles of to-dos due today or overdue, and chores due today. Never email. It is asked once, then again only when today's events, to-dos or chores change (at most every 30 minutes), or when someone taps **Refresh** under it. The summary appears:

- at the top of the Board Book home (the Morning page), for members who keep **Start my day with a summary** on (Arrange your overview);
- on the photo frame, when **Your day** is chosen in Settings → Display → Display layout ([Photo frame](16-photo-frame.md));
- in ZeroG's morning Telegram message, through the connected-app read grant `/api/familyhub/day-summary/*`.

If the provider fails, the last good summary for today stays; with AI off, these places show the calendar as before.

## Ollama and Llama

Ollama can serve a model such as a supported Llama variant if it is already installed and running on an accessible host. The server URL must be reachable **from the Family Hub server container**, not merely from the browser. `localhost` inside that container refers to the container itself. Consider the Raspberry Pi 4's 4 GB RAM and the model's actual memory and performance needs; choosing a model in settings does not establish that it will run acceptably on the Pi.

## Google-connected actions

Where a reviewed AI proposal creates or changes Google tasks, Family Hub routes the accepted action through the same selected Google Tasks integration used by the dashboard. It should not create a competing local task. Google authorization and household write permissions still apply. A display-scoped session is read-only.

## Gemini status

Earlier, the owner encountered rejected-key/restriction errors and a provider availability/timeout error. Since November 16, 2026 the Pi uses a paid Gemini key from a billing-enabled Cloud project, and Family Updates suggestions were produced on the Pi (owner's report, November 17), which means Gemini generation worked there. The note-to-proposal assistant itself has not been separately confirmed against Gemini.

To investigate later, verify the key belongs to the intended project/provider, that its API restrictions permit the exact requested service and method, that the model is available to that project, and that the server can reach the provider. Use the provider's current official documentation because service names, model availability and quotas change. Do not paste keys into chat or Git. Retest a harmless prompt and preserve the sanitized error if it fails.
