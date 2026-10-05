import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
Bun.spawnSync(["sh", "-c", "git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git branch feature-x"], { cwd: project });
writeFileSync(join(project, "a.txt"), "");
writeFileSync(join(project, "b.txt"), "");
const real = process.env.FIGXIT_E2E_REAL === "1";
const rc = real ? `source $HOME/.zshrc` : `PS1='> '`;
writeFileSync(join(work, ".zshrc"), `${rc}\nsource ${root}/shell/zsh/figxit.zsh\n`);

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
        messages.push(JSON.parse(pending.slice(0, newline)));
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
  FIGXIT_ENGINE: `${process.env.FIGXIT_E2E_ENGINE ?? `bun run ${root}/engine/src/main.ts`} daemon ${work}`,
};
delete env.TMUX;
delete env.TMUX_PANE;

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

try {
  tmux("new-session", "-d", "-s", "main", "-x", "120", "-y", "30", "-c", project, "zsh", "-i");
  await Bun.sleep(real ? 4000 : 1500);
  await keys("", "Enter");
  await Bun.sleep(2500);
  await keys("", "Enter");
  await Bun.sleep(500);

  await keys("make ");
  let show = lastShow();
  check("popup opens after 'make '", !!show, messages);
  check("lists the Makefile targets", show?.items.map((i: any) => i.label).sort().join() === "admin-url,build,deploy,dev", show?.items);
  check("carries the help text", show?.items.find((i: any) => i.label === "dev")?.detail === "Start the stack", show?.items);
  const anchorCol = show?.grid.col;
  check("anchors at the token start", (real || anchorCol === 7) && show?.selected === 0, show?.grid);

  await keys("de");
  show = lastShow();
  const filtered: string[] = show?.items.map((i: any) => i.label) ?? [];
  check("typing filters the list", filtered.slice().sort().join() === "deploy,dev", show?.items);
  check("the anchor column does not move", show?.grid.col === anchorCol, show?.grid);

  await keys("Down");
  check("Down moves the selection", lastShow()?.selected === 1, lastShow());

  await keys("Tab");
  await keys("X");
  check("Tab inserts the selection and a space", screen().includes(`make ${filtered[1]} X`), screen());

  await keys("C-u");
  await keys(" echo hi");
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

  await keys("make ");
  check("popup is open before the window switch", messages.at(-1)?.cmd === "show", messages.at(-1));
  tmux("new-window", "-t", "main", "-c", project, "sleep", "30");
  await Bun.sleep(800);
  check("a tmux window switch hides the popup", messages.at(-1)?.cmd === "hide", messages.slice(-2));
  tmux("kill-window", "-t", "main");
  await Bun.sleep(300);
  await keys("C-u");

  await keys("make ");
  check("popup is open before the pane switch", messages.at(-1)?.cmd === "show", messages.at(-1));
  tmux("split-window", "-t", "main", "-c", project, "zsh", "-i");
  await Bun.sleep(real ? 4000 : 1500);
  await keys("zq");
  check("typing in another pane hides the first popup", messages.at(-1)?.cmd === "hide", messages.slice(-3));
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
