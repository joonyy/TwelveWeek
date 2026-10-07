#!/bin/zsh

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

TW_ROOT="${0:A:h:h}"
TW_URL="http://127.0.0.1:5178"
TW_HEALTH="http://127.0.0.1:4110/api/health"

finish() {
  local result=$?
  if (( result != 0 )); then
    print "TwelveWeek 실행에 실패했어요. 위 오류와 $TW_ROOT/.logs/dev.log를 확인해주세요."
    if [[ -t 0 ]]; then
      read -r "tw_reply?Enter 키를 눌러 닫아 주세요. "
    fi
  fi
}
trap finish EXIT

cd "$TW_ROOT"
for tool in node npm docker; do
  if ! command -v "$tool" >/dev/null; then
    print "필요한 프로그램을 찾을 수 없어요: $tool"
    exit 1
  fi
done
if [[ ! -f .env || ! -d node_modules ]]; then
  print "먼저 README의 로컬 실행 절차로 .env와 패키지를 준비해주세요."
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js 22.12 이상이 필요해요."); process.exit(1); }'

TW_FREE_KB="$(df -Pk /System/Volumes/Data | awk 'NR == 2 { print $4 }')"
if [[ -n "$TW_FREE_KB" ]] && (( TW_FREE_KB < 1048576 )); then
  print "디스크 여유 공간이 1GB 미만이에요. 공간을 확보한 뒤 다시 실행해주세요."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  print "Docker Desktop을 시작하고 있어요."
  docker desktop start --timeout 45
  for attempt in {1..30}; do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null
fi

print "TwelveWeek DB를 준비하고 있어요. 기존 기록을 그대로 사용해요."
docker compose up -d --wait --wait-timeout 45 db
npm run dev:background

for attempt in {1..30}; do
  if curl -fsS --max-time 2 "$TW_HEALTH" >/dev/null 2>&1 &&
     curl -fsS --max-time 2 "$TW_URL/" >/dev/null 2>&1; then
    print "TwelveWeek 실행 완료: $TW_URL"
    print "서버 로그: $TW_ROOT/.logs/dev.log"
    print "이 창을 닫아도 서버는 계속 실행돼요. 다시 실행하면 같은 앱을 열어요."
    if [[ "${1:-}" != "--no-open" ]]; then
      /usr/bin/open "$TW_URL"
      print "이 창에서 서버 로그를 실시간으로 확인할 수 있어요."
      exec tail -n 20 -F "$TW_ROOT/.logs/dev.log"
    fi
    exit 0
  fi
  sleep 1
done

print "서버가 제한 시간 안에 준비되지 않았어요."
exit 1
