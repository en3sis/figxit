import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const work = mkdtempSync(join(tmpdir(), "figxit-shell-"));
const ESC = "\x1b";
const ITERM = `${ESC}[4;777;987t${ESC}]1337;ReportCellSize=21.0;8.0;1.0${ESC}\\`;
const ITERM_BOTH = `${ESC}[4;777;987t${ESC}[6;21;8t${ESC}]1337;ReportCellSize=20.5;8.0\x07`;
const PLAIN = `${ESC}[4;600;960t${ESC}[6;20;8t`;
const END = `${ESC}[0n`;

function body(file: string, name: string): string {
  const found = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, "m").exec(readFileSync(join(root, file), "utf8"));
  if (!found) throw new Error(`${name} is not in ${file}`);
  return found[0];
}

function result(out: string): { sent: string; left: string } {
  return { sent: /SENT ([^\r\n]*)/.exec(out)?.[1] ?? "", left: /LEFT \[([^\]]*)\]/.exec(out)?.[1] ?? "" };
}

const bash = ["/opt/homebrew/bin/bash", "/usr/local/bin/bash", Bun.which("bash") ?? ""].find((path) => {
  if (!path) return false;
  try {
    return Number(/version (\d+)/.exec(Bun.spawnSync([path, "--version"]).stdout.toString())?.[1]) >= 5;
  } catch {
    return false;
  }
});

describe("zsh reply reader", () => {
  const script = join(work, "report.zsh");
  writeFileSync(
    script,
    [
      "zmodload zsh/datetime",
      "typeset -g _figxit_sep=$'\\x1f' _figxit_asked=${FX_ASKED-7} _figxit_cell= _figxit_typed=",
      "typeset -gi _figxit_reports=${FX_REPORTS:-1} _figxit_seen=${FX_SEEN:-0} _figxit_ends=${FX_ENDS:-1}",
      "typeset -gF _figxit_wait=${FX_WAIT:-1}",
      "COLUMNS=120 LINES=35",
      '_figxit_send() { print -r -- "SENT ${1//$_figxit_sep/|}" }',
      body("shell/zsh/cursor.zsh", "_figxit_report"),
      "print -r -- READY",
      "repeat ${FX_RUNS:-1}; do",
      "  _figxit_report $FX_MODE",
      '  print -r -- "LEFT [$REPLY] REPORTS $_figxit_reports STATUS $?"',
      "  _figxit_asked=${_figxit_asked:-8}",
      "done",
      "local rest= c",
      "while read -s -k 1 -t 0.3 c; do rest+=$c; done",
      'print -r -- "REST [$rest]"',
      'print -r -- "TYPED [$_figxit_typed] ENDS $_figxit_ends"',
      "",
    ].join("\n"),
  );

  const STATES: Record<string, string> = { "1": "on", "0": "paused", "-1": "off" };

  async function read(chunks: (string | number)[], env: Record<string, string> = {}) {
    let out = "";
    const started = performance.now();
    let answered = 0;
    const proc = Bun.spawn(["zsh", "-f", script], {
      env: { ...process.env, ...env },
      terminal: {
        cols: 120,
        rows: 35,
        data: (_terminal, data) => {
          out += Buffer.from(data).toString("latin1");
          if (!answered && out.includes("LEFT [")) answered = performance.now() - started;
        },
      },
    });
    for (const stop = performance.now() + 10000; !out.includes("READY") && performance.now() < stop; ) await Bun.sleep(5);
    for (const chunk of chunks) {
      if (typeof chunk === "number") await Bun.sleep(chunk);
      else proc.terminal!.write(chunk);
    }
    await proc.exited;
    proc.terminal!.close();
    return {
      sent: [...out.matchAll(/SENT ([^\r\n]*)/g)].map((m) => m[1]),
      left: [...out.matchAll(/LEFT \[([^\]]*)\] REPORTS (-?\d)/g)].map((m) => `${m[1]} ${STATES[m[2]!]}`),
      rest: /REST \[([^\]]*)\]/.exec(out)?.[1],
      typed: /TYPED \[([^\]]*)\]/.exec(out)?.[1],
      ends: /ENDS (\d)/.exec(out)?.[1],
      status: [...out.matchAll(/STATUS (\d+)/g)].map((m) => Number(m[1])),
      marked: out.includes(`${ESC}[5n`),
      answered,
    };
  }

  test("takes the cell size from ReportCellSize and gives back the typed keys", async () => {
    const { sent, left } = await read([`64;1;2c${ITERM}ab${ESC}[25;3R${END}`]);
    expect({ sent, left }).toEqual({ sent: ["C|7|25|3|120|35|21.0|8.0|777|987"], left: ["ab on"] });
  });

  test("prefers ReportCellSize to the 16t reply", async () => {
    const { sent, left } = await read([`64;1;2c${ITERM_BOTH}${ESC}[2;1R${END}`]);
    expect({ sent, left }).toEqual({ sent: ["C|7|2|1|120|35|20.5|8.0|777|987"], left: [" on"] });
  });

  test("reads the 14t and 16t replies of other terminals", async () => {
    const { sent, left } = await read([`62c${PLAIN}z${ESC}[12;34R${END}`]);
    expect({ sent, left }).toEqual({ sent: ["C|7|12|34|120|35|20|8|600|960"], left: ["z on"] });
  });

  test("answers as soon as the cursor position arrives, without waiting for the end marker", async () => {
    const { sent, answered } = await read([`62c${ESC}[5;12R`]);
    expect(sent).toEqual(["C|7|5|12|120|35|"]);
    expect(answered).toBeLessThan(500);
  });

  test("before a command runs, reads the reply up to the end marker", async () => {
    const { sent, rest } = await read([`${ESC}[?62c${ESC}[5;12R${END}x`], { FX_MODE: "drain" });
    expect({ sent, rest }).toEqual({ sent: ["C|7|5|12|120|35|"], rest: "x" });
  });

  test("waits for a cursor position that comes 300 ms after the first reply", async () => {
    const { sent, left } = await read(["62c", 300, `${ESC}[5;12R${END}`]);
    expect({ sent, left }).toEqual({ sent: ["C|7|5|12|120|35|"], left: [" on"] });
  });

  test("keeps reports on after a reply that comes too late", async () => {
    const { sent, left } = await read(["62c", 250, `62c${ESC}[5;12R${END}`], { FX_WAIT: "0.2", FX_RUNS: "2", FX_SEEN: "1" });
    expect({ sent, left }).toEqual({ sent: ["C|7", "C|8|5|12|120|35|"], left: [" on", " on"] });
  });

  test("pauses reports until the next prompt when the first reply of a new shell comes too late", async () => {
    const { left } = await read(["62c"], { FX_WAIT: "0.2" });
    expect(left).toEqual([" paused"]);
  });

  test("keeps a lone Esc at the end of a reply cut off by the time limit, and drops a cut-off sequence", async () => {
    const esc = await read([`62cx${ESC}`], { FX_WAIT: "0.2" });
    const cut = await read([`62cx${ESC}[5;1`], { FX_WAIT: "0.2" });
    expect([esc.left, cut.left]).toEqual([[`x${ESC} paused`], ["x paused"]]);
  });

  test("turns reports off when the terminal answers without a cursor position", async () => {
    const { sent, left } = await read([`62cxy${END}`]);
    expect({ sent, left }).toEqual({ sent: ["C|7"], left: ["xy off"] });
  });

  test("turns reports off when the terminal does not answer at all", async () => {
    const { left } = await read([], { FX_WAIT: "0.2", FX_MODE: "drain" });
    expect(left).toEqual([" off"]);
  });

  test("turns reports back on when a reply comes after the shell stopped asking", async () => {
    const { sent, left } = await read([`62c${ESC}[5;12R${END}`], { FX_REPORTS: "-1", FX_ASKED: "" });
    expect({ sent, left }).toEqual({ sent: [], left: [" on"] });
  });

  test("right after asking, reads the end marker that follows the cursor position", async () => {
    const { sent, left, rest } = await read([`${ESC}[?62c${ESC}[5;12R`, 100, `${END}x`], { FX_MODE: "ask" });
    expect({ sent, left, rest }).toEqual({ sent: ["C|7|5|12|120|35|"], left: [" on"], rest: "x" });
  });

  test("right after asking, keeps the keys typed before and inside the reply until the end marker comes", async () => {
    const { sent, left, rest, typed } = await read([`cd${ESC}[?62c${PLAIN}e${ESC}[5;12R${END}`], { FX_MODE: "ask" });
    expect({ sent, left, rest, typed }).toEqual({ sent: ["C|7|5|12|120|35|20|8|600|960"], left: [" on"], rest: END, typed: "cde" });
  });

  test("right after asking, keeps a lone Esc typed before or inside the reply", async () => {
    const { sent, rest, typed } = await read([`${ESC}${ESC}[?62c${ESC}${ESC}[5;12R${END}`], { FX_MODE: "ask" });
    expect({ sent, rest, typed }).toEqual({ sent: ["C|7|5|12|120|35|"], rest: END, typed: `${ESC}${ESC}` });
  });

  test("right after asking, holds keys typed just before the end marker and asks for a new marker", async () => {
    const { left, rest, typed, marked } = await read([`${ESC}[?62c${ESC}[5;12R`, 50, "x", 50, `${END}`], { FX_MODE: "ask" });
    expect({ left, rest, typed, marked }).toEqual({ left: [" on"], rest: "", typed: "x", marked: true });
  });

  test("right after asking, waits past the time limit for a reply that comes after typed keys", async () => {
    const { sent, left, rest, typed } = await read(["ab", 400, `${ESC}[?62c${ESC}[5;12R${END}`], { FX_MODE: "ask", FX_WAIT: "0.2", FX_SEEN: "1" });
    expect({ sent, left, rest, typed }).toEqual({ sent: ["C|7|5|12|120|35|"], left: [" on"], rest: END, typed: "ab" });
  });

  test("right after asking, stops at the time limit when nothing comes", async () => {
    const { sent, left, rest, typed } = await read([400, `${ESC}[?62c${ESC}[5;12R${END}`], { FX_MODE: "ask", FX_WAIT: "0.2", FX_SEEN: "1" });
    expect({ sent, left, rest, typed }).toEqual({ sent: ["C|7"], left: [" on"], rest: `${ESC}[?62c${ESC}[5;12R${END}`, typed: "" });
  });

  test("right after asking, waits past the time limit for an end marker that comes after typed keys", async () => {
    const { left, rest, typed, marked } = await read([`${ESC}[?62c${ESC}[5;12R`, 50, "x", 350, END], { FX_MODE: "ask", FX_WAIT: "0.2" });
    expect({ left, rest, typed, marked }).toEqual({ left: [" on"], rest: "", typed: "x", marked: true });
  });

  test("right after asking, holds keys and asks for a new end marker when the reply has no position", async () => {
    const { sent, left, typed, marked } = await read([`xy${ESC}[?62c${END}`], { FX_MODE: "ask" });
    expect({ sent, left, typed, marked }).toEqual({ sent: ["C|7"], left: [" off"], typed: "xy", marked: true });
  });

  test("right after asking, Ctrl-C still reads a late reply and reports the interrupt", async () => {
    const { sent, left, rest, status } = await read([50, "\x03", 400, `${ESC}[?62c${ESC}[5;12R${END}`], { FX_MODE: "ask", FX_WAIT: "0.2", FX_SEEN: "1" });
    expect({ sent, left, rest, status }).toEqual({ sent: ["C|7|5|12|120|35|"], left: [" on"], rest: END, status: [1] });
  });

  test("right after asking, a second Ctrl-C ends the wait after the time limit", async () => {
    const { sent, typed, status, answered } = await read(["ab", 300, "\x03", 100, "\x03"], { FX_MODE: "ask", FX_WAIT: "0.2", FX_SEEN: "1" });
    expect({ sent, typed, status }).toEqual({ sent: ["C|7"], typed: "ab", status: [1] });
    expect(answered).toBeGreaterThan(550);
    expect(answered).toBeLessThan(2000);
  });

  test("stops waiting for end markers after a reply without one", async () => {
    const { sent, ends } = await read([`${ESC}[?62c${ESC}[5;12R`, 400, `${ESC}[?62c${ESC}[5;12R`], { FX_MODE: "ask", FX_WAIT: "0.3", FX_RUNS: "2" });
    expect({ sent, ends }).toEqual({ sent: ["C|7|5|12|120|35|", "C|8|5|12|120|35|"], ends: "0" });
  });
});

describe("zsh cursor query", () => {
  const dir = join(work, "query");
  const fifo = join(dir, "engine");
  const rc = join(dir, "rc.zsh");
  const figxit = readFileSync(join(root, "shell/zsh/figxit.zsh"), "utf8");
  mkdirSync(dir);
  for (const name of ["a1", "a2", "a3"]) writeFileSync(join(dir, name), "");
  Bun.spawnSync(["mkfifo", fifo]);
  writeFileSync(
    rc,
    [
      "PS1='> '",
      "zmodload zsh/complist zsh/datetime",
      "autoload -Uz compinit && compinit -D -u",
      "zstyle ':completion:*' menu select",
      "bindkey -e",
      "typeset -g _figxit_sep=$'\\x1f' _figxit_asked= _figxit_size= _figxit_cell= _figxit_typed=",
      "typeset -gF _figxit_asked_at=0 _figxit_wait=${FX_WAIT:-5}",
      "typeset -gi _figxit_reports=1 _figxit_seen=0 _figxit_ends=0 _figxit_visible=0",
      "typeset -g _figxit_last= _figxit_fd= _figxit_sock=$PWD/none.sock",
      `source ${root}/shell/zsh/connect.zsh`,
      `source ${root}/shell/zsh/cursor.zsh`,
      `source ${root}/shell/zsh/hooks.zsh`,
      "_figxit_connect() { return 0 }",
      "_figxit_bind() { }",
      // figxit's own key bindings, with stand-ins for a plain Esc and for an Esc Esc binding like the sudo plugin's
      "if [[ -n $FX_KEYS ]]; then",
      `  source ${root}/shell/zsh/keys.zsh`,
      `  source ${root}/shell/zsh/bind.zsh`,
      "  typeset -gA _figxit_orig _figxit_base",
      /^typeset -gA _figxit_keys=\([\s\S]*?^\)$/m.exec(figxit)![0],
      ...figxit.match(/^zle -N .*$/gm)!,
      "  _fx_esc() { print -r -- ESC >> $FX_OUT }",
      '  _fx_sudo() { if [[ $BUFFER == "sudo "* ]]; then LBUFFER=${LBUFFER#sudo }; else LBUFFER="sudo $LBUFFER"; fi }',
      "  zle -N _fx_esc",
      "  zle -N _fx_sudo",
      "  bindkey '\\e' _fx_esc",
      "  bindkey '\\e\\e' _fx_sudo",
      "  KEYTIMEOUT=100",
      "fi",
      '_figxit_send() { [[ $1 == C* ]] && print -r -- "SENT ${1//$_figxit_sep/|}" >> $FX_OUT }',
      'preexec() { print -r -- "RAN $1" >> $FX_OUT }',
      '_fx_line() { print -r -- "LINE [$BUFFER] REPORTS $_figxit_reports" >> $FX_OUT }',
      "zle -N _figxit_recv",
      "zle -N figxit-report",
      "zle -N figxit-report-end",
      "zle -N _fx_line",
      "bindkey '^[[?' figxit-report",
      "bindkey '^[[0n' figxit-report-end",
      "bindkey '^[[24~' _fx_line",
      "zle -N zle-line-init _figxit_line_init",
      "zle -N zle-line-pre-redraw _figxit_redraw",
      `exec {fd}<>${fifo}`,
      "zle -F -w $fd _figxit_recv",
      "print -r -- READY >> $FX_OUT",
      "",
    ].join("\n"),
  );

  const reply = (query: string) =>
    `${ESC}[?62;22c${query.includes(`${ESC}[14t`) ? PLAIN : ""}${ESC}[5;12R${END}`;

  async function start(env: Record<string, string> = {}) {
    const out = join(dir, `out-${Math.random().toString(36).slice(2)}`);
    writeFileSync(out, "");
    let screen = "";
    const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("FIGXIT_")));
    const proc = Bun.spawn(["zsh", "-f", "-i"], {
      cwd: dir,
      env: { ...clean, ...env, FX_OUT: out },
      terminal: {
        cols: 120,
        rows: 35,
        data: (_terminal, data) => {
          screen += Buffer.from(data).toString("latin1");
        },
      },
    });
    const lines = () => readFileSync(out, "utf8").split("\n").filter(Boolean);
    const until = async (what: string, ok: () => boolean, ms = 10000) => {
      for (const stop = performance.now() + ms; !ok(); await Bun.sleep(10)) {
        if (performance.now() > stop) throw new Error(`no ${what}: ${JSON.stringify(lines())} ${JSON.stringify(screen.slice(-300))}`);
      }
    };
    const queries = () => screen.split(`${ESC}[6n`).length - 1;
    const marks = () => screen.split(`${ESC}[5n`).length - 1;
    const prompts = () => screen.split("> ").length - 1;
    const z = {
      lines,
      until,
      queries,
      marks,
      prompts,
      screen: () => screen,
      type: (keys: string) => proc.terminal!.write(keys),
      async typed(text: string) {
        const from = screen.length;
        z.type(text);
        await until(`echo of ${text}`, () => screen.slice(from).includes(text));
      },
      engine: (...lines: string[]) => appendFileSync(fifo, lines.map((line) => `${line}\n`).join("")),
      async query(seq: number, answer?: (string | number)[]) {
        const asked = queries();
        z.engine(`Q\x1f${seq}`);
        await until(`query ${seq}`, () => queries() > asked);
        for (const chunk of answer ?? [reply(screen.slice(screen.lastIndexOf(`${ESC}[c`)))]) {
          if (typeof chunk === "number") await Bun.sleep(chunk);
          else z.type(chunk);
        }
        await until(`answer to ${seq}`, () => lines().some((line) => line.startsWith(`SENT C|${seq}`)));
      },
      sent: () => lines().filter((line) => line.startsWith("SENT ")),
      async line() {
        const count = lines().length;
        z.type(`${ESC}[24~`);
        await until("line", () => lines().slice(count).some((line) => line.startsWith("LINE ")));
        return lines().slice(count).filter((line) => !line.startsWith("SENT "));
      },
      async close() {
        proc.kill(9);
        await proc.exited;
        proc.terminal!.close();
      },
    };
    z.type(`source ${rc}\r`);
    await until("prompt", () => lines().includes("READY"));
    return z;
  }

  test(
    "a reply read inside zsh's completion menu leaves the menu open",
    async () => {
      const z = await start();
      try {
        await z.typed("wc a");
        await z.query(7);
        z.type("\t");
        await z.until("list", () => z.screen().includes("a3"));
        z.type("\t");
        await z.until("menu", () => z.screen().includes(`${ESC}[7ma1`));
        await z.query(8);
        z.type("\r");
        expect(await z.line()).toEqual(["LINE [wc a1 ] REPORTS 1"]);
        expect(z.lines().filter((line) => line.startsWith("SENT "))).toEqual(["SENT C|7|5|12|120|35|20|8|600|960", "SENT C|8|5|12|120|35|20|8|600|960"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "keys typed while zsh waits for the reply come back in order",
    async () => {
      const z = await start();
      try {
        await z.typed("wc ");
        await z.query(7, ["ab", 50, `${ESC}[?62;22c${PLAIN}`, "c", `${ESC}[5;12R${END}`, 100, "d"]);
        await z.until("echo", () => z.screen().includes("abcd"));
        await z.query(8, ["ef", 50, `${ESC}[?62;22c`, "g", `${ESC}[5;12R`, 50, END, 100, "h"]);
        expect(await z.line()).toEqual(["LINE [wc abcdefgh] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "keys with spaces typed during the reply come back whole with shwordsplit set",
    async () => {
      const z = await start();
      try {
        z.type("setopt shwordsplit\r");
        await z.typed("wc ");
        await z.query(7, [`${ESC}[?62;22c${PLAIN}`, "a b", `${ESC}[5;12R${END}`]);
        expect(await z.line()).toEqual(["LINE [wc a b] REPORTS 1"]);
        await z.query(8, [" c d", 50, reply("")]);
        expect(await z.line()).toEqual(["LINE [wc a b c d] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "keys held for the end marker stay held when the engine handler redraws",
    async () => {
      const z = await start();
      try {
        z.type('functions[_fx_recv]=$functions[_figxit_recv]; _figxit_recv() { _fx_recv "$@"; _figxit_redraw }\r');
        await z.typed("wc ");
        await z.query(7);
        expect(await z.line()).toEqual(["LINE [wc ] REPORTS 1"]);
        await z.query(8, ["ab", 50, `${ESC}[?62;22c${ESC}[5;12R`, 100, END]);
        await Bun.sleep(100);
        expect({ line: await z.line(), ran: z.lines().filter((line) => line.startsWith("RAN wc")) }).toEqual({ line: ["LINE [wc ab] REPORTS 1"], ran: [] });
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "keys typed between the cursor position and the end marker come back in order",
    async () => {
      const z = await start();
      try {
        await z.typed("wc ");
        await z.query(7);
        const marks = () => z.screen().split(`${ESC}[5n`).length;
        const before = marks();
        await z.query(8, [`${ESC}[?62;22c${ESC}[5;12R`, 50, "a", 50, END]);
        await z.until("new end marker query", () => marks() > before + 1);
        z.type(END);
        await Bun.sleep(100);
        z.type("b");
        expect(await z.line()).toEqual(["LINE [wc ab] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "while typed keys wait for the end marker, a new query gets no position",
    async () => {
      const z = await start();
      try {
        await z.typed("wc ");
        await z.query(7);
        await z.query(8, ["a", 50, `${ESC}[?62;22c${ESC}[5;12R`]);
        z.engine("Q\x1f9");
        await z.until("answer to 9", () => z.lines().includes("SENT C|9"));
        z.type(END);
        await Bun.sleep(100);
        z.type("b");
        expect({ queries: z.queries(), line: await z.line() }).toEqual({ queries: 2, line: ["LINE [wc ab] REPORTS 1"] });
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "a query that comes during the read is answered by the same reply",
    async () => {
      const z = await start();
      try {
        await z.query(6);
        z.engine("Q\x1f7", "Q\x1f8");
        await z.until("query", () => z.queries() > 1);
        await Bun.sleep(300);
        z.type(reply(""));
        await z.until("answer", () => z.lines().length > 2);
        await z.line();
        expect({ queries: z.queries(), sent: z.lines().filter((line) => line.startsWith("SENT ")) }).toEqual({
          queries: 2,
          sent: ["SENT C|6|5|12|120|35|20|8|600|960", "SENT C|8|5|12|120|35|20|8|600|960"],
        });
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "keys typed while zsh waits past the time limit for the reply come back in order",
    async () => {
      const z = await start({ FX_WAIT: "0.3" });
      try {
        await z.typed("echo one");
        await z.query(6);
        await z.query(7, [50, "x", 400, `${ESC}[D`, 100, reply("")]);
        z.type("y");
        expect(await z.line()).toEqual(["LINE [echo oneyx] REPORTS 1"]);
        expect(z.sent()).toEqual(["SENT C|6|5|12|120|35|20|8|600|960", "SENT C|7|5|12|120|35|20|8|600|960"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "Enter typed while zsh waits for a slow reply runs the whole line",
    async () => {
      const z = await start({ FX_WAIT: "0.3" });
      try {
        await z.typed("wc ");
        await z.query(6);
        await z.query(7, ["ab", 800, "\r", 600, reply("")]);
        await z.until("command", () => z.lines().some((line) => line.startsWith("RAN ")));
        expect(z.lines().filter((line) => line.startsWith("RAN "))).toEqual(["RAN wc ab"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "Ctrl-C while zsh waits for the reply ends the line, and the reply stays off the next one",
    async () => {
      const z = await start({ FX_WAIT: "0.3" });
      try {
        await z.typed("wc ");
        await z.query(6);
        const prompts = z.prompts();
        const marks = z.marks();
        await z.query(7, ["\x03", 500, reply("")]);
        let marked = false;
        await z.until("new prompt", () => {
          if (!marked && z.marks() > marks + 1) {
            marked = true;
            z.type(END);
          }
          return z.prompts() > prompts;
        });
        await z.typed("xy");
        expect(await z.line()).toEqual(["LINE [xy] REPORTS 1"]);
        expect(z.sent()).toEqual(["SENT C|6|5|12|120|35|20|8|600|960", "SENT C|7|5|12|120|35|20|8|600|960"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "reply and Ctrl-C arrive together: the first Ctrl-C gives a prompt",
    async () => {
      const z = await start();
      try {
        await z.typed("wc ");
        await z.query(6);
        await z.line();
        const prompts = z.prompts();
        let marks = z.marks();
        z.engine("Q\x1f7");
        await z.until("query 7", () => z.marks() > marks);
        marks = z.marks();
        z.type(`${reply("")}\x03`);
        await z.until(
          "new prompt",
          () => {
            for (; marks < z.marks(); marks++) z.type(END);
            return z.prompts() > prompts;
          },
          3000,
        );
        await z.typed("xy");
        expect(await z.line()).toEqual(["LINE [xy] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "two Ctrl-C before a slow reply keep the reply off the next line",
    async () => {
      const z = await start();
      try {
        await z.typed("wc ");
        await z.query(6);
        await z.line();
        const prompts = z.prompts();
        let marks = z.marks();
        z.engine("Q\x1f7");
        await z.until("query 7", () => z.marks() > marks);
        marks = z.marks();
        z.type("\x03");
        await Bun.sleep(50);
        z.type("\x03");
        await Bun.sleep(100);
        z.type(reply(""));
        await z.until(
          "new prompt",
          () => {
            for (; marks < z.marks(); marks++) z.type(END);
            return z.prompts() > prompts;
          },
          3000,
        );
        await z.typed("xy");
        expect(await z.line()).toEqual(["LINE [xy] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "when the terminal stops answering, two Ctrl-C end the wait, and the next query is answered",
    async () => {
      const z = await start({ FX_WAIT: "0.3" });
      try {
        await z.typed("wc ");
        await z.query(6);
        await z.line();
        const prompts = z.prompts();
        z.engine("Q\x1f7");
        await z.until("query 7", () => z.queries() > 1);
        z.type("ab");
        await Bun.sleep(800);
        z.type("\x03");
        await Bun.sleep(200);
        z.type("\x03");
        await z.until("answer to 7", () => z.sent().includes("SENT C|7"));
        z.type(END);
        await z.until("new prompt", () => z.prompts() > prompts);
        await z.typed("x");
        await z.query(8);
        expect(await z.line()).toEqual(["LINE [x] REPORTS 1"]);
        expect(z.sent().at(-1)).toBe("SENT C|8|5|12|120|35|20|8|600|960");
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "keys still held when the line ends do not reach the next line",
    async () => {
      const z = await start();
      try {
        await z.typed("wc ");
        await z.query(7);
        const prompts = z.prompts();
        await z.query(8, ["a", 50, `${ESC}[?62;22c${ESC}[5;12R`]);
        z.type("\x03");
        await z.until("new prompt", () => z.prompts() > prompts);
        await z.typed("x");
        z.type(END);
        await Bun.sleep(100);
        expect(await z.line()).toEqual(["LINE [x] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "a terminal that never answers leaves typed keys alone, and reports turn off",
    async () => {
      const z = await start({ FX_WAIT: "0.5" });
      try {
        await z.typed("wc ");
        z.engine("Q\x1f7");
        await z.until("query", () => z.queries() > 0);
        await z.typed("ab");
        await Bun.sleep(600);
        z.engine("Q\x1f8");
        await z.until("answer", () => z.lines().includes("SENT C|8"));
        expect({ queries: z.queries(), line: await z.line() }).toEqual({ queries: 1, line: ["LINE [wc ab] REPORTS -1"] });
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "with Esc Esc bound, an Esc typed right before the first reply of a shell stays an Esc",
    async () => {
      const z = await start({ FX_KEYS: "1" });
      try {
        await z.typed("wc ");
        await z.query(6, [ESC, 50, reply("")]);
        await z.until("Esc", () => z.lines().includes("ESC"));
        expect(await z.line()).toEqual(["LINE [wc ] REPORTS 1"]);
        expect(z.sent()).toEqual(["SENT C|6|5|12|120|35|"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "Esc Esc with the first reply of a shell between the two presses runs the Esc Esc binding",
    async () => {
      const z = await start({ FX_KEYS: "1" });
      try {
        await z.typed("wc ");
        await z.query(6, [ESC, 50, reply(""), 50, ESC]);
        await Bun.sleep(200);
        expect(await z.line()).toEqual(["LINE [sudo wc ] REPORTS 1"]);
        expect(z.lines().includes("ESC")).toBe(false);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "with Esc Esc bound, an Esc typed between the cursor position and the end marker stays an Esc behind the held keys",
    async () => {
      const z = await start({ FX_KEYS: "1" });
      try {
        await z.typed("wc ");
        await z.query(6);
        await z.query(7, ["a", 30, `${ESC}[?62;22c${ESC}[5;12R`, 30, ESC, 30, END]);
        await z.until("Esc", () => z.lines().includes("ESC"));
        expect(await z.line()).toEqual(["LINE [wc a] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "Esc Esc still runs its binding without a reply, and right before one",
    async () => {
      const z = await start({ FX_KEYS: "1" });
      try {
        await z.typed("wc ");
        z.type(`${ESC}${ESC}`);
        await Bun.sleep(200);
        expect(await z.line()).toEqual(["LINE [sudo wc ] REPORTS 1"]);
        await z.query(6, [`${ESC}${ESC}${reply("")}`]);
        await Bun.sleep(200);
        expect(await z.line()).toEqual(["LINE [wc ] REPORTS 1"]);
        expect({ sent: z.sent(), escs: z.lines().includes("ESC") }).toEqual({ sent: ["SENT C|6|5|12|120|35|"], escs: false });
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "with shwordsplit set, a space typed right after Esc Esc stays a space",
    async () => {
      const z = await start({ FX_KEYS: "1" });
      try {
        z.type("setopt shwordsplit\r");
        await z.until("setopt", () => z.lines().some((line) => line.startsWith("RAN setopt")));
        await z.typed("wc");
        z.type(`${ESC}${ESC} x`);
        await Bun.sleep(200);
        expect(await z.line()).toEqual(["LINE [sudo wc x] REPORTS 1"]);
      } finally {
        await z.close();
      }
    },
    30000,
  );

  test(
    "an Esc Esc string bound with bindkey -s still runs",
    async () => {
      const z = await start({ FX_KEYS: "1" });
      try {
        z.type("bindkey -s '\\e\\e' '^Asudo ^E'\r");
        await z.until("bindkey", () => z.lines().some((line) => line.startsWith("RAN bindkey")));
        await z.typed("wc ");
        z.type(`${ESC}${ESC}`);
        await Bun.sleep(200);
        expect(await z.line()).toEqual(["LINE [sudo wc ] REPORTS 1"]);
        expect(z.lines().includes("ESC")).toBe(false);
      } finally {
        await z.close();
      }
    },
    30000,
  );
});

describe.skipIf(!bash)("bash reply reader", () => {
  const script = join(work, "read.bash");
  writeFileSync(
    script,
    [
      "_figxit_sep=$'\\x1f' _figxit_cell=",
      "COLUMNS=120 LINES=35",
      '_figxit_send() { printf \'SENT %s\\n\' "${1//$_figxit_sep/|}"; }',
      body("shell/bash/cursor.bash", "_figxit_read"),
      "_figxit_read",
      'printf \'LEFT [%s]\\n\' "$REPLY"',
      "",
    ].join("\n"),
  );

  function read(reply: string) {
    return result(Bun.spawnSync([bash!, script], { stdin: Buffer.from(reply, "latin1"), stderr: "ignore" }).stdout.toString());
  }

  test("reads past the R in the ReportCellSize reply", () => {
    expect(read(`${ESC}[?64;1;2c${ITERM}ab${ESC}[25;3R`)).toEqual({ sent: "c|25|3|120|35|21.0|8.0|777|987", left: "ab" });
  });

  test("prefers ReportCellSize to the 16t reply", () => {
    expect(read(`${ESC}[?64;1;2c${ITERM_BOTH}${ESC}[2;1R`)).toEqual({ sent: "c|2|1|120|35|20.5|8.0|777|987", left: "" });
  });

  test("keeps a typed R that comes before the cursor reply", () => {
    expect(read(`${ESC}[?62c${PLAIN}zR${ESC}[12;34R`)).toEqual({ sent: "c|12|34|120|35|20|8|600|960", left: "zR" });
  });

  test("sends no position without a cursor reply", () => {
    expect(read(`${ESC}[?62cxy`)).toEqual({ sent: "c", left: "xy" });
  });
});
