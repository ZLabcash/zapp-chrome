// The address book: add, edit, delete contacts (kept in this browser only).

import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, nav, useStore } from "./store";
import { Icon } from "./icons";
import { Screen, confirm } from "./kit";
import { shortAddress } from "../model/format";
import type { Contact } from "../model/types";

export function ContactsScreen() {
  const s = useStore();
  return (
    <Screen
      title={t("Address book")}
      trailing={
        <button class="icon-btn" aria-label={t("Add")} title={t("Add")} onClick={() => nav.push(() => <ContactEditor contact={{ id: "", name: "", address: "" }} />)}>
          <Icon name="plus" size={19} stroke={2.4} />
        </button>
      }
    >
      {s.contacts.length === 0 && <div class="foot muted" style={{ padding: "28px 16px", textAlign: "center" }}>{t("No contacts yet. Add one with +, or save an address from Send.")}</div>}
      <div class="stack" style={{ padding: "6px 0" }}>
        {s.contacts.map((c) => (
          <button key={c.id} class="list-row" onClick={() => nav.push(() => <ContactEditor contact={c} />)}>
            <span class="avatar" style={{ fontWeight: 700 }}>
              {c.name.slice(0, 1).toUpperCase()}
            </span>
            <div class="stack gap-2 spacer" style={{ minWidth: 0 }}>
              <span class="sub b ellipsis">{c.name}</span>
              <span class="cap mono muted">{shortAddress(c.address, 12, 8)}</span>
            </div>
            <Icon name="chevron-right" size={14} stroke={2.6} class="muted flip-rtl" />
          </button>
        ))}
      </div>
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
  const isNew = !s.contacts.some((x) => x.id === contact.id);
  const canSave = c.name.trim() !== "" && valid === true;
  return (
    <Screen
      title={isNew ? t("New contact") : t("Edit contact")}
      footer={
        <>
          {!isNew && (
            <button
              class="btn red"
              onClick={() =>
                confirm({
                  title: t("Delete %@?", c.name),
                  action: t("Delete"),
                  onConfirm: () => {
                    call("deleteContact", c.id);
                    nav.pop();
                  },
                })
              }
            >
              {t("Delete")}
            </button>
          )}
          <button
            class="btn fill"
            disabled={!canSave}
            onClick={() => {
              call("saveContact", c);
              nav.pop();
            }}
          >
            {t("Save")}
          </button>
        </>
      }
    >
      <div class="stack gap-16" style={{ padding: 16 }}>
        <div>
          <label class="label">{t("Name")}</label>
          <div class="input">
            <input placeholder="Alice" value={c.name} onInput={(e) => setC({ ...c, name: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
        <div>
          <label class="label">{t("Zcash address")}</label>
          <div class="input" style={{ alignItems: "flex-start" }}>
            <textarea rows={3} class="mono" style={{ fontSize: 12 }} placeholder="u1… or t1…" spellcheck={false} value={c.address} onInput={(e) => setC({ ...c, address: (e.target as HTMLTextAreaElement).value })} />
            <button class="yellow" title={t("Paste")} onClick={async () => setC({ ...c, address: (await navigator.clipboard.readText()).trim() })}>
              <Icon name="copy" size={16} />
            </button>
          </div>
          {valid === false && <div class="foot orange" style={{ marginTop: 6 }}>{t("Not a valid Zcash address for this network.")}</div>}
        </div>
      </div>
    </Screen>
  );
}
