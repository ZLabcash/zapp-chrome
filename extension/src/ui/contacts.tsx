// The address book (ZApp's ContactsView): browse, add, edit, delete. With `pick`, tapping a
// contact (or one of your other wallets) chooses it for Send.

import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, nav, useStore } from "./store";
import { Icon } from "./icons";
import { FlipperIcon } from "./marks";
import { Screen, confirm } from "./kit";
import { shortAddress } from "../model/format";
import type { Contact } from "../model/types";

export function ContactsView({ pick }: { pick?: (c: Contact) => void }) {
  const s = useStore();
  const others = s.wallets.filter((w) => w.id !== s.activeId);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!pick) return;
    Promise.all(others.map(async (w) => [w.id, await call<string>("address", w.ufvk, w.addressIndex)] as const)).then((x) => setAddresses(Object.fromEntries(x)));
  }, []);
  const body = (
    <div class="pad stack gap-16">
      {pick && others.length > 0 && (
        <div class="stack gap-8">
          <span class="cap muted upper" style={{ fontWeight: 600, paddingInlineStart: 4 }}>{t("My wallets")}</span>
          <div class="card stack" style={{ padding: "4px 14px" }}>
            {others.map((w, i) =>
              addresses[w.id] ? (
                <>
                  <button key={w.id} class="row gap-12" style={{ padding: "10px 0", textAlign: "start" }} onClick={() => pick({ id: "", name: w.name, address: addresses[w.id] })}>
                    {w.kind === "phone" ? (
                      <span style={{ width: 36, height: 36, borderRadius: 18, background: "var(--zcash)", color: "#000", display: "grid", placeItems: "center" }}>
                        <Icon name="wallet" size={18} />
                      </span>
                    ) : (
                      <FlipperIcon width={36} />
                    )}
                    <div class="stack gap-2">
                      <span class="sub b">{w.name}</span>
                      <span class="cap mono muted">{shortAddress(addresses[w.id], 12, 8)}</span>
                    </div>
                  </button>
                  {i < others.length - 1 && <hr class="divider" />}
                </>
              ) : null,
            )}
          </div>
        </div>
      )}
      <div class="stack gap-8">
        {pick && s.wallets.length > 1 && <span class="cap muted upper" style={{ fontWeight: 600, paddingInlineStart: 4 }}>{t("Contacts")}</span>}
        <div class="card stack" style={{ padding: s.contacts.length ? "4px 14px" : 16 }}>
          {s.contacts.length === 0 && <div class="foot muted">{t("No contacts yet. Add one with +, or save an address from Send.")}</div>}
          {s.contacts.map((c, i) => (
            <>
              <div class="row gap-12" key={c.id} style={{ padding: "10px 0" }}>
                <button class="row gap-12 spacer" style={{ textAlign: "start", minWidth: 0 }} onClick={() => (pick ? pick(c) : nav.sheet(() => <ContactEditor contact={c} />))}>
                  <span style={{ width: 36, height: 36, borderRadius: 18, background: "var(--zcash)", color: "#000", display: "grid", placeItems: "center", fontWeight: 700 }}>{c.name.slice(0, 1).toUpperCase()}</span>
                  <div class="stack gap-2" style={{ minWidth: 0 }}>
                    <span class="sub b ellipsis">{c.name}</span>
                    <span class="cap mono muted">{shortAddress(c.address, 12, 8)}</span>
                  </div>
                </button>
                {!pick && (
                  <button
                    class="muted"
                    aria-label={t("Delete")}
                    onClick={() =>
                      confirm({ title: t("Delete %@?", c.name), action: t("Delete"), onConfirm: () => call("deleteContact", c.id) })
                    }
                  >
                    <Icon name="trash" size={17} />
                  </button>
                )}
              </div>
              {i < s.contacts.length - 1 && <hr class="divider" />}
            </>
          ))}
        </div>
      </div>
    </div>
  );
  const add = (
    <button class="yellow" aria-label={t("Add")} onClick={() => nav.sheet(() => <ContactEditor contact={{ id: "", name: "", address: "" }} />)}>
      <Icon name="plus" size={22} stroke={2.4} />
    </button>
  );
  if (pick) {
    return (
      <div class="stack">
        <div class="row" style={{ padding: "4px 18px" }}>
          <span class="headline spacer">{t("Address book")}</span>
          {add}
        </div>
        {body}
      </div>
    );
  }
  return (
    <Screen title={t("Address book")} trailing={add}>
      {body}
    </Screen>
  );
}

/** Name and address, checked before saving. */
function ContactEditor({ contact }: { contact: Contact }) {
  const s = useStore();
  const [c, setC] = useState(contact);
  const [valid, setValid] = useState<boolean | null>(null);
  useEffect(() => {
    const a = c.address.trim();
    if (!a) return setValid(null);
    call<string>("addressKind", a).then((k) => setValid(!!k));
  }, [c.address]);
  const canSave = c.name.trim() !== "" && valid === true;
  const isNew = !s.contacts.some((x) => x.id === contact.id);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet">
        <div class="row" style={{ padding: "14px 18px 8px" }}>
          <button class="sub yellow" onClick={() => nav.closeSheet()}>
            {t("Cancel")}
          </button>
          <span class="headline spacer" style={{ textAlign: "center" }}>
            {isNew ? t("New contact") : t("Edit contact")}
          </span>
          <button
            class="sub b yellow"
            disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.4 }}
            onClick={() => {
              call("saveContact", c);
              nav.closeSheet();
            }}
          >
            {t("Save")}
          </button>
        </div>
        <div class="stack gap-14" style={{ padding: "8px 18px 22px" }}>
          <div class="stack gap-6">
            <span class="cap muted upper" style={{ fontWeight: 600 }}>{t("Name")}</span>
            <div class="field">
              <input placeholder="Alice" value={c.name} onInput={(e) => setC({ ...c, name: (e.target as HTMLInputElement).value })} />
            </div>
          </div>
          <div class="stack gap-6">
            <span class="cap muted upper" style={{ fontWeight: 600 }}>{t("Zcash address")}</span>
            <div class="field" style={{ alignItems: "flex-start" }}>
              <textarea rows={3} class="mono" style={{ fontSize: 13 }} placeholder="u1… or t1…" spellcheck={false} value={c.address} onInput={(e) => setC({ ...c, address: (e.target as HTMLTextAreaElement).value })} />
            </div>
            <button class="sub b yellow" style={{ alignSelf: "flex-start" }} onClick={async () => setC({ ...c, address: (await navigator.clipboard.readText()).trim() })}>
              {t("Paste")}
            </button>
            {valid === false && <div class="foot orange">{t("Not a valid Zcash address for this network.")}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
