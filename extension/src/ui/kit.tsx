// The building blocks ZApp's screens share: a screen with its back arrow, sheets, dialogs,
// popovers, menus, toggles, option cards.

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons";
import { nav } from "./store";
import { t } from "../i18n";

/** A pushed screen: back arrow at the far left, title in the middle. */
export function Screen({ title, children, back = true, onBack, trailing, scroll = true }: { title?: string; children: ComponentChildren; back?: boolean; onBack?: () => void; trailing?: ComponentChildren; scroll?: boolean }) {
  return (
    <>
      <div class="nav">
        <div>
          {back && (
            <button
              class="back-arrow"
              aria-label={t("Back")}
              onClick={() => {
                onBack?.();
                nav.pop();
              }}
            >
              <Icon name="chevron-left" size={19} stroke={2.6} />
            </button>
          )}
        </div>
        <h1 class="ellipsis">{title}</h1>
        <div class="row" style={{ justifyContent: "flex-end" }}>
          {trailing}
        </div>
      </div>
      {scroll ? <div class="scroll">{children}</div> : <div class="stack" style={{ flex: 1, minHeight: 0 }}>{children}</div>}
    </>
  );
}

/** A sheet from the bottom, closed by the backdrop or `nav.closeSheet()`. */
export function Sheet({ children, full = false, grabber = true }: { children: ComponentChildren; full?: boolean; grabber?: boolean }) {
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class={`sheet ${full ? "full" : ""}`}>
        {grabber && <div class="grabber" />}
        <div class="scroll">{children}</div>
      </div>
    </div>
  );
}

/** A confirmation (iOS's confirmationDialog): title, message, the destructive action, Cancel. */
export function confirm(o: { title: string; message?: string; action: string; destructive?: boolean; cancel?: string; onConfirm: () => void }) {
  nav.sheet(() => (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="dialog stack gap-14 center">
        <div class="headline">{o.title}</div>
        {o.message && <div class="foot muted" style={{ lineHeight: 1.4 }}>{o.message}</div>}
        <div class="stack gap-8" style={{ width: "100%", marginTop: 4 }}>
          <button
            class={o.destructive === false ? "primary" : "danger"}
            onClick={() => {
              nav.closeSheet();
              o.onConfirm();
            }}
          >
            {o.action}
          </button>
          <button class="plain-btn" style={{ padding: 10, color: "var(--muted)" }} onClick={() => nav.closeSheet()}>
            {o.cancel ?? t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  ));
}

/** A popover anchored under (or over) the element that opened it. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement>(null);
  return { open, setOpen, anchor };
}

export function Popover({ open, onClose, anchor, children, width = 290, align = "end" }: { open: boolean; onClose: () => void; anchor: { current: HTMLElement | null }; children: ComponentChildren; width?: number; align?: "start" | "end" }) {
  const [pos, setPos] = useState<JSX.CSSProperties>({});
  useEffect(() => {
    if (!open || !anchor.current) return;
    const root = document.getElementById("root")!.getBoundingClientRect();
    const r = anchor.current.getBoundingClientRect();
    const below = r.bottom - root.top + 8;
    const left = align === "end" ? Math.max(12, Math.min(r.right - root.left - width, root.width - width - 12)) : Math.max(12, Math.min(r.left - root.left, root.width - width - 12));
    const spaceBelow = root.bottom - r.bottom;
    setPos(spaceBelow < 220 ? { bottom: root.bottom - r.top + 8, left, width } : { top: below, left, width });
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, zIndex: 39 }} onClick={onClose} />
      <div class="popover" style={pos}>
        {children}
      </div>
    </>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button class={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

/** One choice of a list of ways: an icon and a title; greyed with a badge when it's coming. */
export function OptionCard({ title, icon, soon = false, onClick }: { title: string; icon: ComponentChildren; soon?: boolean; onClick?: () => void }) {
  return (
    <button class={`option-card ${soon ? "soon" : ""}`} onClick={soon ? undefined : onClick} disabled={soon}>
      <div style={{ width: 52, display: "grid", placeItems: "center" }}>{icon}</div>
      <span class="sub b" style={{ fontSize: 16 }}>{title}</span>
      {soon && <span class="chip-soon">{t("Coming soon")}</span>}
      <span class="spacer" />
      {!soon && <Icon name="chevron-right" size={14} stroke={3} class="muted" />}
    </button>
  );
}

export function IconTile({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <div class="icon-tile" style={{ width: size, height: size }}>
      <Icon name={name} size={size * 0.48} stroke={2.4} />
    </div>
  );
}

/** A warning or note line with its icon. */
export function Note({ text, kind = "warn" }: { text: string; kind?: "warn" | "info" | "plain" }) {
  return (
    <div class={`row gap-8 foot ${kind === "warn" ? "orange" : "muted"}`} style={{ alignItems: "flex-start", lineHeight: 1.35 }}>
      <Icon name={kind === "warn" ? "alert" : "info"} size={15} style={{ marginTop: 1 }} />
      <span>{text}</span>
    </div>
  );
}

/** Copy to the clipboard, "Copied" for two seconds. */
export function useCopy(): [boolean, (text: string, clearAfter?: number) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  return [
    copied,
    (text, clearAfter) => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      // A recovery phrase doesn't stay in the clipboard.
      if (clearAfter) setTimeout(() => navigator.clipboard.readText().then((x) => { if (x === text) navigator.clipboard.writeText(""); }).catch(() => {}), clearAfter);
    },
  ];
}

export function CopyButton({ text, primary = false, clearAfter, small = false }: { text: string; primary?: boolean; clearAfter?: number; small?: boolean }) {
  const [copied, copy] = useCopy();
  if (primary) {
    return (
      <button class="primary" onClick={() => copy(text, clearAfter)}>
        <Icon name={copied ? "check" : "copy"} size={18} />
        {copied ? t("Copied") : t("Copy")}
      </button>
    );
  }
  return (
    <button class={small ? "row gap-6 cap yellow" : "pill"} style={small ? { fontWeight: 600 } : { color: "var(--text)", fontSize: 14, padding: "8px 14px" }} onClick={() => copy(text, clearAfter)}>
      <Icon name={copied ? "check" : "copy"} size={small ? 13 : 15} />
      {copied ? t("Copied") : t("Copy")}
    </button>
  );
}

/** A menu that opens under its button. */
export function Menu({ button, children, width = 220 }: { button: (open: () => void) => ComponentChildren; children: (close: () => void) => ComponentChildren; width?: number }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<JSX.CSSProperties>({});
  useEffect(() => {
    if (!open || !anchor.current) return;
    const root = document.getElementById("root")!.getBoundingClientRect();
    const r = anchor.current.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    setPos({ top: r.bottom - root.top + 6, ...(rtl ? { left: r.left - root.left } : { right: root.right - r.right }), width });
  }, [open]);
  return (
    <div ref={anchor}>
      {button(() => setOpen(true))}
      {open && (
        <>
          <div style={{ position: "absolute", inset: 0, zIndex: 39 }} onClick={() => setOpen(false)} />
          <div class="menu" style={pos}>
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}
