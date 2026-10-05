import { describe, expect, test } from "bun:test";
import { advance, Bridge, type Located, parseReports, QUERY, splitTyped } from "../src/bridge";

const SEP = "\x1f";
const line = (...fields: (string | number)[]) => fields.join(SEP);

function rig(options: { connected?: boolean; tty?: boolean; locate?: (cols: string, lines: string) => Located } = {}) {
  const engine: string[] = [];
  const shell: string[] = [];
  const tty: string[] = [];
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const bridge = new Bridge({
    engine(text) {
      if (options.connected === false) return false;
      engine.push(text);
      return true;
    },
    shell: (text) => void shell.push(text),
    tty(text) {
      if (options.tty === false) return false;
      tty.push(text);
      return true;
    },
    delay(run, ms) {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    ...(options.locate ? { locate: options.locate } : {}),
  });
  const tick = (ms: number) => {
    for (const timer of timers.filter((entry) => entry.live && entry.ms <= ms)) {
      timer.live = false;
      timer.run();
    }
  };
  return { bridge, engine, shell, tty, tick };
}

describe("terminal reports", () => {
  test("reads the cursor cell, the cell size, and the keys typed around them", () => {
    const raw = "ab\x1b[?62;4c\x1b[4;600;960t\x1b[6;20;8tc\x1b[12;34R";
    const parsed = parseReports(raw, "120", "30", SEP);
    expect(parsed.fields).toEqual(["12", "34", "120", "30", line(20, 8, 600, 960)]);
    expect(parsed.typed).toBe("abc");
  });

  test("keeps the known cell size when the terminal sends only the cursor", () => {
    const parsed = parseReports("\x1b[3;9R", "80", "24", line(18, 9, "", ""));
    expect(parsed.fields).toEqual(["3", "9", "80", "24", line(18, 9, "", "")]);
  });

  test("returns no fields without a cursor report", () => {
    expect(parseReports("xy", "80", "24", SEP)).toEqual({ fields: null, cell: SEP, typed: "xy" });
  });

  test("splits typed bytes into text and the first control key", () => {
    expect(splitTyped("ake dev")).toEqual({ text: "ake dev", key: "" });
    expect(splitTyped("ls\rpwd")).toEqual({ text: "ls", key: "enter" });
    expect(splitTyped("\x7f")).toEqual({ text: "", key: "backspace" });
    expect(splitTyped("a\x1b[D")).toEqual({ text: "a", key: "" });
  });

  test("moves the cursor cell by a width and wraps at the right edge", () => {
    expect(advance(["2", "4", "80", "24", "c"], 5)).toEqual(["2", "9", "80", "24", "c"]);
    expect(advance(["2", "78", "80", "24", "c"], 5)).toEqual(["3", "3", "80", "24", "c"]);
    expect(advance(["24", "78", "80", "24", "c"], 5)).toEqual(["24", "3", "80", "24", "c"]);
    expect(advance(["2", "4", "80", "24", "c"], -1)).toEqual(["2", "3", "80", "24", "c"]);
  });
});

describe("bridge for a shell on a pipe", () => {
  test("passes shell lines to the engine and engine state to the shell", () => {
    const { bridge, engine, shell } = rig();
    bridge.fromShell(line("H", 1, "/tmp/tmux", "%1", "/bin", ""));
    bridge.fromShell(line("E", 3, "/p", "git"));
    bridge.fromShell(line("K", "down"));
    bridge.fromEngine(line("S", 1));
    bridge.fromEngine(line("A", 2, "status "));
    expect(engine).toEqual([line("H", 1, "/tmp/tmux", "%1", "/bin", ""), line("E", 3, "/p", "git"), line("K", "down")]);
    expect(shell).toEqual([line("S", 1), line("A", 2, "status ")]);
  });

  test("asks the terminal after the settle time and tags the report with the sequence", () => {
    const { bridge, engine, tty, tick } = rig();
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("E", 5, "/p", "make "));
    bridge.fromEngine(line("Q", 7));
    expect(tty).toEqual([]);
    tick(10);
    expect(tty).toEqual([QUERY]);
    bridge.fromShell(line("c", 2, 7, 120, 30, 20, 8, 600, 960));
    expect(engine.at(-1)).toBe(line("C", 7, 2, 7, 120, 30, 20, 8, 600, 960));
  });

  test("a second question waits for the open report and then asks again", () => {
    const { bridge, engine, tty, tick } = rig();
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("E", 1, "/p", "m"));
    bridge.fromEngine(line("Q", 1));
    tick(10);
    bridge.fromShell(line("E", 2, "/p", "ma"));
    bridge.fromEngine(line("Q", 2));
    expect(tty.length).toBe(1);
    bridge.fromShell(line("c", 2, 4, 80, 24, SEP));
    expect(engine.at(-1)).toBe(line("C", 1, 2, 4, 80, 24, SEP));
    tick(10);
    expect(tty.length).toBe(2);
    bridge.fromShell(line("c", 2, 5, 80, 24, SEP));
    expect(engine.at(-1)).toBe(line("C", 2, 2, 5, 80, 24, SEP));
  });

  test("a report from a cleared line is asked again one time", () => {
    const { bridge, engine, tty, tick } = rig();
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("E", 1, "/p", "m"));
    bridge.fromEngine(line("Q", 1));
    tick(10);
    bridge.fromShell(line("c", "again"));
    tick(10);
    expect(tty.length).toBe(2);
    bridge.fromShell(line("c", "again"));
    expect(engine.at(-1)).toBe(line("C", 1));
    tick(10);
    expect(tty.length).toBe(2);
  });

  test("answers at once with no position when the line is not being edited", () => {
    const { bridge, engine, tty, tick } = rig();
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("E", 1, "/p", "m"));
    bridge.fromShell("X");
    bridge.fromEngine(line("Q", 4));
    tick(10);
    expect(tty).toEqual([]);
    expect(engine.at(-1)).toBe(line("C", 4));
  });

  test("tells the shell at Enter if a report is still on its way", () => {
    const { bridge, shell, tick } = rig();
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("E", 1, "/p", "m"));
    bridge.fromShell("X");
    expect(shell.at(-1)).toBe(line("Z", 0));
    bridge.fromShell(line("E", 1, "/p", "m"));
    bridge.fromEngine(line("Q", 2));
    tick(10);
    bridge.fromShell("X");
    expect(shell.at(-1)).toBe(line("Z", 1));
  });

  test("stops asking when the terminal does not answer", () => {
    const { bridge, engine, tty, tick } = rig();
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("E", 1, "/p", "m"));
    bridge.fromEngine(line("Q", 1));
    tick(10);
    tick(1000);
    expect(engine.at(-1)).toBe(line("C", 1));
    bridge.fromEngine(line("Q", 2));
    tick(10);
    expect(tty.length).toBe(1);
    expect(engine.at(-1)).toBe(line("C", 2));
  });

  test("closes the popup state when the engine goes away", () => {
    const { bridge, shell } = rig();
    bridge.lost();
    expect(shell).toEqual([line("S", 0)]);
  });
});

describe("bridge for a shell on files", () => {
  const found = (fields: string[] | null, typed = "", busy = false) => () => ({ fields, typed, busy });

  test("keeps the position asked before an edit and gives it to the engine", () => {
    const { bridge, engine, shell } = rig({ locate: found(["2", "8", "120", "30", SEP]) });
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("p", 1, 120, 30, 0));
    expect(shell.at(-1)).toBe(line("r", 1, "", ""));
    bridge.fromShell(line("E", 5, "/p", "make "));
    bridge.fromEngine(line("Q", 3));
    expect(engine.at(-1)).toBe(line("C", 3, 2, 8, 120, 30, SEP));
  });

  test("returns typed keys and moves the position past the text", () => {
    const { bridge, engine, shell } = rig({ locate: found(["2", "4", "120", "30", SEP], "ake \r", true) });
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("p", 1, 120, 30, 1));
    expect(shell.at(-1)).toBe(line("r", 1, "ake ", "enter"));
    bridge.fromShell(line("E", 5, "/p", "make "));
    bridge.fromEngine(line("Q", 3));
    expect(engine.at(-1)).toBe(line("C", 3, 2, 9, 120, 30, SEP));
  });

  test("gives no position for an edit that did not ask, and none in tmux", () => {
    const { bridge, engine } = rig({ locate: found(["2", "4", "120", "30", SEP]) });
    bridge.fromShell(line("H", 1, "", "", "/bin", ""));
    bridge.fromShell(line("p", 1, 120, 30, 0));
    bridge.fromShell(line("E", 1, "/p", "m"));
    bridge.fromShell(line("E", 2, "/p", "ma"));
    bridge.fromEngine(line("Q", 2));
    expect(engine.at(-1)).toBe(line("C", 2));
    const tmux = rig({ locate: found(["2", "4", "120", "30", SEP]) });
    tmux.bridge.fromShell(line("H", 1, "/tmp/tmux", "%1", "/bin", ""));
    tmux.bridge.fromShell(line("p", 1, 120, 30, 0));
    expect(tmux.shell.at(-1)).toBe(line("r", 1, "", ""));
  });

  test("answers an accept request with the engine reply and the request id", () => {
    const { bridge, engine, shell } = rig({ locate: found(null) });
    bridge.fromShell(line("a", 9, "R"));
    expect(engine.at(-1)).toBe("R");
    bridge.fromEngine(line("A", 2, "build "));
    expect(shell.at(-1)).toBe(line("r", 9, 2, "build "));
  });

  test("refuses an accept request at once without an engine", () => {
    const { bridge, shell } = rig({ connected: false, locate: found(null) });
    bridge.fromShell(line("a", 4, "A"));
    expect(shell.at(-1)).toBe(line("r", 4, -1, ""));
  });

  test("confirms each prompt so the shell can see that the bridge is alive", () => {
    const { bridge, engine, shell } = rig({ locate: found(null) });
    bridge.fromShell(line("L", 12));
    expect(shell.at(-1)).toBe(line("s", 12));
    expect(engine.at(-1)).toBe(line("L", 12));
  });
});
