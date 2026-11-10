#!/usr/bin/env bash
# One-shot local setup: dependencies, shared packages, database, assets and the
# Chơn Thành OSM import (from the committed fixture, so it works offline).
#
#   ./infrastructure/scripts/bootstrap.sh            # uses the fixture
#   OSM_SOURCE=osm-api ./infrastructure/scripts/bootstrap.sh   # live OSM API
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example"; }
set -a; . ./.env; set +a

echo "==> Waiting for PostgreSQL at ${DATABASE_URL%%\?*}"
for _ in $(seq 1 30); do
  if psql "$DATABASE_URL" -Atc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 2
done
psql "$DATABASE_URL" -Atc 'select 1' >/dev/null || { echo "Database not reachable. Start it with: docker compose -f infrastructure/docker/docker-compose.yml up -d"; exit 1; }

echo "==> Installing Node dependencies"
pnpm install

echo "==> Installing Python dependencies for the importer"
python3 -m pip install -q -r services/map-importer/requirements.txt

echo "==> Building shared packages"
pnpm build:packages

echo "==> Generating 3D assets"
pnpm assets:build

echo "==> Migrating and seeding the database"
pnpm db:migrate
pnpm db:seed

SOURCE="${OSM_SOURCE:-file}"
echo "==> Importing OSM data for chon-thanh (source: $SOURCE)"
if [ "$SOURCE" = "file" ]; then
  python3 services/map-importer/src/main.py --area-slug chon-thanh --source file \
    --file services/map-importer/fixtures/chon-thanh-center.osm.json
else
  python3 services/map-importer/src/main.py --area-slug chon-thanh --source "$SOURCE"
fi

cat <<MSG

Done. Start the apps in two terminals:
  pnpm dev:api     # http://localhost:${API_PORT:-4000}/api/v1
  pnpm dev:web     # http://localhost:3000/map/chon-thanh
MSG
