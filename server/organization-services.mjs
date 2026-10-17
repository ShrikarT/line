import { createHash } from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const ORGANIZATION_SERVICES=[
 {id:'text-metrics',merchant:'A',name:'Document metrics',price:'25000',description:'Word, sentence and paragraph counts, with recurring terms from your actual text.'},
 {id:'content-integrity',merchant:'B',name:'Content fingerprint',price:'20000',description:'SHA-256 content fingerprint, exact UTF-8 byte length and Unicode code-point count.'},
];
export function fulfillOrganizationService(id,document){
 if(typeof document!=='string'||!document.trim()||document.length>5000)throw Error('Supply a document of up to 5000 characters.');
 if(id==='text-metrics'){
  const words=document.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[],counts=new Map();
  for(const word of words)counts.set(word,(counts.get(word)??0)+1);
  return {words:words.length,sentences:(document.match(/[^.!?]+[.!?]?/g)??[]).filter(value=>value.trim()).length,paragraphs:document.trim().split(/\n\s*\n/).length,recurringTerms:[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10).map(([term,count])=>({term,count}))};
 }
 if(id==='content-integrity')return {algorithm:'SHA-256',sha256:digest(document),utf8Bytes:Buffer.byteLength(document,'utf8'),unicodeCodePoints:[...document].length};
 throw Error('Unknown merchant service.');
}
