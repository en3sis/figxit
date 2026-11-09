import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
