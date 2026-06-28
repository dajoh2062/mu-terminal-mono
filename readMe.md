Frontend:        Vercel
Spring Boot API: Render
Python service:  Render
Database:        Supabase Postgres

Hetzner VPS
  ├─ React frontend served by Nginx/Caddy
  ├─ Spring Boot API container
  ├─ Python marketData container
  └─ Postgres container
  

Docker Postgres       → localhost:5432
Python FastAPI        → localhost:8001
Spring Boot API       → localhost:8080
React frontend        → localhost:5173


