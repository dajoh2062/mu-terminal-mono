import { useCallback, useEffect, useRef, useState } from 'react'
import { currencies, convertedTotals, convertedValue, emptyPortfolio, parsePortfolio, purchaseRateDate, storageKey, selectHoldings } from '../lib/portfolio'
import type { Currency, ExchangeRate, HistoricalExchangeRate, Holding, Portfolio as PortfolioData } from '../lib/portfolio'
import './Portfolio.css'
import HoldingEditor from './HoldingEditor'
import HoldingDetails from './HoldingDetails'
import { applyQuote, fetchExchangeRate, fetchHistoricalExchangeRate, fetchMarketQuote } from '../lib/market'
import type { MarketQuote } from '../lib/market'

const colors = ['#292929', '#6b82a1', '#8b9e8a', '#bca788', '#9b90af', '#adb4ba']
const units = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 })
const signedPercent = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
const tone = (value: number | null) => value !== null && value > 0 ? 'positive' : value !== null && value < 0 ? 'negative' : ''

function readSavedPortfolio() {
  try {
    const raw = localStorage.getItem(storageKey)
    return { data: raw ? parsePortfolio(raw) : emptyPortfolio(), error: '' }
  } catch {
    return { data: emptyPortfolio(), error: 'Your saved portfolio could not be loaded. Saving a new holding will replace the stored portfolio.' }
  }
}

export default function Portfolio() {
  const [initial] = useState(readSavedPortfolio)
  const [portfolio, setPortfolio] = useState(initial.data)
  const portfolioRef = useRef(initial.data)
  const refreshRequest = useRef<AbortController | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [fxErrors, setFxErrors] = useState<Record<string, string>>({})
  const [storageError, setStorageError] = useState(initial.error)
  const [editor, setEditor] = useState<{ holding?: Holding } | null>(null)
  const [removed, setRemoved] = useState<{ holding: Holding; index: number } | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'value' | 'gain' | 'name'>('value')
  const [ascending, setAscending] = useState(false)
  const [assetFilter, setAssetFilter] = useState('all')
  const [viewed, setViewed] = useState<string | null>(null)
  const estimatedCosts = portfolio.holdings.some((item) => item.costMethod === 'historical')
  const failedPrices = portfolio.holdings.filter((item) => item.quoteError)
  const totals = convertedTotals(portfolio)
  const totalValue = totals.value ?? 0
  const foreignCurrencies = [...new Set(portfolio.holdings.map((item) => item.currency ?? portfolio.currency).filter((currency) => currency !== portfolio.currency))]
  const hasForeign = foreignCurrencies.length > 0
  const money = (value: number | null, currency = portfolio.currency as string) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(value)
  const unitPrice = (value: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(value)
  const signedMoney = (value: number | null, currency = portfolio.currency as string) => value === null ? '—' : `${value > 0 ? '+' : ''}${money(value, currency)}`

  const save = useCallback((change: PortfolioData | ((current: PortfolioData) => PortfolioData)) => {
    const next = typeof change === 'function' ? change(portfolioRef.current) : change
    portfolioRef.current = next
    setPortfolio(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setStorageError('')
    } catch {
      setStorageError('Changes are only in memory. Browser storage is unavailable or full; they may be lost when you leave this page.')
    }
  }, [])

  const refreshPrices = useCallback(async () => {
    if (refreshRequest.current) return
    const snapshot = portfolioRef.current
    const targets = snapshot.holdings.filter((item) => item.priceSource === 'market')
    const fxTargets = [...new Set(snapshot.holdings.map((item) => item.currency ?? snapshot.currency).filter((currency) => currency !== snapshot.currency))]
    if (!targets.length && !fxTargets.length) { setRefreshing(false); return }
    const controller = new AbortController()
    refreshRequest.current = controller
    setRefreshing(true)
    const results = new Map<string, { quote?: MarketQuote; error?: string }>()
    const rates: Record<string, ExchangeRate> = {}
    const purchaseRates: Record<string, HistoricalExchangeRate> = {}
    const errors: Record<string, string> = {}
    const today = new Date().toISOString().slice(0, 10)
    const purchaseTargets = new Map(snapshot.holdings.flatMap((item) => {
      const date = purchaseRateDate(item)
      const from = item.currency ?? snapshot.currency
      const key = `${from}:${snapshot.currency}:${date}`
      const savedRate = snapshot.historicalExchangeRates?.[key]
      // A rate fetched on the purchase day can still be provisional; settle it on a later day.
      return from !== snapshot.currency && item.cost > 0 && date && (!savedRate || date >= today || savedRate.fetchedAt.slice(0, 10) <= date)
        ? [[key, { from, date }] as const] : []
    }))
    try {
      const jobs = [
        ...[...purchaseTargets].map(([key, { from, date }]) => async () => {
          try { purchaseRates[key] = await fetchHistoricalExchangeRate(from, snapshot.currency, date, controller.signal) }
          catch (error) { errors[key] = error instanceof Error ? error.message : 'Purchase exchange rate unavailable.' }
        }),
        ...targets.map((item) => async () => {
          try { results.set(item.id, { quote: await fetchMarketQuote(item.symbol, item.currency ?? snapshot.currency, controller.signal) }) }
          catch (error) { results.set(item.id, { error: error instanceof Error ? error.message : 'Price refresh failed.' }) }
        }),
        ...fxTargets.map((currency) => async () => {
          const key = `${currency}:${snapshot.currency}`
          try { rates[key] = await fetchExchangeRate(currency, snapshot.currency, controller.signal) }
          catch (error) { errors[key] = error instanceof Error ? error.message : 'Exchange rate unavailable.' }
        }),
      ]
      for (let i = 0; i < jobs.length && !controller.signal.aborted; i += 3) {
        await Promise.all(jobs.slice(i, i + 3).map((job) => job()))
      }
      if (!controller.signal.aborted) {
        save((current) => {
          const exchangeRates = { ...current.exchangeRates }
          for (const [key, rate] of Object.entries(rates)) {
            if (!exchangeRates[key] || Date.parse(rate.asOf) >= Date.parse(exchangeRates[key].asOf)) exchangeRates[key] = rate
            else errors[key] = 'An older FX quote was returned; using the saved rate.'
          }
          return {
            ...current, exchangeRates, historicalExchangeRates: { ...current.historicalExchangeRates, ...purchaseRates },
            holdings: current.holdings.map((item) => {
              const result = results.get(item.id)
              const original = snapshot.holdings.find((old) => old.id === item.id)
              if (item.priceSource !== 'market' || !result || item.symbol !== original?.symbol || item.currency !== original.currency) return item
              if (result.quote) return applyQuote(item, result.quote)
              return original.quoteFetchedAt === item.quoteFetchedAt ? { ...item, quoteError: result.error } : item
            }),
          }
        })
        setFxErrors(errors)
      }
    } finally {
      if (refreshRequest.current === controller) {
        refreshRequest.current = null
        if (!controller.signal.aborted) setRefreshing(false)
      }
    }
  }, [save])

  const hasMarketHoldings = portfolio.holdings.some((item) => item.priceSource === 'market')
  const refreshKey = `${portfolio.currency}|${portfolio.holdings.map((item) => `${item.id}:${item.symbol}:${item.currency}:${item.priceSource}:${purchaseRateDate(item)}:${item.cost}`).sort().join('|')}`
  useEffect(() => {
    const first = window.setTimeout(() => { void refreshPrices() }, 0)
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshPrices() }, 60000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
      refreshRequest.current?.abort()
      refreshRequest.current = null
    }
  }, [refreshKey, refreshPrices])

  function saveHolding(holding: Holding) {
    const exists = portfolio.holdings.some((item) => item.id === holding.id)
    save({ ...portfolio, holdings: exists ? portfolio.holdings.map((item) => item.id === holding.id ? holding : item) : [...portfolio.holdings, holding] })
    setRemoved(null)
    setEditor(null)
    setQuery('')
    setAssetFilter('all')
  }

  const hasHoldings = portfolio.holdings.length > 0
  const visibleHoldings = selectHoldings(portfolio, query, assetFilter, sort, ascending)
  const assetFilters = [...new Set(portfolio.holdings.map((item) => item.type))].sort()
  const selectedHolding = portfolio.holdings.find((item) => item.id === viewed)
  const allocations = selectHoldings(portfolio, '', 'all', 'value', false)
    .map((item) => ({ holding: item, value: convertedValue(item, portfolio).value ?? 0 }))
    .filter((item) => item.value > 0)
  const chartEntries = allocations.slice(0, 5).map(({ holding, value }) => ({ label: holding.symbol, value, id: holding.id }))
  if (allocations.length > 5) chartEntries.push({ label: 'Other', value: allocations.slice(5).reduce((sum, item) => sum + item.value, 0), id: '' })
  const hasFxErrors = foreignCurrencies.some((currency) => fxErrors[`${currency}:${portfolio.currency}`]) || portfolio.holdings.some((item) => fxErrors[`${item.currency}:${portfolio.currency}:${purchaseRateDate(item)}`])
  const needsDate = totals.missingPurchaseRates.filter((item) => !purchaseRateDate(item))
  const needsRate = totals.missingPurchaseRates.some((item) => purchaseRateDate(item)) || totals.missingCurrencies.length > 0

  function changeSort(next: 'value' | 'gain' | 'name') {
    setAscending(sort === next ? !ascending : next === 'name')
    setSort(next)
  }
  function removeHolding(holding: Holding) {
    setRemoved({ holding, index: portfolio.holdings.findIndex((item) => item.id === holding.id) })
    save((current) => ({ ...current, holdings: current.holdings.filter((item) => item.id !== holding.id) }))
    setViewed(null)
  }
  function clearFilters() { setQuery(''); setAssetFilter('all') }
  const sortArrow = (key: string) => sort === key ? ascending ? '↑' : '↓' : '↕'

  return (
    <div className="portfolio">
      <div className="portfolio-heading">
        <div><h1>Portfolio</h1><p>{hasHoldings ? `${portfolio.holdings.length} ${portfolio.holdings.length === 1 ? 'holding' : 'holdings'}` : 'Your investments, in one place.'}</p></div>
        <div className="portfolio-actions">
          <label className="currency-control"><span className="sr-only">Display currency</span><select aria-label="Portfolio display currency" value={portfolio.currency} title="Currency for values and returns" onChange={(event) => { save({ ...portfolio, currency: event.target.value as Currency }); setRemoved(null) }}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          {(hasMarketHoldings || hasForeign) && <button className="refresh-prices" aria-label={refreshing ? 'Refreshing prices' : 'Refresh prices'} title="Refresh prices" disabled={refreshing} onClick={() => { void refreshPrices() }}><svg className={refreshing ? 'spinning' : ''} viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16.5 7A7 7 0 1 0 17 12M16.5 3v4h-4" /></svg></button>}
          {hasHoldings && <button onClick={() => setEditor({})}><span aria-hidden="true">＋</span> Add holding</button>}
        </div>
      </div>
      {storageError && <p className="portfolio-notice error" role="alert">{storageError}</p>}
      {(failedPrices.length > 0 || hasFxErrors) && <div className="portfolio-notice quote-warning" role="status"><span>Some prices or exchange rates couldn’t update. Available saved rates are shown.</span><button className="text-button" disabled={refreshing} onClick={() => { void refreshPrices() }}>Retry</button></div>}
      {needsDate.length > 0 && <div className="portfolio-notice quote-warning" role="status"><span>Add {needsDate.length === 1 ? 'a purchase date' : 'purchase dates'} to calculate your return in {portfolio.currency}.</span><button className="text-button" onClick={() => setEditor({ holding: needsDate[0] })}>{needsDate.length === 1 ? `Update ${needsDate[0].symbol}` : `Update ${needsDate.length} holdings`}</button></div>}
      {needsRate && !hasFxErrors && <div className="portfolio-notice quiet-notice" role="status"><span>{refreshing ? 'Updating exchange rates…' : 'Some exchange rates are unavailable. Affected totals will appear when rates are available.'}</span>{!refreshing && <button className="text-button" onClick={() => { void refreshPrices() }}>Retry</button>}</div>}
      {removed && <div className="undo-notice" role="status"><span>{removed.holding.symbol} removed.</span><button className="text-button" onClick={() => { save((current) => { const holdings = [...current.holdings]; holdings.splice(removed.index, 0, removed.holding); return { ...current, holdings } }); clearFilters(); setRemoved(null) }}>Undo</button><button className="icon-button" aria-label="Dismiss removal notice" onClick={() => setRemoved(null)}>×</button></div>}

      {!hasHoldings ? <section className="portfolio-empty"><div className="empty-portfolio-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 12h16M10 12v3h4v-3" /></svg></div><h2>Start with your first investment</h2><p>Find a stock, fund, or crypto asset.<br />Add your shares and buy price to track its return.</p><button onClick={() => setEditor({})}>＋ Add holding</button></section> : <>
        <section className="portfolio-summary" aria-label="Portfolio overview">
          <div className="summary-value"><p>Portfolio value <span>{portfolio.currency}</span></p><h2>{money(totals.value)}</h2><small>{refreshing ? 'Updating prices…' : hasMarketHoldings ? 'Latest available prices' : 'Manual prices'}</small></div>
          <div><p>Total return</p><h2 className={tone(totals.gain)}>{signedMoney(totals.gain)}</h2><small className={tone(totals.gain)}><span className="return-percentage">{signedPercent(totals.percent)}</span> <span className="muted">since purchase{hasForeign ? ' · includes FX' : ''}</span></small></div>
          <div><p>Invested{estimatedCosts || hasForeign ? <span title="Uses estimated purchase prices or daily exchange rates"> · estimated</span> : ''}</p><h2>{money(totals.basis)}</h2><small>Purchase cost in {portfolio.currency}</small></div>
        </section>

        <section className="portfolio-panel holdings-panel" aria-labelledby="holdings-title">
          <div className="panel-heading"><div className="holdings-title"><h2 id="holdings-title">Holdings</h2><span>{portfolio.holdings.length}</span></div><span className="table-currency">Values in {portfolio.currency}</span></div>
          <div className="holdings-toolbar"><div className="holdings-search"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input aria-label="Search holdings" placeholder="Search holdings" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</div><select aria-label="Filter by asset type" value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}><option value="all">All assets</option>{assetFilters.map((type) => <option key={type}>{type}</option>)}</select></div>
          <div className="holdings-table-wrap"><table className="holdings-table"><caption className="sr-only">Holding values and returns in {portfolio.currency}; unit prices in trading currency. Select an investment for details.</caption><thead><tr>
            <th scope="col" aria-sort={sort === 'name' ? ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => changeSort('name')}>Asset <span aria-hidden="true">{sortArrow('name')}</span></button></th>
            <th scope="col" className="price-column">Price</th>
            <th scope="col" aria-sort={sort === 'value' ? ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => changeSort('value')}>Value <span aria-hidden="true">{sortArrow('value')}</span></button></th>
            <th scope="col" aria-sort={sort === 'gain' ? ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => changeSort('gain')}>Return <span aria-hidden="true">{sortArrow('gain')}</span></button></th>
            <th scope="col" className="weight-column">Weight</th>
          </tr></thead><tbody>{visibleHoldings.map((holding) => {
            const metrics = convertedValue(holding, portfolio)
            const nativeCurrency = holding.currency ?? portfolio.currency
            const weight = totalValue > 0 && metrics.value !== null ? metrics.value / totalValue * 100 : null
            return <tr key={holding.id}>
              <td><button className="asset-button" aria-label={`View ${holding.symbol} details`} onClick={() => setViewed(holding.id)}><span className="asset-monogram" aria-hidden="true">{holding.symbol.slice(0, 2)}</span><span className="asset-description"><strong>{holding.symbol}</strong><span>{holding.name}</span><small>{units.format(holding.quantity)} {holding.type === 'Cash' ? nativeCurrency : 'units'}</small></span></button></td>
              <td className="price-column">{unitPrice(holding.price, nativeCurrency)}<small className={holding.quoteError ? 'negative' : 'muted'}>{holding.quoteError ? 'Saved price' : holding.priceSource === 'market' ? 'Market price' : 'Manual'}</small></td>
              <td className="holding-value">{money(metrics.value)}</td>
              <td className={tone(metrics.gain)}>{signedMoney(metrics.gain)}<small>{metrics.gain === null ? <button className="text-button" onClick={() => setEditor({ holding })}>{!purchaseRateDate(holding) ? 'Add date' : 'Review'}</button> : signedPercent(metrics.percent)}</small></td>
              <td className="weight-column">{weight === null ? '—' : `${weight.toFixed(1)}%`}<div className="weight-track"><span style={{ width: `${weight ?? 0}%` }} /></div></td>
            </tr>
          })}</tbody></table></div>
          {!visibleHoldings.length && <div className="no-results"><p>No holdings match your filters.</p><button className="text-button" onClick={clearFilters}>Clear filters</button></div>}
          <div className="table-footer"><span>{visibleHoldings.length === portfolio.holdings.length ? `${portfolio.holdings.length} holdings` : `${visibleHoldings.length} of ${portfolio.holdings.length} holdings`}</span><span>Select an asset to view or edit</span></div>
        </section>

        {totalValue > 0 && <section className="allocation-section" aria-label="Portfolio allocation"><div className="allocation-heading"><h2>Allocation</h2><span>By market value</span></div><div className="allocation-bar" role="img" aria-label={chartEntries.map((item) => `${item.label}: ${(item.value / totalValue * 100).toFixed(1)}%`).join(', ')}>{chartEntries.map((item, index) => <span key={item.label} style={{ width: `${item.value / totalValue * 100}%`, background: colors[index] }} />)}</div><div className="allocation-legend">{chartEntries.map((item, index) => item.id ? <button key={item.id} onClick={() => setViewed(item.id)}><i style={{ background: colors[index] }} />{item.label}<strong>{(item.value / totalValue * 100).toFixed(1)}%</strong></button> : <span key={item.label}><i style={{ background: colors[index] }} />Other <strong>{(item.value / totalValue * 100).toFixed(1)}%</strong></span>)}</div></section>}
      </>}
      <footer className="portfolio-footer"><span>Saved on this device</span>{hasHoldings && <details className="calculation-details"><summary>About these figures</summary><div><p>Returns are unrealized and exclude fees, dividends, and sales. Market quotes may be delayed and refresh every minute while this page is visible. Manual prices stay as entered.</p><p>Unit prices use the trading currency. Values and returns use {portfolio.currency}. Purchase costs use daily FX on the purchase date or the latest rate within the preceding week; current values use current FX. Multiple purchase dates represented by one average cost and date give an approximate return.</p>{estimatedCosts && <p>Some purchase costs use split-adjusted historical closes as estimates.</p>}<p>Select a holding to see its price timestamps and exchange rates.</p></div></details>}</footer>
      {selectedHolding && <HoldingDetails holding={selectedHolding} portfolio={portfolio} onClose={() => setViewed(null)} onEdit={() => { setViewed(null); setEditor({ holding: selectedHolding }) }} onRemove={() => removeHolding(selectedHolding)} />}
      {editor && <HoldingEditor holding={editor.holding} currency={portfolio.currency} holdings={portfolio.holdings} onSave={saveHolding} onClose={() => setEditor(null)} />}
    </div>
  )
}
