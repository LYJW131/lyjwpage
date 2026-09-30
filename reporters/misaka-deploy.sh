#!/bin/sh
set -eu

service="${SSH_ORIGINAL_COMMAND:-}"
case "$service" in
  server-reporter | agents-reporter | discord-reporter) ;;
  *)
    echo "refused: '$service' is not a deployable service" >&2
    exit 2
    ;;
esac

cd /opt/lyjwpage
if [ "$service" = discord-reporter ]; then
  cd discord-reporter
fi

exec 9>/tmp/lyjwpage-deploy.lock
flock 9

echo "deploy $service at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose pull --quiet "$service"
docker compose up -d --no-deps "$service"
docker image prune -f >/dev/null

sleep 8
docker inspect "$service" --format 'status={{.State.Status}} restarts={{.RestartCount}} image={{.Image}}'
docker inspect "$service" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^REPORTER_COMMIT=' || true
