// Barcode normalization. Every product is stored under one canonical key so
// the same item scanned on iOS (UPC-A reported as a 13-digit EAN), Android
// (12-digit UPC-A) or typed by hand always matches the same row.
//
//   UPC-A (12)  -> GTIN-13 with a leading 0
//   UPC-E (6-8) -> expanded to UPC-A, then GTIN-13
//   EAN-13      -> unchanged
//   EAN-8       -> unchanged
//
// Pure TypeScript with no Deno or Node APIs, so it runs in Edge Functions and
// in the Node test script.

export type BarcodeHint = 'ean13' | 'ean8' | 'upc_a' | 'upc_e' | string;

/** GS1 check digit for the given digits (without the check digit). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  // Weights alternate 3,1,3,... starting from the rightmost body digit.
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(code: string): boolean {
  return /^\d{8,14}$/.test(code) && gs1CheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/**
 * Expand UPC-E to UPC-A. Accepts 6 digits (no number system or check),
 * 7 digits (number system + 6) or 8 digits (number system + 6 + check).
 * Returns null if the input is not valid UPC-E.
 */
export function expandUpcE(code: string): string | null {
  if (!/^\d{6,8}$/.test(code)) return null;
  const ns = code.length === 6 ? '0' : code[0];
  if (ns !== '0' && ns !== '1') return null;
  const d = code.length === 6 ? code : code.slice(1, 7);
  const last = d[5];

  let body: string; // 10 digits: manufacturer (5) + product (5)
  if (last <= '2') body = d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4];
  else if (last === '3') body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4];
  else if (last === '4') body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4];
  else body = d[0] + d[1] + d[2] + d[3] + d[4] + '0000' + last;

  const upcA = ns + body + gs1CheckDigit(ns + body);
  if (code.length === 8 && upcA.at(-1) !== code[7]) return null;
  return upcA;
}

/**
 * Normalize a scanned or typed barcode to the canonical key.
 * Returns null if it is not a valid retail barcode.
 */
export function normalizeBarcode(raw: string, hint?: BarcodeHint): string | null {
  const code = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code)) return null;

  if (hint === 'upc_e' || code.length === 6 || code.length === 7) {
    const upcA = expandUpcE(code);
    return upcA ? '0' + upcA : null;
  }

  switch (code.length) {
    case 8: {
      // Ambiguous without a hint. US shelves use UPC-E far more than EAN-8,
      // so prefer UPC-E when it is valid, unless the scanner said EAN-8.
      if (hint !== 'ean8') {
        const upcA = expandUpcE(code);
        if (upcA) return '0' + upcA;
      }
      return hasValidCheckDigit(code) ? code : null;
    }
    case 12:
      return hasValidCheckDigit(code) ? '0' + code : null;
    case 13:
      return hasValidCheckDigit(code) ? code : null;
    case 14:
      // GTIN-14 with indicator 0 is just a GTIN-13 with padding.
      return code[0] === '0' && hasValidCheckDigit(code) ? code.slice(1) : null;
    default:
      return null;
  }
}
