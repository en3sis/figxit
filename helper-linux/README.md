# Figxit on Linux

The engine and the shell scripts run on Linux as they are. What is new is the helper that draws the list under the cursor. It is written with Qt 6 and speaks the same socket protocol as the Swift helper in `helper/`.

It is experimental and works on KDE Plasma 6 on Wayland only. Tested on Kubuntu 26.04 (Plasma 6.6) with bash 5.3, in Konsole and in the VS Code terminal.

## Install

You need [Bun](https://bun.sh), CMake, a C++20 compiler, rsync, and Qt 6.5 or later with LayerShellQt. On Kubuntu:

```bash
sudo apt install cmake g++ rsync qt6-base-dev liblayershellqtinterface-dev
```

Then build and install:

```bash
helper-linux/install.sh
```

It installs to `~/.local/lib/figxit/Figxit.app`, with the same layout as the macOS app, and asks whether to add this line to `~/.bashrc`:

```bash
eval "$("$HOME/.local/lib/figxit/Figxit.app/Contents/MacOS/figxit-engine" init bash)"
```

Open a new terminal and type a command. The first prompt starts the helper as the systemd user service `figxit-helper`, and the helper starts the engine. Its log is in `journalctl --user -u figxit-helper`. `figxit stop`, `figxit start`, and `figxit doctor` work as on macOS.

`helper-linux/install.sh --build` only builds into `dist/linux`, and `helper-linux/install.sh --uninstall` stops Figxit and removes it.

The completions for aws, az, and gcloud are built in. The macOS app downloads them on demand, but their archives are made with the macOS tar.

### VS Code

To place the list in the terminal panel of VS Code, Figxit asks AT-SPI where the terminal's text area is. VS Code shows it only with this line in `~/.vscode/argv.json`:

```json
"force-renderer-accessibility": true
```

Also set `"editor.accessibilitySupport": "off"` in your settings, so VS Code does not switch to its screen reader mode. `figxit doctor` shows whether AT-SPI is on.

## How it works

- **The list** is a layer-shell surface on the overlay layer, through LayerShellQt. It is anchored to the top left of the output and moved with its margins. It takes no keyboard focus, and clicks go through to the terminal.
- **The window**: Wayland does not tell an app where other windows are, so the helper loads a KWin script over D-Bus. The script reports the active window, its pid, its client area without decorations, and its output's scale each time one of them changes. The helper writes the script to `$XDG_RUNTIME_DIR`, never to a shared temp folder, and unloads it when it quits. When another window becomes active, the list closes.
- **The text area**: as on macOS without Accessibility, the shell's text area is taken to sit at the bottom of the window. That holds in Konsole with its menu bar and tab bar. For a terminal that fills only part of a window, like the one in VS Code, the helper follows keyboard focus over AT-SPI and walks up from the focused element to the first one larger than 100 by 100, as the macOS helper does. Chromium reports the web content in device pixels and the native view around it in logical pixels, so comparing the two gives the scale.
- **The scale**: Qt reports 2 on an output scaled to 1.45, so the fractional scale comes from KWin.
- **The colors** come from `kdeglobals`. Elsewhere they are Breeze's, light or dark as the desktop portal's `color-scheme` says. The helper runs with `QT_QPA_PLATFORMTHEME=generic`: the KDE platform theme takes a second or more to load and wants a config file of its own.
- **The engine**: the helper starts `figxit-engine` from its own folder and starts it again when it stops, like `EngineSupervisor` in the macOS app.
- **Starting**: `launchApp` in `engine/src/launch.ts` runs the helper as a systemd user service. Like an app that `open` starts on macOS, it gets the session's environment and not the shell's, and Ctrl-C in that shell does not reach it. Without systemd, it runs in a session of its own from `/`.

## Other desktops

What depends on the desktop sits behind three small interfaces, picked in `src/backends.cpp`:

| Interface | KDE Plasma | Elsewhere |
|---|---|---|
| `WindowLocator` (`src/locator.h`) | KWin script | GNOME: a Shell extension. Sway: `swaymsg -t get_tree`. Hyprland: `hyprctl activewindow` |
| `PopupSurface` (`src/surface.h`) | layer-shell | layer-shell also works on wlroots compositors, Hyprland, niri, and COSMIC, but not on GNOME |
| `FocusTracker` (`src/focus.h`) | AT-SPI | The same on any Linux desktop |

Another desktop needs a file in `src/locator/` or `src/surface/` and a line in `src/backends.cpp`. `FIGXIT_WINDOW_BACKEND=kwin` picks a locator by name, and `none` uses none: the list then opens at a fixed place. What a terminal needs, by its app id, goes in `src/terminals.cpp`.

## Development

```bash
helper-linux/dev.sh
```

builds the helper and runs it with the engine from source, with reload, like `make dev`. Then run `source shell/bash/figxit.bash` in a new terminal. The helper writes each placement to `~/.local/state/figxit/helper.log`.

```bash
cmake -S helper-linux -B helper-linux/build
cmake --build helper-linux/build
ctest --test-dir helper-linux/build
```

`placement_test` is a port of `GeometryTests.swift`. `helper_test` runs the helper with fake desktop parts on Qt's offscreen platform, so it needs no display.

- `figxit-helper --locate` prints the active window each time KWin reports it.
- `figxit-helper --snapshot items.json out.png [--light | --dark] [--scale N]` draws a list into a PNG.
- `FIGXIT_DEBUG=1` logs each placement. `FIGXIT_POPUP_AT=x,y` sets the fixed place used without a locator, 80,80 by default.

`src/placement.cpp` is a port of `Geometry.fit` and `Geometry.visibleSurface` in `helper/Sources/figxit-helper/Geometry.swift`, with one difference: the window comes from KWin's client area, without the title bar, so nothing is taken off for it (`assumedTitlebar`). Keep that in mind when porting changes to `Geometry.fit`.

## Limits

- KDE Plasma 6 on Wayland only. GNOME has no layer-shell, and X11 is not done.
- Tested with bash in Konsole and VS Code. zsh, fish, tmux, and other terminals are not tried yet.
- Figxit starts with the first shell prompt, not at login.
- No tray icon, Settings, or updates. `figxit open` does nothing.
