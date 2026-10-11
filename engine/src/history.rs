//! Balances and activity, as ZApp shows them (the SDK reads the same views).

use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use zcash_client_backend::data_api::{wallet::ConfirmationsPolicy, WalletRead};
use zcash_protocol::memo::{Memo, MemoBytes};

use crate::{db::Engine, err, to_js};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Balance {
    /// Spendable now (Orchard + Ironwood, as ZApp counts it).
    spendable: u64,
    /// The wallet's own change on its way back.
    change: u64,
    /// Received, not spendable yet (10 confirmations).
    pending: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    chain_tip: u32,
    fully_scanned: u32,
    /// Scan progress, 0…1.
    progress: f64,
    balances: BTreeMap<String, Balance>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Tx {
    /// As stored; explorers show it byte-reversed.
    txid: String,
    mined_height: Option<u32>,
    tx_index: Option<u32>,
    expired_unmined: bool,
    /// Signed change to the account's balance (negative for a payment, fee included).
    delta: i64,
    fee: Option<i64>,
    block_time: Option<i64>,
    expiry_height: Option<u32>,
    memo_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    to_address: Option<String>,
    to_account: Option<String>,
    from_account: Option<String>,
    value: u64,
    is_change: bool,
    memo: Option<String>,
}

fn memo_text(bytes: Option<Vec<u8>>) -> Option<String> {
    let mb = MemoBytes::from_bytes(&bytes?).ok()?;
    match Memo::try_from(mb).ok()? {
        Memo::Text(t) => Some(t.to_string()).filter(|s| !s.is_empty()),
        _ => None,
    }
}

#[wasm_bindgen]
impl Engine {
    /// Tip, scan progress and every account's balance (ZIP 315 default: 3 confirmations for
    /// the wallet's own change, 10 for what others send).
    pub fn summary(&self) -> Result<JsValue, JsError> {
        let Some(s) = self.db.get_wallet_summary(ConfirmationsPolicy::default()).map_err(err)? else {
            return Ok(JsValue::NULL);
        };
        let p = s.progress().scan();
        let progress = if *p.denominator() == 0 { 1.0 } else { *p.numerator() as f64 / *p.denominator() as f64 };
        let balances = s
            .account_balances()
            .iter()
            .map(|(id, b)| {
                let o = b.orchard_balance();
                let i = b.ironwood_balance();
                (
                    id.expose_uuid().to_string(),
                    Balance {
                        spendable: (o.spendable_value() + i.spendable_value()).map_or(0, u64::from),
                        change: (o.change_pending_confirmation() + i.change_pending_confirmation()).map_or(0, u64::from),
                        pending: (o.value_pending_spendability() + i.value_pending_spendability()).map_or(0, u64::from),
                    },
                )
            })
            .collect();
        to_js(&Summary {
            chain_tip: s.chain_tip_height().into(),
            fully_scanned: s.fully_scanned_height().into(),
            progress,
            balances,
        })
    }

    /// An account's transactions, newest first (unmined at the top).
    pub fn transactions(&self, account: &str) -> Result<JsValue, JsError> {
        let conn = self.db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT txid, mined_height, tx_index, expired_unmined, account_balance_delta, fee_paid,
                        block_time, expiry_height, memo_count
                 FROM v_transactions WHERE account_uuid = ?
                 ORDER BY IFNULL(mined_height, 4294967295) DESC, IFNULL(tx_index, 0) DESC",
            )
            .map_err(err)?;
        let id = uuid::Uuid::parse_str(account).map_err(err)?;
        let rows = stmt
            .query_map(params![id], |r| {
                Ok(Tx {
                    txid: hex::encode(r.get::<_, Vec<u8>>(0)?),
                    mined_height: r.get(1)?,
                    tx_index: r.get(2)?,
                    expired_unmined: r.get::<_, Option<bool>>(3)?.unwrap_or(false),
                    delta: r.get(4)?,
                    fee: r.get(5)?,
                    block_time: r.get(6)?,
                    expiry_height: r.get(7)?,
                    memo_count: r.get::<_, Option<u32>>(8)?.unwrap_or(0),
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        to_js(&rows)
    }

    /// Who a transaction paid, with each output's message.
    pub fn outputs(&self, txid_hex: &str) -> Result<JsValue, JsError> {
        let conn = self.db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT to_address, to_account_uuid, from_account_uuid, value, is_change, memo
                 FROM v_tx_outputs WHERE txid = ? ORDER BY output_pool, output_index",
            )
            .map_err(err)?;
        let txid = hex::decode(txid_hex).map_err(err)?;
        let rows = stmt
            .query_map(params![txid], |r| {
                Ok(Output {
                    to_address: r.get(0)?,
                    to_account: r.get::<_, Option<uuid::Uuid>>(1)?.map(|u| u.to_string()),
                    from_account: r.get::<_, Option<uuid::Uuid>>(2)?.map(|u| u.to_string()),
                    value: r.get::<_, i64>(3)? as u64,
                    is_change: r.get::<_, Option<bool>>(4)?.unwrap_or(false),
                    memo: memo_text(r.get(5)?),
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        to_js(&rows)
    }

    /// A stored transaction's bytes, to (re)submit it.
    pub fn raw_transaction(&self, txid_hex: &str) -> Result<Option<Vec<u8>>, JsError> {
        let txid = hex::decode(txid_hex).map_err(err)?;
        self.db
            .conn()
            .query_row("SELECT raw FROM transactions WHERE txid = ?", params![txid], |r| r.get::<_, Option<Vec<u8>>>(0))
            .optional()
            .map(Option::flatten)
            .map_err(err)
    }
}
