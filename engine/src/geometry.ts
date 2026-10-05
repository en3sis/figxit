import { existsSync } from "node:fs";
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
}

export interface TmuxTarget {
  socket: string;
  pane: string;
}

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
  return parseTmux(out, (term) => (term.includes("ghostty") ? ghosttyPad() : { x: 0, y: 0 }));
}
