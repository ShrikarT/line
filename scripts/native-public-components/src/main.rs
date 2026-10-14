//! Read-only sizes of actual public transactions. Never reads proof preimages,
//! keys, wallet state or private journals; prints sizes and field names only.
use midnight_base_crypto::signatures::Signature;
use midnight_ledger::structure::{ContractAction, ProofMarker, Transaction};
use midnight_serialize::{Serializable, tagged_deserialize, tagged_serialize};
use midnight_storage::{db::InMemoryDB, storable::Storable};
use midnight_transient_crypto::commitment::PureGeneratorPedersen;
use serde_json::{json, Value};
use std::{env, fs, process::ExitCode};

fn size<T: Serializable>(value: &T) -> usize {
    let mut bytes = Vec::new(); value.serialize(&mut bytes).expect("In-memory public serialization");
    assert_eq!(bytes.len(), value.serialized_size(), "Public size hint differs from encoding");
    bytes.len()
}

fn root_shape<T: Storable<InMemoryDB>>(value: &T) -> Value {
    let mut data = Vec::new(); value.to_binary_repr(&mut data).expect("In-memory public serialization");
    json!({"rootDataBytes":data.len(),"children":value.children().iter().map(size).collect::<Vec<_>>()})
}

fn analyze() -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 1 { return Err("One public transaction path required".into()); }
    let raw = fs::read(&args[0])?;
    if raw.len() > 16 * 1024 * 1024 { return Err("Public artifact size limit".into()); }
    let mut input = &raw[..];
    let tx: Transaction<Signature, ProofMarker, PureGeneratorPedersen, InMemoryDB> = tagged_deserialize(&mut input)?;
    if !input.is_empty() { return Err("Trailing bytes".into()); }
    let Transaction::Standard(stx) = &tx else { return Err("Standard transaction required".into()); };
    let mut roundtrip = Vec::new(); tagged_serialize(&tx, &mut roundtrip)?;
    if roundtrip != raw { return Err("Noncanonical roundtrip".into()); }
    let mut intents = Vec::new();
    for (segment_id, intent) in stx.intents.clone().into_iter() {
        let mut calls = Vec::new();
        for action in intent.actions.iter_deref() {
            let ContractAction::Call(call) = action else { return Err("Contract call required".into()); };
            calls.push(json!({
                "call":size(&call), "action":size(&action),
                "address":size(&call.address), "entryPoint":size(&call.entry_point),
                "guaranteedTranscript":size(&call.guaranteed_transcript),
                "fallibleTranscript":size(&call.fallible_transcript),
                "communicationCommitment":size(&call.communication_commitment),
                "proof":size(&call.proof),
                "fallibleDetails":call.fallible_transcript.iter().map(|t| json!({
                    "root":root_shape(&**t), "gas":size(&t.gas),"effects":size(&t.effects),
                    "program":size(&t.program),"version":size(&t.version),
                    "ops":t.program.iter_deref().enumerate().map(|(index,op)| json!({"index":index,"bytes":size(&op),"root":root_shape(op)})).collect::<Vec<_>>()
                })).collect::<Vec<_>>(),
                "guaranteedDetails":call.guaranteed_transcript.iter().map(|t| json!({
                    "root":root_shape(&**t),"gas":size(&t.gas),"effects":size(&t.effects),"program":size(&t.program),"version":size(&t.version)
                })).collect::<Vec<_>>()
            }));
        }
        intents.push(json!({"segmentId":segment_id,"intent":size(&intent),
            "guaranteedUnshieldedOffer":size(&intent.guaranteed_unshielded_offer),
            "fallibleUnshieldedOffer":size(&intent.fallible_unshielded_offer),
            "actions":size(&intent.actions),"dustActions":size(&intent.dust_actions),
            "ttl":size(&intent.ttl),"binding":size(&intent.binding_commitment),"calls":calls}));
    }
    Ok(json!({"schema":"line-native-public-component-sizes/v1","canonicalPublicRoundtrip":true,
        "transaction":size(&tx),"taggedTransaction":raw.len(),"standardTransaction":size(&stx),
        "networkId":size(&stx.network_id),"intentsMap":size(&stx.intents),
        "guaranteedCoins":size(&stx.guaranteed_coins),"fallibleCoins":size(&stx.fallible_coins),
        "bindingRandomness":size(&stx.binding_randomness),"intents":intents,
        "cryptographicVerificationPerformed":false,"networkSubmitted":false}))
}
fn main() -> ExitCode {
    let result = std::thread::Builder::new().stack_size(64 * 1024 * 1024).spawn(analyze).expect("Owned analysis worker").join();
    match result {
        Ok(Ok(value)) => { println!("{value}"); ExitCode::SUCCESS }
        _ => { eprintln!("PUBLIC_DECOMPOSITION_REJECTED"); ExitCode::FAILURE }
    }
}
