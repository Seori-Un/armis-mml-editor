# Armis MML 변환 서버 (Cloudflare Workers)

편집기(GitHub Pages)에서 MIDI 파일을 불러올 때 무거운 변환 계산을
사용자 기기 대신 이 서버에서 처리하기 위한 API다.

## 배포 순서

1. 이 폴더(`server/`)를 로컬에 내려받고 그 안에서:
   ```
   npm install
   npx wrangler login
   ```
   (Cloudflare 계정이 없으면 무료로 하나 만들면 된다)

2. `worker.js` 맨 위쪽 `ALLOWED_ORIGINS` 배열에 GitHub Pages 주소를 넣는다.
   ```js
   const ALLOWED_ORIGINS = ["https://your-id.github.io"];
   ```
   비워 두면 누구나 이 API를 호출할 수 있다 — 처음 테스트할 땐 편하지만,
   실제로 공개할 때는 반드시 주소를 넣어 좁혀 두는 걸 권한다.

3. 배포:
   ```
   npx wrangler deploy
   ```
   끝나면 `https://armis-mml-convert.<계정이름>.workers.dev` 같은
   주소가 출력된다. 이 주소를 복사해 둔다.

4. 편집기 쪽 `app.js` 맨 위에 있는 `MIDI_API_URL` 상수에 그 주소를 넣는다.
   ```js
   const MIDI_API_URL = "https://armis-mml-convert.<계정이름>.workers.dev";
   ```

## 동작

- 화면은 MIDI 파일을 받으면 먼저 이 서버로 보낸다.
- 서버가 막혀 있거나(주소를 안 넣었거나, 오프라인, CORS 등) 5초 안에
  응답이 없으면, 화면은 자동으로 브라우저 안 백그라운드 스레드(Worker)로,
  그것도 안 되면 메인 화면 스레드로 조용히 대체한다.
  즉 서버를 안 붙여도 편집기 자체는 그대로 동작한다.

## 무료 티어 한도 (2025년 기준, 변경될 수 있음)

- 요청 10만 건 / 일
- 요청 하나당 CPU 시간 10ms

MIDI 변환은 곡 길이에 비례해 시간이 늘어난다. 아주 긴 곡을 자주
다룬다면 Cloudflare 대시보드에서 유료 플랜(요청당 50ms) 전환을
고려한다. 서버가 시간 초과로 실패해도 화면은 자동으로 로컬 계산으로
넘어가므로 기능이 완전히 멈추지는 않는다.
