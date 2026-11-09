<img src="assets/icon.png" width="96" alt="Figxit app icon">

# Figxit

IDE autocomplete for your terminal on macOS. As you type in zsh, bash, or fish, Figxit lists subcommands, options, files, Makefile targets, and `package.json` scripts, ranked by what you use in the current project.

Free and open source. No account, no AI chat, no telemetry.

<img src="assets/hero.png" width="880" alt="A terminal window on a Mac desktop with make typed, and the list of Makefile targets with their help text and red icons on the production ones">

## Features

- **Commands you run, with their icons**: type `p` for `python3`, `pnpm`, `psql`
- **Subcommands and options** for 700+ tools: `git ch`, `docker run --`
- **Live values**: git branches, SSH hosts, files and folders
- **Makefile targets and `package.json` scripts**, with their help text
- **Ranked by your history** in the current folder, with [Atuin](https://atuin.sh)
- **Red icons for production**: Enter inserts those rows without running them
- **Your aliases**: `git co ` completes like `git checkout `
- **zoxide**: `z rack` lists the folders `z` would jump to
- **zsh, bash, and fish**, in Ghostty, iTerm2, Terminal, tmux, and the VS Code terminal

## Why it exists

Fig put autocomplete in the terminal: type `git ` and see every subcommand with a short description. Fig joined AWS in 2023 and shut down in September 2024. Its autocomplete moved to Amazon Q Developer CLI, then to Kiro CLI, and [Kiro CLI 3.0](https://kiro.dev/changelog/cli/3-0/) removed it in November 2026 with no replacement.

Figxit is a direct replacement for that autocomplete on macOS: a native app, open source, and maintained.

The open alternatives each miss a part:

- Shell completion opens only when you press Tab, and does not know what you use most.
- Tools that draw the list inside the terminal have to wrap your shell.
- History search finds past commands, but does not show what a command can do.

Figxit does all three: the list opens as you type, it knows 700+ tools, and your history sets the order.

## What it does

### Subcommands and options

Figxit uses the open source Fig specs for 700+ tools. Type a command and a space for its subcommands, or a dash for its options.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/git-dark.png">
  <img src="assets/git.png" width="640" alt="Terminal window with git ch typed and the list of matching git subcommands">
</picture>

Specs also fill in live values: git branches after `git checkout `, hosts after `ssh `, files and folders where a command takes a path. Your git and gh aliases work too: `git co ` completes like `git checkout `.

### Makefile targets and scripts

`make ` lists the targets in the current folder, with their help text. `npm run `, `pnpm `, `yarn `, and `bun run ` list the scripts in `package.json`, with the command each one runs. See [Conventions](#conventions) for the help text and the icons.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/scripts-dark.png">
  <img src="assets/scripts.png" width="640" alt="Terminal window with npm run typed and the list of package.json scripts with the command each one runs">
</picture>

### Ranking from your history

With [Atuin](https://atuin.sh) installed, Figxit reads your history (read-only). Words you used in this folder, in this repository, or recently come first. Without Atuin, the list still works.

### zoxide

`z rack` lists the folders zoxide matches, in the order `z` would jump.

## Conventions

Figxit follows conventions many projects already use. All of them are optional.

### Makefile help text

```make
##@ Development
dev: ## Start the stack with hot reload
test: ## Run the unit tests

##@ Release
release: ## [prod] Publish the app
```

| You write | Figxit shows |
|---|---|
| `##@ Development` | A section name in front of the targets below it |
| `dev: ## Start the stack` | "Start the stack" as the description of `dev` |
| `release: ## [prod] Publish the app` | A red icon on `release`. The tag itself is hidden |

The tags are `[prod]`, `[production]`, `[danger]`, and `[caution]`, at the start of the help text.

### Red icon for production

A row gets a red icon when:

| Rule | Examples |
|---|---|
| The name is in capitals | SSH host `PROD`, target `DEPLOY` |
| The name has the word `prod` or `production` | `deploy:prod`, `api-prod`, `prod-db-1` |
| A Makefile target has a tag in its help text | `release: ## [prod] Publish the app` |

It applies to Makefile targets, `package.json` scripts, and live values like SSH hosts and Docker contexts. It does not apply to files, subcommands, options, or your history. Enter inserts a red row without running it.

### Icons from the name

A verb in a target or script name picks the icon: `dev`, `start`, and `serve` get play, `test` a check, `build` a hammer, `lint` a wand, `db:migrate` a database, and `dev-down` a stop. The list is in `engine/src/verbs.ts`.

## Install

1. Download [Figxit.dmg](https://figxit.com/download/Figxit.dmg), open it, and move Figxit to Applications.
2. Open Figxit. The setup window shows one line for your shell. Click **Add**, or add it yourself:

   ```bash
   # zsh, in ~/.zshrc
   eval "$('/Applications/Figxit.app/Contents/MacOS/figxit-engine' init zsh)"

   # bash, in ~/.bashrc
   eval "$('/Applications/Figxit.app/Contents/MacOS/figxit-engine' init bash)"

   # fish, in ~/.config/fish/conf.d/figxit.fish
   status is-interactive; and '/Applications/Figxit.app/Contents/MacOS/figxit-engine' init fish | source
   ```

3. Open a new terminal and type a command.

You need an Apple Silicon Mac with macOS 13 or later, and zsh, bash 5, or fish 4. The bash that comes with macOS is 3.2 and too old.

New versions install from the menu bar icon. If something looks off, run `figxit doctor`.

## Keys

| Key | What it does |
|---|---|
| Up, Down | Move through the list |
| Tab | Insert the row |
| Enter | Insert the row and run the line. Turn this off in Settings to only insert |
| Esc | Close the list |

When the list is closed, your keys work as before.

After Esc, the shell waits to tell it apart from arrow keys: 400 ms in zsh, 500 ms in bash. Figxit sets this wait to 50 ms, unless you set your own `KEYTIMEOUT` (zsh) or `keyseq-timeout` (bash), or you have a key binding of two or more keys that starts with a letter, like `jk`.

## Works with

Ghostty, iTerm2, and Terminal, and any terminal inside tmux or herdr.

Split panes and the terminal in VS Code or Cursor need Accessibility. See below.

## Extra completions

The completions for the AWS CLI (37 MB) and the Google Cloud CLI (14 MB) are not in the app, to keep it small. Download them in Settings > Extra completions, or in the terminal:

```bash
figxit extras             # list them
figxit extras add aws     # download one
figxit extras remove aws  # remove it
```

The first time you run `aws` or `gcloud` without them, Figxit opens Settings to offer the download.

## Panes, editors, and Accessibility

To place the list, Figxit needs to know where the text area of your terminal is on screen. Without Accessibility, macOS only tells it where the window is. That is enough when one shell fills the window, but not when the window has more than one text area.

These work without Accessibility:

- one shell in each window or tab
- tmux panes, because tmux reports where the pane is
- herdr panes, because herdr reports where the pane is

These need Accessibility, and the list stays hidden without it:

- a split of the terminal app, like Cmd+D in iTerm2 or Ghostty, with or without tmux
- one tmux session attached in two splits (the list shows in the focused one)
- the terminal in VS Code or Cursor, with or without tmux

To allow it, click **Allow…** in Figxit Setup or in Settings, then turn on Figxit in System Settings > Privacy & Security > Accessibility (called Device Control and Data Access in macOS 27). Figxit opens Setup the first time it finds one of these terminals without the permission, and `figxit doctor` shows the state.

Figxit uses Accessibility to read the position and size of the focused text area, nothing else. It does not read the text, and it does not click or type. In editors built on Electron, like VS Code, it also turns on the accessibility tree the first time you type in the terminal, so the first list after the editor starts can be missing.

Splits are tested in iTerm2 and Ghostty, and editor terminals in VS Code and Cursor. Other editors built on VS Code use the same terminal but are not tested yet.

## How it works

Figxit has three parts that talk over local sockets:

```
shell script  ── line and cursor ──▶  engine  ── rows ──▶  app
(zsh, bash, fish)                     (Bun)                (Swift)
      ▲                                  │
      └──────── text to insert ──────────┘
```

- **Shell script** (`shell/`): sends the line to the engine after each key, without waiting. It waits only when you press Tab or Enter with the list open.
- **Engine** (`engine/`): keeps the specs and your history in memory, builds the list, and ranks it. Values that need a command, like git branches, arrive a moment later, so the first rows are never slow.
- **App** (`helper/`): a menu bar app that draws the list under the cursor without taking focus, and restarts the engine if it stops.

Specs maintained by Figxit, for tools Fig does not cover well, live in `engine/src/figxit/`.

## Limits

- macOS only.
- Without Accessibility, the list stays hidden in split panes of the terminal app and in editor terminals.
- The terminal in Zed is not supported. Zed does not report its terminal panel to macOS.
- fish: the list is off in vi mode.
- `az`, `heroku`, and `shopify` have no completions. Their specs depend on the installed version, which Figxit does not support yet.
- Outside tmux, the terminal must report its cursor position.
- Values that need a live service, like `kubectl get`, show nothing if the service does not answer in 1.5 seconds.

## Privacy

Figxit runs on your Mac. It reads your shell history and the files in the current folder, and sends neither anywhere.

Figxit makes two kinds of network requests, both to figxit.com:

- The daily update check, which reads one file. I count those checks and the app downloads by version and date, with no IP address and no identifier. You can turn the check off in Settings.
- Extra completions, only the ones you download. When an app update changes one you have, the engine downloads the new version.

Words from your history that look like secrets, such as a `--token` value or `API_KEY=...`, are not shown.

## Development

```bash
cd engine && bun install   # once
make dev                   # run the app from source, with reload
make test                  # unit tests
make build                 # build dist/Figxit.app
```

You need [Bun](https://bun.sh) and the Xcode command line tools.

## Credits

Completion specs from [withfig/autocomplete](https://github.com/withfig/autocomplete) (MIT). Tool icons from [Simple Icons](https://simpleicons.org) (CC0), and the logos belong to their owners. Updates by [Sparkle](https://sparkle-project.org) (MIT).

Figxit is not affiliated with Fig, Amazon, or Kiro.

## Licence

MIT. See [LICENSE](LICENSE).
