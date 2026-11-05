import type { Spec } from "../specs";

const ALIAS_LINE = /^([^\s:]+):\s+(.*)$/;

async function ghAlias(token: string, run: (input: unknown) => Promise<{ stdout: string }>): Promise<string> {
  const { stdout } = await run({ command: "gh", args: ["alias", "list"] });
  for (const line of stdout.split("\n")) {
    const match = ALIAS_LINE.exec(line);
    if (match?.[1] === token) return match[2]!.trim();
  }
  throw new Error("not an alias");
}

export function gh(spec: Spec): Spec {
  const arg = Array.isArray(spec.args) ? spec.args[0] : spec.args;
  if (arg?.parserDirectives?.alias) arg.parserDirectives.alias = ghAlias;
  return spec;
}
