//! Independent local verification of public synthetic ledger/transaction bytes.
//! No wallet, signing secrets, proof preimages, network submission or fee funding.
use midnight_base_crypto::{signatures::Signature, time::Timestamp};
use midnight_ledger::{structure::{LedgerState, Transaction, ProofMarker}, verify::{WellFormedStrictness, ProofVerificationMode}};
use midnight_serialize::tagged_deserialize;
use midnight_storage::db::InMemoryDB;
use midnight_transient_crypto::commitment::PureGeneratorPedersen;
use std::{env, fs, process::ExitCode};

fn verify() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 3 { return Err("Usage: line-native-proof-verifier <public-state> <proven-public-tx> <unix-seconds>".into()); }
    let state_bytes = fs::read(&args[0])?;
    let tx_bytes = fs::read(&args[1])?;
    let state: LedgerState<InMemoryDB> = tagged_deserialize(&mut &state_bytes[..])?;
    let tx: Transaction<Signature, ProofMarker, PureGeneratorPedersen, InMemoryDB> = tagged_deserialize(&mut &tx_bytes[..])?;
    let mut strict = WellFormedStrictness::default();
    strict.enforce_balancing = false;
    strict.verify_native_proofs = true;
    strict.verify_contract_proofs = true;
    strict.enforce_limits = true;
    strict.verify_signatures = true;
    strict.proof_verification_mode = ProofVerificationMode::Real;
    tx.well_formed(&state, strict, Timestamp::from_secs(args[2].parse()?))
        .map_err(|error| format!("NATIVE_WELL_FORMED_REJECTED: {error}"))?;
    Ok(())
}
fn main() -> ExitCode {
    match verify() {
        Ok(()) => { println!("CRYPTOGRAPHIC_VERIFICATION_PASSED; FEE_BALANCING_DISABLED; NO_NETWORK"); ExitCode::SUCCESS }
        Err(error) => { eprintln!("VERIFICATION_REJECTED: {error}"); ExitCode::FAILURE }
    }
}
