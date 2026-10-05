export interface Scan {
  segments: string[][];
  prefix: string;
  tokenStart: number;
  quoted: boolean;
}

const SEPARATORS = new Set([";", "|", "&", "(", ")", "\n"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(["sudo", "command", "noglob", "nocorrect", "time", "do", "then", "else", "elif", "if", "while", "until", "!", "{"]);
export const RESERVED = new Set(["done", "fi", "esac", "for", "in", "case", "select", "function", "}", "[[", "]]"]);

export function scan(text: string): Scan {
  const segments: string[][] = [[]];
  let current = "";
  let start = text.length;
  let inToken = false;
  let quote = "";

  const open = (index: number) => {
    if (!inToken) {
      inToken = true;
      start = index;
    }
  };
  const close = () => {
    if (inToken) {
      segments[segments.length - 1]!.push(current);
      current = "";
      inToken = false;
    }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < text.length) current += text[++i];
      else current += c;
      continue;
    }
    if (c === "\\" && i + 1 < text.length) {
      open(i);
      current += text[++i];
      continue;
    }
    if (c === "'" || c === '"') {
      open(i);
      quote = c;
      continue;
    }
    if (c === " " || c === "\t") {
      close();
      continue;
    }
    if (SEPARATORS.has(c)) {
      close();
      if (segments[segments.length - 1]!.length > 0) segments.push([]);
      continue;
    }
    open(i);
    current += c;
  }

  return {
    segments,
    prefix: inToken ? current : "",
    tokenStart: inToken ? start : text.length,
    quoted: quote !== "",
  };
}

export function commandWords(words: string[]): string[] {
  let index = 0;
  while (index < words.length && (ASSIGNMENT.test(words[index]!) || WRAPPERS.has(words[index]!))) index++;
  return index === 0 ? words : words.slice(index);
}

export function historySegments(command: string): string[][] {
  const result = scan(command);
  if (result.quoted) return [];
  const segments = result.segments.map((words) => words.slice());
  if (result.prefix !== "") segments[segments.length - 1]!.push(result.prefix);
  return segments.map(commandWords).filter((words) => words.length > 0);
}
