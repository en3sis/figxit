import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { figxit } from "../src/figxit/figxit";

const cli = join(import.meta.dir, "../src/main.ts");

test("open launches the app with the menu bar recovery flag and preserves launch failures", () => {
  const work = mkdtempSync(join(tmpdir(), "figxit-open-"));
  try {
    const app = join(work, "App With Spaces.app");
    const args = join(work, "args");
    mkdirSync(app);
    writeFileSync(join(work, "open"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$OPEN_ARGS"\nexit "$OPEN_EXIT"\n', { mode: 0o755 });
    for (const code of [0, 1]) {
      const result = Bun.spawnSync([process.execPath, cli, "open"], {
        env: { ...process.env, FIGXIT_APP: app, FIGXIT_HELPER_SOCK: join(work, "none.sock"), PATH: work, OPEN_ARGS: args, OPEN_EXIT: String(code) },
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(code);
      expect(readFileSync(args, "utf8")).toBe(`${app}\n--args\n--show-menu-bar\n`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("open asks a running app to show its icon and Settings instead of relaunching it", async () => {
  const work = mkdtempSync("/tmp/fx");
  const received: string[] = [];
  const server = Bun.listen({
    unix: join(work, "h.sock"),
    socket: { data(_, chunk) { received.push(chunk.toString()); } },
  });
  try {
    writeFileSync(join(work, "open"), "#!/bin/sh\nexit 9\n", { mode: 0o755 });
    const run = Bun.spawn([process.execPath, cli, "open"], {
      env: { ...process.env, FIGXIT_HELPER_SOCK: join(work, "h.sock"), PATH: work },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await run.exited).toBe(0);
    expect(received.join("")).toBe('{"cmd":"open"}\n');
  } finally {
    server.stop(true);
    rmSync(work, { recursive: true, force: true });
  }
});

test("help and completions expose the open command", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--help"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("figxit open");
  expect(figxit.subcommands?.some((command) => command.name === "open")).toBe(true);
});

test("doctor says which user spec it skips and why", () => {
  const work = mkdtempSync(join(tmpdir(), "figxit-doctor-"));
  try {
    const specs = join(work, "specs");
    mkdirSync(join(specs, "open"), { recursive: true, mode: 0o755 });
    writeFileSync(join(specs, "good.js"), "export default {};\n", { mode: 0o644 });
    writeFileSync(join(specs, "open/tool.js"), "export default {};\n", { mode: 0o644 });
    chmodSync(join(specs, "open"), 0o777);
    writeFileSync(join(work, "aliases"), "k=kubectl\n", { mode: 0o644 });
    const result = Bun.spawnSync([process.execPath, cli, "doctor", "--app", "--json"], {
      env: { ...process.env, FIGXIT_USER_SPECS: specs, FIGXIT_USER_ALIASES: join(work, "aliases"), FIGXIT_SOCK: join(work, "e.sock"), FIGXIT_HELPER_SOCK: join(work, "h.sock") },
      stdout: "pipe", stderr: "pipe",
    });
    const rows = JSON.parse(result.stdout.toString()).filter((row: { name: string }) => row.name.startsWith("user "));
    expect(rows).toEqual([
      { level: "bad", name: "user specs", detail: `open/tool.js skipped: ${realpathSync(join(specs, "open"))} is writable by everyone` },
      { level: "ok", name: "user aliases", detail: join(work, "aliases") },
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
