import type { Spec } from "../specs";

export const figxit: Spec = {
  name: "figxit",
  description: "Completion popup for the terminal",
  subcommands: [
    {
      name: "init",
      description: "Print the lines that load Figxit in a shell",
      args: { name: "shell", suggestions: ["zsh", "bash", "fish"] },
    },
    { name: "start", description: "Start the popup helper and the engine" },
    { name: "open", description: "Open the app and show its menu bar icon" },
    { name: "stop", description: "Stop the popup helper and the engine" },
    {
      name: "doctor",
      description: "Check the installation",
      options: [{ name: "--json", description: "Print the result as JSON" }],
    },
  ],
  options: [
    { name: ["--version", "-v"], description: "Print the version" },
    { name: "--help", description: "Print the commands" },
  ],
};
