//! Sending, as ZApp does it:
//!
//! - A Flipper wallet: propose → PCZT → the Flipper checks and signs (`keys::sign_request`,
//!   `keys::apply_signatures`) while this side proves → combine, extract, store → broadcast.
//! - A phone wallet: propose → the seed is unsealed for this one call → build, prove, sign and
//!   store → broadcast.

use std::{convert::Infallible, num::NonZeroUsize};

use pczt::{
    roles::{combiner::Combiner, prover::Prover},
    Pczt,
};
use prost::Message;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use zcash_client_backend::{
    data_api::wallet::{
        create_pczt_from_proposal, create_proposed_transactions, extract_and_store_transaction_from_pczt,
        input_selection::{GreedyInputSelector, SpendPolicy},
        propose_transfer, ConfirmationsPolicy, SpendingKeys,
    },
    fees::{zip317::MultiOutputChangeStrategy, DustOutputPolicy, SplitPolicy, StandardFeeRule},
    keys::UnifiedSpendingKey,
    proto::proposal::Proposal,
    wallet::OvkPolicy,
    zip321::TransactionRequest,
};
use zcash_primitives::transaction::builder::BundlePadding;
use sapling::circuit::{OutputParameters, SpendParameters};
use zcash_protocol::{consensus::BranchId, value::Zatoshis, ShieldedPool};
use zeroize::Zeroize;

use crate::{db::uuid, db::Engine, err, to_js};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Proposed {
    /// The proposal, protobuf-encoded (to build from once the user confirms).
    proposal: Vec<u8>,
    fee: u64,
    /// Whether building it needs the Sapling parameters (a Sapling recipient or note).
    needs_sapling: bool,
}

/// The SDK's ZIP 317 setup: change to Orchard, split into up to 4 notes of ≥ 0.1 ZEC.
fn zip317<DbT>() -> (MultiOutputChangeStrategy<StandardFeeRule, DbT>, GreedyInputSelector<DbT>) {
    (
        MultiOutputChangeStrategy::new(
            StandardFeeRule::Zip317,
            None,
            ShieldedPool::Orchard,
            DustOutputPolicy::default(),
            SplitPolicy::with_min_output_value(NonZeroUsize::new(4).unwrap(), Zatoshis::const_from_u64(1000_0000)),
        ),
        GreedyInputSelector::new(),
    )
}

/// The Sapling parameters (sapling-spend.params, sapling-output.params, from download.z.cash),
/// checked against their hashes.
fn sapling_prover(spend: Option<Vec<u8>>, output: Option<Vec<u8>>) -> Result<(SpendParameters, OutputParameters), JsError> {
    match (spend, output) {
        (Some(s), Some(o)) => {
            let p = zcash_proofs::parse_parameters(&s[..], &o[..], None);
            Ok((p.spend_params, p.output_params))
        }
        _ => Err(err("SAPLING_PARAMS_NEEDED")),
    }
}

#[wasm_bindgen]
impl Engine {
    /// Proposes paying a ZIP 321 request (one payment or several, each with its memo) from
    /// `account`, with the SDK's default confirmations policy.
    pub fn propose(&mut self, account: &str, uri: &str) -> Result<JsValue, JsError> {
        let account = uuid(account)?;
        let request = TransactionRequest::from_uri(uri).map_err(|e| err(format!("{e:?}")))?;
        let (change, inputs) = zip317();
        let params = self.db.params().clone();
        let proposal = propose_transfer::<_, _, _, _, Infallible>(
            &mut self.db,
            &params,
            account,
            &inputs,
            &change,
            request,
            ConfirmationsPolicy::default(),
            &SpendPolicy::default(),
            None,
            None,
        )
        .map_err(err)?;
        let needs_sapling = proposal.steps().iter().any(|s| {
            s.shielded_inputs().is_some_and(|i| i.notes().iter().any(|n| n.note().pool() == ShieldedPool::Sapling))
                || s.balance().proposed_change().iter().any(|c| c.output_pool() == zcash_protocol::PoolType::SAPLING)
                || s.payment_pools().values().any(|p| *p == zcash_protocol::PoolType::SAPLING)
        });
        let fee = proposal.steps().iter().map(|s| u64::from(s.balance().fee_required())).sum();
        to_js(&Proposed { proposal: Proposal::from_standard_proposal(&proposal).encode_to_vec(), fee, needs_sapling })
    }

    /// The PCZT of a one-step proposal (for the Flipper to sign).
    pub fn create_pczt(&mut self, account: &str, proposal: &[u8]) -> Result<Vec<u8>, JsError> {
        let account = uuid(account)?;
        let params = self.db.params().clone();
        let proposal = Proposal::decode(proposal)
            .map_err(err)?
            .try_into_standard_proposal(&params, &self.db)
            .map_err(err)?;
        if proposal.steps().len() != 1 {
            return Err(err("Multi-step proposals are not yet supported for PCZT generation."));
        }
        let pczt = create_pczt_from_proposal::<_, _, Infallible, _, Infallible, _>(
            &mut self.db,
            &params,
            account,
            OvkPolicy::Sender,
            &proposal,
            None,
            BundlePadding::DEFAULT,
        )
        .map_err(err)?;
        pczt.serialize().map_err(|e| err(format!("{e:?}")))
    }

    /// Combines the proven and the signed PCZT, extracts the transaction and stores it as
    /// sent. Returns the txid (as stored); its bytes then come from `raw_transaction`.
    pub fn extract_and_store(&mut self, proven: &[u8], signed: &[u8]) -> Result<String, JsError> {
        let a = Pczt::parse(proven).map_err(|e| err(format!("{e:?}")))?;
        let b = Pczt::parse(signed).map_err(|e| err(format!("{e:?}")))?;
        let pczt = Combiner::new(vec![a, b]).combine().map_err(|e| err(format!("{e:?}")))?;
        let txid = extract_and_store_transaction_from_pczt::<_, ()>(&mut self.db, pczt, None, None)
            .map_err(|e| err(format!("{e:?}")))?;
        Ok(hex::encode(txid.as_ref()))
    }

    /// A phone wallet's payment: the seed (64 bytes) is used for this call and wiped.
    pub fn create_transactions(
        &mut self,
        proposal: &[u8],
        mut seed: Vec<u8>,
        account_index: u32,
        spend_params: Option<Vec<u8>>,
        output_params: Option<Vec<u8>>,
        needs_sapling: bool,
    ) -> Result<JsValue, JsError> {
        let params = self.db.params().clone();
        let result = (|| {
            let index = zip32::AccountId::try_from(account_index).map_err(|_| err("bad account index"))?;
            let usk = UnifiedSpendingKey::from_seed(&params, &seed, index).map_err(err)?;
            let proposal = Proposal::decode(proposal)
                .map_err(err)?
                .try_into_standard_proposal(&params, &self.db)
                .map_err(err)?;
            let keys = SpendingKeys::from_unified_spending_key(usk);
            let txids = if needs_sapling {
                let (spend, output) = sapling_prover(spend_params, output_params)?;
                create_proposed_transactions::<_, _, Infallible, _, Infallible, _>(
                    &mut self.db, &params, &spend, &output, &keys, OvkPolicy::Sender, &proposal, None,
                )
            } else {
                create_proposed_transactions::<_, _, Infallible, _, Infallible, _>(
                    &mut self.db, &params, &NoSapling, &NoSapling, &keys, OvkPolicy::Sender, &proposal, None,
                )
            }
            .map_err(err)?;
            Ok::<_, JsError>(txids.into_iter().map(|t| hex::encode(t.as_ref())).collect::<Vec<_>>())
        })();
        seed.zeroize();
        to_js(&result?)
    }
}

/// Adds the zero-knowledge proofs to a PCZT (Orchard and Ironwood with Halo 2, no parameters;
/// Sapling with the parameters, when the transaction has any).
#[wasm_bindgen]
pub fn prove_pczt(pczt: &[u8], spend_params: Option<Vec<u8>>, output_params: Option<Vec<u8>>) -> Result<Vec<u8>, JsError> {
    let pczt = Pczt::parse(pczt).map_err(|e| err(format!("{e:?}")))?;
    let branch = BranchId::try_from(*pczt.global().consensus_branch_id()).map_err(|_| err("invalid consensus branch"))?;
    let circuit = |pool| {
        zcash_primitives::transaction::components::orchard::bundle_version_for_branch(branch, pool).map(|v| v.circuit_version())
    };
    let mut prover = Prover::new(pczt);
    if prover.requires_orchard_proof() {
        let v = circuit(orchard::ValuePool::Orchard).ok_or_else(|| err("no Orchard pool at this height"))?;
        prover = prover
            .create_orchard_proof(zcash_primitives::transaction::builder::cached_orchard_proving_key(v))
            .map_err(|e| err(format!("{e:?}")))?;
    }
    if prover.requires_ironwood_proof() {
        let v = circuit(orchard::ValuePool::Ironwood).ok_or_else(|| err("no Ironwood pool at this height"))?;
        prover = prover
            .create_ironwood_proof(zcash_primitives::transaction::builder::cached_orchard_proving_key(v))
            .map_err(|e| err(format!("{e:?}")))?;
    }
    if prover.requires_sapling_proofs() {
        let (spend, output) = sapling_prover(spend_params, output_params)?;
        prover = prover.create_sapling_proofs(&spend, &output).map_err(|e| err(format!("{e:?}")))?;
    }
    prover.finish().serialize().map_err(|e| err(format!("{e:?}")))
}

/// The Sapling prover of a transaction without Sapling: the builder never asks it for a proof
/// (`propose` reports when the parameters are needed, and they are passed then).
struct NoSapling;

impl sapling::prover::SpendProver for NoSapling {
    type Proof = sapling::bundle::GrothProofBytes;

    fn prepare_circuit(
        proof_generation_key: sapling::ProofGenerationKey,
        diversifier: sapling::Diversifier,
        rseed: sapling::Rseed,
        value: sapling::value::NoteValue,
        alpha: jubjub::Fr,
        rcv: sapling::value::ValueCommitTrapdoor,
        anchor: bls12_381::Scalar,
        merkle_path: sapling::MerklePath,
    ) -> Option<sapling::circuit::Spend> {
        <SpendParameters as sapling::prover::SpendProver>::prepare_circuit(
            proof_generation_key, diversifier, rseed, value, alpha, rcv, anchor, merkle_path,
        )
    }

    fn create_proof<R: rand_core::RngCore>(&self, _: sapling::circuit::Spend, _: &mut R) -> Self::Proof {
        unreachable!("Sapling spend without the Sapling parameters")
    }

    fn encode_proof(proof: Self::Proof) -> sapling::bundle::GrothProofBytes {
        proof
    }
}

impl sapling::prover::OutputProver for NoSapling {
    type Proof = sapling::bundle::GrothProofBytes;

    fn prepare_circuit(
        esk: &sapling::keys::EphemeralSecretKey,
        payment_address: sapling::PaymentAddress,
        rcm: jubjub::Fr,
        value: sapling::value::NoteValue,
        rcv: sapling::value::ValueCommitTrapdoor,
    ) -> sapling::circuit::Output {
        <OutputParameters as sapling::prover::OutputProver>::prepare_circuit(esk, payment_address, rcm, value, rcv)
    }

    fn create_proof<R: rand_core::RngCore>(&self, _: sapling::circuit::Output, _: &mut R) -> Self::Proof {
        unreachable!("Sapling output without the Sapling parameters")
    }

    fn encode_proof(proof: Self::Proof) -> sapling::bundle::GrothProofBytes {
        proof
    }
}

/// Builds and proves a 2-action Orchard bundle (an output and a dummy spend), to measure how
/// long a proof takes in this browser. Returns milliseconds: [proving key, proof].
#[wasm_bindgen]
pub fn prove_selftest() -> Result<Vec<f64>, JsError> {
    use orchard::{
        builder::{Builder, BundleType},
        bundle::BundleVersion,
        circuit::{OrchardCircuitVersion, ProvingKey},
        keys::{FullViewingKey, Scope, SpendingKey},
        value::NoteValue,
        Anchor,
    };
    let mut rng = rand_core::OsRng;
    let t0 = js_sys::Date::now();
    let pk = ProvingKey::build(OrchardCircuitVersion::FixedPostNu6_2);
    let t1 = js_sys::Date::now();
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(err)?;
    let sk = SpendingKey::from_zip32_seed(&seed, 133, zip32::AccountId::ZERO).map_err(|e| err(format!("{e:?}")))?;
    let recipient = FullViewingKey::from(&sk).address_at(0u32, Scope::External);
    let version = BundleVersion::orchard_v2();
    let mut builder = Builder::new(BundleType::DEFAULT, version, version.default_flags(), Anchor::empty_tree()).map_err(|e| err(format!("{e:?}")))?;
    builder.add_output(None, recipient, NoteValue::from_raw(5000), [0; 512]).map_err(|e| err(format!("{e:?}")))?;
    let (bundle, _) = builder.build::<i64>(&mut rng).map_err(|e| err(format!("{e:?}")))?.ok_or_else(|| err("empty bundle"))?;
    bundle.create_proof(&pk, &mut rng).map_err(|e| err(format!("{e:?}")))?;
    let t2 = js_sys::Date::now();
    Ok(vec![t1 - t0, t2 - t1])
}
