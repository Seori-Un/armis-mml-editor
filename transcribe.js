/* ============================================================
   오디오 → 노트 (AI 채보) — 1단계: 피아노 단독
   ============================================================
   ByteDance 고해상도 피아노 채보 모델(공개, Apache-2.0)을 브라우저에서
   onnxruntime-web(WASM)으로 돌린다. 서버로 아무것도 보내지 않는다.

   흐름
     ① 오디오 파일 → 16kHz 모노 파형 (WebAudio로 해독·리샘플)
     ② 10초 조각(절반 겹침)으로 잘라 모델 추론  — Web Worker에서
     ③ 조각 출력을 이어붙이고(deframe) 확률 지도 → 노트/페달 사건
        (원본 파이썬 후처리를 그대로 이식 — 아래 __POST__ 절)
     ④ 페달을 음 길이에 눌러 담아 표준 MIDI 바이트로 조립
        → 기존 MIDI 불러오기 파이프라인(합주/서스테인/솔로)이 그대로 받는다

   모델 파일 (리포의 model/ 폴더, convert_model.py로 생성):
     model.onnx        그래프 (~0.1MB)
     weights.bin.0..N  가중치 조각 (각 20MB, 8개쯤 —
                       깃허브 웹 업로드 한도 25MB에 맞춘 크기)
   최초 1회 내려받아 IndexedDB에 저장해 두고 다음부터는 즉시 연다.
   ============================================================ */

"use strict";

/* ── 모델·채보 상수 (원본 config.py와 동일) ── */
const TR_SAMPLE_RATE = 16000;
const TR_SEGMENT = TR_SAMPLE_RATE * 10;   // 10초 조각
const TR_FPS = 100;                       // 초당 프레임
const TR_BEGIN_NOTE = 21;                 // A0
const TR_VELOCITY_SCALE = 128;
const TR_ONSET_THRESHOLD = 0.3;
const TR_OFFSET_THRESHOLD = 0.3;
const TR_FRAME_THRESHOLD = 0.1;
const TR_PEDAL_OFFSET_THRESHOLD = 0.2;

const TR_MODEL_DIR = "model/";
/* 모델 파일의 정확한 크기. 진행률 표시에도 쓰고, 다 받은 뒤 온전한지
   확인하는 데도 쓴다 — 조각이 하나라도 빠지면 모델을 못 읽는데,
   그때 "모델이 이상하다"가 아니라 "몇 바이트가 모자라다"고 알려 준다. */
const TR_MODEL_BYTES = 154187172;
/* 기기에 저장해 둔 모델을 알아보는 표식.
   model/ 폴더의 모델 파일을 바꾸면 이 숫자도 반드시 올려야 한다 —
   안 그러면 기기가 저장해 둔 옛 모델을 계속 쓴다. */
const TR_MODEL_CACHE_KEY = "bytedance-piano-v3";
const TR_ORT_CDN =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";


/* ============================================================
   __POST__ 후처리 — 원본 utilities.py·piano_vad.py의 충실한 이식
   ============================================================
   순수 함수로만 작성한다. 이 절의 함수들은 toString()으로 워커에도
   주입되므로, 바깥 변수를 절대 참조하면 안 된다. */

/* 회귀 출력(산 모양 확률)에서 꼭대기를 찾아 0/1과 미세 이동량으로.
   원본: RegressionPostProcessor.get_binarized_output_from_regression */
function trBinarizeRegression(reg, framesNum, classesNum, threshold, neighbour){

  const binary = new Float32Array(framesNum * classesNum);
  const shift = new Float32Array(framesNum * classesNum);

  for(let k = 0; k < classesNum; k++){

    for(let n = neighbour; n < framesNum - neighbour; n++){

      const v = reg[n * classesNum + k];

      if(v <= threshold){
        continue;
      }

      /* 양옆 neighbour칸이 단조롭게 낮아지는 꼭대기인가 */
      let monotonic = true;

      for(let i = 0; i < neighbour; i++){
        if(reg[(n - i) * classesNum + k] < reg[(n - i - 1) * classesNum + k]){
          monotonic = false;
        }
        if(reg[(n + i) * classesNum + k] < reg[(n + i + 1) * classesNum + k]){
          monotonic = false;
        }
      }

      if(!monotonic){
        continue;
      }

      binary[n * classesNum + k] = 1;

      const prev = reg[(n - 1) * classesNum + k];
      const next = reg[(n + 1) * classesNum + k];

      let s;

      if(prev > next){
        s = (next - prev) / (v - next) / 2;
      }else{
        s = (next - prev) / (v - prev) / 2;
      }

      shift[n * classesNum + k] = s;

    }

  }

  return { binary, shift };

}

/* 건반 하나의 시계열에서 노트 구간 찾기.
   원본: piano_vad.note_detection_with_onset_offset_regress */
function trDetectNotesForKey(
  frame, onset, onsetShift, offset, offsetShift, velocity,
  framesNum, frameThreshold
){

  const out = [];

  let bgn = null;
  let frameDisappear = null;
  let offsetOccur = null;

  for(let i = 0; i < framesNum; i++){

    if(onset[i] === 1){

      if(bgn !== null && bgn !== 0){
        /* 페달을 밟은 채 같은 음을 연달아 침 — 앞 음을 여기서 닫는다 */
        const fin = Math.max(i - 1, 0);
        out.push([bgn, fin, onsetShift[bgn], 0, velocity[bgn]]);
        frameDisappear = null;
        offsetOccur = null;
      }

      bgn = i;

    }

    if(bgn !== null && bgn !== 0 && i > bgn){

      if(frame[i] <= frameThreshold && frameDisappear === null){
        frameDisappear = i;
      }

      if(offset[i] === 1 && offsetOccur === null){
        offsetOccur = i;
      }

      if(frameDisappear !== null){

        let fin;

        if(
          offsetOccur !== null &&
          offsetOccur - bgn > frameDisappear - offsetOccur
        ){
          fin = offsetOccur;
        }else{
          fin = frameDisappear;
        }

        out.push([bgn, fin, onsetShift[bgn], offsetShift[fin], velocity[bgn]]);
        bgn = null;
        frameDisappear = null;
        offsetOccur = null;

      }

      if(bgn !== null && bgn !== 0 && (i - bgn >= 600 || i === framesNum - 1)){
        /* 끝을 못 찾음 — 6초 상한 또는 곡 끝 */
        const fin = i;
        out.push([bgn, fin, onsetShift[bgn], offsetShift[fin], velocity[bgn]]);
        bgn = null;
        frameDisappear = null;
        offsetOccur = null;
      }

    }

  }

  out.sort((a, b) => a[0] - b[0]);

  return out;

}

/* 페달 구간 찾기.
   원본: piano_vad.pedal_detection_with_onset_offset_regress */
function trDetectPedals(frame, offset, offsetShift, framesNum, frameThreshold){

  const out = [];

  let bgn = null;
  let frameDisappear = null;
  let offsetOccur = null;

  for(let i = 1; i < framesNum; i++){

    if(frame[i] >= frameThreshold && frame[i] > frame[i - 1]){
      if(bgn === null){
        bgn = i;
      }
    }

    if(bgn !== null && i > bgn){

      if(frame[i] <= frameThreshold && frameDisappear === null){
        frameDisappear = i;
      }

      if(offset[i] === 1 && offsetOccur === null){
        offsetOccur = i;
      }

      if(offsetOccur !== null){
        out.push([bgn, offsetOccur, 0, offsetShift[offsetOccur]]);
        bgn = null;
        frameDisappear = null;
        offsetOccur = null;
      }else if(frameDisappear !== null && i - frameDisappear >= 10){
        out.push([bgn, frameDisappear, 0, offsetShift[frameDisappear]]);
        bgn = null;
        frameDisappear = null;
        offsetOccur = null;
      }

    }

  }

  out.sort((a, b) => a[0] - b[0]);

  return out;

}

/* 확률 지도 전체 → 노트·페달 사건.
   원본: RegressionPostProcessor.output_dict_to_midi_events */
function trPostProcess(maps, framesNum, classesNum, C){

  const on = trBinarizeRegression(
    maps.onset, framesNum, classesNum, C.onsetThreshold, 2
  );

  const off = trBinarizeRegression(
    maps.offset, framesNum, classesNum, C.offsetThreshold, 4
  );

  /* 건반별로 훑는다 */
  const notes = [];

  const col = (flat, k) => {
    const v = new Float32Array(framesNum);
    for(let n = 0; n < framesNum; n++){
      v[n] = flat[n * classesNum + k];
    }
    return v;
  };

  for(let k = 0; k < classesNum; k++){

    const tuples = trDetectNotesForKey(
      col(maps.frame, k),
      col(on.binary, k),
      col(on.shift, k),
      col(off.binary, k),
      col(off.shift, k),
      col(maps.velocity, k),
      framesNum,
      C.frameThreshold
    );

    for(const t of tuples){

      notes.push({
        onset_time: (t[0] + t[2]) / C.fps,
        offset_time: (t[1] + t[3]) / C.fps,
        midi_note: k + C.beginNote,
        velocity: Math.floor(t[4] * C.velocityScale)   // 원본 int()와 같은 버림
      });

    }

  }

  notes.sort((a, b) => a.onset_time - b.onset_time);

  /* 페달 — 밟기는 프레임 상승으로, 떼기는 회귀 꼭대기로 */
  const pOff = trBinarizeRegression(
    maps.pedalOffset, framesNum, 1, C.pedalOffsetThreshold, 4
  );

  const pedalTuples = trDetectPedals(
    maps.pedalFrame, pOff.binary, pOff.shift, framesNum, 0.5
  );

  const pedals = pedalTuples.map(t => ({
    onset_time: (t[0] + t[2]) / C.fps,
    offset_time: (t[1] + t[3]) / C.fps
  }));

  return { notes, pedals };

}
/* __POST__ 끝 */


/* ============================================================
   메인 스레드 — 해독·워커 부리기·MIDI 조립
   ============================================================ */

/* 오디오 파일 → 16kHz 모노 Float32Array */
async function trDecodeAudio(file, onProgress){

  /* 파일 읽기 — 큰 mp3는 이것만으로도 몇 초 걸린다. 흐름을 보여 준다. */
  let raw;

  if(file.stream){

    const reader =
      file.stream().getReader();

    const chunks = [];
    let got = 0;

    for(;;){

      const { done, value } = await reader.read();

      if(done){
        break;
      }

      chunks.push(value);
      got += value.byteLength;

      onProgress({ stage: "read", done: got, total: file.size || 0 });

    }

    const merged = new Uint8Array(got);
    let at = 0;

    for(const c of chunks){
      merged.set(c, at);
      at += c.byteLength;
    }

    raw = merged.buffer;

  }else{

    raw = await file.arrayBuffer();

  }

  onProgress({ stage: "decode" });

  /* 해독은 임시 컨텍스트로 (기기 기본 샘플레이트) */
  const probeCtx =
    new (window.AudioContext || window.webkitAudioContext)();

  let decoded;

  try{
    decoded = await probeCtx.decodeAudioData(raw);
  }finally{
    probeCtx.close();
  }

  onProgress({ stage: "resample" });

  /* 16kHz 모노로 다시 그린다 */
  const frames =
    Math.ceil(decoded.duration * TR_SAMPLE_RATE);

  const off =
    new OfflineAudioContext(1, frames, TR_SAMPLE_RATE);

  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();

  const rendered = await off.startRendering();

  return rendered.getChannelData(0);

}

/* 페달을 음 길이에 눌러 담는다 — 페달이 밟혀 있는 동안 뗀 음은
   페달을 뗄 때까지 울린다 (같은 건반을 다시 치면 거기서 끊김).
   서스테인 모드가 이 긴 음들을 성부로 나눠 원음 그대로 살린다. */
function trBakePedal(notes, pedals){

  if(!pedals.length){
    return notes;
  }

  const out = notes.map(n => ({ ...n }));

  /* 건반별 다음 시작 시각 */
  const byKey = new Map();

  for(const n of out){
    if(!byKey.has(n.midi_note)){
      byKey.set(n.midi_note, []);
    }
    byKey.get(n.midi_note).push(n.onset_time);
  }

  for(const list of byKey.values()){
    list.sort((a, b) => a - b);
  }

  for(const n of out){

    /* 이 음이 끝나는 순간 밟혀 있는 페달 */
    const pedal = pedals.find(
      p => p.onset_time <= n.offset_time && n.offset_time < p.offset_time
    );

    if(!pedal){
      continue;
    }

    let end = Math.max(n.offset_time, pedal.offset_time);

    /* 같은 건반의 다음 타건 직전까지가 상한 */
    const starts = byKey.get(n.midi_note);
    for(const s of starts){
      if(s > n.onset_time + 1e-4 && s < end){
        end = s;
        break;
      }
    }

    n.offset_time = end;

  }

  return out;

}

/* 노트 목록 → 표준 MIDI 바이트 (format 0, 480ppq, 템포 120 고정).
   초 단위 시각을 tick = 초 × 960 으로 옮긴다. */
function trBuildMidi(notes){

  const PPQ = 480;
  const TICKS_PER_SEC = PPQ * 2;   // 120bpm

  const events = [];

  for(const n of notes){

    const on = Math.max(0, Math.round(n.onset_time * TICKS_PER_SEC));
    let off = Math.round(n.offset_time * TICKS_PER_SEC);

    if(off <= on){
      off = on + 1;
    }

    const vel =
      Math.max(1, Math.min(127, n.velocity | 0));

    events.push({ tick: on, kind: 0x90, key: n.midi_note, val: vel });
    events.push({ tick: off, kind: 0x80, key: n.midi_note, val: 0 });

  }

  /* 같은 tick에서는 끄기를 먼저 — 같은 건반 재타건이 삼켜지지 않게 */
  events.sort(
    (a, b) => a.tick - b.tick || a.kind - b.kind
  );

  const bytes = [];

  const push = (...xs) => {
    for(const x of xs){
      bytes.push(x & 0xff);
    }
  };

  const pushVar = value => {
    let v = value & 0x0fffffff;
    const stack = [v & 0x7f];
    v >>= 7;
    while(v > 0){
      stack.push((v & 0x7f) | 0x80);
      v >>= 7;
    }
    while(stack.length){
      bytes.push(stack.pop());
    }
  };

  /* 헤더 */
  push(0x4d, 0x54, 0x68, 0x64,  0, 0, 0, 6,  0, 0,  0, 1,  PPQ >> 8, PPQ);

  /* 트랙 (길이는 나중에 채움) */
  push(0x4d, 0x54, 0x72, 0x6b,  0, 0, 0, 0);
  const trackStart = bytes.length;

  /* 템포 120 */
  pushVar(0);
  push(0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);

  let lastTick = 0;

  for(const e of events){
    pushVar(e.tick - lastTick);
    lastTick = e.tick;
    push(e.kind, e.key, e.val);
  }

  /* 트랙 끝 */
  pushVar(0);
  push(0xff, 0x2f, 0x00);

  const trackLen = bytes.length - trackStart;
  bytes[trackStart - 4] = (trackLen >>> 24) & 0xff;
  bytes[trackStart - 3] = (trackLen >>> 16) & 0xff;
  bytes[trackStart - 2] = (trackLen >>> 8) & 0xff;
  bytes[trackStart - 1] = trackLen & 0xff;

  return new Uint8Array(bytes);

}


/* ── 워커 소스 — 후처리 함수들을 toString으로 함께 실어 보낸다 ── */
function trWorkerSource(kind){

  /* 실행기(onnxruntime-web)를 불러오는 두 가지 길.

     module: 요즘 판은 WASM 붙임쇠(glue)를 .mjs로 따로 두고 필요할 때
             불러온다. 옛 방식 워커에서는 그 불러오기가 막히는 브라우저가
             있어 모델 여는 단계에서 그대로 실패한다. 그래서 붙임쇠까지
             한 덩이인 bundle 판을 모듈 워커로 싣는 길을 먼저 쓴다.
     classic: 모듈 워커를 못 만드는 낡은 브라우저를 위한 대비책.
             WASM 전용 번들이라 GPU 겸용보다 절반쯤 가볍다. */
  const fail =
    '  postMessage({ type:"error", code:"no-runtime",\n' +
    '    message:(e && e.message ? e.message : String(e)) });\n' +
    '  throw e;';

  const loader =
    kind === "module"
      ? 'let ort;\ntry{\n  ort = await import(' +
        JSON.stringify(TR_ORT_CDN + "ort.bundle.min.mjs") +
        ');\n}catch(e){\n' + fail + '\n}'
      : 'let ort;\ntry{\n  importScripts(' +
        JSON.stringify(TR_ORT_CDN + "ort.wasm.min.js") +
        ');\n  ort = self.ort;\n}catch(e){\n' + fail + '\n}';


  const post = [
    trBinarizeRegression,
    trDetectNotesForKey,
    trDetectPedals,
    trPostProcess
  ].map(f => f.toString()).join("\n\n");

  const body = `
"use strict";
${post}

const SR = ${TR_SAMPLE_RATE};
const SEG = ${TR_SEGMENT};
const FPS = ${TR_FPS};
const CLASSES = 88;
/* 모델 주소는 메인 스레드가 절대 주소로 바꿔 넘겨 준다.
   이 워커는 blob:으로 만들어져서, 안에서 "model/..." 같은 상대 주소를
   쓰면 기준이 blob: 주소가 되어 해석에 실패한다
   ("URL is not valid or contains user credentials"). */
let MODEL_DIR = "";
const CACHE_VERSION = ${JSON.stringify(TR_MODEL_CACHE_KEY.split("-").pop())};
const CACHE_KEY = ${JSON.stringify(TR_MODEL_CACHE_KEY)};

${loader}

postMessage({ type:"progress", stage:"runtimeReady" });

ort.env.wasm.wasmPaths = ${JSON.stringify(TR_ORT_CDN)};

/* 여러 스레드는 SharedArrayBuffer가 있어야 하는데, GitHub Pages는 그
   조건(COOP/COEP 헤더)을 못 맞춘다. 켜 두면 기기에 따라 적재가 실패한다. */
ort.env.wasm.numThreads = 1;

const report = (stage, done, total, extra) =>
  postMessage({ type: "progress", stage, done, total, extra });

/* IndexedDB에 모델을 담아 둔다 (다음부터는 안 내려받게) */
/* 약속이 제때 안 끝나면 포기하고 대신 값을 돌려준다.
   브라우저 저장소(IndexedDB)는 사생활 보호 모드·블롭 워커 같은 환경에서
   응답이 영영 안 오는 일이 있다. 거기서 멈추면 화면이 굳는다. */
function withTimeout(promise, ms, fallback){
  return Promise.race([
    promise,
    new Promise(res => setTimeout(() => res(fallback), ms))
  ]);
}

function idbOpen(){
  return new Promise((res, rej) => {
    const rq = indexedDB.open("armis-transcribe", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("models");
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

async function idbGet(key){
  try{
    const db = await withTimeout(idbOpen(), 4000, null);
    if(!db) return null;
    return await withTimeout(
      new Promise(res => {
        const rq = db.transaction("models").objectStore("models").get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      }),
      20000,
      null
    );
  }catch(_){ return null; }
}

async function idbPut(key, value){
  try{
    const db = await idbOpen();
    await new Promise(res => {
      const tx = db.transaction("models", "readwrite");
      tx.objectStore("models").put(value, key);
      tx.oncomplete = res;
      tx.onerror = res;
    });
  }catch(_){}
}

async function fetchWithProgress(url, onBytes){
  let resp;
  try{
    resp = await fetch(url);
  }catch(e){
    /* 주소 자체가 틀렸거나 망이 끊긴 경우 — 어느 주소에서 났는지 남긴다 */
    throw { code: "fetch", url, message: (e && e.message ? e.message : String(e)) + " (" + url + ")" };
  }
  if(!resp.ok){
    throw { code: resp.status === 404 ? "no-model" : "fetch", url,
            message: resp.status + " " + url };
  }
  const reader = resp.body && resp.body.getReader
    ? resp.body.getReader() : null;
  if(!reader){
    const buf = await resp.arrayBuffer();
    onBytes(buf.byteLength);
    return new Uint8Array(buf);
  }
  const chunks = [];
  let size = 0;
  for(;;){
    const { done, value } = await reader.read();
    if(done) break;
    chunks.push(value);
    size += value.byteLength;
    onBytes(value.byteLength);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for(const c of chunks){ out.set(c, at); at += c.byteLength; }
  return out;
}

async function idbDel(key){
  try{
    const db = await idbOpen();
    await new Promise(res => {
      const tx = db.transaction("models", "readwrite");
      tx.objectStore("models").delete(key);
      tx.oncomplete = res;
      tx.onerror = res;
    });
  }catch(_){}
}

/* 모델 준비 — 저장본이 있으면 그것으로, 아니면 내려받는다.
   저장본으로 세션을 못 열면 그 저장본을 버리고 한 번 더 시도한다
   (사이트의 모델 파일이 바뀌었는데 옛것이 남아 있던 경우). */
async function loadModel(){

  try{
    return await loadModelOnce(true);
  }catch(e){
    if(e && e.code === "session"){
      await idbDel(CACHE_KEY);
      return await loadModelOnce(false);
    }
    throw e;
  }

}

async function loadModelOnce(useCache){

  report("cache", 0, 1);

  const cached = useCache ? await idbGet(CACHE_KEY) : null;

  let model;

  if(cached && cached.model){

    model = cached.model;

  }else{

    /* 모델은 가중치까지 한 덩이인 파일 하나를 20MB 조각으로 쪼갠 것이다
       (깃허브 웹 업로드 한도 25MB에 맞춘 크기). 조각을 이어 붙여 그대로
       싣는다 — 그래프와 가중치를 따로 주는 방식은 브라우저 실행기에서
       세션 만들기가 실패했다("Can't create a session").

       하나씩 줄 세워 받으면 느리므로 몇 개씩 한꺼번에 받고,
       404가 난 지점에서 멈춘다. 조각 개수를 코드에 박지 않는 이유는
       모델을 바꾸면 개수가 달라지기 때문이다. */
    let got = 0;
    const onBytes = n => {
      got += n;
      report("model", got, ${TR_MODEL_BYTES});
    };

    const parts = [];
    const LANES = 4;
    let done = false;

    for(let base = 0; !done; base += LANES){

      const jobs = [];

      for(let i = 0; i < LANES; i++){
        jobs.push(
          fetchWithProgress(
            MODEL_DIR + "model.bin." + (base + i) + "?v=" + CACHE_VERSION,
            onBytes
          )
            .then(buf => ({ ok: true, buf }))
            .catch(e => {
              if(e && e.code === "no-model"){
                return { ok: false };
              }
              throw e;
            })
        );
      }

      const results = await Promise.all(jobs);

      for(const r of results){
        if(r.ok){
          parts.push(r.buf);
        }else{
          done = true;
          break;
        }
      }

    }

    if(!parts.length){
      throw { code: "no-model", url: MODEL_DIR + "model.bin.0" };
    }

    let total = 0;
    for(const p of parts) total += p.byteLength;

    model = new Uint8Array(total);
    let at = 0;
    for(const p of parts){ model.set(p, at); at += p.byteLength; }

    /* 온전한지 본다. 조각이 빠지거나 잘리면 여기서 잡아, 실행기가
       "protobuf parsing failed" 같은 알 수 없는 말을 하기 전에
       무엇이 모자란지 정확히 알려 준다. */
    if(total !== ${TR_MODEL_BYTES}){

      const sizes =
        parts.map(p => p.byteLength).join(", ");

      throw {
        code: "badModel",
        message:
          "모델 조각 " + parts.length + "개, 합계 " + total +
          " / 있어야 할 크기 ${TR_MODEL_BYTES} 바이트. 조각 크기: " + sizes
      };

    }

    /* 저장은 기다리지 않는다. 큰 파일을 쓰는 데 오래 걸리는 기기가 있고,
       그동안 채보가 멈춰 있을 이유가 없다. 실패해도 다음에 다시 받으면 된다. */
    idbPut(CACHE_KEY, { model });

  }

  report("session", 0, 1);

  /* 그래프 최적화는 "꺼 둔다".
     이 모델은 브라우저 실행기가 최적화를 시도하면 WASM 안에서 터진다.
     그래서 모델을 만들 때 미리 최적화를 끝내 두고(convert_model.py),
     여기서는 그대로 싣기만 한다. 최적화는 연산을 합칠 뿐이라 결과는
     한 치도 다르지 않다 — 최적화 전후 출력이 완전히 같은 것을 확인했다. */
  try{

    return await ort.InferenceSession.create(
      model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength),
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "disabled"
      }
    );

  }catch(e){

    throw {
      code: "session",
      message:
        typeof e === "number"
          ? "session " + e
          : (e && e.message ? e.message : String(e))
    };

  }

}

/* 10초 조각(절반 겹침)으로 잘라 추론하고, 원본 deframe 규칙대로
   가운데 절반씩을 이어 붙인다 */
async function transcribe(wave){
  const session = await loadModel();

  const padded =
    Math.ceil(wave.length / SEG) * SEG;
  const audio = new Float32Array(padded);
  audio.set(wave);

  const hop = SEG / 2;
  const N = Math.max(1, padded / hop - 1);

  const segFrames = SEG / SR * FPS + 1;     // 1001
  const useFrames = segFrames - 1;          // 1000 (조각 끝 여분 프레임 제거)
  const quarter = useFrames / 4;            // 250

  const totalFrames =
    N === 1 ? segFrames : (N + 1) * (useFrames / 2);

  const keys =
    ["onset","offset","frame","velocity","pedal_on","pedal_off","pedal_frame"];
  const width = { onset:CLASSES, offset:CLASSES, frame:CLASSES,
                  velocity:CLASSES, pedal_on:1, pedal_off:1, pedal_frame:1 };
  const maps = {};
  for(const k of keys){
    maps[k] = new Float32Array(totalFrames * width[k]);
  }

  let framePointer = 0;
  const t0 = Date.now();

  for(let s = 0; s < N; s++){

    const seg = audio.subarray(s * hop, s * hop + SEG);
    const input = new ort.Tensor("float32", seg, [1, SEG]);
    const out = await session.run({ waveform: input });

    /* 이번 조각에서 취할 프레임 범위 (원본 deframe과 동일) */
    let from, to;
    if(N === 1){ from = 0; to = segFrames; }
    else if(s === 0){ from = 0; to = quarter * 3; }
    else if(s === N - 1){ from = quarter; to = useFrames; }
    else { from = quarter; to = quarter * 3; }

    for(let ki = 0; ki < keys.length; ki++){
      const k = keys[ki];
      const w = width[k];
      const data = out[["onset","offset","frame","velocity","pedal_on","pedal_off","pedal_frame"][ki]].data;
      maps[k].set(
        data.subarray(from * w, to * w),
        framePointer * w
      );
    }

    framePointer += to - from;

    const per = (Date.now() - t0) / (s + 1);
    report("transcribe", s + 1, N, Math.round(per * (N - s - 1) / 1000));

  }

  report("post", 0, 1);

  const result = trPostProcess(
    {
      onset: maps.onset, offset: maps.offset,
      frame: maps.frame, velocity: maps.velocity,
      pedalOffset: maps.pedal_off, pedalFrame: maps.pedal_frame
    },
    framePointer, CLASSES,
    {
      fps: FPS, beginNote: ${TR_BEGIN_NOTE},
      velocityScale: ${TR_VELOCITY_SCALE},
      onsetThreshold: ${TR_ONSET_THRESHOLD},
      offsetThreshold: ${TR_OFFSET_THRESHOLD},
      frameThreshold: ${TR_FRAME_THRESHOLD},
      pedalOffsetThreshold: ${TR_PEDAL_OFFSET_THRESHOLD}
    }
  );

  postMessage({ type: "result", notes: result.notes, pedals: result.pedals });
}

onmessage = e => {
  if(e.data && e.data.type === "start"){
    MODEL_DIR = e.data.modelBase;
    transcribe(e.data.wave).catch(err => {
      postMessage({
        type: "error",
        code: (err && err.code) || "",
        message: (err && (err.message || err.url)) || String(err)
      });
    });
  }
};

/* 이제 지시를 받을 수 있다고 알린다.
   이 알림을 받은 뒤에야 메인이 시작 신호를 보낸다 — 실행기를 불러오는
   동안(몇 초) 보낸 신호가 흘러가 버려 워커가 영영 기다리는 일을 막는다. */
postMessage({ type: "ready" });
`;

  return body;

}


/* ── 공개 함수: 파일 → MIDI 바이트 ──
   onProgress({ stage, done, total, extra }) 로 진행을 알린다.
   stage: decode | model | session | transcribe | post | build */
function startAudioTranscription(file, onProgress){

  let worker = null;

  const promise = (async () => {

    onProgress({ stage: "read", done: 0, total: file.size || 0 });

    const wave = await trDecodeAudio(file, onProgress);

    onProgress({ stage: "runtime" });

    /* 모듈 워커로 먼저 시도하고, 못 만들면 옛 방식으로 물러선다 */
    const makeWorker = kind=>{

      const blob =
        new Blob(
          [trWorkerSource(kind)],
          { type: "text/javascript" }
        );

      return new Worker(
        URL.createObjectURL(blob),
        kind === "module" ? { type: "module" } : undefined
      );

    };

    try{
      worker = makeWorker("module");
    }catch(_){
      worker = makeWorker("classic");
    }

    const { notes, pedals } = await new Promise((resolve, reject) => {

      let started = false;

      /* 실행기를 못 불러오면 "준비됐다"가 영영 안 온다. 무한정 기다리지
         않고 일러 준다 (망 차단·CDN 접근 실패 등). */
      const readyGuard =
        setTimeout(
          ()=>{

            if(!started){

              const err =
                new Error("worker-ready-timeout");

              err.code = "no-runtime";

              reject(err);

            }

          },
          90000
        );

      worker.onmessage = e => {

        const m = e.data;

        if(m.type === "ready"){
          started = true;
          sendStart();
        }else if(m.type === "progress"){
          onProgress(m);
        }else if(m.type === "result"){
          clearTimeout(readyGuard);
          resolve(m);
        }else if(m.type === "error"){
          clearTimeout(readyGuard);
          const err = new Error(m.message);
          err.code = m.code;
          reject(err);
        }

      };

      worker.onerror = e => {
        clearTimeout(readyGuard);
        reject(new Error(e.message || "worker"));
      };

      /* 시작 신호는 워커가 "준비됐다"고 알린 뒤에 보낸다.
         파형은 소유권을 넘겨 복사 없이 전달하고, 모델 주소는 여기서
         절대 주소로 만들어 함께 보낸다 — 워커가 blob:이라 상대 주소를
         스스로 풀 수 없기 때문이다. */
      const sendStart = ()=>{

        worker.postMessage(
          {
            type: "start",
            wave,
            modelBase:
              new URL(TR_MODEL_DIR, location.href).href
          },
          [wave.buffer]
        );

      };

    });

    onProgress({ stage: "build" });

    const baked = trBakePedal(notes, pedals);

    return trBuildMidi(baked);

  })();

  promise.finally(() => {
    if(worker){
      worker.terminate();
    }
  });

  promise.cancel = () => {
    if(worker){
      worker.terminate();
      worker = null;
    }
  };

  return promise;

}
