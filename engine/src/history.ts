import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { historySegments } from "./tokenize";

export interface Entry {
  words: string[];
  cwd: string;
  ts: number;
  weight: number;
}

export interface TokenStat {
  score: number;
  count: number;
  local: number;
}

const DAY = 86_400_000;
const MAX_COMMAND = 400;

export function exitWeight(exit: number): number {
  if (exit === 0 || exit === -1) return 1;
  if (exit === 127) return 0;
  return 0.6;
}

export class History {
  entries: Entry[] = [];
  private byCommand = new Map<string, Entry[]>();
  private lastMs = 0;
  private lastRefresh = 0;
  private db: Database | null = null;

  constructor(private path = process.env.FIGXIT_ATUIN_DB ?? join(homedir(), ".local/share/atuin/history.db")) {}

  add(command: string, cwd: string, ts: number, exit: number) {
    const weight = exitWeight(exit);
    if (weight === 0 || command.length > MAX_COMMAND) return;
    for (const words of historySegments(command)) {
      const entry = { words, cwd, ts, weight };
      this.entries.push(entry);
      const list = this.byCommand.get(words[0]!);
      if (list) list.push(entry);
      else this.byCommand.set(words[0]!, [entry]);
    }
  }

  refresh(minInterval = 2000) {
    const now = Date.now();
    if (now - this.lastRefresh < minInterval) return;
    this.lastRefresh = now;
    try {
      if (!this.db) {
        if (!existsSync(this.path)) return;
        this.db = new Database(this.path, { readonly: true });
      }
      const rows = this.db
        .query(
          "select command, cwd, timestamp / 1000000 as ms, exit from history where deleted_at is null and timestamp / 1000000 > ? order by timestamp",
        )
        .all(this.lastMs) as { command: string; cwd: string; ms: number; exit: number }[];
      for (const row of rows) {
        this.add(row.command, row.cwd, row.ms, row.exit);
        if (row.ms > this.lastMs) this.lastMs = row.ms;
      }
    } catch {
      this.db = null;
    }
  }

  nextTokens(words: string[], cwd: string, root: string | null, now = Date.now()): Map<string, TokenStat> {
    const stats = new Map<string, TokenStat>();
    const depth = words.length;
    const pool = depth === 0 ? this.entries : (this.byCommand.get(words[0]!) ?? []);
    outer: for (const entry of pool) {
      if (entry.words.length <= depth) continue;
      for (let i = 1; i < depth; i++) {
        if (entry.words[i] !== words[i]) continue outer;
      }
      const token = entry.words[depth]!;
      const local = entry.cwd === cwd;
      const place = local ? 6 : root && entry.cwd.startsWith(root) ? 3 : 1;
      const recency = 0.2 + 0.8 * Math.pow(2, -(now - entry.ts) / (45 * DAY));
      const stat = stats.get(token);
      const score = place * recency * entry.weight;
      if (stat) {
        stat.score += score;
        stat.count++;
        if (local) stat.local++;
      } else {
        stats.set(token, { score, count: 1, local: local ? 1 : 0 });
      }
    }
    return stats;
  }
}
