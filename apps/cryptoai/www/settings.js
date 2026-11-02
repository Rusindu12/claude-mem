export const SETTINGS_KEY='cryptoai.risk.v1';
export const DEFAULTS=Object.freeze({maxTradeUsdt:100,dailyLossUsdt:100,futuresLeverage:1});
export function validateSettings(value){
  if(!value||typeof value!=='object')throw Error('Invalid risk settings');
  const {maxTradeUsdt,dailyLossUsdt,futuresLeverage}=value;
  if(!Number.isFinite(maxTradeUsdt)||maxTradeUsdt<1||maxTradeUsdt>10000)throw Error('Trade limit must be 1–10,000 USDT.');
  if(!Number.isFinite(dailyLossUsdt)||dailyLossUsdt<1||dailyLossUsdt>10000)throw Error('Daily loss limit must be 1–10,000 USDT.');
  if(!Number.isInteger(futuresLeverage)||futuresLeverage<1||futuresLeverage>10)throw Error('Leverage preference must be a whole number from 1 to 10.');
  return {maxTradeUsdt,dailyLossUsdt,futuresLeverage};
}
export function loadSettings(storage){try{return validateSettings(JSON.parse(storage.getItem(SETTINGS_KEY)));}catch{return {...DEFAULTS};}}
export function utcDay(now=Date.now()){return new Date(now).toISOString().slice(0,10);}
// Gross realized losses: profits do not refill the daily loss budget.
export function realizedLossToday(account,now=Date.now()){
  const day=utcDay(now);
  if(account.lossDay===day&&Number.isFinite(account.realizedLoss)&&account.realizedLoss>=0)return account.realizedLoss;
  return account.history.reduce((sum,t)=>sum+(Number.isFinite(t.pnl)&&t.pnl<0&&Number.isFinite(t.time)&&utcDay(t.time)===day?-t.pnl:0),0);
}
export function recordLoss(account,pnl,now=Date.now()){
  account.realizedLoss=realizedLossToday(account,now)+Math.max(0,-pnl);
  account.lossDay=utcDay(now);
}
export function lossUsage(account,quotes,now=Date.now()){
  const openLoss=account.positions.reduce((sum,p)=>{
    const price=quotes[p.symbol]?.price;
    const mark=Number.isFinite(price)&&price>0?price:p.entry;
    // Estimate liquidation value including the simulator's exit fee/slippage.
    return sum+Math.max(0,p.cost-p.quantity*mark*(1-.0005)*(1-.001));
  },0);
  return realizedLossToday(account,now)+openLoss;
}
export function checkEntryLimits(account,quotes,settings,estimatedCost,estimatedStopLoss,now=Date.now()){
  const config=validateSettings(settings);
  if(!Number.isFinite(estimatedCost)||estimatedCost<=0||!Number.isFinite(estimatedStopLoss)||estimatedStopLoss<0)throw Error('Invalid entry estimate');
  if(estimatedCost>config.maxTradeUsdt)throw Error('Entry exceeds your saved per-trade USDT limit.');
  for(const p of account.positions){const q=quotes[p.symbol];if(!q||!Number.isFinite(q.price)||q.price<=0||!Number.isFinite(q.time)||q.time>now||now-q.time>=15000)throw Error('Fresh quotes for all open positions are required for daily risk checks.');}
  const used=lossUsage(account,quotes,now);
  if(used>=config.dailyLossUsdt||used+estimatedStopLoss>config.dailyLossUsdt)throw Error('Daily loss budget reached or insufficient for this entry. New buys are blocked; sells remain available.');
}
