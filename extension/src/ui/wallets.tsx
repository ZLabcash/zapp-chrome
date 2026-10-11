// The wallet switcher (ZApp's WalletsSheet): every wallet here with its kind and balance; tap
// one to make it active, rename or remove it, or add another.

import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, nav, useStore } from "./store";
import { Icon } from "./icons";
import { FlipperIcon } from "./marks";
import { confirm } from "./kit";
import { zec } from "../model/format";
import type { Wallet } from "../model/types";
import { AddWalletView } from "./onboarding";
import { flipperReady, walletSwitched } from "./flipper";

export function WalletsSheet() {
  const s = useStore();
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet" style={{ maxHeight: "90%" }}>
        <div class="grabber" />
        <div class="headline" style={{ textAlign: "center", padding: "6px 0 10px" }}>
          {t("Wallets")}
        </div>
        <div class="scroll">
          <div class="stack gap-14" style={{ padding: "0 18px 22px" }}>
            <div class="card stack" style={{ padding: "4px 14px" }}>
              {s.wallets.map((w, i) => (
                <>
                  <WalletRow key={w.id} w={w} active={w.id === s.activeId} />
                  {i < s.wallets.length - 1 && <hr class="divider" />}
                </>
              ))}
            </div>
            <button
              class="card row gap-10 sub b yellow"
              style={{ padding: "14px 16px" }}
              onClick={() => {
                nav.closeSheet();
                nav.push(() => <AddWalletView onDone={() => nav.root()} />);
              }}
            >
              <Icon name="plus-circle" size={20} />
              <span class="spacer" style={{ textAlign: "start" }}>{t("Add a wallet")}</span>
              <Icon name="chevron-right" size={14} stroke={3} class="muted" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One wallet: its kind, name and balance (a Flipper wallet's only while its Flipper is connected). */
function WalletRow({ w, active }: { w: Wallet; active: boolean }) {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const visible = w.kind === "phone" || flipperReady(w.id);
  return (
    <div class="row gap-12" style={{ padding: "10px 0", position: "relative" }}>
      <button
        class="row gap-12 spacer"
        style={{ textAlign: "start", minWidth: 0 }}
        onClick={async () => {
          await call("activate", w.id);
          walletSwitched(w.id);
          nav.closeSheet();
        }}
      >
        <div style={{ width: 44, display: "grid", placeItems: "center" }}>{w.kind === "phone" ? <span class="yellow"><Icon name="wallet" size={24} /></span> : <FlipperIcon width={44} />}</div>
        <div class="stack gap-2 spacer" style={{ minWidth: 0 }}>
          <span class="sub b ellipsis">{w.name}</span>
          <span class="cap muted">{w.kind === "phone" ? t("In this browser") : "Flipper Zero"}</span>
        </div>
        <span class="sub num muted">{visible ? zec(s.balances[w.id] ?? 0) : "•••• ZEC"}</span>
        <span class={active ? "yellow" : "muted"} style={{ opacity: active ? 1 : 0.5 }}>
          <Icon name={active ? "check-circle" : "circle"} size={22} stroke={1.6} />
        </span>
      </button>
      <button class="muted" aria-label={t("Edit")} onClick={() => setMenu(!menu)} style={{ padding: 4 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {menu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setMenu(false)} />
          <div class="menu" style={{ top: 44, insetInlineEnd: 0, minWidth: 170 }}>
            <button
              onClick={() => {
                setMenu(false);
                nav.sheet(() => <RenameWalletSheet w={w} />);
              }}
            >
              <Icon name="pencil" size={15} />
              {t("Rename")}
            </button>
            <button
              class="red"
              onClick={() => {
                setMenu(false);
                confirmRemove(w);
              }}
            >
              <Icon name="trash" size={15} />
              {t("Remove")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function confirmRemove(w: Wallet, after?: () => void) {
  confirm({
    title: t("Remove “%@”?", w.name),
    message:
      w.kind === "phone"
        ? t("Its recovery phrase is erased from this browser. Without your written 24 words, its funds are lost.")
        : t("It's removed from this browser. Your funds stay safe: the keys are on your device."),
    action: t("Remove"),
    onConfirm: async () => {
      await call("remove", w.id);
      after?.();
    },
  });
}

/** Rename a wallet: the name and Save, readable in light and dark. */
export function RenameWalletSheet({ w }: { w: Wallet }) {
  const [name, setName] = useState(w.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const save = () => {
    call("rename", w.id, name);
    nav.closeSheet();
  };
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet">
        <div class="grabber" />
        <div class="stack gap-16" style={{ padding: "8px 20px 22px" }}>
          <div class="row">
            <span class="headline spacer">{t("Rename wallet")}</span>
            <button aria-label={t("Cancel")} onClick={() => nav.closeSheet()} style={{ width: 32, height: 32, borderRadius: 16, background: "var(--card)", display: "grid", placeItems: "center", color: "var(--ink)" }}>
              <Icon name="x" size={15} stroke={3} />
            </button>
          </div>
          <div class="field">
            <input ref={ref} placeholder={t("Name")} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            {name && (
              <button class="muted" onClick={() => setName("")}>
                <Icon name="x-circle" size={18} />
              </button>
            )}
          </div>
          <button class="primary" onClick={save}>
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
