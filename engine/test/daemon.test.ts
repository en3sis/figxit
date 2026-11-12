import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Socket } from "bun";
import { utf16Index } from "../src/daemon";

const SEP = "\x1f";
const line = (...fields: (string | number)[]) => fields.join(SEP);

function lines(receive: (text: string) => void) {
  const decoder = new TextDecoder();
  let pending = "";
  return (chunk: Uint8Array) => {
    pending += decoder.decode(chunk, { stream: true });
    for (let newline: number; (newline = pending.indexOf("\n")) >= 0; pending = pending.slice(newline + 1)) receive(pending.slice(0, newline));
  };
}

async function until<T>(find: () => T | undefined, ms = 8000): Promise<T | undefined> {
  for (const stop = Date.now() + ms; Date.now() < stop; await Bun.sleep(10)) {
    const found = find();
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("the cursor from the shell", () => {
  test("counts characters, and the engine reads it as a UTF-16 index", () => {
    expect(utf16Index("🎉ab", 3)).toBe(4);
    expect(utf16Index("echo 🎉 && make dep ", 19)).toBe(20);
    expect(utf16Index("üé 日本 x", 6)).toBe(6);
    expect(utf16Index("👨‍👩‍👧 x", 6)).toBe(9);
    expect(utf16Index("e\u0301 x", 3)).toBe(3);
    expect(utf16Index("echo 🎉\nmake dep", 15)).toBe(16);
  });

  test("stays inside the line", () => {
    expect(utf16Index("🎉ab", 99)).toBe(4);
    expect(utf16Index("🎉ab", -1)).toBe(0);
    expect(utf16Index("", 3)).toBe(0);
  });
});

describe("daemon", () => {
  const work = mkdtempSync("/tmp/fx");
  const cwd = join(work, "proj");
  const COL = 41;
  const shown: any[] = [];
  const replies: string[] = [];
  let shell: Socket | undefined;
  let daemon: ReturnType<typeof Bun.spawn> | undefined;
  let helper: ReturnType<typeof Bun.listen> | undefined;

  beforeAll(async () => {
    mkdirSync(cwd);
    for (const name of ["日本", "🎉x", "👨‍👩‍👧x", "🇪🇸x", "e\u0301t"]) mkdirSync(join(cwd, name));
    writeFileSync(join(cwd, "Makefile"), "build:\ndeploy:\ndev:\n");
    writeFileSync(join(work, "stopped"), "");
    const fromEngine = lines((reply) => shown.push(JSON.parse(reply)));
    helper = Bun.listen({ unix: join(work, "h.sock"), socket: { data: (_socket, chunk) => fromEngine(chunk) } });
    const env: Record<string, string | undefined> = {
      ...process.env,
      FIGXIT_SOCK: join(work, "e.sock"),
      FIGXIT_HELPER_SOCK: join(work, "h.sock"),
      FIGXIT_ATUIN_DB: join(work, "none.db"),
      FIGXIT_EXTRAS_DIR: join(work, "extras"),
    };
    delete env.FIGXIT_SPECS;
    delete env.FIGXIT_APP;
    daemon = Bun.spawn([process.execPath, join(import.meta.dir, "../src/main.ts"), "daemon", work], { env, stdout: "ignore", stderr: "ignore" });
    const toShell = lines((reply) => {
      const f = reply.split(SEP);
      if (f[0] === "Q") shell?.write(line("C", f[1]!, 5, COL, 120, 30, "") + "\n");
      else replies.push(reply);
    });
    for (const stop = Date.now() + 15000; !shell && Date.now() < stop; await Bun.sleep(50)) {
      shell = await Bun.connect({ unix: join(work, "e.sock"), socket: { data: (_socket, chunk) => toShell(chunk) } }).catch(() => undefined);
    }
    shell?.write(line("H", process.pid, "", "", process.env.PATH ?? "", "") + "\n");
  }, 20000);

  afterAll(() => {
    shell?.end();
    daemon?.kill();
    helper?.stop(true);
    rmSync(work, { recursive: true, force: true });
  });

  function edit(text: string, cursor = [...text].length): number {
    const from = shown.length;
    shell?.write(`${line("E", cursor, cwd, text, "120 30")}\n`);
    return from;
  }

  function type(text: string, cursor = [...text].length): number {
    shell?.write("L\n");
    return edit(text, cursor);
  }

  const show = (from: number) => until(() => shown.slice(from).find((message) => message.cmd === "show"));

  function accept(): Promise<string | undefined> {
    const from = replies.length;
    shell?.write("A\n");
    return until(() => replies.slice(from).find((reply) => reply.startsWith(`A${SEP}`)));
  }

  test("an emoji before the word: the popup completes the word and Tab replaces only the word", async () => {
    const message = await show(type("echo 🎉 && make dep"));
    expect(message?.items.map((item: any) => item.label)).toEqual(["deploy"]);
    expect([message?.grid.col, message?.caret]).toEqual([COL - 1 - 3, 3]);
    expect(await accept()).toBe(line("A", 3, "deploy "));
  }, 20000);

  test("an emoji before a space: the popup lists what comes next", async () => {
    const message = await show(type("echo 🎉 && make "));
    expect(message?.items.map((item: any) => item.label)).toEqual(["build", "deploy", "dev"]);
    expect(await accept()).toBe(line("A", 0, "build "));
  }, 20000);

  test("an emoji before a finished word: the popup closes, and Tab changes nothing", async () => {
    expect((await show(type("echo 🎉 && make dep")))?.items[0]?.label).toBe("deploy");
    const from = edit("echo 🎉 && make dep ");
    expect(await until(() => shown.slice(from).find((message) => message.cmd === "hide"))).toBeDefined();
    expect(await accept()).toBe(line("A", -1, ""));
  }, 20000);

  for (const [name, word, folder, chars, cells] of [
    ["a CJK letter", "日", "日本/", 1, 2],
    ["an emoji", "🎉", "🎉x/", 1, 2],
    ["a family emoji", "👨‍👩‍👧", "👨‍👩‍👧x/", 5, 2],
    ["a flag", "🇪🇸", "🇪🇸x/", 2, 2],
    ["a combining accent", "e\u0301", "e\u0301t/", 2, 1],
  ] as const) {
    test(`a word with ${name}: Tab removes it in characters, and the popup starts its width left of the cursor`, async () => {
      const message = await show(type(`cd ${word}`));
      expect(message?.items[0]?.label).toBe(folder);
      expect([message?.grid.col, message?.caret]).toEqual([COL - 1 - cells, cells]);
      expect(await accept()).toBe(line("A", chars, folder));
    }, 20000);
  }

  test("after a command name, the popup starts one cell right of the cursor", async () => {
    const message = await show(type("make"));
    expect(message?.items[0]?.label).toBe("make");
    expect([message?.grid.col, message?.caret]).toEqual([COL, -1]);
  }, 20000);

  test("a cursor past the end of the line is read as the end", async () => {
    const message = await show(type("cd 🎉", 99));
    expect(message?.items[0]?.label).toBe("🎉x/");
    expect(await accept()).toBe(line("A", 1, "🎉x/"));
  }, 20000);
});
