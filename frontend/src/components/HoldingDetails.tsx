import { useEffect, useRef } from 'react'
import { convertedTotals, convertedValue, purchaseRateDate } from '../lib/portfolio'
import type { Holding, Portfolio } from '../lib/portfolio'
import { displayQuoteTime } from '../lib/market'

type Props = { holding: Holding; portfolio: Portfolio; onClose: () => void; onEdit: () => void; onRemove: () => void }

export default function HoldingDetails({ holding, portfolio, onClose, onEdit, onRemove }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])
  const nativeCurrency = holding.currency ?? portfolio.currency
  const foreign = nativeCurrency !== portfolio.currency
  const metrics = convertedValue(holding, portfolio)
  const total = convertedTotals(portfolio).value
  const date = purchaseRateDate(holding)
  const purchaseRate = portfolio.historicalExchangeRates?.[`${nativeCurrency}:${portfolio.currency}:${date}`]
  const currentRate = portfolio.exchangeRates?.[`${nativeCurrency}:${portfolio.currency}`]
  const money = (value: number | null, currency = portfolio.currency as string, precise = false) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: precise ? 8 : 2 }).format(value)
  const signed = (value: number | null) => `${value !== null && value > 0 ? '+' : ''}${money(value)}`
  const gainTone = metrics.gain !== null && metrics.gain > 0 ? 'positive' : metrics.gain !== null && metrics.gain < 0 ? 'negative' : ''

  return <dialog ref={dialog} className="holding-dialog holding-details" aria-labelledby="holding-detail-title" onCancel={onClose}>
    <div className="editor-heading"><div><span className="detail-symbol">{holding.symbol} · {holding.exchange || holding.type}</span><h2 id="holding-detail-title">{holding.name}</h2></div><button className="icon-button" aria-label="Close holding details" onClick={onClose}>×</button></div>
    <div className="detail-value"><span>Market value</span><strong>{money(metrics.value)}</strong><p className={gainTone}>{signed(metrics.gain)}{metrics.percent !== null ? ` (${metrics.percent > 0 ? '+' : ''}${metrics.percent.toFixed(2)}%)` : ''}<span className="muted"> since purchase</span></p></div>
    {holding.quoteError && <p className="detail-warning" role="status">Showing the saved price. {holding.quoteError}</p>}
    {metrics.basis === null && <p className="detail-warning">{!date ? 'Add a purchase date to calculate your return in this currency.' : 'The purchase-date exchange rate is unavailable. Try refreshing prices.'}</p>}
    <dl className="detail-list">
      <div><dt>Quantity</dt><dd>{holding.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}</dd></div>
      <div><dt>Average buy price</dt><dd>{money(holding.cost, nativeCurrency, true)}</dd></div>
      <div><dt>Current unit price</dt><dd>{money(holding.price, nativeCurrency, true)}</dd></div>
      <div><dt>Purchase date</dt><dd>{holding.purchaseDate || 'Not added'}</dd></div>
      <div><dt>Purchase cost{foreign || holding.costMethod === 'historical' ? ' (estimated)' : ''}</dt><dd>{money(metrics.basis)}</dd></div>
      <div><dt>Portfolio weight</dt><dd>{total && metrics.value !== null ? `${(metrics.value / total * 100).toFixed(1)}%` : '—'}</dd></div>
    </dl>
    {foreign && <div className="detail-breakdown"><h3>Return breakdown <span>{portfolio.currency}</span></h3><dl className="detail-list"><div><dt>Price movement</dt><dd>{signed(metrics.priceGain)}</dd></div><div><dt>Currency movement</dt><dd>{signed(metrics.fxGain)}</dd></div><div className="detail-total"><dt>Total return</dt><dd className={gainTone}>{signed(metrics.gain)}</dd></div></dl></div>}
    <details className="detail-source"><summary>Price & currency details</summary><div>
      <p>{holding.priceSource === 'market' ? `Yahoo Finance · ${holding.quoteKind === 'daily_close' ? 'Daily close' : 'Latest quote'} · ${displayQuoteTime(holding.quoteAsOf)}` : `Manual price · Entered ${displayQuoteTime(holding.updatedAt)}`}</p>
      {holding.priceSource === 'market' && <p>Fetched {displayQuoteTime(holding.quoteFetchedAt)}. Quotes may be delayed.</p>}
      {holding.costMethod === 'historical' && <p>Buy price estimated from the split-adjusted close on {holding.historicalPriceDate}.</p>}
      {foreign && <><p>Purchase FX: {purchaseRate ? `1 ${nativeCurrency} = ${purchaseRate.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${portfolio.currency} · ${purchaseRate.rateDate}` : 'Unavailable'}</p><p>Current FX: {currentRate ? `1 ${nativeCurrency} = ${currentRate.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${portfolio.currency} · ${displayQuoteTime(currentRate.asOf)}` : 'Unavailable'}</p><p>Daily FX estimates your conversion cost. Price movement is translated at current FX; currency movement is the FX effect on your original cost.</p></>}
      <p>Returns exclude fees, dividends, and realized gains.</p>
    </div></details>
    <div className="detail-actions"><button className="remove-holding" onClick={onRemove}>Remove holding</button><button onClick={onEdit}>Edit holding</button></div>
  </dialog>
}
