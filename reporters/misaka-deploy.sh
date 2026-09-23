#!/bin/sh
# misaka-jp 上 GitHub Actions 部署密钥唯一能跑的东西。
#
# 装在 /opt/lyjwpage/deploy.sh（root 所有、0755），root 的 authorized_keys 里那把
# 部署公钥写成：
#   restrict,command="/opt/lyjwpage/deploy.sh" ssh-ed25519 AAAA... lyjwpage-actions-deploy
# restrict 关掉转发、pty、agent；command= 让这把钥匙无论客户端发什么都只进这个脚本，
# 客户端发的那串（服务名）落在 SSH_ORIGINAL_COMMAND 里，这里按白名单认。
#
# 做的事和 compose.yaml 开头写的手动步骤一样：点名 pull、只重建这一个、清掉悬空镜像
# （盘只有 30 GB，agents-reporter 一份就 3.4 GB）。最后报容器状态和镜像里的提交，
# 由 workflow 判断成没成。
#
# 这份文件改了不会自己同步到机器上：改完要手动重新装一次（见 reporters/README）。
set -eu

service="${SSH_ORIGINAL_COMMAND:-}"
case "$service" in
  server-reporter | agents-reporter) ;;
  *)
    echo "refused: '$service' is not a deployable service" >&2
    exit 2
    ;;
esac

cd /opt/lyjwpage

# 两个服务同一个 compose project，两次部署别并发改它
exec 9>/tmp/lyjwpage-deploy.lock
flock 9

echo "deploy $service at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose pull --quiet "$service"
docker compose up -d --no-deps "$service"
docker image prune -f >/dev/null

# 给容器几秒，崩溃重启的话 status 会是 restarting
sleep 8
docker inspect "$service" --format 'status={{.State.Status}} restarts={{.RestartCount}} image={{.Image}}'
docker inspect "$service" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^REPORTER_COMMIT=' || true
