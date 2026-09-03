/* ============================================================
   공동 작업 (실시간 동시 편집)
   ============================================================
   구글 문서처럼, 방번호 하나로 여러 사람이 같은 곡을 동시에
   고치는 기능이다. 서버는 worker.js의 CollabRoom(Durable Object).

   동작 원리 — 노트 단위 동기화:

     1. 방에 있는 동안 모든 트랙과 노트에 고유 딱지(cid)를 붙인다.
        노트의 _cid는 곡을 저장해도 그냥 딸려 갈 뿐, 편집기의 다른
        코드는 이 값을 전혀 안 본다.

     2. 편집이 한 걸음 끝날 때마다(renderOutputs 끝에서 이 파일의
        collabOnLocalChange가 불린다) 직전에 서버와 맞춰 둔 모습
        (baseline)과 지금 모습을 노트 단위로 비교해서, 달라진 것만
        op(작은 편집 명령) 목록으로 서버에 보낸다.
          노트가 새로 생김/바뀜 → noteSet   사라짐 → noteDel
          트랙이 생김/사라짐/이름 등 바뀜/순서 바뀜 → track…

     3. 서버는 op를 자기 문서에 적용하고 방의 다른 사람들에게
        그대로 중계한다. 받은 쪽은 cid로 노트를 찾아 적용한다.
        서로 다른 노트를 고치면 절대 충돌하지 않고, 같은 노트를
        정확히 동시에 고치면 서버에 늦게 닿은 쪽이 남는다.

   문서 모양과 applyCollabOps는 worker.js와 완전히 같아야 한다.
   한쪽을 고치면 반드시 다른 쪽도 고칠 것.

   app.js가 이 파일에 기대는 것: 맨 끝의 collabOnLocalChange 호출 하나.
   이 파일이 app.js에 기대는 것(전역): tracks, refreshAll,
   normalizeAllNotes, undoStack, redoStack, discardGhost, ghost,
   selectedTrack, showToast, t, applyI18n, MIDI_API_URL.

   방에 있는 동안의 되돌리기(Ctrl+Z)에 대해:
     내 편집만 되돌리는 게 아니라 화면 전체를 예전으로 돌리는
     방식이라, 다른 사람이 그 사이 고친 것까지 지워 버릴 수 있다.
     그래서 v1에서는 다른 사람의 편집이 도착하는 순간 되돌리기
     기록을 비운다. (내가 혼자 연달아 고치는 동안에는 그대로 됨)
   ============================================================ */


/* ── 상태 ── */

let collabWs = null;              // 연결된 WebSocket (없으면 미접속)
let collabCode = null;            // 방번호 (6자리 글자)
let collabYou = null;             // 서버가 준 내 정보 {id,name,color}
let collabPeers = [];             // 나를 포함한 접속자 목록
let collabBaseline = null;        // 서버와 마지막으로 맞춘 문서 모습
let collabApplyingRemote = false; // 남의 편집을 적용하는 중 (되돌아 안 보냄)
let collabQueue = [];             // 드래그 중에 도착한 남의 편집 (잠시 보관)
let collabQueueTimer = null;
let collabReconnectTimer = null;
let collabWantRoom = false;       // 사용자가 방에 있고 싶어 하는가 (재접속 판단)
let collabMyName = "";
let collabLastSel = undefined;    // 마지막으로 알린 내 트랙 위치
let collabCidSeed = 0;


function collabActive(){

  return !!(collabWs && collabWs.readyState === WebSocket.OPEN);

}


/* ── cid 붙이기 ── */

function collabFreshCid(){

  collabCidSeed += 1;

  return (
    Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 8) + "-" +
    collabCidSeed.toString(36)
  );

}


/* 트랙·노트에 빠진 cid를 채운다.
   복사-붙여넣기는 노트 객체를 통째로 복제하므로 _cid까지 복제된다 —
   같은 cid가 두 번 보이면 뒤의 것은 새 노트로 보고 새 cid를 준다. */
function collabEnsureCids(){

  const seenTracks = new Set();

  for(const track of tracks){

    if(!track._cid || seenTracks.has(track._cid)){
      track._cid = collabFreshCid();
    }

    seenTracks.add(track._cid);

    const seenNotes = new Set();

    for(const note of track.notes){

      if(!note._cid || seenNotes.has(note._cid)){
        note._cid = collabFreshCid();
      }

      seenNotes.add(note._cid);

    }

  }

}


/* ── 편집기 트랙 ↔ 문서 모양 변환 ── */

/* 문서에 넣는 트랙 정보. selected(보임/숨김)는 사람마다 다른
   화면 상태라 뺀다. notes와 _cid도 여기 말고 딴 데서 다룬다. */
function collabTrackMeta(track){

  return {
    name: track.name,
    midiName: track.midiName === undefined ? null : track.midiName,
    label: track.label === undefined ? null : track.label,
    velocityMarkers: track.velocityMarkers || [],
    tempoMarkers: track.tempoMarkers || []
  };

}


/* 노트에서 _cid만 뺀 복사본 (문서에 넣는 값) */
function collabNoteData(note){

  const data = { ...note };

  delete data._cid;

  return data;

}


/* 지금 tracks 전체 → 문서 모양.

   ★ 마지막에 JSON 왕복으로 깊은 복사를 한다. 이게 없으면 techs
   배열이나 마커 배열이 화면의 실물을 그대로 가리켜서, 기법·마커를
   고치는 순간 비교 기준(baseline)도 같이 바뀐다 → "달라진 게 없다"
   고 판단해 아무것도 안 보내는 버그가 된다. (노트 위치처럼 겉에
   있는 숫자만 동기화되고 배열 속은 안 되던 증상의 원인) */
function collabSnapshotDoc(){

  collabEnsureCids();

  const doc = {
    tracks: tracks.map(
      track => {

        const notes = {};

        for(const note of track.notes){

          notes[note._cid] =
            collabNoteData(note);

        }

        return {
          cid: track._cid,
          meta: collabTrackMeta(track),
          notes
        };

      }
    )
  };

  return JSON.parse(JSON.stringify(doc));

}


/* 문서 모양 → 편집기 트랙 배열 (입장할 때 통째로 받아 얹는다)

   ★ 먼저 문서를 깊은 복사한다. 안 하면 만들어진 트랙의 techs·마커
   배열이 baseline 속 실물을 가리켜, 이후의 내 편집이 baseline까지
   같이 바꿔 버린다 (collabSnapshotDoc의 주석과 같은 병). */
function collabDocToTracks(doc){

  doc = JSON.parse(JSON.stringify(doc || { tracks: [] }));

  return (doc.tracks || []).map(
    docTrack => {

      const meta =
        docTrack.meta || {};

      const notes = [];

      for(const cid of Object.keys(docTrack.notes || {})){

        const note =
          { ...docTrack.notes[cid], _cid: cid };

        notes.push(note);

      }

      return {
        _cid: docTrack.cid,
        name: meta.name || "피아노",
        midiName: meta.midiName === undefined ? null : meta.midiName,
        label: meta.label === undefined ? null : meta.label,
        selected: true,
        notes,
        velocityMarkers:
          Array.isArray(meta.velocityMarkers) && meta.velocityMarkers.length
            ? meta.velocityMarkers
            : [{ bar:0, velocity:12 }],
        tempoMarkers:
          Array.isArray(meta.tempoMarkers) && meta.tempoMarkers.length
            ? meta.tempoMarkers
            : [{ bar:0, tempo:120 }]
      };

    }
  );

}


/* ── op 적용 (worker.js의 applyCollabOps와 완전히 동일해야 함) ── */

function applyCollabOps(doc, ops){

  if(!doc || !Array.isArray(doc.tracks)){
    doc = { tracks: [] };
  }

  const findTrack =
    cid => doc.tracks.find(tr => tr.cid === cid);

  for(const op of ops){

    if(!op || typeof op.t !== "string"){
      continue;
    }

    switch(op.t){

      case "trackAdd": {

        const existing =
          findTrack(op.tcid);

        const track = {
          cid: op.tcid,
          meta: op.meta || {},
          notes: {}
        };

        if(Array.isArray(op.notes)){

          for(const pair of op.notes){

            if(Array.isArray(pair) && pair.length === 2){
              track.notes[pair[0]] = pair[1];
            }

          }

        }

        if(existing){

          // 같은 cid가 이미 있으면 통째로 바꾼다 (재전송 등)
          doc.tracks[doc.tracks.indexOf(existing)] = track;

        }else{

          const index =
            Math.max(
              0,
              Math.min(
                Number.isInteger(op.index) ? op.index : doc.tracks.length,
                doc.tracks.length
              )
            );

          doc.tracks.splice(index, 0, track);

        }

        break;

      }

      case "trackDel": {

        const track =
          findTrack(op.tcid);

        if(track){
          doc.tracks.splice(doc.tracks.indexOf(track), 1);
        }

        break;

      }

      case "trackMeta": {

        const track =
          findTrack(op.tcid);

        if(track){
          track.meta = op.meta || {};
        }

        break;

      }

      case "trackOrder": {

        if(!Array.isArray(op.order)){
          break;
        }

        const byCid = new Map(
          doc.tracks.map(tr => [tr.cid, tr])
        );

        const next = [];

        for(const cid of op.order){

          const track = byCid.get(cid);

          if(track){
            next.push(track);
            byCid.delete(cid);
          }

        }

        // 순서 목록에 없는 트랙(그 사이 새로 생긴 것)은 뒤에 그대로 둔다
        for(const track of doc.tracks){

          if(byCid.has(track.cid)){
            next.push(track);
          }

        }

        doc.tracks = next;

        break;

      }

      case "noteSet": {

        const track =
          findTrack(op.tcid);

        if(track && typeof op.cid === "string"){
          track.notes[op.cid] = op.data;
        }

        break;

      }

      case "noteDel": {

        const track =
          findTrack(op.tcid);

        if(track && typeof op.cid === "string"){
          delete track.notes[op.cid];
        }

        break;

      }

    }

  }

  return doc;

}


/* ── 내 편집을 op로 만들어 보내기 ── */

/* baseline과 지금 모습을 비교해 달라진 것만 op로 만든다 */
function collabDiff(){

  const now =
    collabSnapshotDoc();

  const before =
    collabBaseline || { tracks: [] };

  const ops = [];

  const beforeByCid =
    new Map(before.tracks.map(tr => [tr.cid, tr]));

  const nowCids =
    new Set(now.tracks.map(tr => tr.cid));

  // 사라진 트랙
  for(const oldTrack of before.tracks){

    if(!nowCids.has(oldTrack.cid)){

      ops.push({ t:"trackDel", tcid: oldTrack.cid });

    }

  }

  // 생긴 트랙 / 바뀐 트랙
  now.tracks.forEach(
    (track, index) => {

      const old =
        beforeByCid.get(track.cid);

      if(!old){

        ops.push({
          t:"trackAdd",
          tcid: track.cid,
          index,
          meta: track.meta,
          notes: Object.keys(track.notes).map(
            cid => [cid, track.notes[cid]]
          )
        });

        return;

      }

      if(
        JSON.stringify(old.meta) !==
        JSON.stringify(track.meta)
      ){

        ops.push({
          t:"trackMeta",
          tcid: track.cid,
          meta: track.meta
        });

      }

      // 노트 비교
      for(const cid of Object.keys(old.notes)){

        if(!(cid in track.notes)){

          ops.push({ t:"noteDel", tcid: track.cid, cid });

        }

      }

      for(const cid of Object.keys(track.notes)){

        const oldNote =
          old.notes[cid];

        if(
          !oldNote ||
          JSON.stringify(oldNote) !==
          JSON.stringify(track.notes[cid])
        ){

          ops.push({
            t:"noteSet",
            tcid: track.cid,
            cid,
            data: track.notes[cid]
          });

        }

      }

    }
  );

  // 순서 비교 (남아 있는 트랙 기준)
  const beforeOrder =
    before.tracks
      .map(tr => tr.cid)
      .filter(cid => nowCids.has(cid));

  const nowOrder =
    now.tracks
      .map(tr => tr.cid)
      .filter(cid => beforeByCid.has(cid));

  if(beforeOrder.join(",") !== nowOrder.join(",")){

    ops.push({
      t:"trackOrder",
      order: now.tracks.map(tr => tr.cid)
    });

  }

  return { ops, now };

}


/* 편집 한 걸음이 끝날 때마다 app.js(renderOutputs 끝)가 부른다 */
function collabOnLocalChange(){

  if(!collabActive() || collabApplyingRemote){
    return;
  }

  const { ops, now } =
    collabDiff();

  if(!ops.length){
    return;
  }

  collabBaseline = now;

  try{

    collabWs.send(
      JSON.stringify({ type:"ops", ops })
    );

  }catch(_){
    // 끊겼으면 onclose가 재접속을 맡는다
  }

}


/* ── 남의 편집 받기 ── */

function collabApplyRemote(ops){

  // 내가 드래그하는 중이면 판이 흔들리지 않게 잠시 미룬다
  if(typeof ghost !== "undefined" && ghost){

    collabQueue.push(...ops);

    if(!collabQueueTimer){

      collabQueueTimer =
        setInterval(
          () => {

            if(typeof ghost !== "undefined" && ghost){
              return;
            }

            clearInterval(collabQueueTimer);
            collabQueueTimer = null;

            const queued =
              collabQueue;

            collabQueue = [];

            if(queued.length){
              collabApplyRemote(queued);
            }

          },
          200
        );

    }

    return;

  }

  collabApplyingRemote = true;

  try{

    // 문서에 적용하고, 그 문서를 화면에 다시 얹는다.
    // (노트 몇 개 때문에 전체를 다시 만드는 게 아깝지만, cid 기반이라
    //  실제로 새로 생기는 객체는 바뀐 트랙 몫뿐이고 화면 갱신이 지배적이다)
    collabBaseline =
      applyCollabOps(
        collabBaseline || { tracks: [] },
        ops
      );

    const beforeSelectedCid =
      tracks[selectedTrack] && tracks[selectedTrack]._cid;

    const selectedMap =
      new Map(
        tracks.map(tr => [tr._cid, tr.selected !== false])
      );

    const nextTracks =
      collabDocToTracks(collabBaseline);

    // 내 보임/숨김 상태는 그대로 유지한다
    for(const track of nextTracks){

      if(selectedMap.has(track._cid)){
        track.selected = selectedMap.get(track._cid);
      }

    }

    tracks = nextTracks;

    normalizeAllNotes();

    // 내가 보던 트랙을 다시 찾아 준다
    const nextIndex =
      tracks.findIndex(tr => tr._cid === beforeSelectedCid);

    selectedTrack =
      nextIndex >= 0
        ? nextIndex
        : Math.max(0, Math.min(selectedTrack, tracks.length - 1));

    selectedNote = null;
    selectedMarker = null;

    if(typeof clearMultiSelection === "function"){
      clearMultiSelection();
    }

    /* v1 한계: 남의 편집이 섞인 뒤의 되돌리기는 남의 작업까지
       지울 수 있어, 기록을 비운다. (파일 위 설명 참고) */
    undoStack.length = 0;
    redoStack.length = 0;

    if(typeof ensureFocusedTrack === "function"){
      ensureFocusedTrack();
    }

    refreshAll();

  }finally{

    collabApplyingRemote = false;

  }

}


/* ── 접속 ── */

function collabWsUrl(code, name){

  const base =
    MIDI_API_URL.replace(/^http/, "ws").replace(/\/+$/, "");

  return (
    base + "/room/ws?code=" + encodeURIComponent(code) +
    "&name=" + encodeURIComponent(name)
  );

}


function collabConnect(code, name, isCreator){

  collabWantRoom = true;
  collabMyName = name;

  let ws;

  try{

    ws = new WebSocket(collabWsUrl(code, name));

  }catch(_){

    showToast(t("collab.connectFail"));
    return;

  }

  ws.onopen = () => {

    // init 메시지를 기다린다 (서버가 먼저 보낸다)

  };

  ws.onmessage = (event) => {

    let msg;

    try{

      msg = JSON.parse(event.data);

    }catch(_){

      return;

    }

    if(msg.type === "init"){

      collabWs = ws;
      collabCode = code;
      collabYou = msg.you;
      collabPeers = msg.peers || [];

      if(isCreator){

        /* 방을 만든 사람: 서버 문서는 내 곡으로 시작했으니
           baseline만 맞추면 된다 */
        collabBaseline =
          collabSnapshotDoc();

        // 만들기 전 마지막 편집이 문서에 늦게 반영됐을 수 있어 한 번 비교
        collabOnLocalChange();

      }else{

        // 들어간 사람: 서버 곡을 통째로 받는다
        collabBaseline = msg.doc;

        collabApplyingRemote = true;

        try{

          tracks =
            collabDocToTracks(collabBaseline);

          normalizeAllNotes();

          selectedTrack = 0;
          selectedNote = null;
          selectedMarker = null;

          if(typeof clearMultiSelection === "function"){
            clearMultiSelection();
          }

          undoStack.length = 0;
          redoStack.length = 0;

          if(typeof ensureFocusedTrack === "function"){
            ensureFocusedTrack();
          }

          refreshAll();

        }finally{

          collabApplyingRemote = false;

        }

      }

      collabLastSel = undefined;
      collabRenderStatus();
      collabRenderDialog();

      showToast(
        t(isCreator ? "collab.created" : "collab.joined", { code })
      );

      return;

    }

    if(msg.type === "ops" && Array.isArray(msg.ops)){

      collabApplyRemote(msg.ops);
      return;

    }

    if(msg.type === "peers"){

      collabPeers = msg.peers || [];
      collabRenderStatus();
      collabRenderDialog();
      return;

    }

    if(msg.type === "presence"){

      const peer =
        collabPeers.find(p => p.id === msg.from);

      if(peer){

        peer.sel = msg.sel;

      }else{

        collabPeers.push({
          id: msg.from,
          name: msg.name,
          color: msg.color,
          sel: msg.sel
        });

      }

      collabRenderDialog();
      return;

    }

    // ack는 지금 쓸 일이 없다 (보내는 즉시 baseline을 옮기므로)

  };

  ws.onclose = () => {

    const wasActive =
      collabWs === ws;

    if(collabWs === ws){
      collabWs = null;
    }

    collabRenderStatus();

    if(wasActive && collabWantRoom){

      showToast(t("collab.reconnecting"));

      collabReconnectTimer =
        setTimeout(
          () => {

            collabReconnectTimer = null;

            if(collabWantRoom && !collabActive()){

              /* 다시 들어갈 땐 서버 곡을 받는 쪽으로 (서버가 정답) */
              collabConnect(collabCode, collabMyName, false);

            }

          },
          3000
        );

    }

  };

  ws.onerror = () => {

    // onclose가 뒤따라 온다

  };

}


function collabLeave(showMessage){

  collabWantRoom = false;

  if(collabReconnectTimer){
    clearTimeout(collabReconnectTimer);
    collabReconnectTimer = null;
  }

  if(collabWs){

    try{ collabWs.close(); }catch(_){ /* 무시 */ }

    collabWs = null;

  }

  collabCode = null;
  collabYou = null;
  collabPeers = [];
  collabBaseline = null;

  collabRenderStatus();
  collabRenderDialog();

  if(showMessage){
    showToast(t("collab.left"));
  }

}


/* ── 방 만들기 ── */

async function collabCreateRoom(name){

  if(!MIDI_API_URL){

    showToast(t("collab.noServer"));
    return;

  }

  collabSetBusy(true);

  try{

    const doc =
      collabSnapshotDoc();

    const response =
      await fetch(
        MIDI_API_URL.replace(/\/+$/, "") + "/room/new",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc })
        }
      );

    const data =
      await response.json();

    if(!data.ok){

      showToast(data.message || t("collab.connectFail"));
      return;

    }

    collabConnect(data.code, name, true);

  }catch(_){

    showToast(t("collab.connectFail"));

  }finally{

    collabSetBusy(false);

  }

}


/* ── 내 위치 알리기 (2초마다, 바뀌었을 때만) ── */

setInterval(
  () => {

    if(!collabActive()){
      return;
    }

    const sel =
      tracks[selectedTrack] && tracks[selectedTrack]._cid
        ? tracks[selectedTrack]._cid
        : null;

    if(sel === collabLastSel){
      return;
    }

    collabLastSel = sel;

    try{

      collabWs.send(
        JSON.stringify({ type:"presence", sel })
      );

    }catch(_){ /* 무시 */ }

  },
  2000
);


/* ============================================================
   화면 (단추 · 창 · 상태 표시)
   ============================================================ */

const collabButton =
  document.getElementById("collabButton");

const collabBackdrop =
  document.getElementById("collabBackdrop");

const collabMenuView =
  document.getElementById("collabMenuView");

const collabJoinView =
  document.getElementById("collabJoinView");

const collabRoomView =
  document.getElementById("collabRoomView");

const collabNameInput =
  document.getElementById("collabNameInput");

const collabCodeInput =
  document.getElementById("collabCodeInput");

const collabStatusChip =
  document.getElementById("collabStatus");

const COLLAB_NAME_KEY = "armis-collab-name";


function collabSetBusy(busy){

  collabBackdrop
    .querySelectorAll("button")
    .forEach(el => { el.disabled = busy; });

}


function collabOpenDialog(){

  collabRenderDialog();

  /* 이 편집기의 창은 두 단계로 연다:
     show(자리 잡기, display) → 다음 프레임에 visible(투명도 전환).
     붙자마자 visible을 얹으면 전환이 안 걸린다 — app.js showConfirm 참고. */
  collabBackdrop.classList.add("show");

  requestAnimationFrame(
    () => {

      collabBackdrop.classList.add("visible");

    }
  );

  if(typeof applyI18nToDom === "function"){
    applyI18nToDom(collabBackdrop);
  }

}


function collabCloseDialog(){

  collabBackdrop.classList.remove("visible");

  setTimeout(
    () => {

      collabBackdrop.classList.remove("show");

    },
    160
  );

}


function collabShowView(view){

  [collabMenuView, collabJoinView, collabRoomView].forEach(
    el => { el.hidden = el !== view; }
  );

}


function collabRenderDialog(){

  if(!collabBackdrop.classList.contains("visible") && !collabActive()){
    // 닫혀 있으면 굳이 안 그린다 (열 때 다시 그린다)
  }

  if(collabActive()){

    collabShowView(collabRoomView);

    document.getElementById("collabRoomCode").textContent =
      collabCode || "";

    const list =
      document.getElementById("collabPeerList");

    list.innerHTML = "";

    for(const peer of collabPeers){

      const row =
        document.createElement("div");

      row.className = "collab-peer";

      const dot =
        document.createElement("span");

      dot.className = "collab-peer-dot";
      dot.style.background = peer.color || "#888";

      const label =
        document.createElement("span");

      const isMe =
        collabYou && peer.id === collabYou.id;

      let text =
        (peer.name || "?") + (isMe ? " " + t("collab.me") : "");

      if(peer.sel){

        const track =
          tracks.find(tr => tr._cid === peer.sel);

        if(track){

          text += " — " + t("collab.onTrack", { name: track.name });

        }

      }

      label.textContent = text;

      row.appendChild(dot);
      row.appendChild(label);
      list.appendChild(row);

    }

  }else{

    collabShowView(collabMenuView);

  }

}


function collabRenderStatus(){

  if(collabActive()){

    collabStatusChip.hidden = false;

    collabStatusChip.textContent =
      "● " + t("collab.status", {
        code: collabCode,
        n: collabPeers.length
      });

  }else if(collabWantRoom){

    collabStatusChip.hidden = false;
    collabStatusChip.textContent = "○ " + t("collab.reconnecting");

  }else{

    collabStatusChip.hidden = true;

  }

}


function collabSavedName(){

  let saved = "";

  try{

    saved =
      localStorage.getItem(COLLAB_NAME_KEY) || "";

  }catch(_){ /* 무시 */ }

  return saved;

}


function collabRememberName(name){

  try{

    localStorage.setItem(COLLAB_NAME_KEY, name);

  }catch(_){ /* 무시 */ }

}


/* ── 단추들 ── */

collabButton.addEventListener("click", () => {

  collabNameInput.value =
    collabSavedName();

  collabOpenDialog();

});

collabStatusChip.addEventListener("click", collabOpenDialog);

document.getElementById("collabClose")
  .addEventListener("click", collabCloseDialog);

collabBackdrop.addEventListener("click", (event) => {

  if(event.target === collabBackdrop){
    collabCloseDialog();
  }

});


/* 메뉴: 방 만들기 */
document.getElementById("collabCreateBtn")
  .addEventListener("click", () => {

    const name =
      collabNameInput.value.trim() || t("collab.anon");

    collabRememberName(name);

    collabCreateRoom(name);

  });


/* 메뉴: 입장 화면으로 */
document.getElementById("collabJoinBtn")
  .addEventListener("click", () => {

    collabCodeInput.value = "";
    collabShowView(collabJoinView);
    collabCodeInput.focus();

  });


/* 입장 화면: 뒤로 */
document.getElementById("collabJoinBack")
  .addEventListener("click", () => {

    collabShowView(collabMenuView);

  });


/* 입장 화면: 입장 */
function collabSubmitJoin(){

  const code =
    collabCodeInput.value.trim();

  if(!/^[0-9]{6}$/.test(code)){

    showToast(t("collab.badCode"));
    return;

  }

  const name =
    collabNameInput.value.trim() || t("collab.anon");

  collabRememberName(name);

  /* 입장하면 서버 곡이 내 화면을 덮는다 — 지금 곡이 있으면 미리 알린다 */
  if(tracks.length > 0){

    if(!window.confirm(t("collab.joinOverwrite"))){
      return;
    }

  }

  collabConnect(code, name, false);

}

document.getElementById("collabJoinGo")
  .addEventListener("click", collabSubmitJoin);

collabCodeInput.addEventListener("keydown", (event) => {

  if(event.key === "Enter"){
    collabSubmitJoin();
  }

});


/* 방 화면: 방번호 복사 */
document.getElementById("collabCopyCode")
  .addEventListener("click", () => {

    if(!collabCode){
      return;
    }

    navigator.clipboard
      .writeText(collabCode)
      .then(() => showToast(t("collab.codeCopied")))
      .catch(() => { /* 무시 */ });

  });


/* 방 화면: 나가기 */
document.getElementById("collabLeaveBtn")
  .addEventListener("click", () => {

    collabLeave(true);

  });
