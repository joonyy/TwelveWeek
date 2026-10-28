# 개인용 운영 배포 · 2026-10-28

**현재 진행 상태:** 2026-10-28 19:28 KST에 API·프론트 모두 `02f786e266d545be2c19380aee9f061bc7f2b7f8` 배포를 완료했다. 사이트 공통 접속키 대신 이름 선택·사용자별 비밀번호 로그인을 사용한다. 운영 DB는 migration `007_profile_password` 적용을 완료했으며 초기화를 다시 수행하지 않는다. 기존 계정 로그인, 잘못된 비밀번호 거부, 활성 10주 주기와 2주차 일간 화면의 새로고침 복원, 390px 화면을 실제 운영 URL에서 확인했다.

- API 배포: `dep-dbgss1ks728c73cabfbg` — Render `Deploy succeeded|Live`, 39.1초.
- 웹 배포: `dep-dbgss3mc6qcc73cie0hg` — Render `Deploy succeeded|Live`, 26.3초.
- 이후 문서만 변경한 commit은 운영 코드의 배포 SHA와 구분한다.

- 웹: https://twelveweek-joonyy.onrender.com
- API 상태: https://twelveweek-joonyy-api.onrender.com/api/health
- 웹은 Render Static Site, API는 Render Free Web Service(Singapore)다.
- DB는 별도 개인 조직/프로젝트의 Aiven Free PostgreSQL 18이다. Free Asia Pacific 배치 결과는 DigitalOcean Bangalore(`blr`)이며, 특정 도시를 지정한 유료 플랜은 사용하지 않았다.
- 기존 회사 서비스와 회사 DB는 변경하지 않았다.

## 기록의 원본

실제 사용과 이후 기록의 원본은 **운영 URL과 Aiven DB**다. 개발용 `.env`와 Docker DB는 별도다. 로컬 DB는 이전 시점의 기록을 보존하지만 운영 DB와 자동 동기화되지 않는다. 사용자 기록을 조회/수정하는 작업에서 로컬 DB를 최신 운영 상태로 간주하지 않는다.

이전 전에 로컬 전체 백업을 만들었고, 목표·계획·주차별 실행·평가·독서 기록·변경 이력·저장된 대화를 복사했다. 관련 10개 테이블의 건수와 전체 행 내용 해시를 대조해 동일함을 확인했다. 로그인 세션, OAuth 인증 자료와 일시적인 캘린더 미리보기는 복사하지 않고 새 서버에서 다시 발급한다. 목표 재검토 대화의 후보 내용은 적용하지 않았다.

macOS의 바탕화면 `TwelveWeek.command`는 이제 운영 URL을 연다. 기존 실행 파일과 DB 백업은 `~/.local/share/twelveweek/backups/2026-10-28/`에 보관했다. 개발 서버를 띄울 때는 저장소의 `scripts/local-start.command`를 직접 실행한다.

## 이름과 비밀번호 인증

2026-10-28 후속 요청으로 사이트 공통 접속키를 제거하고 사용자별 이름·비밀번호 인증으로 전환한다. 이름을 선택하면 비밀번호 입력 창이 열리고, 확인된 경우에만 기존 장기 세션을 발급한다. 로그인한 뒤에는 새로고침 시 주기·주차·화면을 복원한다. 새 사용자는 자신의 비밀번호를 설정하며, 비밀번호 변경에서는 현재 비밀번호를 확인하고 다른 기기의 로그인 세션을 만료한다. 비밀번호 입력 실패는 횟수를 제한한다. 이름 목록과 상태 확인용 `/api/health`는 공개다.

비밀번호는 [OWASP의 scrypt 구성](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)을 사용하며 사용자별 무작위 salt와 함께 해시로 저장한다. 기존 사용자 초기화는 migration `007_profile_password`에서 한 번만 수행한다. 업그레이드 시 승인된 초기 비밀번호를 `INITIAL_PROFILE_PASSWORD` 또는 migration 함수의 별도 옵션으로 전달해야 하며, 소스에 운영 초기값을 기록하지 않는다. 기존 이름·ID·목표·실행·평가와 로그인 세션은 보존하고 재시작 시 비밀번호를 재설정하지 않는다.

DB 접속 설정/CA는 맥북의 `~/.config/twelveweek/`에 권한을 제한해 보관한다. 이 폴더의 예전 `private-access-key.txt`/`private-access.env`는 이전 방식의 보존 자료이며 새 인증에서는 사용하지 않는다. 비밀값은 Git에 넣지 않는다. 서버의 `AI_SECRETS_KEY`와 `CALENDAR_SECRETS_KEY`는 Render에서 생성한 안정된 값을 사용하며, 연결 정보가 생긴 후에는 임의로 교체하지 않는다.

맥북의 Codex 로그인·로컬 대화 재개 기능은 운영 서버에서 사용할 수 없다. 저장한 대화 자체는 보존했고, 별도의 AI API 연결 기능과 구분한다.

## 운영과 재배포

GitHub repository variable `KEEPALIVE_URLS`에 API 상태 URL을 설정해 기존 10분 간격 Actions workflow를 활성화했다. 첫 수동 실행이 성공했다. 예약 실행은 지연될 수 있고, 무료 서버의 월 한도와 재시작을 없애는 기능은 아니다.

Render Blueprint는 `render.yaml`을 사용한다. 공개 저장소 URL로 연결했으며 GitHub 계정에 추가 저장소 권한을 부여하지 않았다. API Settings의 Auto-Deploy 표시는 `On Commit`이다. 코드 변경 후에는 새 commit SHA가 실제로 배포됐는지 확인하고, 반영되지 않았다면 Manual Deploy/Blueprint Manual sync를 사용한다. GitHub CI 성공만으로 운영 배포 완료를 판단하지 않는다.

## 이름·비밀번호 전환 확인 결과

- [배포 코드 GitHub CI](https://github.com/joonyy/TwelveWeek/actions/runs/40657981923): 단위 58개·PostgreSQL API 49개·Chromium 44개·빌드 통과.
- 운영 `/api/access`가 `{required:false, authentication:"password"}`를 반환하고, 이름 목록에 비밀번호 해시를 노출하지 않음.
- 로그인하지 않은 주기 접근과 잘못된 비밀번호는 401, 기존 계정의 승인된 초기 비밀번호 로그인은 성공. API 검증용으로 발급한 세션만 종료했다.
- 기존 활성 주기(2026-10-19~12-27, 10주)·2주차·일간 화면을 열고 새로고침 후 같은 주소와 화면 복원을 확인했다. 390px viewport에서 문서 너비도 390px였다. UI로 로그인한 사용자의 세션은 유지했다.
- DB 초기화 전 내용 해시 대조 결과를 보존하며, 배포 후 읽기 전용으로 9개 테이블의 기존 건수를 다시 확인했다. 목표·주간 실행·평가·변경 이력·대화 기록을 수정하지 않았다.
- 비밀값을 제외한 API/DB 검증 결과와 모바일 화면은 로컬 `.logs/deployment-20261028/password-live-*`에 보관한다. 실제 아이폰 Safari 조작과 알림/백그라운드 타이머는 별도 기기 확인 대상이다.

## 최초 공통 접속키 배포 당시 확인 결과 · 과거 기록

- 배포 코드의 GitHub Checks: 단위 61개, PostgreSQL API 44개, Chromium 43개와 빌드 통과.
- TLS 인증서를 검증한 Aiven 연결과 데이터 이전 전후 내용 대조 통과.
- 운영 API 건강 상태, 접속키 없는 프로필 접근 거부, 웹 origin의 CORS/preflight 확인.
- 임시 검증용 프로필/초안으로 실제 서버 생성·수정·재조회 확인 후 해당 임시 데이터만 정리.
- 기존 사용자로 로그인해 활성 10주 주기/2주차 표시 확인. 390px 너비에서 가로 넘침 없이 로그인·선택 화면이 새로고침 후 복원됨을 확인.
- 실제 아이폰 Safari 조작과 알림/백그라운드 타이머 동작은 별도 기기 확인 대상.
