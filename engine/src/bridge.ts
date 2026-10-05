import { appendFileSync, constants, existsSync, fstatSync, ftruncateSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, watch, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Socket } from "bun";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { ENGINE_SOCK } from "./paths";

const SEP = "\x1f";
const RETRY_MS = 3000;
const SETTLE_MS = 2;
const REPORT_MS = 1000;
const WATCH_MS = 2000;
const LOCATE_MS = 60;
const ROTATE = 65536;
const FOLLOW_TURNS = 50;
const CELL = "\x1b[14t\x1b[16t";
export const QUERY = `\x1b[c${CELL}\x1b[6n`;

export interface Located {
  fields: string[] | null;
  typed: string;
  busy: boolean;
}

export interface Wires {
  engine: (line: string) => boolean;
  shell: (line: string) => void;
  tty: (text: string) => boolean;
  delay: (run: () => void, ms: number) => () => void;
  locate?: (cols: string, lines: string) => Located;
}

export function parseReports(raw: string, cols: string, lines: string, cell: string): { fields: string[] | null; cell: string; typed: string } {
  let rest = raw;
  let fields: string[] | null = null;
  const size: Record<string, string> = {};
  rest = rest.replace(/\x1b\[\?[0-9;]*c/g, "");
  rest = rest.replace(/\x1b\[([46]);(\d+);(\d+)t/g, (_all, kind: string, height: string, width: string) => {
    size[kind] = `${height}${SEP}${width}`;
    return "";
  });
  if (size["4"] || size["6"]) cell = `${size["6"] ?? SEP}${SEP}${size["4"] ?? ""}`;
  rest = rest.replace(/\x1b\[(\d+);(\d+)R/, (_all, row: string, col: string) => {
    fields = [row, col, cols, lines, cell];
    return "";
  });
  return { fields, cell, typed: rest };
}

export function advance(fields: string[], width: number): string[] {
  const cols = Number(fields[2]) || 0;
  const lines = Number(fields[3]) || 0;
  let row = Number(fields[0]);
  let col = Number(fields[1]) + width;
  if (cols > 0) {
    row += Math.floor((col - 1) / cols);
    col = ((((col - 1) % cols) + cols) % cols) + 1;
  }
  if (lines > 0) row = Math.max(1, Math.min(row, lines));
  return [String(row), String(col), ...fields.slice(2)];
}

export function splitTyped(typed: string): { text: string; key: string } {
  const keys: Record<string, string> = { "\r": "enter", "\n": "enter", "\t": "tab", "\x7f": "backspace" };
  const stop = typed.search(/[\x00-\x1f\x7f]/);
  if (stop < 0) return { text: typed, key: "" };
  return { text: typed.slice(0, stop), key: keys[typed[stop]!] ?? "" };
}

export class Bridge {
  hello = "";
  private plain = false;
  private typing = false;
  private reports = true;
  private again = false;
  private asked: string | null = null;
  private next: string | null = null;
  private settle: (() => void) | null = null;
  private expire: (() => void) | null = null;
  private accepting: string | null = null;
  private located: string[] | null = null;
  private position: string[] | null = null;

  constructor(private wires: Wires) {}

  fromShell(line: string) {
    const f = line.split(SEP);
    switch (f[0]) {
      case "H":
        this.hello = line;
        this.plain = !(f[2] && f[3]);
        break;
      case "E":
        this.typing = true;
        this.position = this.located;
        this.located = null;
        break;
      case "a":
        this.accepting = f[1] ?? "";
        if (!this.wires.engine(f[2] === "R" ? "R" : "A")) this.answer(`-1${SEP}`);
        return;
      case "p": {
        const found = this.plain && this.wires.locate ? this.wires.locate(f[2] ?? "", f[3] ?? "") : { fields: null, typed: "", busy: false };
        const typed = splitTyped(found.typed);
        const unpainted = found.busy ? Number(f[4]) || 0 : 0;
        this.located = found.fields && advance(found.fields, unpainted + Bun.stringWidth(typed.text));
        this.wires.shell(`r${SEP}${f[1] ?? ""}${SEP}${typed.text}${SEP}${typed.key}`);
        return;
      }
      case "L":
        this.idle();
        if (f[1]) this.wires.shell(`s${SEP}${f[1]}`);
        break;
      case "X":
        this.idle();
        this.wires.engine(line);
        if (this.plain && !this.wires.locate) this.wires.shell(`Z${SEP}${this.asked === null ? 0 : 1}`);
        return;
      case "c":
        this.report(f.slice(1));
        return;
    }
    this.wires.engine(line);
  }

  fromEngine(line: string) {
    if (line.startsWith(`Q${SEP}`)) this.ask(line.slice(2));
    else if (line.startsWith(`A${SEP}`) && this.accepting !== null) this.answer(line.slice(2));
    else this.wires.shell(line);
  }

  lost() {
    this.idle();
    if (this.accepting !== null) this.answer(`-1${SEP}`);
    this.wires.shell(`S${SEP}0`);
  }

  private answer(rest: string) {
    this.wires.shell(`r${SEP}${this.accepting}${SEP}${rest}`);
    this.accepting = null;
  }

  private idle() {
    this.typing = false;
    this.next = null;
    this.settle?.();
    this.settle = null;
  }

  private empty(seq: string) {
    this.wires.engine(`C${SEP}${seq}`);
  }

  private ask(seq: string) {
    if (this.wires.locate) {
      if (this.plain && this.typing && this.position) this.wires.engine(`C${SEP}${seq}${SEP}${this.position.join(SEP)}`);
      else this.empty(seq);
      return;
    }
    if (!this.plain || !this.reports || !this.typing) return this.empty(seq);
    this.next = seq;
    if (this.asked !== null) return;
    this.settle ??= this.wires.delay(() => {
      this.settle = null;
      const wanted = this.next;
      this.next = null;
      if (wanted === null) return;
      if (!this.wires.tty(QUERY)) {
        this.reports = false;
        return this.empty(wanted);
      }
      this.asked = wanted;
      this.expire = this.wires.delay(() => this.report([]), REPORT_MS);
    }, SETTLE_MS);
  }

  private report(fields: string[]) {
    const seq = this.asked;
    if (seq === null) return;
    this.asked = null;
    this.expire?.();
    this.expire = null;
    const retry = fields[0] === "again" && !this.again;
    this.again = retry;
    if (retry) this.next ??= seq;
    else if (fields.length < 2) {
      if (fields.length === 0) this.reports = false;
      this.empty(seq);
    } else this.wires.engine(`C${SEP}${seq}${SEP}${fields.join(SEP)}`);
    if (this.next !== null) this.ask(this.next);
  }
}

function launch() {
  if (existsSync(join(dirname(ENGINE_SOCK), "stopped"))) return;
  const quiet = { stdin: "ignore", stdout: "ignore", stderr: "ignore" } as const;
  const home = process.env.FIGXIT_HOME;
  if (process.env.FIGXIT_APP) Bun.spawn(["open", "-g", process.env.FIGXIT_APP], quiet);
  else if (!process.env.FIGXIT_AUTOSTART) return;
  else if (process.env.FIGXIT_ENGINE) Bun.spawn(["sh", "-c", `${process.env.FIGXIT_ENGINE} >/dev/null 2>&1 &`], quiet);
  else if (home && existsSync(join(home, "dist/Figxit.app"))) Bun.spawn(["open", "-g", join(home, "dist/Figxit.app")], quiet);
}

function terminal() {
  let out: number | null = null;
  let input: number | null = null;
  let reports = true;
  let size = "";
  let cell = SEP;
  let select: ((count: number, read: unknown, write: unknown, fail: unknown, wait: unknown) => number) | null | undefined;
  const chunk = Buffer.alloc(4096);

  function write(text: string): boolean {
    try {
      out ??= openSync("/dev/tty", "w");
      writeSync(out, text);
      return true;
    } catch {
      return false;
    }
  }

  function source(): number | null {
    try {
      input ??= openSync("/dev/tty", constants.O_RDONLY | constants.O_NONBLOCK);
    } catch {}
    return input;
  }

  function read(): string {
    try {
      const fd = source();
      if (fd === null) return "";
      const count = readSync(fd, chunk, 0, chunk.length, null);
      return count > 0 ? chunk.toString("latin1", 0, count) : "";
    } catch {
      return "";
    }
  }

  function waiting(): boolean {
    if (select === undefined) {
      try {
        if (process.env.FIGXIT_NO_POLL) throw new Error("off");
        const kinds = { args: [FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 } as const;
        select = dlopen("libSystem.B.dylib", { select: kinds }).symbols.select;
      } catch {
        select = null;
      }
    }
    const fd = source();
    if (!select || fd === null || fd >= 1024) return false;
    const set = new Uint8Array(128);
    set[fd >> 3] = 1 << (fd & 7);
    return select(fd + 1, ptr(set), null, null, ptr(new Uint8Array(16))) > 0;
  }

  function locate(cols: string, lines: string): Located {
    if (waiting()) return { fields: null, typed: "", busy: true };
    let raw = "";
    for (let more = read(); more; more = read()) raw += more;
    const busy = raw !== "";
    const typed = (text: string) => Buffer.from(text, "latin1").toString();
    const fresh = `${cols} ${lines}` !== size;
    if (!reports || !write(`${fresh ? CELL : ""}\x1b[6n`)) {
      reports = false;
      return { fields: null, typed: typed(raw), busy };
    }
    const stop = performance.now() + LOCATE_MS;
    while (performance.now() < stop && !/\x1b\[\d+;\d+R/.test(raw)) raw += read();
    const parsed = parseReports(raw, cols, lines, fresh ? SEP : cell);
    if (parsed.fields) {
      size = `${cols} ${lines}`;
      cell = parsed.cell;
    } else reports = false;
    return { fields: parsed.fields, typed: typed(parsed.typed), busy };
  }

  return { write, locate };
}

function files(dir: string, receive: (line: string) => void) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "in");
  appendFileSync(path, "");
  const fd = openSync(path, "r+");
  const chunk = Buffer.alloc(65536);
  const decoder = new TextDecoder();
  let offset = 0;
  let pending = "";

  function put(name: string, text: string) {
    writeFileSync(join(dir, `${name}.new`), text + "\n");
    renameSync(join(dir, `${name}.new`), join(dir, name));
  }

  function pump() {
    for (;;) {
      if (fstatSync(fd).size < offset) offset = 0;
      const count = readSync(fd, chunk, 0, chunk.length, offset);
      if (count <= 0) break;
      offset += count;
      pending += decoder.decode(chunk.subarray(0, count), { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line) receive(line);
        if (line[0] === "L" && !pending && offset > ROTATE && fstatSync(fd).size === offset) {
          ftruncateSync(fd, 0);
          offset = 0;
        }
      }
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let quiet = 0;
  function follow() {
    const before = offset;
    pump();
    quiet = offset === before ? quiet + 1 : 0;
    if (quiet < FOLLOW_TURNS || !timer) return;
    clearInterval(timer);
    timer = null;
  }
  function wake() {
    quiet = 0;
    pump();
    timer ??= setInterval(follow, 1);
  }

  put("state", "0");
  watch(path, wake);
  return {
    pump: wake,
    shell(line: string) {
      if (line.startsWith(`S${SEP}`)) put("state", line.slice(2));
      else if (line.startsWith(`r${SEP}`)) put("reply", line.slice(2));
      else if (line.startsWith(`s${SEP}`)) put("seen", line.slice(2));
    },
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sweep(dir: string) {
  try {
    for (const name of readdirSync(dirname(dir))) {
      const pid = /^shell-(\d+)$/.exec(name)?.[1];
      if (pid && !alive(Number(pid))) rmSync(join(dirname(dir), name), { recursive: true, force: true });
    }
  } catch {}
}

export async function bridge(args: string[]) {
  const flag = args.indexOf("--dir");
  const dir = flag >= 0 ? args[flag + 1] : undefined;
  const parent = dir ? Number(args[flag + 2]) || process.ppid : process.ppid;
  let socket: Socket | null = null;
  let connecting = false;
  let retryAt = 0;
  let held: string | null = null;
  let fromEngine = "";
  const tty = terminal();

  function leave(clean: boolean) {
    if (dir && clean) rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  }

  if (dir) sweep(dir);
  const shell = dir ? files(dir, (line) => (line === "q" ? leave(true) : core.fromShell(line))) : null;
  const core = new Bridge({
    engine(line) {
      if (socket) {
        socket.write(line + "\n");
        return true;
      }
      if (line[0] === "E" || line[0] === "L") held = line;
      connect();
      return false;
    },
    shell: shell?.shell ?? ((line) => void process.stdout.write(line + "\n")),
    tty: tty.write,
    delay(run, ms) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    ...(dir ? { locate: tty.locate } : {}),
  });

  async function connect() {
    if (socket || connecting || Date.now() < retryAt) return;
    connecting = true;
    try {
      socket = await Bun.connect({
        unix: ENGINE_SOCK,
        socket: {
          data(_socket, chunk) {
            fromEngine += chunk.toString();
            let newline: number;
            while ((newline = fromEngine.indexOf("\n")) >= 0) {
              const line = fromEngine.slice(0, newline);
              fromEngine = fromEngine.slice(newline + 1);
              if (line) core.fromEngine(line);
            }
          },
          close() {
            socket = null;
            fromEngine = "";
            core.lost();
          },
          error() {},
        },
      });
      if (core.hello) socket.write(core.hello + "\n");
      if (held) socket.write(held + "\n");
    } catch {
      retryAt = Date.now() + RETRY_MS;
      launch();
    }
    held = null;
    connecting = false;
  }

  for (const signal of ["SIGINT", "SIGQUIT", "SIGTSTP"] as const) process.on(signal, () => {});
  process.stdout.on("error", () => leave(false));
  setInterval(() => {
    if (dir ? !alive(parent) : process.ppid !== parent) leave(true);
  }, WATCH_MS);

  if (shell) return shell.pump();
  const decoder = new TextDecoder();
  let fromShell = "";
  for await (const chunk of Bun.stdin.stream()) {
    fromShell += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = fromShell.indexOf("\n")) >= 0) {
      const line = fromShell.slice(0, newline);
      fromShell = fromShell.slice(newline + 1);
      if (line) core.fromShell(line);
    }
  }
  leave(false);
}
