
Database:

docker compose -f infra/docker-compose.yml up -d
docker exec -it mu-terminal-postgres psql -U finance -d finance
docker ps

Postgres:
\q

Python:
source .venv/bin/activate
uvicorn app.main:app --reload --port 8001
deactivate

Java:
cd ~/Desktop/mu-terminal-mono/backend/api
./mvnw spring-boot:run

Start postrgresql:
docker compose -f infra/docker-compose.yml up -d

start python service:
cd backend/marketData
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

start backend:
cd backend/api
./mvnw spring-boot:run

react frontend:
cd frontend
npm install
npm run dev

## Portfolio market prices

The portfolio supports searchable investments and manual holdings. Click **Add holding**,
search by company name or ticker, and choose the correct exchange. The latest quote
automatically verifies the listing's trading currency. Enter shares held today and an
average buy price in that currency, or choose **Estimate from a date**. Review the
purchase cost, current value, and price return before saving.

- Quotes include their currency, provider timestamp, fetch time, and daily-close fallback status.
- Market holdings refresh on opening Portfolio and every 60 seconds while the page is visible.
  Failed refreshes preserve saved prices and display a warning. Backend quotes are cached for 60 seconds.
- Date-based costs use the first completed trading session on/after the selected date,
  within seven days. They are explicitly estimates, using split-adjusted closes (not
  dividend-adjusted prices). Enter current shares and split-adjusted average cost.
  Actual execution time/price, fees, dividends, sales, and future share-count adjustments
  are not imported from a broker.
- Buy and current unit prices stay in the asset's trading currency. **Display currency**
  controls holding values, costs, gains, return percentages, and portfolio totals.
  Current values use current FX; costs use purchase-date FX. Returns therefore include
  currency movements. The separate FX effect is native purchase cost × (current rate −
  purchase rate). For example, USD 100 with no price change, bought at USD/NOK 10 and
  valued at 11, has NOK 1,000 cost, NOK 1,100 value, and a 10% NOK return (0% in USD).
- Add a **Purchase date** for foreign-currency returns. Existing holdings without a date
  retain their values and allocation but withhold converted costs and returns until a
  date is added. Missing purchase FX does the same; missing current FX withholds combined
  values. Failed refreshes retain saved current rates with a warning.
- Purchase FX uses the daily rate on that date or the latest available rate within the
  preceding seven days. Historical-price estimates use the actual price session date.
  Historical FX is stored by currency pair and date; changing the date or display currency
  fetches the corresponding rate. Select a holding and expand **Price & currency details**
  to see its rates and dates.
  Daily FX approximates execution conversion costs; a single average cost and purchase
  date also approximates positions accumulated across multiple dates.
- London quotes denominated in GBp/GBX are normalized to GBP; enter buy prices in GBP.
- Choose **Enter manually** for cash, offline assets, or manual prices, with an explicit
  currency. Existing local holdings inherit their previously selected portfolio currency.
  Holdings still save in this browser, not the database.

The portfolio overview shows value, return, and invested cost. Search or filter holdings
by asset type; click Asset, Value, or Return to sort in either direction. Select an asset
or allocation label to inspect its position and return breakdown, edit it, or remove it.
Removal offers Undo. **About these figures** contains the calculation assumptions.
Cash entry only needs a currency, amount, and optional purchase date.

Standard service ports remain 8001 (Python), 8080 (Java), and 5173 (frontend).
For a second checkout, the preview can use isolated ports:

```sh
# From backend/marketData
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8002

# From backend/api (PostgreSQL must be running as above)
./mvnw spring-boot:run -Dspring-boot.run.arguments="--server.port=8081 --server.address=127.0.0.1 --market-data.base-url=http://127.0.0.1:8002"
```

Set `MU_API_TARGET=http://127.0.0.1:8081` in the ignored `frontend/.env.local`
for this isolated setup, then start/restart `npm run dev` from `frontend`.
Remove that override to use the standard API port.

Checks:

```sh
# From frontend (Node 22.18+ for native TypeScript test imports)
npm run build
npm run lint
npm test

# From backend/marketData
.venv/bin/python -m unittest discover -s tests -v

# From backend/api (PostgreSQL for the application-context test)
./mvnw test
```
