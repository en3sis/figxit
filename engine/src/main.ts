import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { version } from "../package.json";
import { daemon } from "./daemon";
import { appPath, bundlePath, ENGINE_SOCK, HELPER_SOCK, specsDir } from "./paths";

const HELP = `figxit ${version}

Usage:
  figxit init zsh    Print the lines that load figxit in zsh
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

function init(shell: string | undefined): number {
  if (shell !== "zsh") {
    console.error("figxit init: only zsh is supported. Run: figxit init zsh");
    return 1;
  }
  const app = bundlePath() ?? appPath();
  if (!app || !existsSync(join(app, "Contents/Resources/shell/zsh/figxit.zsh"))) {
    console.error("figxit init: Figxit.app with its shell files was not found. Run make build first.");
    return 1;
  }
  console.log(`export FIGXIT_APP=${JSON.stringify(app)}`);
  console.log('source "$FIGXIT_APP/Contents/Resources/shell/zsh/figxit.zsh"');
  console.log('figxit() { "$FIGXIT_APP/Contents/MacOS/figxit-engine" "$@" }');
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

async function doctor(fromApp: boolean): Promise<number> {
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
  const atuin = process.env.FIGXIT_ATUIN_DB ?? join(homedir(), ".local/share/atuin/history.db");
  const checks: [boolean, string, string][] = [
    [app !== null, "app bundle", app ?? "not found"],
    [await reachable(HELPER_SOCK), "popup helper", HELPER_SOCK],
    [await reachable(ENGINE_SOCK), "engine", ENGINE_SOCK],
    [specCount > 0, "completion specs", specs ? `${specCount} in ${specs}` : "not found"],
    [existsSync(atuin), "atuin history", existsSync(atuin) ? atuin : "not found, ranking is off"],
    [shells > 0, "shells connected", shells > 0 ? String(shells) : "none, run exec zsh in each open terminal"],
  ];
  const shell: [boolean, string, string][] = [
    [Bun.which("tmux") !== null, "tmux on PATH", Bun.which("tmux") ?? "not found"],
    [Boolean(process.env.TMUX), "inside tmux", process.env.TMUX ? "yes" : "no, the popup works only inside tmux"],
    [
      Boolean(process.env.FIGXIT_APP),
      "shell integration",
      process.env.FIGXIT_APP ? "loaded" : 'not loaded, add to ~/.zshrc: eval "$(figxit init zsh)"',
    ],
  ];
  if (!fromApp) checks.push(...shell);
  for (const [ok, name, detail] of checks) console.log(`${ok ? "ok  " : "--  "} ${name.padEnd(18)} ${detail}`);
  return checks.slice(0, 1).every(([ok]) => ok) ? 0 : 1;
}

const [command, argument] = process.argv.slice(2);
switch (command) {
  case "daemon":
    await daemon();
    break;
  case "init":
    process.exit(init(argument));
  case "start":
    process.exit(await start());
  case "stop":
    process.exit(await stop());
  case "doctor":
    process.exit(await doctor(argument === "--app"));
  case "--version":
  case "-v":
  case "version":
    console.log(version);
    process.exit(0);
  default:
    console.log(HELP);
    process.exit(command === undefined || command === "help" || command === "--help" ? 0 : 1);
}
