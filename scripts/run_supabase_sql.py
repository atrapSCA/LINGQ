"""Spustí SQL soubor proti Supabase podle lokálního .env (nepatří do gitu)."""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path) -> dict[str, str]:
  env: dict[str, str] = {}
  for line in path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    env[key] = value
  return env


def main() -> int:
  if len(sys.argv) != 2:
    print("Použití: python scripts/run_supabase_sql.py supabase/latency.sql")
    return 1

  env_path = ROOT / ".env"
  if not env_path.exists():
    print("Chybí .env s údaji k databázi.")
    return 1

  sql_path = Path(sys.argv[1])
  if not sql_path.is_absolute():
    sql_path = ROOT / sql_path
  if not sql_path.exists():
    print(f"SQL soubor neexistuje: {sql_path}")
    return 1

  env = load_env(env_path)
  conn = psycopg2.connect(
    host=env["SUPABASE_DB_HOST"],
    port=int(env["SUPABASE_DB_PORT"]),
    dbname=env["SUPABASE_DB_NAME"],
    user=env["SUPABASE_DB_USER"],
    password=env["SUPABASE_DB_PASSWORD"],
    sslmode="require",
    connect_timeout=20,
  )
  conn.autocommit = True
  with conn.cursor() as cur:
    cur.execute(sql_path.read_text(encoding="utf-8"))
  conn.close()
  print(f"Hotovo: {sql_path.name}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
