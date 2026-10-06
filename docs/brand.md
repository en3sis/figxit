# Figxit brand

Reference for anyone, human or agent, who writes copy or makes visuals for Figxit. The landing page `docs/index.html` is the source of truth for the tokens below. If the two disagree, the page wins and this file needs an update.

## What Figxit is

- One line: IDE autocomplete for your terminal.
- Longer: a native macOS list of subcommands, options, scripts, and targets that opens under the cursor as you type in zsh, bash, or fish. Open source, local only.
- Page title: `Figxit: IDE-style autocomplete for the Mac terminal`.
- It replaces the autocomplete of Fig, of Amazon Q and Kiro CLI, and of Microsoft inshellisense on macOS. It does not replace Fig scripts, dotfile sync, team sharing, or AI chat. Never write "full replacement".
- Not affiliated with Fig, Amazon, or Kiro. Say so where Fig is named.

## Name

- Written `Figxit`, capital F, one word. The command is `figxit`, lower case, in code style.
- Domain: `figxit.com`. Repository: `github.com/en3sis/figxit`.

## Voice

- Plain and concrete. Say what the thing is or does. If a sentence adds no fact, cut it.
- No slogans, no personification, no coined verbs, no "AI-sounding" filler or reassurance.
- Never use em dashes. Use commas, colons, parentheses, or a new sentence.
- Section titles are plain labels or statements of fact, for example "Works with" or "Download, drag, and add one line".
- Sentence case everywhere. British spelling for "licence".
- Name real things: `git`, `docker`, `make`, Makefile targets, package.json scripts. Prefer an example over an adjective.
- Words people search for: "terminal autocomplete", "Mac", "zsh", "bash", "fish", "Fig alternative". Nobody searches for "popup", so keep it out of titles and headlines. It is fine in body text and in the README.
- Standing claims, keep them exact: no account, no AI chat, no telemetry. The only network request is the daily update check.
- Check numbers and behaviour against the README before you publish them.

## Colour

Light theme only. Black and white with one accent.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f6f7fb` | Page background |
| `--text` | `#0d0e14` | Headings, body, primary button |
| `--muted` | `#555967` | Secondary text |
| `--dim` | `#7b7f8f` | Notes, untested or disabled items |
| `--accent` | `#007aff` | The one accent: prompt mark, small icons, the selected row in the icon |
| `--link` | `#0064d9` | Accent as text: links and section labels |
| `--line` | `rgba(12, 14, 34, 0.1)` | Hairlines and borders |
| `--card` | `rgba(12, 14, 34, 0.035)` | Card and chip fill |
| `--ok` | `#12925a` | Success marks only |

- The accent is macOS system blue, the same blue as the selected row in the real list. Use it sparingly: one accent per view is enough.
- Icon tile: graphite, `#3a3c45` at the top to `#0c0d10` at the bottom.
- Do not use on the page: purple or violet, multi-colour gradients, coloured glows or blurs, a second accent colour, a dark theme. The glass depth belongs to the icon only; page surfaces stay flat.

## Type

- Sans: Mona Sans (variable, OFL), self-hosted at `docs/fonts/mona-sans-wght.woff2`. Credit it in the footer.
- Mono: the system stack (`ui-monospace, "SF Mono", Menlo`). Used for commands, prompts, key caps, and the small section labels.
- Weights: 500 is the minimum for any text. 600 for labels, names, and buttons. 620 to 700 for headings.
- Headings: tight tracking (`-0.035em` on h1, `-0.028em` on h2), line height about 1.08.
- Body: 16px, line height 1.55. Lead paragraph 17 to 20px in `--muted`.

## Icon and logo

- The mark: a prompt chevron and a list of three rows of equal width. The first row is the selected one, as in the real list.
- Layered glass, after Apple's current icon style. Graphite tile with a soft light from the top left. The list panel and the chevron are translucent white glass with a bright rim and a shadow under each. The selected row is system blue (`#2b95ff` to `#0a78f5`); the other two rows are white at 50%. Blue is the only colour.
- Sources: `helper/Resources/AppIcon.svg` (rounded tile with margin) and `helper/Resources/AppIconSquare.svg` (full bleed). Edit these, then run `scripts/appicon.sh` to rebuild `AppIcon.icns` and `docs/icon/`.
- Use `docs/icon/rounded/` on the web and in the README, `docs/icon/square/` where the platform rounds the corners itself.
- Do not recolour the tile or the mark, move the selected row, tilt the mark, or put the icon on a busy background.

## Layout and components

- Max width 1120px, 24px side padding, 16px on phones. Sections start 112px apart.
- Each section: a small mono label with an icon (the "eyebrow"), an h2 of at most about 20 characters per line, then content.
- Surfaces are flat: a hairline border, a faint fill, large radii (12 to 28px). Shadows are neutral grey and soft.
- Lists of facts use rows with hairlines (see "Works with"), not rows of pills.
- Buttons: one primary (near-black fill, white text) per group, the rest outlined.
- Icons: Lucide, 2px stroke, as inline SVG symbols. Product logos from Simple Icons, single colour.
- Background texture: faint shell commands in mono, masked toward the edges. No grids, dots, or meshes.
- Product shots are real captures of the list in `docs/img/`. Do not redraw the list by hand.

## Share image

- `docs/og.png`, 1200 by 630. Flat `#f6f7fb` background, icon top left, headline, one line of description, `figxit.com` in the link colour, and a terminal card with a real capture on the right.
- No gradient. Headline matches the page h1. After an icon change, rebuild it so the icon in it matches.

## Where the copy lives

A change to the positioning line should be made in all of these:

- `docs/index.html`: title, meta description, Open Graph and Twitter tags, JSON-LD, h1, lead, FAQ
- `docs/og.png`
- `docs/llms.txt` and `docs/llms-full.txt`
- `README.md` intro
- `helper/Sources/figxit-helper/About.swift`
