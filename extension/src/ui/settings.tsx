// Settings, as an extension lists them: general (currency, language, appearance), security
// (auto-lock, recovery phrase, password), this wallet (name, broadcast, sync), network
// (server, explorer), about.

import type { ComponentChildren } from "preact";
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t, LANGUAGES, effective, flag, languageName, currencyName, formatFiat, formatNumber, language } from "../i18n";
import { call, nav, useStore } from "./store";
import { Icon } from "./icons";
import { Flag, Ring } from "./marks";
import { Note, Popover, Screen, Toggle, usePopover, CopyButton } from "./kit";
import { activeWallet } from "./home";
import { RenameDialog, confirmRemove } from "./wallets";
import { WordGrid } from "./onboarding";
import { CURRENCIES, CURRENCY_FLAGS } from "../model/prices";
import { EXPLORERS, SERVERS } from "../model/types";

export const VERSION = chrome.runtime.getManifest().version;

function Row({ icon, title, value, onClick, children }: { icon: string; title: string; value?: ComponentChildren; onClick?: () => void; children?: ComponentChildren }) {
  const inner = (
    <>
      <span class="muted" style={{ display: "grid" }}>
        <Icon name={icon} size={18} />
      </span>
      <span class="sub spacer" style={{ fontWeight: 500 }}>
        {title}
      </span>
      {value !== undefined && <span class="foot muted num ellipsis" style={{ maxWidth: 150 }}>{value}</span>}
      {children}
      {onClick && <Icon name="chevron-right" size={14} stroke={2.6} class="muted flip-rtl" />}
    </>
  );
  return onClick ? (
    <button class="menu-row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div class="menu-row">{inner}</div>
  );
}

const LOCK_CHOICES = [1, 5, 15, 60, 0];

export function SettingsScreen() {
  const s = useStore();
  const w = activeWallet(s);
  const info = usePopover();
  const sy = s.sync;
  const ap = s.settings.appearance;
  const lockLabel = (m: number) => (m === 0 ? t("Never") : m < 60 ? t("%lld min", m) : t("%lld h", m / 60));
  return (
    <Screen title={t("Settings")}>
      <div class="section-title">{t("General")}</div>
      <Row icon="dollar" title={t("Currency")} value={s.settings.currency.toUpperCase()} onClick={() => nav.push(() => <CurrencyScreen />)} />
      <Row icon="globe" title={t("Language")} value={languageName(effective(s.settings.language))} onClick={() => nav.push(() => <LanguageScreen />)} />
      <Row icon="contrast" title={t("Appearance")}>
        <div class="row" style={{ background: "var(--soft)", borderRadius: 999, padding: 2 }}>
          {[
            [0, "contrast", t("System")],
            [1, "sun", t("Light")],
            [2, "moon", t("Dark")],
          ].map(([tag, icon, label]) => (
            <button
              key={tag}
              title={label as string}
              aria-label={label as string}
              onClick={() => call("setSettings", { appearance: tag })}
              style={{ width: 32, height: 26, borderRadius: 999, display: "grid", placeItems: "center", background: ap === tag ? "var(--zcash)" : "transparent", color: ap === tag ? "#000" : "var(--muted)" }}
            >
              <Icon name={icon as string} size={14} />
            </button>
          ))}
        </div>
      </Row>

      <div class="section-title">{t("Security")}</div>
      {s.vault.exists && (
        <Row icon="lock" title={t("Auto-lock")}>
          <select
            value={s.settings.lockMinutes}
            onChange={(e) => call("setSettings", { lockMinutes: Number((e.target as HTMLSelectElement).value) })}
            style={{ font: "inherit", fontSize: 13, color: "var(--text)", background: "var(--soft)", border: "none", borderRadius: 8, padding: "4px 8px" }}
          >
            {LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {lockLabel(m)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {w?.kind === "phone" && <Row icon="key" title={t("Recovery phrase")} onClick={() => nav.push(() => <RevealScreen />)} />}
      {s.vault.exists && <Row icon="shield" title={t("Change password")} onClick={() => nav.push(() => <ChangePasswordScreen />)} />}

      {w && (
        <>
          <div class="section-title">{w.name}</div>
          <Row icon="pencil" title={t("Name")} value={w.name} onClick={() => nav.sheet(() => <RenameDialog w={w} />)} />
          <Row icon="antenna" title={t("Automatic broadcast")}>
            <button ref={info.anchor as any} class="muted" aria-label={t("About automatic broadcast")} onClick={() => info.setOpen(true)}>
              <Icon name="info" size={16} />
            </button>
            <Toggle on={s.settings.autoBroadcast} onChange={(v) => call("setSettings", { autoBroadcast: v })} />
          </Row>
          <Popover open={info.open} onClose={() => info.setOpen(false)} anchor={info.anchor} width={300}>
            <div class="stack gap-8 foot" style={{ lineHeight: 1.45 }}>
              <span class="headline">{t("Automatic broadcast")}</span>
              <span>{t("Your hardware wallet signs payments without ever going online. Broadcasting is the next step: this app sends the signed transaction to the Zcash network.")}</span>
              <span>{t("On: it leaves as soon as your device has signed it.")}</span>
              <span>{t("Off: every signed payment waits in Activity. You broadcast it or discard it when you decide. Without network, it always waits.")}</span>
              <span class="muted">{t("A signed payment expires after about 40 blocks (around 50 minutes). Until it is broadcast, nothing has left your wallet.")}</span>
            </div>
          </Popover>
          <Row icon="sync" title={t("Synced")} value={sy.error ? t("Offline") : sy.synced ? t("Up to date") : `${Math.floor(sy.progress * 100)}%`} onClick={() => nav.push(() => <SyncScreen />)} />
        </>
      )}

      <div class="section-title">{t("Network")}</div>
      <Row icon="server" title={t("Server")} value={s.settings.server.split(":")[0]} onClick={() => nav.push(() => <ServerScreen />)} />
      <Row icon="external" title={t("Explorer")} value={EXPLORERS.find((e) => e.template === s.settings.explorer)?.name ?? t("Custom")} onClick={() => nav.push(() => <ServerScreen />)} />

      <div class="section-title">{t("About")}</div>
      <Row icon="info" title={t("Version")} value={VERSION} onClick={() => nav.push(() => <ReleaseNotesScreen />)} />

      {w && (
        <div style={{ padding: "16px 16px 24px" }}>
          <button class="btn red wide" onClick={() => confirmRemove(w, () => nav.root())}>
            {t("Forget this wallet")}
          </button>
        </div>
      )}
    </Screen>
  );
}

/** The active browser wallet's words, after the password (as extensions ask before revealing them). */
function RevealScreen() {
  const [password, setPassword] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const show = async () => {
    try {
      setWords((await call<string>("recoveryPhrase", password)).split(" "));
      setPassword("");
      setError(null);
    } catch {
      setError(t("Wrong password."));
    }
  };
  return (
    <Screen
      title={t("Recovery phrase")}
      onBack={() => setWords([])}
      footer={
        words.length ? (
          <CopyButton text={words.join(" ")} primary clearAfter={120_000} />
        ) : (
          <button class="btn fill wide" disabled={!password} onClick={show}>
            {t("Show the words")}
          </button>
        )
      }
    >
      <div class="stack gap-14" style={{ padding: 16 }}>
        <Note text={t("Never share these words. Anyone who has them can spend this wallet's funds.")} />
        {words.length ? (
          <WordGrid words={words} />
        ) : (
          <>
            <div>
              <label class="label">{t("Password")}</label>
              <div class="input">
                <input ref={ref} type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && show()} />
              </div>
            </div>
            {error && <Note text={error} />}
          </>
        )}
      </div>
    </Screen>
  );
}

function ChangePasswordScreen() {
  const [current, setCurrent] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = current && p1.length >= 8 && p1 === p2;
  const save = async () => {
    setBusy(true);
    try {
      await call("changePassword", current, p1);
      nav.pop();
    } catch {
      setError(t("Wrong password."));
    } finally {
      setBusy(false);
    }
  };
  const field = (label: string, v: string, set: (x: string) => void) => (
    <div>
      <label class="label">{label}</label>
      <div class="input">
        <input type="password" value={v} onInput={(e) => set((e.target as HTMLInputElement).value)} />
      </div>
    </div>
  );
  return (
    <Screen title={t("Change password")} footer={<button class="btn fill wide" disabled={!ok || busy} onClick={save}>{t("Save")}</button>}>
      <div class="stack gap-14" style={{ padding: 16 }}>
        {field(t("Current password"), current, setCurrent)}
        {field(t("New password"), p1, setP1)}
        {field(t("Same password again"), p2, setP2)}
        {p1.length > 0 && p1.length < 8 && <div class="foot muted">{t("At least 8 characters.")}</div>}
        {p2.length > 0 && p1 !== p2 && <div class="foot orange">{t("The two passwords differ.")}</div>}
        {error && <Note text={error} />}
      </div>
    </Screen>
  );
}

function SyncScreen() {
  const s = useStore();
  const w = activeWallet(s);
  const sy = s.sync;
  const kv = (k: string, v: string) => (
    <div class="kv" style={{ borderBottom: "1px solid var(--line)" }}>
      <span>{k}</span>
      <span class="num">{v}</span>
    </div>
  );
  return (
    <Screen title={t("Synced")}>
      <div class="stack gap-14" style={{ padding: 16 }}>
        <div class="row gap-14">
          <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
            <Ring progress={sy.synced ? 1 : sy.progress} size={50} width={5} />
            <span class="rounded" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>
              {sy.synced ? "✓" : `${Math.floor(sy.progress * 100)}%`}
            </span>
          </div>
          <div class="stack gap-2">
            <span class="headline">{sy.error ? t("Can't reach the server") : sy.synced ? t("Up to date") : t("Syncing")}</span>
            <span class={`foot ${sy.error ? "orange" : "muted"}`}>{sy.error ?? t("Your browser reads the chain to find this wallet's payments. Nothing about you is sent.")}</span>
          </div>
        </div>
        <div class="stack">
          {kv(t("Latest block"), sy.tip ? formatNumber(sy.tip) : "…")}
          {kv(t("Scanned up to"), sy.scanned ? formatNumber(sy.scanned) : "…")}
          {kv(t("Scanning from block"), formatNumber(w?.birthday ?? 0))}
          {kv(t("Server"), s.settings.server)}
        </div>
        <div class="cap muted">{t("The wallet starts at the block where it was created: older blocks can't hold its funds.")}</div>
      </div>
    </Screen>
  );
}

function ServerScreen() {
  const s = useStore();
  const [customServer, setCustomServer] = useState(SERVERS.includes(s.settings.server) ? "" : s.settings.server);
  const [customExplorer, setCustomExplorer] = useState(EXPLORERS.some((e) => e.template === s.settings.explorer) ? "" : s.settings.explorer);
  const choose = async (server: string) => {
    const clean = server.trim();
    if (!clean) return;
    const full = clean.includes(":") ? clean : clean + ":443";
    if (!SERVERS.includes(full)) {
      // A server of your own: Chrome asks to let the extension reach it.
      const ok = await chrome.permissions.request({ origins: [`https://${full.split(":")[0]}/*`] }).catch(() => false);
      if (!ok) return;
    }
    call("setSettings", { server: full });
  };
  const option = (title: string, selected: boolean, onClick: () => void, detail?: string) => (
    <button class="menu-row" onClick={onClick}>
      <div class="stack gap-2 spacer">
        <span class="sub" style={{ fontWeight: 500 }}>{title}</span>
        {detail && <span class="cap muted">{detail}</span>}
      </div>
      <span class={selected ? "yellow" : "muted"}>
        <Icon name={selected ? "check-circle" : "circle"} size={20} stroke={1.6} />
      </span>
    </button>
  );
  return (
    <Screen title={t("Server")}>
      <div class="section-title">{t("Server")}</div>
      {SERVERS.map((x) => (
        <Fragment key={x}>{option(x.split(":")[0], s.settings.server === x, () => choose(x))}</Fragment>
      ))}
      <div class="row gap-8" style={{ padding: "6px 16px" }}>
        <div class="input">
          <input class="mono" style={{ fontSize: 13 }} placeholder="host:port" value={customServer} onInput={(e) => setCustomServer((e.target as HTMLInputElement).value)} />
        </div>
        <button class="btn fill" style={{ height: 40 }} disabled={!customServer.trim()} onClick={() => choose(customServer)}>
          {t("Use")}
        </button>
      </div>
      <div class="cap muted" style={{ padding: "4px 16px 8px" }}>
        {t("Your browser syncs from this lightwalletd server. Changing it restarts the sync where it stopped.")}
      </div>
      <div class="section-title">{t("Explorer")}</div>
      {EXPLORERS.map((e) => (
        <Fragment key={e.name}>{option(e.name, s.settings.explorer === e.template, () => call("setSettings", { explorer: e.template }), new URL(e.template.replace("{txid}", "")).host)}</Fragment>
      ))}
      <div class="row gap-8" style={{ padding: "6px 16px" }}>
        <div class="input">
          <input class="mono" style={{ fontSize: 13 }} placeholder="https://…/tx/{txid}" value={customExplorer} onInput={(e) => setCustomExplorer((e.target as HTMLInputElement).value)} />
        </div>
        <button class="btn fill" style={{ height: 40 }} disabled={!/^https?:\/\//.test(customExplorer.trim())} onClick={() => call("setSettings", { explorer: customExplorer.trim() })}>
          {t("Use")}
        </button>
      </div>
      <div class="cap muted" style={{ padding: "4px 16px 20px" }}>
        {t("Transactions open there. {txid} stands for the transaction id.")}
      </div>
    </Screen>
  );
}

function ReleaseNotesScreen() {
  const items = [
    t("ZApp in Chrome: create a wallet, restore one from its words, or connect your Flipper Zero over Bluetooth."),
    t("Several wallets side by side; send between them by name."),
    t("Pay up to 5 people in one transaction, each with a message or one for all."),
    t("Signed payments can wait to be broadcast, with a countdown."),
    t("13 languages, 43 currencies, light and dark."),
  ];
  return (
    <Screen title={t("What's new")}>
      <div class="stack gap-10" style={{ padding: 16 }}>
        <div class="row gap-8">
          <span class="headline">{t("Version %@", VERSION)}</span>
          <span class="cap2" style={{ fontWeight: 700, padding: "3px 7px", borderRadius: 99, background: "rgba(27,175,122,0.2)", color: "var(--scan)" }}>{t("Installed")}</span>
        </div>
        {items.map((x) => (
          <div class="row gap-8 sub" style={{ alignItems: "baseline" }} key={x}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--zcash)", flexShrink: 0, transform: "translateY(-2px)" }} />
            <span style={{ lineHeight: 1.45 }}>{x}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}

function Choice({ flagName, title, subtitle, trailing, selected, onClick }: { flagName: string; title: string; subtitle?: string; trailing?: string | null; selected: boolean; onClick: () => void }) {
  return (
    <button class="menu-row" onClick={onClick}>
      <Flag name={flagName} height={18} />
      <div class="stack gap-2 spacer">
        <span class="sub" style={{ fontWeight: 500 }}>{title}</span>
        {subtitle && <span class="cap muted">{subtitle}</span>}
      </div>
      {trailing && <span class="foot muted num">{trailing}</span>}
      <span class={selected ? "yellow" : "muted"} style={{ opacity: selected ? 1 : 0.4 }}>
        <Icon name={selected ? "check-circle" : "circle"} size={20} stroke={1.6} />
      </span>
    </button>
  );
}

function LanguageScreen() {
  const s = useStore();
  const current = effective(s.settings.language);
  return (
    <Screen title={t("Language")}>
      {LANGUAGES.map((code) => (
        <Choice key={code} flagName={flag(code)} title={languageName(code)} subtitle={languageName(code, language())} selected={current === code} onClick={() => call("setSettings", { language: code })} />
      ))}
    </Screen>
  );
}

function CurrencyScreen() {
  const s = useStore();
  useEffect(() => void call("refreshPrices"), []);
  const [q, setQ] = useState("");
  const list = CURRENCIES.filter((c) => !q || c.includes(q.toLowerCase()) || currencyName(c).toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen title={t("Currency")}>
      <div style={{ padding: "10px 16px" }}>
        <div class="input">
          <Icon name="search" size={16} class="muted" />
          <input placeholder={t("Search")} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      {list.map((c) => (
        <Choice
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
      ))}
      <a class="row gap-6 foot" style={{ justifyContent: "center", padding: "12px 0 18px" }} href="https://www.coingecko.com/en/api" target="_blank">
        <span class="muted">{t("Fetched from")}</span>
        <img src="icons/coingecko.svg" width={16} height={16} alt="" />
        <span class="ink" style={{ fontWeight: 600 }}>CoinGecko</span>
      </a>
    </Screen>
  );
}
