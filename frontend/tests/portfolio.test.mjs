import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyPortfolio, holdingValue, portfolioTotals, parsePortfolio, validAmount } from '../src/lib/portfolio.ts'

const holding = (overrides = {}) => ({ id: 'test', symbol: 'AAPL', name: 'Apple', type: 'Stock', currency: 'USD', quantity: 10, cost: 100, price: 120, updatedAt: '2026-09-18T12:00:00Z', ...overrides })

test('calculates value and unrealized return for fractional holdings', () => {
  assert.deepEqual(holdingValue(holding({ quantity: 0.5 })), { basis: 50, value: 60, gain: 10, percent: 20 })
})
test('aggregates positions, including losing positions and cash', () => {
  const total = portfolioTotals([holding(), holding({ quantity: 2, cost: 200, price: 150 }), holding({ quantity: 100, cost: 1, price: 1 })])
  assert.equal(total.basis, 1500)
  assert.equal(total.value, 1600)
  assert.equal(total.gain, 100)
  assert.ok(Math.abs(total.percent - 6.6666666667) < 0.00001)
})
test('handles zero cost basis and a completely lost position without dividing by zero', () => {
  assert.equal(holdingValue(holding({ cost: 0 })).percent, null)
  assert.equal(holdingValue(holding({ price: 0 })).percent, -100)
  assert.deepEqual(portfolioTotals([]), { basis: 0, value: 0, gain: 0, percent: null })
})
test('rejects invalid numerical inputs', () => {
  for (const value of [-1, Infinity, NaN, '100', null, 1e13]) assert.equal(validAmount(value), false)
  assert.equal(validAmount(0, true), false)
  assert.equal(validAmount(0), true)
  assert.equal(validAmount(0.00001, true), true)
})
test('round-trips stored holdings and rejects corrupted or unsupported data', () => {
  const portfolio = { ...emptyPortfolio(), holdings: [holding()] }
  assert.deepEqual(parsePortfolio(JSON.stringify(portfolio)), portfolio)
  for (const value of [null, {}, { ...portfolio, version: 2 }, { ...portfolio, currency: 'XYZ' }, { ...portfolio, holdings: [holding({ price: -1 })] }, { ...portfolio, holdings: [holding({ updatedAt: 'bad' })] }, { ...portfolio, holdings: [holding(), holding()] }]) {
    assert.throws(() => parsePortfolio(JSON.stringify(value)))
  }
})
