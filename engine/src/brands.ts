import brands from "./brands.json";

export interface Icon {
  icon: string;
  tint: string;
}

const table = brands as Record<string, { slug: string; hex: string }>;

export const ICONS = {
  command: { icon: "sf:terminal.fill", tint: "3A3A3C" },
  history: { icon: "sf:clock.arrow.circlepath", tint: "8E8E93" },
  flag: { icon: "sf:flag.fill", tint: "64748B" },
  file: { icon: "sf:doc.fill", tint: "64748B" },
  folder: { icon: "sf:folder.fill", tint: "3B82F6" },
  target: { icon: "sf:hammer.fill", tint: "D97706" },
  script: { icon: "sf:play.fill", tint: "16A34A" },
  branch: { icon: "sf:arrow.triangle.branch", tint: "F05032" },
  tag: { icon: "sf:tag.fill", tint: "0D9488" },
} satisfies Record<string, Icon>;

export function brandIcon(command: string | undefined): Icon | null {
  const brand = command ? table[command] : undefined;
  return brand ? { icon: `brand:${brand.slug}`, tint: brand.hex } : null;
}
