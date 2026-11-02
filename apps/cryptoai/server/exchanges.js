import {createHmac} from 'node:crypto';

// Fixed testnet hosts only. Never accept an exchange base URL from a request.
export const TARGETS = Object.freeze({
  'binance-spot': {host:'https://testnet.binance.vision',path:'/api/v3/account',prefix:'BINANCE_SPOT'},
  'binance-futures': {host:'https://demo-fapi.binance.com',path:'/fapi/v3/account',prefix:'BINANCE_FUTURES'},
  'bybit-spot': {host:'https://api-testnet.bybit.com',path:'/v5/account/wallet-balance',prefix:'BYBIT',category:'spot'},
  'bybit-futures': {host:'https://api-testnet.bybit.com',path:'/v5/account/wallet-balance',prefix:'BYBIT',category:'linear'},
});
const sign=(secret,data)=>createHmac('sha256',secret).update(data).digest('hex');
export function signedRequest(target,key,secret,now=Date.now()) {
  const t=TARGETS[target];
  if(!t) throw Error('Unsupported testnet target');
  if(!key||!secret) throw Error('Testnet credentials not configured on server');
  if(target.startsWith('binance-')) {
    const query=new URLSearchParams({recvWindow:'5000',timestamp:String(now)}).toString();
    return {url:`${t.host}${t.path}?${query}&signature=${sign(secret,query)}`,headers:{'X-MBX-APIKEY':key}};
  }
  // Both categories use Bybit Unified Trading Account wallet balances, not separate spot/futures wallets.
  const query='accountType=UNIFIED',timestamp=String(now),window='5000';
  return {url:`${t.host}${t.path}?${query}`,headers:{'X-BAPI-API-KEY':key,'X-BAPI-TIMESTAMP':timestamp,'X-BAPI-RECV-WINDOW':window,'X-BAPI-SIGN':sign(secret,timestamp+key+window+query)}};
}
export function normalize(target,body) {
  if(!body || typeof body!=='object') throw Error('Invalid testnet account response');
  if(target==='binance-spot'&&!Array.isArray(body.balances)) throw Error('Invalid spot account response');
  if(target==='binance-futures'&&!Array.isArray(body.assets)) throw Error('Invalid futures account response');
  if(target.startsWith('bybit-')&&!Array.isArray(body.result?.list)) throw Error('Invalid Unified account response');
  if(target==='binance-spot') return {accountType:'SPOT',canTrade:body.canTrade===true,balances:(body.balances||[]).map(b=>({asset:b.asset,available:b.free,locked:b.locked})).filter(b=>Number(b.available)>0||Number(b.locked)>0)};
  if(target==='binance-futures') return {accountType:'USD-M FUTURES',canTrade:body.canTrade===true,balances:(body.assets||[]).map(b=>({asset:b.asset,available:b.availableBalance,wallet:b.walletBalance,unrealizedPnl:b.unrealizedProfit}))};
  const wallets=body.result?.list||[];
  return {accountType:'UNIFIED (shared spot / linear futures wallet)',canTrade:null,balances:wallets.flatMap(w=>(w.coin||[]).map(c=>({asset:c.coin,wallet:c.walletBalance,equity:c.equity}))),note:'Wallet access does not verify instrument permissions, leverage, margin mode or order execution. Bybit testnet is not Bybit demo trading.'};
}
export async function accountStatus(target,{env=process.env,fetcher=fetch,now=Date.now()}={}) {
  const t=TARGETS[target];if(!t)throw Error('Unsupported testnet target');
  const key=env[t.prefix+'_API_KEY'],secret=env[t.prefix+'_API_SECRET'];
  const req=signedRequest(target,key,secret,now);
  let response;
  try {response=await fetcher(req.url,{method:'GET',headers:req.headers,signal:AbortSignal.timeout(10000),redirect:'error'});}catch {throw Error('Exchange testnet unreachable or timed out');}
  // Never return raw exchange errors: they can echo keys or signed request URLs.
  if(!response.ok)throw Error(`Exchange testnet HTTP ${response.status}. Check key permissions, region, clock and target environment.`);
  let body;try{body=await response.json();}catch{throw Error('Invalid testnet response');}
  if((typeof body.code==='number'&&body.code<0)||(typeof body.retCode==='number'&&body.retCode!==0))throw Error('Exchange rejected testnet request. Check credentials, permissions and server clock.');
  return {target,environment:'testnet',executionEnabled:false,checkedAt:new Date(now).toISOString(),...normalize(target,body)};
}
