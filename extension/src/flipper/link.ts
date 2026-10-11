// The Bluetooth link to ZFlip on a Flipper Zero, with Web Bluetooth (ZApp's FlipperLink).
// The Flipper exposes its serial GATT service under a ZFlip profile ("ZFlip <name>"); the first
// write makes the computer pair, and the Flipper shows a 6-digit code to type.
//
// A frame is 0x5A 0x01 kind len:u32le payload; strings are u16le-length UTF-8
// (flipper-zero/core/src/protocol.rs).

const SERVICE = "8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000";
/** Computer → Flipper (write). */
const RX = "19ed82ae-ed21-4c9d-4145-228e62fe0000";
/** Flipper → computer (indications). */
const TX = "19ed82ae-ed21-4c9d-4145-228e61fe0000";

export const Kind = { hello: 0x01, sign: 0x04, ping: 0x05, info: 0x81, address: 0x83, signed: 0x84, pong: 0x85, status: 0x86, error: 0xe0 } as const;

export type Frame = { kind: number; payload: Uint8Array };

export type FlipperInfo = {
  network: number;
  account: number;
  seedFingerprint: number[];
  ufvk: string;
  /** Unix time the seed was made on the Flipper, 0 if it was restored. */
  createdAt: number;
  deviceName: string;
  addressIndex: number;
};

export class FlipperError extends Error {
  constructor(
    readonly code: "unsupported" | "cancelled" | "notConnected" | "timeout" | "rejected" | "protocol",
    message: string = code,
  ) {
    super(message);
  }
}

class Reader {
  private o = 0;
  constructor(private d: Uint8Array) {}
  bytes(n: number) {
    if (this.o + n > this.d.length) throw new FlipperError("protocol", "Truncated reply");
    const b = this.d.subarray(this.o, this.o + n);
    this.o += n;
    return b;
  }
  u8 = () => this.bytes(1)[0];
  u16 = () => {
    const b = this.bytes(2);
    return b[0] | (b[1] << 8);
  };
  u32 = () => {
    const b = this.bytes(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  };
  string = () => new TextDecoder().decode(this.bytes(this.u16()));
}

export function parseInfo(d: Uint8Array): FlipperInfo {
  const r = new Reader(d);
  const network = r.u8();
  const account = r.u32();
  const seedFingerprint = [...r.bytes(32)];
  const ufvk = r.string();
  const createdAt = r.u32();
  const deviceName = r.string();
  let addressIndex = 0;
  try {
    addressIndex = r.u32();
  } catch {}
  return { network, account, seedFingerprint, ufvk, createdAt, deviceName, addressIndex };
}

function decodeError(d: Uint8Array): string {
  try {
    const r = new Reader(d);
    const code = r.u8();
    const msg = r.string();
    return code === 1 ? "REJECTED" : msg;
  } catch {
    return "Unknown Flipper error";
  }
}

export function encode(kind: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const out = new Uint8Array(7 + payload.length);
  out[0] = 0x5a;
  out[1] = 0x01;
  out[2] = kind;
  new DataView(out.buffer).setUint32(3, payload.length, true);
  out.set(payload, 7);
  return out;
}

export type LinkState = "idle" | "connecting" | "connected";

export class FlipperLink {
  state: LinkState = "idle";
  device: BluetoothDevice | null = null;
  /** The Flipper shows a prompt and waits for its user. */
  awaiting = false;
  onChange: () => void = () => {};
  /** The Flipper reports the receiving address it shows. */
  onAddress: (index: number, address: string) => void = () => {};

  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private buffer = new Uint8Array(0);
  private waiting: { resolve: (f: Frame) => void; reject: (e: Error) => void } | null = null;

  static get available(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  get connected() {
    return this.state === "connected";
  }

  get name() {
    return this.device?.name ?? "Flipper";
  }

  private set(s: LinkState) {
    this.state = s;
    this.onChange();
  }

  /** Asks the browser for a ZFlip nearby (its own device chooser). */
  async choose(): Promise<BluetoothDevice> {
    if (!FlipperLink.available) throw new FlipperError("unsupported");
    try {
      return await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "ZFlip" }], optionalServices: [SERVICE] });
    } catch (e) {
      throw new FlipperError("cancelled", String(e));
    }
  }

  /** A Flipper this browser was already allowed to use, by id (no chooser). */
  static async known(id: string): Promise<BluetoothDevice | null> {
    if (!FlipperLink.available || !navigator.bluetooth.getDevices) return null;
    try {
      return (await navigator.bluetooth.getDevices()).find((d) => d.id === id) ?? null;
    } catch {
      return null;
    }
  }

  async connect(device: BluetoothDevice, timeoutMs = 25_000) {
    this.device = device;
    this.set("connecting");
    device.addEventListener("gattserverdisconnected", this.dropped);
    const timer = setTimeout(() => device.gatt?.disconnect(), timeoutMs);
    try {
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(SERVICE);
      this.rx = await service.getCharacteristic(RX);
      const tx = await service.getCharacteristic(TX);
      tx.addEventListener("characteristicvaluechanged", (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        this.received(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      });
      await tx.startNotifications();
      this.set("connected");
    } catch (e) {
      this.reset();
      throw new FlipperError(String(e).includes("disconnected") ? "timeout" : "notConnected", String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  disconnect() {
    this.device?.gatt?.disconnect();
    this.reset();
  }

  private dropped = () => this.reset();

  private reset() {
    this.rx = null;
    this.awaiting = false;
    this.buffer = new Uint8Array(0);
    this.waiting?.reject(new FlipperError("notConnected"));
    this.waiting = null;
    this.set("idle");
  }

  /** Sends a frame and waits for the answer (STATUS frames only update `awaiting`). */
  async request(kind: number, payload: Uint8Array = new Uint8Array(), timeoutMs = 300_000): Promise<Frame> {
    if (!this.rx) throw new FlipperError("notConnected");
    const frame = encode(kind, payload);
    const reply = new Promise<Frame>((resolve, reject) => (this.waiting = { resolve, reject }));
    for (let o = 0; o < frame.length; o += 240) {
      await this.rx.writeValueWithResponse(frame.subarray(o, o + 240) as Uint8Array<ArrayBuffer>);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new FlipperError("timeout")), timeoutMs)));
    try {
      const r = await Promise.race([reply, timeout]);
      this.awaiting = false;
      this.onChange();
      if (r.kind === Kind.error) throw new FlipperError("rejected", decodeError(r.payload));
      return r;
    } finally {
      clearTimeout(timer);
      this.waiting = null;
    }
  }

  private received(bytes: Uint8Array) {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer);
    joined.set(bytes, this.buffer.length);
    this.buffer = joined;
    while (this.buffer.length >= 7) {
      if (this.buffer[0] !== 0x5a || this.buffer[1] !== 0x01) {
        this.buffer = new Uint8Array(0);
        this.waiting?.reject(new FlipperError("protocol", "Bad frame from the Flipper"));
        return;
      }
      const len = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint32(3, true);
      if (this.buffer.length < 7 + len) return;
      const frame: Frame = { kind: this.buffer[2], payload: this.buffer.slice(7, 7 + len) };
      this.buffer = this.buffer.slice(7 + len);
      if (frame.kind === Kind.status) {
        this.awaiting = frame.payload[0] === 1;
        this.onChange();
        continue;
      }
      if (frame.kind === Kind.address) {
        try {
          const r = new Reader(frame.payload);
          const index = r.u32();
          this.onAddress(index, r.string());
        } catch {}
        continue;
      }
      this.waiting?.resolve(frame);
    }
  }
}
