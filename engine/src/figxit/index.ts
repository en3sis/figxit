import type { Spec } from "../specs";
import { figxit } from "./figxit";
import { gh } from "./gh";
import { z, zi } from "./z";

export const FIGXIT_SPECS: Record<string, Spec> = { figxit, z, zi };

export const PATCHES: Record<string, (spec: Spec) => Spec> = { gh };
