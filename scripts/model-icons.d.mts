import type { Plugin } from "vite";

export type ModelIconMapping = { icon: string; keywords: string[] };
export function lobehubIconsDir(): string;
export function parseModelMappings(source: string): ModelIconMapping[];
export type ModelIconsOptions = { bundled?: readonly string[]; iconsDir?: string };
export function modelIconsModule(options?: ModelIconsOptions): string;
export function modelIcons(options?: ModelIconsOptions): Plugin;
