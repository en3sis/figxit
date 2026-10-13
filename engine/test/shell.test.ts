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
      "typeset -g _figxit_sep=$'\\x1f' _figxit_asked=7 _figxit_cell= _figxit_reports=1",
      "COLUMNS=120 LINES=35",
      '_figxit_send() { print -r -- "SENT ${1//$_figxit_sep/|}" }',
      body("shell/zsh/figxit.zsh", "_figxit_report"),
      "_figxit_report",
      'print -r -- "LEFT [$REPLY]"',
      "",
    ].join("\n"),
  );

  async function read(reply: string) {
    let out = "";
    const proc = Bun.spawn(["zsh", "-f", script], {
      terminal: { cols: 120, rows: 35, data: (_terminal, data) => void (out += Buffer.from(data).toString("latin1")) },
    });
    proc.terminal!.write(reply);
    await proc.exited;
    proc.terminal!.close();
    return result(out);
  }

  test("takes the cell size from ReportCellSize and gives back the typed keys", async () => {
    expect(await read(`64;1;2c${ITERM}ab${ESC}[25;3R`)).toEqual({ sent: "C|7|25|3|120|35|21.0|8.0|777|987", left: "ab" });
  });

  test("prefers ReportCellSize to the 16t reply", async () => {
    expect(await read(`64;1;2c${ITERM_BOTH}${ESC}[2;1R`)).toEqual({ sent: "C|7|2|1|120|35|20.5|8.0|777|987", left: "" });
  });

  test("reads the 14t and 16t replies of other terminals", async () => {
    expect(await read(`62c${PLAIN}z${ESC}[12;34R`)).toEqual({ sent: "C|7|12|34|120|35|20|8|600|960", left: "z" });
  });

  test("sends no position without a cursor reply", async () => {
    expect(await read("62cxy")).toEqual({ sent: "C|7", left: "xy" });
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
      body("shell/bash/figxit.bash", "_figxit_read"),
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
