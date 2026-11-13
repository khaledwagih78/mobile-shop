#!/usr/bin/env bash
# يشغّل PostgreSQL محلي للاختبارات (بدون Docker) على المنفذ 54329.
# الاستخدام:  bash scripts/pg-local.sh start | stop | status
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/.pgtest"
PORT="${PGTEST_PORT:-54329}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -z "$PGBIN" ] && PGBIN="$(dirname "$(command -v pg_ctl)")"

run() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }

case "${1:-start}" in
  start)
    if [ ! -f "$DIR/PG_VERSION" ]; then
      mkdir -p "$DIR"; [ "$(id -u)" = "0" ] && chown postgres "$DIR"
      run "$PGBIN/initdb -D '$DIR' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    if ! run "$PGBIN/pg_ctl -D '$DIR' status" >/dev/null 2>&1; then
      run "$PGBIN/pg_ctl -D '$DIR' -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c wal_level=logical' -l '$DIR/log.txt' -w start" >/dev/null
    fi
    echo "postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)   run "$PGBIN/pg_ctl -D '$DIR' -m fast stop" ;;
  status) run "$PGBIN/pg_ctl -D '$DIR' status" ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
