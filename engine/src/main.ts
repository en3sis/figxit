import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { version } from "../package.json";
import { appPath, bundlePath, ENGINE_SOCK, HELPER_SOCK, specsDir } from "./paths";

const HELP = `figxit ${version}

Usage:
  figxit init zsh    Print the lines that load figxit in zsh. Also: init bash, init fish
  figxit start       Start the popup helper and the engine
  figxit stop        Stop them
  figxit doctor      Check the installation
  figxit --version   Print the version
`;

async function reachable(path: string): Promise<boolean> {
  try {
    const socket = await Bun.connect({ unix: path, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

const SHELLS: Record<string, { file: string; lines: string[]; setup: string; reload: string }> = {
  zsh: {
    file: "shell/zsh/figxit.zsh",
    lines: ['source "$FIGXIT_APP/Contents/Resources/shell/zsh/figxit.zsh"', 'figxit() { "$FIGXIT_APP/Contents/MacOS/figxit-engine" "$@" }'],
    setup: 'add to ~/.zshrc: eval "$(figxit init zsh)"',
    reload: "exec zsh",
  },
  bash: {
    file: "shell/bash/figxit.bash",
    lines: ['source "$FIGXIT_APP/Contents/Resources/shell/bash/figxit.bash"', 'figxit() { "$FIGXIT_APP/Contents/MacOS/figxit-engine" "$@"; }'],
    setup: 'add to ~/.bashrc: eval "$(figxit init bash)"',
    reload: "exec bash",
  },
  fish: {
    file: "shell/fish/figxit.fish",
    lines: ['source "$FIGXIT_APP/Contents/Resources/shell/fish/figxit.fish"', 'function figxit; "$FIGXIT_APP/Contents/MacOS/figxit-engine" $argv; end'],
    setup: "add to ~/.config/fish/conf.d/figxit.fish: figxit init fish | source",
    reload: "exec fish",
  },
};

const RC: Record<string, string[]> = {
  zsh: [".zshrc"],
  bash: [".bashrc", ".bash_profile", ".bash_login", ".profile"],
  fish: [".config/fish/conf.d/figxit.fish", ".config/fish/config.fish"],
};

const MINIMUM: Record<string, number> = { bash: 5, fish: 4 };

function loginPath(): string {
  try {
    return userInfo().shell || process.env.SHELL || "/bin/zsh";
  } catch {
    return process.env.SHELL ?? "/bin/zsh";
  }
}

function loginShell(): string {
  const name = loginPath().split("/").pop() ?? "";
  return SHELLS[name] ? name : "zsh";
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function shellVersion(path: string): string {
  try {
    return /\d+\.\d+(\.\d+)?/.exec(Bun.spawnSync([path, "--version"], { stderr: "ignore" }).stdout.toString())?.[0] ?? "";
  } catch {
    return "";
  }
}

function findShell(name: string): { path: string; version: string; old: boolean; newer?: string } | null {
  const dirs = `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`.split(":").filter(Boolean);
  const login = loginShell() === name && loginPath().endsWith(`/${name}`) ? [loginPath()] : [];
  const seen = new Set<string>();
  const found = [...login, ...dirs.map((dir) => join(dir, name))].filter((path) => {
    if (!executable(path)) return false;
    const real = realpathSync(path);
    return !seen.has(real) && Boolean(seen.add(real));
  });
  if (found.length === 0) return null;
  const meets = (path: string) => {
    const major = parseInt(shellVersion(path));
    return !MINIMUM[name] || Number.isNaN(major) || major >= MINIMUM[name]!;
  };
  const path = login.length && found[0] === login[0] ? found[0]! : (found.find(meets) ?? found[0]!);
  const old = !meets(path);
  return { path, version: shellVersion(path), old, newer: old ? found.find((other) => other !== path && meets(other)) : undefined };
}

function shellRows(short: boolean): [boolean | null, string, string][] {
  const rows: [boolean | null, string, string][] = [];
  for (const name of Object.keys(SHELLS)) {
    const shell = findShell(name);
    if (!shell) continue;
    const place = shell.version ? `${shell.version} at ${shell.path}` : shell.path;
    if (shell.old) {
      const fix = shell.newer ? `switch to ${shellVersion(shell.newer)} at ${shell.newer} with chsh -s ${shell.newer}` : `${name} ${MINIMUM[name]} or later is needed`;
      rows.push([loginShell() === name ? null : false, name, `${place}, too old, ${fix}`]);
      continue;
    }
    const file = RC[name]!.find((rc) => {
      try {
        return readFileSync(join(homedir(), rc), "utf8").toLowerCase().includes("figxit");
      } catch {
        return false;
      }
    });
    rows.push([file !== undefined, name, file ? `${place}, ${short ? "loaded from" : "set up in"} ~/${file}` : short ? place : `${place}, not set up, ${SHELLS[name]!.setup}`]);
  }
  return rows;
}

function init(shell: string | undefined): number {
  const entry = shell ? SHELLS[shell] : undefined;
  if (!entry) {
    console.error("figxit init: give one of zsh, bash, fish. For example: figxit init zsh");
    return 1;
  }
  const app = bundlePath() ?? appPath();
  if (!app || !existsSync(join(app, "Contents/Resources", entry.file))) {
    console.error("figxit init: Figxit.app with its shell files was not found. Run make build first.");
    return 1;
  }
  console.log(shell === "fish" ? `set -gx FIGXIT_APP ${JSON.stringify(app)}` : `export FIGXIT_APP=${JSON.stringify(app)}`);
  for (const line of entry.lines) console.log(line);
  return 0;
}

async function start(): Promise<number> {
  if (await reachable(HELPER_SOCK)) {
    console.log("figxit is running");
    return 0;
  }
  const app = appPath();
  if (!app) {
    console.error("figxit start: Figxit.app was not found");
    return 1;
  }
  Bun.spawnSync(["open", "-g", app]);
  for (let attempt = 0; attempt < 30; attempt++) {
    await Bun.sleep(100);
    if (await reachable(HELPER_SOCK)) {
      console.log("figxit started");
      return 0;
    }
  }
  console.error("figxit start: the helper did not start");
  return 1;
}

async function stop(): Promise<number> {
  try {
    const socket = await Bun.connect({ unix: HELPER_SOCK, socket: { data() {} } });
    socket.write('{"cmd":"quit"}\n');
    await Bun.sleep(100);
    socket.end();
  } catch {
    console.log("figxit is not running");
    return 0;
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    await Bun.sleep(100);
    if (!(await reachable(HELPER_SOCK)) && !(await reachable(ENGINE_SOCK))) break;
  }
  console.log("figxit stopped");
  return 0;
}

async function doctor(fromApp: boolean, json: boolean): Promise<number> {
  const app = appPath();
  const specs = specsDir();
  let specCount = 0;
  if (specs) {
    try {
      specCount = (await import(join(specs, "index.js"))).default.length;
    } catch {}
  }
  let shells = 0;
  try {
    if (await reachable(ENGINE_SOCK)) shells = Number(readFileSync(join(dirname(ENGINE_SOCK), "shells"), "utf8")) || 0;
  } catch {}
  const login = SHELLS[loginShell()]!;
  const atuin = process.env.FIGXIT_ATUIN_DB ?? join(homedir(), ".local/share/atuin/history.db");
  const checks: [boolean | null, string, string][] = [
    [app !== null, "app bundle", app ?? "not found"],
    [await reachable(HELPER_SOCK), "popup helper", HELPER_SOCK],
    [await reachable(ENGINE_SOCK), "engine", ENGINE_SOCK],
    [specCount > 0, "completion specs", specs ? `${specCount} in ${specs}` : "not found"],
    [existsSync(atuin), "atuin history", existsSync(atuin) ? atuin : "not found, ranking is off"],
    [shells > 0, "shells connected", shells > 0 ? String(shells) : `none, run ${login.reload} in each open terminal`],
  ];
  const shell: [boolean, string, string][] = [
    [true, "popup position", process.env.TMUX ? "from tmux" : "from the terminal, which must report its cursor position"],
    [
      Boolean(process.env.FIGXIT_APP),
      "shell integration",
      process.env.FIGXIT_APP ? "loaded" : `not loaded, ${login.setup}`,
    ],
  ];
  const tmux = Bun.which("tmux", { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` });
  checks.push(...shellRows(json), [tmux !== null, "tmux", tmux ?? "optional"]);
  if (!fromApp) checks.push(...shell);
  if (json) {
    const optional = new Set(["atuin history", "tmux", ...Object.keys(SHELLS)]);
    console.log(JSON.stringify(checks.map(([ok, name, detail]) => ({ level: ok ? "ok" : ok !== null && optional.has(name) ? "off" : "bad", name, detail }))));
    return 0;
  }
  for (const [ok, name, detail] of checks) console.log(`${ok ? "ok  " : "--  "} ${name.padEnd(18)} ${detail}`);
  return checks.slice(0, 1).every(([ok]) => ok) ? 0 : 1;
}

const [command, argument] = process.argv.slice(2);
switch (command) {
  case "daemon":
    await (await import("./daemon")).daemon();
    break;
  case "bridge":
    await (await import("./bridge")).bridge(process.argv.slice(3));
    break;
  case "init":
    process.exit(init(argument));
  case "start":
    process.exit(await start());
  case "stop":
    process.exit(await stop());
  case "doctor":
    process.exit(await doctor(process.argv.includes("--app"), process.argv.includes("--json")));
  case "--version":
  case "-v":
  case "version":
    console.log(version);
    process.exit(0);
  default:
    console.log(HELP);
    process.exit(command === undefined || command === "help" || command === "--help" ? 0 : 1);
}
