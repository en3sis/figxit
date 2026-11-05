import { ICONS, type Icon } from "../brands";
import type { Spec } from "../specs";
import { figxit } from "./figxit";
import { gh } from "./gh";
import { z, zi } from "./z";

export const FIGXIT_SPECS: Record<string, Spec> = { figxit, z, zi };

export const FIGXIT_ICONS: Record<string, Icon> = { z: ICONS.jump, zi: ICONS.jump };

export const PATCHES: Record<string, (spec: Spec) => Spec> = { gh };
