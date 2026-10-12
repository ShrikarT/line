//! Native IR/preimage evaluation only. No proving parameters, wallet or network.
//! Private preimages arrive on stdin, never on disk or in diagnostic output.
use midnight_ledger::structure::ProofPreimageVersioned;
use midnight_serialize::tagged_deserialize;
use midnight_transient_crypto::{curve::Fr, proofs::ProofPreimage};
use midnight_zkir::IrSource;
use std::{env, fs, io::{self, Read}, panic, process::ExitCode};

fn category(message: &str) -> &'static str {
    let m = message.to_lowercase();
    if m.contains("bit bound") { "bit_bound" }
    else if m.contains("communications commitment") { "communications_commitment" }
    else if m.contains("transcripts not fully consumed") { "transcript_length" }
    else if m.contains("alignment") || m.contains("expected") && m.contains("inputs") { "input_alignment" }
    else if m.contains("point") || m.contains("curve") { "curve_point" }
    else if m.contains("assert") { "assertion" }
    else if m.contains("public transcript") || m.contains("public input") || m.contains("public output") { "public_transcript" }
    else if m.contains("private transcript") || m.contains("private input") { "private_transcript" }
    else { "constraint_or_decode" }
}

fn run() -> Result<(), &'static str> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args.len() > 2 { return Err("usage"); }
    let ir_bytes = fs::read(&args[0]).map_err(|_| "ir_read")?;
    let ir: IrSource = if args[0].ends_with(".zkir") {
        serde_json::from_slice(&ir_bytes).map_err(|_| "ir_decode")?
    } else { tagged_deserialize(&mut &ir_bytes[..]).map_err(|_| "ir_decode")? };
    let mut bytes = Vec::new();
    io::stdin().take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "input_read")?;
    if bytes.is_empty() || bytes.len() > 16 * 1024 * 1024 { return Err("input_bounds"); }
    let mut cursor = &bytes[..];
    let mut preimage = if bytes.starts_with(b"midnight:proof-preimage-versioned:") {
        match tagged_deserialize::<ProofPreimageVersioned>(&mut cursor).map_err(|_| "preimage_decode")? {
            ProofPreimageVersioned::V2(p) => (*p).clone(),
            _ => return Err("preimage_version"),
        }
    } else { tagged_deserialize::<ProofPreimage>(&mut cursor).map_err(|_| "preimage_decode")? };
    if !cursor.is_empty() { return Err("trailing_input"); }
    if args.len() == 2 {
        match args[1].as_str() {
            "--probe-uint8-overflow" if !preimage.private_transcript.is_empty() => {
                // Explicit malicious-input regression, never a valid proof.
                preimage.private_transcript[0] = Fr::from(256u64);
            }
            "--corrupt-communications-commitment" => {
                let (value, random) = preimage.communications_commitment.ok_or("missing_communications")?;
                preimage.communications_commitment = Some((value + Fr::from(1u64), random));
            }
            "--append-private-transcript" => preimage.private_transcript.push(Fr::from(0u64)),
            _ => return Err("probe_usage"),
        }
    }
    let skipped = preimage.check(&ir).map_err(|e| category(&e.to_string()))?;
    println!("{{\"nativePreimageCheckPassed\":true,\"statementBlocks\":{},\"skippedBlocks\":{},\"statementSkipPattern\":{},\"proofGenerated\":false}}", skipped.len(), skipped.iter().filter(|x| x.is_some()).count(), serde_json::to_string(&skipped).map_err(|_| "result_encode")?);
    Ok(())
}
fn main() -> ExitCode {
    // Library panic/error messages may include financial witness values.
    panic::set_hook(Box::new(|_| {}));
    match panic::catch_unwind(run) {
        Ok(Ok(())) => ExitCode::SUCCESS,
        Ok(Err(reason)) => { eprintln!("PREIMAGE_CHECK_REJECTED:{reason}"); ExitCode::FAILURE }
        Err(_) => { eprintln!("PREIMAGE_CHECK_REJECTED:panic"); ExitCode::FAILURE }
    }
}
