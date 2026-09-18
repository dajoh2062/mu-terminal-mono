export const assetTypes = ['Stock', 'ETF', 'Fund', 'Crypto', 'Bond', 'Cash', 'Other'] as const
export const currencies = ['USD', 'NOK', 'EUR', 'GBP', 'SEK', 'DKK', 'CHF', 'CAD', 'AUD', 'JPY'] as const
export type AssetType = typeof assetTypes[number]
export type Currency = typeof currencies[number]
export type Holding = {
  id: string
  symbol: string
  name: string
  type: AssetType
  quantity: number
  cost: number
  price: number
  updatedAt: string
  priceSource?: 'manual' | 'market'
  quoteAsOf?: string
  quoteFetchedAt?: string
  quoteKind?: 'latest_quote' | 'daily_close'
  quoteError?: string
  costMethod?: 'average' | 'historical'
  purchaseDate?: string
  historicalPriceDate?: string
  currency?: string
  exchange?: string
  originalCurrency?: string
}
export type ExchangeRate = { from: string; to: string; rate: number; asOf: string; fetchedAt: string; error?: string }
export type HistoricalExchangeRate = ExchangeRate & { requestedDate: string; rateDate: string }
export type Portfolio = { version: 1; currency: Currency; holdings: Holding[]; exchangeRates?: Record<string, ExchangeRate>; historicalExchangeRates?: Record<string, HistoricalExchangeRate> }
export const storageKey = 'mu-terminal.portfolio.v1'
export const emptyPortfolio = (): Portfolio => ({ version: 1, currency: 'USD', holdings: [] })

export function holdingValue(holding: Holding) {
  const basis = holding.quantity * holding.cost
  const value = holding.quantity * holding.price
  const gain = value - basis
  return { basis, value, gain, percent: basis > 0 ? gain / basis * 100 : null }
}

export function portfolioTotals(holdings: Holding[]) {
  const totals = holdings.reduce((sum, holding) => {
    const { basis, value } = holdingValue(holding)
    return { basis: sum.basis + basis, value: sum.value + value }
  }, { basis: 0, value: 0 })
  const gain = totals.value - totals.basis
  return { ...totals, gain, percent: totals.basis > 0 ? gain / totals.basis * 100 : null }
}

export function validAmount(value: unknown, positive = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value <= 1e12 && (positive ? value > 0 : value >= 0)
}

export function validCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
}

export function conversionRate(portfolio: Portfolio, currency: string) {
  if (currency === portfolio.currency) return 1
  const quote = portfolio.exchangeRates?.[`${currency}:${portfolio.currency}`]
  return quote && quote.from === currency && quote.to === portfolio.currency && validAmount(quote.rate, true) ? quote.rate : null
}

export function convertedValue(holding: Holding, portfolio: Portfolio) {
  const currency = holding.currency ?? portfolio.currency
  const rate = conversionRate(portfolio, currency)
  const native = holdingValue(holding)
  const date = purchaseRateDate(holding)
  const purchaseQuote = date ? portfolio.historicalExchangeRates?.[`${currency}:${portfolio.currency}:${date}`] : undefined
  const purchaseRate = currency === portfolio.currency ? 1 : purchaseQuote && purchaseQuote.from === currency && purchaseQuote.to === portfolio.currency && purchaseQuote.requestedDate === date && validAmount(purchaseQuote.rate, true) ? purchaseQuote.rate : null
  const basis = native.basis === 0 ? 0 : purchaseRate === null ? null : native.basis * purchaseRate
  const value = rate === null ? null : native.value * rate
  const gain = basis === null || value === null ? null : value - basis
  const priceGain = rate === null ? null : native.gain * rate
  const fxGain = basis === null || rate === null ? null : native.basis * rate - basis
  return { basis, value, gain, percent: gain !== null && basis !== null && basis > 0 ? gain / basis * 100 : null, priceGain, fxGain }
}

export const purchaseRateDate = (holding: Holding) => holding.costMethod === 'historical' ? holding.historicalPriceDate : holding.purchaseDate

export function convertedTotals(portfolio: Portfolio) {
  const missingCurrencies = [...new Set(portfolio.holdings.map((item) => item.currency ?? portfolio.currency).filter((currency) => conversionRate(portfolio, currency) === null))]
  const converted = portfolio.holdings.map((item) => convertedValue(item, portfolio))
  const missingPurchaseRates = portfolio.holdings.filter((_, index) => converted[index].basis === null)
  const basis = missingPurchaseRates.length ? null : converted.reduce((sum, item) => sum + item.basis!, 0)
  const value = missingCurrencies.length ? null : converted.reduce((sum, item) => sum + item.value!, 0)
  const gain = basis === null || value === null ? null : value - basis
  const fxGain = converted.some((item) => item.fxGain === null) ? null : converted.reduce((sum, item) => sum + item.fxGain!, 0)
  return { basis, value, gain, percent: gain !== null && basis !== null && basis > 0 ? gain / basis * 100 : null, fxGain, missingCurrencies, missingPurchaseRates }
}

export function parsePortfolio(raw: string): Portfolio {
  const data = JSON.parse(raw)
  if (data?.version !== 1 || !currencies.includes(data.currency) || !Array.isArray(data.holdings)) throw new Error('Invalid portfolio')
  const ids = new Set<string>()
  for (const item of data.holdings) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.symbol !== 'string' || !item.symbol.trim() || item.symbol.length > 24
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
      || !assetTypes.includes(item.type) || !validAmount(item.quantity, true)
      || !validAmount(item.cost) || !validAmount(item.price)
      || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) {
      throw new Error('Invalid holding')
    }
    ids.add(item.id)
    // Legacy holdings were stored in the portfolio currency. Materialize that before any base-currency change.
    if (item.currency === undefined) item.currency = data.currency
    if (!validCurrency(item.currency) || (item.exchange !== undefined && typeof item.exchange !== 'string')
      || (item.originalCurrency !== undefined && typeof item.originalCurrency !== 'string')) throw new Error('Invalid holding currency')
    if ((item.priceSource !== undefined && !['manual', 'market'].includes(item.priceSource))
      || (item.costMethod !== undefined && !['average', 'historical'].includes(item.costMethod))
      || (item.quoteKind !== undefined && !['latest_quote', 'daily_close'].includes(item.quoteKind))
      || (item.quoteError !== undefined && typeof item.quoteError !== 'string')
      || ['quoteAsOf', 'quoteFetchedAt', 'purchaseDate', 'historicalPriceDate'].some((key) => item[key] !== undefined && (typeof item[key] !== 'string' || !Number.isFinite(Date.parse(item[key]))))
      || (item.priceSource === 'market' && (!item.quoteAsOf || !item.quoteFetchedAt || !item.quoteKind))
      || (item.costMethod === 'historical' && (!item.purchaseDate || !item.historicalPriceDate))) {
      throw new Error('Invalid holding metadata')
    }
  }
  if (data.exchangeRates !== undefined) {
    if (!data.exchangeRates || typeof data.exchangeRates !== 'object' || Array.isArray(data.exchangeRates)) throw new Error('Invalid exchange rates')
    for (const [key, value] of Object.entries(data.exchangeRates)) {
      const rate = value as ExchangeRate
      if (!rate || !validCurrency(rate.from) || !validCurrency(rate.to) || key !== `${rate.from}:${rate.to}`
        || !validAmount(rate.rate, true) || !Number.isFinite(Date.parse(rate.asOf)) || !Number.isFinite(Date.parse(rate.fetchedAt))
        || (rate.error !== undefined && typeof rate.error !== 'string')) throw new Error('Invalid exchange rate')
    }
  }
  if (data.historicalExchangeRates !== undefined) {
    if (!data.historicalExchangeRates || typeof data.historicalExchangeRates !== 'object' || Array.isArray(data.historicalExchangeRates)) throw new Error('Invalid purchase exchange rates')
    for (const [key, value] of Object.entries(data.historicalExchangeRates)) {
      const rate = value as HistoricalExchangeRate
      if (!rate || !validCurrency(rate.from) || !validCurrency(rate.to) || key !== `${rate.from}:${rate.to}:${rate.requestedDate}`
        || !validAmount(rate.rate, true) || !validDate(rate.requestedDate) || !validDate(rate.rateDate)
        || Date.parse(rate.rateDate) > Date.parse(rate.requestedDate) || Date.parse(rate.requestedDate) - Date.parse(rate.rateDate) > 7 * 86400000
        || !Number.isFinite(Date.parse(rate.asOf)) || !Number.isFinite(Date.parse(rate.fetchedAt))) throw new Error('Invalid purchase exchange rate')
    }
  }
  return data as Portfolio
}

export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

export function selectHoldings(portfolio: Portfolio, query: string, type: string, sort: 'name' | 'value' | 'gain', ascending: boolean) {
  const term = query.trim().toLowerCase()
  return portfolio.holdings.filter((item) => (type === 'all' || item.type === type)
    && `${item.symbol} ${item.name} ${item.type} ${item.currency ?? ''}`.toLowerCase().includes(term))
    .sort((a, b) => {
      if (sort === 'name') return a.symbol.localeCompare(b.symbol) * (ascending ? 1 : -1)
      const left = convertedValue(a, portfolio)[sort]
      const right = convertedValue(b, portfolio)[sort]
      // Unknown values always stay below known ones in either direction.
      if (left === null) return right === null ? a.symbol.localeCompare(b.symbol) : 1
      if (right === null) return -1
      return (left - right) * (ascending ? 1 : -1) || a.symbol.localeCompare(b.symbol)
    })
}
