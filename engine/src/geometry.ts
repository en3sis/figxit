import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCommand } from "./paths";

export interface Grid {
  cols: number;
  rows: number;
  col: number;
  row: number;
  cellPxW?: number;
  cellPxH?: number;
  padX: number;
  padY: number;
  pane?: boolean;
  right?: boolean;
}

export interface TmuxTarget {
  socket: string;
  pane: string;
}

export interface HerdrTarget {
  bin: string;
  socket: string;
  pane: string;
}

export interface HerdrUi {
  borders: string;
  outer: boolean;
  bottom: boolean;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HerdrLayout {
  area: Box;
  zoomed?: boolean;
  panes: { pane_id: string; rect: Box }[];
}

const HERDR_CONFIG = join(homedir(), ".config/herdr/config.toml");

const FORMAT =
  "#{pane_left} #{pane_top} #{cursor_x} #{cursor_y} #{client_width} #{client_height} #{client_cell_width} #{client_cell_height} #{status} #{status-position} #{client_termname}";
const GHOSTTY = "/Applications/Ghostty.app/Contents/MacOS/ghostty";

let ghosttyPadding: { x: number; y: number } | null = null;

function ghosttyPad(): { x: number; y: number } {
  if (ghosttyPadding) return ghosttyPadding;
  const pad = { x: 2, y: 2 };
  if (existsSync(GHOSTTY)) {
    try {
      const out = Bun.spawnSync([GHOSTTY, "+show-config"], { stdout: "pipe", stderr: "ignore" }).stdout.toString();
      for (const line of out.split("\n")) {
        const match = /^window-padding-([xy]) = (\d+)/.exec(line);
        if (match) pad[match[1] as "x" | "y"] = Number(match[2]);
      }
    } catch {}
  }
  ghosttyPadding = pad;
  return pad;
}

export function parseTmux(line: string, padFor: (term: string) => { x: number; y: number }): Grid | null {
  const f = line.replace(/\n$/, "").split(" ");
  if (f.length < 11) return null;
  const n = f.slice(0, 8).map(Number);
  if (n.some(Number.isNaN)) return null;
  let row = n[1]! + n[3]!;
  if (f[9] === "top") row += f[8] === "on" ? 1 : f[8] === "off" ? 0 : Number(f[8]) || 0;
  const pad = padFor(f[10]!);
  const grid: Grid = { cols: n[4]!, rows: n[5]!, col: n[0]! + n[2]!, row, padX: pad.x, padY: pad.y };
  if (n[6]! > 0 && n[7]! > 0) {
    grid.cellPxW = n[6]!;
    grid.cellPxH = n[7]!;
  }
  return grid;
}

export function parseShell(f: string[], pad: { x: number; y: number }): Grid | null {
  const n = f.slice(0, 4).map(Number);
  if (n.length < 4 || n.some((value) => !Number.isInteger(value) || value < 1)) return null;
  const grid: Grid = { cols: n[2]!, rows: n[3]!, col: n[1]! - 1, row: n[0]! - 1, padX: pad.x, padY: pad.y, pane: true };
  const [cellH, cellW, areaH, areaW] = f.slice(4, 8).map(Number);
  if (cellH! > 0 && cellW! > 0) {
    grid.cellPxW = cellW;
    grid.cellPxH = cellH;
  } else if (areaH! > 0 && areaW! > 0) {
    grid.cellPxW = areaW! / grid.cols;
    grid.cellPxH = areaH! / grid.rows;
  }
  return grid;
}

export function termPad(term: string): { x: number; y: number } {
  return /ghostty/i.test(term) ? ghosttyPad() : { x: 0, y: 0 };
}

export async function tmuxQuery(target: TmuxTarget, format: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([resolveCommand("tmux"), "-S", target.socket, "display-message", "-p", "-t", target.pane, format], {
      env: process.env,
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(9), 1000);
    const out = await new Response(proc.stdout).text();
    const status = await proc.exited;
    clearTimeout(timer);
    return status === 0 ? out : null;
  } catch {
    return null;
  }
}

export async function tmuxGrid(target: TmuxTarget): Promise<Grid | null> {
  const out = await tmuxQuery(target, FORMAT);
  if (out === null) return null;
  return parseTmux(out, termPad);
}

export function herdrUi(path = HERDR_CONFIG): HerdrUi {
  const ui: HerdrUi = { borders: "auto", outer: true, bottom: false };
  try {
    const config = (Bun.TOML.parse(readFileSync(path, "utf8")) as { ui?: Record<string, unknown> }).ui ?? {};
    if (typeof config.pane_borders === "string") ui.borders = config.pane_borders.toLowerCase();
    if (typeof config.pane_outer_borders === "boolean") ui.outer = config.pane_outer_borders;
    ui.bottom = config.tab_bar_position === "bottom";
  } catch {}
  return ui;
}

export function placeHerdr(grid: Grid, reply: string, pane: string, ui: HerdrUi): Grid | null {
  let layout: HerdrLayout | undefined;
  try {
    layout = JSON.parse(reply)?.result?.layout;
  } catch {
    return null;
  }
  const own = layout?.panes?.find((entry) => entry.pane_id === pane);
  if (!layout?.area || !own) return null;
  const bordered = ui.borders !== "off" && (layout.panes.length > 1 || ui.borders === "always");
  let rect = own.rect;
  let left = 0;
  let top = 0;
  if (layout.zoomed) {
    rect = layout.area;
    left = top = bordered && ui.outer ? 1 : 0;
  } else if (bordered) {
    left = ui.outer || rect.x > Math.min(...layout.panes.map((entry) => entry.rect.x)) ? 1 : 0;
    top = ui.outer || rect.y > Math.min(...layout.panes.map((entry) => entry.rect.y)) ? 1 : 0;
  }
  return {
    ...grid,
    col: rect.x - layout.area.x + left + grid.col,
    row: rect.y - layout.area.y + top + grid.row,
    cols: layout.area.width,
    rows: layout.area.height + (ui.bottom ? 1 : 0),
    right: true,
  };
}

export async function herdrGrid(target: HerdrTarget, grid: Grid): Promise<Grid | null> {
  try {
    const env: Record<string, string | undefined> = { ...process.env, HERDR_SOCKET_PATH: target.socket };
    delete env.HERDR_SESSION;
    const proc = Bun.spawn([target.bin, "pane", "layout", "--pane", target.pane], { env, stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill(9), 1000);
    const out = await new Response(proc.stdout).text();
    const status = await proc.exited;
    clearTimeout(timer);
    return status === 0 ? placeHerdr(grid, out, target.pane, herdrUi()) : null;
  } catch {
    return null;
  }
}
