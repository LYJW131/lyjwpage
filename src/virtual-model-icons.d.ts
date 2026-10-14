declare module "virtual:model-icons" {
  import type { ComponentType } from "react";

  export const MODEL_ICON_MAPPINGS: ReadonlyArray<{ icon: string; keywords: string[] }>;
  export const MODEL_ICON_LOADERS: Readonly<
    Record<string, () => Promise<{ default: ComponentType<{ size?: number | string; className?: string }> }>>
  >;
}
