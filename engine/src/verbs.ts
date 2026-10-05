import type { Icon } from "./brands";

const TINT = "3A3A3C";

const VERBS: Record<string, { icon: string; words: string }> = {
  stop: { icon: "sf:stop.fill", words: "stop down kill halt" },
  run: { icon: "sf:play.fill", words: "dev start run serve preview watch up storybook" },
  build: { icon: "sf:hammer.fill", words: "build compile bundle dist cross package pack image" },
  test: { icon: "sf:checkmark.circle.fill", words: "test tests e2e bench cover coverage ci unit integration" },
  check: {
    icon: "sf:wand.and.stars",
    words: "lint format fmt check typecheck types tsc vet verify validate prettier eslint fix knip tidy",
  },
  clean: { icon: "sf:trash.fill", words: "clean reset purge distclean" },
  install: {
    icon: "sf:arrow.down.circle.fill",
    words: "install deps setup prepare postinstall preinstall bootstrap init tools update upgrade sync",
  },
  release: { icon: "sf:paperplane.fill", words: "release publish deploy version changeset push ship" },
  generate: { icon: "sf:gearshape.2.fill", words: "generate gen proto codegen swagger mocks" },
  docs: { icon: "sf:book.fill", words: "docs doc" },
  data: { icon: "sf:cylinder.fill", words: "db migrate migration seed prisma drizzle" },
  help: { icon: "sf:questionmark.circle.fill", words: "help all default" },
};

const BY_WORD = new Map<string, string>();
for (const [verb, { words }] of Object.entries(VERBS)) {
  for (const word of words.split(" ")) BY_WORD.set(word, verb);
}

export function verbOf(name: string): string | null {
  const parts = name.toLowerCase().split(/[:\-._/]/).filter(Boolean);
  let first: string | null = null;
  for (const part of parts) {
    const verb = BY_WORD.get(part);
    if (verb === "stop") return verb;
    if (verb && !first) first = verb;
  }
  return first;
}

export function verbIcon(name: string): Icon {
  const verb = verbOf(name);
  return { icon: verb ? VERBS[verb]!.icon : "sf:terminal.fill", tint: TINT };
}

const CAPITALS = /^(?=(?:[^A-Z]*[A-Z]){2})[A-Z0-9_.:-]+$/;
const PRODUCTION = /(^|[-_:.\/])(prod|production)($|[-_:.\/])/i;

export const CAUTION = "D70015";

export function cautious(name: string): boolean {
  return CAPITALS.test(name) || PRODUCTION.test(name);
}
