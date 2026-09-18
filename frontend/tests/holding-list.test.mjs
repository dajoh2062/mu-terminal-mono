import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectHoldings } from '../src/lib/portfolio.ts'
const usd = {id:'a',symbol:'AAPL',name:'Apple',type:'Stock',currency:'USD',quantity:1,cost:100,price:120,updatedAt:'2026-09-18T12:00:00Z'}
const nok = {...usd,id:'b',symbol:'EQNR.OL',name:'Equinor',currency:'NOK',price:1000}
const cash = {...usd,id:'c',symbol:'USD',name:'USD cash',type:'Cash',quantity:200,price:1,cost:1}
const portfolio = {version:1,currency:'USD',holdings:[usd,nok,cash],exchangeRates:{'NOK:USD':{from:'NOK',to:'USD',rate:0.1,asOf:'2026-09-18T12:00:00Z',fetchedAt:'2026-09-18T12:00:00Z'}}}
test('holding search combines normalized search and asset filter without changing saved order', () => {
  assert.deepEqual(selectHoldings(portfolio,'  equinor  ','Stock','name',true).map(x=>x.id),['b'])
  assert.deepEqual(selectHoldings(portfolio,'USD','Cash','name',true).map(x=>x.id),['c'])
  assert.equal(selectHoldings(portfolio,'Apple','Cash','value',false).length,0)
  assert.deepEqual(portfolio.holdings.map(x=>x.id),['a','b','c'])
})
test('value sorting compares converted values and supports both directions', () => {
  assert.deepEqual(selectHoldings(portfolio,'','all','value',false).map(x=>x.id),['c','a','b'])
  assert.deepEqual(selectHoldings(portfolio,'','all','value',true).map(x=>x.id),['b','a','c'])
})
test('unknown returns sort last in either direction; alphabetical sorting is reversible', () => {
  assert.deepEqual(selectHoldings(portfolio,'','all','gain',false).map(x=>x.id),['a','c','b'])
  assert.deepEqual(selectHoldings(portfolio,'','all','gain',true).map(x=>x.id),['c','a','b'])
  assert.deepEqual(selectHoldings(portfolio,'','all','name',true).map(x=>x.id),['a','b','c'])
  assert.deepEqual(selectHoldings(portfolio,'','all','name',false).map(x=>x.id),['c','b','a'])
})
