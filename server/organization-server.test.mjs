import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { startOrganizationServer } from './organization-server.mjs';

test('the production entry serves only the public build and organization API, then closes its owner once', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'line-public-server-')), build = join(directory, 'dist'); mkdirSync(build);
  t.after(() => { assert(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'line-public-server-')); rmSync(directory, { recursive: true, force: true }); });
  writeFileSync(join(build, 'index.html'), '<!doctype html><title>Public Line control</title>');
  mkdirSync(join(build, 'assets')); writeFileSync(join(build, 'assets', 'app.js'), 'export const publicControl=true;');
  writeFileSync(join(directory, 'private-control.json'), 'must never be served');
  let opens = 0, closes = 0;
  const app = await startOrganizationServer({ env: { LINE_PUBLIC_ORIGIN: 'https://line.example' }, port: 0, host: '127.0.0.1', publicDirectory: build, createService: async () => {
    opens++; return { catalog: () => ({ services: [] }), close: async () => { closes++; } };
  } });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const readiness = await fetch(base + '/readyz'); assert.equal(readiness.status, 200); assert.equal((await readiness.json()).ready, true);
    const page = await fetch(base + '/app'); assert.equal(page.status, 200); assert((await page.text()).includes('Public Line control'));
    const script = await fetch(base + '/assets/app.js'); assert.equal(script.status, 200); assert(script.headers.get('content-type').includes('javascript'));
    assert.equal((await fetch(base + '/%2e%2e%2fprivate-control.json')).status, 404);
    assert.equal((await fetch(base + '/api/preprod/status')).status, 404);
    const catalog = await fetch(base + '/api/organization/catalog', { headers: { Origin: 'https://line.example', 'X-Line-Organization': 'wallet' } });
    assert.equal(catalog.status, 200); assert.equal((await catalog.json()).walletAuthentication, 'required');
    const post = await fetch(base + '/app', { method: 'POST' }); assert.equal(post.status, 405);
  } finally { await Promise.all([app.close(), app.close()]); }
  assert.equal(opens, 1); assert.equal(closes, 1);
});

test('a failed supplier stop retains a retryable close after the HTTP listener has stopped',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'line-public-server-'));
  t.after(()=>{assert(resolve(directory).startsWith(resolve(tmpdir())+sep+'line-public-server-'));rmSync(directory,{recursive:true,force:true});});
  writeFileSync(join(directory,'index.html'),'<title>Shutdown control</title>');
  let attempts=0;
  const app=await startOrganizationServer({env:{LINE_PUBLIC_ORIGIN:'https://line.example'},port:0,host:'127.0.0.1',publicDirectory:directory,createService:async()=>({close:async()=>{if(++attempts===1)throw Error('Wallet still owns its lease');}})});
  await assert.rejects(app.close(),/still owns/);assert.equal(app.server.listening,false);
  await app.close();assert.equal(attempts,2);
  await app.close();assert.equal(attempts,2);
});
