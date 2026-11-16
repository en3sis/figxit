import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { figxit } from "../src/figxit/figxit";

const cli = join(import.meta.dir, "../src/main.ts");

test("open launches the app with the menu bar recovery flag and preserves launch failures", () => {
  const work = mkdtempSync(join(tmpdir(), "figxit-open-"));
  try {
    const app = join(work, "App With Spaces.app");
    const args = join(work, "args");
    mkdirSync(app);
    const darwin = process.platform === "darwin";
    const helper = join(app, "Contents/MacOS/figxit-helper");
    if (!darwin) {
      mkdirSync(dirname(helper), { recursive: true });
      writeFileSync(helper, "", { mode: 0o755 });
    }
    const expected = darwin ? `${app}\n--args\n--show-menu-bar\n` : `-f\n${helper}\n--show-menu-bar\n`;
    writeFileSync(join(work, darwin ? "open" : "setsid"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$OPEN_ARGS"\nexit "$OPEN_EXIT"\n', { mode: 0o755 });
    for (const code of [0, 1]) {
      const result = Bun.spawnSync([process.execPath, cli, "open"], {
        env: { ...process.env, FIGXIT_APP: app, FIGXIT_HELPER_SOCK: join(work, "none.sock"), PATH: work, OPEN_ARGS: args, OPEN_EXIT: String(code) },
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(code);
      expect(readFileSync(args, "utf8")).toBe(expected);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "darwin")("on Linux the helper starts as a user service, or else in a session of its own from /", () => {
  const work = mkdtempSync(join(tmpdir(), "figxit-launch-"));
  try {
    const app = join(work, "Figxit.app");
    const helper = join(app, "Contents/MacOS/figxit-helper");
    const bin = join(work, "bin");
    mkdirSync(dirname(helper), { recursive: true });
    mkdirSync(bin);
    writeFileSync(helper, "", { mode: 0o755 });
    writeFileSync(join(bin, "systemd-run"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$WORK/unit"\nexit "$UNIT_EXIT"\n', { mode: 0o755 });
    writeFileSync(join(bin, "setsid"), '#!/bin/sh\n{ pwd; printf "%s\\n" "$@"; } > "$WORK/setsid"\n', { mode: 0o755 });
    const open = (unitExit: number) => {
      rmSync(join(work, "unit"), { force: true });
      rmSync(join(work, "setsid"), { force: true });
      const env: Record<string, string | undefined> = { ...process.env, FIGXIT_APP: app, FIGXIT_HELPER_SOCK: join(work, "none.sock"), PATH: bin, WORK: work, UNIT_EXIT: String(unitExit) };
      env.WAYLAND_DISPLAY = "wayland-test";
      delete env.DISPLAY;
      return Bun.spawnSync([process.execPath, cli, "open"], { env, cwd: work, stdout: "pipe", stderr: "pipe" }).exitCode;
    };

    expect(open(0)).toBe(0);
    const unit = readFileSync(join(work, "unit"), "utf8").trim().split("\n");
    expect(unit.slice(0, 2)).toEqual(["--user", "--unit=figxit-helper"]);
    expect(unit).toContain("--setenv=WAYLAND_DISPLAY");
    expect(unit).not.toContain("--setenv=DISPLAY");
    expect(unit.slice(unit.indexOf("--"))).toEqual(["--", helper, "--show-menu-bar"]);
    expect(existsSync(join(work, "setsid"))).toBe(false);

    expect(open(1)).toBe(0);
    expect(readFileSync(join(work, "setsid"), "utf8")).toBe(`/\n-f\n${helper}\n--show-menu-bar\n`);

    rmSync(helper);
    expect(open(0)).toBe(1);
    expect(existsSync(join(work, "unit"))).toBe(false);
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
