
/* 화면에 깔아 두는 마디 수. midi를 불러오면 곡 길이에 맞춰 늘어난다. */
const MIN_BARS = 32;
let BARS = MIN_BARS;

/* 한 마디의 기본 너비. 확대/축소는 이 값에 배율을 곱해 BAR_W를 바꾼다.
   세로(반음 한 칸)는 건드리지 않는다 — 건반 줄이 흐트러지면 음을 못 읽는다. */
const BASE_BAR_W = 160;

const ZOOM_LEVELS =
  [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 3, 4, 5, 6, 7, 8, 10];

const ZOOM_DEFAULT =
  ZOOM_LEVELS.indexOf(1);

let zoomIndex = ZOOM_DEFAULT;

let BAR_W = BASE_BAR_W;
const ROW_H = 13;
const OCT_H = ROW_H * 12;

/* ============================================================
   좌표 변환 (선형대수: x' = s·x 형태의 1차 변환)
   ============================================================
   마디<->픽셀 변환은 전부 '척도(BAR_W)를 곱하거나 나누는' 같은 식이다.
   여기저기 흩어져 있던 bar*BAR_W / x/BAR_W 식을 한 곳으로 모아 두면
   확대/축소로 BAR_W가 바뀌어도 계산 결과가 어긋나지 않는다. */
const Transform = {
  barToX(bar){ return bar * BAR_W; },
  xToBar(x){ return x / BAR_W; }
};

/* 옥타브 범위는 변환 엔진(OCTAVE_MIN/OCTAVE_MAX)과 같아야 한다.
   엔진이 o0까지 접어 넣는데 화면이 o1까지만 있으면 그 음들이 사라진다. */
const OCT_TOP = OCTAVE_MAX;
const OCT_BOTTOM = OCTAVE_MIN;
const OCT_COUNT =
  OCT_TOP - OCT_BOTTOM + 1;

/* 화면 맨 윗줄에 해당하는 MIDI 건반 번호 (o8 b = 119).
   row 0이 이 음이고, 한 줄 내려갈 때마다 반음 하나씩 낮아진다. */
const TOP_KEY =
  (OCT_TOP + 1) * 12 - 1;

const keyToRow =
  key => TOP_KEY - key;

const rowToKey =
  row => TOP_KEY - row;

const SNAP = 1 / 96;

let playheadBar = 1.95;

let tempo = 120;

const MIN_TEMPO = 20;
const MAX_TEMPO = 400;
const TEMPO_STEP = 1;


/* 기법표(TECHNIQUE_SETS)는 위쪽 변환 엔진이 들고 있는 것을 그대로 쓴다.
   같은 표를 두 벌 두면 한쪽만 고쳤을 때 조용히 어긋난다. */


const TECHNIQUE_NAMES = {

  tremolo:"tremolo",
  vibrato:"vibrato",
  bendUp:"bendUp",
  bendDown:"bendDown",
  harmonic:"harmonic",
  cluster:"cluster",
  cut:"cut",
  graceUp:"graceUp",
  graceDown:"graceDown",
  doubleTongue:"doubleTongue",
  tap:"tap",
  nogi:"nogi",
  staccato:"staccato",
  accent:"accent",
  shoutMale:"shoutMale",
  shoutFemale:"shoutFemale",
  flutter:"flutter",
  bowTremolo:"bowTremolo",
  timbre:"timbre",
  mute:"mute",
  pullOff:"pullOff",
  hammerOn:"hammerOn",
  fermata:"fermata",
  legato:"legato",
  glissando:"glissando"

};


/* 처음에는 트랙이 하나도 없다.
   midi를 불러오거나 "트랙 추가"를 눌러야 생긴다. */
let tracks = [];


let selectedTrack = 0;
let selectedNote = null;
let selectedMarker = null;


const ruler =
  document.getElementById("ruler");

const grid =
  document.getElementById("grid");

const octScale =
  document.getElementById("octScale");

const playhead =
  document.getElementById("playhead");

const board =
  document.querySelector(".board");

const boardInner =
  document.querySelector(".board-inner");

const zoomIn =
  document.getElementById("zoomIn");

const zoomOut =
  document.getElementById("zoomOut");

const zoomRead =
  document.getElementById("zoomRead");

const playButton =
  document.querySelector('[data-icon="play"]');

const stopButton =
  document.querySelector('[data-icon="stop"]');

const selectModeButton =
  document.getElementById("selectMode");

const copyNotesButton =
  document.getElementById("copyNotes");

const pasteNotesButton =
  document.getElementById("pasteNotes");

const rail =
  document.querySelector(".rail");

const trackAddButton =
  document.querySelector(
    '[data-icon="track-add"]'
  );

const techButton =
  document.querySelector(
    '[data-icon="technique"]'
  );

const noteAddButton =
  document.querySelector(
    '[data-icon="note-add"]'
  );

const noteDeleteButton =
  document.querySelector(
    '[data-icon="note-delete"]'
  );

const techMenu =
  document.getElementById("techMenu");

const techMenuList =
  document.getElementById("techMenuList");

const instrumentMenu =
  document.getElementById("instrumentMenu");

const instrumentMenuList =
  document.getElementById("instrumentMenuList");

const markerMenu =
  document.getElementById("markerMenu");

const markerMenuList =
  document.getElementById("markerMenuList");

const output =
  document.getElementById("output");

const outputResize =
  document.getElementById("outputResize");


/* ── 출력 창 높이 끌어 조절 ─────────────────────────────
   맨 위 가는 줄을 잡고 위아래로 끌면 출력 창(.foot)의
   max-height를 바꾼다. 너무 작아지거나 화면을 다 덮지
   않도록 위아래로 한도를 둔다. */
let outputResizeState = null;

function beginOutputResize(event){

  if(event.button !== 0){
    return;
  }

  event.preventDefault();

  const rect =
    output.getBoundingClientRect();

  outputResizeState = {
    startY: event.clientY,
    startHeight: rect.height,
    pointerId: event.pointerId
  };

  outputResize.classList.add("dragging");

  try{
    outputResize.setPointerCapture(
      event.pointerId
    );
  }catch(error){}

}

function moveOutputResize(event){

  if(!outputResizeState){
    return;
  }

  /* 손잡이가 출력 창 위에 있으므로, 위로 끌수록(clientY가 작아질수록)
     출력 창은 커져야 한다. */
  const dy =
    outputResizeState.startY - event.clientY;

  const minHeight = 80;

  const maxHeight =
    Math.round(window.innerHeight * 0.82);

  const nextHeight =
    Math.max(
      minHeight,
      Math.min(
        maxHeight,
        outputResizeState.startHeight + dy
      )
    );

  output.style.maxHeight =
    nextHeight + "px";

}

function endOutputResize(event){

  if(!outputResizeState){
    return;
  }

  outputResizeState = null;

  outputResize.classList.remove("dragging");

  try{
    outputResize.releasePointerCapture(
      event.pointerId
    );
  }catch(error){}

}

outputResize.addEventListener(
  "pointerdown",
  beginOutputResize
);

outputResize.addEventListener(
  "pointermove",
  moveOutputResize
);

outputResize.addEventListener(
  "pointerup",
  endOutputResize
);

outputResize.addEventListener(
  "pointercancel",
  endOutputResize
);

const inspectorTechniques =
  document.getElementById(
    "inspectorTechniques"
  );

const lengthControls =
  document.getElementById(
    "lengthControls"
  );

const velocityRange =
  document.getElementById(
    "velocityRange"
  );

const velocityValue =
  document.getElementById(
    "velocityValue"
  );

const centerTempo =
  document.getElementById(
    "centerTempo"
  );

const tempoEditor =
  document.getElementById(
    "tempoEditor"
  );

const tempoNumber =
  document.getElementById(
    "tempoNumber"
  );

const tempoDown =
  document.getElementById(
    "tempoDown"
  );

const tempoUp =
  document.getElementById(
    "tempoUp"
  );


/* ============================================================
   확인 창 / 알림 — 브라우저 기본 창(alert·confirm) 대신 쓴다.
   기본 창은 페이지 색이랑 따로 놀고 문구도 마음대로 못 바꾼다.
   showConfirm은 Promise를 돌려주므로 부르는 쪽에서 await 하면 된다.
   ============================================================ */

const dialogBackdrop =
  document.getElementById(
    "dialogBackdrop"
  );

const dialogEyebrow =
  document.getElementById(
    "dialogEyebrow"
  );

const dialogTitle =
  document.getElementById(
    "dialogTitle"
  );

const dialogText =
  document.getElementById(
    "dialogText"
  );

const dialogOk =
  document.getElementById(
    "dialogOk"
  );

const dialogCancel =
  document.getElementById(
    "dialogCancel"
  );

const toastArea =
  document.getElementById(
    "toastArea"
  );

let dialogResolve = null;


function closeDialog(result){

  if(!dialogResolve){
    return;
  }

  const resolve =
    dialogResolve;

  dialogResolve =
    null;

  dialogBackdrop.classList.remove(
    "visible"
  );

  setTimeout(
    ()=>{

      if(!dialogResolve){

        dialogBackdrop.classList.remove(
          "show"
        );

      }

    },
    160
  );

  resolve(result);

}


function showConfirm(options){

  const settings =
    typeof options === "string"
      ? { title:options }
      : (options || {});

  /* 창이 이미 떠 있으면 앞의 것은 취소로 닫는다 */
  if(dialogResolve){
    closeDialog(false);
  }

  dialogEyebrow.textContent =
    settings.eyebrow || "confirm";

  dialogTitle.textContent =
    settings.title || "";

  dialogText.textContent =
    settings.text || "";

  dialogText.style.display =
    settings.text
      ? ""
      : "none";

  dialogOk.textContent =
    settings.okText || "확인";

  dialogCancel.textContent =
    settings.cancelText || "취소";

  dialogCancel.style.display =
    settings.hideCancel
      ? "none"
      : "";

  dialogOk.className =
    "dialog-btn " +
    (
      settings.danger
        ? "danger"
        : "primary"
    );

  dialogBackdrop.classList.add(
    "show"
  );

  /* 붙자마자 클래스를 얹으면 전환이 안 걸린다 */
  requestAnimationFrame(
    ()=>{

      dialogBackdrop.classList.add(
        "visible"
      );

      dialogOk.focus();

    }
  );

  return new Promise(
    resolve=>{

      dialogResolve =
        resolve;

    }
  );

}


dialogOk.addEventListener(
  "click",
  ()=>{
    closeDialog(true);
  }
);


dialogCancel.addEventListener(
  "click",
  ()=>{
    closeDialog(false);
  }
);


dialogBackdrop.addEventListener(
  "click",
  event=>{

    if(event.target === dialogBackdrop){
      closeDialog(false);
    }

  }
);


dialogBackdrop.addEventListener(
  "keydown",
  event=>{

    if(event.key === "Enter"){

      event.preventDefault();

      closeDialog(true);

    }

  }
);


/* 짧은 안내는 창을 띄울 만한 일이 아니라 아래쪽에 잠깐 띄웠다 지운다 */
function showToast(
  message,
  duration = 1800
){

  const el =
    document.createElement(
      "div"
    );

  el.className =
    "toast";

  el.textContent =
    message;

  toastArea.appendChild(el);

  requestAnimationFrame(
    ()=>{

      el.classList.add(
        "visible"
      );

    }
  );

  setTimeout(
    ()=>{

      el.classList.remove(
        "visible"
      );

      setTimeout(
        ()=>el.remove(),
        200
      );

    },
    duration
  );

}


function clampTempo(value){

  return Math.max(
    MIN_TEMPO,
    Math.min(
      MAX_TEMPO,
      Math.round(
        Number(value) || tempo
      )
    )
  );

}


function renderTempo(){

  tempo =
    clampTempo(tempo);

  centerTempo.textContent =
    "♩ = " + tempo + " · 4/4";

  tempoNumber.textContent =
    tempo;

  tempoEditor.value =
    tempo;

}


function getTempoAtBar(
  track,
  bar
){

  if(
    !track ||
    !Array.isArray(
      track.tempoMarkers
    ) ||
    track.tempoMarkers.length === 0
  ){

    return 120;

  }

  let value = 120;

  for(
    const marker
    of track.tempoMarkers
  ){

    /* 허용 오차는 부동소수점 오차만 덮을 만큼이어야 한다.
       예전에는 1/32마디(12틱)까지 봐줬는데, 마커가 음의 끝에 딱 붙어 있으면
       바로 뒤 마커까지 끌어다 쓰게 되어 그 자리의 값이 틀렸다. */
    if(
      marker.bar <=
      bar + BAR_EPS
    ){

      value =
        marker.tempo;

    }else{

      break;

    }

  }

  return value;

}


function setTempo(
  value,
  options = {}
){

  const track =
    tracks[selectedTrack];

  tempo =
    clampTempo(value);

  renderTempo();

  if(
    options.updateMarker === true &&
    track
  ){

    saveHistory();

    createOrUpdateTempoMarker(
      playheadBar,
      tempo
    );

    renderTempoMarkers();
    updateTempoUI();
    renderOutputs();

  }

}


function changeTempo(delta){

  setTempo(
    tempo + delta,
    {
      updateMarker:true
    }
  );

}


tempoDown.addEventListener(
  "click",
  ()=>{
    changeTempo(-TEMPO_STEP);
  }
);


tempoUp.addEventListener(
  "click",
  ()=>{
    changeTempo(TEMPO_STEP);
  }
);


function openTempoEditor(){

  tempoEditor.value =
    tempo;

  centerTempo.style.display =
    "none";

  tempoEditor.classList.add(
    "show"
  );

  tempoEditor.focus();
  tempoEditor.select();

}


function closeTempoEditor(
  apply = true
){

  if(apply){

    setTempo(
      tempoEditor.value,
      {
        updateMarker:true
      }
    );

  }else{

    tempoEditor.value =
      tempo;

  }

  tempoEditor.classList.remove(
    "show"
  );

  centerTempo.style.display =
    "";

}


centerTempo.addEventListener(
  "click",
  event=>{

    event.stopPropagation();

    openTempoEditor();

  }
);


tempoNumber.addEventListener(
  "click",
  event=>{

    event.stopPropagation();

    openTempoEditor();

  }
);


tempoEditor.addEventListener(
  "keydown",
  event=>{

    if(event.key === "Enter"){

      event.preventDefault();

      closeTempoEditor(true);

    }

    if(event.key === "Escape"){

      event.preventDefault();

      closeTempoEditor(false);

    }

  }
);


tempoEditor.addEventListener(
  "blur",
  ()=>{
    closeTempoEditor(true);
  }
);


function snapBar(bar){

  return Math.max(
    0,
    Math.min(
      BARS,
      Math.round(bar / SNAP) * SNAP
    )
  );

}


function setPlayheadBar(
  bar,
  options = {}
){

  const snapped =
    snapBar(bar);

  playheadBar =
    snapped;

  playhead.style.left =
    (snapped * BAR_W) + "px";

  const track =
    tracks[selectedTrack];

  if(track){

    tempo =
      getTempoAtBar(
        track,
        snapped
      );

  }

  renderTempo();

  if(options.scrollIntoView){

    const x =
      snapped * BAR_W;

    const viewLeft =
      board.scrollLeft;

    const viewRight =
      viewLeft + board.clientWidth;

    if(
      x < viewLeft + 40 ||
      x > viewRight - 40
    ){

      board.scrollLeft =
        Math.max(
          0,
          x - board.clientWidth / 2
        );

    }

  }

}


function getBarFromPointerEvent(
  event,
  container
){

  const rect =
    container.getBoundingClientRect();

  const x =
    event.clientX -
    rect.left;

  return snapBar(
    Transform.xToBar(x)
  );

}


function handleTimelineClick(event){

  if(
    event.target.closest(".note") ||
    event.target.closest(".marker") ||
    event.target.closest(".bar-tick") ||
    event.target.closest(".oct-scale")
  ){

    return;

  }

  const target =
    event.currentTarget;

  const bar =
    getBarFromPointerEvent(
      event,
      target
    );

  setPlayheadBar(
    bar,
    {
      scrollIntoView:false
    }
  );

  selectedMarker = null;
  selectedNote = null;

  renderTempoMarkers();
  renderVelocityMarkers();
  renderNotes();
  renderInspectorTechniques();
  renderTechniqueMenu();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();
  renderOutputs();

}


ruler.addEventListener(
  "click",
  handleTimelineClick
);


grid.addEventListener(
  "click",
  event=>{

    if(
      event.target.closest(".note") ||
      event.target.closest(".oct-scale")
    ){

      return;

    }

    const bar =
      getBarFromPointerEvent(
        event,
        grid
      );

    setPlayheadBar(
      bar,
      {
        scrollIntoView:false
      }
    );

    selectedNote = null;
    selectedMarker = null;

    renderNotes();
    renderTempoMarkers();
    renderVelocityMarkers();
    renderInspectorTechniques();
    renderTechniqueMenu();
    updateLengthButtons();
    updateVelocityUI();
    updateTempoUI();
    renderOutputs();

  }
);


function getBaseInstrument(name){

  if(TECHNIQUE_SETS[name]){
    return name;
  }

  const names =
    Object.keys(TECHNIQUE_SETS)
      .sort(
        (a,b)=>b.length-a.length
      );

  for(const base of names){

    if(name.includes(base)){
      return base;
    }

  }

  return "신디사이저";
}


function getTechniquesForInstrument(name){

  return TECHNIQUE_SETS[
    getBaseInstrument(name)
  ] || {};

}


/* 아래 출력 줄에 붙는 이름.
   같은 악기가 둘 이상이면 뒤에 번호가 붙는다 (피아노 1, 피아노 2).

   번호는 "고른 트랙" 안에서만 센다. 피아노 두 개 중 하나만 골랐다면
   그건 그냥 "피아노"다 — 화면에 하나뿐인데 2번이라고 적히면 이상하다. */
function getInstrumentDisplayName(
  instrumentName,
  trackIndex
){

  const base =
    getBaseInstrument(
      instrumentName
    );

  const shown =
    tracks.filter(
      track=>track.selected
    );

  const sameCount =
    shown.filter(
      track =>
        getBaseInstrument(
          track.name
        ) === base
    ).length;

  if(sameCount <= 1){
    return base;
  }

  let count = 0;

  for(
    let i=0;
    i<=trackIndex;
    i++
  ){

    if(
      tracks[i] &&
      tracks[i].selected &&
      getBaseInstrument(
        tracks[i].name
      ) === base
    ){

      count++;

    }

  }

  return base + " " + count;

}


/* 왼쪽 칩과 알림창에 쓰는 이름.
   미디에서 온 트랙은 원래 악기명을, 손으로 만든 트랙은 아르미스 악기명을 쓴다. */
function getTrackTitle(
  track,
  trackIndex
){

  if(!track){
    return "";
  }

  if(track.midiName){
    return track.midiName;
  }

  return getInstrumentDisplayName(
    track.name,
    trackIndex
  );

}


/* 오른쪽 패널의 길이 버튼이 가리키는 값들.
   길이를 여기에 가두지는 않는다 — 어떤 버튼이 켜져 보일지 정할 때만 쓴다. */
const LENGTH_TABLE = [
  { lengthBase:16, dotted:false, duration:1/16      },
  { lengthBase:16, dotted:true,  duration:1/16 * 1.5},
  { lengthBase:8,  dotted:false, duration:1/8       },
  { lengthBase:8,  dotted:true,  duration:1/8  * 1.5},
  { lengthBase:4,  dotted:false, duration:1/4       },
  { lengthBase:4,  dotted:true,  duration:1/4  * 1.5},
  { lengthBase:2,  dotted:false, duration:1/2       },
  { lengthBase:2,  dotted:true,  duration:1/2  * 1.5},
  { lengthBase:1,  dotted:false, duration:1         },
  { lengthBase:1,  dotted:true,  duration:1.5       },

  /* 셋잇단 — 한 음표를 셋으로 나눈 길이. MML에서도 l3 l6 l12 처럼 그대로 쓴다.
     TPQN 96에서 전부 정수 tick으로 떨어진다 (128 / 64 / 32 / 16 / 8). */
  { lengthBase:3,  dotted:false, duration:1/3       },
  { lengthBase:6,  dotted:false, duration:1/6       },
  { lengthBase:12, dotted:false, duration:1/12      },
  { lengthBase:24, dotted:false, duration:1/24      },
  { lengthBase:48, dotted:false, duration:1/48      }
];

/* ── 정확히 적을 수 있는 길이만 쓴다 ──────────────────────
   변환 엔진은 아무 tick이나 적지 못한다. 음표 토큰을 최대 3개까지 &로
   이어 붙일 수 있고, 그렇게 만들 수 있는 tick만 오차 없이 표기된다.

   "1/64음표(6틱)의 배수"로는 부족하다. 20틱(c32&c48)처럼 6의 배수가
   아닌데 정확히 적히는 길이가 있고, 반대로 6의 배수인데 못 적는 길이도 있다.
   그래서 엔진에게 직접 물어본 뒤, 되는 값만 목록으로 들고 있는다. */
const EXACT_TICK_LIMIT = WHOLE * 4;

const EXACT_TICKS = (()=>{

  const set = new Set();

  for(
    let t = MIN_TICK;
    t <= EXACT_TICK_LIMIT;
    t++
  ){

    if(
      resolveTickTokens(t).tick === t
    ){

      set.add(t);

    }

  }

  return set;

})();


function isExactTick(ticks){

  if(ticks < MIN_TICK){
    return false;
  }

  if(ticks <= EXACT_TICK_LIMIT){
    return EXACT_TICKS.has(ticks);
  }

  /* 아주 긴 음은 목록에 없으니 그때만 직접 물어본다 */
  return resolveTickTokens(ticks).tick === ticks;

}


/* EXACT_TICKS를 정렬한 배열. 음표 하나짜리(SINGLE_TICKS)뿐 아니라
   이어붙여서(&) 정확히 찍히는 길이까지 전부 담겨 있어서, 끌 때 붙는
   눈금이 훨씬 촘촘해진다 (드럼 없이도 최소 MIN_TICK=6틱=1/64음표 간격,
   많은 구간에서는 그보다도 더 촘촘하다 — 게임 MML 표기가 허용하는
   한도 안에서 96분음표(4틱) 눈금에 가장 가깝게 맞춘 것). */
const EXACT_TICKS_SORTED =
  [...EXACT_TICKS].sort((a,b)=>a-b);


function nearestExactTick(ticks){

  if(!EXACT_TICKS_SORTED.length){
    return MIN_TICK;
  }

  let lo = 0;
  let hi = EXACT_TICKS_SORTED.length - 1;

  /* ticks가 들어갈 자리를 이분 탐색으로 찾는다 */
  while(lo < hi){

    const mid =
      (lo + hi) >> 1;

    if(EXACT_TICKS_SORTED[mid] < ticks){
      lo = mid + 1;
    }else{
      hi = mid;
    }

  }

  const upper =
    EXACT_TICKS_SORTED[lo];

  const lower =
    EXACT_TICKS_SORTED[
      Math.max(0, lo - 1)
    ];

  if(
    Math.abs(upper - ticks) <
    Math.abs(lower - ticks)
  ){

    return upper;

  }

  return lower;

}


function largestExactWithin(room){

  if(
    !EXACT_TICKS_SORTED.length ||
    room < EXACT_TICKS_SORTED[0]
  ){

    return MIN_TICK;

  }

  let lo = 0;
  let hi = EXACT_TICKS_SORTED.length - 1;
  let best = EXACT_TICKS_SORTED[0];

  while(lo <= hi){

    const mid =
      (lo + hi) >> 1;

    if(EXACT_TICKS_SORTED[mid] <= room){

      best =
        EXACT_TICKS_SORTED[mid];

      lo = mid + 1;

    }else{

      hi = mid - 1;

    }

  }

  return best;

}


const LEN_STEP = MIN_TICK / WHOLE;

const MIN_NOTE_LEN = LEN_STEP;


/* 원하는 길이에 가장 가까우면서 정확히 적히는 길이 */
function snapLength(bars){

  const want =
    Math.max(
      MIN_TICK,
      Math.round(
        (Number(bars) || 0) * WHOLE
      )
    );

  if(isExactTick(want)){
    return want / WHOLE;
  }

  for(
    let d=1;
    d<=MIN_TICK * 4;
    d++
  ){

    if(isExactTick(want - d)){
      return (want - d) / WHOLE;
    }

    if(isExactTick(want + d)){
      return (want + d) / WHOLE;
    }

  }

  return want / WHOLE;

}


/* ── 끌 때 붙는 길이 ───────────────────────────────────
   손으로 끌 때는 "음표 하나로 적을 수 있는 길이"에만 붙인다.

   정확히 적히기만 하면 되는 값에는 46틱(16 + 24 + 64) 같은 것도 있는데,
   그런 길이는 이음줄로 세 토막이 난다. 조금 줄이려고 끌었을 뿐인데
   음이 셋으로 쪼개지면 곤란하다.

   한 음표로 못 적는 긴 길이(점온음표보다 길 때)는 그대로 두어
   이음줄로 이어 붙인다 — 그건 정말로 늘린 것이니까. */
const SINGLE_TICKS =
  [...new Set(TOKENS.map(t=>t.tick))]
    .sort((a,b)=>a-b);

const MAX_SINGLE_TICK =
  SINGLE_TICKS[SINGLE_TICKS.length - 1];


function nearestSingleTick(ticks){

  let best =
    SINGLE_TICKS[0];

  for(const t of SINGLE_TICKS){

    if(
      Math.abs(t - ticks) <
      Math.abs(best - ticks)
    ){

      best = t;

    }

  }

  return best;

}


function largestSingleTickWithin(room){

  let best =
    SINGLE_TICKS[0];

  for(const t of SINGLE_TICKS){

    if(t <= room){
      best = t;
    }

  }

  return best;

}


/* 끌어서 잡은 길이를 노트에 넣는다. 정확히 적히는 길이 중
   가장 가까운 값으로 붙는다 (최악의 경우에도 96분음표=4틱 간격
   안쪽으로 붙는다 — 게임 MML 표기가 허용하는 한도 안에서 가장 촘촘한 값). */
function applyDragLength(
  note,
  length,
  available
){

  const room =
    Number.isFinite(available)
      ? available
      : BARS - note.bar;

  const roomTicks =
    Math.floor(room * WHOLE + 1e-6);

  const ceiling =
    roomTicks <= EXACT_TICK_LIMIT
      ? largestExactWithin(roomTicks)
      : Math.round(
          floorLength(room) * WHOLE
        );

  const wantRaw =
    Math.round(length * WHOLE);

  const want =
    wantRaw <= EXACT_TICK_LIMIT
      ? nearestExactTick(wantRaw)
      : Math.round(
          snapLength(wantRaw / WHOLE) * WHOLE
        );

  note.len =
    Math.max(
      MIN_TICK,
      Math.min(ceiling, want)
    ) / WHOLE;

  syncLengthLabel(note);

}


/* 주어진 길이 이하 중 정확히 적히는 가장 긴 길이.
   자리가 정해져 있을 때는 반드시 이쪽을 써야 뒷음을 밀지 않는다. */
function floorLength(bars){

  let t =
    Math.floor(
      (Number(bars) || 0) * WHOLE + 1e-6
    );

  while(t >= MIN_TICK){

    if(isExactTick(t)){
      return t / WHOLE;
    }

    t--;

  }

  return MIN_TICK / WHOLE;

}


/* 이 길이에 딱 맞는 n분음표가 있으면 그것, 없으면 null */
function describeLength(len){

  for(const candidate of LENGTH_TABLE){

    if(
      Math.abs(
        candidate.duration - len
      ) < LEN_STEP / 4
    ){

      return candidate;

    }

  }

  return null;

}


/* len을 정답으로 두고 표시용 lengthBase / dotted를 맞춰 준다 */
function syncLengthLabel(note){

  const found =
    describeLength(note.len);

  note.lengthBase =
    found
      ? found.lengthBase
      : null;

  note.dotted =
    found
      ? found.dotted
      : false;

}


function normalizeNote(note){

  if(!note){
    return;
  }

  if(
    note.tech &&
    !Array.isArray(note.tech)
  ){

    note.techs =
      [note.tech];

    delete note.tech;

  }

  if(
    !Array.isArray(note.techs)
  ){

    note.techs = [];

  }

  /* len(마디 단위 길이)이 정답이다. 화면에 그리는 폭도, MML로 적는 길이도
     여기서 나온다. lengthBase / dotted는 오른쪽 버튼을 켜 두기 위한 이름표라
     len에서 거꾸로 채운다. 딱 맞는 음표가 없으면 아무 버튼도 안 켜진다. */
  if(
    !Number.isFinite(Number(note.len)) ||
    Number(note.len) <= 0
  ){

    /* len이 없는 옛 노트는 적어 둔 n분음표에서 만들어 낸다 */
    note.len =
      getActualNoteLength({
        lengthBase:
          Number(note.lengthBase) || 4,
        dotted:
          !!note.dotted
      });

  }

  note.len =
    snapLength(note.len);

  syncLengthLabel(note);

  /* 음 하나만의 세기. 화음에서 구성음마다 세기가 다를 때 쓴다.
     (v 마커는 자리마다 하나뿐이라 c8:e8:g8 처럼 한 자리에서 시작하는
      음들의 세기를 따로 담을 수가 없다)
     없으면 null이고, 그때는 그 자리의 v 마커를 따른다. */
  /* Number(null)은 0이라 그냥 변환하면 "세기 0"이 되어 소리가 사라진다.
     비어 있는지를 먼저 가려야 한다. */
  const own =
    note.vel === null ||
    note.vel === undefined ||
    note.vel === ""
      ? null
      : Number(note.vel);

  note.vel =
    own !== null &&
    Number.isFinite(own)
      ? Math.max(
          0,
          Math.min(15, Math.round(own))
        )
      : null;

  /* 뒤에 오는 같은 음정의 음과 이어져 한 소리로 울리는가.
     MML의 &에 그대로 대응한다. 짝이 사라지면 normalizeTies가 지운다. */
  note.tie =
    !!note.tie;

}


/* 이 음과 이어질 수 있는 뒤 음의 번호. 없으면 -1.
   같은 줄(음정)에서, 이 음이 끝나는 바로 그 자리에 시작하는 음이라야 한다. */
function tiePartnerIndex(
  track,
  note
){

  if(!track || !note){
    return -1;
  }

  const end =
    note.bar + note.len;

  return track.notes.findIndex(
    other =>
      other !== note &&
      other.row === note.row &&
      Math.abs(other.bar - end) < BAR_EPS
  );

}


/* 짝이 없어진 이음줄을 지운다.

   음을 짧게 줄이거나 옮기거나 지우면 이어받을 상대가 사라진다.
   표시만 남으면 화면에는 &가 있는데 글자에는 없는 상태가 되므로,
   그림을 다시 그릴 때마다 여기서 걷어낸다.

   음이 많은 곡에서 이음줄마다 전체를 훑으면 느려지니
   "몇 번째 줄, 몇 tick"을 열쇠로 삼아 한 번만 모아 둔다. */
function normalizeTies(track){

  if(
    !track ||
    !Array.isArray(track.notes)
  ){

    return;

  }

  let starts = null;

  for(const note of track.notes){

    if(!note.tie){
      continue;
    }

    if(!starts){

      starts = new Set();

      for(const other of track.notes){

        starts.add(
          other.row + ":" +
          Math.round(other.bar * WHOLE)
        );

      }

    }

    const key =
      note.row + ":" +
      Math.round(
        (note.bar + note.len) * WHOLE
      );

    if(!starts.has(key)){

      note.tie = false;

    }

  }

}


/* 이 음이 실제로 내는 세기 */
function noteVelocity(
  track,
  note
){

  if(
    note.vel !== null &&
    note.vel !== undefined
  ){

    return note.vel;

  }

  return getVelocityAtBar(
    track,
    note.bar
  );

}


/* n분음표를 마디 단위 길이로 바꾼다.
   4/4 기준 온음표(1)가 한 마디이므로 n분음표는 1/n 마디다.
     1  → 1     (온음표, 한 마디)
     2  → 0.5   (2분음표)
     4  → 0.25  (4분음표)
     8  → 0.125 (8분음표)
     16 → 0.0625(16분음표)
   점음표는 여기에 1.5배. */
function getActualNoteLength(note){

  const base =
    Number(note.lengthBase) || 4;

  const duration =
    1 / base;

  return note.dotted
    ? duration * 1.5
    : duration;

}


function normalizeAllNotes(){

  tracks.forEach(
    track=>{

      if(
        !Array.isArray(track.notes)
      ){

        track.notes = [];

      }

      if(
        !Array.isArray(
          track.velocityMarkers
        )
      ){

        track.velocityMarkers = [];

      }

      if(
        !Array.isArray(
          track.tempoMarkers
        )
      ){

        track.tempoMarkers = [];

      }

      track.notes.forEach(
        normalizeNote
      );

      normalizeTies(track);

      /* 마디 수(BARS)로 자르면 안 된다.
         BARS는 지금 화면에 깔아 둔 판의 크기일 뿐이고, 불러온 곡이 더 길면
         뒤쪽 마커가 전부 마지막 마디로 뭉개져 곡 후반의 셈여림과 템포가
         통째로 날아간다. 판은 ensureBars()가 곡에 맞춰 늘린다. */
      track.velocityMarkers =
        track.velocityMarkers
          .map(
            marker=>({

              bar:
                Math.max(
                  0,
                  Number(marker.bar) || 0
                ),

              velocity:
                Math.max(
                  0,
                  Math.min(
                    15,
                    Number(marker.velocity) || 0
                  )
                )

            })
          )
          .sort(
            (a,b)=>a.bar-b.bar
          );

      track.tempoMarkers =
        track.tempoMarkers
          .map(
            marker=>({

              bar:
                Math.max(
                  0,
                  Number(marker.bar) || 0
                ),

              tempo:
                clampTempo(
                  marker.tempo
                )

            })
          )
          .sort(
            (a,b)=>a.bar-b.bar
          );

    }
  );

}


normalizeAllNotes();


const undoStack = [];
const redoStack = [];

let restoringHistory = false;


function cloneTracks(){

  return JSON.parse(
    JSON.stringify(tracks)
  );

}


function saveHistory(){

  if(restoringHistory){
    return;
  }

  undoStack.push(
    cloneTracks()
  );

  if(
    undoStack.length > 100
  ){

    undoStack.shift();

  }

  redoStack.length = 0;

}


function restoreState(state){

  restoringHistory = true;

  tracks =
    JSON.parse(
      JSON.stringify(state)
    );

  normalizeAllNotes();

  restoringHistory = false;

  selectedTrack =
    Math.max(
      0,
      Math.min(
        selectedTrack,
        tracks.length - 1
      )
    );

  selectedNote = null;
  selectedMarker = null;

  ensureFocusedTrack();

  renderTracks();
  renderNotes();
  renderTempoMarkers();
  renderVelocityMarkers();
  renderTechniqueMenu();
  renderInspectorTechniques();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();
  renderOutputs();

}


function undo(){

  if(!undoStack.length){
    return;
  }

  /* 판이 통째로 바뀌므로, 그 사이에 떠 있던 반투명 노트는
     자리를 잡을 곳이 없어진다. 되돌리기 전에 걷어 둔다. */
  discardGhost();

  redoStack.push(
    cloneTracks()
  );

  restoreState(
    undoStack.pop()
  );

}


function redo(){

  if(!redoStack.length){
    return;
  }

  discardGhost();

  undoStack.push(
    cloneTracks()
  );

  restoreState(
    redoStack.pop()
  );

}


/* 마디 눈금을 다시 깐다. 마커는 지우지 않는다. */
function renderBarTicks(){

  ruler
    .querySelectorAll(".bar-tick")
    .forEach(
      el=>el.remove()
    );

  /* 축소하면 마디가 좁아져 번호가 서로 겹친다. 띄엄띄엄 적는다. */
  const step =
    BAR_W < 30
      ? 8
      : BAR_W < 60
        ? 4
        : 1;

  for(
    let i=0;
    i<BARS;
    i++
  ){

    const t =
      document.createElement(
        "div"
      );

    t.className =
      "bar-tick";

    t.style.left =
      (i * BAR_W) + "px";

    if(i % step === 0){

      t.innerHTML =
        "<b>" +
        (i + 1) +
        "</b>";

    }

    ruler.appendChild(t);

  }

}


/* 곡이 길어지면 판을 넓힌다. 좁아지는 쪽으로는 줄이지 않는다 —
   편집 중에 판이 갑자기 줄면 놓아 둔 노트가 밖으로 밀려난다. */
function ensureBars(neededBars){

  const want =
    Math.max(
      MIN_BARS,
      Math.ceil(neededBars) + 2
    );

  if(want <= BARS){
    return false;
  }

  BARS = want;

  renderBoardSize();
  renderBarTicks();

  return true;

}


function renderBoardSize(){

  const width =
    BARS * BAR_W;

  boardInner.style.width =
    width + "px";

  boardInner.style.minWidth =
    width + "px";

  /* 격자 무늬와 마디 눈금이 쓰는 값. 여기를 안 바꾸면
     노트만 움직이고 배경 줄은 제자리에 남는다. */
  const root =
    document.documentElement.style;

  root.setProperty(
    "--bar-w",
    BAR_W + "px"
  );

  root.setProperty(
    "--beat-w",
    (BAR_W / 4) + "px"
  );

}


/* ============================================================
   확대 / 축소
   ============================================================
   가로만 늘리고 줄인다. 화면 한가운데에 있던 마디를 그대로 붙잡아 두어야
   확대할 때마다 보던 곳을 잃지 않는다.
   ============================================================ */
function applyZoom(
  nextIndex,
  anchorBar
){

  const clamped =
    Math.max(
      0,
      Math.min(
        ZOOM_LEVELS.length - 1,
        nextIndex
      )
    );

  if(clamped === zoomIndex){
    return false;
  }

  /* 확대 전에 화면 한가운데가 몇 마디였는지 기록해 둔다 */
  const centerBar =
    Number.isFinite(anchorBar)
      ? anchorBar
      : (
          board.scrollLeft +
          board.clientWidth / 2
        ) / BAR_W;

  zoomIndex =
    clamped;

  BAR_W =
    BASE_BAR_W * ZOOM_LEVELS[zoomIndex];

  renderBoardSize();
  renderBarTicks();
  renderNotes();
  renderVelocityMarkers();
  renderTempoMarkers();

  playhead.style.left =
    (playheadBar * BAR_W) + "px";

  zoomRead.textContent =
    Math.round(
      ZOOM_LEVELS[zoomIndex] * 100
    ) + "%";

  board.scrollLeft =
    Math.max(
      0,
      centerBar * BAR_W -
      board.clientWidth / 2
    );

  return true;

}


zoomIn.addEventListener(
  "click",
  ()=>{
    applyZoom(zoomIndex + 1);
  }
);


zoomOut.addEventListener(
  "click",
  ()=>{
    applyZoom(zoomIndex - 1);
  }
);


/* 배율 글자를 누르면 100%로 돌아온다 */
zoomRead.addEventListener(
  "click",
  ()=>{
    applyZoom(ZOOM_DEFAULT);
  }
);


/* Ctrl(⌘) + 휠은 마우스가 놓인 자리를 붙잡고 확대한다 */
board.addEventListener(
  "wheel",
  event=>{

    if(
      !event.ctrlKey &&
      !event.metaKey
    ){

      return;

    }

    event.preventDefault();

    const rect =
      board.getBoundingClientRect();

    const pointerBar =
      Transform.xToBar(
        board.scrollLeft +
        event.clientX -
        rect.left
      );

    const before =
      board.scrollLeft +
      event.clientX -
      rect.left;

    if(
      !applyZoom(
        zoomIndex +
        (event.deltaY < 0 ? 1 : -1),
        null
      )
    ){

      return;

    }

    /* 마우스 밑에 있던 마디가 그대로 마우스 밑에 남게 스크롤을 되맞춘다 */
    board.scrollLeft =
      Math.max(
        0,
        Transform.barToX(pointerBar) -
        (event.clientX - rect.left)
      );

    void before;

  },
  { passive:false }
);


renderBoardSize();
renderBarTicks();


grid.style.height =
  (OCT_H * OCT_COUNT) + "px";


for(
  let o=OCT_TOP;
  o>=OCT_BOTTOM;
  o--
){

  const c =
    document.createElement(
      "div"
    );

  c.className =
    "oct-cell";

  c.textContent =
    "o" + o;

  octScale.appendChild(c);

}





/* v와 t는 이론상 어디에나 넣을 수 있지만, 음이 울리는 도중에 넣으려면
   그 음을 &로 쪼개야 한다. 그러면 글자도 코드도 복잡해지므로
   마커는 음의 시작 자리나 끝나는 자리에만 놓는다.
   가장 가까운 그 자리로 당겨 준다. */
function snapToNoteEdge(
  track,
  bar
){

  if(
    !track ||
    !track.notes ||
    !track.notes.length
  ){

    return snapBar(bar);

  }

  const edges =
    new Set([0]);

  for(const note of track.notes){

    normalizeNote(note);

    edges.add(note.bar);
    edges.add(note.bar + note.len);

  }

  let best = null;

  for(const edge of edges){

    if(
      best === null ||
      Math.abs(edge - bar) <
      Math.abs(best - bar)
    ){

      best = edge;

    }

  }

  return best;

}


function getMarkerAt(
  markers,
  bar
){

  if(
    !Array.isArray(markers)
  ){

    return null;

  }

  /* 같은 자리인지 보는 것이므로 오차는 최소로 둔다.
       마커가 음 끝에 붙어 있으면 넉넉한 오차가 옆 마커를 집어 온다. */
  const tolerance =
    BAR_EPS;

  return markers.find(
    marker =>
      Math.abs(
        marker.bar - bar
      ) < tolerance
  ) || null;

}


function getVelocityMarkerAt(
  track,
  bar
){

  return getMarkerAt(
    track?.velocityMarkers,
    bar
  );

}


function createOrUpdateVelocityMarker(
  bar,
  velocity
){

  const track =
    tracks[selectedTrack];

  if(!track){
    return null;
  }

  if(
    !Array.isArray(
      track.velocityMarkers
    )
  ){

    track.velocityMarkers = [];

  }

  const snappedBar =
    snapToNoteEdge(track, bar);

  const value =
    Math.max(
      0,
      Math.min(
        15,
        Math.round(
          Number(velocity)
        )
      )
    );

  let marker =
    getVelocityMarkerAt(
      track,
      snappedBar
    );

  if(marker){

    marker.velocity =
      value;

  }else{

    marker = {

      bar:
        snappedBar,

      velocity:
        value

    };

    track.velocityMarkers.push(
      marker
    );

  }

  track.velocityMarkers.sort(
    (a,b)=>a.bar-b.bar
  );

  selectedMarker = {

    type:"velocity",

    trackIndex:
      selectedTrack,

    index:
      track.velocityMarkers.indexOf(
        marker
      )

  };

  setPlayheadBar(
    snappedBar
  );

  return marker;

}


function getTempoMarkerAt(
  track,
  bar
){

  return getMarkerAt(
    track?.tempoMarkers,
    bar
  );

}


function createOrUpdateTempoMarker(
  bar,
  value
){

  const track =
    tracks[selectedTrack];

  if(!track){
    return null;
  }

  if(
    !Array.isArray(
      track.tempoMarkers
    )
  ){

    track.tempoMarkers = [];

  }

  const snappedBar =
    snapToNoteEdge(track, bar);

  const valueClamped =
    clampTempo(value);

  let marker =
    getTempoMarkerAt(
      track,
      snappedBar
    );

  if(marker){

    marker.tempo =
      valueClamped;

  }else{

    marker = {

      bar:
        snappedBar,

      tempo:
        valueClamped

    };

    track.tempoMarkers.push(
      marker
    );

  }

  track.tempoMarkers.sort(
    (a,b)=>a.bar-b.bar
  );

  selectedMarker = {

    type:"tempo",

    trackIndex:
      selectedTrack,

    index:
      track.tempoMarkers.indexOf(
        marker
      )

  };

  setPlayheadBar(
    snappedBar
  );

  return marker;

}


/* ============================================================
   마커 그리기 — 템포와 음량은 트랙마다 따로 있다
   ============================================================
   전에는 편집 중인 트랙 것만 그려서, 마치 곡 전체에 걸리는 값처럼 보였다.
   이제 켜 둔 트랙의 마커를 전부 그리고 트랙 색을 그대로 입힌다.

   좁은 자리에 여러 트랙 마커가 몰리면 서로 가려 읽을 수가 없다.
   그럴 때는 하나로 합쳐 v… / t… 로 적고, 누르면 어느 트랙 것인지 고르게 한다.
   ============================================================ */

/* 화면에서 이만큼 안에 들어오면 겹친 것으로 본다 (칩 하나 너비) */
const MARKER_GAP = 38;


function collectMarkers(kind){

  const key =
    kind === "tempo"
      ? "tempo"
      : "velocity";

  const listName =
    kind === "tempo"
      ? "tempoMarkers"
      : "velocityMarkers";

  const out = [];

  tracks.forEach(
    (track,trackIndex)=>{

      if(!track.selected){
        return;
      }

      (track[listName] || []).forEach(
        (marker,index)=>{

          out.push({

            kind,
            trackIndex,
            index,

            bar:
              marker.bar,

            value:
              marker[key]

          });

        }
      );

    }
  );

  return out.sort(
    (a,b)=>
      (a.bar - b.bar) ||
      (a.trackIndex - b.trackIndex)
  );

}


function markerIsSelected(item){

  return !!(
    selectedMarker &&
    selectedMarker.type === item.kind &&
    selectedMarker.index === item.index &&
    selectedMarker.trackIndex === item.trackIndex
  );

}


function chooseMarker(item){

  selectedMarker = {

    type:
      item.kind,

    index:
      item.index,

    trackIndex:
      item.trackIndex

  };

  selectedNote = null;

  if(item.trackIndex !== selectedTrack){

    focusTrack(item.trackIndex);

    selectedMarker = {

      type:
        item.kind,

      index:
        item.index,

      trackIndex:
        item.trackIndex

    };

  }

  setPlayheadBar(
    item.bar,
    { scrollIntoView:true }
  );

  if(item.kind === "tempo"){

    tempo =
      clampTempo(item.value);

    renderTempo();

  }

  renderTracks();
  renderNotes();
  renderMarkers();
  renderInspectorTechniques();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();

}


function markerLabel(item){

  return (
    item.kind === "tempo"
      ? "T"
      : "V"
  ) + item.value;

}


/* 마디와 박으로 적는다. 겹친 마커를 고를 때 이게 없으면
   목록이 전부 같은 트랙 이름이라 무엇이 무엇인지 알 수가 없다. */
function formatBarPosition(bar){

  const measure =
    Math.floor(bar) + 1;

  const beat =
    (bar - Math.floor(bar)) * 4 + 1;

  const beatText =
    Math.abs(beat - Math.round(beat)) < 0.01
      ? String(Math.round(beat))
      : beat.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

  return measure + "마디 " + beatText + "박";

}


/* 겹친 마커들을 고르는 작은 목록 */
function openMarkerPicker(
  items,
  anchor
){

  markerMenuList.innerHTML = "";

  const sorted =
    items.slice().sort(
      (a,b)=>
        (a.bar - b.bar) ||
        (a.trackIndex - b.trackIndex)
    );

  for(const item of sorted){

    const button =
      document.createElement("button");

    button.type =
      "button";

    button.className =
      "marker-option" +
      (
        markerIsSelected(item)
          ? " current"
          : ""
      );

    const dot =
      document.createElement("span");

    dot.className =
      "marker-option-dot";

    dot.style.background =
      trackColor(item.trackIndex).b;

    const name =
      document.createElement("span");

    name.className =
      "marker-option-name";

    const who =
      document.createElement("span");

    who.className =
      "marker-option-track";

    who.textContent =
      getInstrumentDisplayName(
        tracks[item.trackIndex].name,
        item.trackIndex
      );

    const where =
      document.createElement("span");

    where.className =
      "marker-option-where";

    where.textContent =
      formatBarPosition(item.bar);

    name.append(who, where);

    const value =
      document.createElement("span");

    value.className =
      "marker-option-value";

    value.textContent =
      markerLabel(item);

    button.append(dot, name, value);

    button.addEventListener(
      "click",
      event=>{

        event.stopPropagation();

        closeMarkerMenu();

        chooseMarker(item);

      }
    );

    markerMenuList.appendChild(button);

  }

  const rect =
    anchor.getBoundingClientRect();

  markerMenu.style.left =
    Math.max(
      8,
      Math.min(
        rect.left,
        window.innerWidth - 250
      )
    ) + "px";

  markerMenu.style.top =
    (rect.bottom + 6) + "px";

  markerMenu.classList.add("show");

}


function closeMarkerMenu(){

  markerMenu.classList.remove("show");

}


/* 템포·음량 마커를 한꺼번에 다시 그린다 */
function renderMarkers(){

  ruler
    .querySelectorAll(".marker")
    .forEach(
      el=>el.remove()
    );

  for(
    const kind
    of ["tempo","velocity"]
  ){

    const items =
      collectMarkers(kind);

    /* 화면상 가까이 붙은 것끼리 묶는다 */
    const clusters = [];

    for(const item of items){

      const last =
        clusters[clusters.length - 1];

      if(
        last &&
        (item.bar - last[0].bar) * BAR_W < MARKER_GAP
      ){

        last.push(item);

      }else{

        clusters.push([item]);

      }

    }

    for(const cluster of clusters){

      const el =
        document.createElement("div");

      el.className =
        "marker " + kind + "-marker";

      el.style.left =
        (cluster[0].bar * BAR_W) + "px";

      if(cluster.length === 1){

        const item =
          cluster[0];

        el.textContent =
          markerLabel(item);

        el.title =
          getInstrumentDisplayName(
            tracks[item.trackIndex].name,
            item.trackIndex
          ) +
          " · " +
          markerLabel(item);

        /* 트랙 색을 그대로 입혀 어느 트랙 것인지 한눈에 보이게 한다 */
        el.style.background =
          trackColor(item.trackIndex).b;

        if(markerIsSelected(item)){

          el.classList.add("selected");

        }

        el.addEventListener(
          "click",
          event=>{

            event.stopPropagation();

            chooseMarker(item);

          }
        );

      }else{

        el.classList.add("stacked");

        el.textContent =
          (
            kind === "tempo"
              ? "t"
              : "v"
          ) + "\u00d7" + cluster.length;

        el.title =
          cluster.length +
          "개가 겹쳐 있습니다. 눌러서 고르세요.";

        if(
          cluster.some(markerIsSelected)
        ){

          el.classList.add("selected");

        }

        el.addEventListener(
          "click",
          event=>{

            event.stopPropagation();

            openMarkerPicker(
              cluster,
              el
            );

          }
        );

      }

      ruler.appendChild(el);

    }

  }

}


/* 예전 이름으로 부르던 곳이 많아 그대로 남겨 둔다 */
function renderVelocityMarkers(){
  renderMarkers();
}


function renderTempoMarkers(){
  renderMarkers();
}


function getCurrentVelocity(){

  const track =
    tracks[selectedTrack];

  if(!track){
    return 12;
  }

  if(
    selectedMarker &&
    selectedMarker.type ===
      "velocity" &&
    track.velocityMarkers[
      selectedMarker.index
    ]
  ){

    return track.velocityMarkers[
      selectedMarker.index
    ].velocity;

  }

  if(
    selectedNote !== null
  ){

    const note =
      track.notes[
        selectedNote
      ];

    if(note){

      return noteVelocity(track, note);

    }

  }

  return getVelocityAtBar(
    track,
    playheadBar
  );

}


/* 마커 목록에서 어떤 자리의 값을 읽는다. 목록은 자리 순으로 정렬돼 있어야 한다. */
function velocityAt(
  markers,
  bar
){

  if(
    !Array.isArray(markers) ||
    !markers.length
  ){

    return 12;

  }

  let value =
    markers[0].velocity;

  for(const marker of markers){

    if(marker.bar <= bar + BAR_EPS){

      value = marker.velocity;

    }else{

      break;

    }

  }

  return value;

}


function getVelocityAtBar(
  track,
  bar
){

  if(
    !track ||
    !Array.isArray(
      track.velocityMarkers
    ) ||
    track.velocityMarkers.length === 0
  ){

    return 12;

  }

  let velocity = 12;

  for(
    const marker
    of track.velocityMarkers
  ){

    if(
      marker.bar <=
      bar + BAR_EPS
    ){

      velocity =
        marker.velocity;

    }else{

      break;

    }

  }

  return velocity;

}


function updateVelocityUI(){

  const velocity =
    getCurrentVelocity();

  velocityRange.value =
    velocity;

  velocityValue.textContent =
    velocity;

}


function updateTempoUI(){

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  let currentTempo =
    getTempoAtBar(
      track,
      playheadBar
    );

  if(
    selectedMarker &&
    selectedMarker.type ===
      "tempo" &&
    track.tempoMarkers[
      selectedMarker.index
    ]
  ){

    currentTempo =
      track.tempoMarkers[
        selectedMarker.index
      ].tempo;

  }

  tempo =
    clampTempo(
      currentTempo
    );

  renderTempo();

}


velocityRange.addEventListener(
  "input",
  ()=>{

    velocityValue.textContent =
      velocityRange.value;

  }
);


velocityRange.addEventListener(
  "change",
  ()=>{

    const value =
      Number(
        velocityRange.value
      );

    const track =
      tracks[selectedTrack];

    if(!track){
      return;
    }

    saveHistory();

    if(
      selectedMarker &&
      selectedMarker.type ===
        "velocity" &&
      track.velocityMarkers[
        selectedMarker.index
      ]
    ){

      track.velocityMarkers[
        selectedMarker.index
      ].velocity =
        value;

      const marker =
        track.velocityMarkers[
          selectedMarker.index
        ];

      setPlayheadBar(
        marker.bar
      );

    }else if(
      selectedNote !== null &&
      track.notes[selectedNote]
    ){

      /* 노트를 고른 상태면 그 음 하나만 바꾼다.
         화음에서 아랫음만 여리게 하는 식으로 쓸 수 있다.
         그 자리의 마커 값과 같아지면 값을 지워 마커를 따르게 한다. */
      const note =
        track.notes[selectedNote];

      note.vel =
        value === getVelocityAtBar(track, note.bar)
          ? null
          : value;

      renderNotes();

    }else{

      createOrUpdateVelocityMarker(
        playheadBar,
        value
      );

    }

    renderVelocityMarkers();
    renderTempoMarkers();
    renderOutputs();
    updateVelocityUI();
    updateTempoUI();

  }
);


function lengthButtons(){

  return lengthControls.querySelectorAll(
    "[data-length]"
  );

}


function updateLengthButtons(){

  const buttons =
    lengthButtons();

  buttons.forEach(
    button =>
      button.classList.remove(
        "on"
      )
  );

  if(
    selectedNote === null
  ){

    return;

  }

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const note =
    track.notes[
      selectedNote
    ];

  if(!note){
    return;
  }

  normalizeNote(note);

  buttons.forEach(
    button=>{

      const type =
        button.dataset.length;

      if(type === "tie"){

        if(note.tie){

          button.classList.add(
            "on"
          );

        }

      }else if(type === "dot"){

        if(note.dotted){

          button.classList.add(
            "on"
          );

        }

      }else{

        if(
          Number(type) ===
          Number(note.lengthBase)
        ){

          button.classList.add(
            "on"
          );

        }

      }

    }
  );

}


/* 이음줄 걸기/끊기.
   이어질 음이 없으면 바로 뒤에 같은 음정으로 하나 만들어 잇는다.
   "노트 끝을 눌러 이음줄 추가"가 곧 이 동작이다. */
function toggleTie(index){

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const note =
    track.notes[index];

  if(!note){
    return;
  }

  normalizeNote(note);

  if(note.tie){

    saveHistory();

    note.tie = false;

    showToast(
      "이음줄을 끊었습니다."
    );

    renderNotes();
    updateLengthButtons();
    renderOutputs();

    return;

  }

  /* 화음은 이을 수 없다 — 어느 음이 이어지는지 MML로 적을 방법이 없다 */
  const sameStart =
    track.notes.filter(
      other =>
        Math.abs(other.bar - note.bar) < BAR_EPS
    );

  if(sameStart.length > 1){

    showToast(
      "화음은 이을 수 없습니다. 홑음에서만 됩니다."
    );

    return;

  }

  let partner =
    tiePartnerIndex(track, note);

  saveHistory();

  if(partner < 0){

    /* 이어받을 음을 새로 만든다 */
    const endBar =
      note.bar + note.len;

    const spans =
      noteSpans(track, null);

    const room =
      roomAt(spans, endBar);

    /* 그 자리에 이미 다른 음정의 묶음이 시작한다면 새로 만들지 않는다.
       거기에 음을 하나 더 놓으면 이음줄이 아니라 화음을 만들어 버린다. */
    const occupied =
      spans.some(
        span =>
          Math.abs(span.start - endBar) < BAR_EPS
      );

    if(occupied){

      undoStack.pop();

      showToast(
        "그 자리에는 다른 음이 있습니다. 같은 음정이어야 이을 수 있습니다."
      );

      return;

    }

    if(
      endBar >= BARS - BAR_EPS ||
      room < MIN_NOTE_LEN - BAR_EPS ||
      !fitsSpans(spans, endBar, MIN_NOTE_LEN)
    ){

      undoStack.pop();

      showToast(
        "이을 자리가 없습니다."
      );

      return;

    }

    const added = {

      row:
        note.row,

      bar:
        endBar,

      len:0,

      lengthBase:null,
      dotted:false,

      techs:[],

      vel:
        note.vel,

      tie:false

    };

    /* 앞 음과 같은 길이로 만들되 자리가 좁으면 들어가는 만큼만 */
    applyResizedLength(
      added,
      note.len,
      room
    );

    track.notes.push(added);

    partner =
      track.notes.length - 1;

  }

  note.tie = true;

  selectedNote = index;

  ensureBars(
    songEndBar(tracks)
  );

  renderNotes();
  updateLengthButtons();
  renderOutputs();

}


function changeSelectedNoteLength(
  value
){

  if(
    selectedNote === null
  ){

    showToast(
      "먼저 노트를 선택하세요."
    );

    return;

  }

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const note =
    track.notes[
      selectedNote
    ];

  if(!note){
    return;
  }

  normalizeNote(note);

  if(value === "tie"){

    toggleTie(selectedNote);

    return;

  }

  /* 점 버튼은 지금 길이의 이름표는 그대로 두고 점만 켜고 끈다.
     이름표가 없는 길이(예: 끌어서 만든 어중간한 길이)면 4분음표로 본다. */
  const base =
    Number(note.lengthBase) || 4;

  const wanted = {

    lengthBase:
      value === "dot"
        ? base
        : Number(value),

    dotted:
      value === "dot"
        ? !note.dotted
        : note.dotted

  };

  const room =
    roomAt(
      noteSpans(track, note),
      note.bar
    );

  const asked =
    getActualNoteLength(wanted);

  saveHistory();

  applyResizedLength(
    note,
    asked,
    room
  );

  /* 요청한 길이가 그대로 들어갔으면 누른 버튼을 그대로 켜 둔다.

     점찍은 셋잇단은 값이 보통 음표와 똑같아진다 (8분 셋잇단 1/12에 점을
     찍으면 1/8, 곧 8분음표다). 길이만 보고 이름표를 붙이면 "12 ·"를 눌렀는데
     "8"이 켜져 사용자가 잘못 눌렀다고 오해한다. */
  if(
    Math.abs(note.len - asked) < LEN_STEP / 4
  ){

    note.lengthBase =
      wanted.lengthBase;

    note.dotted =
      wanted.dotted;

  }

  /* 뒷음에 막혀 요청한 길이를 못 넣었으면 말해 준다.
     조용히 다른 길이가 되면 왜 버튼이 안 먹는지 알 수가 없다. */
  if(note.len < asked - BAR_EPS){

    showToast(
      "뒤에 다른 음이 있어 " +
      note.lengthBase +
      (note.dotted ? "." : "") +
      "분음표까지만 들어갑니다."
    );

  }

  renderNotes();
  updateLengthButtons();
  renderOutputs();

}


lengthControls.addEventListener(
  "click",
  event=>{

    const button =
      event.target.closest(
        "[data-length]"
      );

    if(!button){
      return;
    }

    changeSelectedNoteLength(
      button.dataset.length
    );

  }
);


function renderTechniqueMenu(){

  techMenuList.innerHTML = "";

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const techniques =
    getTechniquesForInstrument(
      track.name
    );

  const entries =
    Object.entries(
      techniques
    );

  if(
    entries.length === 0
  ){

    const empty =
      document.createElement(
        "div"
      );

    empty.className =
      "tech-menu-empty";

    empty.textContent =
      "이 악기에 등록된 기법이 없습니다.";

    techMenuList.appendChild(
      empty
    );

    return;

  }

  for(
    const [role,code]
    of entries
  ){

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "tech-option";

    button.dataset.role =
      role;

    button.dataset.code =
      code;

    if(
      selectedNote !== null &&
      track.notes[
        selectedNote
      ]
    ){

      const note =
        track.notes[
          selectedNote
        ];

      normalizeNote(note);

      if(
        note.techs.some(
          tech =>
            tech.role === role &&
            tech.code === code
        )
      ){

        button.classList.add(
          "active"
        );

      }

    }

    const name =
      document.createElement(
        "span"
      );

    name.className =
      "tech-option-name";

    name.textContent =
      TECHNIQUE_NAMES[
        role
      ] || role;

    const codeEl =
      document.createElement(
        "span"
      );

    codeEl.className =
      "tech-option-code";

    codeEl.textContent =
      code;

    button.appendChild(name);
    button.appendChild(codeEl);

    button.addEventListener(
      "click",
      ()=>{

        applyTechnique(
          role,
          code
        );

        renderTechniqueMenu();

      }
    );

    techMenuList.appendChild(
      button
    );

  }

}


function renderInspectorTechniques(){

  inspectorTechniques.innerHTML =
    "";

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const techniques =
    getTechniquesForInstrument(
      track.name
    );

  const entries =
    Object.entries(
      techniques
    );

  if(
    entries.length === 0
  ){

    const span =
      document.createElement(
        "span"
      );

    span.className =
      "empty";

    span.textContent =
      "사용 가능한 기법 없음";

    inspectorTechniques.appendChild(
      span
    );

    return;

  }

  let selectedTechs = [];

  if(
    selectedNote !== null
  ){

    const note =
      track.notes[
        selectedNote
      ];

    if(note){

      normalizeNote(note);

      selectedTechs =
        note.techs;

    }

  }

  entries.forEach(
    ([role,code])=>{

      const button =
        document.createElement(
          "button"
        );

      button.className =
        "tech-chip";

      button.textContent =
        TECHNIQUE_NAMES[
          role
        ] || role;

      button.title =
        code;

      const active =
        selectedTechs.some(
          tech =>
            tech.role === role &&
            tech.code === code
        );

      if(active){

        button.classList.add(
          "on"
        );

      }

      button.addEventListener(
        "click",
        ()=>{

          applyTechnique(
            role,
            code
          );

        }
      );

      inspectorTechniques.appendChild(
        button
      );

    }
  );

}


function applyTechnique(
  role,
  code
){

  if(
    selectedNote === null
  ){

    showToast(
      "먼저 노트를 선택하세요."
    );

    return;

  }

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const note =
    track.notes[
      selectedNote
    ];

  if(!note){
    return;
  }

  normalizeNote(note);

  const validTechniques =
    getTechniquesForInstrument(
      track.name
    );

  if(
    validTechniques[role] !==
    code
  ){

    return;

  }

  saveHistory();

  const existingIndex =
    note.techs.findIndex(
      tech =>
        tech.role === role
    );

  if(existingIndex >= 0){

    note.techs.splice(
      existingIndex,
      1
    );

  }else{

    note.techs.push({
      role,
      code
    });

  }

  renderNotes();
  renderInspectorTechniques();
  renderTechniqueMenu();
  renderOutputs();

}




/* 드래그로 잡은 길이를 노트에 적용한다.
   먼저 쓸 수 있는 자리를 넘지 않게 자르고, 그 다음 적을 수 있는 음표에 붙인다.
   len은 붙인 음표의 길이 그대로 넣는다 — 화면 폭과 MML이 항상 같아진다.

   available: 이 노트가 차지할 수 있는 최대 길이.
     뒤를 끌 때는 노트 시작부터 곡 끝까지,
     앞을 끌 때는 0마디부터 노트 끝까지가 된다. */
/* 드래그로 잡은 길이를 노트에 적용한다.
   available은 이 노트가 차지할 수 있는 최대 길이다.

   길이를 1/2/4/8/16분음표에 가두지 않는다. 변환 엔진은 어떤 tick이든
   토큰을 &로 이어 붙여 정확히 적을 수 있기 때문이다.
     두 마디짜리 음  → c1&c1
     8분 셋잇단      → c12
   표에 가두면 이런 것들이 반올림돼 사라진다. 대신 1/64음표(엔진이 적을 수
   있는 최소 단위) 배수로만 맞춘다. 그 배수는 언제나 정확히 표기된다. */
function applyResizedLength(
  note,
  length,
  available
){

  const room =
    Number.isFinite(available)
      ? available
      : BARS - note.bar;

  /* 자리는 반드시 내림해야 뒷음을 밀지 않는다 */
  const ceiling =
    floorLength(room);

  note.len =
    Math.min(
      ceiling,
      snapLength(length)
    );

  syncLengthLabel(note);

}


/* ============================================================
   같은 자리에서만 겹칠 수 있다 — MML이 표현할 수 있는 모양 지키기
   ============================================================
   아르미스 MML은 커서가 한 줄로만 흐른다. 화음은 : 로 묶어 한꺼번에
   내고, 커서는 그중 가장 긴 음만큼 전진한다. 그래서

     c1&c1:d1:e4     시작이 같고 길이가 다른 화음   → 된다
     c1 뒤에 반 마디 뒤부터 d1                       → 적을 방법이 없다

   같은 트랙 안에서 "울리는 중인데 다른 자리에서 새 음이 시작"하는 모양은
   MML로 옮길 수가 없다. 화면에서는 그려지는데 글자로 뽑으면 사라지거나
   박자가 밀린다. 그래서 아예 그렇게 놓이지 않도록 여기서 막는다.

   판정은 음정과 무관하다. 커서가 트랙마다 하나뿐이라 도-미가 겹치든
   같은 도가 겹치든 똑같이 안 된다.
   ============================================================ */

const BAR_EPS = 1e-6;


/* 트랙의 음을 시작 자리별로 묶어 [시작, 끝] 구간 목록을 만든다.
   끝은 그 자리에서 가장 길게 울리는 음이 정한다 — 커서를 미는 것이 그 음이다.
   exceptNote는 지금 옮기는 중인 음이다. 자기 자신과는 부딪힐 일이 없으므로 뺀다. */
function noteSpans(
  track,
  exceptNote
){

  /* 한 번에 여러 음을 옮길 때는 그 음들을 모두 빼고 봐야 한다.
     자기들끼리는 이미 성한 배치라 서로 부딪힐 일이 없다. */
  const skip =
    exceptNote instanceof Set
      ? exceptNote
      : new Set(
          exceptNote
            ? [exceptNote]
            : []
        );

  const byStart =
    new Map();

  for(const n of track.notes){

    if(skip.has(n)){
      continue;
    }

    normalizeNote(n);

    /* 마디 위치가 실수라 그대로 비교하면 미세한 오차로 화음이 갈라진다.
       tick으로 바꿔 정수로 묶는다. */
    const key =
      Math.round(n.bar * WHOLE);

    const end =
      n.bar + n.len;

    const cur =
      byStart.get(key);

    if(
      cur === undefined ||
      end > cur
    ){

      byStart.set(key, end);

    }

  }

  return [...byStart.entries()]
    .map(
      ([key,end])=>({
        start: key / WHOLE,
        end
      })
    )
    .sort(
      (a,b)=>a.start-b.start
    );

}


/* bar 자리에 len 길이로 놓아도 되는가.
   같은 자리에서 시작하는 것(화음)은 얼마든지 겹쳐도 된다. */
function fitsSpans(
  spans,
  bar,
  len
){

  if(bar < -BAR_EPS){
    return false;
  }

  const end =
    bar + len;

  for(const span of spans){

    if(
      Math.abs(span.start - bar) < BAR_EPS
    ){

      continue;   // 화음으로 합쳐지는 자리

    }

    if(
      end > span.start + BAR_EPS &&
      bar < span.end - BAR_EPS
    ){

      return false;

    }

  }

  return true;

}


/* bar에서 시작하는 음이 가질 수 있는 최대 길이 = 다음 묶음이 시작하기 전까지 */
function roomAt(
  spans,
  bar
){

  let room =
    Math.max(
      MIN_NOTE_LEN,
      BARS - bar
    );

  for(const span of spans){

    if(
      span.start > bar + BAR_EPS
    ){

      room =
        Math.min(
          room,
          span.start - bar
        );

      break;   // 시작 순으로 정렬돼 있다

    }

  }

  return room;

}


/* 끌어다 놓은 자리가 기존 묶음 시작점에 거의 붙었으면 그 자리로 당긴다.
   손으로 정확히 맞추기 어려운 화음을 만들기 쉽게 해 준다. */
function snapToSpanStart(
  spans,
  bar
){

  const reach =
    SNAP / 2;

  for(const span of spans){

    if(
      Math.abs(span.start - bar) <= reach
    ){

      return span.start;

    }

  }

  return bar;

}


/* 끝나는 자리를 붙잡아 둔 채 길이를 맞춘다 (앞쪽 손잡이용).
   원하는 길이부터 시작해 안 맞으면 짧은 쪽으로 한 칸씩 내려간다. */
function fitLengthFromEnd(
  note,
  spans,
  endBar,
  desired
){

  /* 원하는 길이에서 시작해 짧은 쪽으로 훑으며,
     앞 음과 부딪히지 않는 가장 긴 길이를 고른다.
     후보는 뒤쪽 손잡이와 같게 "정확히 적히는 길이"를 전부 쓴다
     (홑 음표뿐 아니라 이어붙여 찍히는 길이까지) — 게임 MML 표기가
     허용하는 한도 안에서 최대한 촘촘한 눈금으로 끌리게 하기 위해서다. */
  const desiredTicks =
    Math.round(desired * WHOLE);

  const upperBound =
    desiredTicks + MIN_TICK;

  const candidates =
    upperBound > EXACT_TICK_LIMIT
      ? EXACT_TICKS_SORTED.concat(
          (()=>{
            const long = [];
            for(
              let t = EXACT_TICK_LIMIT + MIN_TICK;
              t <= upperBound;
              t += MIN_TICK
            ){
              if(isExactTick(t)){
                long.push(t);
              }
            }
            return long;
          })()
        )
      : EXACT_TICKS_SORTED;

  const usable =
    candidates.filter(
      t=>t <= upperBound
    );

  for(
    let i = usable.length - 1;
    i >= 0;
    i--
  ){

    const ticks = usable[i];

    {

      const len =
        ticks / WHOLE;

      const bar =
        endBar - len;

      if(
        bar >= -BAR_EPS &&
        fitsSpans(
          spans,
          Math.max(0, bar),
          len
        )
      ){

        note.len =
          len;

        note.bar =
          Math.max(0, bar);

        syncLengthLabel(note);

        return true;

      }

    }

  }

  return false;

}


/* 트랙마다 다른 색.
   고른 트랙을 한 화면에 겹쳐 보므로 색이 곧 구분 수단이다.
   트랙 수가 색 수보다 많으면 앞에서부터 다시 쓴다. */
const TRACK_COLORS = [
  { a:"#2a8ba6", b:"#5fd3dc" },   // 청록
  { a:"#5b52c9", b:"#a99bf5" },   // 보라
  { a:"#b8763a", b:"#f5c17b" },   // 호박
  { a:"#2f8f5b", b:"#7fe0a6" },   // 초록
  { a:"#b2456f", b:"#f593b6" },   // 자홍
  { a:"#3f6fc4", b:"#93bcf7" },   // 파랑
  { a:"#9a7a2e", b:"#e8ce7a" },   // 겨자
  { a:"#7a4bb0", b:"#c9a4f0" }    // 자주
];


function trackColor(index){

  return TRACK_COLORS[
    index % TRACK_COLORS.length
  ];

}


function selectedTracks(){

  return tracks.filter(
    track=>track.selected
  );

}


function isTrackVisible(index){

  const track =
    tracks[index];

  return !!(track && track.selected);

}


/* 노트 하나를 그려서 돌려준다.
   trackIndex는 이 노트가 어느 트랙 것인지다. 지금 편집 중인 트랙이
   아니면 흐리게 깔아 두기만 하고, 눌러서 그 트랙으로 넘어갈 수 있다. */
function createNoteElement(
  track,
  trackIndex,
  note,
  index,
  drawLen
){

  normalizeNote(note);

  /* 이음줄로 이어진 음은 이어진 만큼을 한 막대로 그린다.
     마비꼬와 같은 모습이다 — 격자에는 한 음, & 는 아래 MML 글자에만. */
  const shownLen =
    Number.isFinite(drawLen)
      ? drawLen
      : note.len;

  const active =
    trackIndex === selectedTrack;

  const el =
    document.createElement(
      "div"
    );

  el.className =
    "note" +
    (
      active &&
      selectedNote === index
        ? " sel"
        : ""
    ) +
    (
      active &&
      multiSelection.has(index)
        ? " multi"
        : ""
    ) +
    (
      note.techs.length
        ? " has-tech"
        : ""
    ) +
    (
      active
        ? ""
        : " other"
    );

  const color =
    trackColor(trackIndex);

  el.style.setProperty(
    "--note-a",
    color.a
  );

  el.style.setProperty(
    "--note-b",
    color.b
  );

  el.style.left =
    (note.bar * BAR_W) + "px";

  const noteWidth =
    Math.max(
      8,
      shownLen * BAR_W
    );

  el.style.width =
    noteWidth + "px";

  el.style.top =
    (note.row * ROW_H + 1) + "px";

  el.dataset.index =
    index;

  el.dataset.track =
    trackIndex;

  /* 이 음이 시작하는 자리에서 음량이 바뀐다면 표시해 둔다.
     타임테이블만 보고도 어디서 세기가 달라지는지 알 수 있게. */
  const velMarker =
    (track.velocityMarkers || []).find(
      marker =>
        Math.abs(marker.bar - note.bar) < BAR_EPS
    );

  const ownVel =
    note.vel !== null &&
    note.vel !== undefined;

  if(velMarker || ownVel){

    el.classList.add("vel-mark");

    if(active){

      const flag =
        document.createElement("span");

      flag.className =
        "vel-flag" +
        (ownVel ? " own" : "");

      flag.textContent =
        "v" + noteVelocity(track, note);

      el.appendChild(flag);

    }

  }

  el.title =
    "v" + noteVelocity(track, note);



  if(note.techs.length){

    const tag =
      document.createElement(
        "span"
      );

    tag.className =
      "tech";

    tag.textContent =
      note.techs
        .map(
          tech =>
            TECHNIQUE_NAMES[
              tech.role
            ] ||
            tech.role
        )
        .join(" + ");

    el.appendChild(tag);

    const code =
      document.createElement(
        "span"
      );

    code.className =
      "tech-code";

    code.textContent =
      note.techs
        .map(
          tech=>tech.code
        )
        .join("");

    el.appendChild(code);

  }

  /* 앞뒤 양쪽 끝에 길이 손잡이를 단다.
     뒤를 끌면 끝이 움직이고, 앞을 끌면 시작이 움직인다.

     짧은 노트에서는 손잡이 두 개가 노트를 통째로 덮어 옮길 수가 없다.
     그래서 폭을 노트 폭의 30%로 잡되 12px을 넘기지 않는다.
     가운데는 언제나 이동용으로 남는다. */
  if(active){

    const handleWidth =
      Math.min(
        12,
        Math.max(
          4,
          noteWidth * .3
        )
      );

    [
      ["start","앞을 잡고 끌어 시작 위치와 길이 조절"],
      ["end","끝을 잡고 끌어 길이 조절"]
    ].forEach(
      ([side,title])=>{

        const handle =
          document.createElement(
            "span"
          );

        handle.className =
          "note-resize-handle " +
          side;

        handle.dataset.side =
          side;

        handle.title =
          title;

        handle.style.width =
          handleWidth + "px";

        el.appendChild(handle);

      }
    );

    el.addEventListener(
      "pointerdown",
      event =>
        startNotePointer(
          event,
          index,
          el
        )
    );

  }

  el.addEventListener(
    "click",
    event=>{

      event.stopPropagation();

      if(wasDragging){

        wasDragging = false;

        return;

      }

      /* 다른 트랙의 노트를 누르면 그 트랙으로 넘어간다.
         전에 고르고 있던 노트 번호는 새 트랙에서는 엉뚱한 자리를
         가리키므로 반드시 걷어야 한다. 선택 모드가 켜져 있으면
         트랙을 넘어가서도 계속 고를 수 있게, 지금 누른 노트부터
         새로 담아 준다. */
      if(!active){

        selectedTrack =
          trackIndex;

        clearMultiSelection();

        if(pickMode){

          multiSelection.add(index);

        }

        selectedNote =
          index;

        selectedMarker =
          null;

        renderTracks();
        renderNotes();
        renderVelocityMarkers();
        renderTempoMarkers();
        renderTechniqueMenu();
        renderInspectorTechniques();
        updateLengthButtons();
        updateVelocityUI();
        updateTempoUI();

        return;

      }

      selectedMarker =
        null;

      /* 하나씩 눌러 고르기.
         선택 모드가 켜져 있거나 Ctrl(⌘)·Shift를 누른 채면 더하고 빼는 방식이 된다.
         노트북에서 Ctrl+클릭으로 골라 담는 것과 같은 감각. */
      const additive =
        pickMode ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey;

      if(additive){

        if(multiSelection.has(index)){

          multiSelection.delete(index);

          selectedNote =
            multiSelection.size
              ? [...multiSelection][multiSelection.size - 1]
              : null;

        }else{

          multiSelection.add(index);

          selectedNote = index;

        }

      }else{

        selectedNote = index;

        clearMultiSelection();

      }

      renderNotes();
      renderInspectorTechniques();
      renderTechniqueMenu();
      updateLengthButtons();
      updateVelocityUI();
      updateTempoUI();

    }
  );

  return el;

}


/* 이어진 조각을 한 막대로 그리기 위한 표.
     hidden : 앞 음에 흡수되어 따로 그리지 않을 조각 번호
     length : 조각 번호 → 이어진 만큼을 합친 길이

   "몇 번째 줄, 몇 tick에서 시작"을 열쇠로 한 번만 모아 두고 따라간다. */
function tieLayout(track){

  const hidden = new Set();
  const length = new Map();

  const startAt = new Map();

  track.notes.forEach(
    (note,index)=>{

      normalizeNote(note);

      startAt.set(
        note.row + ":" +
        Math.round(note.bar * WHOLE),
        index
      );

    }
  );

  const nextOf = index=>{

    const note =
      track.notes[index];

    if(!note || !note.tie){
      return -1;
    }

    const key =
      note.row + ":" +
      Math.round(
        (note.bar + note.len) * WHOLE
      );

    const found =
      startAt.get(key);

    return found === undefined
      ? -1
      : found;

  };

  /* 이어받는 조각을 먼저 표시해 둔다 (그 조각은 머리가 될 수 없다) */
  track.notes.forEach(
    (note,index)=>{

      const next =
        nextOf(index);

      if(next >= 0){

        hidden.add(next);

      }

    }
  );

  track.notes.forEach(
    (note,index)=>{

      if(hidden.has(index)){
        return;
      }

      let total =
        note.len;

      let at =
        nextOf(index);

      let guard = 0;

      while(
        at >= 0 &&
        guard++ < 64
      ){

        total += track.notes[at].len;

        at = nextOf(at);

      }

      length.set(index, total);

    }
  );

  return { hidden, length };

}


function renderNotes(){

  grid
    .querySelectorAll(".note")
    .forEach(
      el=>el.remove()
    );

  const frag =
    document.createDocumentFragment();

  /* 그리기 전에 끊어진 이음줄을 걷는다.
     음을 줄이거나 옮긴 직후에도 &가 남아 보이지 않게. */
  for(const track of tracks){

    if(track.selected){

      normalizeTies(track);

    }

  }

  /* 지금 편집 중인 트랙을 맨 나중에 그려 맨 위로 올린다 */
  const order =
    tracks
      .map((track,index)=>index)
      .filter(isTrackVisible)
      .sort(
        (x,y)=>
          (x === selectedTrack ? 1 : 0) -
          (y === selectedTrack ? 1 : 0)
      );

  for(const trackIndex of order){

    const track =
      tracks[trackIndex];

    const layout =
      tieLayout(track);

    track.notes.forEach(
      (note,index)=>{

        /* 이음줄을 받아 울리는 중인 조각은 따로 그리지 않는다.
           앞 조각이 이어진 길이까지 한 막대로 그리기 때문이다. */
        if(layout.hidden.has(index)){
          return;
        }

        frag.appendChild(
          createNoteElement(
            track,
            trackIndex,
            note,
            index,
            layout.length.get(index)
          )
        );

      }
    );

  }

  grid.appendChild(frag);

  /* 위에서 .note 를 전부 지웠으므로 떠 있던 반투명 노트도 같이 날아간다.
     끌던 중에 사라지면 안 되니 다시 그려 준다. */
  renderGhost();

}


/* 고른 표시(노란 테두리)만 다시 칠한다.
   renderNotes는 모든 노트를 지우고 손잡이·태그까지 새로 만들기 때문에
   노트가 수백 개면 한 번 부를 때마다 눈에 띄게 멈칫한다. 선택만 바뀐
   경우에는 이미 그려져 있는 요소의 class만 바꾸면 되므로 이 함수를 쓴다.

   목록을 미리 받아 둔 게 있으면(끌어서 감쌀 때) 그걸 그대로 쓴다 —
   매 프레임 querySelectorAll을 다시 돌리지 않기 위해서다. */
function refreshNoteSelection(cached){

  const list =
    cached ||
    grid.querySelectorAll(".note");

  list.forEach(
    el=>{

      /* 반투명 노트(ghost)는 번호가 없다. 건드리지 않는다. */
      if(el.dataset.index === undefined){
        return;
      }

      const trackIndex =
        Number(el.dataset.track);

      const index =
        Number(el.dataset.index);

      const active =
        trackIndex === selectedTrack;

      el.classList.toggle(
        "sel",
        active && selectedNote === index
      );

      el.classList.toggle(
        "multi",
        active && multiSelection.has(index)
      );

    }
  );

}


let pointerState = null;
let wasDragging = false;


/* 이 음에서 시작해 이음줄로 이어진 조각 번호를 모두 모은다.
   c1.&c4 처럼 나뉘어 있어도 소리로는 하나이므로,
   길이를 조절할 때는 이 묶음 전체를 한 음으로 다뤄야 한다. */
function tieChainIndexes(
  track,
  index
){

  const out = [index];

  let guard = 0;

  while(guard++ < 64){

    const note =
      track.notes[
        out[out.length - 1]
      ];

    if(!note || !note.tie){
      break;
    }

    const next =
      tiePartnerIndex(track, note);

    if(
      next < 0 ||
      out.indexOf(next) >= 0
    ){

      break;

    }

    out.push(next);

  }

  return out;

}


/* 이어진 조각들을 하나로 합친다. 길이를 끌기 직전에 부른다.
   합쳐 두면 뒤 조각에 막히지 않고 자유롭게 줄이고 늘일 수 있고,
   손을 놓을 때 splitNoteByTokens가 다시 알맞게 나눈다. */
function mergeTieChain(
  track,
  index
){

  const chain =
    tieChainIndexes(track, index);

  if(chain.length < 2){
    return false;
  }

  const head =
    track.notes[chain[0]];

  let total = 0;

  for(const i of chain){
    total += track.notes[i].len;
  }

  const tail =
    track.notes[chain[chain.length - 1]];

  head.len = total;

  head.tie = tail.tie;

  syncLengthLabel(head);

  const removed =
    chain.slice(1);

  /* 뒤에서부터 지워야 앞 번호가 밀리지 않는다 */
  removed
    .slice()
    .sort((a,b)=>b-a)
    .forEach(
      i=>track.notes.splice(i, 1)
    );

  return removed;

}


function startNotePointer(
  event,
  index,
  element
){

  if(event.button !== 0){
    return;
  }

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const note =
    track.notes[index];

  if(!note){
    return;
  }

  /* 선택 모드(노란 네모)가 켜져 있거나 Ctrl(⌘)·Shift를 누른 채 노트를
     누르면, 어디를 눌렀든(끝이 아니라 몸통이어도) 그 자리에서 바로
     토글만 하고 끝낸다. 이 처리를 안 하면 아래 mode==="move" 분기로
     떨어져 노트를 옮기기 시작해버려서, 노트 끝의 손잡이를 정확히
     눌러야만 토글이 되는 것처럼 보였다. */
  const additive =
    pickMode ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey;

  if(additive){

    event.preventDefault();
    event.stopPropagation();

    cancelMarquee();

    selectedMarker =
      null;

    if(multiSelection.has(index)){

      multiSelection.delete(index);

      selectedNote =
        multiSelection.size
          ? [...multiSelection][multiSelection.size - 1]
          : null;

    }else{

      multiSelection.add(index);

      selectedNote =
        index;

    }

    /* 고른 것만 달라졌으므로 표시만 바꾼다.
       renderNotes로 통째로 다시 그리면 노트가 많을 때 클릭이 밀린다. */
    refreshNoteSelection();
    renderInspectorTechniques();
    renderTechniqueMenu();
    updateLengthButtons();
    updateVelocityUI();
    updateTempoUI();

    /* 이 자리에서 이미 토글을 끝냈으니, 뒤이어 따라오는 click 이벤트가
       똑같은 토글을 한 번 더 해서 도로 무르는 일이 없도록 막는다. */
    wasDragging = true;

    return;

  }

  normalizeNote(note);

  event.preventDefault();
  event.stopPropagation();

  /* 노트를 잡는 순간 그리던 선택 사각형은 걷는다 */
  cancelMarquee();

  selectedNote =
    index;

  selectedMarker =
    null;

  document
    .querySelectorAll(".note")
    .forEach(
      noteEl =>
        noteEl.classList.remove(
          "sel"
        )
    );

  element.classList.add(
    "sel"
  );

  renderInspectorTechniques();
  renderTechniqueMenu();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();

  const rect =
    element.getBoundingClientRect();

  const localX =
    event.clientX -
    rect.left;

  const resizeHandle =
    event.target.closest(
      ".note-resize-handle"
    );

  /* 손잡이를 정확히 못 눌러도 양 끝 근처를 잡으면 길이 조절로 친다.
     노트가 짧을 때는 가운데를 이동용으로 남겨야 하므로 폭에 비례해 줄인다. */
  const resizeZone =
    Math.min(
      16,
      Math.max(
        6,
        rect.width * .22
      )
    );

  let mode =
    "move";

  if(resizeHandle){

    mode =
      resizeHandle.dataset.side === "start"
        ? "resize-start"
        : "resize-end";

  }else if(rect.width >= 16){

    if(
      localX >=
      rect.width - resizeZone
    ){

      mode =
        "resize-end";

    }else if(
      localX <= resizeZone
    ){

      mode =
        "resize-start";

    }

  }

  /* 이어진 조각들을 미리 하나로 합쳐 둔다.
     화면에는 이미 한 막대로 보이므로, 잡았을 때도 한 음처럼 움직여야 한다.
     옮기든 늘리든 줄이든 뒤 조각에 막히지 않는다.
     손을 놓을 때 splitNoteByTokens가 다시 알맞게 나눈다. */
  let historySaved = false;

  {

    const willMerge =
      tieChainIndexes(track, index).length > 1;

    if(willMerge){

      /* 바꾸기 전에 기록해야 되돌릴 수 있다 */
      saveHistory();

      historySaved = true;

    }

    const merged =
      willMerge
        ? mergeTieChain(track, index)
        : false;

    if(merged && mode !== "move"){

      /* 화면을 통째로 다시 그리면 지금 누르고 있는 원소가 사라져
         드래그가 끊긴다. 없어진 조각의 그림만 걷고 잡은 것은 그대로 둔다.
         나머지는 손을 놓을 때 renderNotes가 정리한다. */
      for(const gone of merged){

        /* 트랙 번호까지 함께 봐야 한다. 번호만으로 찾으면 다른 트랙의
           같은 번호 노트가 먼저 걸려, 엉뚱한 것이 지워지고 정작 합쳐진
           조각은 화면에 그대로 남는다. */
        const stale =
          grid.querySelector(
            '.note[data-track="' + selectedTrack + '"]' +
            '[data-index="' + gone + '"]'
          );

        if(
          stale &&
          stale !== element
        ){

          stale.remove();

        }

      }

      element.style.width =
        Math.max(
          8,
          track.notes[index].len * BAR_W
        ) + "px";

    }

  }

  /* 옮기기는 붙여넣기·새 노트와 같은 방식으로 다룬다.
     음을 판에서 집어 들어 반투명하게 띄우고, 손을 놓을 때 자리를 잡는다.
     놓을 수 없는 자리면 계속 떠 있어 다시 끌 수 있다. */
  if(mode === "move"){

    if(!historySaved){

      saveHistory();

    }

    /* 여러 개 골라 뒀고 그중 하나를 잡았다면 통째로 옮긴다 */
    const moving =
      multiSelection.has(index)
        ? [...multiSelection]
        : [index];

    const picked =
      moving
        .map(i=>track.notes[i])
        .filter(Boolean);

    picked.forEach(normalizeNote);

    const baseBar =
      Math.min(...picked.map(n=>n.bar));

    const baseRow =
      Math.min(...picked.map(n=>n.row));

    const items =
      picked.map(
        n=>({

          barOffset:
            n.bar - baseBar,

          rowOffset:
            n.row - baseRow,

          len:
            n.len,

          techs:
            n.techs.map(t=>({ ...t })),

          vel:
            n.vel,

          tie:
            n.tie

        })
      );

    /* 뒤에서부터 빼야 앞 번호가 밀리지 않는다 */
    moving
      .slice()
      .sort((a,b)=>b-a)
      .forEach(
        i=>track.notes.splice(i, 1)
      );

    selectedNote = null;

    clearMultiSelection();

    startGhost(
      items,
      {
        bar: baseBar,
        row: baseRow,
        fromMove: true,
        quiet: true
      }
    );

    renderNotes();

    startGhostDrag(event);

    return;

  }

  pointerState = {

    index,

    mode,

    startX:
      event.clientX,

    startY:
      event.clientY,

    startBar:
      note.bar,

    startRow:
      note.row,

    startLen:
      note.len,

    /* 이 음을 뺀 나머지가 이미 차지한 자리. 드래그 내내 그대로다. */
    spans:
      noteSpans(track, note),

    /* 막혔을 때 되돌아갈 마지막 성한 자리 */
    lastBar:
      note.bar,

    moved:false,

    historySaved,

    pointerId:
      event.pointerId,

    element

  };

  try{

    element.setPointerCapture(
      event.pointerId
    );

  }catch(error){}

  element.addEventListener(
    "pointermove",
    handleNotePointerMove
  );

  element.addEventListener(
    "pointerup",
    handleNotePointerUp,
    {
      once:true
    }
  );

  element.addEventListener(
    "pointercancel",
    handleNotePointerUp,
    {
      once:true
    }
  );

}


/* 저사양 최적화: pointermove는 화면 주사율보다 더 자주 올 수 있다.
   길이/벨로시티/템포 표시 갱신을 프레임당 한 번으로 묶어
   드래그 중 불필요한 DOM 갱신이 반복되지 않게 한다. */
let dragUiFrame = null;
function scheduleDragUiSync(){
  if(dragUiFrame !== null){
    return;
  }
  dragUiFrame = requestAnimationFrame(()=>{
    dragUiFrame = null;
    updateLengthButtons();
    updateVelocityUI();
    updateTempoUI();
  });
}


function handleNotePointerMove(
  event
){

  if(!pointerState){
    return;
  }

  const state =
    pointerState;

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  const note =
    track.notes[
      state.index
    ];

  if(!note){
    return;
  }

  const dx =
    event.clientX -
    state.startX;

  const dy =
    event.clientY -
    state.startY;

  if(
    Math.abs(dx) > 3 ||
    Math.abs(dy) > 3
  ){

    state.moved = true;

    wasDragging = true;

  }

  if(!state.moved){
    return;
  }

  if(!state.historySaved){

    saveHistory();

    state.historySaved = true;

  }

  /* 이 음을 뺀 나머지가 차지하고 있는 자리.
     드래그 한 번 동안 바뀌지 않으므로 startNotePointer에서 한 번만 만든다. */
  const spans =
    state.spans;

  /* 옮기기는 startNotePointer에서 반투명 노트로 넘어가므로
     여기까지 오지 않는다. 남는 것은 길이 조절뿐이다. */
  if(
    state.mode === "resize-end"
  ){

    /* 뒤쪽 끝을 끈다 — 시작은 그대로, 길이만 바뀐다.

       잡아끈 길이를 격자(SNAP)로 먼저 반올림하지 않는다. 그러면
       점16분음표처럼 1/16 배수가 아닌 길이에 닿을 수 없다.
       실제로 적을 수 있는 음표로 붙이는 일은 applyResizedLength가 한다. */
    applyDragLength(
      note,
      state.startLen +
      dx / BAR_W,
      roomAt(spans, note.bar)
    );

    if(state.element){

      state.element.style.width =
        Math.max(
          8,
          note.len * BAR_W
        ) + "px";

    }

  }

  else if(
    state.mode === "resize-start"
  ){

    /* 앞쪽 끝을 끈다 — 끝나는 자리를 붙잡아 두고 시작만 움직인다.
       길이를 먼저 음표에 붙인 다음, 그 길이만큼 끝에서 되짚어
       시작 위치를 정해야 끝이 흔들리지 않는다. */
    const endBar =
      state.startBar +
      state.startLen;

    /* 앞으로 늘리다 앞 음과 부딪히면 그 앞은 못 간다.
       길이를 한 칸씩 줄여 가며 들어갈 수 있는 가장 긴 음표를 고른다. */
    fitLengthFromEnd(
      note,
      spans,
      endBar,
      state.startLen -
      dx / BAR_W
    );

    if(state.element){

      state.element.style.left =
        (note.bar * BAR_W) + "px";

      state.element.style.width =
        Math.max(
          8,
          note.len * BAR_W
        ) + "px";

    }

  }

  scheduleDragUiSync();
  scheduleOutputs();

}


/* 끌어서 길게 만든 음을 "음 + 이음줄 + 음"으로 쪼갠다.

   MML에서 긴 음은 어차피 c4&c16 처럼 여러 토막으로 적힌다. 그런데 화면에는
   기다란 막대 하나만 있으면, 글자에는 &가 있는데 그림에는 없는 상태가 된다.
   토막 하나가 음표 하나가 되도록 나눠 두면 화면과 글자가 같은 모양이 된다.

   길이 합은 그대로라 소리도 자리도 바뀌지 않는다. */
function splitNoteByTokens(
  track,
  index
){

  const note =
    track.notes[index];

  if(!note){
    return false;
  }

  const total =
    Math.round(note.len * WHOLE);

  const parts =
    resolveTickTokens(total);

  if(
    parts.tokens.length < 2 ||
    parts.tick !== total
  ){

    return false;

  }

  const lengths =
    parts.tokens.map(tokenTick);

  if(
    lengths.some(t=>!t) ||
    lengths.reduce((a,b)=>a+b,0) !== total
  ){

    return false;

  }

  const tailTie =
    note.tie;

  let bar =
    note.bar;

  /* 첫 토막은 원래 음을 그대로 쓴다. 고른 상태나 번호가 유지된다. */
  note.len =
    lengths[0] / WHOLE;

  note.tie =
    true;

  syncLengthLabel(note);

  bar += note.len;

  for(
    let i = 1;
    i < lengths.length;
    i++
  ){

    const piece = {

      row:
        note.row,

      bar,

      len:
        lengths[i] / WHOLE,

      lengthBase:null,
      dotted:false,

      techs:[],

      vel:
        note.vel,

      /* 마지막 토막만 원래 음이 들고 있던 이음줄을 물려받는다 */
      tie:
        i === lengths.length - 1
          ? tailTie
          : true

    };

    normalizeNote(piece);

    track.notes.push(piece);

    bar += piece.len;

  }

  return true;

}


function handleNotePointerUp(
  event
){

  const state =
    pointerState;

  pointerState =
    null;

  if(!state){
    return;
  }

  if(state.element){

    state.element.removeEventListener(
      "pointermove",
      handleNotePointerMove
    );

  }

  try{

    if(
      state.element &&
      state.element.hasPointerCapture &&
      state.element.hasPointerCapture(
        event.pointerId
      )
    ){

      state.element.releasePointerCapture(
        event.pointerId
      );

    }

  }catch(error){}

  if(!state.moved){

    wasDragging = false;

    return;

  }

  /* 길이를 바꿨다면, 한 음표로 못 적는 길이는 이음줄로 나눠 놓는다.
     이동만 했을 때는 길이가 그대로이므로 건드리지 않는다. */
  if(
    state.mode !== "move" &&
    tracks[selectedTrack]
  ){

    splitNoteByTokens(
      tracks[selectedTrack],
      state.index
    );

  }

  renderNotes();
  renderVelocityMarkers();
  renderTempoMarkers();
  renderInspectorTechniques();
  renderTechniqueMenu();
  renderOutputs();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();

  setTimeout(
    ()=>{
      wasDragging = false;
    },
    0
  );

}


noteAddButton.addEventListener(
  "click",
  ()=>{

    if(!tracks[selectedTrack]){

      showToast(
        "먼저 트랙을 고르세요."
      );

      return;

    }

    /* 곧바로 놓지 않는다. 화면 한가운데에 반투명하게 띄워 두고
       사용자가 끌어다 놓을 때 자리를 잡는다. */
    startGhost([{

      barOffset:0,

      rowOffset:0,

      len:
        getActualNoteLength({
          lengthBase:4,
          dotted:false
        }),

      techs:[]

    }]);

  }
);


noteDeleteButton.addEventListener(
  "click",
  async()=>{

    /* 아직 자리를 안 정하고 떠 있는 노트면 그것부터 지운다 */
    if(ghost){

      discardGhost();

      showToast(
        "떠 있던 노트를 지웠습니다."
      );

      return;

    }

    const track =
      tracks[selectedTrack];

    if(!track){
      return;
    }

    if(selectedMarker){

      saveHistory();

      if(
        selectedMarker.type ===
          "velocity"
      ){

        track.velocityMarkers.splice(
          selectedMarker.index,
          1
        );

      }

      if(
        selectedMarker.type ===
          "tempo"
      ){

        track.tempoMarkers.splice(
          selectedMarker.index,
          1
        );

      }

      selectedMarker =
        null;

      setPlayheadBar(
        playheadBar
      );

      renderVelocityMarkers();
      renderTempoMarkers();
      updateVelocityUI();
      updateTempoUI();
      renderOutputs();

      return;

    }

    /* 여러 개 골라 뒀으면 그것부터 지운다.
       뒤에서부터 지워야 앞 번호가 밀리지 않는다. */
    if(multiSelection.size){

      saveHistory();

      const doomed =
        [...multiSelection].sort(
          (a,b)=>b-a
        );

      for(const index of doomed){

        track.notes.splice(index, 1);

      }

      const removed =
        doomed.length;

      clearMultiSelection();

      selectedNote = null;

      renderNotes();
      renderInspectorTechniques();
      renderTechniqueMenu();
      updateLengthButtons();
      updateVelocityUI();
      updateTempoUI();
      renderOutputs();

      showToast(
        removed + "개 지웠습니다."
      );

      return;

    }

    if(
      selectedNote !== null &&
      track.notes[
        selectedNote
      ]
    ){

      saveHistory();

      track.notes.splice(
        selectedNote,
        1
      );

      if(
        track.notes.length === 0
      ){

        selectedNote =
          null;

      }else{

        selectedNote =
          Math.min(
            selectedNote,
            track.notes.length - 1
          );

      }

      renderNotes();
      renderInspectorTechniques();
      renderTechniqueMenu();
      updateLengthButtons();
      updateVelocityUI();
      updateTempoUI();
      renderVelocityMarkers();
      renderTempoMarkers();
      renderOutputs();

      return;

    }

    if(
      tracks.length <= 1
    ){

      showToast(
        "트랙은 최소 1개가 필요합니다."
      );

      return;

    }

    const displayName =
      getTrackTitle(
        track,
        selectedTrack
      );

    const confirmed =
      await showConfirm({
        eyebrow:"delete track",
        title:
          displayName +
          " 트랙을 삭제할까요?",
        text:
          "이 트랙의 노트와 마커가 함께 사라집니다. " +
          "실행취소(Ctrl+Z)로 되돌릴 수 있습니다.",
        okText:"삭제",
        cancelText:"그대로 두기",
        danger:true
      });

    if(!confirmed){
      return;
    }

    saveHistory();

    tracks.splice(
      selectedTrack,
      1
    );

    selectedTrack =
      Math.max(
        0,
        Math.min(
          selectedTrack,
          tracks.length - 1
        )
      );

    selectedNote = null;
    selectedMarker = null;

    ensureFocusedTrack();

    renderTracks();
    renderNotes();
    renderVelocityMarkers();
    renderTempoMarkers();
    renderTechniqueMenu();
    renderInspectorTechniques();
    updateLengthButtons();
    updateVelocityUI();
    updateTempoUI();
    renderOutputs();

  }
);


/* 악기 메뉴는 두 곳에서 열린다.
   "트랙 추가"에서 열면 새 트랙을 만들고,
   트랙 이름에서 열면 그 트랙의 악기를 바꾼다.
   어느 쪽으로 열렸는지 여기에 적어 둔다. */
let instrumentMenuMode = "change";


function renderInstrumentMenu(){

  instrumentMenuList.innerHTML =
    "";

  Object.keys(
    TECHNIQUE_SETS
  ).forEach(
    name=>{

      const button =
        document.createElement(
          "button"
        );

      button.type =
        "button";

      button.className =
        "instrument-option";

      if(
        instrumentMenuMode === "change" &&
        tracks[selectedTrack] &&
        getBaseInstrument(
          tracks[selectedTrack].name
        ) === name
      ){

        button.classList.add(
          "current"
        );

      }

      button.textContent =
        name;

      button.addEventListener(
        "click",
        event=>{

          event.stopPropagation();

          if(
            instrumentMenuMode === "add"
          ){

            addTrack(name);

          }else{

            changeTrackInstrument(
              name
            );

          }

          closeMenus();

        }
      );

      instrumentMenuList.appendChild(
        button
      );

    }
  );

}


function changeTrackInstrument(
  instrumentName
){

  const track =
    tracks[selectedTrack];

  if(!track){
    return;
  }

  if(
    getBaseInstrument(
      track.name
    ) === instrumentName
  ){

    closeInstrumentMenu();

    return;

  }

  saveHistory();

  const validTechniques =
    getTechniquesForInstrument(
      instrumentName
    );

  track.notes.forEach(
    note=>{

      normalizeNote(note);

      note.techs =
        note.techs.filter(
          tech =>
            validTechniques[
              tech.role
            ] === tech.code
        );

    }
  );

  track.name =
    instrumentName;

  selectedNote = null;
  selectedMarker = null;

  renderTracks();
  renderNotes();
  renderVelocityMarkers();
  renderTempoMarkers();
  renderTechniqueMenu();
  renderInspectorTechniques();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();
  renderOutputs();

}


function addTrack(
  instrumentName
){

  saveHistory();

  tracks.push({

    name:
      instrumentName,

    /* 손으로 만든 트랙은 원본 미디가 없다 */
    midiName:null,
    label:null,
    selected:true,

    notes:[],

    velocityMarkers:[
      {
        bar:0,
        velocity:12
      }
    ],

    tempoMarkers:[
      {
        bar:0,
        tempo:120
      }
    ]

  });

  selectedTrack =
    tracks.length - 1;

  selectedNote = null;
  selectedMarker = null;

  renderTracks();
  renderNotes();
  renderVelocityMarkers();
  renderTempoMarkers();
  renderTechniqueMenu();
  renderInspectorTechniques();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();
  renderOutputs();

}


function openInstrumentMenuForTrack(
  event
){

  event.stopPropagation();

  closeTechMenu();

  instrumentMenuMode = "change";

  renderInstrumentMenu();

  const rect =
    event.currentTarget
      .getBoundingClientRect();

  let left =
    rect.right + 8;

  let top =
    rect.top;

  const menuWidth =
    240;

  const menuHeight =
    430;

  if(
    left + menuWidth >
    window.innerWidth - 8
  ){

    left =
      rect.left -
      menuWidth -
      8;

  }

  if(
    top + menuHeight >
    window.innerHeight - 8
  ){

    top =
      window.innerHeight -
      menuHeight -
      8;

  }

  if(top < 8){
    top = 8;
  }

  instrumentMenu.style.left =
    left + "px";

  instrumentMenu.style.top =
    top + "px";

  instrumentMenu.classList.add(
    "show"
  );

}


trackAddButton.addEventListener(
  "click",
  event=>{

    event.stopPropagation();

    closeTechMenu();

    instrumentMenuMode = "add";

    renderInstrumentMenu();

    const rect =
      trackAddButton
        .getBoundingClientRect();

    let left =
      rect.left;

    let top =
      rect.bottom + 6;

    const menuWidth =
      240;

    const menuHeight =
      430;

    if(
      left + menuWidth >
      window.innerWidth - 8
    ){

      left =
        window.innerWidth -
        menuWidth -
        8;

    }

    if(
      top + menuHeight >
      window.innerHeight - 8
    ){

      top =
        rect.top -
        menuHeight -
        6;

    }

    if(top < 8){
      top = 8;
    }

    instrumentMenu.style.left =
      left + "px";

    instrumentMenu.style.top =
      top + "px";

    instrumentMenu.classList.add(
      "show"
    );

  }
);


/* 편집 대상을 옮긴다. 고르지 않은 트랙은 편집 대상이 될 수 없다. */
function focusTrack(index){

  if(!isTrackVisible(index)){
    return false;
  }

  selectedTrack = index;
  selectedNote = null;
  selectedMarker = null;

  /* 고른 노트 번호는 트랙마다 다르므로 트랙이 바뀌면 물린다 */
  clearMultiSelection();

  return true;

}


/* 편집 대상이 화면에서 사라졌으면 남아 있는 트랙 중 하나로 옮긴다 */
function ensureFocusedTrack(){

  if(isTrackVisible(selectedTrack)){
    return;
  }

  const next =
    tracks.findIndex(
      track=>track.selected
    );

  selectedTrack =
    next < 0 ? 0 : next;

  selectedNote = null;
  selectedMarker = null;

}


function refreshAll(){

  renderTracks();
  renderNotes();
  renderVelocityMarkers();
  renderTempoMarkers();
  renderTechniqueMenu();
  renderInspectorTechniques();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();
  renderOutputs();

}


/* 칩을 눌러 트랙을 켜고 끈다.
   끈 트랙은 아래 출력 줄과 피아노롤에서 같이 빠진다. 노트는 그대로 남는다. */
function toggleTrackSelected(index){

  const track =
    tracks[index];

  if(!track){
    return;
  }

  track.selected =
    !track.selected;

  if(track.selected){

    selectedTrack = index;
    selectedNote = null;
    selectedMarker = null;

  }else{

    ensureFocusedTrack();

  }

  refreshAll();

}


function renderTracks(){

  rail
    .querySelectorAll(".inst, .rail-empty, .rail-note")
    .forEach(
      el=>el.remove()
    );

  if(!tracks.length){

    const hint =
      document.createElement(
        "p"
      );

    hint.className =
      "rail-empty";

    hint.textContent =
      "midi 파일을 불러오거나, 아래에서 악기를 골라 트랙을 만드세요.";

    rail.insertBefore(
      hint,
      trackAddButton
    );

    return;

  }

  tracks.forEach(
    (track,index)=>{

      const color =
        trackColor(index);

      const inst =
        document.createElement(
          "div"
        );

      inst.className =
        "inst" +
        (
          track.selected
            ? " on"
            : " off"
        ) +
        (
          index === selectedTrack &&
          track.selected
            ? " track-selected"
            : ""
        );

      /* 칩 테두리 색이 곧 피아노롤에서 이 트랙 노트의 색이다 */
      inst.style.setProperty(
        "--track-a",
        color.a
      );

      inst.style.setProperty(
        "--track-b",
        color.b
      );

      const body =
        document.createElement(
          "div"
        );

      body.className =
        "inst-body";

      const text =
        document.createElement(
          "span"
        );

      text.className =
        "inst-text";

      /* 윗줄: 미디에 적혀 있던 악기 이름 그대로 */
      const name =
        document.createElement(
          "span"
        );

      name.className =
        "inst-name";

      name.textContent =
        track.midiName || track.name;

      name.title =
        track.midiName || track.name;

      /* 아랫줄: 어느 파트였는지 + 게임에서 쓸 악기 */
      const sub =
        document.createElement(
          "span"
        );

      sub.className =
        "inst-sub";

      sub.textContent =
        (
          track.label
            ? track.label + " · "
            : ""
        ) +
        "\u2192 " +
        getBaseInstrument(track.name);

      text.appendChild(name);
      text.appendChild(sub);

      /* 아르미스 악기를 바꾸는 버튼. 칩 본체를 누르는 것과 구분해야
         선택 토글과 악기 변경이 섞이지 않는다. */
      const swap =
        document.createElement(
          "button"
        );

      swap.type =
        "button";

      swap.className =
        "inst-swap";

      swap.dataset.icon =
        "instrument";

      swap.title =
        "아르미스 악기 바꾸기";

      swap.textContent =
        "\u2699";

      swap.addEventListener(
        "click",
        event=>{

          event.stopPropagation();

          selectedTrack = index;
          selectedNote = null;
          selectedMarker = null;

          renderTracks();

          const current =
            rail.querySelectorAll(".inst")[index];

          if(!current){
            return;
          }

          openInstrumentMenuForTrack({

            stopPropagation(){},

            currentTarget:
              current.querySelector(".inst-swap")

          });

        }
      );

      body.appendChild(text);
      body.appendChild(swap);
      inst.appendChild(body);

      inst.addEventListener(
        "click",
        event=>{

          event.stopPropagation();

          /* 이미 켜져 있고 편집 대상도 아니면, 먼저 편집 대상으로만 옮긴다.
             한 번 더 누르면 그때 꺼진다. 실수로 꺼 버리는 일을 줄인다. */
          if(
            track.selected &&
            index !== selectedTrack
          ){

            focusTrack(index);
            refreshAll();

            return;

          }

          toggleTrackSelected(index);

        }
      );

      rail.insertBefore(
        inst,
        trackAddButton
      );

    }
  );

}


function closeTechMenu(){

  techMenu.classList.remove(
    "show"
  );

}


function closeInstrumentMenu(){

  instrumentMenu.classList.remove(
    "show"
  );

}


function closeMenus(){

  closeTechMenu();
  closeInstrumentMenu();
  closeMarkerMenu();

}


document.addEventListener(
  "click",
  event=>{

    if(
      !event.target.closest(
        "#techMenu"
      ) &&
      !event.target.closest(
        '[data-icon="technique"]'
      )
    ){

      closeTechMenu();

    }

    if(
      !event.target.closest("#markerMenu") &&
      !event.target.closest(".marker")
    ){

      closeMarkerMenu();

    }

    if(
      !event.target.closest(
        "#instrumentMenu"
      ) &&
      !event.target.closest(
        ".inst-swap"
      ) &&
      !event.target.closest(
        '[data-icon="track-add"]'
      )
    ){

      closeInstrumentMenu();

    }

  }
);


techButton.addEventListener(
  "click",
  event=>{

    event.stopPropagation();

    closeInstrumentMenu();

    renderTechniqueMenu();

    const rect =
      techButton
        .getBoundingClientRect();

    techMenu.style.left =
      rect.left + "px";

    techMenu.style.top =
      rect.bottom + 6 + "px";

    techMenu.classList.toggle(
      "show"
    );

  }
);


document
  .querySelector(
    '[data-icon="undo"]'
  )
  .addEventListener(
    "click",
    undo
  );


document
  .querySelector(
    '[data-icon="redo"]'
  )
  .addEventListener(
    "click",
    redo
  );


document.addEventListener(
  "keydown",
  event=>{

    /* 글자를 치고 있는 중이면 편집 단축키는 쉰다 */
    const typing =
      event.target &&
      (
        event.target.tagName === "INPUT" ||
        event.target.tagName === "TEXTAREA"
      );

    if(
      typing &&
      event.key !== "Escape"
    ){

      return;

    }

    /* 확인 창이 떠 있으면 그쪽이 먼저다 */
    if(dialogResolve){

      if(event.key === "Escape"){

        event.preventDefault();

        closeDialog(false);

      }

      return;

    }

    if(
      (event.ctrlKey ||
       event.metaKey) &&
      event.key.toLowerCase() === "z" &&
      !event.shiftKey
    ){

      event.preventDefault();

      undo();

      return;

    }

    if(
      (event.ctrlKey ||
       event.metaKey) &&
      (
        (
          event.key.toLowerCase() === "z" &&
          event.shiftKey
        ) ||
        event.key.toLowerCase() === "y"
      )
    ){

      event.preventDefault();

      redo();

      return;

    }

    if(event.key === "Escape"){

      if(ghost){

        const wasMove =
          ghost.fromMove;

        cancelGhost();

        showToast(
          wasMove
            ? "제자리로 되돌렸습니다."
            : "놓기를 그만뒀습니다."
        );

        return;

      }

      if(pickMode){

        setPickMode(false);

        return;

      }

    }

    if(
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "c"
    ){

      event.preventDefault();

      copyNotesButton.click();

      return;

    }

    if(
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "v"
    ){

      event.preventDefault();

      pasteNotesButton.click();

      return;

    }

    if(
      event.key === "Delete"
    ){

      if(
        selectedMarker ||
        selectedNote !== null ||
        multiSelection.size ||
        ghost
      ){

        noteDeleteButton.click();

      }

    }

  }
);


window.addEventListener(
  "resize",
  closeMenus
);


/* ============================================================
   편집기 노트 → 실제 아르미스 MML
   ============================================================
   변환 엔진의 buildEvents / eventsToMml을 그대로 쓴다.
   MML을 여기서 따로 조립하면 엔진과 규칙이 어긋나므로 절대 그러지 않는다.

   엔진이 기대하는 모양으로 맞춰 주는 것이 이 코드의 일이다.
     · 화면 좌표(row, bar) → 건반 번호와 tick
     · 같은 자리에서 시작하는 음들을 화음 그룹으로 묶기
     · 노트에 붙인 기법을 { code, place } 형태로
   자동 기법 판정(악센트·레가토 등)은 넘기지 않는다. 편집기에서는
   사용자가 직접 고른 기법만 나가야 한다.
   ============================================================ */

/* 마디 단위 위치를 엔진의 tick으로. 한 마디가 온음표(WHOLE)다. */
function barToTick(bar){

  return Math.round(
    bar * WHOLE
  );

}


function noteToEngineNote(
  track,
  note
){

  normalizeNote(note);

  const key =
    clampKey(
      rowToKey(note.row)
    );

  const start =
    barToTick(note.bar);

  return {

    key,

    pitch:
      keyToPitchClass(key),

    octave:
      keyToOctave(key),

    velocity:
      noteVelocity(track, note),

    start,

    end:
      start +
      Math.max(
        MIN_TICK,
        barToTick(note.len)
      )

  };

}


/* 노트에 붙은 기법을 엔진이 읽는 형태로.
   place는 표기 위치다. *N은 음표 뒤(post), [N]은 구간 토글(range). */
function noteTechniques(note){

  return (note.techs || []).map(
    tech=>({

      code:
        tech.code,

      place:
        tech.code.charAt(0) === "["
          ? "range"
          : "post"

    })
  );

}


function buildTrackGroups(track){

  const items =
    track.notes.map(
      note=>({

        note,

        engine:
          noteToEngineNote(
            track,
            note
          )

      })
    );

  items.sort(
    (a,b)=>
      (a.engine.start - b.engine.start) ||
      (a.engine.key - b.engine.key)
  );

  const groups = [];

  for(const item of items){

    const last =
      groups[groups.length - 1];

    /* 1/64음표보다 가깝게 시작하는 음들은 한 화음으로 본다.
       엔진의 makeGroups와 같은 기준이다. */
    if(
      last &&
      item.engine.start - last.start < MIN_TICK
    ){

      last.notes.push(
        item.engine
      );

      for(
        const tech
        of noteTechniques(item.note)
      ){

        if(
          !last.techniques.some(
            t=>t.code === tech.code
          )
        ){

          last.techniques.push(tech);

        }

      }

    }else{

      groups.push({

        start:
          item.engine.start,

        notes:
          [item.engine],

        techniques:
          noteTechniques(item.note),

        /* 타이를 판단하려면 원래 노트를 알아야 한다 */
        source:
          item.note

      });

    }

  }

  for(const g of groups){

    g.notes.sort(
      (a,b)=>a.key-b.key
    );

    /* 그룹이 커서를 미는 양은 가장 길게 울리는 구성음이 정한다 */
    g.fullDur =
      Math.max(
        MIN_TICK,
        Math.max(
          ...g.notes.map(
            n=>n.end - g.start
          )
        )
      );

  }

  /* 타이 — 앞 음이 뒤 음과 이어지면 그 묶음 앞에 & 를 찍는다.
     엔진의 buildEvents가 g.tied를 보고 Tie 이벤트를 낸다.

     화음은 이어 붙일 수 없다. c4:e4 뒤에 &를 붙이면 어느 음이 이어지는지
     MML로 적을 방법이 없다. 그래서 앞뒤 모두 홑음일 때만 잇는다. */
  for(
    let i = 0;
    i + 1 < groups.length;
    i++
  ){

    const a = groups[i];
    const b = groups[i + 1];

    /* 앞은 반드시 홑음이어야 한다. c4:e4 뒤에 &를 붙이면
       어느 음이 이어지는지 적을 방법이 없다. */
    if(a.notes.length !== 1){
      continue;
    }

    /* 뒤는 화음이어도 된다. c1&c1:d1:e4 처럼 이어받는 음이 화음의
       첫 구성음이면 &가 그 음에 붙는다. 다만 구성음 세기가 제각각이면
       엔진이 v를 아끼려고 순서를 바꿔 &가 엉뚱한 음에 붙을 수 있으니
       그때는 잇지 않는다. */
    const sameVelocity =
      b.notes.every(
        n=>n.velocity === b.notes[0].velocity
      );

    if(
      b.notes.length > 1 &&
      !sameVelocity
    ){

      continue;

    }

    if(
      a.source &&
      a.source.tie &&
      a.notes[0].key === b.notes[0].key &&
      Math.abs(
        (a.start + a.fullDur) - b.start
      ) < 1
    ){

      b.tied = true;

      /* 사이에 t나 v가 끼면 양쪽에 &가 있어야 이어진 음으로 읽힌다
         (c4&t140&c8). 아무것도 안 끼면 &가 둘 남는데, 그건 아래에서 지운다. */
      a.continues = true;

    }

  }

  return groups;

}


function generateTrackMML(track){

  if(
    !track ||
    !Array.isArray(track.notes) ||
    !track.notes.length
  ){

    return "";

  }

  normalizeTies(track);

  const groups =
    buildTrackGroups(track);

  if(!groups.length){
    return "";
  }

  const tempos =
    (track.tempoMarkers || [])
      .map(
        marker=>({

          pos:
            barToTick(marker.bar),

          bpm:
            clampTempo(marker.tempo)

        })
      )
      .sort(
        (a,b)=>a.pos-b.pos
      );

  if(
    !tempos.length ||
    tempos[0].pos > 0
  ){

    tempos.unshift({
      pos:0,
      bpm:tempo
    });

  }

  /* 자동 기법은 전부 끈다. 편집기에서는 손으로 고른 것만 나간다. */
  const techs = {
    staccato:null,
    accent:null,
    vibrato:null,
    graceUp:null,
    graceDown:null,
    legato:null,
    mods:[]
  };

  try{

    const events =
      buildEvents(
        groups,
        tempos,
        getBaseInstrument(track.name),
        techs
      );

    /* & 가 연달아 나오면 하나로 줄인다.
       앞 음의 "뒤로 이어짐"과 뒤 음의 "앞에서 이어옴"이 겹친 자리인데,
       사이에 t나 v가 끼지 않았다면 하나면 된다. */
    const tidy =
      events.filter(
        (e,i)=>
          !(
            e.type === "Tie" &&
            events[i - 1] &&
            events[i - 1].type === "Tie"
          )
      );

    return eventsToMml(tidy);

  }catch(error){

    console.error(error);

    return "";

  }

}


/* ============================================================
   여러 개 고르기 · 복사 · 붙여넣기 · 반투명 배치
   ============================================================
   새 노트는 곧바로 놓이지 않는다. 화면 한가운데에 반투명하게 떠 있다가,
   사용자가 끌어다 놓으면 그때 자리를 잡는다. 놓을 수 없는 자리면
   손을 놓아도 계속 떠 있고 다시 끌 수 있다.

   + 버튼과 붙여넣기가 같은 길을 쓴다. 다른 건 떠 있는 노트가
   한 개냐 여러 개냐 뿐이다.
   ============================================================ */

let pickMode = false;              // 여러 개 고르기 켜짐
let multiSelection = new Set();    // 고른 노트 번호 (지금 편집 중인 트랙 기준)
let clipboard = [];                // 복사해 둔 노트
let ghost = null;                  // 아직 자리를 안 정한 노트들


function clearMultiSelection(){

  if(!multiSelection.size){
    return false;
  }

  multiSelection.clear();

  return true;

}


function setPickMode(on){

  pickMode = on;

  selectModeButton.classList.toggle(
    "on",
    on
  );

  grid.classList.toggle(
    "picking",
    on
  );

  if(!on){

    cancelMarquee();

    clearMultiSelection();

    renderNotes();

  }

}


selectModeButton.addEventListener(
  "click",
  ()=>{
    setPickMode(!pickMode);
  }
);


/* ── 끌어서 감싸 고르기 ─────────────────────────────── */
let marquee = null;


/* 그리던 사각형을 지운다. 노트를 끌기 시작할 때처럼
   다른 동작이 끼어들면 즉시 걷어야 한다. */
function cancelMarquee(){

  if(!marquee){
    return;
  }

  window.removeEventListener(
    "pointermove",
    marquee.onMove
  );

  window.removeEventListener(
    "pointerup",
    marquee.onUp
  );

  /* 아직 처리하지 않은 프레임이 남아 있으면 걷는다.
     사각형이 사라진 뒤에 뒤늦게 계산이 도는 것을 막는다. */
  if(marquee.cancelFrame){

    marquee.cancelFrame();

  }

  marquee.box.remove();

  marquee = null;

}


grid.addEventListener(
  "pointerdown",
  event=>{

    if(!pickMode){
      return;
    }

    /* 반투명 노트를 놓는 중이거나 노트를 끄는 중이면 사각형을 그리지 않는다.
       붙여넣기·새 노트·이동·길이 조절은 전부 "이미 뭔가를 끌고 있는" 상태라
       거기에 선택 사각형까지 겹쳐 나오면 화면이 어지럽다. */
    if(ghost || pointerState){
      return;
    }

    if(
      event.target.closest(".note") ||
      event.target.closest(".oct-scale")
    ){

      return;

    }

    const track =
      tracks[selectedTrack];

    if(!track){
      return;
    }

    event.preventDefault();

    cancelMarquee();

    const rect =
      grid.getBoundingClientRect();

    const box =
      document.createElement("div");

    box.className =
      "marquee";

    grid.appendChild(box);

    const x0 =
      event.clientX - rect.left;

    const y0 =
      event.clientY - rect.top;

    const draw = (x, y)=>{

      const left = Math.min(x0, x);
      const top = Math.min(y0, y);

      box.style.left = left + "px";
      box.style.top = top + "px";
      box.style.width = Math.abs(x - x0) + "px";
      box.style.height = Math.abs(y - y0) + "px";

      return {
        left,
        top,
        right: Math.max(x0, x),
        bottom: Math.max(y0, y)
      };

    };

    /* Ctrl(⌘)이나 Shift를 누른 채 감싸면 이미 고른 것에 더한다 */
    const keep =
      (event.ctrlKey || event.metaKey || event.shiftKey)
        ? [...multiSelection]
        : [];

    /* 끄는 동안 노트는 움직이지 않으므로 자리를 여기서 한 번만 재 둔다.
       예전에는 마우스가 움직일 때마다 전 노트를 다시 훑고 normalizeNote까지
       불러서, 노트가 많은 곡에서는 사각형이 손을 못 따라왔다. */
    const boxes =
      track.notes.map(
        (note,index)=>{

          normalizeNote(note);

          const left = note.bar * BAR_W;
          const top = note.row * ROW_H;

          return {
            index,
            left,
            right: left + note.len * BAR_W,
            top,
            bottom: top + ROW_H
          };

        }
      );

    /* 표시를 바꿀 요소도 미리 받아 둔다 */
    const noteEls =
      grid.querySelectorAll(".note");

    let lastX = x0;
    let lastY = y0;
    let frame = 0;

    /* 실제 계산은 화면이 한 장 그려질 때마다 한 번만 한다.
       pointermove는 1초에 100번 넘게 들어오는데 그때마다 계산하면
       쓸데없이 같은 일을 서너 번씩 반복하게 된다. */
    const apply = ()=>{

      frame = 0;

      const area =
        draw(lastX, lastY);

      /* 사각형에 조금이라도 걸치는 노트를 모두 고른다 */
      multiSelection.clear();

      for(const index of keep){
        multiSelection.add(index);
      }

      for(const b of boxes){

        if(
          b.right >= area.left &&
          b.left <= area.right &&
          b.bottom >= area.top &&
          b.top <= area.bottom
        ){

          multiSelection.add(b.index);

        }

      }

      refreshNoteSelection(noteEls);

    };

    const onMove = e=>{

      lastX = e.clientX - rect.left;
      lastY = e.clientY - rect.top;

      if(!frame){

        frame =
          requestAnimationFrame(apply);

      }

    };

    const onUp = ()=>{

      if(frame){

        cancelAnimationFrame(frame);

        apply();

      }

      const picked =
        multiSelection.size;

      cancelMarquee();

      /* 손을 놓을 때 한 번만 제대로 다시 그린다 */
      renderNotes();

      showToast(
        picked
          ? picked + "개 골랐습니다."
          : "고른 노트가 없습니다."
      );

    };

    marquee = {
      box,
      onMove,
      onUp,
      cancelFrame: ()=>{

        if(frame){

          cancelAnimationFrame(frame);

          frame = 0;

        }

      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

  }
);


/* ── 복사 ───────────────────────────────────────────── */
function notesToCopy(){

  const track =
    tracks[selectedTrack];

  if(!track){
    return [];
  }

  const indexes =
    multiSelection.size
      ? [...multiSelection]
      : (
          selectedNote === null
            ? []
            : [selectedNote]
        );

  return indexes
    .map(i=>track.notes[i])
    .filter(Boolean);

}


copyNotesButton.addEventListener(
  "click",
  ()=>{

    const picked =
      notesToCopy();

    if(!picked.length){

      showToast(
        "복사할 노트를 먼저 고르세요."
      );

      return;

    }

    /* 맨 앞·맨 위를 기준으로 상대 위치만 저장한다.
       붙여넣을 때 통째로 옮기려면 서로의 간격만 있으면 된다. */
    const baseBar =
      Math.min(
        ...picked.map(n=>n.bar)
      );

    const baseRow =
      Math.min(
        ...picked.map(n=>n.row)
      );

    clipboard =
      picked.map(
        n=>({

          barOffset:
            n.bar - baseBar,

          rowOffset:
            n.row - baseRow,

          len:
            n.len,

          techs:
            n.techs.map(
              t=>({ ...t })
            )

        })
      );

    showToast(
      clipboard.length + "개 복사했습니다."
    );

  }
);


/* ── 반투명 노트 ────────────────────────────────────── */

/* 지금 화면 한가운데가 몇 마디, 몇 번째 줄인지 */
function viewCenter(){

  const bar =
    Math.max(
      0,
      Math.round(
        (
          (
            board.scrollLeft +
            board.clientWidth / 2
          ) / BAR_W
        ) / SNAP
      ) * SNAP
    );

  const row =
    Math.max(
      0,
      Math.min(
        OCT_COUNT * 12 - 1,
        Math.round(
          (
            board.scrollTop +
            board.clientHeight / 2
          ) / ROW_H
        )
      )
    );

  return { bar, row };

}


function startGhost(
  items,
  options
){

  if(!tracks[selectedTrack]){

    showToast(
      "먼저 트랙을 고르세요."
    );

    return;

  }

  cancelMarquee();

  const settings =
    options || {};

  const at =
    Number.isFinite(settings.bar)
      ? settings
      : viewCenter();

  ghost = {

    bar:
      at.bar,

    row:
      at.row,

    items,

    /* 옮기는 중이면 집어 든 자리를 기억한다.
       Esc로 그만두면 원래 자리에 도로 놓아야 하기 때문이다. */
    fromMove:
      !!settings.fromMove,

    origin:
      {
        bar: at.bar,
        row: at.row
      }

  };

  renderGhost();

  if(!settings.quiet){

    showToast(
      "끌어서 자리를 잡고 손을 놓으세요."
    );

  }

}


/* 띄운 것을 물린다. 옮기던 중이면 원래 자리에 도로 놓는다. */
function cancelGhost(){

  if(!ghost){
    return;
  }

  if(ghost.fromMove){

    ghost.bar = ghost.origin.bar;
    ghost.row = ghost.origin.row;

    commitGhost();

    return;

  }

  ghost = null;

  endGhostDrag();

  renderGhost();

}


/* 띄운 것을 완전히 버린다. 원래 자리로 돌려놓지 않는다.
   판이 통째로 바뀌거나(되돌리기·다시하기) 사용자가 직접 지울 때 쓴다. */
function discardGhost(){

  if(!ghost){
    return;
  }

  ghost = null;

  endGhostDrag();

  renderGhost();

}


function ghostNoteAt(item){

  return {

    bar:
      ghost.bar + item.barOffset,

    row:
      ghost.row + item.rowOffset,

    len:
      item.len,

    techs:
      item.techs

  };

}


/* 지금 자리에 그대로 놓을 수 있는가 */
function ghostFits(){

  const track =
    tracks[selectedTrack];

  if(!track || !ghost){
    return false;
  }

  const spans =
    noteSpans(track, null);

  for(const item of ghost.items){

    const note =
      ghostNoteAt(item);

    if(
      note.bar < -BAR_EPS ||
      note.row < 0 ||
      note.row >= OCT_COUNT * 12 ||
      note.bar + note.len > BARS + BAR_EPS
    ){

      return false;

    }

    if(
      !fitsSpans(
        spans,
        note.bar,
        note.len
      )
    ){

      return false;

    }

  }

  return true;

}


function renderGhost(){

  grid
    .querySelectorAll(".note.ghost")
    .forEach(
      el=>el.remove()
    );

  if(!ghost){
    return;
  }

  const color =
    trackColor(selectedTrack);

  const blocked =
    !ghostFits();

  for(const item of ghost.items){

    const note =
      ghostNoteAt(item);

    const el =
      document.createElement("div");

    el.className =
      "note ghost" +
      (blocked ? " blocked" : "");

    el.style.setProperty("--note-a", color.a);
    el.style.setProperty("--note-b", color.b);

    el.style.left =
      (note.bar * BAR_W) + "px";

    el.style.width =
      Math.max(
        8,
        note.len * BAR_W
      ) + "px";

    el.style.top =
      (note.row * ROW_H + 1) + "px";

    el.addEventListener(
      "pointerdown",
      startGhostDrag
    );

    grid.appendChild(el);

  }

}


/* 지금 붙어 있는 반투명 노트 드래그.
   Esc처럼 도중에 끝나는 경우가 있어 손잡이를 들고 있다가 확실히 떼어낸다. */
let ghostDrag = null;


function endGhostDrag(){

  if(!ghostDrag){
    return;
  }

  window.removeEventListener(
    "pointermove",
    ghostDrag.onMove
  );

  window.removeEventListener(
    "pointerup",
    ghostDrag.onUp
  );

  ghostDrag = null;

}


function startGhostDrag(event){

  if(!ghost || event.button !== 0){
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  cancelMarquee();
  endGhostDrag();

  const startX = event.clientX;
  const startY = event.clientY;
  const startBar = ghost.bar;
  const startRow = ghost.row;

  const onMove = e=>{

    /* Esc 등으로 이미 놓였으면 더 끌 것이 없다 */
    if(!ghost){

      endGhostDrag();

      return;

    }

    ghost.bar =
      Math.max(
        0,
        Math.round(
          (
            startBar +
            (e.clientX - startX) / BAR_W
          ) / SNAP
        ) * SNAP
      );

    ghost.row =
      Math.max(
        0,
        Math.min(
          OCT_COUNT * 12 - 1,
          startRow +
          Math.round(
            (e.clientY - startY) / ROW_H
          )
        )
      );

    renderGhost();

  };

  const onUp = ()=>{

    endGhostDrag();

    commitGhost();

  };

  ghostDrag = { onMove, onUp };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

}


/* 손을 놓았을 때. 놓을 수 있으면 자리를 잡고, 아니면 계속 떠 있는다. */
function commitGhost(){

  if(!ghost){
    return;
  }

  if(!ghostFits()){

    showToast(
      "여기에는 놓을 수 없습니다. 다시 끌어 옮기세요."
    );

    renderGhost();

    return;

  }

  const track =
    tracks[selectedTrack];

  /* 옮기는 중이라면 집어 들 때 이미 기록을 쌓았다 */
  if(!ghost.fromMove){

    saveHistory();

  }

  const added = [];

  for(const item of ghost.items){

    const placed =
      ghostNoteAt(item);

    const note = {

      row:
        placed.row,

      bar:
        placed.bar,

      len:
        placed.len,

      lengthBase:null,
      dotted:false,

      techs:
        (placed.techs || []).map(
          t=>({ ...t })
        ),

      vel:
        item.vel === undefined
          ? null
          : item.vel,

      tie:
        !!item.tie

    };

    normalizeNote(note);

    track.notes.push(note);

    added.push(
      track.notes.length - 1
    );

  }

  ghost = null;

  endGhostDrag();

  clearMultiSelection();

  for(const index of added){
    multiSelection.add(index);
  }

  selectedNote =
    added[added.length - 1];

  selectedMarker = null;

  ensureBars(
    songEndBar(tracks)
  );

  renderGhost();
  renderNotes();
  renderInspectorTechniques();
  renderTechniqueMenu();
  updateLengthButtons();
  updateVelocityUI();
  updateTempoUI();
  renderOutputs();

}


pasteNotesButton.addEventListener(
  "click",
  ()=>{

    if(!clipboard.length){

      showToast(
        "복사해 둔 노트가 없습니다."
      );

      return;

    }

    startGhost(
      clipboard.map(
        item=>({ ...item })
      )
    );

  }
);


/* ============================================================
   MML 글자 → 편집기 노트
   ============================================================
   아래 트랙 칸에 직접 쳐 넣은 MML을 읽어 화면 위 노트로 되돌린다.
   generateTrackMML()의 반대 방향이고, 그쪽이 내는 글자는 전부 읽을 수 있다.

   읽는 것
     t###   템포 마커        v##  음량 마커
     o#     옥타브           l##  기본 길이 (l 최적화를 켠 MML도 읽을 수 있게)
     c d e f g a b (+ - #)   음표      r  쉼표
     &      앞 음과 이어 붙이기 (길이를 더한다)
     :      앞 음과 같은 자리에서 시작 (화음)
     *N     그 음 하나에 걸리는 기법
     [N]    구간 기법. 여는 [N]과 닫는 [N] 사이의 음 전부에 걸린다

   커서는 묶음이 끝날 때 "가장 긴 구성음"만큼 전진한다. 게임에서 다음 음이
   시작하는 자리를 정하는 것이 그 음이기 때문이다.
   ============================================================ */

/* 길이 토큰(숫자 + 점)을 tick으로. 숫자가 없으면 기본 길이(l)를 쓴다. */
function readLengthTicks(
  src,
  at,
  defaultTicks
){

  let i = at;

  let digits = "";

  while(
    i < src.length &&
    src[i] >= "0" &&
    src[i] <= "9"
  ){

    digits += src[i++];

  }

  let dots = 0;

  while(
    i < src.length &&
    src[i] === "."
  ){

    dots++;
    i++;

  }

  let ticks;

  if(digits === ""){

    ticks = defaultTicks;

  }else{

    const n = Number(digits);

    if(!n){

      throw new Error(
        "길이 " + digits + " 는 쓸 수 없습니다."
      );

    }

    ticks = WHOLE / n;

  }

  /* 점 하나는 1.5배, 둘이면 1.75배 */
  let extra = ticks / 2;

  for(
    let k=0;
    k<dots;
    k++
  ){

    ticks += extra;
    extra /= 2;

  }

  return {

    ticks:
      Math.round(ticks),

    next:
      i

  };

}


function readNumber(
  src,
  at
){

  let i = at;

  let digits = "";

  while(
    i < src.length &&
    src[i] >= "0" &&
    src[i] <= "9"
  ){

    digits += src[i++];

  }

  if(digits === ""){

    throw new Error(
      (at + 1) + "번째 글자 뒤에 숫자가 없습니다."
    );

  }

  return {

    value:
      Number(digits),

    next:
      i

  };

}


const PITCH_STEP = {
  c:0, d:2, e:4, f:5, g:7, a:9, b:11
};


/* MML 한 줄을 묶음 목록으로. 실패하면 예외를 던진다. */
function parseMml(text){

  const src =
    String(text).replace(/\s+/g, "");

  const groups = [];
  const tempos = [];
  const velocities = [];

  let cursor = 0;
  let octave = 4;
  let velocity = 12;
  let defaultTicks = WHOLE / 4;

  let group = null;       // 지금 쌓고 있는 묶음
  let chord = false;      // 바로 앞에 : 가 있었나
  let tie = false;        // 바로 앞에 & 가 있었나

  const openRanges = [];  // 열려 있는 [N]

  /* t와 v는 읽은 그 자리에 찍으면 안 된다.
       ...b4 o5c4 t150 r1...     t150은 c4 "뒤"에 온다
       ...c4 : v13 e4...          v13은 화음 구성음이라 c4와 "같은" 자리다
     둘을 구분하려면 다음에 오는 음이나 쉼표가 어디서 시작하는지 봐야 한다.
     그래서 일단 들고 있다가, 다음 음의 자리가 정해질 때 함께 찍는다. */
  const pending = [];

  const flushPending = pos=>{

    for(const item of pending){

      if(item.kind === "t"){

        tempos.push({
          tick: pos,
          tempo: item.value
        });

      }else{

        velocities.push({
          tick: pos,
          velocity: item.value
        });

      }

    }

    pending.length = 0;

  };

  /* 묶음을 닫고 커서를 가장 긴 구성음만큼 전진시킨다 */
  const closeGroup = ()=>{

    if(!group){
      return;
    }

    cursor =
      group.start +
      Math.max(
        ...group.notes.map(
          n=>n.ticks
        )
      );

    groups.push(group);

    group = null;

  };

  let i = 0;

  while(i < src.length){

    const ch =
      src[i].toLowerCase();

    /* ── 화음 / 이어붙이기 ── */
    if(ch === ":"){
      chord = true; i++; continue;
    }

    if(ch === "&"){
      tie = true; i++; continue;
    }

    /* ── 구간 기법 ── */
    if(ch === "["){

      const close =
        src.indexOf("]", i);

      if(close < 0){

        throw new Error(
          "닫히지 않은 [ 가 있습니다."
        );

      }

      const code =
        src.slice(i, close + 1);

      const at =
        openRanges.indexOf(code);

      if(at >= 0){

        openRanges.splice(at, 1);

      }else{

        openRanges.push(code);

      }

      i = close + 1;
      continue;

    }

    /* ── 그 음 하나에 걸리는 기법 ── */
    if(ch === "*"){

      const num =
        readNumber(src, i + 1);

      const code =
        "*" + num.value;

      const last =
        group &&
        group.notes[group.notes.length - 1];

      if(last){

        last.codes.push(code);

      }

      i = num.next;
      continue;

    }

    /* ── 명령 ── */
    if(ch === "t"){

      const num = readNumber(src, i + 1);

      pending.push({
        kind:"t",
        value:num.value
      });

      i = num.next;
      continue;

    }

    if(ch === "v"){

      const num = readNumber(src, i + 1);

      velocity = num.value;

      pending.push({
        kind:"v",
        value:num.value
      });

      i = num.next;
      continue;

    }

    if(ch === "o"){

      const num = readNumber(src, i + 1);

      octave = num.value;

      i = num.next;
      continue;

    }

    if(ch === "l"){

      const len =
        readLengthTicks(
          src,
          i + 1,
          defaultTicks
        );

      defaultTicks = len.ticks;

      i = len.next;
      continue;

    }

    if(ch === ">"){
      octave++; i++; continue;
    }

    if(ch === "<"){
      octave--; i++; continue;
    }

    /* ── 쉼표 ── */
    if(ch === "r"){

      const len =
        readLengthTicks(
          src,
          i + 1,
          defaultTicks
        );

      closeGroup();

      flushPending(cursor);

      cursor += len.ticks;

      chord = false;
      tie = false;

      i = len.next;
      continue;

    }

    /* ── 음표 ── */
    if(PITCH_STEP[ch] !== undefined){

      let step =
        PITCH_STEP[ch];

      let j = i + 1;

      while(j < src.length){

        if(
          src[j] === "+" ||
          src[j] === "#"
        ){

          step++; j++;

        }else if(src[j] === "-"){

          step--; j++;

        }else{

          break;

        }

      }

      const len =
        readLengthTicks(
          src,
          j,
          defaultTicks
        );

      const key =
        (octave + 1) * 12 + step;

      const last =
        group &&
        group.notes[group.notes.length - 1];

      /* c4&c8 처럼 이어 붙인 것은 한 음의 길이를 더한 것이다 */
      if(
        tie &&
        last &&
        last.key === key
      ){

        /* & 는 두 가지로 쓰인다.
             c4&c8            두 음을 이어 한 소리로 (편집기의 이음줄)
             e4.&e16.:a4.     한 음이 토막 나서 이어 적힌 것 (180틱짜리 화음 구성음)
           둘 다 소리로는 "이어진 하나"라서 글자만 보고는 구분되지 않는다.
           그래서 여기서는 일단 길이를 합쳐 한 음으로 두고, 끊긴 자리만 적어 둔다.
           묶음이 다 읽히고 나면 그때 갈라 놓을지 정한다 —
           홑음이면 이음줄로 갈라 보여주고, 화음이면 한 음으로 남긴다. */
        flushPending(
          group.start + last.ticks
        );

        last.ticks += len.ticks;

        (
          last.splits ||
          (last.splits = [])
        ).push(len.ticks);

      }else if(chord && group){

        /* 화음 구성음 앞의 v는 그 음에만 걸린다. 자리 전체의 값이 아니므로
           마커로 내보내지 않고, 음이 들고 있는 velocity로만 남긴다.
           t는 자리 값이라 그대로 찍는다. */
        for(
          let k = pending.length - 1;
          k >= 0;
          k--
        ){

          if(pending[k].kind === "v"){

            pending.splice(k, 1);

          }

        }

        flushPending(group.start);

        group.notes.push({
          key,
          ticks: len.ticks,
          velocity,
          codes: openRanges.slice()
        });

      }else{

        closeGroup();

        flushPending(cursor);

        group = {

          start: cursor,

          notes: [{
            key,
            ticks: len.ticks,
            velocity,
            codes: openRanges.slice()
          }]

        };

      }

      chord = false;
      tie = false;

      i = len.next;
      continue;

    }

    throw new Error(
      (i + 1) + "번째 글자 '" +
      src[i] +
      "' 를 읽을 수 없습니다."
    );

  }

  closeGroup();

  /* 마지막 음 뒤에 남은 t/v는 곡 끝에 찍는다 */
  flushPending(cursor);

  if(openRanges.length){

    throw new Error(
      "구간 기법 " +
      openRanges.join(" ") +
      " 가 닫히지 않았습니다."
    );

  }

  return { groups, tempos, velocities };

}


/* 코드 목록을 그 악기가 아는 { role, code } 로. 모르는 코드는 버린다. */
function codesToTechsFor(
  instrumentName,
  codes
){

  const set =
    getTechniquesForInstrument(
      instrumentName
    );

  const out = [];

  for(const code of codes){

    const role =
      Object.keys(set).find(
        key=>set[key] === code
      );

    if(
      role &&
      !out.some(t=>t.role === role)
    ){

      out.push({ role, code });

    }

  }

  return out;

}


/* 같은 값이 이어지는 마커는 하나로 줄이고, 0마디에 하나는 반드시 둔다 */
function tidyMarkers(
  list,
  key,
  fallback
){

  const out = [];

  let last = null;

  for(
    const item
    of list.sort(
      (a,b)=>a.tick-b.tick
    )
  ){

    if(item[key] === last){
      continue;
    }

    out.push({

      bar:
        item.tick / WHOLE,

      [key]:
        item[key]

    });

    last = item[key];

  }

  if(
    !out.length ||
    out[0].bar > 0
  ){

    out.unshift({
      bar:0,
      [key]:
        out.length
          ? out[0][key]
          : fallback
    });

  }

  return out;

}


/* 트랙 칸에 쳐 넣은 MML을 그 트랙에 적용한다. 실패하면 예외를 던진다. */
function applyMmlToTrack(
  track,
  text
){

  const parsed =
    parseMml(text);

  const notes = [];

  parsed.groups.forEach(
    (g,index)=>{

      const next =
        parsed.groups[index + 1];

      /* 다음 묶음이 시작하기 전까지가 이 묶음이 쓸 수 있는 자리다 */
      const room =
        next
          ? (next.start - g.start) / WHOLE
          : Infinity;

      for(const n of g.notes){

        const row =
          keyToRow(
            clampKey(n.key)
          );

        if(
          row < 0 ||
          row >= OCT_COUNT * 12
        ){

          continue;

        }

        /* 홑음이고 & 로 끊겨 있었다면 그 자리에서 갈라 이음줄로 잇는다.
           화음 구성음은 갈라 놓을 수 없으므로(어느 음이 이어지는지 적을
           방법이 없다) 한 음으로 둔다. */
        const pieces =
          (
            g.notes.length === 1 &&
            n.splits &&
            n.splits.length
          )
            ? [
                n.ticks -
                n.splits.reduce((a,b)=>a+b,0)
              ].concat(n.splits)
            : [n.ticks];

        let at =
          g.start;

        pieces.forEach(
          (ticks,pieceIndex)=>{

            if(ticks <= 0){
              return;
            }

            const note = {

              row,

              bar:
                at / WHOLE,

              len:0,
              lengthBase:4,
              dotted:false,

              /* 기법을 조각에 나눠 붙인다.
                 *N은 그 음 하나에 걸리는 것이라 마지막 조각에만 붙여야
                 원래처럼 d2&d32*13 로 나온다.
                 [N]은 구간이라 모든 조각이 들고 있어야 앞뒤를 제대로 감싼다. */
              techs:
                codesToTechsFor(
                  track.name,
                  (n.codes || []).filter(
                    code =>
                      code.charAt(0) === "[" ||
                      pieceIndex === pieces.length - 1
                  )
                ),

              /* 묶음 첫 음과 세기가 다르면 이 음만의 값으로 들고 간다 */
              vel:
                n.velocity === g.notes[0].velocity
                  ? null
                  : n.velocity,

              /* 마지막 토막을 뺀 나머지는 뒤로 이어진다 */
              tie:
                pieceIndex < pieces.length - 1

            };

            applyResizedLength(
              note,
              ticks / WHOLE,
              Infinity
            );

            notes.push(note);

            at += ticks;

          }
        );

      }

    }
  );

  track.notes = notes;

  /* 음량 마커는 v 명령이 아니라 "각 묶음이 시작할 때의 세기"에서 만든다.

     c8:e8:g8:o5v13c8 처럼 화음 한가운데에 v가 들어오면, 그건 그 구성음
     하나에만 걸리는 값이지 그 자리 전체의 값이 아니다. v를 그대로 마커로
     옮기면 화음 전체가 v13이 되어 아랫음들이 커진다.
     묶음의 첫 음 세기만 마커로 삼고, 나머지는 음 자체에 적어 둔다. */
  track.velocityMarkers =
    tidyMarkers(
      parsed.groups.map(
        g=>({
          tick: g.start,
          velocity: g.notes[0].velocity
        })
      ),
      "velocity",
      12
    );

  track.tempoMarkers =
    tidyMarkers(
      parsed.tempos,
      "tempo",
      tempo
    );

  normalizeAllNotes();

}


/* 드래그 중에는 MML을 매 프레임 다시 만들면 버벅인다.
   화면은 바로 움직이되 글자는 한 박자 늦게 따라오게 미뤄 둔다. */
let outputTimer = null;

function scheduleOutputs(){

  if(outputTimer !== null){
    return;
  }

  outputTimer =
    setTimeout(
      ()=>{

        outputTimer = null;

        renderOutputs();

      },
      90
    );

}


function renderOutputs(){

  if(outputTimer !== null){

    clearTimeout(outputTimer);

    outputTimer = null;

  }


  output.innerHTML =
    "";

  /* 트랙이 없으면 칸이 통째로 비어 고장난 것처럼 보인다.
     무엇을 하면 되는지 한 줄 남긴다. */
  if(!tracks.length){

    const hint =
      document.createElement(
        "p"
      );

    hint.className =
      "out-empty";

    hint.textContent =
      "midi 파일을 불러오거나 트랙을 추가하면 MML이 여기에 나옵니다.";

    output.appendChild(hint);

    return;

  }

  const shown =
    tracks
      .map((track,index)=>({ track, index }))
      .filter(item=>item.track.selected);

  if(!shown.length){

    const hint =
      document.createElement(
        "p"
      );

    hint.className =
      "out-empty";

    hint.textContent =
      "왼쪽에서 트랙을 고르면 MML이 여기에 나옵니다.";

    output.appendChild(hint);

    return;

  }

  shown.forEach(
    ({ track, index })=>{

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "out-row";

      /* 색 점 하나로 왼쪽 칩·피아노롤 노트와 같은 트랙임을 알린다 */
      const dot =
        document.createElement(
          "span"
        );

      dot.className =
        "out-dot";

      dot.style.background =
        "linear-gradient(140deg," +
        trackColor(index).b + "," +
        trackColor(index).a + ")";

      row.appendChild(dot);

      const name =
        document.createElement(
          "span"
        );

      name.className =
        "out-name";

      name.textContent =
        getInstrumentDisplayName(
          track.name,
          index
        );

      name.title =
        track.midiName || "";

      const field =
        document.createElement(
          "input"
        );

      field.className =
        "out-field";

      field.spellcheck =
        false;

      field.value =
        generateTrackMML(
          track
        );

      field.placeholder =
        "MML을 여기에 붙여 넣으면 위에 노트로 그려집니다";

      /* 쳐 넣은 MML을 노트로 되돌린다.
         읽다 실패하면 칸을 붉게 두고 글자는 그대로 남긴다 — 고칠 수 있게. */
      const commit = ()=>{

        const text =
          field.value;

        if(
          text === generateTrackMML(track)
        ){

          field.classList.remove("bad");

          return;

        }

        try{

          saveHistory();

          applyMmlToTrack(
            track,
            text
          );

          field.classList.remove("bad");

          ensureBars(
            songEndBar(tracks)
          );

          renderNotes();
          renderVelocityMarkers();
          renderTempoMarkers();
          updateLengthButtons();
          updateVelocityUI();
          updateTempoUI();
          renderOutputs();

        }catch(error){

          undoStack.pop();   // 아무것도 안 바뀌었으니 되돌릴 것도 없다

          field.classList.add("bad");

          showToast(
            "읽지 못했습니다 — " +
            (
              error && error.message
                ? error.message
                : String(error)
            ),
            3200
          );

        }

      };

      field.addEventListener(
        "change",
        commit
      );

      /* 붙여넣기는 곧바로 반영한다. change는 칸에서 손을 뗄 때만 오는데,
         MML을 붙여 넣는 사람은 그 자리에서 노트가 뜨기를 기대한다.
         paste 시점에는 값이 아직 안 들어와 있어 한 박자 뒤에 읽는다. */
      field.addEventListener(
        "paste",
        ()=>{

          setTimeout(commit, 0);

        }
      );

      /* 마우스 가운데 버튼 붙여넣기(리눅스)나 끌어다 놓기도 같이 받는다 */
      field.addEventListener(
        "drop",
        ()=>{

          setTimeout(commit, 0);

        }
      );

      field.addEventListener(
        "keydown",
        event=>{

          if(event.key === "Enter"){

            event.preventDefault();

            field.blur();

          }

          if(event.key === "Escape"){

            event.preventDefault();

            field.value =
              generateTrackMML(track);

            field.classList.remove("bad");

            field.blur();

          }

          event.stopPropagation();   // 편집 단축키가 끼어들지 않게

        }
      );

      /* 노트를 고르면 그 트랙 칸을 보고 있게 된다 */
      field.addEventListener(
        "focus",
        ()=>{

          if(selectedTrack !== index){

            focusTrack(index);

            renderTracks();
            renderNotes();

          }

        }
      );

      const copy =
        document.createElement(
          "button"
        );

      copy.className =
        "ico sm";

      copy.dataset.icon =
        "copy";

      copy.title =
        name.textContent + " 복사";

      copy.textContent =
        "복사";

      copy.addEventListener(
        "click",
        async()=>{

          const text =
            field.value;

          if(!text){
            return;
          }

          try{

            await navigator.clipboard.writeText(
              text
            );

            copy.textContent =
              "완료";

            setTimeout(
              ()=>{
                copy.textContent =
                  "복사";
              },
              800
            );

          }catch(error){

            field.select();

            document.execCommand(
              "copy"
            );

          }

        }
      );

      const len =
        document.createElement(
          "span"
        );

      len.className =
        "out-len";

      len.textContent =
        field.value.length +
        " 자";

      row.appendChild(name);
      row.appendChild(field);
      row.appendChild(copy);
      row.appendChild(len);

      output.appendChild(row);

    }
  );

}


/* ============================================================
   midi 불러오기
   ============================================================
   파일 → convert() → song → 편집기 트랙.

   엔진은 tick으로 정확히 세는데 편집기는 n분음표만 다룬다.
   그래서 옮겨 담을 때 길이가 가까운 음표로 붙는다 — 셋잇단이나
   어중간한 tick은 여기서 반올림된다. 다시 MML로 뽑을 때도 그 값이
   쓰이므로, 원본 그대로가 필요하면 변환기 페이지 결과를 써야 한다.
   ============================================================ */

const midiInput =
  document.getElementById(
    "midiInput"
  );


/* ============================================================
   MIDI 변환을 백그라운드 스레드로
   ============================================================
   convert(buffer)는 곡이 길수록 오래 걸리는 무거운 계산이다.
   메인 스레드에서 그대로 부르면 그동안 화면이 안 움직인다.
   워커를 하나 띄워 두고 여기로 넘겨, 변환이 끝나는 동안에도
   사용자가 계속 화면을 만질 수 있게 한다.

   워커를 못 띄우는 환경(예: file://로 직접 연 경우, 워커가
   막혀 있는 브라우저)에서는 같은 결과를 메인 스레드에서
   바로 계산하는 것으로 조용히 대체한다 — 느려질 뿐, 기능은
   그대로 동작해야 하므로. */
let midiWorker = null;
let midiWorkerBroken = false;
let midiWorkerRequestId = 0;
const midiWorkerPending = new Map();

function getMidiWorker(){

  if(midiWorkerBroken){
    return null;
  }

  if(midiWorker){
    return midiWorker;
  }

  try{

    midiWorker =
      new Worker("midi-worker.js");

    midiWorker.onmessage =
      (event)=>{

        const { requestId, ok, song, message } =
          event.data;

        const pending =
          midiWorkerPending.get(requestId);

        if(!pending){
          return;
        }

        midiWorkerPending.delete(requestId);

        if(ok){
          pending.resolve(song);
        }else{
          pending.reject(new Error(message));
        }

      };

    midiWorker.onerror =
      ()=>{

        /* 워커 파일을 못 읽었거나(file://) 실행 중 죽었으면
           이후로는 바로 메인 스레드 계산으로 넘어간다 */
        midiWorkerBroken = true;

        for(const pending of midiWorkerPending.values()){
          pending.reject(new Error("미디 변환 워커를 쓸 수 없습니다"));
        }

        midiWorkerPending.clear();

      };

  }catch(error){

    midiWorkerBroken = true;
    return null;

  }

  return midiWorker;

}

/* ============================================================
   MIDI 변환 — 서버 → 브라우저 워커 → 메인 스레드 순으로 시도
   ============================================================
   가장 좋은 경우: Cloudflare Workers 같은 서버에서 변환해 사용자
   기기는 계산을 아예 안 한다. MIDI_API_URL을 안 채웠거나, 서버가
   막혀 있거나, TIMEOUT 안에 응답이 없으면 브라우저 안 백그라운드
   스레드로, 그것도 안 되면 화면 스레드에서 계산한다.
   즉 서버를 안 붙여도, 워커가 안 떠도 편집기 자체는 항상 동작한다. */

/* 배포한 Cloudflare Worker 주소를 여기에 넣는다.
   비워 두면(빈 문자열) 서버 시도를 건너뛰고 바로 브라우저에서 계산한다.
   server/README.md 참고. */
const MIDI_API_URL = "https://armis-mml-convert.e5eeeee.workers.dev/";

const MIDI_API_TIMEOUT_MS = 5000;

/* 서버 쪽에서 무엇이 잘못되든(네트워크, 시간 초과, 서버 오류,
   이 파일을 못 읽음) 여기서는 전부 null로 통일해 돌려준다.
   그러면 convertMidi가 예외 없이 그냥 로컬 계산으로 넘어가고,
   사용자는 실패 메시지를 한 번만(로컬 계산의 결과로) 보게 된다 —
   서버 오류 메시지와 로컬 오류 메시지가 따로 두 번 뜨는 일이 없다. */
async function convertOnServer(buffer){

  if(!MIDI_API_URL){
    return null;
  }

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      ()=>controller.abort(),
      MIDI_API_TIMEOUT_MS
    );

  try{

    const res =
      await fetch(
        MIDI_API_URL,
        {
          method:"POST",
          headers:{ "Content-Type":"application/octet-stream" },
          body: buffer,
          signal: controller.signal
        }
      );

    if(!res.ok){
      return null;
    }

    const data =
      await res.json();

    if(!data.ok){
      return null;
    }

    return data.song;

  }catch(error){

    // AbortError(시간 초과), 네트워크 오류, CORS 등 — 전부 로컬로 넘긴다
    return null;

  }finally{

    clearTimeout(timer);

  }

}

async function convertMidi(buffer){

  const fromServer =
    await convertOnServer(buffer);

  if(fromServer){
    return fromServer;
  }

  return convertLocally(buffer);

}

/* convert(buffer)와 같은 결과를 반환하되, 가능하면 브라우저 워커에서 계산한다 */
function convertLocally(buffer){

  const worker =
    getMidiWorker();

  if(!worker){

    /* 워커를 못 쓰는 환경 — 메인 스레드에서 그대로 계산 */
    return Promise.resolve(
      convert(buffer)
    );

  }

  const requestId =
    ++midiWorkerRequestId;

  return new Promise(
    (resolve, reject)=>{

      midiWorkerPending.set(
        requestId,
        { resolve, reject }
      );

      try{

        /* buffer는 transfer로 넘겨 복사 없이 소유권만 워커로 옮긴다.
           옮긴 뒤에는 메인 스레드에서 못 쓰지만, 여기서는 이 buffer를
           다시 쓰지 않으므로 안전하다. */
        worker.postMessage(
          { buffer, requestId },
          [buffer]
        );

      }catch(error){

        /* 구조적 복제가 안 되는 값이 섞였거나 transfer가 막힌 경우 —
           메인 스레드 계산으로 조용히 대체한다 */
        midiWorkerPending.delete(requestId);

        try{
          resolve(convert(buffer));
        }catch(fallbackError){
          reject(fallbackError);
        }

      }

    }
  );

}

const midiButton =
  document.querySelector(
    '[data-icon="midi-open"]'
  );

const fileStatus =
  document.getElementById(
    "fileStatus"
  );


function setFileStatus(
  text,
  kind
){

  fileStatus.textContent =
    text;

  fileStatus.className =
    "file-status" +
    (kind ? " " + kind : "");

}


/* 엔진이 만든 그룹 하나를 편집기 노트 여러 개로 편다.
   화음은 구성음마다 노트가 하나씩 생긴다. */
function groupToEditorNotes(
  group,
  techniqueCodes,
  markerVelocity,
  boost
){

  const out = [];

  for(const n of group.notes){

    const row =
      keyToRow(n.key);


    if(
      row < 0 ||
      row >= OCT_COUNT * 12
    ){

      continue;   // 화면 밖 음 (엔진이 접어 넣으므로 보통 생기지 않는다)

    }

    /* 구성음은 각자 제 길이로 울린다. 다만 다음 음 시작을 넘지는 않는다 */
    const ownTick =
      Math.max(
        MIN_TICK,
        Math.min(
          group.duration || group.fullDur || MIN_TICK,
          n.end - group.start
        )
      );

    const note = {

      row,

      bar:
        group.start / WHOLE,

      len:0,
      lengthBase:4,
      dotted:false,

      techs:
        techniqueCodes.slice(),

      /* 화음 안에서 이 음만 세기가 다르면 여기에 적어 둔다.
         마커와 같으면 null로 두어 마커를 따르게 한다. */
      /* 마커에도 같은 보정이 들어가 있으므로 여기서도 얹어야 단위가 맞는다 */
      vel:
        (()=>{

          const lifted =
            Math.min(
              VEL_MAX,
              n.velocity + boost
            );

          return lifted === markerVelocity
            ? null
            : lifted;

        })()

    };

    /* 다음 묶음이 시작하기 전까지가 이 음이 쓸 수 있는 자리다.
       올림해서 그 자리를 넘기면 "시작이 다른데 겹치는" 모양이 되어
       MML로 옮길 수 없게 된다. */
    const roomTick =
      group.slot ||
      group.duration ||
      group.fullDur ||
      ownTick;

    applyResizedLength(
      note,
      ownTick / WHOLE,
      roomTick / WHOLE
    );

    out.push(note);

  }

  return out;

}


/* 엔진 기법 코드 → 편집기가 쓰는 { role, code }.
   그 악기에 없는 코드는 버린다. */
function codesToTechs(
  instrumentName,
  codes
){

  const set =
    getTechniquesForInstrument(
      instrumentName
    );

  const out = [];

  for(const code of codes){

    const role =
      Object.keys(set).find(
        key=>set[key] === code
      );

    if(
      role &&
      !out.some(t=>t.role === role)
    ){

      out.push({ role, code });

    }

  }

  return out;

}


/* 음량은 노트마다가 아니라 마커로 관리한다.
   그룹을 훑으며 음량이 바뀌는 자리에만 마커를 남긴다. */
function velocityMarkersFrom(
  groups,
  boost
){

  const markers = [];

  let last = null;

  for(const g of groups){

    const value =
      Math.min(
        VEL_MAX,
        Math.max(
          ...g.notes.map(
            n=>n.velocity
          )
        ) + boost
      );

    if(value === last){
      continue;
    }

    markers.push({

      bar:
        g.start / WHOLE,

      velocity:
        value

    });

    last = value;

  }

  if(
    !markers.length ||
    markers[0].bar > 0
  ){

    markers.unshift({
      bar:0,
      velocity:
        markers.length
          ? markers[0].velocity
          : 12
    });

  }

  return markers;

}


/* 곡 전체에서 가장 센 음이 v15가 되도록 올리는 양.
   엔진(rebuild의 AUTO_BOOT_VELOCITY)이 이벤트에만 적용하고 그룹에는
   남기지 않아서, 그대로 옮겨 담으면 게임에서 두어 단계 여리게 나온다. */
function velocityBoost(song){

  if(!AUTO_BOOT_VELOCITY){
    return 0;
  }

  let top = 0;

  for(const t of song.tracks){

    for(const g of t.groups){

      for(const n of g.notes){

        if(n.velocity > top){
          top = n.velocity;
        }

      }

    }

  }

  return top > 0
    ? Math.max(0, VEL_MAX - top)
    : 0;

}


function songToTracks(song){

  const boost =
    velocityBoost(song);

  const tempoMarkers =
    song.tempoList.map(
      t=>({

        bar:
          t.pos / WHOLE,

        tempo:
          clampTempo(t.bpm)

      })
    );

  if(
    !tempoMarkers.length ||
    tempoMarkers[0].bar > 0
  ){

    tempoMarkers.unshift({
      bar:0,
      tempo:INITIAL_TEMPO
    });

  }

  /* 아르미스는 한 사람이 3트랙까지지만 미디 쪽은 제한이 없다.
     그래서 파트는 전부 올리고, 그중 어떤 걸 쓸지는 화면에서 고른다. */
  return song.tracks
    .map(
      engineTrack=>{

        const name =
          engineTrack.owner.armis;

        const velocityMarkers =
          velocityMarkersFrom(
            engineTrack.groups,
            boost
          );

        const notes = [];

        for(
          const group
          of engineTrack.groups
        ){

          const codes =
            []
              .concat(group.open || [])
              .concat(
                (group.techniques || [])
                  .map(t=>t.code)
              )
              .concat(group.close || []);

          notes.push(
            ...groupToEditorNotes(
              group,
              codesToTechs(name, codes),
              velocityAt(
                velocityMarkers,
                group.start / WHOLE
              ),
              boost
            )
          );

        }

        return {

          name,

          /* 미디에 적혀 있던 악기 이름과 파트 번호. 화면 왼쪽에 그대로 쓴다. */
          midiName:
            engineTrack.owner.instrument,

          label:
            engineTrack.label,

          selected:true,

          notes,

          velocityMarkers,

          /* 아르미스는 트랙마다 템포가 들어가야 한다 */
          tempoMarkers:
            tempoMarkers.map(
              m=>({ ...m })
            )

        };

      }
    );

}


function songEndBar(loaded){

  let end = 0;

  for(const track of loaded){

    for(const note of track.notes){

      end =
        Math.max(
          end,
          note.bar + note.len
        );

    }

  }

  return end;

}


/* 불러온 트랙을 화면에 올린다. 시험할 때도 이 함수만 부르면 된다. */
function applyLoadedTracks(loaded){

  saveHistory();

  tracks =
    loaded;

  /* 판을 먼저 곡 길이에 맞춰 늘린다. 순서를 바꾸면 안 된다. */
  ensureBars(
    songEndBar(tracks)
  );

  normalizeAllNotes();

  selectedTrack = 0;
  selectedNote = null;
  selectedMarker = null;

  ensureFocusedTrack();

  ensureBars(
    songEndBar(tracks)
  );

  setPlayheadBar(0);

  refreshAll();

  board.scrollLeft = 0;

}


midiButton.addEventListener(
  "click",
  ()=>{
    midiInput.click();
  }
);


midiInput.addEventListener(
  "change",
  async()=>{

    const file =
      midiInput.files &&
      midiInput.files[0];

    if(!file){
      return;
    }

    setFileStatus(
      "읽는 중… " + file.name,
      "busy"
    );

    try{

      const buffer =
        await file.arrayBuffer();

      const song =
        await convertMidi(buffer);

      const loaded =
        songToTracks(song);

      if(!loaded.length){

        setFileStatus(
          file.name + " — 음표가 있는 트랙을 찾지 못했습니다",
          "bad"
        );

        return;

      }

      applyLoadedTracks(loaded);

      let text =
        file.name +
        " · 파트 " + song.parts.length +
        "개 중 소리가 있는 " + tracks.length + "개";

      if(
        tracks.length > MAX_TRACKS
      ){

        text +=
          " (아르미스는 한 사람이 " + MAX_TRACKS +
          "트랙까지입니다)";

      }

      setFileStatus(text);

    }catch(error){

      console.error(error);

      setFileStatus(
        "불러오지 못했습니다 — " +
        (
          error && error.message
            ? error.message
            : String(error)
        ),
        "bad"
      );

    }finally{

      /* 같은 파일을 다시 골라도 change가 나도록 비운다 */
      midiInput.value = "";

    }

  }
);


/* ============================================================
   재생
   ============================================================
   게임에 넣기 전에 귀로 확인하려는 것이지, 아르미스 음색을 흉내내려는 것이
   아니다. 음원 파일 없이 Web Audio의 발진기만으로 소리를 만든다.

   시간 계산은 마디 → 초로 한다. 4/4에서 한 마디는 4박이므로
   한 마디 = 4 * 60 / bpm 초. 템포 마커마다 구간을 끊어 더해 나간다.

   음을 한꺼번에 다 예약하면 긴 곡에서 수천 개의 노드가 생긴다.
   그래서 앞으로 0.4초 안에 울릴 것만 계속 채워 넣는다.
   ============================================================ */

const LOOKAHEAD_SEC = 0.4;    // 이만큼 앞의 음까지 미리 예약한다
const SCHEDULE_MS = 40;       // 채워 넣는 주기

/* 화면이 숨어 있을 때는 브라우저가 위 주기를 1초까지 늦춘다.
   그래서 숨은 동안에는 더 멀리까지 미리 예약해 둔다. */
const HIDDEN_LOOKAHEAD_SEC = 3;

let audioCtx = null;
let playback = null;


/* 악기별 소리 성격. 이름은 getBaseInstrument가 주는 값이다. */
const VOICES = {
  "피아노":     { type:"triangle", attack:.004, decay:2.2,  sustain:0,   partial:.35 },
  "기타":       { type:"triangle", attack:.004, decay:1.4,  sustain:0,   partial:.5  },
  "비파":       { type:"sawtooth", attack:.003, decay:1.0,  sustain:0,   partial:.4  },
  "고쟁":       { type:"triangle", attack:.003, decay:1.8,  sustain:0,   partial:.45 },
  "베이스":     { type:"sine",     attack:.006, decay:1.2,  sustain:.15, partial:.25 },
  "바이올린":   { type:"sawtooth", attack:.06,  decay:.25,  sustain:.7,  partial:.2  },
  "이호":       { type:"sawtooth", attack:.07,  decay:.25,  sustain:.65, partial:.2  },
  "피리":       { type:"square",   attack:.03,  decay:.2,   sustain:.75, partial:.15 },
  "퉁소":       { type:"sine",     attack:.05,  decay:.2,   sustain:.75, partial:.2  },
  "태평소":     { type:"square",   attack:.02,  decay:.2,   sustain:.7,  partial:.3  },
  "신디사이저": { type:"square",   attack:.01,  decay:.4,   sustain:.5,  partial:.3  }
};

const PERCUSSION_VOICES = ["드럼","북"];


function voiceFor(name){

  return VOICES[
    getBaseInstrument(name)
  ] || VOICES["피아노"];

}


function isPercussion(name){

  return PERCUSSION_VOICES.indexOf(
    getBaseInstrument(name)
  ) >= 0;

}


/* 고른 트랙들의 템포 마커를 모아 하나의 시간표로 만든다.
   아르미스는 모든 트랙에 같은 템포가 들어가므로 자리별로 하나만 남기면 된다. */
function tempoTimeline(){

  const byTick = new Map();

  for(const track of tracks){

    if(!track.selected){
      continue;
    }

    for(
      const marker
      of track.tempoMarkers || []
    ){

      byTick.set(
        Math.round(marker.bar * WHOLE),
        clampTempo(marker.tempo)
      );

    }

  }

  const list =
    [...byTick.entries()]
      .sort((a,b)=>a[0]-b[0])
      .map(
        ([tick,bpm])=>({
          bar: tick / WHOLE,
          bpm
        })
      );

  if(
    !list.length ||
    list[0].bar > 0
  ){

    list.unshift({
      bar:0,
      bpm:tempo
    });

  }

  return list;

}


function barToSeconds(
  timeline,
  bar
){

  let seconds = 0;

  for(
    let i = 0;
    i < timeline.length;
    i++
  ){

    const from =
      timeline[i].bar;

    if(from >= bar){
      break;
    }

    const to =
      Math.min(
        bar,
        i + 1 < timeline.length
          ? timeline[i + 1].bar
          : bar
      );

    /* 4/4에서 한 마디는 4박 */
    seconds +=
      (to - from) *
      (4 * 60 / timeline[i].bpm);

  }

  return seconds;

}


/* 이 음이 다른 음의 이음줄을 받아 울리는 중인가 (그렇다면 따로 소리내지 않는다) */
function isTieTarget(
  track,
  note
){

  const key =
    note.row + ":" +
    Math.round(note.bar * WHOLE);

  return track.notes.some(
    other =>
      other !== note &&
      other.tie &&
      other.row === note.row &&
      Math.round(
        (other.bar + other.len) * WHOLE
      ) === Math.round(note.bar * WHOLE) &&
      key === key
  );

}


/* 이음줄로 이어진 만큼까지 합친 실제 울림 길이 */
function soundingLength(
  track,
  note
){

  let total =
    note.len;

  let current =
    note;

  let guard = 0;

  while(
    current.tie &&
    guard++ < 64
  ){

    const next =
      track.notes[
        tiePartnerIndex(track, current)
      ];

    if(!next){
      break;
    }

    total += next.len;

    current = next;

  }

  return total;

}


/* 고른 트랙 전체를 시간 순 소리 목록으로 편다 */
function buildPlaylist(fromBar){

  const timeline =
    tempoTimeline();

  const base =
    barToSeconds(timeline, fromBar);

  const list = [];

  tracks.forEach(
    (track,trackIndex)=>{

      if(!track.selected){
        return;
      }

      normalizeTies(track);

      const percussion =
        isPercussion(track.name);

      const voice =
        voiceFor(track.name);

      for(const note of track.notes){

        if(note.bar + note.len < fromBar){
          continue;
        }

        if(isTieTarget(track, note)){
          continue;
        }

        const velocity =
          noteVelocity(track, note);

        if(velocity <= 0){
          continue;   // v0은 소리가 없다
        }

        const startBar =
          Math.max(fromBar, note.bar);

        const endBar =
          note.bar +
          soundingLength(track, note);

        if(endBar <= fromBar){
          continue;
        }

        list.push({

          at:
            barToSeconds(timeline, startBar) - base,

          until:
            barToSeconds(timeline, endBar) - base,

          key:
            rowToKey(note.row),

          velocity,
          percussion,
          voice,
          trackIndex

        });

      }

    }
  );

  list.sort(
    (a,b)=>a.at-b.at
  );

  return { list, timeline };

}


function makeAudioContext(){

  const Ctx =
    window.AudioContext ||
    window.webkitAudioContext;

  if(!Ctx){
    return null;
  }

  return new Ctx();

}


/* resume()은 약속(Promise)을 돌려주는데, 브라우저에 따라 이게 영영
   안 끝나는 경우가 있다(숨은 탭 등). 그래서 기다리되 오래 걸리면
   포기하고 넘어간다. 어차피 아래에서 state를 다시 확인한다. */
function resumeAudio(ctx){

  return Promise.race([

    Promise.resolve()
      .then(()=>ctx.resume())
      .catch(()=>{}),

    new Promise(
      done=>setTimeout(done, 1200)
    )

  ]);

}


/* ============================================================
   소리 낼 준비
   ============================================================
   브라우저는 탭을 오래 놔두거나, 절전에 들어가거나, 이어폰을 뽑으면
   AudioContext를 마음대로 재운다(suspended). 사파리는 interrupted로,
   심하면 아예 닫아버린다(closed). 닫힌 컨텍스트에서는 createGain조차
   예외를 던지므로, 예전처럼 state를 한 번 보고 resume만 걸어 두면
   "한참 있다 재생 누르면 아무 소리도 안 난다"가 된다.

   그래서 여기서는
     1) 닫혔으면 버리고 새로 만들고
     2) resume이 실제로 끝날 때까지 기다린 뒤
     3) 그래도 안 깨어나면 한 번 더 새로 만들어 본다.
   ============================================================ */
async function ensureAudio(){

  if(audioCtx && audioCtx.state === "closed"){

    audioCtx = null;

  }

  if(!audioCtx){

    audioCtx = makeAudioContext();

  }

  if(!audioCtx){
    return null;
  }

  if(audioCtx.state !== "running"){

    await resumeAudio(audioCtx);

  }

  /* 깨어나지 못했으면 컨텍스트가 죽은 것으로 보고 새로 만든다 */
  if(audioCtx.state !== "running"){

    try{
      audioCtx.close();
    }catch(error){}

    audioCtx = makeAudioContext();

    if(!audioCtx){
      return null;
    }

    await resumeAudio(audioCtx);

  }

  return audioCtx.state === "running"
    ? audioCtx
    : null;

}


/* 탭으로 돌아왔을 때 잠든 소리를 미리 깨워 둔다.
   재생 버튼을 누르는 순간 기다리지 않아도 되도록. */
document.addEventListener(
  "visibilitychange",
  ()=>{

    if(document.hidden){
      return;
    }

    if(
      audioCtx &&
      audioCtx.state !== "running" &&
      audioCtx.state !== "closed"
    ){

      resumeAudio(audioCtx);

    }

  }
);


/* 음 하나를 실제 소리로 만든다 */
function playOne(
  ctx,
  item,
  when
){

  const length =
    Math.max(0.05, item.until - item.at);

  /* 예약이 늦어 이미 지나간 시각이 들어오면(숨은 탭에서 돌아온 직후 등)
     지금으로 당긴다. 지나간 시각에 그대로 걸면 소리 커지는 구간이
     통째로 과거에 묻혀 딸깍 소리만 난다. */
  if(when < ctx.currentTime){

    when = ctx.currentTime;

  }

  const gain =
    ctx.createGain();

  /* v0~v15를 소리 크기로. 제곱을 쓰면 사람 귀에 고르게 들린다. */
  const level =
    Math.pow(item.velocity / VEL_MAX, 2) * 0.22;

  gain.connect(playback.master);

  const nodes = [];

  if(item.percussion){

    /* 타악기는 음정이 없다. 짧은 잡음 한 번으로 낸다.
       건반이 높을수록 짧고 밝게 (하이햇 쪽), 낮을수록 길고 둔하게 (킥 쪽). */
    const seconds =
      Math.max(
        0.05,
        0.35 - (item.key - 60) * 0.012
      );

    const frames =
      Math.floor(ctx.sampleRate * seconds);

    const buffer =
      ctx.createBuffer(1, frames, ctx.sampleRate);

    const data =
      buffer.getChannelData(0);

    for(
      let i = 0;
      i < frames;
      i++
    ){

      data[i] =
        (Math.random() * 2 - 1) *
        Math.pow(1 - i / frames, 2.5);

    }

    const src =
      ctx.createBufferSource();

    src.buffer = buffer;

    const filter =
      ctx.createBiquadFilter();

    filter.type = "bandpass";

    filter.frequency.value =
      120 * Math.pow(2, (item.key - 60) / 9);

    filter.Q.value = 0.9;

    src.connect(filter);
    filter.connect(gain);

    /* 게임 안에서 드럼 소리가 이 미리듣기보다 훨씬 크게 들려서
       다른 악기와 밸런스가 안 맞는다는 신고에 따라, 설정된 v 대비
       실제 게임에서 들리는 크기(약 2배)에 맞춰 증폭한다. */
    gain.gain.setValueAtTime(level * 1.6 * 2, when);

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      when + seconds
    );

    src.start(when);
    src.stop(when + seconds + 0.02);

    nodes.push(src);

  }else{

    const freq =
      440 * Math.pow(2, (item.key - 69) / 12);

    const make = (type, detuneFreq, weight)=>{

      const osc =
        ctx.createOscillator();

      osc.type = type;

      osc.frequency.value = detuneFreq;

      const g =
        ctx.createGain();

      g.gain.value = weight;

      osc.connect(g);
      g.connect(gain);

      osc.start(when);
      osc.stop(when + length + 0.4);

      nodes.push(osc);

    };

    make(item.voice.type, freq, 1);

    if(item.voice.partial > 0){

      make("sine", freq * 2, item.voice.partial);

    }

    const v = item.voice;

    gain.gain.setValueAtTime(0.0001, when);

    gain.gain.exponentialRampToValueAtTime(
      level,
      when + v.attack
    );

    if(v.sustain > 0){

      /* 계속 울리는 악기 — 조금 줄었다가 끝까지 버틴다 */
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, level * v.sustain),
        when + v.attack + v.decay
      );

      gain.gain.setValueAtTime(
        Math.max(0.0001, level * v.sustain),
        when + length
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        when + length + 0.06
      );

    }else{

      /* 튕기는 악기 — 친 뒤로 계속 줄어든다 */
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        when + Math.min(length + 0.25, v.decay)
      );

    }

  }

  playback.nodes.push(...nodes);

}


function stopPlayback(returnHome){

  if(!playback){
    return;
  }

  const home =
    playback.fromBar;

  clearInterval(playback.timer);

  cancelAnimationFrame(playback.frame);

  for(const node of playback.nodes){

    try{
      node.stop();
    }catch(error){}

  }

  try{

    playback.master.gain.cancelScheduledValues(0);

    playback.master.disconnect();

  }catch(error){}

  playback = null;

  playButton.classList.remove("on");

  if(returnHome){

    setPlayheadBar(home);

  }

}


let startingPlayback = false;


async function startPlayback(){

  /* 소리를 깨우는 동안 기다리므로, 그 사이에 버튼을 또 눌러
     재생이 두 겹으로 시작되는 것을 막는다. */
  if(startingPlayback){
    return;
  }

  startingPlayback = true;

  let ctx = null;

  try{

    ctx = await ensureAudio();

  }catch(error){

    ctx = null;

  }

  startingPlayback = false;

  if(!ctx){

    showToast(
      "소리를 켜지 못했습니다. 화면을 한 번 누른 뒤 다시 시도해 주세요."
    );

    return;

  }

  if(!selectedTracks().length){

    showToast(
      "고른 트랙이 없습니다."
    );

    return;

  }

  stopPlayback(false);

  const built =
    buildPlaylist(playheadBar);

  if(!built.list.length){

    showToast(
      "재생 머리 뒤에 소리가 없습니다."
    );

    return;

  }

  const master =
    ctx.createGain();

  master.gain.value = 1;

  master.connect(ctx.destination);

  playback = {

    ctx,
    master,

    list:
      built.list,

    timeline:
      built.timeline,

    next:0,

    nodes:[],

    fromBar:
      playheadBar,

    /* 첫 음이 잘리지 않게 조금 뒤부터 시작한다 */
    startedAt:
      ctx.currentTime + 0.08,

    endsAt:
      Math.max(
        ...built.list.map(x=>x.until)
      ),

    /* 오디오 시계가 실제로 흐르고 있는지 지켜보기 위한 값 */
    lastClock:
      ctx.currentTime,

    lastWall:
      performance.now()

  };

  playButton.classList.add("on");

  const pump = ()=>{

    if(!playback){
      return;
    }

    const ctxNow =
      playback.ctx;

    /* 재생 도중 브라우저가 소리를 재웠으면(탭 전환, 절전, 기기 바뀜)
       깨운다. 이번 회차는 시계가 멈춰 있으니 예약하지 않고 넘어간다. */
    if(ctxNow.state !== "running"){

      if(ctxNow.state === "closed"){

        audioCtx = null;

        stopPlayback(true);

        showToast(
          "소리가 끊겨 재생을 멈췄습니다. 다시 눌러 주세요."
        );

        return;

      }

      resumeAudio(ctxNow);

      playback.lastWall =
        performance.now();

      return;

    }

    /* state는 running이라는데 시계가 안 흐르는 경우가 있다.
       (출력 장치가 바뀐 뒤 등) 이때는 컨텍스트를 버리고 멈춘다. */
    const clock =
      ctxNow.currentTime;

    const wall =
      performance.now();

    if(clock > playback.lastClock){

      playback.lastClock = clock;
      playback.lastWall = wall;

    }else if(wall - playback.lastWall > 2000){

      try{
        ctxNow.close();
      }catch(error){}

      audioCtx = null;

      stopPlayback(true);

      showToast(
        "소리가 끊겨 재생을 멈췄습니다. 다시 눌러 주세요."
      );

      return;

    }

    const elapsed =
      clock - playback.startedAt;

    /* 곡이 끝났는지는 여기서도 본다.
       화면이 숨으면 requestAnimationFrame이 멈춰서
       재생 머리를 따라가는 쪽만으로는 끝을 놓친다. */
    if(elapsed > playback.endsAt + 0.3){

      stopPlayback(true);

      return;

    }

    /* 숨은 탭에서는 브라우저가 setInterval을 1초에 한 번으로 묶는다.
       0.4초 앞만 채워 두면 그 사이에 소리가 끊기므로 더 멀리 채운다. */
    const ahead =
      elapsed +
      (
        document.hidden
          ? HIDDEN_LOOKAHEAD_SEC
          : LOOKAHEAD_SEC
      );

    while(
      playback.next < playback.list.length &&
      playback.list[playback.next].at <= ahead
    ){

      const item =
        playback.list[playback.next++];

      playOne(
        playback.ctx,
        item,
        playback.startedAt + item.at
      );

    }

    /* 예약한 노드가 쌓이지 않게 이미 끝난 것은 버린다 */
    if(playback.nodes.length > 400){

      playback.nodes =
        playback.nodes.slice(-200);

    }

  };

  pump();

  playback.timer =
    setInterval(pump, SCHEDULE_MS);

  /* 재생 머리 움직이기 */
  const follow = ()=>{

    if(!playback){
      return;
    }

    const elapsed =
      playback.ctx.currentTime -
      playback.startedAt;

    if(elapsed > playback.endsAt + 0.3){

      stopPlayback(true);

      return;

    }

    /* 시간 → 마디. 템포 구간을 훑어 되짚는다. */
    let bar =
      playback.fromBar;

    let left =
      Math.max(0, elapsed);

    const line =
      playback.timeline;

    for(
      let i = 0;
      i < line.length && left > 0;
      i++
    ){

      const from =
        Math.max(bar, line[i].bar);

      const to =
        i + 1 < line.length
          ? line[i + 1].bar
          : Infinity;

      if(to <= bar){
        continue;
      }

      const secPerBar =
        4 * 60 / line[i].bpm;

      const span =
        (to - from) * secPerBar;

      if(
        !isFinite(span) ||
        left < span
      ){

        bar = from + left / secPerBar;

        left = 0;

      }else{

        bar = to;

        left -= span;

      }

    }

    playhead.style.left =
      (bar * BAR_W) + "px";

    /* 화면 밖으로 나가면 따라간다 */
    const x =
      bar * BAR_W;

    if(
      x < board.scrollLeft + 60 ||
      x > board.scrollLeft + board.clientWidth - 60
    ){

      board.scrollLeft =
        Math.max(
          0,
          x - board.clientWidth / 3
        );

    }

    playback.frame =
      requestAnimationFrame(follow);

  };

  playback.frame =
    requestAnimationFrame(follow);

}


playButton.addEventListener(
  "click",
  ()=>{

    if(playback){

      stopPlayback(true);

      return;

    }

    startPlayback();

  }
);


stopButton.addEventListener(
  "click",
  ()=>{

    stopPlayback(true);

  }
);


renderTempo();

setPlayheadBar(
  playheadBar
);

renderTracks();

renderNotes();

renderTempoMarkers();

renderVelocityMarkers();

renderTechniqueMenu();

renderInspectorTechniques();

updateLengthButtons();

updateVelocityUI();

updateTempoUI();

renderOutputs();


board.scrollTop =
  26 * ROW_H;

