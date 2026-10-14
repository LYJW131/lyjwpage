import type { Plugin } from "vite";

export type ModelIconMapping = { icon: string; keywords: string[] };
export function lobehubIconsDir(): string;
export function parseModelMappings(source: string): ModelIconMapping[];
export function modelIconMappings(iconsDir?: string): ModelIconMapping[];
export function modelIcons(): Plugin;
