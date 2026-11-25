import type { Spec } from "../specs";

// bat's --style takes a comma-separated list of these (bat --help, 0.26).
const STYLES: [string, string][] = [
  ["default", "Recommended components (the default)"],
  ["full", "All components"],
  ["auto", "Same as default, unless the output is piped"],
  ["plain", "No components"],
  ["changes", "Git modification markers"],
  ["header", "Alias for header-filename"],
  ["header-filename", "File names before the content"],
  ["header-filesize", "File sizes before the content"],
  ["grid", "Lines between the side bar, header and content"],
  ["rule", "Horizontal lines between files"],
  ["numbers", "Line numbers in the side bar"],
  ["snip", "Separators between distinct line ranges"],
];

const styleArg: Spec = {
  name: "components",
  generators: {
    trigger: ",",
    getQueryTerm: ",",
    custom: async (tokens: string[]) => {
      const chosen = new Set((tokens[tokens.length - 1] ?? "").split(",").slice(0, -1));
      return STYLES.filter(([name]) => !chosen.has(name)).map(([name, description]) => ({ name, description }));
    },
  },
};

export function bat(spec: Spec): Spec {
  const style = (spec.options as Spec[] | undefined)?.find((option) => option.name === "--style");
  if (style) {
    style.description = "Comma-separated list of components to show, like numbers,changes,grid";
    style.args = styleArg;
  }
  return spec;
}
