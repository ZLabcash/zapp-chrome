// Settings (ZApp's SettingsView): the device to sign with, appearance, language, the wallet
// (name, recovery phrase, activity, address book, currency, sync, broadcast, server), the version.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t, LANGUAGES, effective, flag, languageName, currencyName, formatFiat, formatNumber, language } from "../i18n";
import { call, nav, useStore } from "./store";
import { Icon } from "./icons";
import { Flag, Ring } from "./marks";
import { Note, Popover, Screen, Toggle, usePopover } from "./kit";
import { DevicesCard } from "./home";
import { AllActivityView } from "./activity";
import { ContactsView } from "./contacts";
import { RenameWalletSheet, confirmRemove } from "./wallets";
import { WordGrid } from "./onboarding";
import { CopyButton } from "./kit";
import { CURRENCIES, CURRENCY_FLAGS } from "../model/prices";
import { EXPLORERS, SERVERS } from "../model/types";

export const VERSION = chrome.runtime.getManifest().version;

function Header({ title }: { title: string }) {
  return (
    <span class="cap muted upper" style={{ fontWeight: 600, paddingInlineStart: 4 }}>
      {title}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="stack gap-8">
      <Header title={title} />
      <div class="card big stack gap-12" style={{ padding: 18 }}>
        {children}
      </div>
    </div>
  );
}

/** An icon tile, a title, and on the right a value or a badge and a chevron. */
function SettingsRow({ icon, title, value, badge, flagName, chevron = true, onClick }: { icon: string; title: string; value?: string | null; badge?: string; flagName?: string; chevron?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--zcash)", color: "#000", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={icon} size={16} stroke={2.4} />
      </span>
      <span class="sub b">{title}</span>
      <span class="spacer" />
      {flagName && <Flag name={flagName} height={16} />}
      {value && <span class="sub muted num ellipsis" style={{ maxWidth: 150 }}>{value}</span>}
      {badge && <span class="cap" style={{ fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: "rgba(244,183,40,0.18)", color: "var(--zcash)" }}>{badge}</span>}
      {chevron && <Icon name="chevron-right" size={13} stroke={3} class="muted" />}
    </>
  );
  return onClick ? (
    <button class="row gap-12" style={{ width: "100%", textAlign: "start" }} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div class="row gap-12">{inner}</div>
  );
}

export function SettingsView() {
  const s = useStore();
  const w = s.wallets.find((x) => x.id === s.activeId);
  const info = usePopover();
  const appearance = s.settings.appearance;
  const chip = (title: string, icon: string, tag: number) => (
    <button
      class="stack center gap-6"
      style={{ flex: 1, padding: "12px 0", borderRadius: 14, background: appearance === tag ? "var(--zcash)" : "var(--soft)", color: appearance === tag ? "#000" : "var(--text)" }}
      onClick={() => call("setSettings", { appearance: tag })}
    >
      <Icon name={icon} size={20} />
      <span class="cap" style={{ fontWeight: 600 }}>{title}</span>
    </button>
  );
  const sy = s.sync;
  return (
    <Screen title={t("Settings")}>
      <div class="stack gap-22" style={{ padding: "8px 18px 30px" }}>
        {w?.kind === "flipper" && (
          <div class="stack gap-8">
            <Header title={t("Devices")} />
            <DevicesCard />
          </div>
        )}
        <Section title={t("Appearance")}>
          <div class="row gap-8">
            {chip(t("System"), "contrast", 0)}
            {chip(t("Light"), "sun", 1)}
            {chip(t("Dark"), "moon", 2)}
          </div>
        </Section>
        <Section title={t("Language")}>
          <SettingsRow icon="globe" title={t("Language")} value={languageName(effective(s.settings.language))} flagName={flag(effective(s.settings.language))} onClick={() => nav.push(() => <LanguageView />)} />
        </Section>
        <Section title={t("Wallet")}>
          {w && <SettingsRow icon="pencil" title={t("Name")} value={w.name} onClick={() => nav.sheet(() => <RenameWalletSheet w={w} />)} />}
          <hr class="divider" />
          {w?.kind === "phone" && (
            <>
              <SettingsRow icon="key" title={t("Recovery phrase")} onClick={() => nav.push(() => <RecoveryPhraseView />)} />
              <hr class="divider" />
            </>
          )}
          <SettingsRow icon="list" title={t("All activity")} value={s.activity.length ? String(s.activity.length) : null} onClick={() => nav.push(() => <AllActivityView />)} />
          <hr class="divider" />
          <SettingsRow icon="people" title={t("Address book")} value={s.contacts.length ? String(s.contacts.length) : null} onClick={() => nav.push(() => <ContactsView />)} />
          <hr class="divider" />
          <SettingsRow icon="dollar" title={t("Currency")} badge={s.settings.currency.toUpperCase()} onClick={() => nav.push(() => <CurrencyView />)} />
          <hr class="divider" />
          <SettingsRow icon="sync" title={t("Synced")} value={sy.error ? t("Offline") : sy.synced ? t("Up to date") : `${Math.floor(sy.progress * 100)}%`} onClick={() => nav.push(() => <SyncDetailView />)} />
          <hr class="divider" />
          <div class="row gap-12">
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--zcash)", color: "#000", display: "grid", placeItems: "center" }}>
              <Icon name="antenna" size={16} stroke={2.4} />
            </span>
            <span class="sub b">{t("Automatic broadcast")}</span>
            <button ref={info.anchor as any} class="muted" aria-label={t("About automatic broadcast")} onClick={() => info.setOpen(true)}>
              <Icon name="info" size={17} />
            </button>
            <span class="spacer" />
            <Toggle on={s.settings.autoBroadcast} onChange={(v) => call("setSettings", { autoBroadcast: v })} />
          </div>
          <Popover open={info.open} onClose={() => info.setOpen(false)} anchor={info.anchor} width={310} align="start">
            <div class="stack gap-10 sub" style={{ lineHeight: 1.4 }}>
              <span class="headline">{t("Automatic broadcast")}</span>
              <span>{t("Your hardware wallet signs payments without ever going online. Broadcasting is the next step: this app sends the signed transaction to the Zcash network.")}</span>
              <span>{t("On: it leaves as soon as your device has signed it.")}</span>
              <span>{t("Off: every signed payment waits in Activity. You broadcast it or discard it when you decide. Without network, it always waits.")}</span>
              <span class="muted">{t("A signed payment expires after about 40 blocks (around 50 minutes). Until it is broadcast, nothing has left your wallet.")}</span>
            </div>
          </Popover>
          <hr class="divider" />
          <SettingsRow icon="server" title={t("Server")} value={s.settings.server.split(":")[0]} onClick={() => nav.push(() => <ServerView />)} />
        </Section>
        <Section title={t("About")}>
          <SettingsRow icon="info" title={t("Version")} value={VERSION} onClick={() => nav.push(() => <ReleaseNotesView />)} />
        </Section>
        {w && (
          <button class="danger" style={{ fontSize: 14, padding: "14px 0" }} onClick={() => confirmRemove(w, () => nav.root())}>
            {t("Forget this wallet")}
          </button>
        )}
      </div>
    </Screen>
  );
}

/** The active browser wallet's words, after the password. */
function RecoveryPhraseView() {
  const [password, setPassword] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    return () => setWords([]);
  }, []);
  const show = async () => {
    try {
      const phrase = await call<string>("recoveryPhrase", password);
      setWords(phrase.split(" "));
      setPassword("");
      setError(null);
    } catch {
      setError(t("Wrong password."));
    }
  };
  return (
    <Screen title={t("Recovery phrase")} onBack={() => setWords([])}>
      <div class="pad stack gap-16">
        <div class="foot orange">{t("Never share these words. Anyone who has them can spend this wallet's funds.")}</div>
        {words.length === 0 ? (
          <>
            <div class="field">
              <Icon name="lock" size={16} class="muted" />
              <input ref={ref} type="password" placeholder={t("Password")} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && show()} />
            </div>
            {error && <Note text={error} />}
            <button class="primary" disabled={!password} onClick={show}>
              <Icon name="eye" size={18} />
              {t("Show the words")}
            </button>
          </>
        ) : (
          <>
            <WordGrid words={words} />
            <div class="row" style={{ justifyContent: "center" }}>
              <CopyButton text={words.join(" ")} clearAfter={120_000} />
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}

/** Where the sync stands, in blocks. */
function SyncDetailView() {
  const s = useStore();
  const w = s.wallets.find((x) => x.id === s.activeId);
  const sy = s.sync;
  return (
    <Screen title={t("Synced")}>
      <div class="pad stack gap-18">
        <div class="card big row gap-14">
          <div style={{ position: "relative", width: 54, height: 54, flexShrink: 0 }}>
            <Ring progress={sy.synced ? 1 : sy.progress} size={54} width={5} />
            <span class="rounded" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700 }}>
              {sy.synced ? "✓" : `${Math.floor(sy.progress * 100)}%`}
            </span>
          </div>
          <div class="stack gap-2">
            <span class="headline">{sy.error ? t("Can't reach the server") : sy.synced ? t("Up to date") : t("Syncing")}</span>
            <span class={`foot ${sy.error ? "orange" : "muted"}`}>{sy.error ?? t("Your browser reads the chain to find this wallet's payments. Nothing about you is sent.")}</span>
          </div>
        </div>
        <div class="card big stack gap-12">
          <SettingsRow icon="cube" title={t("Latest block")} value={sy.tip ? formatNumber(sy.tip) : "…"} chevron={false} />
          <hr class="divider" />
          <SettingsRow icon="seal" title={t("Scanned up to")} value={sy.scanned ? formatNumber(sy.scanned) : "…"} chevron={false} />
          <hr class="divider" />
          <SettingsRow icon="flag" title={t("Scanning from block")} value={formatNumber(w?.birthday ?? 0)} chevron={false} />
          <hr class="divider" />
          <SettingsRow icon="server" title={t("Server")} value={s.settings.server} chevron={false} />
        </div>
        <div class="cap muted" style={{ padding: "0 4px" }}>
          {t("The wallet starts at the block where it was created: older blocks can't hold its funds.")}
        </div>
      </div>
    </Screen>
  );
}

/** The lightwalletd server to sync from, and the explorer transactions open on. */
function ServerView() {
  const s = useStore();
  const [customServer, setCustomServer] = useState(SERVERS.includes(s.settings.server) ? "" : s.settings.server);
  const [customExplorer, setCustomExplorer] = useState(EXPLORERS.some((e) => e.template === s.settings.explorer) ? "" : s.settings.explorer);
  const choose = async (server: string) => {
    const clean = server.trim();
    if (!clean) return;
    const full = clean.includes(":") ? clean : clean + ":443";
    if (!SERVERS.includes(full)) {
      // A server of your own: Chrome asks to allow the extension to reach it.
      const ok = await chrome.permissions.request({ origins: [`https://${full.split(":")[0]}/*`] }).catch(() => false);
      if (!ok) return;
    }
    call("setSettings", { server: full });
  };
  const option = (title: string, selected: boolean, onClick: () => void, detail?: string) => (
    <button class="row" style={{ width: "100%", textAlign: "start" }} onClick={onClick}>
      <div class="stack gap-2 spacer">
        <span class="sub b">{title}</span>
        {detail && <span class="cap muted">{detail}</span>}
      </div>
      <span class={selected ? "yellow" : "muted"}>
        <Icon name={selected ? "check-circle" : "circle"} size={22} stroke={1.6} />
      </span>
    </button>
  );
  return (
    <Screen title={t("Server")}>
      <div class="pad stack gap-22">
        <div class="stack gap-8">
          <Header title={t("Server")} />
          <div class="card big stack gap-12">
            {SERVERS.map((x, i) => (
              <>
                {i > 0 && <hr class="divider" />}
                {option(x.split(":")[0], s.settings.server === x, () => choose(x))}
              </>
            ))}
            <hr class="divider" />
            <div class="row gap-10">
              <input class="mono sub" placeholder="host:port" value={customServer} onInput={(e) => setCustomServer((e.target as HTMLInputElement).value)} />
              <button class="sub b yellow" disabled={!customServer.trim()} onClick={() => choose(customServer)}>
                {t("Use")}
              </button>
            </div>
          </div>
          <div class="cap muted" style={{ padding: "0 4px" }}>
            {t("Your browser syncs from this lightwalletd server. Changing it restarts the sync where it stopped.")}
          </div>
        </div>
        <div class="stack gap-8">
          <Header title={t("Explorer")} />
          <div class="card big stack gap-12">
            {EXPLORERS.map((e, i) => (
              <>
                {i > 0 && <hr class="divider" />}
                {option(e.name, s.settings.explorer === e.template, () => call("setSettings", { explorer: e.template }), new URL(e.template.replace("{txid}", "")).host)}
              </>
            ))}
            <hr class="divider" />
            <div class="row gap-10">
              <input class="mono sub" placeholder="https://…/tx/{txid}" value={customExplorer} onInput={(e) => setCustomExplorer((e.target as HTMLInputElement).value)} />
              <button class="sub b yellow" disabled={!/^https?:\/\//.test(customExplorer.trim())} onClick={() => call("setSettings", { explorer: customExplorer.trim() })}>
                {t("Use")}
              </button>
            </div>
          </div>
          <div class="cap muted" style={{ padding: "0 4px" }}>
            {t("Transactions open there. {txid} stands for the transaction id.")}
          </div>
        </div>
      </div>
    </Screen>
  );
}

/** What changed, version by version. */
function ReleaseNotesView() {
  const notes: [string, string[]][] = [
    [
      "0.1.0",
      [
        t("ZApp in Chrome: create a wallet, restore one from its words, or connect your Flipper Zero over Bluetooth."),
        t("Several wallets side by side; send between them by name."),
        t("Pay up to 5 people in one transaction, each with a message or one for all."),
        t("Signed payments can wait to be broadcast, with a countdown."),
        t("13 languages, 43 currencies, light and dark."),
      ],
    ],
  ];
  return (
    <Screen title={t("What's new")}>
      <div class="pad stack gap-18">
        {notes.map(([v, items]) => (
          <div class="card big stack gap-12" key={v}>
            <div class="row gap-8">
              <span class="headline">{t("Version %@", v)}</span>
              {v === VERSION && <span class="cap2" style={{ fontWeight: 700, padding: "3px 7px", borderRadius: 99, background: "rgba(27,175,122,0.2)", color: "var(--scan)" }}>{t("Installed")}</span>}
            </div>
            {items.map((x) => (
              <div class="row gap-8 sub" style={{ alignItems: "baseline" }} key={x}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--zcash)", flexShrink: 0, transform: "translateY(-2px)" }} />
                <span style={{ lineHeight: 1.4 }}>{x}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Screen>
  );
}

/** One choice: flag, a title, a subtitle, a check when selected. */
function ChoiceRow({ flagName, title, subtitle, trailing, selected, onClick }: { flagName: string; title: string; subtitle?: string; trailing?: string | null; selected: boolean; onClick: () => void }) {
  return (
    <button class="row gap-14" style={{ width: "100%", textAlign: "start", padding: "4px 0" }} onClick={onClick}>
      <Flag name={flagName} height={24} />
      <div class="stack gap-2 spacer">
        <span class="sub b">{title}</span>
        {subtitle && <span class="cap muted">{subtitle}</span>}
      </div>
      {trailing && <span class="sub muted num">{trailing}</span>}
      <span class={selected ? "yellow" : "muted"} style={{ opacity: selected ? 1 : 0.5 }}>
        <Icon name={selected ? "check-circle" : "circle"} size={22} stroke={1.6} />
      </span>
    </button>
  );
}

/** The browser's language, or one of the 13 ZApp speaks, applied at once. */
function LanguageView() {
  const s = useStore();
  const current = effective(s.settings.language);
  return (
    <Screen title={t("Language")}>
      <div class="pad">
        <div class="card big stack gap-12">
          {LANGUAGES.map((code, i) => (
            <>
              {i > 0 && <hr class="divider" />}
              <ChoiceRow key={code} flagName={flag(code)} title={languageName(code)} subtitle={languageName(code, language())} selected={current === code} onClick={() => call("setSettings", { language: code })} />
            </>
          ))}
        </div>
      </div>
    </Screen>
  );
}

/** What the balance is shown in, with 1 ZEC's price in each. */
function CurrencyView() {
  const s = useStore();
  useEffect(() => void call("refreshPrices"), []);
  return (
    <Screen title={t("Currency")}>
      <div class="pad stack gap-12">
        <div class="card big stack gap-12">
          {CURRENCIES.map((c, i) => (
            <>
              {i > 0 && <hr class="divider" />}
              <ChoiceRow
                key={c}
                flagName={CURRENCY_FLAGS[c] ?? "un"}
                title={c.toUpperCase()}
                subtitle={currencyName(c)}
                trailing={formatFiat(1e8, s.prices[c], c)}
                selected={s.settings.currency === c}
                onClick={() => {
                  call("setSettings", { currency: c });
                  nav.pop();
                }}
              />
            </>
          ))}
        </div>
        <a class="row gap-6 foot" style={{ justifyContent: "center", padding: "8px 0" }} href="https://www.coingecko.com/en/api" target="_blank">
          <span class="muted">{t("Fetched from")}</span>
          <img src="icons/coingecko.svg" width={16} height={16} alt="" />
          <span class="ink" style={{ fontWeight: 600 }}>CoinGecko</span>
        </a>
      </div>
    </Screen>
  );
}
