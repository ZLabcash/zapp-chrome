// First launch and adding wallets (ZApp's WalletsViews): the welcome animation, the language
// menu, the ways to get a wallet, creating one (words → check → name → password), restoring
// one, connecting a device.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { t, LANGUAGES, effective, flag, languageName } from "../i18n";
import { call, nav, useStore, isPopup, openApp } from "./store";
import { DrawingShield, Flag, FlipperIcon, KindleIcon, Shield } from "./marks";
import { Icon } from "./icons";
import { CopyButton, IconTile, Menu, Note, OptionCard, Screen, Spinner } from "./kit";
import { PairScreen } from "./flipper";
import type { Wallet } from "../model/types";

/** Played once per page: a language change re-renders without replaying it. */
let played = false;

/** First launch: the logo draws itself, the wordmark comes in, then the line, Start and the language menu. */
export function WelcomeView() {
  const [wordmark, setWordmark] = useState(played);
  const [rest, setRest] = useState(played);
  useEffect(() => {
    if (played) return;
    played = true;
    const a = setTimeout(() => setWordmark(true), 700);
    const b = setTimeout(() => setRest(true), 1150);
    return () => (clearTimeout(a), clearTimeout(b));
  }, []);
  return (
    <div class="stack" style={{ height: "100%", padding: 20 }}>
      <div class={`row appear ${rest ? "" : "hidden"}`} style={{ justifyContent: "flex-end" }}>
        <LanguageMenu />
      </div>
      <div class="spacer" />
      <div class="stack center gap-14">
        {played && wordmark ? <Shield size={112} /> : <DrawingShield size={112} />}
        <div class="rounded appear" style={{ fontSize: 44, fontWeight: 800, opacity: wordmark ? 1 : 0, transform: wordmark ? "none" : "translateY(8px)" }}>
          ZApp
        </div>
      </div>
      <div class={`center appear muted`} style={{ fontSize: 20, fontWeight: 600, marginTop: 10, opacity: rest ? 1 : 0 }}>
        {t("Private by default.")}
      </div>
      <div class="spacer" />
      <button class="btn fill wide appear" style={{ opacity: rest ? 1 : 0, transform: rest ? "none" : "translateY(12px)" }} disabled={!rest} onClick={() => nav.push(() => <GetStartedView />)}>
        {t("Start")}
      </button>
    </div>
  );
}

/** The language picker in the welcome screen's corner: flag, then the list. */
export function LanguageMenu() {
  const s = useStore();
  const current = effective(s.settings.language);
  return (
    <Menu
      button={(open) => (
        <button class="pill" style={{ color: "var(--ink)", fontSize: 14, padding: "8px 12px" }} onClick={open}>
          <Flag name={flag(current)} height={16} />
          {languageName(current)}
          <Icon name="chevron-down" size={12} stroke={3} />
        </button>
      )}
    >
      {(close) =>
        LANGUAGES.map((code) => (
          <button
            key={code}
            onClick={() => {
              call("setSettings", { language: code });
              close();
            }}
          >
            <Flag name={flag(code)} height={14} />
            <span class="spacer">{languageName(code)}</span>
            {code === current && <Icon name="check" size={15} class="yellow" />}
          </button>
        ))
      }
    </Menu>
  );
}

/** After Start: how to get a wallet. */
function GetStartedView() {
  return (
    <Screen title={t("Your wallet")} scroll={false}>
      <div class="stack" style={{ flex: 1, padding: 20 }}>
        <div class="spacer" />
        <WalletOptions showsSoon={false} onDone={() => nav.root()} />
        <div class="spacer" />
      </div>
    </Screen>
  );
}

/** Add a wallet (from the wallet switcher). */
export function AddWalletScreen({ onDone }: { onDone: () => void }) {
  return (
    <Screen title={t("Add a wallet")}>
      <div class="pad">
        <WalletOptions showsSoon onDone={onDone} />
      </div>
    </Screen>
  );
}

function WalletOptions({ onDone, showsSoon }: { onDone: () => void; showsSoon: boolean }) {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The distinct seeds already on this browser (each can grow another account).
  const seeds = useMemo(() => {
    const by = new Map<string, Wallet[]>();
    for (const w of s.wallets) if (w.kind === "phone") (by.get(JSON.stringify(w.seedFingerprint)) ?? by.set(JSON.stringify(w.seedFingerprint), []).get(JSON.stringify(w.seedFingerprint))!).push(w);
    return [...by.values()];
  }, [s.wallets]);

  const derive = async (group: Wallet[]) => {
    const next = Math.max(...group.map((w) => w.account)) + 1;
    setBusy(true);
    setError(null);
    try {
      await call("addAccount", group[0].id, t("Account %lld", next + 1));
      onDone();
    } catch (e) {
      setError(explainError(e));
      setBusy(false);
    }
  };
  const addAccount = () => {
    if (seeds.length === 1) return derive(seeds[0]);
    nav.push(() => <PickSeedView seeds={seeds} onPick={derive} />);
  };

  return (
    <div class="stack gap-12">
      {seeds.length > 0 && (
        <OptionCard title={t("Add an account")} subtitle={t("Another account from a wallet already here — the same recovery phrase.")} icon={<IconTile name="plus" />} busy={busy} onClick={addAccount} />
      )}
      <OptionCard title={t("Create a new wallet")} subtitle={t("A brand-new wallet, with its own 24-word recovery phrase.")} icon={<IconTile name="wallet" />} onClick={() => nav.push(() => <CreateWalletView onDone={onDone} />)} />
      <OptionCard title={t("Import a recovery phrase")} subtitle={t("Bring back a wallet from its 24-word recovery phrase.")} icon={<IconTile name="restore" />} onClick={() => nav.push(() => <RestoreWalletView onDone={onDone} />)} />
      <OptionCard title={t("Connect a device")} subtitle={t("Any compatible hardware signer that keeps its keys.")} icon={<IconTile name="waves" />} onClick={() => nav.push(() => <ConnectDeviceView onDone={onDone} />)} />
      {error && <Note text={error} />}
      {showsSoon && <OptionCard title={t("Multisig")} soon icon={<IconTile name="people" />} />}
    </div>
  );
}

/** When several seeds live here: which wallet's recovery phrase to add an account to. */
function PickSeedView({ seeds, onPick }: { seeds: Wallet[][]; onPick: (group: Wallet[]) => void }) {
  return (
    <Screen title={t("Add an account")}>
      <div class="pad stack gap-12">
        <div class="foot muted">{t("From which wallet's recovery phrase?")}</div>
        {seeds.map((group) => (
          <OptionCard key={group[0].id} title={group[0].name} subtitle={t("%lld account(s)", group.length)} icon={<IconTile name="wallet" />} onClick={() => onPick(group)} />
        ))}
      </div>
    </Screen>
  );
}

/** Connect a device: the cold wallets ZApp can watch and send through. */
function ConnectDeviceView({ onDone }: { onDone: () => void }) {
  return (
    <Screen title={t("Connect a device")}>
      <div class="pad stack gap-12">
        <OptionCard
          title="Flipper Zero"
          icon={<FlipperIcon width={52} />}
          onClick={() => {
            // The popup can't hold a Bluetooth link: pair in the full page (or the side panel).
            if (isPopup) return openApp("#pair");
            nav.push(() => <PairScreen onDone={onDone} />);
          }}
        />
        <OptionCard title="Kindle" soon icon={<KindleIcon width={30} />} />
      </div>
    </Screen>
  );
}

/** Recovery words in numbered cells, three columns so all 24 fit on one screen. */
export function WordGrid({ words }: { words: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, direction: "ltr" }}>
      {words.map((w, i) => (
        <div key={i} class="row gap-4" style={{ background: "var(--card)", borderRadius: 9, padding: "7px 6px", minWidth: 0 }}>
          <span class="cap2 muted num" style={{ width: 18, textAlign: "right", flexShrink: 0 }}>
            {i + 1}
          </span>
          <span class="mono ellipsis" style={{ fontSize: 13, fontWeight: 600, marginLeft: 4 }}>
            {w}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A new browser wallet, step 1: its 24 words, all on screen, to write down. */
function CreateWalletView({ onDone }: { onDone: () => void }) {
  const [phrase, setPhrase] = useState("");
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    call<string>("newPhrase").then(setPhrase);
  }, []);
  const words = phrase ? phrase.split(" ") : Array(24).fill("·····");
  return (
    <Screen title={t("Your recovery phrase")} scroll={false}>
      <div class="stack gap-14" style={{ flex: 1, padding: "8px 18px 18px", minHeight: 0 }}>
        <div class="foot muted" style={{ lineHeight: 1.4 }}>
          {t("These 24 words are your money. Write them on paper, in order, and keep them offline. Anyone who sees them can spend your funds; without them, a lost computer means lost funds.")}
        </div>
        <div style={{ position: "relative" }}>
          <div style={{ filter: revealed ? "none" : "blur(8px)", transition: "filter 0.3s" }}>
            <WordGrid words={words} />
          </div>
          {!revealed && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: "0 40px" }}>
              <button class="btn fill wide" onClick={() => setRevealed(true)} disabled={!phrase}>
                <Icon name="eye" size={18} />
                {t("Tap to show the words")}
              </button>
            </div>
          )}
        </div>
        {revealed && (
          <div class="row" style={{ justifyContent: "center" }}>
            <CopyButton text={phrase} clearAfter={120_000} />
          </div>
        )}
        <div class="spacer" />
        <button
          class="btn fill wide"
          disabled={!revealed}
          onClick={() => {
            const all = [...Array(24).keys()].sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b);
            nav.push(() => <CheckWordsView words={words} asked={all} phrase={phrase} onDone={onDone} />);
          }}
        >
          {t("I wrote them down")}
        </button>
      </div>
    </Screen>
  );
}

/** Step 2: type three of the words back. The back arrow returns to the words. */
function CheckWordsView({ words, asked, phrase, onDone }: { words: string[]; asked: number[]; phrase: string; onDone: () => void }) {
  const [answers, setAnswers] = useState(["", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  useEffect(() => refs[0].current?.focus(), []);
  const go = () => {
    const ok = asked.every((i, k) => answers[k].trim().toLowerCase() === words[i]);
    if (!ok) return setError(t("A word doesn't match. Check your paper, or go back to the words."));
    setError(null);
    nav.push(() => <NameWalletView phrase={phrase} onDone={onDone} />);
  };
  return (
    <Screen title={t("Check your words")} scroll={false}>
      <div class="stack gap-14" style={{ flex: 1, padding: "8px 18px 18px" }}>
        <div class="foot muted">{t("Type these words from your paper.")}</div>
        {asked.map((i, k) => (
          <div class="input" key={i}>
            <input
              ref={refs[k]}
              placeholder={t("Word #%lld", i + 1)}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              value={answers[k]}
              onInput={(e) => setAnswers(answers.map((a, j) => (j === k ? (e.target as HTMLInputElement).value : a)))}
              onKeyDown={(e) => e.key === "Enter" && (k < 2 ? refs[k + 1].current?.focus() : go())}
            />
          </div>
        ))}
        {error && <Note text={error} />}
        <div class="spacer" />
        <button class="btn fill wide" onClick={go}>
          {t("Continue")}
        </button>
      </div>
    </Screen>
  );
}

/** Step 3: name the new wallet; then the password that seals it (chosen once, for every browser wallet). */
function NameWalletView({ phrase, onDone }: { phrase: string; onDone: () => void }) {
  const [name, setName] = useState(t("My wallet"));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!name.trim()) return;
    // The first browser wallet sets the password; after that the unlocked session seals it.
    if (!s.vault.exists) return nav.push(() => <PasswordStep onSubmit={(password) => call("addPhoneWallet", name.trim(), phrase, null, password)} action={t("Create the wallet")} working={t("Creating…")} onDone={onDone} />);
    setBusy(true);
    try {
      await call("addPhoneWallet", name.trim(), phrase, null, null);
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t("Name your wallet")} scroll={false}>
      <div class="stack gap-14" style={{ flex: 1, padding: "8px 18px 18px" }}>
        <div class="foot muted">{t("Give it a name to find it among your wallets.")}</div>
        <div class="input">
          <input ref={ref} placeholder={t("Wallet name")} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        </div>
        {error && <Note text={error} />}
        <div class="spacer" />
        <button class="btn fill wide" disabled={!name.trim() || busy} onClick={go}>
          {busy && <Spinner size={16} />}
          {busy ? t("Creating…") : s.vault.exists ? t("Create the wallet") : t("Continue")}
        </button>
      </div>
    </Screen>
  );
}

/** Messages for the wallet model's error codes. */
export function explainError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === "WRONG_PASSWORD") return t("Wrong password.");
  if (m === "BAD_PHRASE") return t("These words aren't a valid recovery phrase. Check each word and their order.");
  if (m === "ALREADY_HERE") return t("This wallet is already in this browser.");
  return m;
}

/**
 * The password: chosen the first time (it then seals every browser wallet), typed again after.
 * In ZApp, Face ID guards the Keychain; here the password does.
 */
function PasswordStep({ onSubmit, action, working, onDone }: { onSubmit: (password: string) => Promise<unknown>; action: string; working: string; onDone: () => void }) {
  const s = useStore();
  const fresh = !s.vault.exists;
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const ok = fresh ? p1.length >= 8 && p1 === p2 : p1.length > 0;
  const go = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(p1);
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={fresh ? t("Choose a password") : t("Your password")} scroll={false}>
      <div class="stack gap-14" style={{ flex: 1, padding: "8px 18px 18px" }}>
        <div class="foot muted" style={{ lineHeight: 1.4 }}>
          {fresh
            ? t("It seals this browser's wallets: you type it to sign a payment or to see the words. Nobody can reset it. Forgot it? Restore the wallet from your 24 words.")
            : t("The password of this browser's wallets.")}
        </div>
        <div class="input">
          <Icon name="lock" size={16} class="muted" />
          <input ref={ref} type="password" placeholder={t("Password")} value={p1} onInput={(e) => setP1((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        </div>
        {fresh && (
          <div class="input">
            <Icon name="lock" size={16} class="muted" />
            <input type="password" placeholder={t("Same password again")} value={p2} onInput={(e) => setP2((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && go()} />
          </div>
        )}
        {fresh && p1.length > 0 && p1.length < 8 && <div class="foot muted">{t("At least 8 characters.")}</div>}
        {fresh && p2.length > 0 && p1 !== p2 && <div class="foot orange">{t("The two passwords differ.")}</div>}
        {error && <Note text={error} />}
        <div class="spacer" />
        <button class="btn fill wide" disabled={!ok || busy} onClick={go}>
          {busy && <Spinner size={16} />}
          {busy ? working : action}
        </button>
      </div>
    </Screen>
  );
}

const VALID_COUNTS = [12, 15, 18, 21, 24];

/** Restore a wallet from its words (ZApp, Zashi, Zodl or any ZIP 32 wallet), from about its date. */
function RestoreWalletView({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(t("Restored wallet"));
  const [phrase, setPhrase] = useState("");
  const year = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const [since, setSince] = useState(year);
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  const valid = VALID_COUNTS.includes(words.length);
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (password: string | null) => call("addPhoneWallet", name.trim() || t("Restored wallet"), words.join(" "), new Date(since).getTime() / 1000, password);
  const go = async () => {
    if (!valid) return;
    if (!s.vault.exists) return nav.push(() => <PasswordStep onSubmit={submit} action={t("Restore")} working={t("Restoring…")} onDone={onDone} />);
    setBusy(true);
    try {
      await submit(null);
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t("Import a recovery phrase")}>
      <div class="pad stack gap-16">
        <div class="input">
          <input placeholder={t("Wallet name")} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </div>
        <div class="stack gap-6">
          <div class="row">
            <span class="sub b">{t("Recovery phrase")}</span>
            <span class="spacer" />
            <span class="cap muted num">{t("%lld words", words.length)}</span>
          </div>
          <div class="input" style={{ alignItems: "flex-start" }}>
            <textarea
              rows={5}
              class="mono"
              placeholder="word1 word2 word3 …"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              value={phrase}
              onInput={(e) => setPhrase((e.target as HTMLTextAreaElement).value)}
            />
          </div>
        </div>
        <div class="input">
          <span class="sub" style={{ flex: 1 }}>{t("Created around")}</span>
          <input type="date" value={since} max={new Date().toISOString().slice(0, 10)} min="2022-06-01" onInput={(e) => setSince((e.target as HTMLInputElement).value)} style={{ width: "auto", colorScheme: "inherit" }} />
        </div>
        <div class="cap muted">{t("The wallet is scanned from that date. Earlier is safer but takes longer.")}</div>
        {error && <Note text={error} />}
        <button class="btn fill wide" disabled={!valid || busy} onClick={go}>
          {busy && <Spinner size={16} />}
          {busy ? t("Restoring…") : t("Restore")}
        </button>
      </div>
    </Screen>
  );
}
