export function toB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Stored txid hex → as explorers show it (byte-reversed). */
export function hexReverse(hex: string): string {
  return (hex.match(/../g) ?? []).reverse().join("");
}

export function uuid(): string {
  return crypto.randomUUID();
}
