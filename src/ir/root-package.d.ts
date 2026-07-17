/**
 * Source-check bridge для package self-reference.
 *
 * Runtime `@labpics/icons/ir` намеренно берёт 444 SVG из корневого export,
 * чтобы tarball не содержал второй corpus. В чистом checkout `dist/index.d.ts`
 * ещё не существует, поэтому TypeScript нужна только форма namespace до build.
 * Имена и их наличие всё равно проверяются runtime-каталогом и tarball smoke.
 */
declare module '@labpics/icons' {
  const icons: Readonly<Record<string, string>>;
  export = icons;
}
