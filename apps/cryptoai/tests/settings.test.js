import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,SETTINGS_KEY,validateSettings,loadSettings,realizedLossToday,lossUsage,checkEntryLimits,recordLoss} from '../www/settings.js';
import {initial,buy,sell} from '../www/engine.js';
const now=Date.UTC(2026,10,2,12), quote=()=>({price:100,time:Date.now()});
test('settings persist via storage and return only validated fields',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 assert.deepEqual(loadSettings(storage),DEFAULTS);
 const config={maxTradeUsdt:25,dailyLossUsdt:10,futuresLeverage:2};
 storage.setItem(SETTINGS_KEY,JSON.stringify(config));assert.deepEqual(loadSettings(storage),config);
 assert.deepEqual(validateSettings({...config,secret:'discard'}),config);
});
test('corrupt and unavailable storage safely fall back',()=>{
 for(const text of ['{','null','{}','{"maxTradeUsdt":-1}'])assert.deepEqual(loadSettings({getItem:()=>text}),DEFAULTS);
 assert.deepEqual(loadSettings({getItem:()=>{throw Error('blocked');}}),DEFAULTS);
});
test('reject invalid numbers and leverage outside bounds',()=>{
 for(const n of [0,-1,Infinity,NaN,10001,'100']){
 assert.throws(()=>validateSettings({...DEFAULTS,maxTradeUsdt:n}));assert.throws(()=>validateSettings({...DEFAULTS,dailyLossUsdt:n}));
 }
 for(const n of [0,1.5,11,NaN])assert.throws(()=>validateSettings({...DEFAULTS,futuresLeverage:n}));
});
test('daily loss uses UTC, ignores profits and rolls over next day',()=>{
 const a=initial();a.history=[{pnl:-5,time:now},{pnl:20,time:now},{pnl:-50,time:now-86400000}];
 assert.equal(realizedLossToday(a,now),5);recordLoss(a,-2,now);assert.equal(realizedLossToday(a,now),7);
 recordLoss(a,10,now);assert.equal(realizedLossToday(a,now),7);
 a.history=[];assert.equal(realizedLossToday(a,now),7);assert.equal(realizedLossToday(a,now+86400000),0);
});
test('daily loss usage includes open losses with estimated exit costs',()=>{
 const a=initial();a.positions=[{symbol:'BTCUSDT',quantity:1,cost:100,entry:100}];
 assert.ok(lossUsage(a,{BTCUSDT:{price:90}},now)>10);
});
test('trade cap and daily remaining budget enforced, stale marks rejected',()=>{
 const a=initial();assert.throws(()=>checkEntryLimits(a,{},DEFAULTS,101,1,now),/per-trade/);
 a.lossDay='2026-11-02';a.realizedLoss=99;
 assert.throws(()=>checkEntryLimits(a,{},DEFAULTS,50,2,now),/Daily loss/);
 assert.doesNotThrow(()=>checkEntryLimits(a,{},DEFAULTS,50,1,now));
 a.positions=[{symbol:'BTCUSDT',cost:100,quantity:1,entry:100}];
 assert.throws(()=>checkEntryLimits(a,{BTCUSDT:{price:100,time:now-16000}},DEFAULTS,50,1,now),/Fresh quotes/);
});
test('saved risk settings actually block buys without mutation; exits remain allowed',()=>{
 const a=initial();assert.throws(()=>buy(a,'BTCUSDT',1,quote(),3,1,10000,{settings:{...DEFAULTS,maxTradeUsdt:50},quotes:{}}),/per-trade/);
 assert.equal(a.cash,10000);assert.equal(a.positions.length,0);
 buy(a,'BTCUSDT',.5,quote(),3,1,10000,{settings:DEFAULTS,quotes:{}});
 sell(a,'BTCUSDT',quote());assert.equal(a.positions.length,0);assert.ok(a.realizedLoss>0);
});
