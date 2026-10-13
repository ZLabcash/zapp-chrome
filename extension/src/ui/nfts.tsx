// NFTs: zkSNARKs, the 10,000 pixel portraits on Zcash. Which ones you hold isn't on chain: it
// lives in your zilkroad account. Signed in on zilkroad.com, its /api/me answers with them (Chrome
// sends zilkroad's session cookie, ZApp having access to zilkroad.com); only the token numbers are
// kept here, to show them at once next time. Images and traits come from ZScan.

import { useEffect, useRef, useState } from "preact/hooks";
import { t, formatNumber } from "../i18n";
import { isPopup, nav } from "./store";
import { Icon } from "./icons";
import { CopyButton, Note, Screen, Spinner } from "./kit";
import { zec, shortAddress } from "../model/format";

const SUPPLY = 10000;
const ZILKROAD = "https://zilkroad.com";
const ITEMS = "https://api.zscan.cash/v1/collections/zksnarks/items";
const HELD_KEY = "zilkroadHeld";
const PAGE = 60;

const imageUrl = (n: number) => `${ITEMS}/${n}/image`;
const zilkroadUrl = (n: number) => `${ZILKROAD}/#/${n}`;
const ALL = Array.from({ length: SUPPLY }, (_, i) => i + 1);

// ---- your zkSNARKs, from your zilkroad account ----

type Me = { status: "checking" | "in" | "out" | "error"; held: number[] | null; address: string | null };
let me: Me = { status: "checking", held: null, address: null };
const meListeners = new Set<() => void>();
let checking: Promise<void> | null = null;
let checkedAt = 0;

function setMe(m: Me) {
  me = m;
  meListeners.forEach((l) => l());
}

// The numbers seen last time, while zilkroad answers.
chrome.storage.local.get(HELD_KEY).then((r) => {
  const held = r[HELD_KEY];
  if (me.status === "checking" && Array.isArray(held)) setMe({ ...me, held });
});

function signedOut() {
  setMe({ status: "out", held: null, address: null });
  chrome.storage.local.remove(HELD_KEY);
}

async function checkZilkroad() {
  try {
    const r = await fetch(`${ZILKROAD}/api/me`, { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
    if (r.status === 401 || r.status === 403) return signedOut();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    // Signed out, zilkroad answers with an empty account.
    if (!j || (!j.address && !j.accountId && !j.account)) return signedOut();
    const held = [
      ...new Set<number>(
        (Array.isArray(j.snarks) ? j.snarks : [])
          .filter((x: any) => (x?.collection ?? "main") === "main")
          .map((x: any) => Number(x?.tokenNumber))
          .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= SUPPLY),
      ),
    ].sort((a, b) => a - b);
    setMe({ status: "in", held, address: typeof j.address === "string" ? j.address : null });
    chrome.storage.local.set({ [HELD_KEY]: held });
  } catch {
    setMe({ ...me, status: "error" });
  }
}

/** Asks zilkroad again (on opening, and when ZApp's window gets the focus back). */
function recheck(force = false) {
  if (checking || (!force && Date.now() - checkedAt < 3000)) return;
  checkedAt = Date.now();
  if (me.status === "error" && me.held === null) setMe({ ...me, status: "checking" });
  checking = checkZilkroad().finally(() => (checking = null));
}

function useMe(): Me {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    meListeners.add(l);
    return () => void meListeners.delete(l);
  }, []);
  return me;
}

// ---- pixel art, loaded as it scrolls into view, a few at a time ----

const MAX_LOADS = 4;
let loading = 0;
const queue: (() => void)[] = [];

function acquire(start: () => void) {
  if (loading < MAX_LOADS) {
    loading++;
    start();
  } else queue.push(start);
}

function release() {
  loading--;
  const next = queue.shift();
  if (next) {
    loading++;
    next();
  }
}

function PixelArt({ n, eager = false }: { n: number; eager?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(eager ? imageUrl(n) : null);
  const [loaded, setLoaded] = useState(false);
  const slot = useRef<"none" | "waiting" | "held" | "done">("none");
  const done = () => {
    if (slot.current === "held") release();
    slot.current = "done";
  };
  useEffect(() => {
    if (eager || !ref.current) return;
    const root = ref.current.closest(".scroll");
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        slot.current = "waiting";
        acquire(() => {
          // Scrolled away and gone before its turn.
          if (slot.current !== "waiting") return release();
          slot.current = "held";
          setSrc(imageUrl(n));
        });
      },
      { root, rootMargin: "120px" },
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      done();
    };
  }, [n]);
  return (
    <span ref={ref} class="art">
      {src && (
        <img
          src={src}
          alt={`zkSNARKs #${n}`}
          decoding="async"
          class={loaded ? "on" : ""}
          onLoad={() => (setLoaded(true), done())}
          onError={done}
        />
      )}
    </span>
  );
}

// ---- the tab ----

export function NftsTab() {
  const [view, setView] = useState<"mine" | "all">("mine");
  return (
    <div class="stack">
      <div style={{ padding: "12px 16px 2px" }}>
        <div class="seg" role="tablist">
          <button class={view === "mine" ? "on" : ""} role="tab" aria-selected={view === "mine"} onClick={() => setView("mine")}>
            {t("Mine")}
          </button>
          <button class={view === "all" ? "on" : ""} role="tab" aria-selected={view === "all"} onClick={() => setView("all")}>
            {t("All %@", formatNumber(SUPPLY))}
          </button>
        </div>
      </div>
      {view === "mine" ? <Mine /> : <All />}
    </div>
  );
}

function Mine() {
  const m = useMe();
  useEffect(() => {
    recheck(true);
    const onFocus = () => recheck();
    const onVisible = () => document.visibilityState === "visible" && recheck();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (m.status === "out") return <SignedOut />;
  if (m.held === null) {
    if (m.status === "error")
      return (
        <div class="stack center gap-12" style={{ padding: "40px 24px", textAlign: "center" }}>
          <Icon name="wifi-off" size={28} stroke={1.8} class="muted" />
          <div class="foot muted">{t("Couldn't reach zilkroad.")}</div>
          <button class="btn ghost" onClick={() => recheck(true)}>
            {t("Try again")}
          </button>
        </div>
      );
    return (
      <div class="row gap-8 foot muted" style={{ justifyContent: "center", padding: "44px 24px" }}>
        <Spinner size={14} />
        {t("Checking zilkroad…")}
      </div>
    );
  }
  return (
    <div class="stack">
      {m.status === "in" && m.address && (
        <div class="row gap-8" style={{ padding: "10px 16px 0" }}>
          <span class="foot muted">{t("zilkroad address")}</span>
          <span class="spacer" />
          <span class="mono cap" title={m.address}>
            {shortAddress(m.address, 8, 6)}
          </span>
          <CopyButton text={m.address} small />
        </div>
      )}
      {m.status === "error" && (
        <div style={{ padding: "10px 16px 0" }}>
          <Note text={t("Couldn't reach zilkroad.")} />
        </div>
      )}
      {m.held.length === 0 ? (
        <div class="stack center gap-8" style={{ padding: "40px 24px", textAlign: "center" }}>
          <Icon name="image" size={30} stroke={1.8} class="muted" />
          <div class="foot muted" style={{ lineHeight: 1.4 }}>{t("No zkSNARKs in this zilkroad account yet.")}</div>
        </div>
      ) : (
        <Grid numbers={m.held} />
      )}
    </div>
  );
}

function SignedOut() {
  const open = () => {
    chrome.tabs.create({ url: ZILKROAD });
    if (isPopup) window.close();
  };
  return (
    <div class="stack center gap-12 signed-out" style={{ padding: "32px 28px 28px", textAlign: "center" }}>
      <Icon name="image" size={30} stroke={1.8} class="muted" />
      <div class="foot muted" style={{ lineHeight: 1.45 }}>
        {t("Your zkSNARKs are held in your zilkroad account. Sign in there, then come back to see them here.")}
      </div>
      <button class="btn fill" onClick={open}>
        <Icon name="external" size={16} />
        {t("Sign in on zilkroad")}
      </button>
    </div>
  );
}

function All() {
  const [q, setQ] = useState("");
  const numbers = q ? ALL.filter((n) => String(n).includes(q)).sort((a, b) => Number(b === Number(q)) - Number(a === Number(q))) : ALL;
  return (
    <div class="stack">
      <div style={{ padding: "12px 16px 0" }}>
        <div class="input">
          <Icon name="search" size={16} class="muted" />
          <input
            inputMode="numeric"
            placeholder={t("Search by number")}
            value={q}
            onInput={(e) => {
              const el = e.target as HTMLInputElement;
              const v = el.value.replace(/\D/g, "").slice(0, 5);
              el.value = v;
              setQ(v.replace(/^0+/, ""));
            }}
          />
        </div>
      </div>
      {numbers.length ? (
        <Grid key={q} numbers={numbers} />
      ) : (
        <div class="foot muted" style={{ padding: "36px 24px", textAlign: "center" }}>
          {t("No zkSNARK with that number.")}
        </div>
      )}
    </div>
  );
}

/** The portraits as a grid, a page more each time its end scrolls into view. */
function Grid({ numbers }: { numbers: number[] }) {
  const [shown, setShown] = useState(PAGE);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!end.current || shown >= numbers.length) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown((s) => s + PAGE), {
      root: end.current.closest(".scroll"),
      rootMargin: "300px",
    });
    io.observe(end.current);
    return () => io.disconnect();
  }, [shown, numbers.length]);
  return (
    <>
      <div class="snark-grid">
        {numbers.slice(0, shown).map((n) => (
          <button key={n} class="snark-tile" onClick={() => nav.push(() => <SnarkScreen n={n} />)}>
            <PixelArt n={n} />
            <span class="cap num muted">#{n}</span>
          </button>
        ))}
      </div>
      {shown < numbers.length && <div ref={end} style={{ height: 1 }} />}
    </>
  );
}

// ---- one zkSNARK ----

type Item = { traits?: { trait_type: string; value: string }[]; rank?: number | null; ask?: number | null };

function SnarkScreen({ n }: { n: number }) {
  const m = useMe();
  const [item, setItem] = useState<Item | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetch(`${ITEMS}/${n}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setItem)
      .catch(() => setFailed(true));
  };
  useEffect(load, [n]);
  const yours = m.held?.includes(n) ?? false;
  return (
    <Screen
      title={`zkSNARKs #${n}`}
      footer={
        <a class="btn line wide" href={zilkroadUrl(n)} target="_blank">
          <Icon name="external" size={16} />
          {t("Open on zilkroad")}
        </a>
      }
    >
      <div class="stack gap-14 snark-detail" style={{ padding: 16 }}>
        <div class="snark-big">
          <PixelArt n={n} eager />
        </div>
        <div class="row gap-8">
          <span class="headline">zkSNARKs #{n}</span>
          {yours && <span class="chip-soon">{t("Yours")}</span>}
        </div>
        {failed ? (
          <div class="stack gap-10">
            <Note text={t("Couldn't load the traits.")} />
            <button class="btn ghost" style={{ alignSelf: "flex-start" }} onClick={load}>
              {t("Try again")}
            </button>
          </div>
        ) : !item ? (
          <div class="row" style={{ justifyContent: "center", padding: 20 }}>
            <Spinner size={16} />
          </div>
        ) : (
          <div class="stack">
            {item.rank ? <Kv k={t("Rank")} v={`#${formatNumber(item.rank)}`} /> : null}
            {item.ask ? <Kv k={t("Listed for")} v={zec(item.ask)} /> : null}
            {(item.traits ?? []).map((x) => (
              <Kv key={x.trait_type} k={x.trait_type} v={x.value} />
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div class="kv">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
