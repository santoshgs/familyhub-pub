# Display logo images (optional)

The family display looks here for logo images supplied by the household. Any
file that is missing is skipped and the display falls back as noted. Only add
images you have the right to use.

| File | Used for | When absent |
| --- | --- | --- |
| `f1-logo.svg`, `.png` or `.jpg` | Formula 1 card icon tile, 64 × 42 px (crop to that shape; 128 × 84 or larger) | Styled "F1" text |
| `team-shield.png` or `.jpg` | Team badge on the F1 card, 30 × 30 px (square, about 120 px) | Wikimedia's 120 px thumbnail of "Scuderia Ferrari (4484419145).jpg" (Damian Morys, CC BY 2.0, credited on the card), then nothing |

Files here are served under `/assets/`, which the LAN display listener already
allows, so the frame can load them without reaching the internet.

The current files are 144 × 84 and 120 × 120 crops of images supplied by the
owner on November 2, 2026; the originals are kept outside the repository.
