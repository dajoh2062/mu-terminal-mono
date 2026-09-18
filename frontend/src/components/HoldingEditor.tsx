import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { assetTypes, currencies, validAmount, validCurrency } from '../lib/portfolio'
import type { AssetType, Currency, Holding } from '../lib/portfolio'
import { displayQuoteTime, fetchHistoricalQuote, fetchMarketQuote } from '../lib/market'
import type { AssetSearchResult, HistoricalQuote, MarketQuote } from '../lib/market'
import AssetSearch from './AssetSearch'

type Props = { holding?: Holding; currency: Currency; holdings: Holding[]; onSave: (holding: Holding) => void; onClose: () => void }

export default function HoldingEditor({ holding, currency: baseCurrency, holdings, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const quoteRequest = useRef<AbortController | null>(null)
  const [mode, setMode] = useState<'market' | 'manual'>(holding ? holding.priceSource ?? 'manual' : 'market')
  const [selected, setSelected] = useState<AssetSearchResult | null>(holding?.priceSource === 'market' ? {
    symbol: holding.symbol, name: holding.name, exchange: holding.exchange ?? '', type: holding.type, currency: holding.currency ?? baseCurrency,
  } : null)
  const [manualSymbol, setManualSymbol] = useState(holding?.symbol ?? '')
  const [manualName, setManualName] = useState(holding?.name ?? '')
  const [type, setType] = useState<AssetType>(holding?.type ?? 'Stock')
  const [tradeCurrency, setTradeCurrency] = useState(holding?.currency ?? baseCurrency)
  const [quantity, setQuantity] = useState(String(holding?.quantity ?? ''))
  const [cost, setCost] = useState(String(holding?.cost ?? ''))
  const [manualPrice, setManualPrice] = useState(String(holding?.price ?? ''))
  const [costMethod, setCostMethod] = useState<'average' | 'historical'>(holding?.costMethod ?? 'average')
  const [purchaseDate, setPurchaseDate] = useState(holding?.purchaseDate ?? '')
  const [quote, setQuote] = useState<MarketQuote | null>(null)
  const [history, setHistory] = useState<HistoricalQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [error, setError] = useState('')
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const market = mode === 'market'
  const symbol = market ? selected?.symbol ?? '' : manualSymbol.trim().toUpperCase()
  const currentQuote = quote?.ticker === symbol ? quote : null
  const currency = market ? currentQuote?.currency : tradeCurrency
  const historical = market && costMethod === 'historical'
  const currentHistory = history?.ticker === symbol && history.requestedDate === purchaseDate && history.currency === currency ? history : null
  const actualCost = historical ? currentHistory?.price : cost.trim() ? Number(cost) : undefined
  const actualPrice = market ? currentQuote?.price : manualPrice.trim() ? Number(manualPrice) : undefined
  const qty = Number(quantity)
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const money = (value: number, precise = false) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? baseCurrency, currencyDisplay: 'code', maximumFractionDigits: precise ? 8 : 2 }).format(value)

  useEffect(() => {
    const element = dialog.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    element?.querySelector<HTMLInputElement>(holding ? '[name="quantity"]' : '[name="asset-search"]')?.focus()
    return () => { quoteRequest.current?.abort(); element?.close(); trigger?.focus() }
  }, [holding])

  useEffect(() => {
    if (!market || !selected) return
    const controller = new AbortController()
    quoteRequest.current = controller
    const timeout = window.setTimeout(async () => {
      setQuoteLoading(true)
      setQuoteError('')
      try {
        const latest = await fetchMarketQuote(selected.symbol, undefined, controller.signal)
        if (controller.signal.aborted) return
        // Never reinterpret a saved buy price when an exchange changes its quote currency.
        if (holding && holding.symbol === selected.symbol && latest.currency !== (holding.currency ?? baseCurrency)) {
          setCost('')
          setError(`This listing now trades in ${latest.currency}. Re-enter your average buy price in ${latest.currency} before saving.`)
        }
        setQuote(latest)
      } catch (problem) {
        if (!controller.signal.aborted) setQuoteError(problem instanceof Error ? problem.message : 'Could not fetch this investment’s price.')
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false)
      }
    }, 0)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [market, selected, quoteAttempt, holding, baseCurrency])

  useEffect(() => {
    if (!historical || !symbol || !currency || !purchaseDate || purchaseDate >= today) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setHistoryLoading(true)
      setHistoryError('')
      try {
        const price = await fetchHistoricalQuote(symbol, currency, purchaseDate, controller.signal)
        if (!controller.signal.aborted) setHistory(price)
      } catch (problem) {
        if (!controller.signal.aborted) setHistoryError(problem instanceof Error ? problem.message : 'Could not load the historical price.')
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false)
      }
    }, 400)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [historical, symbol, currency, purchaseDate, today, historyAttempt])

  function selectAsset(asset: AssetSearchResult) {
    if (holdings.some((item) => item.symbol === asset.symbol && item.id !== holding?.id)) {
      setError(`${asset.symbol} is already in your portfolio. Edit that holding to update your shares.`)
      return
    }
    setSelected(asset)
    setQuote(null)
    setHistory(null)
    setQuoteLoading(true)
    setQuoteError('')
    setHistoryError('')
    setError('')
    setType(asset.type)
    // A new listing must never inherit another listing's buy price or quantity.
    if (asset.symbol !== holding?.symbol) { setCost(''); setQuantity(''); setPurchaseDate('') }
  }

  function changeInvestment() {
    quoteRequest.current?.abort()
    setSelected(null)
    setQuote(null)
    setHistory(null)
    setQuoteError('')
    setHistoryError('')
    setError('')
    setQuoteLoading(false)
    setHistoryLoading(false)
  }

  function changeMode(next: 'market' | 'manual') {
    changeInvestment()
    setMode(next)
    setCostMethod('average')
    setQuantity('')
    setCost('')
    setPurchaseDate('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (quoteLoading || historical && historyLoading || !validCurrency(currency) || !symbol
      || !validAmount(qty, true) || !validAmount(actualCost) || !validAmount(actualPrice) || market && !currentQuote) {
      setError('Choose an investment and enter a valid quantity and buy price.'); return
    }
    if (purchaseDate && purchaseDate > today) { setError('Purchase date cannot be in the future.'); return }
    if (holdings.some((item) => item.symbol === symbol && item.id !== holding?.id)) { setError(`${symbol} is already in your portfolio. Edit its existing holding.`); return }
    onSave({
      id: holding?.id ?? crypto.randomUUID(), symbol,
      name: (market ? currentQuote?.name || selected?.name || symbol : manualName.trim() || symbol).slice(0, 80),
      type: market ? selected!.type : type, currency, exchange: market ? currentQuote?.exchange || selected?.exchange : undefined,
      originalCurrency: market ? currentQuote?.originalCurrency : undefined,
      quantity: qty, cost: actualCost, price: actualPrice, updatedAt: new Date().toISOString(), priceSource: mode,
      costMethod: historical ? 'historical' : 'average', purchaseDate: purchaseDate || undefined,
      historicalPriceDate: historical ? currentHistory?.priceDate : undefined,
      quoteAsOf: market ? currentQuote?.asOf : undefined, quoteFetchedAt: market ? currentQuote?.fetchedAt : undefined,
      quoteKind: market ? currentQuote?.priceKind : undefined,
    })
  }

  const showDetails = !market || !!currentQuote
  const canSave = showDetails && validAmount(qty, true) && validAmount(actualCost) && validAmount(actualPrice) && !quoteLoading && !(historical && (historyLoading || !currentHistory))

  return <dialog ref={dialog} className="holding-dialog market-editor search-editor" aria-labelledby="editor-title" aria-describedby="editor-description" onCancel={onClose}>
    <div className="editor-heading"><div><h2 id="editor-title">{holding ? 'Edit holding' : 'Add a holding'}</h2><p id="editor-description">{market ? 'Search, select, and add your position.' : 'Track cash or an investment with a manual price.'}</p></div><button className="icon-button" aria-label="Close holding form" onClick={onClose}>×</button></div>
    <form onSubmit={submit} className="holding-form">
      {(!market || !selected) && <div className="entry-mode" role="group" aria-label="Holding entry method"><button type="button" aria-pressed={market} onClick={() => { if (!market) changeMode('market') }}>Find an investment</button><button type="button" aria-pressed={!market} onClick={() => { if (market) changeMode('manual') }}>Enter manually</button></div>}
      {market && !selected && <AssetSearch onSelect={selectAsset} />}
      {market && selected && <div className="selected-investment">
        <div className="selected-asset-heading"><span className="asset-monogram" aria-hidden="true">{selected.symbol.slice(0, 2)}</span><div><strong>{selected.name}</strong><span>{selected.symbol} · {currentQuote?.exchange || selected.exchange} · {selected.type}</span></div><button type="button" onClick={changeInvestment}>Change</button></div>
        {currentQuote && <div className="selected-asset-price"><div><strong>{money(currentQuote.price, true)}</strong><span className="trading-currency">Trades in {currency}</span></div><small>{displayQuoteTime(currentQuote.asOf)} · {currentQuote.priceKind === 'daily_close' ? 'Daily close' : 'Latest available'} · Yahoo Finance</small></div>}
        <div role="status">{quoteLoading && <p className="lookup-status">Fetching price and trading currency…</p>}{quoteError && <p className="error">{quoteError} <button className="inline-action" type="button" onClick={() => { setQuote(null); setQuoteAttempt((value) => value + 1) }}>Retry</button></p>}</div>
      </div>}
      {!market && <>
        <div className="editor-grid"><label>Asset type<select value={type} onChange={(event) => { const next = event.target.value as AssetType; setType(next); if (next === 'Cash') { setCost('1'); setManualPrice('1'); setManualSymbol(tradeCurrency); setManualName(`${tradeCurrency} cash`) } }}>{assetTypes.map((asset) => <option key={asset}>{asset}</option>)}</select></label><label>Trading currency<select value={tradeCurrency} onChange={(event) => { setTradeCurrency(event.target.value); setCost(type === 'Cash' ? '1' : ''); setManualPrice(type === 'Cash' ? '1' : ''); if (type === 'Cash') { setManualSymbol(event.target.value); setManualName(`${event.target.value} cash`) } }}>{[...new Set([...currencies, tradeCurrency])].map((item) => <option key={item}>{item}</option>)}</select></label></div>
        {type !== 'Cash' && <div className="editor-grid"><label>Symbol<input value={manualSymbol} onChange={(event) => setManualSymbol(event.target.value.toUpperCase())} maxLength={24} placeholder="Ticker or identifier" required /></label><label>Name<input value={manualName} onChange={(event) => setManualName(event.target.value)} maxLength={80} placeholder="Optional" /></label></div>}
      </>}
      {showDetails && <>
        <div className="position-fields"><label>{type === 'Cash' && !market ? 'Cash amount' : 'Quantity'}<input name="quantity" type="number" step="any" min="0.00000001" max="1000000000000" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="e.g. 10" required /></label>
          {!historical && (market || type !== 'Cash') && <label>Average buy price<div className="currency-input"><input name="cost" aria-label={`Average buy price (${currency})`} type="number" step="any" min="0" max="1000000000000" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="0.00" required /><span aria-hidden="true">{currency}</span></div></label>}
        </div>
        {market && ['GBp', 'GBX'].includes(currentQuote?.originalCurrency ?? '') && <p className="native-currency-note">Enter prices in pounds (GBP), not pence. 100p = GBP 1.</p>}
        {market && <button type="button" className="date-method-toggle" onClick={() => { setCostMethod(historical ? 'average' : 'historical'); setHistory(null); setHistoryError(''); setHistoryLoading(false) }}>{historical ? '← Enter my actual buy price' : 'Estimate buy price from a date'}</button>}
        {historical ? <div className="historical-entry"><label>Purchase date<input type="date" value={purchaseDate} max={today} min="1900-01-01" onChange={(event) => { setPurchaseDate(event.target.value); setHistory(null); setHistoryError(''); setHistoryLoading(false) }} required /></label><p className="editor-hint">Estimates the closing price on this date or the next trading day. Use the shares you hold today.</p>
          <div role="status">{historyLoading && <p className="lookup-status">Looking up the purchase-date price…</p>}{purchaseDate >= today && <p className="error">Choose a past date, or enter your actual buy price.</p>}{historyError && <p className="error">{historyError} <button type="button" className="inline-action" onClick={() => setHistoryAttempt((value) => value + 1)}>Retry</button></p>}{currentHistory && <p className="historical-price">Estimated buy price: <strong>{money(currentHistory.price, true)}</strong><small>Close on {currentHistory.priceDate}{currentHistory.priceDate !== purchaseDate ? ` · Next trading session after ${purchaseDate}` : ''}</small></p>}</div>
        </div> : <div className="purchase-date-field"><label>Purchase date<input type="date" value={purchaseDate} max={today} min="1900-01-01" onChange={(event) => setPurchaseDate(event.target.value)} /></label><p className="editor-hint">Used to calculate currency gains and losses.</p></div>}
        {!market && type !== 'Cash' && <label>Current price ({currency})<input type="number" step="any" min="0" max="1000000000000" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="0.00" required /></label>}
        {validAmount(qty, true) && validAmount(actualCost) && validAmount(actualPrice) && <div className="purchase-summary" aria-live="polite"><div><span>{historical ? 'Estimated purchase cost' : `Purchase cost (${currency})`}</span><strong>{money(qty * actualCost)}</strong></div><div><span>Current value</span><strong>{money(qty * actualPrice)}</strong></div></div>}
        <details className="editor-notes"><summary>Pricing notes</summary><p>{market ? 'Market prices may be delayed. ' : ''}Buy prices and this preview use the trading currency. Portfolio returns include currency movements when a purchase date is added. One average price and date approximate purchases made across several dates. Returns exclude fees and dividends; use split-adjusted buy prices.</p></details>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="editor-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button>{showDetails && <button type="submit" disabled={!canSave}>{holding ? 'Save changes' : 'Add holding'}</button>}</div>
    </form>
  </dialog>
}
