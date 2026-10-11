//! Syncing, as `zcash_client_backend::sync::run` does it, with the network on the JavaScript
//! side: it fetches from lightwalletd (gRPC over fetch) and passes the protobuf bytes here.

use std::convert::Infallible;

use prost::Message;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use zcash_client_backend::{
    data_api::{
        chain::{error::Error as ChainError, scan_cached_blocks, BlockSource, CommitmentTreeRoot},
        scanning::ScanPriority,
        TransactionDataRequest, TransactionStatus, WalletCommitmentTrees, WalletRead, WalletWrite,
    },
    proto::{
        compact_formats::CompactBlock,
        service::{SubtreeRoot, TreeState},
    },
};
use zcash_client_sqlite::wallet::init::WalletMigrator;
use zcash_primitives::{
    merkle_tree::HashSer,
    transaction::{Transaction, TxId},
};
use zcash_protocol::consensus::{BlockHeight, BranchId};

use crate::{db::Engine, err, to_js};

/// Blocks fetched for one scan, in height order.
struct Blocks(Vec<CompactBlock>);

impl BlockSource for Blocks {
    type Error = Infallible;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), ChainError<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), ChainError<WalletErrT, Self::Error>>,
    {
        let from = from_height.map_or(0, u64::from);
        for block in self.0.iter().filter(|b| b.height >= from).take(limit.unwrap_or(usize::MAX)) {
            with_block(block.clone())?;
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct Range {
    start: u32,
    end: u32,
    priority: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanOutcome {
    /// The chain forked under the wallet: it was rewound to this height, re-sync from there.
    rewound_to: Option<u32>,
    /// Scanning these blocks made a higher-priority range appear: ask for the ranges again.
    ranges_changed: bool,
}

#[derive(Serialize)]
struct DataRequest {
    kind: &'static str,
    /// Byte order as stored (not the reversed hex explorers show).
    txid: String,
}

fn roots<H: HashSer>(list: &js_sys::Array) -> Result<Vec<CommitmentTreeRoot<H>>, JsError> {
    list.iter()
        .map(|v| {
            let bytes = js_sys::Uint8Array::new(&v).to_vec();
            let r = SubtreeRoot::decode(&bytes[..]).map_err(err)?;
            let hash = H::read(&r.root_hash[..]).map_err(err)?;
            Ok(CommitmentTreeRoot::from_parts(BlockHeight::from_u32(r.completing_block_height as u32), hash))
        })
        .collect()
}

#[wasm_bindgen]
impl Engine {
    /// Stores the note commitment tree's subtree roots (GetSubtreeRoots); `protocol` 0 Sapling,
    /// 1 Orchard, 2 Ironwood, as lightwalletd numbers them.
    pub fn put_subtree_roots(&mut self, protocol: u8, start_index: u64, list: js_sys::Array) -> Result<(), JsError> {
        match protocol {
            0 => self.db.put_sapling_subtree_roots(start_index, &roots::<sapling::Node>(&list)?).map_err(err),
            1 => self
                .db
                .put_orchard_subtree_roots(start_index, &roots::<orchard::tree::MerkleHashOrchard>(&list)?)
                .map_err(err),
            2 => self
                .db
                .put_ironwood_subtree_roots(start_index, &roots::<orchard::tree::MerkleHashOrchard>(&list)?)
                .map_err(err),
            _ => Err(err("unknown shielded protocol")),
        }
    }

    pub fn update_chain_tip(&mut self, height: u32) -> Result<(), JsError> {
        self.db.update_chain_tip(BlockHeight::from_u32(height)).map_err(err)
    }

    /// What to scan next, most urgent first.
    pub fn suggest_scan_ranges(&self) -> Result<JsValue, JsError> {
        let ranges: Vec<Range> = self
            .db
            .suggest_scan_ranges()
            .map_err(err)?
            .into_iter()
            .map(|r| Range {
                start: r.block_range().start.into(),
                end: r.block_range().end.into(),
                priority: match r.priority() {
                    ScanPriority::Ignored => 0,
                    ScanPriority::Scanned => 10,
                    ScanPriority::Historic => 20,
                    ScanPriority::OpenAdjacent => 30,
                    ScanPriority::FoundNote => 40,
                    ScanPriority::ChainTip => 50,
                    ScanPriority::Verify => 60,
                },
            })
            .collect();
        to_js(&ranges)
    }

    /// Scans `blocks` (CompactBlock protobufs, from `start`) on top of `from_state` (the
    /// TreeState of block `start - 1`). On a chain fork it rewinds 10 blocks, as the SDK does.
    pub fn scan_blocks(&mut self, start: u32, from_state: &[u8], blocks: js_sys::Array, priority: u8) -> Result<JsValue, JsError> {
        let state = TreeState::decode(from_state).map_err(err)?.to_chain_state().map_err(err)?;
        let blocks = blocks
            .iter()
            .map(|v| CompactBlock::decode(&js_sys::Uint8Array::new(&v).to_vec()[..]).map_err(err))
            .collect::<Result<Vec<_>, _>>()?;
        let count = blocks.len();
        let source = Blocks(blocks);
        let result = scan_cached_blocks(&self.db.params().clone(), &source, &mut self.db, BlockHeight::from_u32(start), &state, count);
        let outcome = match result {
            Err(ChainError::Scan(e)) if e.is_continuity_error() => {
                let to = e.at_height().saturating_sub(10);
                let rewound = self.db.truncate_to_height(to).map_err(err)?;
                ScanOutcome { rewound_to: Some(rewound.into()), ranges_changed: true }
            }
            Ok(_) => {
                let first = self.db.suggest_scan_ranges().map_err(err)?.into_iter().next();
                let mine = scan_priority(priority);
                ScanOutcome { rewound_to: None, ranges_changed: first.is_some_and(|r| r.priority() > mine) }
            }
            Err(e) => return Err(err(e)),
        };
        to_js(&outcome)
    }

    /// Height scanned without gaps from the earliest birthday, or 0.
    pub fn fully_scanned_height(&self) -> Result<u32, JsError> {
        Ok(self.db.block_fully_scanned().map_err(err)?.map_or(0, |m| m.block_height().into()))
    }

    /// Transactions to look up in full (memos, sent details) or to check the status of.
    pub fn data_requests(&self) -> Result<JsValue, JsError> {
        let list: Vec<DataRequest> = self
            .db
            .transaction_data_requests()
            .map_err(err)?
            .into_iter()
            .filter_map(|r| match r {
                TransactionDataRequest::GetStatus(t) => Some(DataRequest { kind: "status", txid: hex::encode(t.as_ref()) }),
                TransactionDataRequest::Enhancement(t) => Some(DataRequest { kind: "enhance", txid: hex::encode(t.as_ref()) }),
                // Transparent address history: ZApp's wallets receive on shielded addresses only.
                _ => None,
            })
            .collect();
        to_js(&list)
    }

    /// A full transaction from lightwalletd (GetTransaction): decrypts what is ours and stores
    /// it. `mined_height` 0 while in the mempool.
    pub fn decrypt_and_store(&mut self, raw: &[u8], mined_height: u32) -> Result<(), JsError> {
        let tx = Transaction::read(raw, BranchId::Sapling).map_err(err)?;
        let h = (mined_height > 0).then(|| BlockHeight::from_u32(mined_height));
        let params = self.db.params().clone();
        zcash_client_backend::data_api::wallet::decrypt_and_store_transaction(&params, &mut self.db, &tx, h).map_err(err)
    }

    /// `height` > 0: mined there; 0: not in the main chain; -1: the server doesn't know it.
    pub fn set_transaction_status(&mut self, txid_hex: &str, height: i64) -> Result<(), JsError> {
        let txid = txid_from_hex(txid_hex)?;
        let status = match height {
            h if h > 0 => TransactionStatus::Mined(BlockHeight::from_u32(h as u32)),
            0 => TransactionStatus::NotInMainChain,
            _ => TransactionStatus::TxidNotRecognized,
        };
        self.db.set_transaction_status(txid, status).map_err(err)
    }

    /// Re-runs migrations (after an engine update), as the SDK does on every open.
    pub fn migrate(&mut self) -> Result<(), JsError> {
        WalletMigrator::new().init_or_migrate(&mut self.db).map_err(err)
    }
}

fn scan_priority(p: u8) -> ScanPriority {
    match p {
        60 => ScanPriority::Verify,
        50 => ScanPriority::ChainTip,
        40 => ScanPriority::FoundNote,
        30 => ScanPriority::OpenAdjacent,
        20 => ScanPriority::Historic,
        10 => ScanPriority::Scanned,
        _ => ScanPriority::Ignored,
    }
}

pub(crate) fn txid_from_hex(s: &str) -> Result<TxId, JsError> {
    let b: [u8; 32] = hex::decode(s).map_err(err)?.try_into().map_err(|_| err("txid must be 32 bytes"))?;
    Ok(TxId::from_bytes(b))
}
