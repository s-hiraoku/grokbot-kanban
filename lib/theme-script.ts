export type ThemeChoice = "light" | "dark" | "system";
export const THEME_KEY = "kanban.theme";
const DARK = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before the first paint, so a dark board never flashes light (or the other way round).
 * It reads the saved choice, falls back to the OS, and keeps following the OS while the choice is System.
 */
export const THEME_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_KEY)},m=matchMedia(${JSON.stringify(DARK)});var a=function(){var c=null;try{c=localStorage.getItem(k)}catch(e){}var d=c==="dark"||(c!=="light"&&m.matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"};a();m.addEventListener("change",a)}catch(e){}})();`;

