from fastapi import FastAPI, HTTPException
import yfinance as yf

app = FastAPI(title="Market Data Service")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/quotes/{ticker}")
def get_quote(ticker: str):
    symbol = ticker.upper().strip()

    try:
        asset = yf.Ticker(symbol)
        history = asset.history(period="5d")

        if history.empty:
            raise HTTPException(status_code=404, detail=f"No data found for {symbol}")

        latest = history.tail(1).iloc[0]

        return {
            "ticker": symbol,
            "close": float(latest["Close"]),
            "open": float(latest["Open"]),
            "high": float(latest["High"]),
            "low": float(latest["Low"]),
            "volume": int(latest["Volume"]),
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))