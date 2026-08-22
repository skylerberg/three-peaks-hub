// There is no `cp437` Encoding label -- `new TextDecoder('cp437')` throws a
// RangeError in Node and in Chromium alike -- and windows-1252 is not a
// substitute, because CP437's upper half is box-drawing and Greek.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0';

// A clear language-encoding flag does not mean CP437: macOS `ditto` and
// Info-ZIP 3.0 both write UTF-8 names and leave it clear, with no Unicode Path
// extra field either. Decoding CP437 over one of those turns "Déck" into
// "DÃ©ck", which is a renamed card and a tombstoned original on the next
// import -- so the flag only ever forces UTF-8, never CP437.
export function decodeEntryName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let name = '';
    for (const byte of bytes) {
      name += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
    }
    return name;
  }
}
