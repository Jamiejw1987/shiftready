/** Text length and character helpers. Safe to use in the browser and on the server. */

const GSM =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';

/** Swaps "smart" characters for plain ones so a text stays at 160 characters per segment instead of 70. */
export function plainText(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/•/g, '-');
}

export function segmentInfo(text: string): { chars: number; segments: number; unicode: boolean } {
  let unicode = false;
  let units = 0;
  for (const ch of text) {
    if (GSM.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else {
      unicode = true;
      break;
    }
  }
  if (unicode) {
    const n = [...text].length;
    return { chars: n, segments: n <= 70 ? 1 : Math.ceil(n / 67), unicode };
  }
  return { chars: units, segments: units <= 160 ? 1 : Math.ceil(units / 153), unicode };
}

