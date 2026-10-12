// What the wallet model keeps and what the pages see (ZApp's WalletModel types).

export type WalletKind = "flipper" | "phone";

/** One wallet (persisted). A phone wallet's keys are in this browser, sealed by the password. */
export type Wallet = {
  id: string;
  kind: WalletKind;
  name: string;
  /** The Flipper's name ("ZFlip Ufre3t"); the wallet's name for a browser wallet. */
  deviceName: string;
  network: number;
  ufvk: string;
  seedFingerprint: number[];
  account: number;
  birthday: number;
  /** The receiving address index last shown on the Flipper (or here). */
  addressIndex: number;
  /** The engine's account. */
  accountUuid: string;
  /** The Flipper's Web Bluetooth device id, to reconnect without the chooser. */
  deviceId?: string;
};

export type Payment = { address: string; zatoshi: number; memo: string };

/** A transaction signed by the Flipper and kept here until broadcast or discarded. */
export type PendingBroadcast = {
  id: string;
  created: number;
  payments: Payment[];
  /** Past this height the network refuses it (built to expire 40 blocks on). */
  expiryHeight: number;
  signedHeight: number;
  walletId: string;
  fee: number;
  signer: string;
  /** Proven PCZT and signed PCZT, base64 (combined at broadcast). */
  proofs: string;
  sigs: string;
};

export type ActivityItem = {
  /** As stored (hex). */
  id: string;
  /** As explorers show it (byte-reversed hex). */
  txid: string;
  sent: boolean;
  /** For a payment: what the recipients got (fee apart). Otherwise what came in. */
  zatoshi: number;
  fee: number | null;
  minedHeight: number | null;
  expired: boolean;
  blockTime: number | null;
  memos: string[];
};

export type Contact = { id: string; name: string; address: string };

export type Settings = {
  /** 0 system, 1 light, 2 dark. */
  appearance: number;
  currency: string;
  /** "" = follow the browser. */
  language: string;
  autoBroadcast: boolean;
  server: string;
  explorer: string;
  showFiat: boolean;
  /** Minutes without use before the wallet locks itself (0: never). */
  lockMinutes: number;
};

export type SyncInfo = {
  progress: number;
  tip: number;
  scanned: number;
  synced: boolean;
  error: string | null;
  reachable: boolean;
};

export type SendStep =
  | { step: "idle" }
  | { step: "preparing" }
  | { step: "confirmOnDevice" }
  | { step: "broadcasting" }
  | { step: "signedOffline"; pendingId: string }
  | { step: "sent"; txid: string }
  | { step: "failed"; message: string };

export type State = {
  ready: boolean;
  wallets: Wallet[];
  activeId: string | null;
  /** Each wallet's balance (spendable + own change), for the wallet list. */
  balances: Record<string, number>;
  balance: number;
  pending: number;
  change: number;
  sync: SyncInfo;
  activity: ActivityItem[];
  pendingBroadcasts: PendingBroadcast[];
  contacts: Contact[];
  settings: Settings;
  prices: Record<string, number>;
  /** A password exists for the browser wallets; Touch ID can unlock it too. */
  vault: { exists: boolean; passkey: boolean };
  /** A password exists and hasn't been typed this session. */
  locked: boolean;
  flipper: import("./wallet").FlipperLinkState;
  /** A page (side panel or app tab) holds the Bluetooth link. */
  flipperHost: boolean;
  send: SendStep;
  online: boolean;
};

export const SERVERS = ["zec.rocks:443", "na.zec.rocks:443", "eu.zec.rocks:443", "ap.zec.rocks:443", "sa.zec.rocks:443"];

export const EXPLORERS: { name: string; template: string }[] = [
  { name: "ZScan", template: "https://zscan.cash/tx/{txid}" },
  { name: "Blockchair", template: "https://blockchair.com/zcash/transaction/{txid}" },
  { name: "3xpl", template: "https://3xpl.com/zcash/transaction/{txid}" },
];

export const DEFAULT_SETTINGS: Settings = {
  appearance: 0,
  currency: "usd",
  language: "",
  autoBroadcast: true,
  server: SERVERS[0],
  explorer: EXPLORERS[0].template,
  showFiat: false,
  lockMinutes: 15,
};

/** Most recipients in one transaction (what the Flipper has been checked to hold). */
export const MAX_RECIPIENTS = 5;
/** ZIP 317: 5,000 zatoshis per logical action, at least two. */
export const MINIMUM_FEE = 10_000;
/** Confirmations before received ZEC is spendable. */
export const CONFIRMATIONS = 10;
