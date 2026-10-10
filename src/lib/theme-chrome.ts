import { HEATMAP_STORAGE_KEY } from "@/lib/heatmap-preference";

export const THEME_COLOR_LIGHT = "#edebe6";
export const THEME_COLOR_DARK = "#0d0b08";

export function themeColorFor(choice: string | null | undefined, prefersDark: boolean): string {
  const dark = choice === "dark" || (choice !== "light" && prefersDark);
  return dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

function paintThemeColorScript(choiceExpr: string): string {
  const light = JSON.stringify(THEME_COLOR_LIGHT);
  const dark = JSON.stringify(THEME_COLOR_DARK);
  return `var __d=${choiceExpr}==="dark"||(${choiceExpr}!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var __c=__d?${dark}:${light};var __ms=document.querySelectorAll('meta[name="theme-color"]');for(var __i=0;__i<__ms.length;__i++)__ms[__i].setAttribute("content",__c)`;
}

export function documentThemeBootScript(): string {
  return `try{var t=localStorage.getItem("theme")||"system";document.documentElement.dataset.themeChoice=t;var h=localStorage.getItem(${JSON.stringify(HEATMAP_STORAGE_KEY)});document.documentElement.dataset.heatmap=h==="commit"?"commit":"tokens";${paintThemeColorScript("t")}}catch(e){}`;
}

export function globalErrorThemeScript(): string {
  return `try{var t=localStorage.getItem("theme")||"system";if(t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}${paintThemeColorScript("t")}}catch(e){}`;
}
