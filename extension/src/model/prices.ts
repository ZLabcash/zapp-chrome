// The ZEC price in the user's currency: CoinGecko's public API for every currency, ZScan's
// own API (USD) when CoinGecko can't be reached. Refreshed every 5 minutes (as ZApp).

export const CURRENCIES = [
  "usd", "eur", "gbp", "chf", "jpy", "cny", "cad", "aud", "nzd", "krw", "inr", "brl", "mxn", "ars", "clp", "rub", "uah", "try",
  "pln", "czk", "huf", "sek", "nok", "dkk", "ils", "aed", "sar", "kwd", "bhd", "zar", "ngn", "sgd", "hkd", "twd", "thb", "idr",
  "myr", "php", "vnd", "pkr", "bdt", "lkr", "gel",
];

export const CURRENCY_FLAGS: Record<string, string> = {
  usd: "us", eur: "eu", gbp: "gb", chf: "ch", jpy: "jp", cny: "cn", cad: "ca", aud: "au", nzd: "nz", krw: "kr", inr: "in",
  brl: "br", mxn: "mx", ars: "ar", clp: "cl", rub: "ru", uah: "ua", try: "tr", pln: "pl", czk: "cz", huf: "hu", sek: "se",
  nok: "no", dkk: "dk", ils: "il", aed: "ae", sar: "sa", kwd: "kw", bhd: "bh", zar: "za", ngn: "ng", sgd: "sg", hkd: "hk",
  twd: "tw", thb: "th", idr: "id", myr: "my", php: "ph", vnd: "vn", pkr: "pk", bdt: "bd", lkr: "lk", gel: "ge",
};

export class PriceService {
  prices: Record<string, number> = {};
  private updated = 0;
  private refreshing = false;
  onChange: () => void = () => {};

  start(_currency: () => string) {
    this.refresh();
    setInterval(() => this.refresh(), 300_000);
  }

  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=${CURRENCIES.join(",")}`);
      const zec = (await r.json())?.zcash;
      if (zec && Object.keys(zec).length) {
        this.prices = zec;
        this.updated = Date.now();
        return;
      }
      throw new Error("no prices");
    } catch {
      try {
        const usd = (await (await fetch("https://api.zscan.cash/v1/price")).json())?.usd;
        if (typeof usd === "number") {
          this.prices = { ...this.prices, usd };
          this.updated = Date.now();
        }
      } catch {}
    } finally {
      this.refreshing = false;
      this.onChange();
    }
  }
}
