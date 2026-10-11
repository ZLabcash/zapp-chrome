//! The wallet database: SQLite in the browser's private file system (OPFS), one per network,
//! opened once by the extension's engine worker.

use rand_core::OsRng;
use rusqlite::Connection;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use zcash_client_backend::{
    data_api::{Account, AccountBirthday, AccountPurpose, WalletRead, WalletWrite, Zip32Derivation},
    keys::UnifiedFullViewingKey,
    proto::service::TreeState,
};
use zcash_client_sqlite::{wallet::init::WalletMigrator, AccountUuid, WalletDb};
use zcash_protocol::consensus::Network;
use zip32::fingerprint::SeedFingerprint;

use crate::{err, network, to_js, JsClock};

pub(crate) type Db = WalletDb<Connection, Network, JsClock, OsRng>;

#[wasm_bindgen]
pub struct Engine {
    pub(crate) db: Db,
    pub(crate) network: Network,
}

#[derive(Serialize)]
struct AccountRow {
    uuid: String,
    name: Option<String>,
    ufvk: Option<String>,
    birthday: u32,
}

pub(crate) fn uuid(s: &str) -> Result<AccountUuid, JsError> {
    Ok(AccountUuid::from_uuid(uuid::Uuid::parse_str(s).map_err(err)?))
}

#[wasm_bindgen]
impl Engine {
    /// Opens (creating or migrating) the wallet database of `network_id` (0 mainnet, 1 testnet).
    /// Must run in a dedicated worker: OPFS sync access handles only exist there.
    pub async fn open(network_id: u8) -> Result<Engine, JsError> {
        use sqlite_wasm_vfs::sahpool::{install, OpfsSAHPoolCfg};
        let cfg = OpfsSAHPoolCfg { directory: "zapp".into(), ..Default::default() };
        install::<sqlite_wasm_rs::WasmOsCallback>(&cfg, true).await.map_err(err)?;
        let network = network(network_id);
        let file = if network_id == 1 { "/zapp-test.db" } else { "/zapp-main.db" };
        let mut db = WalletDb::for_path(file, network, JsClock, OsRng).map_err(err)?;
        WalletMigrator::new().init_or_migrate(&mut db).map_err(err)?;
        Ok(Engine { db, network })
    }

    /// The accounts: one per wallet, found by its viewing key.
    pub fn accounts(&self) -> Result<JsValue, JsError> {
        let mut rows = vec![];
        for id in self.db.get_account_ids().map_err(err)? {
            let Some(a) = self.db.get_account(id).map_err(err)? else { continue };
            let birthday = self.db.get_account_birthday(id).map_err(err)?;
            rows.push(AccountRow {
                uuid: id.expose_uuid().to_string(),
                name: a.name().map(str::to_owned),
                ufvk: a.ufvk().map(|k| k.encode(&self.network)),
                birthday: birthday.into(),
            });
        }
        to_js(&rows)
    }

    /// Imports a wallet by its viewing key, as ZApp does for both kinds: "spending" with the
    /// seed fingerprint and ZIP 32 index, so PCZT spends carry the path a signer needs.
    /// `treestate` is lightwalletd's TreeState at the block before the birthday.
    #[allow(clippy::too_many_arguments)]
    pub fn import_account(
        &mut self,
        name: &str,
        ufvk: &str,
        treestate: &[u8],
        seed_fingerprint: &[u8],
        account_index: u32,
        key_source: &str,
    ) -> Result<String, JsError> {
        use prost::Message;
        let ufvk = UnifiedFullViewingKey::decode(&self.network, ufvk).map_err(err)?;
        let treestate = TreeState::decode(treestate).map_err(err)?;
        let birthday = AccountBirthday::from_treestate(treestate, None).map_err(|_| err("invalid tree state"))?;
        let fp: [u8; 32] = seed_fingerprint.try_into().map_err(|_| err("seed fingerprint must be 32 bytes"))?;
        let index = zip32::AccountId::try_from(account_index).map_err(|_| err("bad account index"))?;
        let purpose = AccountPurpose::Spending {
            derivation: Some(Zip32Derivation::new(SeedFingerprint::from_bytes(fp), index)),
        };
        let account = self
            .db
            .import_account_ufvk(name, &ufvk, &birthday, purpose, Some(key_source))
            .map_err(err)?;
        Ok(account.id().expose_uuid().to_string())
    }

    pub fn delete_account(&mut self, uuid_str: &str) -> Result<(), JsError> {
        self.db.delete_account(uuid(uuid_str)?).map_err(err)
    }

    /// Erases everything (the last wallet removed).
    pub fn wipe(&mut self) -> Result<(), JsError> {
        for id in self.db.get_account_ids().map_err(err)? {
            self.db.delete_account(id).map_err(err)?;
        }
        Ok(())
    }
}
