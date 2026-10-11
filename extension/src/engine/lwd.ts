// lightwalletd over gRPC, with fetch: what the iOS SDK reaches through gRPC-Swift. An extension
// may call the server across origins (host permission), and zec.rocks answers plain gRPC over
// HTTP/2. Messages are encoded by hand (a handful of fields); the engine decodes the rest.

const SERVICE = "/cash.z.wallet.sdk.rpc.CompactTxStreamer/";

// ---- protobuf, the few bits needed ----

function varint(n: number | bigint): number[] {
  let v = BigInt(n);
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return out;
}

const fieldVarint = (tag: number, n: number | bigint) => (n === 0 || n === 0n ? [] : [(tag << 3) | 0, ...varint(n)]);
const fieldBytes = (tag: number, b: Uint8Array | number[]) => [(tag << 3) | 2, ...varint(b.length), ...b];

/** The fields of a message, by tag: varints as bigint, length-delimited as bytes. */
export function decode(buf: Uint8Array): Map<number, (bigint | Uint8Array)[]> {
  const out = new Map<number, (bigint | Uint8Array)[]>();
  let i = 0;
  const readVarint = () => {
    let v = 0n;
    let shift = 0n;
    for (;;) {
      const b = buf[i++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const key = Number(readVarint());
    const tag = key >> 3;
    const type = key & 7;
    let value: bigint | Uint8Array;
    if (type === 0) value = readVarint();
    else if (type === 2) {
      const n = Number(readVarint());
      value = buf.subarray(i, i + n);
      i += n;
    } else if (type === 1) {
      i += 8;
      continue;
    } else if (type === 5) {
      i += 4;
      continue;
    } else throw new Error("unsupported protobuf wire type");
    const list = out.get(tag) ?? [];
    list.push(value);
    out.set(tag, list);
  }
  return out;
}

const num = (m: Map<number, (bigint | Uint8Array)[]>, tag: number) => Number((m.get(tag)?.[0] as bigint | undefined) ?? 0n);
const bytes = (m: Map<number, (bigint | Uint8Array)[]>, tag: number) => (m.get(tag)?.[0] as Uint8Array | undefined) ?? new Uint8Array();
const text = (m: Map<number, (bigint | Uint8Array)[]>, tag: number) => new TextDecoder().decode(bytes(m, tag));

const blockId = (height: number) => fieldVarint(1, height);

// ---- gRPC framing ----

export class LwdError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

function frame(msg: number[]): Uint8Array {
  const out = new Uint8Array(5 + msg.length);
  new DataView(out.buffer).setUint32(1, msg.length);
  out.set(msg, 5);
  return out;
}

async function post(server: string, method: string, msg: number[], signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`https://${server}${SERVICE}${method}`, {
    method: "POST",
    headers: { "content-type": "application/grpc" },
    body: frame(msg) as Uint8Array<ArrayBuffer>,
    signal,
  });
  // Errors without a body come back in the headers ("trailers-only").
  const status = res.headers.get("grpc-status");
  if (!res.ok || (status && status !== "0")) {
    throw new LwdError(decodeURIComponent(res.headers.get("grpc-message") ?? `HTTP ${res.status}`), Number(status ?? -1));
  }
  return res;
}

/** Each message of a (server-streaming) reply, as it arrives. */
async function* messages(res: Response): AsyncGenerator<Uint8Array> {
  const reader = res.body!.getReader();
  let buf = new Uint8Array(0);
  for (;;) {
    while (buf.length >= 5) {
      const n = new DataView(buf.buffer, buf.byteOffset).getUint32(1);
      if (buf.length < 5 + n) break;
      yield buf.slice(5, 5 + n);
      buf = buf.subarray(5 + n);
    }
    const { done, value } = await reader.read();
    if (done) return;
    const joined = new Uint8Array(buf.length + value.length);
    joined.set(buf);
    joined.set(value, buf.length);
    buf = joined;
  }
}

async function unary(server: string, method: string, msg: number[], signal?: AbortSignal): Promise<Uint8Array> {
  for await (const m of messages(await post(server, method, msg, signal))) return m;
  throw new LwdError("Empty reply from the server", -1);
}

// ---- the calls the wallet makes ----

export class Lwd {
  constructor(public server: string) {}

  /** Tip height. */
  async latestHeight(signal?: AbortSignal): Promise<number> {
    return num(decode(await unary(this.server, "GetLatestBlock", [], signal)), 1);
  }

  /** TreeState of `height` (protobuf, for the engine). */
  treeState(height: number): Promise<Uint8Array> {
    return unary(this.server, "GetTreeState", blockId(height));
  }

  /** The TreeState's block time (to estimate heights from dates). */
  static treeStateTime(state: Uint8Array): number {
    return num(decode(state), 4);
  }

  /** Subtree roots of `protocol` (0 Sapling, 1 Orchard, 2 Ironwood), protobuf each. */
  async subtreeRoots(protocol: number, start = 0): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    const msg = [...fieldVarint(1, start), ...fieldVarint(2, protocol)];
    for await (const m of messages(await post(this.server, "GetSubtreeRoots", msg))) out.push(m);
    return out;
  }

  /** Compact blocks `start` to `end` inclusive, protobuf each. */
  async blockRange(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    const msg = [...fieldBytes(1, blockId(start)), ...fieldBytes(2, blockId(end))];
    for await (const m of messages(await post(this.server, "GetBlockRange", msg, signal))) out.push(m);
    return out;
  }

  /**
   * A full transaction by id (bytes as stored, not reversed). `height`: mined height, 0 in the
   * mempool, -1 when known but not in the main chain. Null if the server doesn't know it.
   */
  async transaction(txid: Uint8Array): Promise<{ data: Uint8Array; height: number } | null> {
    try {
      const m = decode(await unary(this.server, "GetTransaction", fieldBytes(3, txid)));
      const h = (m.get(2)?.[0] as bigint | undefined) ?? 0n;
      return { data: bytes(m, 1), height: h === 0xffffffffffffffffn ? -1 : Number(h) };
    } catch (e) {
      if (e instanceof LwdError && (e.code === 5 || /not found|No information/i.test(e.message))) return null;
      throw e;
    }
  }

  /** Broadcasts; returns the node's error, or null once accepted. */
  async send(raw: Uint8Array): Promise<string | null> {
    const m = decode(await unary(this.server, "SendTransaction", fieldBytes(1, raw)));
    const code = num(m, 1);
    return code === 0 ? null : text(m, 2) || `error ${code}`;
  }
}
