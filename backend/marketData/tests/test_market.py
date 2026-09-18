import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timezone
import pandas as pd
from fastapi import HTTPException
from yfinance.exceptions import YFRateLimitError
from app import main


def frame(dates, closes):
    return pd.DataFrame({"Open": closes, "High": closes, "Low": closes, "Close": closes, "Volume": [10] * len(dates)}, index=pd.to_datetime(dates, utc=True))


class MarketTests(unittest.TestCase):
    def setUp(self):
        main._cache.clear()
        self.asset = Mock()
        self.asset.history.return_value = frame(['2024-01-08'], [100.0])
        self.asset.get_history_metadata.return_value = {'currency': 'USD', 'shortName': 'Test company', 'regularMarketPrice': 102, 'regularMarketTime': 1704735000}
        self.patcher = patch.object(main.yf, 'Ticker', return_value=self.asset)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_latest_quote_with_timestamp_and_cache(self):
        quote = main.get_quote(' aapl ')
        self.assertEqual(quote['ticker'], 'AAPL')
        self.assertEqual(quote['price'], 102)
        self.assertEqual(quote['priceKind'], 'latest_quote')
        self.assertEqual(quote['currency'], 'USD')
        self.assertEqual(quote['asOf'], datetime.fromtimestamp(1704735000, timezone.utc).isoformat())
        self.assertEqual(main.get_quote('AAPL'), quote)
        self.asset.history.assert_called_once()
        self.assertFalse(self.asset.history.call_args.kwargs['auto_adjust'])

    def test_missing_intraday_metadata_uses_dated_daily_close(self):
        self.asset.get_history_metadata.return_value = {'currency': 'USD'}
        result = main.get_quote('AAPL')
        self.assertEqual(result['price'], 100)
        self.assertEqual(result['priceKind'], 'daily_close')
        self.assertTrue(result['asOf'].startswith('2024-01-08'))

    def test_pence_normalized_to_pounds(self):
        self.asset.get_history_metadata.return_value = {'currency': 'GBp'}
        self.assertEqual(main.get_quote('VOD.L')['price'], 1)
        self.assertEqual(main.get_quote('VOD.L')['currency'], 'GBP')

    def test_weekend_uses_next_session_and_labels_adjusted_estimate(self):
        result = main.get_historical_quote('AAPL', main.date(2024, 1, 6))
        self.assertEqual(result['requestedDate'], '2024-01-06')
        self.assertEqual(result['priceDate'], '2024-01-08')
        self.assertEqual(result['price'], 100)
        self.assertTrue(result['splitAdjusted'])
        self.assertFalse(self.asset.history.call_args.kwargs['auto_adjust'])

    def test_future_dates_invalid_symbols_and_unknown_currencies_rejected(self):
        for call in [lambda: main.get_historical_quote('AAPL', main.date(2999, 1, 1)), lambda: main.get_quote('../bad')]:
            with self.assertRaises(HTTPException) as error:
                call()
            self.assertEqual(error.exception.status_code, 400)
        self.asset.get_history_metadata.return_value = {}
        with self.assertRaises(HTTPException) as error:
            main.get_quote('AAPL')
        self.assertEqual(error.exception.status_code, 422)

    def test_empty_invalid_and_out_of_range_prices_rejected(self):
        for history in [pd.DataFrame(), frame(['2024-01-08'], [float('nan')]), frame(['2024-01-08'], [0])]:
            self.asset.history.return_value = history
            with self.assertRaises(HTTPException) as error:
                main.get_quote('AAPL')
            self.assertEqual(error.exception.status_code, 404)
        self.asset.history.return_value = frame(['2024-02-01'], [100])
        with self.assertRaises(HTTPException) as error:
            main.get_historical_quote('AAPL', main.date(2024, 1, 6))
        self.assertEqual(error.exception.status_code, 404)

    def test_rate_limit_returns_recoverable_error(self):
        self.asset.history.side_effect = YFRateLimitError()
        with self.assertRaises(HTTPException) as error:
            main.get_quote('AAPL')
        self.assertEqual(error.exception.status_code, 503)

    def test_search_filters_non_assets_and_keeps_listing_details(self):
        search = Mock()
        search.quotes = [
            {'symbol': 'EQNR.OL', 'longname': 'Equinor ASA', 'quoteType': 'EQUITY', 'exchDisp': 'Oslo'},
            {'symbol': 'EQNR', 'shortname': 'Equinor ADR', 'quoteType': 'EQUITY', 'exchDisp': 'NYSE', 'currency': 'USD'},
            {'symbol': 'EQNR.OL', 'quoteType': 'EQUITY'},
            {'symbol': '^GSPC', 'quoteType': 'INDEX'},
            {'symbol': 'bad/symbol', 'quoteType': 'EQUITY'},
        ]
        with patch.object(main.yf, 'Search', return_value=search):
            results = main.search_assets('Equinor')['results']
        self.assertEqual([item['symbol'] for item in results], ['EQNR.OL', 'EQNR'])
        self.assertEqual(results[0]['exchange'], 'Oslo')
        self.assertIsNone(results[0]['currency'])
        self.assertEqual(results[1]['currency'], 'USD')
        self.assertEqual(results[0]['type'], 'Stock')

    def test_search_empty_and_failure(self):
        search = Mock()
        search.quotes = []
        with patch.object(main.yf, 'Search', return_value=search):
            self.assertEqual(main.search_assets('NoResult'), {'results': []})
        with patch.object(main.yf, 'Search', side_effect=YFRateLimitError()):
            with self.assertRaises(HTTPException) as error:
                main.search_assets('AAPL')
            self.assertEqual(error.exception.status_code, 503)

    def test_exchange_rate_uses_correct_pair_and_currency(self):
        quote = {'currency': 'NOK', 'price': 10.5, 'asOf': '2026-09-18T12:00:00Z', 'fetchedAt': '2026-09-18T12:01:00Z'}
        with patch.object(main, 'get_quote', return_value=quote) as get_quote:
            result = main.get_exchange_rate('USD', 'NOK')
            get_quote.assert_called_once_with('USDNOK=X')
            self.assertEqual(result['rate'], 10.5)
            self.assertEqual(result['from'], 'USD')
            self.assertEqual(result['to'], 'NOK')
        with patch.object(main, 'get_quote', return_value={**quote, 'currency': 'USD'}):
            with self.assertRaises(HTTPException):
                main.get_exchange_rate('USD', 'NOK')
        self.assertEqual(main.get_exchange_rate('USD', 'USD')['rate'], 1)
        with self.assertRaises(HTTPException):
            main.get_exchange_rate('bad-code', 'USD')

    def test_historical_fx_uses_purchase_day_or_previous_session_and_caches(self):
        self.asset.history.return_value = frame(['2024-01-04', '2024-01-05', '2024-01-08'], [9.8, 10.0, 11.0])
        self.asset.get_history_metadata.return_value = {'currency': 'NOK'}
        result = main.get_historical_exchange_rate('USD', 'NOK', main.date(2024, 1, 6))
        self.assertEqual(result['rate'], 10)
        self.assertEqual(result['rateDate'], '2024-01-05')
        self.assertEqual(result['requestedDate'], '2024-01-06')
        self.assertEqual(main.get_historical_exchange_rate('USD', 'NOK', main.date(2024, 1, 6)), result)
        self.asset.history.assert_called_once()
        self.assertEqual(self.asset.history.call_args.kwargs['end'], '2024-01-07')
        result = main.get_historical_exchange_rate('USD', 'NOK', main.date(2024, 1, 8))
        self.assertEqual(result['rate'], 11)

    def test_historical_fx_rejects_wrong_currency_future_or_missing_history(self):
        self.asset.get_history_metadata.return_value = {'currency': 'USD'}
        with self.assertRaises(HTTPException):
            main.get_historical_exchange_rate('USD', 'NOK', main.date(2024, 1, 8))
        for day in [main.date(2024, 1, 6), main.date(2024, 2, 1), main.date(2999, 1, 1)]:
            with self.assertRaises(HTTPException):
                main.get_historical_exchange_rate('USD', 'NOK', day)
        with self.assertRaises(HTTPException):
            main.get_historical_exchange_rate('bad-code', 'NOK', main.date(2024, 1, 8))
        self.assertEqual(main.get_historical_exchange_rate('USD', 'USD', main.date(2024, 1, 6))['rate'], 1)


if __name__ == '__main__':
    unittest.main()
