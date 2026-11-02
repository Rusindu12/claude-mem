import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial,buy,sell,fresh,ema,rsi} from '../www/engine.js';
const quote=()=>({price:100,time:Date.now()});
test('freshness rejects stale, future and invalid quotes',()=>{assert.ok(fresh(quote()));assert.ok(!fresh({price:100,time:Date.now()-16000}));assert.ok(!fresh({price:100,time:Date.now()+10000}));assert.ok(!fresh({price:NaN,time:Date.now()}));});
test('fees and slippage reduce round-trip cash',()=>{const a=initial();buy(a,'BTCUSDT',1,quote(),3,1,10000);assert.equal(a.positions.length,1);sell(a,'BTCUSDT',quote());assert.ok(a.cash<10000);assert.equal(a.positions.length,0);assert.equal(a.history.length,2);});
test('invalid sizes, oversized allocation and stop risk rejected',()=>{for(const qty of [NaN,0,-1,Infinity,30])assert.throws(()=>buy(initial(),'BTCUSDT',qty,quote(),3,1,10000));assert.throws(()=>buy(initial(),'BTCUSDT',20,quote(),3,10,10000));assert.throws(()=>buy(initial(),'BTCUSDT',1,{price:100,time:0},3,1,10000));});
test('duplicate positions and naked sells rejected',()=>{const a=initial();buy(a,'BTCUSDT',1,quote(),3,1,10000);assert.throws(()=>buy(a,'BTCUSDT',1,quote(),3,1,10000));assert.throws(()=>sell(a,'ETHUSDT',quote()));});
test('indicator values for flat and rising series',()=>{assert.equal(ema(Array(60).fill(100),20),100);assert.equal(rsi(Array(60).fill(100)),50);assert.equal(rsi(Array.from({length:60},(_,i)=>i)),100);assert.equal(ema([1],20),null);});
