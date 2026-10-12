// The wallet list (as an extension's account list): each wallet with its kind and balance;
// click to switch, ⋯ to rename or remove; add a wallet.

import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, context, nav, openApp, useStore } from "./store";
import { Icon } from "./icons";
import { Menu, confirm } from "./kit";
import { zec } from "../model/format";
import type { Wallet } from "../model/types";
import { WalletAvatar } from "./home";
import { AddWalletScreen } from "./onboarding";

export function WalletPicker() {
  const s = useStore();
  return (
    <div class="overlay">
      <div class="hdr" style={{ justifyContent: "space-between" }}>
        <span style={{ width: 34 }} />
        <span class="headline" style={{ fontSize: 15 }}>
          {t("Wallets")}
        </span>
        <button class="icon-btn" aria-label={t("Cancel")} onClick={() => nav.closeSheet()}>
          <Icon name="x" size={18} stroke={2.4} />
        </button>
      </div>
      <div class="scroll" style={{ paddingTop: 6 }}>
        {s.wallets.map((w) => (
          <WalletRow key={w.id} w={w} active={w.id === s.activeId} />
        ))}
      </div>
      <div class="footer">
        <button
          class="btn line"
          onClick={() => {
            nav.closeSheet();
            if (context === "popup") openApp("#add");
            else nav.push(() => <AddWalletScreen onDone={() => nav.root()} />);
          }}
        >
          <Icon name="plus" size={16} stroke={2.6} />
          {t("Add a wallet")}
        </button>
      </div>
    </div>
  );
}

function WalletRow({ w, active }: { w: Wallet; active: boolean }) {
  const s = useStore();
  const visible = w.kind === "phone" || (s.flipper.connected && s.flipper.walletId === w.id);
  return (
    <div class="row" style={{ background: active ? "rgba(244,183,40,0.1)" : undefined, borderInlineStart: `3px solid ${active ? "var(--zcash)" : "transparent"}` }}>
      <button
        class="list-row"
        style={{ flex: 1 }}
        onClick={async () => {
          await call("activate", w.id);
          nav.closeSheet();
        }}
      >
        <WalletAvatar w={w} size={32} />
        <div class="stack gap-2 spacer" style={{ minWidth: 0 }}>
          <span class="sub b ellipsis">{w.name}</span>
          <span class="cap muted">{w.kind === "phone" ? t("In this browser") : "Flipper Zero"}</span>
        </div>
        <span class="sub num muted">{visible ? zec(s.balances[w.id] ?? 0) : "•••• ZEC"}</span>
      </button>
      <Menu
        width={180}
        button={(open) => (
          <button class="icon-btn" aria-label={t("Edit")} style={{ marginInlineEnd: 8 }} onClick={open}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        )}
      >
        {(close) => (
          <>
            <button onClick={() => (close(), nav.sheet(() => <RenameDialog w={w} />))}>
              <Icon name="pencil" size={15} />
              {t("Rename")}
            </button>
            <button class="red" onClick={() => (close(), confirmRemove(w))}>
              <Icon name="trash" size={15} />
              {t("Remove")}
            </button>
          </>
        )}
      </Menu>
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

/** Rename a wallet: the name and Save. */
export function RenameDialog({ w }: { w: Wallet }) {
  const [name, setName] = useState(w.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const save = () => {
    call("rename", w.id, name);
    nav.closeSheet();
  };
  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="dialog stack gap-14">
        <div class="headline">{t("Rename wallet")}</div>
        <div class="input">
          <input ref={ref} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        </div>
        <div class="row gap-10">
          <button class="btn line" style={{ flex: 1 }} onClick={() => nav.closeSheet()}>
            {t("Cancel")}
          </button>
          <button class="btn fill" style={{ flex: 1 }} onClick={save}>
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
