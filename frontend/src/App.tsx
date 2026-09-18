import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import Portfolio from './components/Portfolio'

const pages = [
  { id: 'home', label: 'Home', description: 'Your perspective on the market.' },
  { id: 'portfolio', label: 'Portfolio', description: 'A clearer view of what you own.' },
  { id: 'markets', label: 'Markets', description: 'Explore the bigger picture.' },
  { id: 'news', label: 'News', description: 'Stay close to the stories that matter.' },
  { id: 'sheets', label: 'Sheets', description: 'Make room for your own analysis.' },
  { id: 'plots', label: 'Plots', description: 'See your data from a new perspective.' },
] as const

function currentPage() {
  return pages.find((page) => `#/${page.id}` === window.location.hash) ?? pages[0]
}

type Quote = { ticker: string; close: number; open: number; high: number; low: number; volume: number }

function App() {
  const [page, setPage] = useState(currentPage)
  const [ticker, setTicker] = useState('AAPL')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const onNavigate = () => setPage(currentPage())
    window.addEventListener('hashchange', onNavigate)
    return () => window.removeEventListener('hashchange', onNavigate)
  }, [])

  useEffect(() => { document.title = `${page.label} · MU Terminal` }, [page])

  async function fetchQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const symbol = ticker.trim().toUpperCase()
    if (!symbol || loading) return
    setLoading(true)
    setError('')
    setQuote(null)
    try {
      const response = await fetch(`/api/market/quotes/${encodeURIComponent(symbol)}`)
      if (!response.ok) throw new Error('Could not fetch quote')
      setQuote(await response.json())
    } catch {
      setError('We couldn’t load this quote. Check the symbol and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="terminal">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault()
        document.getElementById('main-content')?.focus()
      }}>Skip to content</a>
      <header className="header">
        <div className="header-inner">
          <a className="brand" href="#/home" aria-label="MU Terminal home">
            <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 18V6M4 18h16M8 14l4-5 4 3 4-7" /></svg>
            <span className="brand-name">MU Terminal</span>
          </a>
          <nav className="navigation" aria-label="Main navigation">
            {pages.map((item) => (
              <a key={item.id} href={`#/${item.id}`} className={`nav-link${page.id === item.id ? ' active' : ''}`} aria-current={page.id === item.id ? 'page' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="workspace-label">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3" /><path d="M3 8h14M8 8v9" /></svg>
            Personal workspace
          </div>
        </div>
      </header>
      <main className="main" id="main-content" tabIndex={-1}>
        {page.id !== 'portfolio' && <div className="page-heading">
          <h1>{page.label}</h1>
          <p className="page-description">{page.description}</p>
        </div>}
        {page.id === 'home' ? (
          <section className="quote-card" aria-labelledby="quote-heading">
            <div className="card-heading">
              <div>
                <p className="section-label">Market overview</p>
                <h2 id="quote-heading">Quote lookup</h2>
              </div>
              <p className="card-description">Look up a security to see its latest available quote.</p>
            </div>
            <div className="lookup-row">
              <div className="lookup-description">
                <h3>Security</h3>
                <p>Search by ticker symbol.</p>
              </div>
              <form onSubmit={fetchQuote}>
              <label htmlFor="ticker">Ticker symbol</label>
              <div className="form-row">
                <div className="ticker-field">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
                  <input id="ticker" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="e.g. AAPL" autoComplete="off" spellCheck={false} required />
                </div>
                <button type="submit" disabled={loading || !ticker.trim()}>{loading ? 'Loading…' : 'Get quote'}</button>
              </div>
              </form>
            </div>
            <div aria-live="polite" aria-busy={loading}>
              {error && <p className="error" role="alert">{error}</p>}
              {quote && (
                <div className="quote-result">
                  <h3>{quote.ticker}</h3>
                  <dl>{(['close', 'open', 'high', 'low', 'volume'] as const).map((field) => (
                    <div key={field}><dt>{field}</dt><dd>{field === 'volume' ? quote[field].toLocaleString() : quote[field].toFixed(2)}</dd></div>
                  ))}</dl>
                </div>
              )}
            </div>
          </section>
        ) : page.id === 'portfolio' ? <Portfolio /> : (
          <section className="empty-state" aria-labelledby="empty-heading">
            <h2 id="empty-heading">Your {page.label.toLowerCase()} workspace</h2>
            <p>{page.label} features are coming next.</p>
            <a className="back-link" href="#/home">Back to Home <span aria-hidden="true">→</span></a>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
