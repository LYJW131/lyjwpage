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

# Actions 取消或超时后，强制命令启动的进程不会随 ssh 断开退出：等锁与 pull 都必须自带上限，否则一次卡住的 pull 会一直攥着锁。
exec 9>/tmp/lyjwpage-deploy.lock
flock -w 1200 9 || { echo "another deploy still holds the lock" >&2; exit 1; }

echo "deploy $service at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
old_image=$(docker inspect "$service" --format '{{.Image}}' 2>/dev/null || true)
timeout 900 docker compose pull --quiet "$service"
docker compose up -d --no-deps "$service"

sleep 8
state=$(docker inspect "$service" --format 'status={{.State.Status}} restarts={{.RestartCount}} image={{.Image}}')
echo "$state"
docker inspect "$service" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^REPORTER_COMMIT=' || true

# 新容器跑稳才删旧镜像；没跑起来就留着，手动回滚不用再拉 GB 级的层。
case "$state" in
  "status=running restarts=0 "*)
    if [ -n "$old_image" ] && [ "$state" = "${state%"image=$old_image"}" ]; then
      docker image rm "$old_image" >/dev/null 2>&1 && echo "removed old image $old_image" || echo "old image $old_image kept (still in use)"
    fi
    docker image prune -f >/dev/null
    ;;
esac
