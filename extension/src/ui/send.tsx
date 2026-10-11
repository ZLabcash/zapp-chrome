// Send (ZApp's SendView): one or more recipients (a multisend is one transaction and one
// signature). Each recipient is the same card: address (typed, scanned or from the address
// book), amount, and its own optional message, or one message for everyone.

import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, nav, useStore, link, isPopup, openApp } from "./store";
import { Icon } from "./icons";
import { ForgingShield, Shield } from "./marks";
import { Note, Screen, Toggle, Sheet } from "./kit";
import { zec, parseZec } from "../model/format";
import { MAX_RECIPIENTS, MINIMUM_FEE, type Payment } from "../model/types";
import { useNames, explorerUrl, PendingPanel } from "./activity";
import { ContactsView } from "./contacts";
import { connectFlipper, flipperReady } from "./flipper";
import { Kind } from "../flipper/link";
import { flipperMessage } from "./pair";

type Line = { id: number; address: string; amount: string; memo: string };
let nextLine = 1;
const newLine = (): Line => ({ id: nextLine++, address: "", amount: "", memo: "" });

/** Address validity, cached (checked by the engine). */
const kinds = new Map<string, string>();
function useAddressKinds(addresses: string[]) {
  const [, set] = useState(0);
  useEffect(() => {
    for (const a of addresses) {
      const k = a.trim();
      if (!k || kinds.has(k)) continue;
      call<string>("addressKind", k).then((kind) => {
        kinds.set(k, kind);
        set((n) => n + 1);
      });
    }
  }, [addresses.join("|")]);
  return (a: string) => kinds.get(a.trim());
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

export function SendView() {
  const s = useStore();
  const name = useNames();
  const w = s.wallets.find((x) => x.id === s.activeId)!;
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [sameMemo, setSameMemo] = useState(false);
  const [sharedMemo, setSharedMemo] = useState("");
  const [fee, setFee] = useState<number | null>(null);
  const kindOf = useAddressKinds(lines.map((l) => l.address));
  const multi = lines.length > 1;
  const valid = (a: string) => !!kindOf(a);

  const payments: Payment[] | null = (() => {
    const all: Payment[] = [];
    for (const l of lines) {
      const z = parseZec(l.amount);
      if (!z || !valid(l.address)) return null;
      all.push({ address: l.address.trim(), zatoshi: z, memo: multi && sameMemo ? sharedMemo : l.memo });
    }
    return all;
  })();
  const total = lines.every((l) => parseZec(l.amount)) ? lines.reduce((a, l) => a + parseZec(l.amount)!, 0) : null;
  const feeOrMin = fee ?? MINIMUM_FEE;
  const spendable = s.balance;
  const pendingHere = s.pendingBroadcasts.filter((p) => p.walletId === s.activeId);

  const note: { text: string; blocking: boolean } | null = (() => {
    if (lines.some((l) => l.amount && !parseZec(l.amount))) return { text: t("Enter an amount above zero, like 0.01."), blocking: true };
    if (total === null) return null;
    if (spendable <= feeOrMin) return { text: t("Your spendable balance (%@) doesn't cover the network fee of %@.", zec(spendable), zec(feeOrMin)), blocking: true };
    if (total > spendable) return { text: t("That's more than your spendable balance of %@.", zec(spendable)), blocking: true };
    if (total + feeOrMin > spendable)
      return { text: t("That leaves nothing for the network fee (%@). You can send up to %@%@.", zec(feeOrMin), zec(spendable - feeOrMin), multi ? t(" in total") : t(": tap Max")), blocking: true };
    if (total < feeOrMin) return { text: t("Very small amount: the network fee (%@) is more than what you send.", zec(feeOrMin)), blocking: false };
    return null;
  })();
  const canGo = payments !== null && !note?.blocking && pendingHere.length === 0;

  // The fee, estimated once the amounts and addresses are valid.
  const feeKey = lines.map((l) => l.address + "=" + l.amount).join(",");
  useEffect(() => {
    setFee(null);
    if (!payments) return;
    const id = setTimeout(() => call<number | null>("proposalFee", payments).then(setFee), 400);
    return () => clearTimeout(id);
  }, [feeKey, payments !== null]);

  const update = (id: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...change } : l)));

  const review = () => {
    if (!payments) return;
    if (w.kind === "phone") nav.sheet(() => <SignSheet payments={payments} />);
    else signWithFlipper(payments);
  };

  if (s.send.step !== "idle") return <SendProgress />;

  return (
    <Screen title={t("Send ZEC")} onBack={() => call("setSend", { step: "idle" })}>
      <div class="pad stack gap-14">
        {lines.map((l, i) => {
          const bad = l.address.trim() !== "" && kindOf(l.address) === "";
          const n = name(l.address);
          return (
            <div class="card stack gap-10" key={l.id} style={{ padding: 16 }}>
              <div class="row gap-6">
                <span class="sub b">{multi ? t("Recipient %lld", i + 1) : t("To")}</span>
                {n && <span class="sub b yellow ellipsis">· {n}</span>}
                <span class="spacer" />
                {multi && (
                  <button class="muted" aria-label={t("Remove recipient %lld", i + 1)} onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>
                    <Icon name="x-circle" size={22} />
                  </button>
                )}
              </div>
              <div class="field">
                <input placeholder={t("u1… shielded address")} autocomplete="off" spellcheck={false} value={l.address} onInput={(e) => {
                  const r = parseRequest((e.target as HTMLInputElement).value);
                  update(l.id, { address: r.address, ...(r.amount ? { amount: r.amount } : {}), ...(r.memo ? { memo: r.memo } : {}) });
                }} />
                <button class="yellow" aria-label={t("Scan a QR code")} onClick={() => (isPopup ? openApp("#send") : nav.sheet(() => <ScanSheet onText={(x) => {
                  const r = parseRequest(x);
                  update(l.id, { address: r.address, ...(r.amount ? { amount: r.amount } : {}), ...(r.memo ? { memo: r.memo } : {}) });
                }} />))}>
                  <Icon name="scan" size={20} />
                </button>
                <button class="yellow" aria-label={t("Address book")} onClick={() => nav.sheet(() => <Sheet full><ContactsView pick={(c) => { update(l.id, { address: c.address }); nav.closeSheet(); }} /></Sheet>)}>
                  <Icon name="person-circle" size={20} />
                </button>
              </div>
              {bad ? (
                <div class="foot orange">{t("Not a valid Zcash address for this network.")}</div>
              ) : valid(l.address) && !n ? (
                <button class="row gap-6 foot yellow" style={{ fontWeight: 600, alignSelf: "flex-start" }} onClick={() => nav.sheet(() => <SaveContactDialog address={l.address.trim()} />)}>
                  <Icon name="person-plus" size={15} />
                  {t("Save to address book")}
                </button>
              ) : null}
              <div class="field">
                <input inputMode="decimal" placeholder={t("Amount")} value={l.amount} onInput={(e) => update(l.id, { amount: (e.target as HTMLInputElement).value })} />
                <span class="sub b muted">ZEC</span>
                {!multi && spendable > feeOrMin && (
                  <button class="sub b yellow" onClick={() => update(l.id, { amount: ((spendable - feeOrMin) / 1e8).toFixed(8).replace(/\.?0+$/, "") })}>
                    {t("Max")}
                  </button>
                )}
              </div>
              {!(multi && sameMemo) && (
                <div class="field">
                  <textarea rows={1} placeholder={t("Message (optional)")} value={l.memo} onInput={(e) => update(l.id, { memo: (e.target as HTMLTextAreaElement).value })} />
                </div>
              )}
            </div>
          );
        })}
        {lines.length < MAX_RECIPIENTS && (
          <button class="row gap-6 sub b yellow" style={{ justifyContent: "center", padding: "13px 0", borderRadius: 14, border: "1.5px dashed rgba(244,183,40,0.5)" }} onClick={() => setLines([...lines, newLine()])}>
            <Icon name="plus" size={16} stroke={2.6} />
            {t("Add a recipient")}
          </button>
        )}
        {multi && (
          <div class="card stack gap-10" style={{ padding: 16 }}>
            <div class="row">
              <span class="sub b spacer">{t("Same message for everyone")}</span>
              <Toggle on={sameMemo} onChange={setSameMemo} />
            </div>
            {sameMemo && (
              <div class="field">
                <textarea rows={1} placeholder={t("Message for all recipients (optional)")} value={sharedMemo} onInput={(e) => setSharedMemo((e.target as HTMLTextAreaElement).value)} />
              </div>
            )}
          </div>
        )}
        <div class="card stack gap-8 foot" style={{ padding: 16 }}>
          <div class="row">
            <span class="muted">{t("Spendable")}</span>
            <span class="spacer" />
            <span class="num">{zec(spendable)}</span>
          </div>
          {multi && total !== null && (
            <div class="row">
              <span class="muted">{t("Total to %lld recipients", lines.length)}</span>
              <span class="spacer" />
              <span class="num" style={{ fontWeight: 600 }}>{zec(total)}</span>
            </div>
          )}
          {fee !== null && (
            <div class="row">
              <span class="muted">{t("Network fee")}</span>
              <span class="spacer" />
              <span class="num">{zec(fee)}</span>
            </div>
          )}
          {s.pending > 0 && <div class="muted">{t("%@ still confirming: spendable after 10 confirmations.", zec(s.pending))}</div>}
          {note && <Note text={note.text} kind={note.blocking ? "warn" : "info"} />}
          {pendingHere.length > 0 && <Note text={t("A signed payment is waiting in To broadcast, on Home. Broadcast or cancel it first: a new one could spend the same funds.")} />}
          {!s.online && <Note kind="info" text={t("No network: you can still sign with your device and broadcast later.")} />}
        </div>
        <button class="primary" disabled={!canGo} onClick={review} style={{ marginTop: 4 }}>
          <Icon name="shield" size={18} />
          {multi ? t("Review & sign %lld payments", lines.length) : t("Review & sign")}
        </button>
        <div class="foot muted" style={{ lineHeight: 1.4 }}>
          {w.kind === "phone"
            ? multi
              ? t("One transaction for all of them. Your password unlocks this browser's keys to sign it.")
              : t("Your password unlocks this browser's keys to sign it.")
            : multi
              ? t("One transaction, one signature. Your signing device shows each payment in turn, then the total and the fee: approve once to sign them all.")
              : t("Your signing device shows the amount, the recipient and the fee. Check them on its screen, then approve to sign.")}
        </div>
      </div>
    </Screen>
  );
}

/** A Flipper wallet's payment: connect, build and prove here, check and sign there. */
async function signWithFlipper(payments: Payment[]) {
  const st = (await import("./store")).getState();
  if (!flipperReady(st.activeId) && !(await connectFlipper())) return;
  let id: string | null = null;
  try {
    const job = await call<{ id: string; request: Uint8Array }>("prepareFlipperSend", payments);
    id = job.id;
    const reply = await link.request(Kind.sign, job.request, 600_000);
    if (reply.kind !== Kind.signed) throw new Error("Unexpected reply from the Flipper");
    await call("finishFlipperSend", job.id, reply.payload);
  } catch (e) {
    if (id) call("cancelFlipperSend", id, flipperMessage(e));
  }
}

/** A browser wallet: the password unlocks its keys for this one signature (Face ID in ZApp). */
function SignSheet({ payments }: { payments: Payment[] }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const go = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const ok = await call<boolean>("checkPassword", password);
    if (!ok) {
      setBusy(false);
      return setError(t("Wrong password."));
    }
    nav.closeSheet();
    call("sendFromBrowser", payments, password).catch(() => {});
  };
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet">
        <div class="grabber" />
        <div class="stack gap-14" style={{ padding: "12px 18px 22px" }}>
          <div class="row gap-10">
            <Icon name="lock" size={20} class="yellow" />
            <span class="headline">{t("Sign this payment")}</span>
          </div>
          <div class="field">
            <input ref={ref} type="password" placeholder={t("Password")} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && go()} />
          </div>
          {error && <Note text={error} />}
          <button class="primary" disabled={!password || busy} onClick={go}>
            {t("Sign")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveContactDialog({ address }: { address: string }) {
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const save = () => {
    if (name.trim()) call("saveContact", { id: "", name, address });
    nav.closeSheet();
  };
  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="dialog stack gap-14">
        <div class="headline" style={{ textAlign: "center" }}>
          {t("Save to address book")}
        </div>
        <div class="field">
          <input ref={ref} placeholder={t("Name")} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        </div>
        <button class="primary" disabled={!name.trim()} onClick={save}>
          {t("Save")}
        </button>
        <button class="sub b muted" onClick={() => nav.closeSheet()}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

/** Reads a Zcash QR code with the camera. */
function ScanSheet({ onText }: { onText: (text: string) => void }) {
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
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.current!.srcObject = stream;
        await video.current!.play();
        const look = async () => {
          if (done) return;
          const codes = await detector.detect(video.current!).catch(() => []);
          if (codes[0]?.rawValue) {
            done = true;
            onText(codes[0].rawValue);
            nav.closeSheet();
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
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet">
        <div class="grabber" />
        <div class="stack gap-14" style={{ padding: "12px 18px 22px" }}>
          <div class="row">
            <span class="headline spacer">{t("Scan a Zcash QR code")}</span>
            <button class="sub b yellow" onClick={() => nav.closeSheet()}>
              {t("Cancel")}
            </button>
          </div>
          {error ? <div class="sub muted" style={{ textAlign: "center", padding: 20 }}>{error}</div> : <video ref={video} muted playsInline style={{ width: "100%", borderRadius: 16, background: "#000", aspectRatio: "1" }} />}
        </div>
      </div>
    </div>
  );
}

/** Preparing, confirming on the device, broadcasting, then Sent, signed for later, or not sent. */
function SendProgress() {
  const s = useStore();
  useLinkAwaiting();
  const step = s.send;
  const done = () => {
    call("setSend", { step: "idle" });
    nav.pop();
  };
  return (
    <Screen title={t("Send ZEC")} onBack={() => call("setSend", { step: "idle" })} scroll={false}>
      <div class="stack center gap-22" style={{ flex: 1, padding: 24, overflowY: "auto" }}>
        <div class="spacer" />
        {step.step === "sent" ? (
          <>
            <Shield size={110} />
            <div style={{ fontSize: 32, fontWeight: 700 }}>{t("Sent")}</div>
            <div class="mono cap muted break" style={{ textAlign: "center", userSelect: "all" }}>
              {step.txid}
            </div>
            <a class="row gap-6 sub b yellow" href={explorerUrl(s, step.txid)} target="_blank">
              <Icon name="external" size={15} />
              {t("View on the explorer")}
            </a>
            <button class="primary" onClick={done}>
              {t("Done")}
            </button>
          </>
        ) : step.step === "signedOffline" ? (
          <div style={{ width: "100%" }}>
            <PendingPanel id={step.pendingId} onClose={() => (s.send.step === "signedOffline" ? done() : undefined)} showsLater />
          </div>
        ) : step.step === "failed" ? (
          <>
            <div class="red">
              <Icon name="shield" size={70} stroke={1.6} />
            </div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{t("Not sent")}</div>
            <div class="sub muted" style={{ textAlign: "center", lineHeight: 1.4 }}>
              {explainSend(step.message)}
            </div>
            <button class="primary" onClick={() => call("setSend", { step: "idle" })}>
              {t("Back")}
            </button>
          </>
        ) : (
          <>
            <ForgingShield size={110} />
            <div class="title2" style={{ textAlign: "center" }}>
              {step.step === "preparing" ? t("Preparing the transaction") : step.step === "confirmOnDevice" ? (link.awaiting ? t("Confirm on your device") : t("Your device is checking…")) : t("Broadcasting")}
            </div>
            <div class="sub muted" style={{ textAlign: "center", lineHeight: 1.4 }}>
              {step.step === "confirmOnDevice"
                ? t("Check each payment and the fee on your device's screen, then approve it there. Refuse it there to cancel.")
                : step.step === "broadcasting"
                  ? s.wallets.find((x) => x.id === s.activeId)?.kind === "flipper"
                    ? t("Signed by your device. Sending it to the Zcash network.")
                    : t("Signed with this browser's keys. Sending it to the Zcash network.")
                  : t("Building a shielded transaction and its zero-knowledge proof.")}
            </div>
          </>
        )}
        <div class="spacer" />
      </div>
    </Screen>
  );
}

function useLinkAwaiting() {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);
}

function explainSend(m: string): string {
  if (m.startsWith("INSUFFICIENT:")) {
    const z = Number(m.slice(13));
    return t("Not enough spendable ZEC. Sending %@ also costs a network fee of at least %@, and received funds become spendable after 10 confirmations.", zec(z), zec(MINIMUM_FEE));
  }
  if (m.startsWith("NETWORK:")) return t("Couldn't reach the network (%@). The wallet will retry on its own.", m.slice(8));
  if (m === "SAPLING_PARAMS_NEEDED") return t("Could not prepare the transaction: %@", "Sapling parameters");
  return m;
}
