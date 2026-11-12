#!/bin/bash
# Tạo 6 database và 6 user riêng cho 6 service (ADR-0003).
# Chỉ chạy một lần khi volume pgdata còn trống. Đổi file này thì phải `docker compose down -v`.
set -euo pipefail

for svc in identity catalog promotion order notification assistant; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE USER ${svc}_user WITH PASSWORD '${svc}_pass';
CREATE DATABASE ${svc}_db OWNER ${svc}_user;
REVOKE CONNECT ON DATABASE ${svc}_db FROM PUBLIC;
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${svc}_db" \
    -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
done
