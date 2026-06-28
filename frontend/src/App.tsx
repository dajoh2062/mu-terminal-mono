import { useState } from "react";
import "./App.css";

type Quote = {
  ticker: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
};

function App() {
  const [ticker, setTicker] = useState("AAPL");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchQuote() {
    setLoading(true);
    setError("");
    setQuote(null);

    try {
      const response = await fetch(`/api/market/quotes/${ticker}`);

      if (!response.ok) {
        throw new Error("Could not fetch quote");
      }

      const data = await response.json();
      setQuote(data);
    } catch (err) {
      setError("Something went wrong while fetching the quote.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <h1>MU Terminal</h1>
        <p>Simple finance quote lookup</p>

        <div className="form-row">
          <input
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="AAPL"
          />

          <button onClick={fetchQuote} disabled={loading}>
            {loading ? "Loading..." : "Get quote"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {quote && (
          <div className="quote">
            <h2>{quote.ticker}</h2>
            <p>Close: {quote.close.toFixed(2)}</p>
            <p>Open: {quote.open.toFixed(2)}</p>
            <p>High: {quote.high.toFixed(2)}</p>
            <p>Low: {quote.low.toFixed(2)}</p>
            <p>Volume: {quote.volume.toLocaleString()}</p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;