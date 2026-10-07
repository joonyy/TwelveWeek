# Twelve Week

비전 → 12주 목표 → 목표별 12주 계획 → 일간 실행 → 주간 평가를 연결하는 웹 서비스.
React/Vite 프론트, Express API, PostgreSQL DB를 사용한다. 배포 대상은 Render + Aiven이며 TheCorner와 독립된 프로젝트다.

저장소: [joonyy/TwelveWeek](https://github.com/joonyy/TwelveWeek)

## 로컬 실행

Node.js 22.12 이상, npm, 실행 중인 Docker가 필요하다.

```sh
git clone https://github.com/joonyy/TwelveWeek.git
cd TwelveWeek
cp .env.example .env # 첫 설치 때만. 기존 .env를 덮어쓰지 않는다.
npm ci
docker compose up -d --wait
npm run dev
```

터미널·AI 작업 세션을 닫아도 로컬 앱을 계속 사용하려면 `npm run dev:background`로 시작한다. 독립된 프로세스로 실행하며 로그는 Git에서 제외된 `.logs/dev.log`에 남긴다. 이미 양쪽 서버가 실행 중이면 중복 시작하지 않는다.

macOS에서는 `scripts/local-start.command`를 실행하면 Docker Desktop → 기존 DB → API·웹 서버 준비 후 브라우저를 연다. 바탕화면의 `TwelveWeek.command`는 이 파일을 호출한다. 이미 실행 중이면 같은 앱을 다시 열며 터미널을 닫아도 서버는 유지된다. 디스크 여유 공간이 1GB 미만이면 새 실행을 중단하고 안내한다.

- 웹: http://127.0.0.1:5178
- API 상태: http://127.0.0.1:4110/api/health
- Docker DB: localhost:55439, `twelve_week`. 로컬 개발용 자격증명은 compose.yaml에 있다.
- API 시작 시 SQL migration을 자동 적용한다. 실패하면 서버를 열지 않는다.
- `docker compose stop`으로 DB를 멈출 수 있다. `down -v`는 저장 데이터를 삭제하므로 보존할 때 사용하지 않는다.

장기·3년 비전은 목록 입력을 기본으로 하며 자유 서술로 바꿀 수 있다. 새 계획에는 빈 목표 3개를 미리 준비하고, 모범 주간은 시간축 캘린더로 작성한다. 책임과 헌신은 정리본의 네 가지 태도 및 7영역 바퀴 구조를 따른다.

장기비전 옆 **AI와 비전 다듬기**에서 대화 저장·재개, 선택한 외부 대화 가져오기, 비전 수정 권한·이력·되돌리기를 지원한다. ChatGPT·Claude용 MCP와 선택형 로컬 Codex resume도 준비했다. 실제 AI를 사용하려면 API 키/모델 또는 로컬 Codex 연결이 필요하다. [연결 설정과 지원 범위](docs/AI_INTEGRATION.md)를 참고한다.

첫 화면에서 유저를 만들거나 선택한다. 기본 주기는 2026-10-05~12-27이며 초안에서 월요일 시작일과 **실행 주수(1~12주)**를 바꿀 수 있다. 예를 들어 2026-10-12 시작·11주 실행이면 종료일은 12월 27일, 회고 주간은 12월 28일~2027년 1월 3일이다. 작성 중인 내용은 **저장** 버튼으로 보관한다. 착수는 목표·전술·1회 완료 조건·실행 주차가 준비되면 가능하다. 착수 후 기간 축소는 미래 주만 제외하며 이미 시작한 주의 기록·점수 기준은 유지한다.

## 검증

실제 앱 데이터와 테스트 DB를 분리한다. 테스트 명령은 이름이 `_test`로 끝나는 DB만 허용하며 테스트 테이블을 초기화한다. 두 DB 테스트 명령을 동시에 실행하지 않는다.

```sh
docker compose exec -T db psql -U twelve -d postgres -c 'CREATE DATABASE twelve_week_test'
npm test
npm run test:api
npx playwright install chromium
npm run test:e2e
npm run build
```

테스트 DB가 이미 있으면 생성 명령은 생략한다. 브라우저 테스트는 별도 포트 4111·5179를 사용하므로 실제 로컬 앱(4110·5178)을 켜둔 상태에서도 실행할 수 있다. 테스트 서버의 시계는 2026-10-07로 고정되며, 실제 API에는 시계 변경 기능이 없다. 스크린샷은 `test-results/`에 생성된다. GitHub Actions 검사 구성도 포함했다.

## Render + Aiven 배포 준비

GitHub 저장소는 [joonyy/TwelveWeek](https://github.com/joonyy/TwelveWeek)다. Aiven DB와 Render 서비스는 아직 연결하지 않았으며 아래 순서로 배포한다.

1. **전용 Aiven PostgreSQL** 서비스와 앱용 DB를 생성한다. 기존 TheCorner DB를 재사용하지 않는다. 연결 URI와 해당 서비스 CA 인증서를 준비한다.
2. 저장소를 Render Blueprint로 연결하여 `render.yaml`을 적용한다. API는 Node Web Service, 프론트는 Static Site다.
3. API 환경변수에 `DATABASE_URL`, `DATABASE_SSL=true`, `DATABASE_CA_PEM`(인증서 PEM 전문)을 넣는다. `WEB_ORIGIN`은 프론트의 정확한 HTTPS origin이다. 여러 origin이 필요하면 쉼표로 구분한다.
4. 프론트 `VITE_API_BASE_URL`에 API의 HTTPS origin을 넣는다. `/api`는 붙이지 않는다. 프론트 변수는 빌드 시 반영되므로 바꾸면 재빌드한다. DB URI·인증서·토큰을 `VITE_` 변수에 넣지 않는다.
5. 양쪽 URL이 확정되면 `WEB_ORIGIN`과 `VITE_API_BASE_URL`을 맞추고 API `/api/health`, 프로필 생성, 계획 저장, 새로고침 후 복원, 캘린더 다운로드를 실서비스에서 다시 검증한다.

환경값 예시는 `.env.example`에 있다. `DATABASE_CA_PATH`로 Render Secret File을 사용하는 것도 가능하다. PEM 문자열의 실제 줄바꿈 및 리터럴 `\n` 모두 지원한다. TLS 인증서 검증은 끄지 않는다. Aiven 연결법은 [공식 Node.js 안내](https://aiven.io/docs/products/postgresql/howto/connect-node)를 따른다.

프론트는 CDN에서 제공하는 정적 사이트로 구성했다. 깨우기 요청은 API `/api/health`에 보내면 된다. `KEEPALIVE_URLS`에 URL을 쉼표로 넣으면 프론트도 함께 확인할 수 있다. [Render 서비스 유형](https://render.com/docs/service-types), [무료 Web Service 동작과 사용량 제한](https://render.com/docs/free)을 확인한다. 외부 요청은 유휴 종료 대응이며 무료 인스턴스 시간 한도나 재시작까지 없애지는 않는다.

외부 cron에서 `node scripts/keepalive.js`를 실행하거나, GitHub repository variable `KEEPALIVE_URLS`를 설정해 준비한 10분 간격 workflow를 활성화한다. 변수 미설정 시 작업은 건너뛴다. GitHub의 예약 작업은 지연될 수 있으며 전용 유료 Render Cron Job은 생성하지 않았다. 개인 저장소에서 사용할 Actions 실행량은 실제 배포 시 확인한다.

## 사용자 선택 방식

요청한 콘솔게임식 프로필 선택이다. 이름 목록을 공개하며 누구나 해당 프로필을 선택할 수 있다. 토큰으로 API 데이터의 소유 범위를 나누지만, 이름 선택 자체는 본인 인증이 아니다.

- 32바이트 임의 세션 토큰, 기본 만료 365일(`TOKEN_TTL_DAYS`, 1~730일).
- DB에는 토큰 해시만 저장하고 브라우저는 localStorage에 토큰을 보관한다.
- 유저 전환 시 현재 토큰을 폐기한다. 다른 기기의 세션은 유지한다.
- 개인 GitHub 저장소 여부와 배포 사이트 접근 제한은 별개다. 현재 구현은 신뢰하는 사용자의 프로필 선택을 전제로 한다.

## 문서와 범위

- [제품 규칙과 구현 판단](docs/PRODUCT.md)
- [구현 상태와 검증 결과](docs/STATUS.md)
- [배포 설정](render.yaml)

초기 버전은 안내형 템플릿과 실행·평가 루프에 집중한다. AI 맞춤 제안, 캘린더 양방향 동기화, SecondBrain/VIGIL 자동 연동은 포함하지 않는다. Apple Calendar `.ics` 파일의 생성·내용·다운로드는 자동 검증하되 실제 Calendar 앱 가져오기 결과는 따로 확인해야 한다.
