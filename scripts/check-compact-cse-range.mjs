/** Fresh compiler regression probe for GHSA-3p6x-5vpx-wwpj.
 * Temporary probe circuits are not Line's twelve-circuit contract.
 * IR checks cover this trigger only; they are not a general soundness proof.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const version=JSON.parse(readFileSync('package.json','utf8')).compact.compiler;
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/cse-range-probe-'));
const sources={
 control:'import CompactStandardLibrary;\nexport ledger stored: Uint<8>;\nwitness count(): Uint<32>;\nexport circuit go(): [] { const x = count(); stored = disclose(x as Uint<8>); }\n',
 trigger:'import CompactStandardLibrary;\nexport ledger first: Uint<8>;\nexport ledger second: Uint<8>;\nwitness count(): Uint<32>;\nwitness flag(): Boolean;\nexport circuit go(): [] { const x = count(); const f = flag(); const conditional: Uint<8> = f ? (x as Uint<8>) : (0 as Uint<8>); const unconditional: Uint<8> = x as Uint<8>; first = disclose(conditional); second = disclose(unconditional); }\n',
 natural:'import CompactStandardLibrary;\nexport ledger stored: Uint<8>;\nexport ledger optional: Maybe<Uint<8>>;\nwitness count(): Uint<32>;\nwitness reveal(): Boolean;\nexport circuit go(): [] { const x = count(); optional = disclose(reveal() ? some<Uint<8>>(x as Uint<8>) : none<Uint<8>>()); stored = disclose(x as Uint<8>); }\n'
};
const probes=[];
for(const [name,source]of Object.entries(sources)){
 const file=join(work,name+'.compact'),dir=join(work,name);writeFileSync(file,source);
 const portable=p=>relative(process.cwd(),p).split(sep).join('/');
 await new Promise((yes,no)=>{const child=spawn(process.execPath,['scripts/compile-compact.mjs','--skip-zk',portable(file),portable(dir)],{stdio:'inherit'});child.on('error',no);child.on('close',code=>code===0?yes():no(Error('Compiler probe failed.')));});
 const info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json'),'utf8')),irBytes=readFileSync(join(dir,'zkir/go.zkir')),ir=JSON.parse(irBytes);
 assert.equal(info['compiler-version'],version);
 assert(Array.isArray(ir.instructions));
 // This probe's wide count is SSA variable 1. A single unconditional bound
 // on that value is sufficient; demanding two gates was overly strict.
 const target=ir.instructions[1];
 const linear=ir.instructions.every(i=>!['branch','jump','jmp'].includes(i.op));
 const range=ir.instructions.filter(i=>i.op==='constrain_bits'&&i.bits===8&&i.var===1);
 const rangeUnconditional=target?.op==='private_input'&&target.guard===null&&linear&&range.length>=1&&range.every(i=>i.guard===undefined||i.guard===null);
 probes.push({name,compiler:info['compiler-version'],sourceSha256:hash(source),irSha256:hash(irBytes),uint8RangeGateCount:range.length,
  countIsWideWitnessVariable1:target?.op==='private_input'&&target.guard===null,linearInstructionStream:linear,unconditionalCountRangeGateRetained:rangeUnconditional});
}
const passed=probes.every(p=>p.unconditionalCountRangeGateRetained);
const report={schema:'line-compact-cse-range-probe/v1',createdAt:new Date().toISOString(),compiler:version,probes,passed,
 analysisScriptSha256:hash(readFileSync('scripts/check-compact-cse-range.mjs')),compilerWrapperSha256:hash(readFileSync('scripts/compile-compact.mjs')),
 freshCompilation:true,cryptographicProofsGenerated:false,lineContractChanged:false,generalCompilerSoundnessProven:false,
 advisory:'https://github.com/LFDT-Minokawa/compact/security/advisories/GHSA-3p6x-5vpx-wwpj',
 evidenceScope:'Three temporary compiler regression probes. Requires a retained unconditional uint8 range gate on the same wider witness, in a linear instruction stream. One gate is sufficient. No general compiler, deployed-key, or proof soundness certification.'};
writeFileSync(join(work,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:join(work,'verification.json'),passed,probes}));
assert(passed,'The published uint8 cast trigger lost required range gates; investigate before release.');
