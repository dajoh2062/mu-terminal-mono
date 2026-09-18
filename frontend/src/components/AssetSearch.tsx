import { useEffect, useId, useState } from 'react'
import { searchAssets } from '../lib/market'
import type { AssetSearchResult } from '../lib/market'

export default function AssetSearch({ onSelect }: { onSelect: (asset: AssetSearchResult) => void }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [active, setActive] = useState(-1)
  const [search, setSearch] = useState<{ query: string; results: AssetSearchResult[]; status: 'loading' | 'ready' | 'error'; error?: string } | null>(null)
  const term = query.trim()
  const results = search?.query === term && search.status === 'ready' ? search.results : []
  const loading = term.length >= 2 && (search?.query !== term || search.status === 'loading')
  const expanded = term.length >= 2

  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, id])

  useEffect(() => {
    if (term.length < 2) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setSearch({ query: term, results: [], status: 'loading' })
      try {
        const matches = await searchAssets(term, controller.signal)
        if (!controller.signal.aborted) setSearch({ query: term, results: matches, status: 'ready' })
      } catch (error) {
        if (!controller.signal.aborted) setSearch({ query: term, results: [], status: 'error', error: error instanceof Error ? error.message : 'Search unavailable.' })
      }
    }, 350)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [term, attempt])

  return <div className="asset-search">
    <label htmlFor={id}>Find an investment</label>
    <div className="asset-search-input">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
      <input id={id} name="asset-search" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`} aria-activedescendant={active >= 0 && results[active] ? `${id}-${active}` : undefined}
        autoComplete="off" placeholder="Search a company, ticker, or fund" maxLength={80} value={query}
        onChange={(event) => { setQuery(event.target.value); setActive(-1) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); setActive((index) => (index + 1) % results.length) }
          if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); setActive((index) => (index <= 0 ? results.length : index) - 1) }
          if (event.key === 'Enter') { event.preventDefault(); if (results.length) onSelect(results[Math.max(active, 0)]) }
          if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); setActive(-1) }
        }} />
    </div>
    {!expanded && <div className="search-intro"><p>Search by name and choose the exchange you trade on.</p><div>{['Apple', 'Equinor', 'Bitcoin'].map((example) => <button type="button" key={example} onClick={() => { setQuery(example); setActive(-1) }}>{example} <span aria-hidden="true">↗</span></button>)}</div></div>}
    <div className="search-status" role="status" aria-live="polite">
      {loading && <p>Searching investments…</p>}
      {search?.query === term && search.status === 'ready' && !results.length && expanded && <p>No investments found. Try a company name or an exchange-specific ticker.</p>}
      {search?.query === term && search.status === 'error' && expanded && <p>{search.error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry search</button></p>}
    </div>
    <ul id={`${id}-results`} className="asset-results" role="listbox" aria-label="Investment search results">
      {results.map((asset, index) => <li id={`${id}-${index}`} key={asset.symbol} role="option" aria-selected={active === index} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(asset)}>
        <span className="result-symbol">{asset.symbol}</span>
        <span className="result-description"><strong>{asset.name}</strong><small>{asset.exchange || 'Exchange not provided'} · {asset.type}{asset.currency ? ` · ${asset.currency}` : ''}</small></span>
        <span className="result-arrow" aria-hidden="true">↗</span>
      </li>)}
    </ul>
    {results.length > 0 && <p className="search-footnote">Select a listing to verify its latest price and trading currency.</p>}
  </div>
}
