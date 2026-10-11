// Runtime ports carry JSON: bytes go as base64 inside { $u8 }.

export function pack(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    let s = "";
    for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000));
    return { $u8: btoa(s) };
  }
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === "object" && v.constructor === Object) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  }
  return v;
}

export function unpack(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$u8 === "string") return Uint8Array.from(atob(o.$u8), (c) => c.charCodeAt(0));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, unpack(x)]));
  }
  return v;
}
