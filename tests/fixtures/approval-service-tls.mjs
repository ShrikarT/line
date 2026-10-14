/** Ephemeral test certificates. Never read an operator wallet or TLS key. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
export function tlsFixture(){
 mkdirSync('.compact-keys',{recursive:true});const root=mkdtempSync(resolve('.compact-keys/approval-tls-test-'));
 const mapped=p=>process.platform==='win32'?p.replace(/^([A-Za-z]):[\\/]/,(_,drive)=>'/mnt/'+drive.toLowerCase()+'/').replaceAll('\\','/'):p;
 const path=name=>join(root,name);
 function openssl(args){
  const command=process.platform==='win32'?'wsl':'openssl',prefix=process.platform==='win32'?['-d',process.env.WSL_DISTRO||'Ubuntu','--exec','openssl']:[];
  const result=spawnSync(command,[...prefix,...args],{stdio:'ignore',timeout:60_000,windowsHide:true});
  assert.equal(result.status,0,'Ephemeral TLS fixture generation failed; requires OpenSSL (WSL Ubuntu on Windows).');
 }
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',mapped(path('ca.key')),'-out',mapped(path('ca.crt')),'-days','1','-subj','/CN=Line-Ephemeral-Test-CA','-addext','basicConstraints=critical,CA:TRUE']);
 for(const name of ['server','caller','other-caller']){
  const extensions=name==='server'?'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth':'extendedKeyUsage=clientAuth';
  writeFileSync(path(name+'.ext'),'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n'+extensions+'\n');
  openssl(['req','-new','-newkey','rsa:2048','-nodes','-keyout',mapped(path(name+'.key')),'-out',mapped(path(name+'.csr')),'-subj','/CN='+name]);
  openssl(['x509','-req','-in',mapped(path(name+'.csr')),'-CA',mapped(path('ca.crt')),'-CAkey',mapped(path('ca.key')),'-CAcreateserial','-out',mapped(path(name+'.crt')),'-days','1','-extfile',mapped(path(name+'.ext'))]);
 }
 const material=name=>({key:readFileSync(path(name+'.key')),cert:readFileSync(path(name+'.crt')),ca:readFileSync(path('ca.crt'))});
 const fingerprint=name=>createHash('sha256').update(new X509Certificate(readFileSync(path(name+'.crt'))).raw).digest('hex');
 return {root,path,material,fingerprint};
}
