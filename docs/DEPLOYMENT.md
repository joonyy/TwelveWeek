# 개인용 운영 배포 · 2026-10-29

**현재 배포 방식:** `main` push → GitHub Actions 전체 검사 → 검사한 SHA로 Render API·웹 Deploy Hook 호출이다. 최신 SHA·요청 결과의 원본은 [Checks 실행 목록](https://github.com/joonyy/TwelveWeek/actions/workflows/check.yml)과 Render의 두 서비스 Deploys 화면이다. Actions 성공과 실제 Live 전환을 각각 확인한다. 자동 배포가 이어지므로 아래 고정 SHA·배포 ID는 해당 시점의 검증 기록이다. 사용자 기록/DB schema를 바꾸는 코드는 이번 작업에 추가하지 않았다.

**자동 배포 전 최종 수동 배포 기록:** API `bc498fff2d710f753071504acf17ddb2b87cad62`, 프론트 `39260b211999166d54765400872a2769b891bcf6`(2026-10-28 23:12 KST). 실행 약속 설명·독서 기록 안내·캘린더 파일 가져오기·블록 드래그 기준점 수정의 검증 결과다. 기존 migration `007_profile_password` 초기화는 다시 수행하지 않는다.

- API 배포: `dep-dbgt9rrl550s738605l0` — 기존 `Deploy succeeded|Live` 유지.
- 최신 웹 배포: `dep-dbh05d6i0phs73acpn0g` — Render `Deploy succeeded|Live`, 24.6초, 소스 `39260b2`.
- [배포 코드 CI](https://github.com/joonyy/TwelveWeek/actions/runs/40695511704): 단위 64개·API 56개·Chromium 57개·빌드 통과.
- 운영의 기존 10주 주기·2주차에서 새 버튼, `.ics`/iCloud 방식 선택, 독서 전술/기록 위치 안내를 확인했다. 샘플 `.ics`를 브라우저에서 미리 읽어 기존 OVS 근무와의 겹침 및 확인 전 적용 비활성화를 확인했고 적용하지 않고 닫았다. 해당 화면은 `.logs/deployment-20261028/calendar-import-live.png`, `calendar-preview-live.png`에 있다. 이 확인에서 실제 Apple 계정 연결이나 사용자 기록 저장은 하지 않았다.
- 포인터를 잡은 위치 기준 드래그·이동 뒤 시간표 저장·재조회·실행 취소·실행 기록/점수 보존은 격리된 테스트 DB의 브라우저 검사로 검증했다. 운영 사용자의 실제 시간표를 옮겨 저장하지 않았다.
- 이전 로그인 기억 웹 배포는 `dep-dbgtqeuk1f9s7395e030`(`b1b8f1b`), 팝업 수정은 `dep-dbgtm6bl550s7386lh9g`(`e8dced9`)다. 이후 문서만 변경한 commit은 운영 코드의 배포 SHA와 구분한다.

- 웹: https://twelveweek-joonyy.onrender.com
- API 상태: https://twelveweek-joonyy-api.onrender.com/api/health
- 웹은 Render Static Site, API는 Render Free Web Service(Singapore)다.
- DB는 별도 개인 조직/프로젝트의 Aiven Free PostgreSQL 18이다. Free Asia Pacific 배치 결과는 DigitalOcean Bangalore(`blr`)이며, 특정 도시를 지정한 유료 플랜은 사용하지 않았다.
- 기존 회사 서비스와 회사 DB는 변경하지 않았다.

## 하루 유형 템플릿 배포 · 2026-10-29

새 API는 선택형 템플릿/구성 방식/날짜별 출처 JSON을 검증·보존한다. DB migration과 기존 행의 일괄 변경은 없다. `/api/health`의 `features.dayTemplates: 1`로 지원 여부를 알리며, 새 필드가 있는 계획 저장은 이를 확인한다. 웹이 먼저 Live가 되거나 API가 이전 코드로 롤백되면 쓰기를 거부해 필드 유실을 막고 입력을 보존한다.

전체 CI 성공 뒤 기존 자동 Deploy Hook 경로가 API·웹을 같은 SHA로 배포한다. 로컬 검증은 단위 74개, 새 PostgreSQL API 1개, 관련 Chromium 4개와 빌드다. 실제 목표·실행 기록은 배포 검증용으로 수정하지 않는다. 운영 화면에서 새 진입점과 저장하지 않는 보관함/적용 미리보기를 확인하며, 저장·경계 처리·소유권·버전 충돌·완료/독서/평가 보존은 격리된 테스트 DB의 결과와 구분한다.

## 기록의 원본

실제 사용과 이후 기록의 원본은 **운영 URL과 Aiven DB**다. 개발용 `.env`와 Docker DB는 별도다. 로컬 DB는 이전 시점의 기록을 보존하지만 운영 DB와 자동 동기화되지 않는다. 사용자 기록을 조회/수정하는 작업에서 로컬 DB를 최신 운영 상태로 간주하지 않는다.

이전 전에 로컬 전체 백업을 만들었고, 목표·계획·주차별 실행·평가·독서 기록·변경 이력·저장된 대화를 복사했다. 관련 10개 테이블의 건수와 전체 행 내용 해시를 대조해 동일함을 확인했다. 로그인 세션, OAuth 인증 자료와 일시적인 캘린더 미리보기는 복사하지 않고 새 서버에서 다시 발급한다. 목표 재검토 대화의 후보 내용은 적용하지 않았다.

macOS의 바탕화면 `TwelveWeek.command`는 이제 운영 URL을 연다. 기존 실행 파일과 DB 백업은 `~/.local/share/twelveweek/backups/2026-10-28/`에 보관했다. 개발 서버를 띄울 때는 저장소의 `scripts/local-start.command`를 직접 실행한다.

## 이름과 비밀번호 인증

2026-10-28 후속 요청으로 사이트 공통 접속키를 제거하고 사용자별 이름·비밀번호 인증으로 전환했다. 처음 인증하는 계정의 이름을 선택하면 비밀번호 입력 창이 열리고, 확인된 경우에만 장기 세션을 발급한다. 로그인한 뒤에는 새로고침 시 주기·주차·화면을 복원한다. 새 사용자는 자신의 비밀번호를 설정하며, 비밀번호 변경에서는 현재 비밀번호를 확인하고 다른 기기의 로그인 세션을 만료한다. 비밀번호 입력 실패는 횟수를 제한한다. 이름 목록과 상태 확인용 `/api/health`는 공개다.

사이드바 `계정 설정`에서 현재 비밀번호를 확인하고 새 비밀번호를 설정한다. 계정 삭제는 본인 이름·현재 비밀번호·삭제 확인을 거쳐 실행하며, 서버는 인증된 본인의 계정과 모든 소유 기록·세션·OAuth 승인·저장된 연결 정보만 한 트랜잭션으로 정리한다. 공유 OAuth 클라이언트 등록과 다른 계정은 보존한다. 외부 캘린더·블로그에 이미 내보낸 내용은 삭제하지 않는다. 비밀번호를 잊은 사용자를 위한 이메일 복구는 제공하지 않는다.

로그인은 이 브라우저에서 계정별 인증 세션을 기억한다. `유저 전환`은 세션을 유지한 채 선택 화면을 열고, 기억된 계정은 서버의 유효성/사용자 ID 확인 뒤 바로 연결한다. `로그아웃`은 현재 계정의 기억을 지우고 세션을 종료하며, 네트워크 실패 때도 로컬 기억을 지운다. 기존 로그인은 유효성 확인 후 자동으로 기억한다. 탭마다 계정을 고정해 다른 탭의 전환이 저장 대상에 영향을 주지 않으며 새로고침·브라우저 재실행에 로그인과 기존 화면 복원을 유지한다. 다른 기기/브라우저는 최초 비밀번호 인증이 필요하며 서버가 만료·철회한 세션은 재인증한다. 비밀번호 원문은 저장하지 않는다.

`나의 12주`에서 작성 중인 카드 아래 `초안 삭제`로 제목·기간을 확인하고 삭제한다. 서버가 소유자·버전·미착수 상태를 다시 확인하고, 실행 기록이 있거나 이미 실행 중/완료인 주기는 거부한다. 변경된 초안은 목록을 새로 불러와 다시 확인한다.

비밀번호는 [OWASP의 scrypt 구성](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)을 사용하며 사용자별 무작위 salt와 함께 해시로 저장한다. 기존 사용자 초기화는 migration `007_profile_password`에서 한 번만 수행한다. 업그레이드 시 승인된 초기 비밀번호를 `INITIAL_PROFILE_PASSWORD` 또는 migration 함수의 별도 옵션으로 전달해야 하며, 소스에 운영 초기값을 기록하지 않는다. 기존 이름·ID·목표·실행·평가와 로그인 세션은 보존하고 재시작 시 비밀번호를 재설정하지 않는다.

DB 접속 설정/CA는 맥북의 `~/.config/twelveweek/`에 권한을 제한해 보관한다. 이 폴더의 예전 `private-access-key.txt`/`private-access.env`는 이전 방식의 보존 자료이며 새 인증에서는 사용하지 않는다. 비밀값은 Git에 넣지 않는다. 서버의 `AI_SECRETS_KEY`와 `CALENDAR_SECRETS_KEY`는 Render에서 생성한 안정된 값을 사용하며, 연결 정보가 생긴 후에는 임의로 교체하지 않는다.

맥북의 Codex 로그인·로컬 대화 재개 기능은 운영 서버에서 사용할 수 없다. 저장한 대화 자체는 보존했고, 별도의 AI API 연결 기능과 구분한다.

## 운영과 재배포

GitHub repository variable `KEEPALIVE_URLS`에 API 상태 URL을 설정해 기존 10분 간격 Actions workflow를 활성화했다. 첫 수동 실행이 성공했다. 예약 실행은 지연될 수 있고, 무료 서버의 월 한도와 재시작을 없애는 기능은 아니다.

Render Blueprint는 `render.yaml`을 사용한다. 공개 저장소 URL로 연결했다. 2026-10-28 후속 요청으로 API·웹의 Render 자체 Auto-Deploy를 모두 Off로 바꾸고, GitHub repository secrets에 서비스별 Deploy Hook 두 개를 등록했다. 실제 훅 값은 저장소에 넣지 않는다. `.github/workflows/check.yml`에서 `main` push의 전체 검증이 성공한 뒤 `deploy` 작업이 검사한 SHA를 두 훅에 전달한다. PR/`dev`·실패한 검사에서는 배포하지 않으며 오래된 `main` 커밋도 건너뛴다. Render API 계정 키나 유료 runner는 사용하지 않는다.

Actions deploy 단계의 성공은 요청 접수이므로 최종 Live 및 소스 SHA는 Render 배포 목록에서 확인한다. 응답이 불확실하면 목록을 확인한 뒤 실패 작업을 재실행한다. 기존 Manual Deploy는 비상용으로 남아 있다. 첫 자동 배포부터 Actions의 `Deploy tested main commit to Render` 요약에 API·웹 배포 ID가 남는다. 해당 ID의 Render 상태와 소스 SHA를 함께 확인한다.

## 공통 팝업·로그인 기억 확인 결과

- [최종 배포 코드 GitHub CI](https://github.com/joonyy/TwelveWeek/actions/runs/40680659172) 성공: 단위 58개·PostgreSQL API 56개·Chromium 53개·빌드. 이후 문서 commit은 이 기능 배포 SHA와 구분한다.
- 이전 코드에서 입력창의 텍스트 선택을 배경에서 끝내면 팝업이 사라지는 실패를 재현했다. 공통 `Modal`은 같은 주 포인터가 배경에서 시작·종료한 클릭만 닫기로 처리하며, 취소된 포인터·내부에서 시작한 드래그는 무시한다. Esc·닫기 버튼·정상적인 배경 클릭을 유지한다.
- 관련 Chromium 12개와 빌드·`git diff --check` 통과. 단일/여러 줄 입력 보존과 실행 점수/상태 무변경, 로그인·삭제·화면 복원, 계정 전환/복원·다중 탭 소유권·연결 실패 중 로그아웃·철회/잘못된 사용자 세션 재인증을 확인했다.
- 실제 운영 화면에서 입력을 드래그해 팝업 바깥에서 놓은 뒤 내용이 유지되는 것을 확인하고 저장 없이 닫았다. 기존 로그인 계정을 `유저 전환` 후 비밀번호 없이 재선택하고 새로고침 후 로그인 유지를 확인했다. 사용자 비밀번호·계획·점수는 변경하지 않았다.
- 로컬 운영 화면: `.logs/deployment-20261028/modal-drag-live.png`, `remembered-login-live.png`. 별도 기기 최초 로그인과 브라우저 재실행은 격리한 브라우저 테스트에서 검증했으며 실제 아이폰 직접 조작 결과와 구분한다.

## 계정 설정·초안 삭제 확인 결과 · 19:58 KST

- [배포 코드 GitHub CI](https://github.com/joonyy/TwelveWeek/actions/runs/40675843604) 성공: 단위 58개·PostgreSQL API 56개·Chromium 46개·빌드.
- 로컬 전체 검증(계정 기능), 이후 추가한 초안 삭제/로그인/화면 복원 관련 검증과 `git diff --check` 통과. 삭제 취소·실패 시 입력/기록 유지, 잘못된 이름/비밀번호·소유권·버전·생명주기 제한, 삭제 후 모든 세션 무효화와 다른 계정 보존을 확인했다.
- 운영 임시 검증 계정으로 비밀번호 변경·이전 비밀번호 거부·다른 기기 세션 만료, 잘못된 삭제 비밀번호 거부, 초안 버전 보호와 삭제, 계정 및 잔여 초안 삭제/로그아웃을 확인했다. 임시 계정은 정리했으며 사용자의 비밀번호·실제 주기는 변경하지 않았다.
- 사용자 요청으로 예시 계정과 미착수 초안 한 개를 삭제했다. 삭제 전 전체 DB 백업을 검증하고 나머지 모든 테이블 행의 건수·내용 해시가 보존됐음을 트랜잭션 안과 커밋 후에 각각 확인했다. 백업과 영수증: `~/.local/share/twelveweek/backups/2026-10-28-before-account-deletion/`.
- 운영 UI의 계정 설정과 작성 중인 카드의 삭제 버튼 확인 화면, 비밀값을 제외한 동작 검증은 로컬 `.logs/deployment-20261028/account-*-live.png`, `draft-delete-live.png`, `account-live-verification.json`에 있다. 사용자가 방금 만든 초안은 삭제 버튼을 제공한 상태이며 대신 삭제하지 않았다.

## 최초 이름·비밀번호 전환 확인 결과 · 19:28 KST

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
