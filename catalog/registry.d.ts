declare module '#catalog' {
  import type { IconSymbol } from '@labpics/icons/render';
  export const entries: { id: string; animated: boolean; families: { family: string; state: string }[] }[];
  export const families: Record<string, Record<string, string>>;
  export const nativeFiles: Record<string, string>;
  export const loaders: Record<string, () => Promise<IconSymbol>>;
  export const version: string;
}
