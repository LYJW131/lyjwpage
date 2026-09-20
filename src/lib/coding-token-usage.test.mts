import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCodingTokenUsage} from '@shared/coding-token-usage';
import {normalizeVibeCodingNow} from '@/lib/vibecoding-parse';
const valid=()=>({from:1800000000000,to:1800000300000,collectedAt:1800000420000,sources:[{id:'codex',state:'ok'},{id:'claude',state:'unavailable'}],windows:[{from:1800000000000,to:1800000300000,agents:[{id:'codex',model:'test',inputTokens:10,outputTokens:20,cacheReadTokens:30,cacheCreationTokens:0,reasoningTokens:10,eventCount:1}]}]});
test('window token contract preserves event time, components and unavailable sources',()=>{
 const r=valid();assert.deepEqual(parseCodingTokenUsage(r),r);assert.deepEqual(normalizeVibeCodingNow({agents:[],tokenUsage:r})?.tokenUsage,r);
 const bad=valid();bad.windows[0].agents[0].reasoningTokens=21;assert.equal(parseCodingTokenUsage(bad),null);
 const duplicate=valid();duplicate.windows.push(duplicate.windows[0]);assert.equal(parseCodingTokenUsage(duplicate),null);
 assert.equal(normalizeVibeCodingNow({agents:[],tokenUsage:{}}),null);
});
