import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertedTotals, convertedValue, parsePortfolio } from '../src/lib/portfolio.ts'
import { validateQuote, validateExchangeRate, applyQuote, searchAssets, validateHistoricalExchangeRate, fetchHistoricalExchangeRate } from '../src/lib/market.ts'

const holding = (currency, overrides = {}) => ({ id:currency, symbol:currency, currency, name:'Test', type:'Stock', quantity:10, cost:100, price:120, purchaseDate:'2024-01-08', updatedAt:'2026-09-18T12:00:00Z', ...overrides })
const rate = (from, to, value) => ({from,to,rate:value,asOf:'2026-09-18T12:00:00Z',fetchedAt:'2026-09-18T12:01:00Z'})
const history = (from, to, value, date = '2024-01-08') => ({...rate(from,to,value),requestedDate:date,rateDate:date})
const portfolio = {version:1,currency:'USD',holdings:[holding('USD'),holding('NOK')],exchangeRates:{'NOK:USD':rate('NOK','USD',0.1)},historicalExchangeRates:{'NOK:USD:2024-01-08':history('NOK','USD',0.1)}}

test('mixed-currency totals and weights use rates, never raw addition', () => {
  const total = convertedTotals(portfolio)
  assert.equal(total.value,1320)
  assert.equal(total.basis,1100)
  assert.equal(total.gain,220)
  assert.equal(total.percent,20)
  assert.equal(convertedValue(portfolio.holdings[1],portfolio).value,120)
  assert.equal(portfolio.holdings[1].cost,100)
})
test('missing rates withhold combined totals instead of presenting partial valuations', () => {
  const total = convertedTotals({...portfolio,exchangeRates:{}})
  assert.equal(total.value,null)
  assert.equal(total.basis,1100)
  assert.equal(total.gain,null)
  assert.deepEqual(total.missingCurrencies,['NOK'])
})
test('display-currency changes do not change native purchase prices', () => {
  const switched = {...portfolio,currency:'NOK',exchangeRates:{'USD:NOK':rate('USD','NOK',10)},historicalExchangeRates:{'USD:NOK:2024-01-08':history('USD','NOK',10)}}
  assert.equal(convertedTotals(switched).value,13200)
  assert.equal(switched.holdings[0].currency,'USD')
  assert.equal(switched.holdings[0].cost,100)
  assert.equal(convertedTotals(switched).percent,20)
})
test('legacy holdings retain their original base currency during migration', () => {
  const legacy = holding('USD'); delete legacy.currency
  const migrated = parsePortfolio(JSON.stringify({version:1,currency:'NOK',holdings:[legacy]}))
  assert.equal(migrated.holdings[0].currency,'NOK')
  migrated.currency='EUR'
  assert.equal(migrated.holdings[0].currency,'NOK')
  assert.equal(convertedTotals(migrated).value,null)
})
test('foreign quotes are discovered without assuming a portfolio currency', () => {
  const quote = {ticker:'EQNR.OL',name:'Equinor',currency:'NOK',price:300,asOf:'2026-09-18T12:00:00Z',fetchedAt:'2026-09-18T12:01:00Z',priceKind:'latest_quote',source:'Yahoo Finance'}
  assert.equal(validateQuote(quote,'EQNR.OL').currency,'NOK')
  assert.throws(() => validateQuote({...quote,currency:null},'EQNR.OL'))
  assert.match(applyQuote(holding('USD'),quote).quoteError,/currency changed/)
})
test('inverse, invalid and malformed exchange rates cannot be used', () => {
  assert.throws(() => validateExchangeRate(rate('USD','NOK',10),'NOK','USD'))
  for (const value of [0,-1,NaN,Infinity]) assert.throws(() => validateExchangeRate(rate('NOK','USD',value),'NOK','USD'))
  assert.throws(() => parsePortfolio(JSON.stringify({...portfolio,exchangeRates:{'NOK:USD':rate('USD','NOK',10)},historicalExchangeRates:{'USD:NOK:2024-01-08':history('USD','NOK',10)}})))
})
test('search encodes queries and accepts listing metadata without inventing currency', async (t) => {
  let requested
  t.mock.method(globalThis,'fetch',async (url) => { requested=url; return new Response(JSON.stringify({results:[{symbol:'EQNR.OL',name:'Equinor',exchange:'Oslo',type:'Stock',currency:null}]})) })
  const results = await searchAssets('Equinor & energy')
  assert.equal(requested,'/api/market/search?q=Equinor%20%26%20energy')
  assert.equal(results[0].exchange,'Oslo')
  assert.equal(results[0].currency,null)
})


test('a flat USD investment gains 10% in NOK when USD/NOK rises from 10 to 11', () => {
  const asset = holding('USD', {quantity:1, cost:100, price:100})
  const data = {version:1,currency:'NOK',holdings:[asset],exchangeRates:{'USD:NOK':rate('USD','NOK',11)},historicalExchangeRates:{'USD:NOK:2024-01-08':history('USD','NOK',10)}}
  assert.deepEqual(convertedValue(asset,data), {basis:1000,value:1100,gain:100,percent:10,priceGain:0,fxGain:100})
  assert.equal(convertedTotals(data).percent,10)
  assert.equal(convertedTotals({...data,currency:'USD'}).gain,0)
  assert.equal(convertedTotals({...data,currency:'USD'}).percent,0)
  const falling = {...data,exchangeRates:{'USD:NOK':rate('USD','NOK',9)}}
  assert.equal(convertedTotals(falling).gain,-100)
  assert.equal(convertedTotals(falling).percent,-10)
})
test('price and FX effects reconcile to total return and refreshed FX preserves purchase cost', () => {
  const asset = holding('USD',{quantity:1})
  const data = {version:1,currency:'NOK',holdings:[asset],exchangeRates:{'USD:NOK':rate('USD','NOK',11)},historicalExchangeRates:{'USD:NOK:2024-01-08':history('USD','NOK',10)}}
  const result = convertedValue(asset,data)
  assert.equal(result.basis,1000)
  assert.equal(result.value,1320)
  assert.equal(result.gain,320)
  assert.equal(result.percent,32)
  assert.equal(result.priceGain + result.fxGain,result.gain)
  const refreshed = convertedValue(asset,{...data,exchangeRates:{'USD:NOK':rate('USD','NOK',9)}})
  assert.equal(refreshed.basis,1000)
  assert.equal(refreshed.gain,80)
  assert.deepEqual(parsePortfolio(JSON.stringify(data)),data)
})
test('missing date or purchase rate withholds return but retains valuation', () => {
  for (const asset of [holding('NOK'), holding('NOK',{purchaseDate:undefined})]) {
    const data = {...portfolio,holdings:[asset],historicalExchangeRates:{}}
    const result = convertedTotals(data)
    assert.equal(result.value,120)
    assert.equal(result.basis,null)
    assert.equal(result.gain,null)
    assert.equal(result.percent,null)
    assert.equal(result.missingPurchaseRates.length,1)
  }
})
test('editing a purchase date invalidates the old FX basis; history estimates use actual session date', () => {
  const changed = holding('NOK',{purchaseDate:'2024-02-01'})
  assert.equal(convertedValue(changed,portfolio).basis,null)
  const estimate = holding('NOK',{purchaseDate:'2024-01-06',historicalPriceDate:'2024-01-08',costMethod:'historical'})
  assert.equal(convertedValue(estimate,portfolio).basis,100)
  const zero = holding('NOK',{cost:0,purchaseDate:undefined})
  assert.equal(convertedValue(zero,{...portfolio,historicalExchangeRates:{}}).gain,120)
  assert.equal(convertedValue(zero,portfolio).percent,null)
})
test('each position uses its own purchase date in a mixed portfolio', () => {
  const data = {...portfolio,holdings:[holding('NOK'),holding('NOK',{id:'later',purchaseDate:'2024-02-01'})],historicalExchangeRates:{...portfolio.historicalExchangeRates,'NOK:USD:2024-02-01':history('NOK','USD',0.12,'2024-02-01')}}
  assert.equal(convertedTotals(data).basis,220)
  assert.equal(convertedTotals(data).value,240)
  assert.equal(convertedTotals(data).gain,20)
})
test('historical FX rejects reversed pairs, wrong dates, future observations, and stale observations', () => {
  const valid = history('USD','NOK',10)
  assert.equal(validateHistoricalExchangeRate(valid,'USD','NOK','2024-01-08').rate,10)
  for (const change of [{from:'NOK',to:'USD'},{rate:0},{requestedDate:'2024-02-01'},{rateDate:'2024-01-09'},{rateDate:'2023-12-31'},{rateDate:'2024-02-30'}]) {
    assert.throws(() => validateHistoricalExchangeRate({...valid,...change},'USD','NOK','2024-01-08'))
    assert.throws(() => parsePortfolio(JSON.stringify({...portfolio,historicalExchangeRates:{'USD:NOK:2024-01-08':{...valid,...change}}})))
  }
})
test('historical FX fetch includes the purchase date and surfaces lookup failure', async (t) => {
  let requested
  t.mock.method(globalThis,'fetch',async (url) => { requested=url; return new Response(JSON.stringify(history('USD','NOK',10))) })
  assert.equal((await fetchHistoricalExchangeRate('USD','NOK','2024-01-08')).rate,10)
  assert.equal(requested,'/api/market/fx/USD/NOK/history?purchaseDate=2024-01-08')
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({detail:'No historical FX found'}),{status:404}))
  await assert.rejects(fetchHistoricalExchangeRate('USD','NOK','2024-01-08'),/No historical FX/)
})
