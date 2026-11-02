import {recordLoss, checkEntryLimits} from './settings.js';
export const FEE = .001, SLIP = .0005;
export const fresh = (quote, now = Date.now()) => !!quote && Number.isFinite(quote.price) && quote.price > 0 && now - quote.time < 15000 && now >= quote.time;
export const initial = () => ({cash:10000, positions:[], history:[]});
export function ema(values, period) {
  if (values.length < period) return null;
  let v = values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (const n of values.slice(period)) v += (n-v)*2/(period+1);
  return v;
}
export function rsi(values, period=14) {
  if(values.length<=period) return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d)/period;loss+=Math.max(0,-d)/period;}
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(0,d))/period;loss=(loss*(period-1)+Math.max(0,-d))/period;}
  return loss===0?(gain===0?50:100):100-100/(1+gain/loss);
}
export function buy(account, symbol, quantity, quote, tp, sl, equity, risk = null) {
  if(!fresh(quote)) throw Error('Fresh live quote required (under 15 seconds).');
  if(![quantity,tp,sl,equity].every(Number.isFinite)||quantity<=0||tp<=0||sl<=0||sl>50||equity<=0) throw Error('Enter a positive quantity, TP and SL (SL ≤ 50%).');
  if(account.positions.some(p=>p.symbol===symbol)) throw Error('Close the existing position before another entry.');
  const price=quote.price*(1+SLIP), cost=price*quantity*(1+FEE);
  if(cost>account.cash) throw Error('Insufficient paper USDT.');
  if(cost>equity*.25) throw Error('Entry exceeds 25% of equity.');
  if(price*quantity*(sl/100+2*(FEE+SLIP))>equity*.01) throw Error('Stop risk including estimated fees/slippage exceeds 1% of equity.');
  if(risk)checkEntryLimits(account,risk.quotes,risk.settings,cost,price*quantity*(sl/100+2*(FEE+SLIP)));
  const position={symbol,quantity,entry:price,cost,tp:price*(1+tp/100),sl:price*(1-sl/100)};
  account.cash-=cost;account.positions.push(position);
  account.history.unshift({side:'BUY',symbol,quantity,price,time:Date.now(),fee:price*quantity*FEE});
}
export function sell(account,symbol,quote,reason='Manual') {
  if(!fresh(quote)) throw Error('Fresh live quote required.');
  const p=account.positions.find(p=>p.symbol===symbol);
  if(!p) throw Error('No position for this market.');
  const price=quote.price*(1-SLIP), proceeds=price*p.quantity*(1-FEE);
  recordLoss(account,proceeds-p.cost);
  account.cash+=proceeds;account.positions=account.positions.filter(x=>x!==p);
  account.history.unshift({side:'SELL',symbol,quantity:p.quantity,price,time:Date.now(),fee:price*p.quantity*FEE,pnl:proceeds-p.cost,reason});
}
