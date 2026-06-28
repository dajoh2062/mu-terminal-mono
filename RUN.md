
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