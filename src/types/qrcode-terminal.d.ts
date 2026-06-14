/**
 * Slice 2026-06-14-cc-connect-weixin — minimal ambient module
 * declaration for `qrcode-terminal`. The package ships no
 * .d.ts file; we describe just the surface peaks-cli uses.
 */
declare module 'qrcode-terminal' {
  interface QrcodeTerminal {
    generate(
      input: string,
      options?: { small?: boolean },
      callback?: (qr: string) => void
    ): void;
  }
  const qrcodeTerminal: QrcodeTerminal;
  export default qrcodeTerminal;
}
