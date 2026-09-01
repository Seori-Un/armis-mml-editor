/* ============================================================
   MIDI 변환 워커
   ============================================================
   메인 화면(브라우저 UI 스레드)과 분리된 백그라운드 스레드에서
   MIDI 파일 파싱 + MML 변환(convert)을 수행한다.

   무거운 건 이 파일 하나뿐이다 — MIDI 파일을 다 읽어서
   트랙/이벤트/템포를 다시 짜는 부분(convert)이 곡이 길수록
   오래 걸리는데, 메인 스레드에서 돌리면 그동안 화면이
   멈춘 것처럼 보인다(드래그도 안 먹고, 스크롤도 안 됨).
   여기로 옮기면 그동안 사용자는 계속 화면을 만질 수 있다.

   midi-engine.js는 처음부터 DOM/window를 전혀 쓰지 않는
   순수 변환 엔진이라 워커 안에서 그대로 돌아간다.
   (app.js 쪽은 실시간 편집 화면을 그리므로 워커로 옮기지 않는다.) */

importScripts("midi-engine.js");

self.onmessage = (event) => {

  const { buffer, requestId, options } = event.data;

  try {

    const song = convert(buffer, options || {});

    self.postMessage({ requestId, ok: true, song });

  } catch (error) {

    self.postMessage({
      requestId,
      ok: false,
      message: error && error.message ? error.message : String(error)
    });

  }

};
