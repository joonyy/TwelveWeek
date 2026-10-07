# 장기비전 AI 연결 · 2026-10-07

장기비전 옆 **AI와 비전 다듬기**에서 대화한다. 저장하지 않은 계획은 먼저 저장한다. AI는 장기비전만 읽고 수정하며, 3년 비전·목표·전술·기간·점수는 접근 범위에 포함하지 않는다. 질문은 한 번에 하나, 상상과 의미를 넓히는 방향이다. 이 지침은 개인 정리본을 바탕으로 한 적용 안내이며 책 원문이 아니다.

## 앱 안의 대화

**연결**에서 OpenAI 또는 Claude의 API 키와 사용 가능한 모델 ID를 입력한다. 모델은 자동으로 골라주지 않는다. 키는 `AI_SECRETS_KEY`를 바탕으로 AES-256-GCM 암호화하여 PostgreSQL에 보관하고 읽기 API에 반환하지 않는다. 서버 암호화 키는 32자 이상의 임의 문자열을 사용하고 백업한다. 변경하면 기존 저장 키를 다시 연결해야 한다. `.env`와 Render의 비밀 설정만 사용하며 프론트 번들에 넣지 않는다.

예를 들어 서버 설정 없이 사용자 키만 연결하면 사용자 키로 요청한다. 서버의 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`와 모델 ID를 설정하면 해당 서버 키를 함께 쓰는 모드가 된다. 구독 계정의 기존 채팅·메모리를 자동으로 가져오지 않는다. 실제 제공자의 API 요청은 해당 키의 과금과 한도를 따른다.

대화와 선택한 마지막 대화 ID를 저장한다. 새로고침 후 AI 창을 열면 같은 대화를 다시 읽는다. 대화 내용은 DB에 있고 브라우저에는 선택한 ID만 보관한다. **AI의 장기비전 직접 수정 허용**은 주기별로 기본 꺼짐이다. 허용 후 사용자가 정리·반영을 요청하면 AI 수정안을 저장할 수 있다. 권한이 없으면 제안으로만 남긴다. **이 제안 반영하기**는 사용자의 직접 편집으로 처리한다.

대화 본문·비전 수정안·수정 이력은 Markdown으로 표시한다. 제목, 강조, 목록, 인용, 링크, 인라인/블록 코드와 GFM 표·체크리스트·취소선을 지원한다. 표와 긴 코드는 메시지 안에서 가로 스크롤하며, 일반 텍스트의 줄바꿈도 유지한다. 저장된 원문은 변경하지 않고 표시할 때만 해석한다. HTML 태그는 실행하지 않으며 위험한 링크는 활성화하지 않는다. 입력 칸에서는 원문을 편집한다.

수정 이력은 전후 원문과 작성자를 남기며 되돌릴 수 있다. 이후 다른 비전이 저장됐다면 낡은 수정을 덮어쓰지 않는다. AI 응답 중 권한 철회·계획 변경이 발생하면 수정안을 제안으로 남긴다. 저장하지 않은 사용자의 비전을 외부 AI 수정으로 덮어쓰지 않는다. AI 창이 열려 있는 동안 5초마다 최신 비전을 확인한다.

## ChatGPT·Claude에서 앱 수정

**연결 → MCP 주소 복사**의 URL을 외부 AI의 사용자 지정 MCP 서버에 등록한다. Streamable HTTP를 사용하며 주소는 `API_PUBLIC_URL/mcp`다. 서비스에서 OAuth 인증을 시작하면 TwelveWeek 화면에서 연결할 주기와 권한을 확인한다. 기존 유저 선택 흐름을 사용한다.

- `read_long_vision`: 연결한 주기의 비전, 작성 지침, 최신 version, 직접 수정 허용 여부.
- `update_long_vision`: 비전 전체와 읽기 때 받은 version을 전달. `vision:write` scope와 앱의 수정 허용이 모두 필요하다.
- 같은 endpoint를 ChatGPT, Claude 또는 Codex 등 MCP 클라이언트가 사용한다. 제공자 UI의 개별 도구 승인 정책은 해당 서비스가 정한다.

OAuth는 등록된 callback의 정확한 일치, authorization code+S256 PKCE, 5분 단회 코드, 1시간 access token, 30일 refresh token 회전을 사용한다. 연결 철회는 회전된 토큰도 같은 연결 단위로 차단한다. 토큰은 해시만 보관한다. 연결은 한 주기에 묶여 있고, 모델이 다른 사용자나 주기를 지정할 수 없다.

배포 시 `API_PUBLIC_URL`과 `WEB_PUBLIC_URL`에 실제 HTTPS 주소를 넣는다. Render Blueprint는 두 주소 입력과 서버 비밀 키 생성을 준비한다. localhost 서버는 ChatGPT·Claude 클라우드에서 직접 접근할 수 없으므로 실제 외부 연결은 HTTPS 배포 후 확인해야 한다. 공개 다중 사용자 운영에는 기존 콘솔형 유저 선택을 대체하는 계정 인증이 별도로 필요하다. 이번 변경은 사용자가 선택한 개인용 신뢰 모드를 유지한다.

## 기존 대화 가져오기와 resume

**기존 대화 가져오기**는 선택한 대화 JSON 또는 텍스트/요약을 가져와 새 앱 대화를 만든다. ChatGPT export의 현재 분기와 Claude export의 대화 텍스트를 지원한다. 파일은 5MB까지 받으며, 전체 계정 export 파일은 브라우저에서 대화 하나를 선택한 후 그 대화만 서버로 전달한다. 더 큰 export는 사용할 대화 하나를 별도 파일로 추린다. 시스템·도구·이미지 내용은 옮기지 않는다. 선택한 대화 200개 메시지/120,000자까지, 앱 대화는 300개 메시지/180,000자까지다.

이것은 원래 ChatGPT·Claude 채팅의 직접 resume나 양방향 동기화가 아니다. 화면에 **가져온 별도의 대화**로 표시한다. 외부 AI용 비전·지침 복사도 제공한다.

Codex는 선택 기능으로 실제 저장 thread를 이어간다. 대화 기록과 로그인 상태가 있는 컴퓨터에서 `codex`를 설치하고 `.env`의 `CODEX_PROFILE_ID`를 해당 TwelveWeek 프로필 UUID로 지정한다. 한 로컬 사용자에게만 연결되며 production에서는 비활성화된다. 로컬 첫 사용자 한 명인 현재 환경에는 연결 설정을 준비했다.

Codex 앱이 이미 대화를 열어둔 경우 `.env`의 `CODEX_SOCKET_PATH`에 해당 managed daemon의 Unix socket 경로를 지정한다. 앱과 같은 프로세스에 WebSocket으로 다시 연결하므로 두 번째 writer를 만들지 않는다. 현재 로컬 환경에 이 설정을 적용했다. 경로가 비어 있으면 별도의 stdio app-server를 사용한다. CLI 버전별 JSON Schema를 확인해 `thread/start/resume`의 `sandbox: "read-only"`와 `turn/start`의 `sandboxPolicy.type: "readOnly"`를 구분한다.

**연결 → 저장된 Codex 대화 찾기**에서 하나를 선택하면 텍스트 이력을 읽는다. **보내기**를 눌렀을 때 `thread/resume` 후 같은 thread에 새 turn을 시작한다. 모델 선택을 임의로 바꾸지 않는다. 읽기 전용 sandbox와 앱이 검증하는 응답 schema를 사용하며, 비전 저장은 앱의 권한 검사와 DB transaction을 통과한다. 같은 원래 thread에서 동시에 작업하지 않는다. Render가 개인 컴퓨터의 thread 기록을 읽는 연결은 제공하지 않는다.

원래 Codex 화면에서 응답 중이면 새 turn을 시작하지 않고 안내한다. 연결 오류·응답 실패가 발생해도 입력 질문은 남긴다. **저장된 질문 다시 보내기**는 같은 요청 ID로 재시도하므로 질문을 중복 저장하지 않는다. 연결 스트림이 끊기면 해당 요청만 실패 처리하고 다음 연결을 다시 만든다. shared daemon의 응답 시간이 초과되면 해당 turn만 중단하며 daemon 전체를 종료하지 않는다.

## 검증의 범위

별도 PostgreSQL 테스트 DB, 실제 MCP SDK 클라이언트의 handshake/읽기/쓰기/OAuth/권한 철회, 앱 대화 복원·수정·되돌리기·모바일·미저장 편집 충돌을 검사한다. AI 출력은 테스트에서만 주입한다. production에 모의 AI 응답이나 테스트 키를 넣지 않는다. 실제 로컬 Codex 목록 조회는 모델 요청 없이 확인한다.

로컬 managed daemon 연결과 임시 thread에서 실제 Codex 모델 응답을 확인했다. 개인 앱 대화·비전은 이 검증에서 변경하지 않았다. 실제 OpenAI/Claude 유료 요청과 ChatGPT·Claude UI의 원격 OAuth 연결은 사용자 계정/키와 배포 환경에서 추가 확인해야 한다. 모의 응답 테스트가 그 성공을 대신하지 않는다.

공식 참조: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [MCP authentication](https://developers.openai.com/plugins/build/auth), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create), [MCP SDK](https://ts.sdk.modelcontextprotocol.io/server).
