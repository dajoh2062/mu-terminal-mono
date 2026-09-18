
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
cd ~/Desktop/mu_terminal_mono/backend/api
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
cd 
backend/api
./mvnw spring-boot:run

react frontend:
cd frontend
npm install
npm run dev