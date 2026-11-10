import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const work = mkdtempSync(join(tmpdir(), "figxit-shell-"));
const ESC = "\x1b";
const ITERM = `${ESC}[4;777;987t${ESC}]1337;ReportCellSize=21.0;8.0;1.0${ESC}\\`;
const ITERM_BOTH = `${ESC}[4;777;987t${ESC}[6;21;8t${ESC}]1337;ReportCellSize=20.5;8.0\x07`;
const PLAIN = `${ESC}[4;600;960t${ESC}[6;20;8t`;

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
      "typeset -g _figxit_sep=$'\\x1f' _figxit_asked=${4-7} _figxit_cell=",
      "typeset -gi _figxit_reports=${3:-1}",
      "typeset -gF _figxit_wait=${1:-1}",
      "COLUMNS=120 LINES=35",
      '_figxit_send() { print -r -- "SENT ${1//$_figxit_sep/|}" }',
      body("shell/zsh/cursor.zsh", "_figxit_report"),
      "repeat ${2:-1}; do",
      "  _figxit_report",
      '  print -r -- "LEFT [$REPLY] REPORTS $_figxit_reports"',
      "  _figxit_asked=${_figxit_asked:-8}",
      "done",
      "",
    ].join("\n"),
  );

  async function read(chunks: (string | number)[], options: { wait?: number; runs?: number; reports?: number; asked?: string } = {}) {
    const { wait = 1, runs = 1, reports = 1, asked = "7" } = options;
    let out = "";
    const proc = Bun.spawn(["zsh", "-f", script, String(wait), String(runs), String(reports), asked], {
      terminal: { cols: 120, rows: 35, data: (_terminal, data) => void (out += Buffer.from(data).toString("latin1")) },
    });
    for (const chunk of chunks) {
      if (typeof chunk === "number") await Bun.sleep(chunk);
      else proc.terminal!.write(chunk);
    }
    await proc.exited;
    proc.terminal!.close();
    return {
      sent: [...out.matchAll(/SENT ([^\r\n]*)/g)].map((m) => m[1]),
      left: [...out.matchAll(/LEFT \[([^\]]*)\] REPORTS (\d)/g)].map((m) => `${m[1]} ${m[2] === "1" ? "on" : "off"}`),
    };
  }

  const END = `${ESC}[0n`;

  test("takes the cell size from ReportCellSize and gives back the typed keys", async () => {
    expect(await read([`64;1;2c${ITERM}ab${ESC}[25;3R${END}`])).toEqual({ sent: ["C|7|25|3|120|35|21.0|8.0|777|987"], left: ["ab on"] });
  });

  test("prefers ReportCellSize to the 16t reply", async () => {
    expect(await read([`64;1;2c${ITERM_BOTH}${ESC}[2;1R${END}`])).toEqual({ sent: ["C|7|2|1|120|35|20.5|8.0|777|987"], left: [" on"] });
  });

  test("reads the 14t and 16t replies of other terminals", async () => {
    expect(await read([`62c${PLAIN}z${ESC}[12;34R${END}`])).toEqual({ sent: ["C|7|12|34|120|35|20|8|600|960"], left: ["z on"] });
  });

  test("turns reports off when the terminal answers without a cursor position", async () => {
    expect(await read([`62cxy${END}`])).toEqual({ sent: ["C|7"], left: ["xy off"] });
  });

  test("waits for a cursor position that comes 300 ms after the first reply", async () => {
    expect(await read(["62c", 300, `${ESC}[5;12R${END}`])).toEqual({ sent: ["C|7|5|12|120|35|"], left: [" on"] });
  });

  test("keeps reports on after a reply that comes too late", async () => {
    expect(await read(["62c", 250, `62c${ESC}[5;12R${END}`], { wait: 0.2, runs: 2 })).toEqual({
      sent: ["C|7", "C|8|5|12|120|35|"],
      left: [" on", " on"],
    });
  });

  test("turns reports off when the terminal does not answer at all", async () => {
    expect(await read([], { wait: 0.2 })).toEqual({ sent: [], left: [" off"] });
  });

  test("turns reports back on when a reply comes after the shell stopped asking", async () => {
    expect(await read([`62c${ESC}[5;12R${END}`], { reports: 0, asked: "" })).toEqual({ sent: [], left: [" on"] });
  });
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
