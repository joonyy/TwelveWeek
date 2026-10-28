# 개인용 운영 배포 · 2026-10-28

- 웹: https://twelveweek-joonyy.onrender.com
- API 상태: https://twelveweek-joonyy-api.onrender.com/api/health
- 웹은 Render Static Site, API는 Render Free Web Service(Singapore)다.
- DB는 별도 개인 조직/프로젝트의 Aiven Free PostgreSQL 18이다. Free Asia Pacific 배치 결과는 DigitalOcean Bangalore(`blr`)이며, 특정 도시를 지정한 유료 플랜은 사용하지 않았다.
- 기존 회사 서비스와 회사 DB는 변경하지 않았다.

## 기록의 원본

실제 사용과 이후 기록의 원본은 **운영 URL과 Aiven DB**다. 개발용 `.env`와 Docker DB는 별도다. 로컬 DB는 이전 시점의 기록을 보존하지만 운영 DB와 자동 동기화되지 않는다. 사용자 기록을 조회/수정하는 작업에서 로컬 DB를 최신 운영 상태로 간주하지 않는다.

이전 전에 로컬 전체 백업을 만들었고, 목표·계획·주차별 실행·평가·독서 기록·변경 이력·저장된 대화를 복사했다. 관련 10개 테이블의 건수와 전체 행 내용 해시를 대조해 동일함을 확인했다. 로그인 세션, OAuth 인증 자료와 일시적인 캘린더 미리보기는 복사하지 않고 새 서버에서 다시 발급한다. 목표 재검토 대화의 후보 내용은 적용하지 않았다.

macOS의 바탕화면 `TwelveWeek.command`는 이제 운영 URL을 연다. 기존 실행 파일과 DB 백업은 `~/.local/share/twelveweek/backups/2026-10-28/`에 보관했다. 개발 서버를 띄울 때는 저장소의 `scripts/local-start.command`를 직접 실행한다.

## 개인 접속과 비밀값

새 기기는 개인 접속키를 확인한 뒤 기존 프로필을 선택한다. 이후에는 기존 장기 세션을 사용하며 새로고침 시 주기·주차·화면을 복원한다. 접속키 원문은 브라우저 저장소에 보관하지 않고 서버에는 SHA-256 digest만 설정한다. 접속키 없이 프로필 목록·생성·신규 세션을 요청하면 거부하며 반복 실패를 제한한다. 상태 확인용 `/api/health`는 공개다.

접속키와 DB 접속 설정/CA는 맥북의 `~/.config/twelveweek/`에 권한을 제한해 보관한다. 비밀값은 Git에 넣지 않는다. 이 구성은 개인용 출입 제한이며, 다중 사용자 서비스의 개별 계정 인증을 구현한 것은 아니다. 서버의 `AI_SECRETS_KEY`와 `CALENDAR_SECRETS_KEY`는 Render에서 생성한 안정된 값을 사용하며, 연결 정보가 생긴 후에는 임의로 교체하지 않는다.

맥북의 Codex 로그인·로컬 대화 재개 기능은 운영 서버에서 사용할 수 없다. 저장한 대화 자체는 보존했고, 별도의 AI API 연결 기능과 구분한다.

## 운영과 재배포

GitHub repository variable `KEEPALIVE_URLS`에 API 상태 URL을 설정해 기존 10분 간격 Actions workflow를 활성화했다. 첫 수동 실행이 성공했다. 예약 실행은 지연될 수 있고, 무료 서버의 월 한도와 재시작을 없애는 기능은 아니다.

Render Blueprint는 `render.yaml`을 사용한다. 공개 저장소 URL로 연결했으며 GitHub 계정에 추가 저장소 권한을 부여하지 않았다. API Settings의 Auto-Deploy 표시는 `On Commit`이다. 코드 변경 후에는 새 commit SHA가 실제로 배포됐는지 확인하고, 반영되지 않았다면 Manual Deploy/Blueprint Manual sync를 사용한다. GitHub CI 성공만으로 운영 배포 완료를 판단하지 않는다.

## 확인한 결과

- 배포 코드의 GitHub Checks: 단위 61개, PostgreSQL API 44개, Chromium 43개와 빌드 통과.
- TLS 인증서를 검증한 Aiven 연결과 데이터 이전 전후 내용 대조 통과.
- 운영 API 건강 상태, 접속키 없는 프로필 접근 거부, 웹 origin의 CORS/preflight 확인.
- 임시 검증용 프로필/초안으로 실제 서버 생성·수정·재조회 확인 후 해당 임시 데이터만 정리.
- 기존 사용자로 로그인해 활성 10주 주기/2주차 표시 확인. 390px 너비에서 가로 넘침 없이 로그인·선택 화면이 새로고침 후 복원됨을 확인.
- 실제 아이폰 Safari 조작과 알림/백그라운드 타이머 동작은 별도 기기 확인 대상.
