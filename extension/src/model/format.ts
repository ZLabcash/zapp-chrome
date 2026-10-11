// Amounts as ZApp writes them.

/** "1.2345 ZEC": 2 to 5 decimals, trailing zeros trimmed, "." decimal separator. */
export function zec(z: number): string {
  return zecAmount(z) + " ZEC";
}

/** The amount alone ("1.2345"), for next to the ZEC symbol. */
export function zecAmount(z: number): string {
  const v = Math.abs(z) / 1e8;
  let s = v.toFixed(5).replace(/0+$/, "");
  const [w, f = ""] = s.split(".");
  s = `${w}.${f.padEnd(2, "0")}`;
  return (z < 0 ? "-" : "") + s;
}

/** Decimal text → zatoshis (null unless above zero). */
export function parseZec(text: string): number | null {
  const s = text.trim().replace(",", ".");
  if (!/^\d*\.?\d{0,8}$/.test(s) || s === "" || s === ".") return null;
  const [w, f = ""] = s.split(".");
  const z = Number(w || "0") * 1e8 + Number(f.padEnd(8, "0"));
  return z > 0 ? z : null;
}

/** u1abcdef…12345678 */
export function shortAddress(a: string, head = 10, tail = 8): string {
  return a.length > head + tail + 4 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}
