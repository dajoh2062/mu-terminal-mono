import { assetTypes, validAmount, validCurrency, validDate } from './portfolio.ts'
import type { AssetType, ExchangeRate, HistoricalExchangeRate, Holding } from './portfolio.ts'

export type MarketQuote = {
  ticker: string
  name: string
  price: number
  currency: string
  asOf: string
  fetchedAt: string
  priceKind: 'latest_quote' | 'daily_close'
  source: 'Yahoo Finance'
  exchange?: string
  originalCurrency?: string
  assetType?: AssetType
}
export type HistoricalQuote = {
  ticker: string
  currency: string
  price: number
  requestedDate: string
  priceDate: string
  priceKind: 'historical_close'
  splitAdjusted: true
}

function checkCurrency(actual: unknown, expected: string) {
  if (actual !== expected) throw new Error(`This asset is quoted in ${typeof actual === 'string' ? actual : 'an unknown currency'}, but this holding is recorded in ${expected}. Select the investment again to verify its trading currency.`)
}

export function validateQuote(data: MarketQuote, symbol: string, currency?: string): MarketQuote {
  if (!data || data.ticker !== symbol || !validAmount(data.price, true)
    || !validCurrency(data.currency) || typeof data.name !== 'string' || typeof data.asOf !== 'string' || !Number.isFinite(Date.parse(data.asOf))
    || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt))
    || !['latest_quote', 'daily_close'].includes(data.priceKind) || data.source !== 'Yahoo Finance') {
    throw new Error('The provider returned an invalid quote. Please try again.')
  }
  if (currency) checkCurrency(data.currency, currency)
  return data
}

export function validateHistory(data: HistoricalQuote, symbol: string, currency: string, date: string): HistoricalQuote {
  const day = Date.parse(data?.priceDate)
  const requested = Date.parse(date)
  if (!data || data.ticker !== symbol || data.requestedDate !== date || !validAmount(data.price, true)
    || !Number.isFinite(day) || !Number.isFinite(requested) || day < requested || day - requested > 7 * 86400000
    || data.priceKind !== 'historical_close' || data.splitAdjusted !== true) {
    throw new Error('The provider returned an invalid historical price. Enter your actual average price instead.')
  }
  checkCurrency(data.currency, currency)
  return data
}

async function request(path: string, signal?: AbortSignal) {
  try {
    const response = await fetch(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Market data is unavailable. Check the symbol or try again shortly.')
    return data
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('The price lookup timed out. Please try again.', { cause: error })
    if (error instanceof TypeError) throw new Error('Could not connect to the market data service. Please try again shortly.', { cause: error })
    throw error
  }
}

export async function fetchMarketQuote(symbol: string, currency?: string, signal?: AbortSignal) {
  return validateQuote(await request(`/api/market/quotes/${encodeURIComponent(symbol)}`, signal), symbol, currency)
}

export async function fetchHistoricalQuote(symbol: string, currency: string, date: string, signal?: AbortSignal) {
  return validateHistory(await request(`/api/market/quotes/${encodeURIComponent(symbol)}/history?purchaseDate=${encodeURIComponent(date)}`, signal), symbol, currency, date)
}

export function applyQuote(holding: Holding, quote: MarketQuote): Holding {
  if (holding.currency && holding.currency !== quote.currency) return { ...holding, quoteError: 'Quote currency changed. Edit this holding to verify its purchase currency.' }
  // A response from an earlier request must never roll a price backward.
  if (holding.quoteAsOf && Date.parse(quote.asOf) < Date.parse(holding.quoteAsOf)) return { ...holding, quoteError: 'Provider returned an older quote. Keeping the last saved price.' }
  return { ...holding, price: quote.price, quoteAsOf: quote.asOf, quoteFetchedAt: quote.fetchedAt, quoteKind: quote.priceKind, quoteError: undefined }
}

export const displayQuoteTime = (value?: string) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown time'


export type AssetSearchResult = { symbol: string; name: string; exchange: string; type: AssetType; currency: string | null }

export async function searchAssets(query: string, signal?: AbortSignal): Promise<AssetSearchResult[]> {
  const data = await request(`/api/market/search?q=${encodeURIComponent(query.trim())}`, signal)
  if (!data || !Array.isArray(data.results) || data.results.some((item: AssetSearchResult) => !item
    || typeof item.symbol !== 'string' || !item.symbol || typeof item.name !== 'string'
    || typeof item.exchange !== 'string' || !assetTypes.includes(item.type)
    || item.currency !== null && !validCurrency(item.currency))) {
    throw new Error('Search returned invalid results. Please try again.')
  }
  return data.results
}

export function validateExchangeRate(data: ExchangeRate, from: string, to: string): ExchangeRate {
  if (!data || data.from !== from || data.to !== to || !validAmount(data.rate, true)
    || typeof data.asOf !== 'string' || !Number.isFinite(Date.parse(data.asOf))
    || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt))) {
    throw new Error('The provider returned an invalid exchange rate.')
  }
  return data
}

export async function fetchExchangeRate(from: string, to: string, signal?: AbortSignal) {
  return validateExchangeRate(await request(`/api/market/fx/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, signal), from, to)
}

export function validateHistoricalExchangeRate(data: HistoricalExchangeRate, from: string, to: string, date: string): HistoricalExchangeRate {
  validateExchangeRate(data, from, to)
  if (data.requestedDate !== date || !validDate(date) || !validDate(data.rateDate)
    || Date.parse(data.rateDate) > Date.parse(date) || Date.parse(date) - Date.parse(data.rateDate) > 7 * 86400000) {
    throw new Error('The provider returned an invalid purchase-date exchange rate.')
  }
  return data
}

export async function fetchHistoricalExchangeRate(from: string, to: string, date: string, signal?: AbortSignal) {
  return validateHistoricalExchangeRate(await request(`/api/market/fx/${encodeURIComponent(from)}/${encodeURIComponent(to)}/history?purchaseDate=${encodeURIComponent(date)}`, signal), from, to, date)
}
