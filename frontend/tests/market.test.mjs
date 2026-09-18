import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateQuote, validateHistory, applyQuote, fetchMarketQuote, fetchHistoricalQuote } from '../src/lib/market.ts'
import { parsePortfolio, portfolioTotals } from '../src/lib/portfolio.ts'

const quote = { ticker: 'AAPL', name: 'Apple', currency: 'USD', price: 150, asOf: '2026-09-17T20:00:00Z', fetchedAt: '2026-09-18T10:00:00Z', priceKind: 'latest_quote', source: 'Yahoo Finance' }
const historical = { ticker: 'AAPL', currency: 'USD', price: 100, requestedDate: '2024-01-06', priceDate: '2024-01-08', priceKind: 'historical_close', splitAdjusted: true }
const holding = { id: 'one', symbol: 'AAPL', name: 'Apple', type: 'Stock', currency: 'USD', quantity: 10, cost: 100, price: 140, updatedAt: '2026-09-16T00:00:00Z', priceSource: 'market', quoteAsOf: '2026-09-16T20:00:00Z', quoteFetchedAt: '2026-09-16T20:01:00Z', quoteKind: 'latest_quote', costMethod: 'historical', purchaseDate: '2024-01-06', historicalPriceDate: '2024-01-08' }

test('accepts dated quotes and refuses currency mismatches, wrong symbols, invalid values and missing timestamps', () => {
  assert.deepEqual(validateQuote(quote, 'AAPL', 'USD'), quote)
  assert.throws(() => validateQuote(quote, 'AAPL', 'NOK'), /USD.*NOK/)
  for (const update of [{ticker:'MSFT'}, {price:NaN}, {price:-1}, {asOf:undefined}, {fetchedAt:'bad'}, {priceKind:'live'}]) {
    assert.throws(() => validateQuote({...quote, ...update}, 'AAPL', 'USD'))
  }
})
test('historical estimates validate requested date, trading window, currency and adjustment convention', () => {
  assert.equal(validateHistory(historical, 'AAPL', 'USD', '2024-01-06').price, 100)
  for (const update of [{priceDate:'2024-01-05'}, {priceDate:'2024-01-20'}, {requestedDate:'2024-02-01'}, {splitAdjusted:false}, {currency:'NOK'}]) {
    assert.throws(() => validateHistory({...historical,...update}, 'AAPL', 'USD', '2024-01-06'))
  }
})
test('refresh updates price and return but preserves purchase details and clears prior errors', () => {
  const refreshed = applyQuote({...holding, quoteError:'Offline'}, quote)
  assert.equal(refreshed.cost, 100)
  assert.equal(refreshed.quantity, 10)
  assert.equal(refreshed.purchaseDate, '2024-01-06')
  assert.equal(refreshed.quoteError, undefined)
  assert.equal(portfolioTotals([refreshed]).gain, 500)
  assert.equal(portfolioTotals([refreshed]).percent, 50)
})
test('older provider responses cannot overwrite newer saved quotes', () => {
  const updated = applyQuote(holding, {...quote, asOf:'2026-09-15T20:00:00Z'})
  assert.equal(updated.price, 140)
  assert.match(updated.quoteError, /older/)
})
test('market metadata round-trips without invalidating legacy manual holdings', () => {
  const data = {version:1,currency:'USD',holdings:[holding]}
  assert.deepEqual(parsePortfolio(JSON.stringify(data)), data)
  assert.throws(() => parsePortfolio(JSON.stringify({...data,holdings:[{...holding,quoteAsOf:undefined}]})))
})
test('requests use correct endpoints and preserve useful service errors', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url)
    return new Response(JSON.stringify(url.includes('/history') ? historical : quote))
  })
  assert.equal((await fetchMarketQuote('AAPL','USD')).price,150)
  assert.equal((await fetchHistoricalQuote('AAPL','USD','2024-01-06')).price,100)
  assert.deepEqual(requests, ['/api/market/quotes/AAPL','/api/market/quotes/AAPL/history?purchaseDate=2024-01-06'])
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({detail:'Provider busy'}), {status:503}))
  await assert.rejects(fetchMarketQuote('AAPL','USD'), /Provider busy/)
})
