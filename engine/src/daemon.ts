import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Socket } from "bun";
import { parseShell, termPad, tmuxGrid, tmuxQuery, type Grid, type TmuxTarget } from "./geometry";
import { Helper } from "./helper";
import { History } from "./history";
import { ENGINE_SOCK } from "./paths";
import type { Candidate } from "./sources";
import { suggest, type Suggestion } from "./suggest";

const SOCK = ENGINE_SOCK;
const SEP = "\x1f";
const VISIBLE = 8;
const SETTLE_MS = 12;
const FOCUS_MS = 250;
const CURSOR_MS = 500;
const FOCUS_FORMAT = "#{window_active} #{pane_active} #{pane_in_mode}";

interface Session {
  socket: Socket<Session>;
  decoder: TextDecoder;
  pending: string;
  tmux: TmuxTarget | null;
  term: string;
  cursor: ((grid: Grid | null) => void) | null;
  items: Candidate[];
  selected: number;
  scroll: number;
  remove: number;
  visible: boolean;
  anchorKey: string | null;
  anchor: Grid | null;
  seq: number;
  counted: boolean;
  fresh: boolean;
  navigated: boolean;
}

const history = new History();
const helper = new Helper();
let active: Session | null = null;
let shells = 0;

function count(change: number) {
  shells += change;
  try {
    writeFileSync(join(dirname(SOCK), "shells"), `${shells}\n`);
  } catch {}
}

function setVisible(s: Session, visible: boolean) {
  if (visible) active = s;
  else if (active === s) active = null;
  if (s.visible === visible) return;
  s.visible = visible;
  s.socket.write(`S${SEP}${visible ? 1 : 0}\n`);
}

function hide(s: Session) {
  s.seq++;
  s.items = [];
  if (s.visible || active === s) helper.send({ cmd: "hide" });
  setVisible(s, false);
}

function chosen(s: Session, item: Candidate | undefined): boolean {
  return item !== undefined && Boolean(item.run || (item.pick && s.remove > 0) || s.navigated);
}

function render(s: Session) {
  if (!s.anchor || s.items.length === 0) return;
  if (s.selected < s.scroll) s.scroll = s.selected;
  if (s.selected >= s.scroll + VISIBLE) s.scroll = s.selected - VISIBLE + 1;
  const items = s.items.slice(s.scroll, s.scroll + VISIBLE).map(({ label, detail, icon, tint }) => ({ label, detail, icon, tint }));
  helper.send({ cmd: "show", grid: s.anchor, items, selected: chosen(s, s.items[s.selected]) ? s.selected - s.scroll : -1 });
  setVisible(s, true);
  s.fresh = true;
}

function present(s: Session, result: Suggestion, keep: boolean) {
  const previous = keep && chosen(s, s.items[s.selected]) ? s.items[s.selected]?.label : undefined;
  s.items = result.items;
  s.remove = result.remove;
  const index = previous === undefined ? -1 : result.items.findIndex((item) => item.label === previous);
  s.selected = Math.max(index, 0);
  s.scroll = 0;
}

function shellGrid(s: Session, seq: number): Promise<Grid | null> {
  s.cursor?.(null);
  return new Promise((resolve) => {
    const done = (grid: Grid | null) => {
      clearTimeout(timer);
      if (s.cursor === done) s.cursor = null;
      resolve(grid);
    };
    const timer = setTimeout(() => done(null), CURSOR_MS);
    s.cursor = done;
    s.socket.write(`Q${SEP}${seq}\n`);
  });
}

async function tmuxSettled(s: Session, seq: number): Promise<Grid | null> {
  await Bun.sleep(SETTLE_MS);
  if (seq !== s.seq || !s.tmux) return null;
  return tmuxGrid(s.tmux);
}

async function anchor(s: Session, seq: number, result: Suggestion, cwd: string, buffer: string): Promise<boolean> {
  const key = `${cwd}\n${buffer.slice(0, result.tokenStart)}`;
  if (s.anchorKey === key && s.anchor) return true;
  const grid = s.tmux ? await tmuxSettled(s, seq) : await shellGrid(s, seq);
  if (seq !== s.seq) return false;
  if (!grid) {
    hide(s);
    return false;
  }
  grid.col = Math.max(0, grid.col - result.remove + (result.lead ?? 0));
  s.anchorKey = key;
  s.anchor = grid;
  return true;
}

async function edit(s: Session, cursor: number, cwd: string, buffer: string) {
  const seq = ++s.seq;
  s.fresh = false;
  s.navigated = false;
  const result = await suggest(buffer, cursor, cwd, history);
  if (seq !== s.seq) return;
  if (!result.now && !result.more) return hide(s);

  if (result.now) {
    present(s, result.now, false);
    if (!(await anchor(s, seq, result.now, cwd, buffer))) return;
    render(s);
  } else if (s.visible) {
    s.items = [];
    helper.send({ cmd: "hide" });
    setVisible(s, false);
  }

  if (!result.more) return;
  const full = await result.more;
  if (seq !== s.seq) return;
  if (!full) {
    if (!result.now) hide(s);
    return;
  }
  const held = s.navigated ? s.items[s.selected]?.label : undefined;
  if (held !== undefined && !full.items.some((item) => item.label === held)) return;
  present(s, full, result.now !== null);
  if (!(await anchor(s, seq, full, cwd, buffer))) return;
  render(s);
}

helper.onHidden = () => {
  const s = active;
  if (!s) return;
  s.seq++;
  s.items = [];
  setVisible(s, false);
};

let focusBusy = false;
async function checkFocus() {
  const s = active;
  if (!s || !s.visible || !s.tmux || focusBusy) return;
  focusBusy = true;
  const state = await tmuxQuery(s.tmux, FOCUS_FORMAT);
  focusBusy = false;
  if (active !== s || !s.visible) return;
  if (state === null || state.trim() !== "1 1 0") hide(s);
}

function navigate(s: Session, direction: string) {
  if (direction === "esc") {
    if (s.visible) hide(s);
    return;
  }
  if (!s.visible || s.items.length === 0) return;
  const step = direction === "up" ? -1 : chosen(s, s.items[s.selected]) ? 1 : 0;
  s.selected = (s.selected + step + s.items.length) % s.items.length;
  s.navigated = true;
  render(s);
}

function accept(s: Session, typedOnly: boolean) {
  const item = s.visible && s.fresh ? s.items[s.selected] : undefined;
  if (!item || (typedOnly && (item.run || !chosen(s, item)))) {
    s.socket.write(`A${SEP}-1${SEP}\n`);
    return;
  }
  if (item.run) {
    s.socket.write(`A${SEP}0${SEP} \n`);
    hide(s);
    return;
  }
  s.socket.write(`A${SEP}${s.remove}${SEP}${item.insert ?? item.label + " "}\n`);
  hide(s);
}

function onLine(s: Session, line: string) {
  const f = line.split(SEP);
  if ((f[0] === "E" || f[0] === "L") && active && active !== s) hide(active);
  switch (f[0]) {
    case "H":
      s.tmux = f[2] && f[3] ? { socket: f[2], pane: f[3] } : null;
      if (!s.counted) {
        s.counted = true;
        count(1);
      }
      if (f[4]) process.env.PATH = f[4];
      s.term = f[5] ?? "";
      break;
    case "C":
      if (Number(f[1]) === s.seq) s.cursor?.(parseShell(f.slice(2), termPad(s.term)));
      break;
    case "L":
      history.refresh();
      s.anchorKey = null;
      hide(s);
      break;
    case "E":
      edit(s, Number(f[1]) || 0, f[2] ?? "", (f[3] ?? "").replaceAll("\x1e", "\n"));
      break;
    case "K":
      navigate(s, f[1] ?? "down");
      break;
    case "A":
      accept(s, false);
      break;
    case "R":
      accept(s, true);
      break;
    case "X":
      s.anchorKey = null;
      hide(s);
      break;
  }
}

export async function daemon() {
  mkdirSync(dirname(SOCK), { recursive: true, mode: 0o700 });
  chmodSync(dirname(SOCK), 0o700);
  try {
    const probe = await Bun.connect({ unix: SOCK, socket: { data() {} } });
    probe.end();
    process.exit(0);
  } catch {}
  try {
    unlinkSync(SOCK);
  } catch {}

  history.refresh(0);
  count(0);
  helper.notify({ cmd: "hide" });

  Bun.listen<Session>({
    unix: SOCK,
    socket: {
      open(socket) {
        socket.data = {
          socket,
          decoder: new TextDecoder(),
          pending: "",
          tmux: null,
          term: "",
          cursor: null,
          items: [],
          selected: 0,
          scroll: 0,
          remove: 0,
          visible: false,
          anchorKey: null,
          anchor: null,
          seq: 0,
          counted: false,
          fresh: false,
          navigated: false,
        };
      },
      data(socket, chunk) {
        const s = socket.data;
        s.pending += s.decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = s.pending.indexOf("\n")) >= 0) {
          const line = s.pending.slice(0, newline);
          s.pending = s.pending.slice(newline + 1);
          if (line) onLine(s, line);
        }
      },
      close(socket) {
        const s = socket.data;
        s.seq++;
        s.cursor?.(null);
        if (s.counted) count(-1);
        if (active === s) {
          active = null;
          helper.send({ cmd: "hide" });
        }
      },
      error() {},
    },
  });
  chmodSync(SOCK, 0o600);
  setInterval(checkFocus, FOCUS_MS);
}
