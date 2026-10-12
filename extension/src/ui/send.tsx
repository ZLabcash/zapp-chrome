// Send, in steps as wallet extensions do: who (your wallets, contacts, paste or scan), how much
// (and a message), more recipients (up to 5, one transaction, one signature), then a review to
// confirm or reject; then signing (this browser's keys, or the Flipper) and the result.

import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t, formatFiat } from "../i18n";
import { call, isPopup, nav, openApp, useStore } from "./store";
import { Icon } from "./icons";
import { FlipperIcon, ForgingShield, Shield, ZecLogo } from "./marks";
import { Note, Screen, Toggle } from "./kit";
import { parseZec, shortAddress, zec } from "../model/format";
import { MAX_RECIPIENTS, MINIMUM_FEE, type Payment } from "../model/types";
import { activeWallet, WalletAvatar } from "./home";
import { AddressKv, explorerUrl, PendingScreen, useNames } from "./activity";

type Line = { address: string; amount: string; memo: string };

/** Address validity, cached (checked by the engine): "unified", "sapling", "transparent", "tex" or "". */
const kinds = new Map<string, string>();
async function addressKind(a: string): Promise<string> {
  const k = a.trim();
  if (!kinds.has(k)) kinds.set(k, await call<string>("addressKind", k));
  return kinds.get(k)!;
}

/** A zcash: payment request (ZIP 321), or a plain address. */
function parseRequest(text: string): { address: string; amount?: string; memo?: string } {
  const s = text.trim();
  if (!s.toLowerCase().startsWith("zcash:")) return { address: s };
  const [head, query = ""] = s.slice(6).split("?");
  const params = new URLSearchParams(query);
  let memo: string | undefined;
  const m = params.get("memo");
  if (m) {
    try {
      memo = new TextDecoder().decode(Uint8Array.from(atob(m.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>);
    } catch {}
  }
  return { address: head || params.get("address") || "", amount: params.get("amount") ?? undefined, memo };
}

export function SendFlow() {
  const s = useStore();
  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState<Line>({ address: "", amount: "", memo: "" });
  const [step, setStep] = useState<"to" | "amount" | "review">("to");
  const [sameMemo, setSameMemo] = useState(false);
  const [sharedMemo, setSharedMemo] = useState("");

  if (s.send.step !== "idle") return <SendProgress />;

  if (step === "to")
    return (
      <ToStep
        count={lines.length}
        onBack={lines.length ? () => setStep("review") : undefined}
        onPick={(r) => {
          setEditing({ address: r.address, amount: r.amount ?? "", memo: r.memo ?? "" });
          setStep("amount");
        }}
      />
    );
  if (step === "amount")
    return (
      <AmountStep
        line={editing}
        others={lines}
        onBack={() => setStep("to")}
        onDone={(l, more) => {
          const next = [...lines, l];
          setLines(next);
          if (more) {
            setEditing({ address: "", amount: "", memo: "" });
            setStep("to");
          } else setStep("review");
        }}
      />
    );
  return (
    <ReviewStep
      lines={lines}
      sameMemo={sameMemo}
      sharedMemo={sharedMemo}
      onSameMemo={setSameMemo}
      onSharedMemo={setSharedMemo}
      onRemove={(i) => {
        const next = lines.filter((_, j) => j !== i);
        setLines(next);
        if (!next.length) setStep("to");
      }}
      onEdit={(i) => {
        setEditing(lines[i]);
        setLines(lines.filter((_, j) => j !== i));
        setStep("amount");
      }}
      onAdd={() => {
        setEditing({ address: "", amount: "", memo: "" });
        setStep("to");
      }}
    />
  );
}

/** Step 1: who. Your other wallets, your contacts, or an address (pasted, typed or scanned). */
function ToStep({ onPick, count, onBack }: { onPick: (r: { address: string; amount?: string; memo?: string }) => void; count: number; onBack?: () => void }) {
  const s = useStore();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [mine, setMine] = useState<{ id: string; name: string; address: string }[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const others = s.wallets.filter((w) => w.id !== s.activeId);
    Promise.all(others.map(async (w) => ({ id: w.id, name: w.name, address: await call<string>("address", w.ufvk, w.addressIndex) }))).then(setMine);
  }, []);
  const req = parseRequest(text);
  useEffect(() => {
    setKind(null);
    if (req.address.length < 20) return;
    addressKind(req.address).then(setKind);
  }, [req.address]);
  const q = text.trim().toLowerCase();
  const contacts = s.contacts.filter((c) => !q || c.name.toLowerCase().includes(q) || c.address.startsWith(text.trim()));
  const wallets = mine.filter((w) => !q || w.name.toLowerCase().includes(q));
  const row = (key: string, avatar: preact.ComponentChildren, title: string, address: string) => (
    <button key={key} class="list-row" onClick={() => onPick({ address })}>
      {avatar}
      <div class="stack gap-2" style={{ minWidth: 0 }}>
        <span class="sub b ellipsis">{title}</span>
        <span class="cap mono muted">{shortAddress(address, 12, 8)}</span>
      </div>
    </button>
  );
  return (
    <Screen
      title={count ? t("Recipient %lld", count + 1) : t("Send ZEC")}
      onBack={onBack ? () => (onBack(), "stay") : undefined}
    >
      <div style={{ padding: "14px 16px 6px" }}>
        <div class="input">
          <input
            ref={ref}
            placeholder={t("Search, or paste an address")}
            spellcheck={false}
            autocomplete="off"
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && kind && onPick(req)}
          />
          {!text && (
            <button class="yellow" aria-label={t("Paste")} title={t("Paste")} onClick={async () => setText((await navigator.clipboard.readText()).trim())}>
              <Icon name="copy" size={17} />
            </button>
          )}
          <button class="yellow" aria-label={t("Scan a QR code")} title={t("Scan a QR code")} onClick={() => (isPopup ? openApp("#scan") : nav.push(() => <ScanScreen onText={(x) => onPick(parseRequest(x))} />))}>
            <Icon name="scan" size={18} />
          </button>
        </div>
        {text.trim().length >= 20 && kind === "" && <div class="foot orange" style={{ marginTop: 8 }}>{t("Not a valid Zcash address for this network.")}</div>}
      </div>
      {kind && (
        <>
          <div class="section-title">{t("Address")}</div>
          {row("typed", <span class="avatar"><Icon name="person-circle" size={16} /></span>, shortAddress(req.address, 10, 6), req.address)}
        </>
      )}
      {wallets.length > 0 && (
        <>
          <div class="section-title">{t("My wallets")}</div>
          {wallets.map((w) => row(w.id, <WalletAvatar w={s.wallets.find((x) => x.id === w.id)} />, w.name, w.address))}
        </>
      )}
      <div class="section-title">{t("Contacts")}</div>
      {contacts.length === 0 && <div class="foot muted" style={{ padding: "4px 16px 16px" }}>{t("No contacts yet. Add one with +, or save an address from Send.")}</div>}
      {contacts.map((c) =>
        row(
          c.id,
          <span class="avatar" style={{ fontWeight: 700 }}>
            {c.name.slice(0, 1).toUpperCase()}
          </span>,
          c.name,
          c.address,
        ),
      )}
    </Screen>
  );
}

/** Step 2: how much, and an optional message. */
function AmountStep({ line, others, onBack, onDone }: { line: Line; others: Line[]; onBack: () => void; onDone: (l: Line, more: boolean) => void }) {
  const s = useStore();
  const name = useNames();
  const [amount, setAmount] = useState(line.amount);
  const [memo, setMemo] = useState(line.memo);
  const [kind, setKind] = useState("unified");
  const [saving, setSaving] = useState(false);
  const [contactName, setContactName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    addressKind(line.address).then(setKind);
  }, []);
  const z = parseZec(amount);
  const already = others.reduce((a, l) => a + (parseZec(l.amount) ?? 0), 0);
  const available = Math.max(0, s.balance - already - MINIMUM_FEE);
  const tooMuch = z !== null && z > available;
  const code = s.settings.currency;
  const fiat = z ? formatFiat(z, s.prices[code], code) : null;
  const n = name(line.address);
  const transparent = kind === "transparent" || kind === "tex";
  const ok = z !== null && !tooMuch;
  const done = (more: boolean) => ok && onDone({ address: line.address.trim(), amount, memo: transparent ? "" : memo }, more);
  return (
    <Screen
      title={t("Amount")}
      onBack={() => (onBack(), "stay")}
      footer={
        <>
          {others.length + 1 < MAX_RECIPIENTS && (
            <button class="btn ghost" disabled={!ok} onClick={() => done(true)}>
              <Icon name="plus" size={15} stroke={2.6} />
              {t("Add a recipient")}
            </button>
          )}
          <button class="btn fill" disabled={!ok} onClick={() => done(false)}>
            {t("Continue")}
          </button>
        </>
      }
    >
      <div class="stack gap-16" style={{ padding: 16 }}>
        <div class="row gap-10" style={{ padding: "8px 10px", borderRadius: 12, background: "var(--card)" }}>
          <span class="avatar">
            <Icon name="arrow-up" size={15} stroke={2.6} />
          </span>
          <div class="stack gap-2 spacer" style={{ minWidth: 0 }}>
            <span class="sub b ellipsis">{n ?? t("To")}</span>
            <span class="cap mono muted">{shortAddress(line.address, 12, 8)}</span>
          </div>
          {!n && !saving && (
            <button class="icon-btn" title={t("Save to address book")} aria-label={t("Save to address book")} onClick={() => setSaving(true)}>
              <Icon name="person-plus" size={17} />
            </button>
          )}
        </div>
        {saving && (
          <div class="row gap-8">
            <div class="input">
              <input placeholder={t("Name")} value={contactName} onInput={(e) => setContactName((e.target as HTMLInputElement).value)} />
            </div>
            <button
              class="btn fill"
              style={{ height: 40 }}
              disabled={!contactName.trim()}
              onClick={() => {
                call("saveContact", { id: "", name: contactName, address: line.address.trim() });
                setSaving(false);
              }}
            >
              {t("Save")}
            </button>
          </div>
        )}
        <div class="stack center gap-4" style={{ padding: "10px 0" }}>
          <div class="row gap-8" style={{ justifyContent: "center" }}>
            <input
              ref={ref}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onInput={(e) => setAmount((e.target as HTMLInputElement).value.replace(",", "."))}
              onKeyDown={(e) => e.key === "Enter" && done(false)}
              class="rounded num"
              style={{ fontSize: 38, fontWeight: 700, textAlign: "center", width: `${Math.max(1, amount.length) + 0.6}ch`, maxWidth: 240 }}
            />
            <span class="rounded muted" style={{ fontSize: 22, fontWeight: 700 }}>
              ZEC
            </span>
          </div>
          <span class="foot muted num" style={{ minHeight: 18 }}>
            {fiat ? `≈ ${fiat}` : ""}
          </span>
        </div>
        <div class="row foot">
          <span class="muted">
            {t("Spendable")}: <span class="num">{zec(s.balance)}</span>
          </span>
          <span class="spacer" />
          {available > 0 && (
            <button class="yellow" style={{ fontWeight: 700 }} onClick={() => setAmount((available / 1e8).toFixed(8).replace(/\.?0+$/, ""))}>
              {t("Max")}
            </button>
          )}
        </div>
        {amount && z === null && <Note text={t("Enter an amount above zero, like 0.01.")} />}
        {tooMuch && <Note text={t("That's more than your spendable balance of %@.", zec(Math.max(0, s.balance - already)))} />}
        {s.pending > 0 && <div class="foot muted">{t("%@ still confirming: spendable after 10 confirmations.", zec(s.pending))}</div>}
        {!transparent && (
          <div>
            <label class="label">{t("Message (optional)")}</label>
            <div class="input">
              <textarea rows={2} maxLength={512} value={memo} onInput={(e) => setMemo((e.target as HTMLTextAreaElement).value)} />
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}

/** Step 3: everything that will be signed, the fee and the total; reject or confirm. */
function ReviewStep(p: {
  lines: Line[];
  sameMemo: boolean;
  sharedMemo: string;
  onSameMemo: (v: boolean) => void;
  onSharedMemo: (v: string) => void;
  onRemove: (i: number) => void;
  onEdit: (i: number) => void;
  onAdd: () => void;
}) {
  const s = useStore();
  const w = activeWallet(s)!;
  const multi = p.lines.length > 1;
  const payments: Payment[] = p.lines.map((l) => ({ address: l.address, zatoshi: parseZec(l.amount) ?? 0, memo: multi && p.sameMemo ? p.sharedMemo : l.memo }));
  const total = payments.reduce((a, x) => a + x.zatoshi, 0);
  const [fee, setFee] = useState<number | null>(null);
  const [feeFailed, setFeeFailed] = useState(false);
  useEffect(() => {
    setFee(null);
    setFeeFailed(false);
    call<number | null>("proposalFee", payments).then((f) => (f === null ? setFeeFailed(true) : setFee(f)));
  }, [p.lines.map((l) => l.address + l.amount).join()]);
  const feeOrMin = fee ?? MINIMUM_FEE;
  const code = s.settings.currency;
  const pendingHere = s.pendingBroadcasts.some((x) => x.walletId === s.activeId);
  const blocking = total + feeOrMin > s.balance ? t("That leaves nothing for the network fee (%@). You can send up to %@%@.", zec(feeOrMin), zec(Math.max(0, s.balance - feeOrMin)), multi ? t(" in total") : "") : null;
  const confirm = () => {
    if (w.kind === "phone") call("sendFromBrowser", payments);
    else call("sendWithFlipper", payments);
  };
  return (
    <Screen
      title={t("Review")}
      footer={
        <>
          <button class="btn line" onClick={() => nav.pop()}>
            {t("Reject")}
          </button>
          <button class="btn fill" disabled={fee === null || !!blocking || pendingHere} onClick={confirm}>
            {w.kind === "flipper" ? t("Sign on Flipper") : t("Confirm")}
          </button>
        </>
      }
    >
      <div class="stack gap-12" style={{ padding: 16 }}>
        <div class="row gap-10" style={{ padding: "8px 10px", borderRadius: 12, background: "var(--card)" }}>
          <WalletAvatar w={w} />
          <div class="stack gap-2">
            <span class="cap muted">{t("From")}</span>
            <span class="sub b">{w.name}</span>
          </div>
        </div>
        <div class="stack">
          {payments.map((pay, i) => (
            <Fragment key={i}>
              <div class="row" style={{ paddingTop: 8 }}>
                <span class="cap muted upper" style={{ fontWeight: 600 }}>{multi ? t("Recipient %lld", i + 1) : t("To")}</span>
                <span class="spacer" />
                <button class="icon-btn" style={{ width: 28, height: 28 }} title={t("Edit")} onClick={() => p.onEdit(i)}>
                  <Icon name="pencil" size={13} />
                </button>
                {multi && (
                  <button class="icon-btn" style={{ width: 28, height: 28 }} title={t("Remove recipient %lld", i + 1)} onClick={() => p.onRemove(i)}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
              <AddressKv label={t("Address")} address={pay.address} />
              <div class="kv" style={{ borderBottom: "1px solid var(--line)" }}>
                <span>{t("Amount")}</span>
                <span class="num" style={{ fontWeight: 600 }}>{zec(pay.zatoshi)}</span>
              </div>
              {!(multi && p.sameMemo) && pay.memo && (
                <div class="kv" style={{ borderBottom: "1px solid var(--line)" }}>
                  <span>{t("Message")}</span>
                  <span>{pay.memo}</span>
                </div>
              )}
            </Fragment>
          ))}
        </div>
        {p.lines.length < MAX_RECIPIENTS && (
          <button class="row gap-6 sub b yellow" style={{ justifyContent: "center", padding: "10px 0", borderRadius: 12, border: "1.5px dashed rgba(244,183,40,0.5)" }} onClick={p.onAdd}>
            <Icon name="plus" size={15} stroke={2.6} />
            {t("Add a recipient")}
          </button>
        )}
        {multi && (
          <div class="stack gap-8" style={{ padding: 12, borderRadius: 12, background: "var(--card)" }}>
            <div class="row">
              <span class="sub b spacer">{t("Same message for everyone")}</span>
              <Toggle on={p.sameMemo} onChange={p.onSameMemo} />
            </div>
            {p.sameMemo && (
              <div class="input">
                <textarea rows={2} maxLength={512} placeholder={t("Message for all recipients (optional)")} value={p.sharedMemo} onInput={(e) => p.onSharedMemo((e.target as HTMLTextAreaElement).value)} />
              </div>
            )}
          </div>
        )}
        <div class="stack" style={{ padding: "4px 12px", borderRadius: 12, background: "var(--card)" }}>
          {multi && (
            <div class="kv">
              <span>{t("Total to %lld recipients", payments.length)}</span>
              <span class="num">{zec(total)}</span>
            </div>
          )}
          <div class="kv">
            <span>{t("Network fee")}</span>
            <span class="num">{fee !== null ? zec(fee) : feeFailed ? "—" : "…"}</span>
          </div>
          <div class="kv" style={{ fontSize: 15 }}>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{t("Total")}</span>
            <span class="stack" style={{ alignItems: "flex-end" }}>
              <span class="num" style={{ fontWeight: 700 }}>{zec(total + feeOrMin)}</span>
              <span class="cap muted num">{formatFiat(total + feeOrMin, s.prices[code], code)}</span>
            </span>
          </div>
        </div>
        {blocking && <Note text={blocking} />}
        {feeFailed && !blocking && <Note text={t("Could not prepare the transaction: %@", t("Not enough spendable ZEC."))} />}
        {pendingHere && <Note text={t("A signed payment is waiting in To broadcast, on Home. Broadcast or cancel it first: a new one could spend the same funds.")} />}
        <div class="cap muted" style={{ lineHeight: 1.4 }}>
          {w.kind === "phone"
            ? multi
              ? t("One transaction for all of them, signed with this browser's keys.")
              : t("Signed with this browser's keys.")
            : multi
              ? t("One transaction, one signature. Your signing device shows each payment in turn, then the total and the fee: approve once to sign them all.")
              : t("Your signing device shows the amount, the recipient and the fee. Check them on its screen, then approve to sign.")}
        </div>
      </div>
    </Screen>
  );
}

/** Reads a Zcash QR code with the camera (in the full page or side panel). */
export function ScanScreen({ onText }: { onText: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    (async () => {
      try {
        const Detector = (window as any).BarcodeDetector;
        if (!Detector) throw new Error("none");
        const detector = new Detector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.current!.srcObject = stream;
        await video.current!.play();
        const look = async () => {
          if (done) return;
          const codes = await detector.detect(video.current!).catch(() => []);
          if (codes[0]?.rawValue) {
            done = true;
            nav.pop();
            onText(codes[0].rawValue);
            return;
          }
          raf = requestAnimationFrame(look);
        };
        look();
      } catch {
        setError(t("The camera isn't available. Allow it for ZApp in Chrome's settings."));
      }
    })();
    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, []);
  return (
    <Screen title={t("Scan a Zcash QR code")}>
      <div style={{ padding: 16 }}>{error ? <div class="sub muted" style={{ textAlign: "center", padding: 20 }}>{error}</div> : <video ref={video} muted playsInline style={{ width: "100%", borderRadius: 14, background: "#000", aspectRatio: "1" }} />}</div>
    </Screen>
  );
}

/** Preparing, confirming on the Flipper, broadcasting, then Sent, signed for later, or not sent. */
function SendProgress() {
  const s = useStore();
  const step = s.send;
  const w = activeWallet(s);
  const done = () => {
    call("setSend", { step: "idle" });
    nav.root();
  };
  if (step.step === "signedOffline") {
    call("setSend", { step: "idle" });
    nav.reset(() => <PendingScreen id={step.pendingId} afterSigning />);
    return null;
  }
  return (
    <Screen
      title={t("Send ZEC")}
      back={step.step === "failed" || step.step === "sent"}
      onBack={() => call("setSend", { step: "idle" })}
      scroll={false}
      footer={
        step.step === "sent" ? (
          <button class="btn fill" onClick={done}>
            {t("Done")}
          </button>
        ) : step.step === "failed" ? (
          <button class="btn fill" onClick={() => call("setSend", { step: "idle" })}>
            {t("Back")}
          </button>
        ) : undefined
      }
    >
      <div class="stack center gap-16" style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        {step.step === "sent" ? (
          <>
            <Shield size={84} />
            <div style={{ fontSize: 24, fontWeight: 700 }}>{t("Sent")}</div>
            <div class="mono cap muted break" style={{ textAlign: "center", userSelect: "all" }}>
              {step.txid}
            </div>
            <a class="row gap-6 sub b yellow" href={explorerUrl(s, step.txid)} target="_blank">
              <Icon name="external" size={15} />
              {t("View on the explorer")}
            </a>
          </>
        ) : step.step === "failed" ? (
          <>
            <span class="red">
              <Icon name="shield" size={60} stroke={1.6} />
            </span>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{t("Not sent")}</div>
            <div class="sub muted" style={{ textAlign: "center", lineHeight: 1.4 }}>
              {explainSend(step.message)}
            </div>
          </>
        ) : step.step === "confirmOnDevice" ? (
          <>
            <FlipperIcon width={170} light={s.flipper.awaiting ? "var(--scan)" : "var(--zcash)"} pulsing />
            <div class="title2" style={{ textAlign: "center", fontSize: 19 }}>
              {s.flipper.awaiting ? t("Confirm on your device") : t("Your device is checking…")}
            </div>
            <div class="sub muted" style={{ textAlign: "center", lineHeight: 1.4 }}>
              {t("Check each payment and the fee on your device's screen, then approve it there. Refuse it there to cancel.")}
            </div>
          </>
        ) : (
          <>
            <ForgingShield size={84} />
            <div class="title2" style={{ textAlign: "center", fontSize: 19 }}>
              {step.step === "preparing" ? t("Preparing the transaction") : t("Broadcasting")}
            </div>
            <div class="sub muted" style={{ textAlign: "center", lineHeight: 1.4 }}>
              {step.step === "broadcasting"
                ? w?.kind === "flipper"
                  ? t("Signed by your device. Sending it to the Zcash network.")
                  : t("Signed with this browser's keys. Sending it to the Zcash network.")
                : t("Building a shielded transaction and its zero-knowledge proof.")}
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}

function explainSend(m: string): string {
  if (m.startsWith("INSUFFICIENT:")) {
    const z = Number(m.slice(13));
    return t("Not enough spendable ZEC. Sending %@ also costs a network fee of at least %@, and received funds become spendable after 10 confirmations.", zec(z), zec(MINIMUM_FEE));
  }
  if (m.startsWith("NETWORK:")) return t("Couldn't reach the network (%@). The wallet will retry on its own.", m.slice(8));
  if (m === "LOCKED") return t("ZApp is locked. Unlock it and send again.");
  if (m === "FLIPPER_NOT_CONNECTED" || m === "NO_FLIPPER_HOST") return t("Your Flipper isn't connected. Connect it from the side panel and send again.");
  if (m === "REJECTED") return t("Rejected on the Flipper");
  if (m === "SAPLING_PARAMS_NEEDED") return t("Could not prepare the transaction: %@", "Sapling parameters");
  return m;
}
