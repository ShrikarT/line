//! Real local proving with the pinned Midnight IR, keys and checked public CRS.
//! The stdin envelope is: overwrite flag, optional 32-byte LE Fr, preimage.
//! Only tagged public proof bytes go to stdout; errors never include witnesses.
use midnight_base_crypto::data_provider::{FetchMode, MidnightDataProvider, OutputMode};
use midnight_ledger::structure::ProofPreimageVersioned;
use midnight_serialize::{tagged_deserialize, tagged_serialize};
use midnight_transient_crypto::{curve::Fr, proofs::{KeyLocation, ProofPreimage, ProvingKeyMaterial, Resolver}};
use midnight_zkir::IrSource;
use std::{env, fs, io::{self, Read, Write}, panic, path::PathBuf, process::ExitCode};

struct Files { dir: PathBuf, name: String }
impl Resolver for Files {
    async fn resolve_key(&self, key: KeyLocation) -> io::Result<Option<ProvingKeyMaterial>> {
        if key.0.as_ref() != self.name { return Ok(None); }
        let material = ProvingKeyMaterial {
            prover_key: fs::read(self.dir.join("keys").join(format!("{}.prover", self.name)))?,
            verifier_key: fs::read(self.dir.join("keys").join(format!("{}.verifier", self.name)))?,
            ir_source: fs::read(self.dir.join("zkir").join(format!("{}.bzkir", self.name)))?,
        };
        eprintln!("LOCAL_PROVER_STAGE:key_material_loaded");
        Ok(Some(material))
    }
}
fn run() -> Result<(), &'static str> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 2 || args[1].is_empty() || !args[1].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return Err("usage");
    }
    // Do not fall back to the operator's global parameter cache or source.
    if env::var_os("MIDNIGHT_PP").is_none() || env::var("MIDNIGHT_PARAM_SOURCE").ok().as_deref() != Some("https://srs.midnight.network/") {
        return Err("parameter_configuration");
    }
    let resolver = Files { dir: PathBuf::from(&args[0]), name: args[1].clone() };
    let mut bytes = Vec::new();
    io::stdin().take(16 * 1024 * 1024 + 34).read_to_end(&mut bytes).map_err(|_| "input_read")?;
    if bytes.len() < 2 || bytes.len() > 16 * 1024 * 1024 + 33 { return Err("input_bounds"); }
    let (overwrite, mut cursor) = match bytes[0] {
        0 => (None, &bytes[1..]),
        1 if bytes.len() > 33 => (Some(Fr::from_le_bytes(&bytes[1..33]).ok_or("binding_decode")?), &bytes[33..]),
        _ => return Err("envelope_decode"),
    };
    let mut preimage = if cursor.starts_with(b"midnight:proof-preimage-versioned:") {
        match tagged_deserialize::<ProofPreimageVersioned>(&mut cursor).map_err(|_| "preimage_decode")? {
            ProofPreimageVersioned::V2(p) => (*p).clone(),
            _ => return Err("preimage_version"),
        }
    } else { tagged_deserialize::<ProofPreimage>(&mut cursor).map_err(|_| "preimage_decode")? };
    if !cursor.is_empty() { return Err("trailing_input"); }
    if preimage.key_location.0.as_ref() != resolver.name { return Err("key_location"); }
    if let Some(binding) = overwrite { preimage.binding_input = binding; }
    eprintln!("LOCAL_PROVER_STAGE:preimage_decoded");
    let params = MidnightDataProvider::new(FetchMode::OnDemand, OutputMode::Log, vec![]).map_err(|_| "parameter_provider")?;
    let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).thread_stack_size(16 * 1024 * 1024).enable_all().build().map_err(|_| "runtime")?;
    eprintln!("LOCAL_PROVER_STAGE:provider_ready");
    let (proof, _) = runtime.block_on(preimage.prove::<IrSource>(rand::rngs::OsRng, &params, &resolver)).map_err(|_| "proof_generation_or_self_verification")?;
    eprintln!("LOCAL_PROVER_STAGE:proof_self_verified");
    let mut output = Vec::new();
    tagged_serialize(&proof, &mut output).map_err(|_| "proof_encode")?;
    io::stdout().write_all(&output).map_err(|_| "proof_write")?;
    Ok(())
}
fn main() -> ExitCode {
    panic::set_hook(Box::new(|_| {}));
    // The pinned proving path exhausted Windows' default main-thread stack.
    // Bound the extra stack to this owned helper, without changing global env.
    let thread = match std::thread::Builder::new().name("line-local-proof".into()).stack_size(64 * 1024 * 1024).spawn(|| panic::catch_unwind(run)) {
        Ok(thread) => thread,
        Err(_) => { eprintln!("LOCAL_PROVER_REJECTED:worker_start"); return ExitCode::FAILURE }
    };
    match thread.join() {
        Ok(Ok(Ok(()))) => ExitCode::SUCCESS,
        Ok(Ok(Err(reason))) => { eprintln!("LOCAL_PROVER_REJECTED:{reason}"); ExitCode::FAILURE }
        _ => { eprintln!("LOCAL_PROVER_REJECTED:panic"); ExitCode::FAILURE }
    }
}
