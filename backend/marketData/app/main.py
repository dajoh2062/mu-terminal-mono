from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
import logging
import math
import re
from threading import Lock
from time import monotonic

from fastapi import FastAPI, HTTPException, Query
import yfinance as yf
from yfinance.exceptions import YFPricesMissingError, YFRateLimitError, YFTzMissingError

app = FastAPI(title="Market Data Service")
logger = logging.getLogger(__name__)
_cache = OrderedDict()
_cache_lock = Lock()
ASSET_TYPES = {"EQUITY": "Stock", "ETF": "ETF", "MUTUALFUND": "Fund", "CRYPTOCURRENCY": "Crypto", "BOND": "Bond"}


def normalize_symbol(ticker: str) -> str:
    symbol = ticker.strip().upper()
    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=\-]{0,23}", symbol):
        raise HTTPException(400, "Enter a valid market symbol, such as AAPL, EQNR.OL, or BTC-USD.")
    return symbol


def currency_details(metadata):
    currency = metadata.get("currency")
    # Yahoo quotes some London instruments in pence, not pounds.
    if currency in ("GBp", "GBX"):
        return "GBP", 0.01
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise HTTPException(422, "The provider did not return a supported quote currency.")
    return currency, 1


def positive_number(value):
    try:
        return math.isfinite(float(value)) and float(value) > 0
    except (ValueError, TypeError):
        return False


def provider_history(asset, **kwargs):
    try:
        history = asset.history(auto_adjust=False, timeout=12, raise_errors=True, **kwargs)
        if history.empty:
            raise HTTPException(404, "No market prices found for this symbol or date.")
        history = history[history["Close"].apply(positive_number)]
        if history.empty:
            raise HTTPException(404, "No valid prices found for this symbol or date.")
        return history.sort_index(), asset.get_history_metadata()
    except HTTPException:
        raise
    except YFRateLimitError:
        raise HTTPException(503, "The price provider is busy. Please try again shortly.")
    except (YFPricesMissingError, YFTzMissingError):
        raise HTTPException(404, "No market prices found. Check the symbol and exchange suffix.")
    except Exception:
        logger.exception("Market data lookup failed")
        raise HTTPException(502, "Market data is temporarily unavailable. Please try again.")


def cached(key, fetch):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and entry[0] > monotonic():
            _cache.move_to_end(key)
            return entry[1]
    result = fetch()
    with _cache_lock:
        _cache[key] = (monotonic() + 60, result)
        _cache.move_to_end(key)
        while len(_cache) > 256:
            _cache.popitem(last=False)
    return result


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/quotes/{ticker}")
def get_quote(ticker: str):
    symbol = normalize_symbol(ticker)

    def fetch():
        history, metadata = provider_history(yf.Ticker(symbol), period="5d", interval="1d")
        currency, scale = currency_details(metadata)
        latest = history.iloc[-1]
        timestamp = history.index[-1]
        price = float(latest["Close"])
        as_of = timestamp.to_pydatetime().isoformat()
        kind = "daily_close"
        market_time = metadata.get("regularMarketTime")
        market_price = metadata.get("regularMarketPrice")
        if positive_number(market_price) and positive_number(market_time) and float(market_time) >= timestamp.timestamp():
            price = float(market_price)
            as_of = datetime.fromtimestamp(float(market_time), timezone.utc).isoformat()
            kind = "latest_quote"
        return {
            "ticker": symbol,
            "name": metadata.get("longName") or metadata.get("shortName") or symbol,
            "currency": currency,
            "originalCurrency": metadata.get("currency"),
            "exchange": metadata.get("fullExchangeName") or metadata.get("exchangeName") or "",
            "assetType": ASSET_TYPES.get(metadata.get("instrumentType"), "Other"),
            "price": price * scale,
            "asOf": as_of,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "priceKind": kind,
            "source": "Yahoo Finance",
            "close": float(latest["Close"]) * scale,
            "open": float(latest["Open"]) * scale,
            "high": float(latest["High"]) * scale,
            "low": float(latest["Low"]) * scale,
            "volume": int(latest["Volume"]) if math.isfinite(float(latest["Volume"])) else 0,
        }

    return cached(("quote", symbol), fetch)


@app.get("/quotes/{ticker}/history")
def get_historical_quote(ticker: str, purchase_date: date):
    symbol = normalize_symbol(ticker)
    today = datetime.now(timezone.utc).date()
    if purchase_date < date(1900, 1, 1) or purchase_date >= today:
        raise HTTPException(400, "Choose a past purchase date. For a purchase today, enter your actual average price.")

    def fetch():
        # The first completed trading session on/after the requested date, within a week.
        end = min(purchase_date + timedelta(days=8), today)
        history, metadata = provider_history(
            yf.Ticker(symbol), start=purchase_date.isoformat(), end=end.isoformat(), interval="1d"
        )
        history = history[(history.index.date >= purchase_date) & (history.index.date < end)]
        if history.empty:
            raise HTTPException(404, "No completed trading session found within a week of that date.")
        currency, scale = currency_details(metadata)
        return {
            "ticker": symbol,
            "currency": currency,
            "price": float(history.iloc[0]["Close"]) * scale,
            "requestedDate": purchase_date.isoformat(),
            "priceDate": history.index[0].date().isoformat(),
            "priceKind": "historical_close",
            "source": "Yahoo Finance",
            "splitAdjusted": True,
        }

    return cached(("history", symbol, purchase_date.isoformat()), fetch)


@app.get("/search")
def search_assets(q: str = Query(min_length=2, max_length=80)):
    query = q.strip()
    if len(query) < 2:
        return {"results": []}

    def fetch():
        try:
            quotes = yf.Search(query, max_results=10, news_count=0, lists_count=0,
                               recommended=0, include_cb=False, timeout=10).quotes
        except YFRateLimitError:
            raise HTTPException(503, "Search is busy. Please try again shortly.")
        except Exception:
            logger.exception("Asset search failed")
            raise HTTPException(502, "Search is temporarily unavailable. Please try again.")
        results = []
        seen = set()
        for item in quotes:
            symbol = item.get("symbol", "")
            if not isinstance(symbol, str) or not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=\-]{0,23}", symbol):
                continue
            if symbol in seen or item.get("quoteType") not in ASSET_TYPES:
                continue
            seen.add(symbol)
            # Search does not consistently include currency. The selected quote is authoritative.
            raw_currency = item.get("currency")
            currency = "GBP" if raw_currency in ("GBp", "GBX") else raw_currency
            results.append({
                "symbol": symbol,
                "name": item.get("longname") or item.get("shortname") or symbol,
                "exchange": item.get("exchDisp") or item.get("exchange") or "",
                "type": ASSET_TYPES[item["quoteType"]],
                "currency": currency if isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency) else None,
            })
        return {"results": results}

    return cached(("search", query.casefold()), fetch)


@app.get("/fx/{source}/{target}")
def get_exchange_rate(source: str, target: str):
    source, target = source.upper(), target.upper()
    if not re.fullmatch(r"[A-Z]{3}", source) or not re.fullmatch(r"[A-Z]{3}", target):
        raise HTTPException(400, "Use three-letter currency codes.")
    if source == target:
        now = datetime.now(timezone.utc).isoformat()
        return {"from": source, "to": target, "rate": 1, "asOf": now, "fetchedAt": now}
    quote = get_quote(f"{source}{target}=X")
    if quote["currency"] != target:
        raise HTTPException(502, "The provider returned an unexpected exchange-rate currency.")
    return {"from": source, "to": target, "rate": quote["price"],
            "asOf": quote["asOf"], "fetchedAt": quote["fetchedAt"]}


@app.get("/fx/{source}/{target}/history")
def get_historical_exchange_rate(source: str, target: str, purchase_date: date):
    source, target = source.upper(), target.upper()
    if not re.fullmatch(r"[A-Z]{3}", source) or not re.fullmatch(r"[A-Z]{3}", target):
        raise HTTPException(400, "Use three-letter currency codes.")
    if purchase_date < date(1900, 1, 1) or purchase_date > datetime.now(timezone.utc).date():
        raise HTTPException(400, "Choose a purchase date today or in the past.")

    def fetch():
        rate_date = purchase_date.isoformat()
        rate = 1
        as_of = f"{rate_date}T00:00:00+00:00"
        if source != target:
            start, end = purchase_date - timedelta(days=7), purchase_date + timedelta(days=1)
            history, metadata = provider_history(yf.Ticker(f"{source}{target}=X"),
                                                start=start.isoformat(), end=end.isoformat(), interval="1d")
            history = history[(history.index.date >= start) & (history.index.date <= purchase_date)]
            if history.empty:
                raise HTTPException(404, "No exchange rate found on or within seven days before the purchase date.")
            currency, scale = currency_details(metadata)
            if currency != target:
                raise HTTPException(502, "The provider returned an unexpected exchange-rate currency.")
            rate = float(history.iloc[-1]["Close"]) * scale
            rate_date = history.index[-1].date().isoformat()
            as_of = history.index[-1].to_pydatetime().isoformat()
        return {"from": source, "to": target, "rate": rate, "requestedDate": purchase_date.isoformat(),
                "rateDate": rate_date, "asOf": as_of, "fetchedAt": datetime.now(timezone.utc).isoformat()}

    return cached(("historical_fx", source, target, purchase_date.isoformat()), fetch)
