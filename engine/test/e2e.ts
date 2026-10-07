import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const work = mkdtempSync("/tmp/fx-");
const engineSock = join(work, "e.sock");
const helperSock = join(work, "h.sock");
const tmuxName = `figxit-e2e-${process.pid}`;
const project = join(work, "proj");
const messages: any[] = [];
const failures: string[] = [];

await Bun.$`mkdir -p ${project}`;
writeFileSync(join(project, "Makefile"), "admin-url:\nbuild:\ndeploy:\ndev: ## Start the stack\n");
Bun.spawnSync(["sh", "-c", "git init -q -b main && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m init && git branch feature-x"], { cwd: project });
writeFileSync(join(project, "a.txt"), "");
writeFileSync(join(project, "b.txt"), "");
const real = process.env.FIGXIT_E2E_REAL === "1";
const plain = process.env.FIGXIT_E2E_PLAIN === "1";
const name = process.env.FIGXIT_E2E_SHELL ?? "zsh";
const engine = process.env.FIGXIT_E2E_ENGINE ?? `bun run ${root}/engine/src/main.ts`;
const bash = existsSync("/opt/homebrew/bin/bash") ? "/opt/homebrew/bin/bash" : "bash";
const launch: Record<string, string[]> = {
  zsh: ["zsh", "-i"],
  bash: [bash, "--noprofile", "--rcfile", join(work, ".bashrc"), "-i"],
  fish: ["fish", "-i"],
};
if (!launch[name]) throw new Error(`unknown shell ${name}`);
const shell = plain ? ["env", "-u", "TMUX", "-u", "TMUX_PANE", ...launch[name]] : launch[name];
const rc = real ? `source $HOME/.zshrc` : `PS1='> '`;
writeFileSync(join(work, ".zshrc"), `${rc}\nsource ${root}/shell/zsh/figxit.zsh\n`);
mkdirSync(join(work, "config/fish"), { recursive: true });
writeFileSync(
  join(work, "config/fish/config.fish"),
  `set -g fish_greeting\nset -g fish_autosuggestion_enabled 0\nfunction fish_prompt; echo -n '> '; end\nsource ${root}/shell/fish/figxit.fish\n`,
);
writeFileSync(join(work, ".bashrc"), `HISTFILE=${work}/history\nPS1='> '\nsource ${root}/shell/bash/figxit.bash\n`);

let pending = "";
const helperClients = new Set<any>();
const fakeHelper = Bun.listen({
  unix: helperSock,
  socket: {
    open(socket) {
      helperClients.add(socket);
    },
    close(socket) {
      helperClients.delete(socket);
    },
    data(socket, chunk) {
      pending += chunk.toString();
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        messages.push({ ...JSON.parse(pending.slice(0, newline)), at: performance.now() });
        pending = pending.slice(newline + 1);
        socket.write('{"ok":true}\n');
      }
    },
  },
});

const env: Record<string, string | undefined> = {
  ...process.env,
  ZDOTDIR: work,
  ...(real ? {} : { FIGXIT_ATUIN_DB: join(work, "none.db") }),
  FIGXIT_AUTOSTART: "1",
  FIGXIT_SOCK: engineSock,
  FIGXIT_HELPER_SOCK: helperSock,
  FIGXIT_ENGINE: `${engine} daemon ${work}`,
  FIGXIT_BRIDGE: `${engine} bridge ${work}`,
  INPUTRC: "/dev/null",
  ...(name === "fish" ? { XDG_CONFIG_HOME: join(work, "config"), XDG_DATA_HOME: join(work, "data") } : {}),
};
delete env.TMUX;
delete env.TMUX_PANE;
delete env.FIGXIT_APP;

const tmux = (...args: string[]) =>
  Bun.spawnSync(["tmux", "-L", tmuxName, "-f", "/dev/null", ...args], { env, stdout: "pipe", stderr: "pipe" });
const keys = async (...args: string[]) => {
  tmux("send-keys", "-t", "main", ...args);
  await Bun.sleep(400);
};
const screen = () => tmux("capture-pane", "-p", "-t", "main").stdout.toString().trimEnd();
const lastShow = () => messages.filter((m) => m.cmd === "show").at(-1);
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

console.log(`${name}, ${plain ? "no tmux geometry" : "tmux"}`);
try {
  tmux("new-session", "-d", "-s", "main", "-x", "120", "-y", "30", "-c", project, ...shell);
  await Bun.sleep(real ? 4000 : 1500);
  const connected = async () => (await Bun.file(join(work, "shells")).text().catch(() => "")).trim() === "1";
  for (let tries = 0; tries < 20 && !(await connected()); tries++) {
    await keys("", "Enter");
    await Bun.sleep(600);
  }
  await keys("C-l");
  await keys("", "Enter");
  await keys("", "Enter");
  await Bun.sleep(500);

  await keys("make ");
  let show = lastShow();
  check("popup opens after 'make '", !!show, messages);
  check("the engine counts the connected shell", await connected());
  check("lists the Makefile targets", show?.items.map((i: any) => i.label).sort().join() === "admin-url,build,deploy,dev", show?.items);
  check("carries the help text", show?.items.find((i: any) => i.label === "dev")?.detail === "Start the stack", show?.items);
  const anchorCol = show?.grid.col;
  check("anchors at the token start", real || anchorCol === 7, show?.grid);
  check("no row is highlighted before a letter or an arrow key", show?.selected === -1, show);

  await keys("de");
  show = lastShow();
  const filtered: string[] = show?.items.map((i: any) => i.label) ?? [];
  check("typing filters the list", filtered.slice().sort().join() === "deploy,dev", show?.items);
  check("the anchor column does not move", show?.grid.col === anchorCol, show?.grid);
  if (plain) {
    check("the shell reports the cursor cell", show?.grid.pane === true && (real || show?.grid.row === 2) && show?.grid.cols === 120 && show?.grid.rows === 30, show?.grid);
    await keys("C-u");
    await keys("make dev extra words typed in one burst");
    check("a burst of keys arrives complete and in order", /^\S+ make dev extra words typed in one burst( |$)/.test(screen().split("\n").at(-1) ?? ""), screen());
    await keys("C-u");
    await keys("make de");
  }

  await keys("Down");
  check("Down moves the selection", lastShow()?.selected === 1, lastShow());

  await keys("Tab");
  await keys("X");
  check("Tab inserts the selection and a space", screen().includes(`make ${filtered[1]} X`), screen());

  await keys("C-u");
  await keys("make dep");
  await keys("Enter");
  check("Enter inserts the highlighted target and runs the line", screen().includes("for `deploy'"), screen());
  writeFileSync(join(work, "enter-inserts"), "");
  await keys("make bu");
  await keys("Enter");
  check("with the setting off, Enter inserts the highlighted target and does not run", (screen().split("\n").at(-1) ?? "").includes("make build") && !screen().includes("for `build'"), screen());
  await keys("Enter");
  check("a second Enter runs the line", screen().includes("for `build'"), screen());
  rmSync(join(work, "enter-inserts"));

  await keys("make build");
  check("a complete target shows a run row first", lastShow()?.items[0]?.label === "build" && lastShow()?.items[0]?.icon === "sf:return", lastShow()?.items);
  await keys("C-u");

  await keys("make build ");
  check("no second list after a target", messages.at(-1)?.cmd === "hide", messages.slice(-3));
  await keys("C-u");

  await keys(name === "fish" ? "echo hi" : " echo hi");
  const before = messages.length;
  await keys("Enter");
  check("Enter runs the line", screen().includes("\nhi"), screen());
  check("the popup is hidden after the line", messages.at(-1)?.cmd === "hide", messages.slice(before));

  await keys("bun ");
  await Bun.sleep(600);
  let names: string[] = lastShow()?.items.map((i: any) => i.label) ?? [];
  check("bun lists spec subcommands", names.includes("add") && names.includes("build"), names);
  check("bun shows no scripts from other projects", !names.some((n) => n === "ios" || n.includes(":")), names);
  check("spec rows carry an icon", lastShow()?.items.every((i: any) => i.icon === "brand:bun"), lastShow()?.items);
  await keys("C-u");

  await keys("git checkout ");
  await Bun.sleep(900);
  names = lastShow()?.items.map((i: any) => i.label) ?? [];
  check("git checkout lists branches", names.includes("feature-x"), names);
  await keys("C-u");

  await keys("docker run --na");
  names = lastShow()?.items.map((i: any) => i.label) ?? [];
  check("docker run lists options", names[0] === "--name", names);
  await keys("Tab");
  await keys("X");
  check("an option is inserted with a space", screen().includes("docker run --name X"), screen());
  await keys("C-u");

  if (real) {
    await keys(" zzqx ./");
    check("no popup for a path", messages.at(-1)?.cmd === "hide", messages.at(-1));
    await keys("Tab");
    await Bun.sleep(800);
    const menu = screen();
    check("Tab opens the fzf-tab menu when hidden", menu.includes("a.txt") && menu.includes("b.txt") && !/nested|not found|error/i.test(menu), menu);
    await keys("Escape");
    await keys("C-u");
  } else {
    await keys("Up");
    check("Up falls back to history when hidden", /> +echo hi$/.test(screen()), screen());
    await keys("C-u");
  }

  await keys("make ");
  check("popup is open before the helper hides it", messages.at(-1)?.cmd === "show", messages.at(-1));
  for (const client of helperClients) client.write('{"event":"hidden"}\n');
  await Bun.sleep(300);
  const count = messages.length;
  await keys("Down");
  check("keys leave the popup alone after the helper hid it", messages.length === count, messages.slice(count));
  await keys("C-c");

  if (!plain) {
    await keys("make ");
    check("popup is open before the window switch", messages.at(-1)?.cmd === "show", messages.at(-1));
    tmux("new-window", "-t", "main", "-c", project, "sleep", "30");
    await Bun.sleep(800);
    check("a tmux window switch hides the popup", messages.at(-1)?.cmd === "hide", messages.slice(-2));
    tmux("kill-window", "-t", "main");
    await Bun.sleep(300);
    await keys("C-u");
  }

  await keys("make ");
  check("popup is open before the pane switch", messages.at(-1)?.cmd === "show", messages.at(-1));
  tmux("split-window", "-t", "main", "-c", project, ...shell);
  await Bun.sleep(real ? 4000 : 1500);
  await keys("zq");
  check("typing in another pane hides the first popup", messages.at(-1)?.cmd === "hide", messages.slice(-3));
  await keys("C-u");

  if (name !== "zsh") {
    Bun.spawnSync(["pkill", "-9", "-f", `bridge ${work}`]);
    await Bun.sleep(300);
    await keys("echo still here");
    await keys("Enter");
    const after = screen();
    check("typing and Enter work after the bridge is killed", /^still here$/m.test(after) && !/pipe|warning|error/i.test(after), after);
    await Bun.sleep(3200);
    await keys("", "Enter");
    await Bun.sleep(1500);
    await keys("make ");
    check("the popup returns when the bridge starts again", messages.at(-1)?.cmd === "show", messages.slice(-2));
    await keys("C-u");
  }

  const word: number[] = [];
  const letter: number[] = [];
  const timed = async (key: string, into: number[]) => {
    const from = messages.length;
    const start = performance.now();
    await keys(key);
    const shown = messages.slice(from).find((m) => m.cmd === "show");
    if (shown) into.push(shown.at - start);
  };
  for (let round = 0; round < 7; round++) {
    await keys("make");
    await timed("Space", word);
    await timed("d", letter);
    await keys("C-u");
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]?.toFixed(1);
  console.log(`     key to show, median of 7, includes tmux send-keys: new word ${median(word)} ms, next letter ${median(letter)} ms`);

  await keys("C-u");
  await keys("make ");
  await keys("Down");
  check("the first Down highlights the first row", lastShow()?.selected === 0, lastShow());
  await keys("Down");
  check("the second Down moves to the second row", lastShow()?.selected === 1, lastShow());
  await keys("C-u");
  await keys("make ");
  const firstRow = lastShow()?.items[0]?.label;
  check("the first row is not highlighted again after a new line", lastShow()?.selected === -1, lastShow());
  await keys("Tab");
  check("Tab inserts the first row when no row is highlighted", new RegExp(`> +make ${firstRow}( |$)`).test(screen().split("\n").at(-1) ?? ""), screen());

  await keys("C-u");
  await keys("echo esc-marker");
  await keys("Enter");
  await keys("make ");
  check("the popup is open before Escape", messages.at(-1)?.cmd === "show", messages.slice(-2));
  await keys("Escape");
  await Bun.sleep(800);
  check("Escape closes the popup", messages.at(-1)?.cmd === "hide", messages.slice(-2));
  await keys("Up");
  check("Up falls back to history after Escape", name === "fish" ? /> +make\S*/.test(screen()) : /> +echo esc-marker$/.test(screen()), screen());
  await keys("C-u");

  await keys("Escape");
  await keys("echo esc-ok");
  await keys("Enter");
  check("the shell works after an Escape with the popup closed", screen().includes("esc-ok") && !/error|not found/i.test(screen()), screen());

  if (name === "zsh") {
    await keys("bindkey -v");
    await keys("Enter");
    await keys("make ");
    check("vi mode: the popup is open before Escape", messages.at(-1)?.cmd === "show", messages.slice(-2));
    await keys("Escape");
    await Bun.sleep(800);
    check("vi mode: Escape closes the popup, and it stays closed in command mode", messages.at(-1)?.cmd === "hide", messages.slice(-2));
    await keys("ddiecho vi-ok");
    await keys("Enter");
    check("vi mode: the same Escape goes to command mode", /^vi-ok$/m.test(screen()), screen());
  }
} finally {
  tmux("kill-server");
  Bun.spawnSync(["pkill", "-f", `daemon ${work}`]);
  fakeHelper.stop(true);
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
