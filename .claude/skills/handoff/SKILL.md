---
name: handoff
description: Save where Family Hub work stands to docs/familyhub/STATE.md so the next session or a compacted conversation can pick it up. Use before compacting, before ending a long session, after a merge or release, or when the owner says "handoff", "save state" or "where were we".
---
# Handoff

Context is lost at compaction and between sessions; `docs/familyhub/STATE.md` is
what survives. Keep it true and short.

1. Gather facts, don't recall them: `git status -sb`, `git log --oneline -10`,
   `gh api repos/santoshgs/familyhub/pulls --jq '.[] | "#\(.number) \(.title)"'`,
   and the newest `familyhub-v*` tag.
2. Rewrite these sections of `docs/familyhub/STATE.md` (create it from the existing headings if missing):
   - **Running** - release on the Pi and how that was confirmed (or "not verified").
   - **In flight** - branches, open PRs, anything half done and its next command.
   - **Waiting on the owner** - decisions or actions only the owner can take.
   - **Last checks** - what ran, when, pass or fail.
   - **Next** - the next 3-5 steps, in order.
3. Keep it under about 80 lines. Move finished detail to `docs/familyhub/RELEASES.md`
   or the knowledge base (the `docs-keeper` agent can do that).
4. Never put tokens, addresses, hostnames from `.familyhub-local/`, or household
   content in it.
5. Commit it on `develop` with `docs: update STATE.md` (no push unless asked).

When starting a session, read `docs/familyhub/STATE.md` first.
