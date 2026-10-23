import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runReleaseCommand } from './release-dogfood.mjs';
test('failed E2E stops release before packaging', () => {
 let packaged=false;
 assert.throws(()=>{
  runReleaseCommand('pnpm',['test:e2e'],()=>({status:1}));
  packaged=true;
 },/release gate failed/);
 assert.equal(packaged,false);
});
test('release builds depend on same-ref reusable CI and exclude uncertified OSes',()=>{
 const release=readFileSync('.github/workflows/release.yml','utf8');
 const ci=readFileSync('.github/workflows/ci.yml','utf8');
 assert.match(release,/uses: \.\/\.github\/workflows\/ci.yml/);
 assert.match(release,/needs: gates/);
 assert.match(ci,/workflow_call:/);
 assert.doesNotMatch(release,/platform: (windows|macos)/);
});
test('fresh-tag coverage selects a real history base instead of the zero before SHA',()=>{
 const ci=readFileSync('.github/workflows/ci.yml','utf8');
 assert.match(ci,/refs\/tags\/\*/);
 assert.match(ci,/git describe --tags/);
 assert.match(ci,/git rev-list --max-parents=0 HEAD/);
});
test('both save surfaces permit the native pending-save confirmation', () => {
 for (const window of ['main', 'quick-add']) {
  const capability=JSON.parse(readFileSync(`src-tauri/capabilities/${window}.json`,'utf8'));
  assert.ok(capability.permissions.includes('dialog:allow-confirm'), `${window} must permit confirm`);
 }
});
test('dialog SDK confirmation uses the command supported by the locked Rust plugin', () => {
 const sdk=readFileSync('node_modules/@tauri-apps/plugin-dialog/dist-js/index.js','utf8');
 assert.doesNotMatch(sdk, /invoke\(['"]plugin:dialog\|confirm['"]/);
 assert.match(sdk, /plugin:dialog\|message/);
});
