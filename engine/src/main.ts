import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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

function shellRows(short: boolean): [boolean, string, string][] {
  const PATH = `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin:/bin`;
  const rows: [boolean, string, string][] = [];
  for (const name of Object.keys(SHELLS)) {
    const path = Bun.which(name, { PATH });
    if (!path) continue;
    const file = RC[name]!.find((rc) => {
      try {
        return readFileSync(join(homedir(), rc), "utf8").toLowerCase().includes("figxit");
      } catch {
        return false;
      }
    });
    rows.push([file !== undefined, name, file ? `${path}, ${short ? "loaded from" : "set up in"} ~/${file}` : short ? path : `${path}, not set up, ${SHELLS[name]!.setup}`]);
  }
  return rows;
}

function loginShell(): string {
  const name = (process.env.SHELL ?? "").split("/").pop() ?? "";
  return SHELLS[name] ? name : "zsh";
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
  const checks: [boolean, string, string][] = [
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
    console.log(JSON.stringify(checks.map(([ok, name, detail]) => ({ level: ok ? "ok" : optional.has(name) ? "off" : "bad", name, detail }))));
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
