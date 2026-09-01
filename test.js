/* ============================================================
   회귀 시험
   ============================================================
   화면을 눈으로 보지 않고도 "예전에 되던 것이 아직 되는지"를
   확인한다. 실제로 이 편집기에서 조용히 망가졌던 것들을 그대로
   시험으로 옮겨 놓았다 — 기법 이름표가 CSS 한 줄에 사라졌던 일,
   서버용 worker.js가 엔진과 어긋났던 일 같은 것들이다.

   쓰는 법
     npm install      (처음 한 번, jsdom을 받는다)
     npm test

   내용이 하나라도 어긋나면 빨간 줄과 함께 1로 끝난다.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = __dirname;

let passed = 0;
const failures = [];


function check(name, condition, detail){

  if(condition){

    passed++;

    console.log("  ✓ " + name);

  }else{

    failures.push(
      name + (detail ? "  → " + detail : "")
    );

    console.log("  ✗ " + name + (detail ? "  → " + detail : ""));

  }

}


function section(title){

  console.log("\n" + title);

}


/* ------------------------------------------------------------
   시험용 MIDI 한 곡
   ------------------------------------------------------------
   파일을 따로 두지 않고 여기서 만든다. 4분음표 여섯 개,
   가운데 한 음만 세게(악센트가 붙도록), 전체에 CC1(비브라토). */
function makeTestMidi(){

  const vlq = n=>{

    const out = [n & 0x7f];

    n >>= 7;

    while(n){

      out.unshift((n & 0x7f) | 0x80);

      n >>= 7;

    }

    return out;

  };

  const track = [];

  const push = (delta, bytes)=>{

    track.push(...vlq(delta), ...bytes);

  };

  push(0, [0xC0, 0]);        // 악기: 피아노
  push(0, [0xB0, 1, 80]);    // CC1: 비브라토

  const notes = [
    [60, 64], [62, 64], [64, 100],
    [65, 64], [67, 64], [69, 64]
  ];

  for(const [key, velocity] of notes){

    push(0,   [0x90, key, velocity]);
    push(480, [0x80, key, 0]);

  }

  push(0, [0xFF, 0x2F, 0x00]);

  const head = [
    0x4D,0x54,0x68,0x64, 0,0,0,6,
    0,0, 0,1, 0x01,0xE0
  ];

  const len = track.length;

  return Buffer.from([
    ...head,
    0x4D,0x54,0x72,0x6B,
    (len >> 24) & 255,
    (len >> 16) & 255,
    (len >> 8) & 255,
    len & 255,
    ...track
  ]);

}


/* ------------------------------------------------------------
   편집기를 통째로 띄운다
------------------------------------------------------------ */
function boot(){

  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      url: "http://localhost/"
    }
  );

  const win = dom.window;

  /* jsdom은 배치를 계산하지 않아 getBoundingClientRect가 전부 0이다.
     노트를 잡을 때 "끝을 잡았는지"를 이 값으로 재므로, 노트만
     style.left/width로 흉내 내 준다. */
  win.Element.prototype.getBoundingClientRect = function(){

    const px = v => parseFloat(v || "0") || 0;

    if(
      this.classList &&
      this.classList.contains("note")
    ){

      const left = px(this.style.left);
      const width = Math.max(8, px(this.style.width));

      return { left, right:left+width, width, top:0, bottom:20, height:20, x:left, y:0 };

    }

    return { left:0, right:1200, width:1200, top:0, bottom:800, height:800, x:0, y:0 };

  };

  /* 소리는 나지 않지만, 무엇을 언제 예약했는지는 기록한다.
     기법이 소리에 반영되는지를 이 기록으로 잰다. */
  win.__audioLog = [];

  const param = name => ({
    value: 0,
    setValueAtTime(v, t){ win.__audioLog.push([name, "set", v, t]); },
    linearRampToValueAtTime(v, t){ win.__audioLog.push([name, "lin", v, t]); },
    exponentialRampToValueAtTime(v, t){ win.__audioLog.push([name, "exp", v, t]); },
    cancelScheduledValues(){}
  });

  win.AudioContext = function(){

    return {
      state: "running",
      currentTime: 0,
      destination: {},
      sampleRate: 44100,
      createGain(){ return { gain: param("gain"), connect(){}, disconnect(){} }; },
      createOscillator(){
        return {
          type: "sine",
          frequency: param("freq"),
          detune: param("detune"),
          connect(){}, disconnect(){},
          start(t){ win.__audioLog.push(["osc", "start", 0, t]); },
          stop(t){ win.__audioLog.push(["osc", "stop", 0, t]); }
        };
      },
      createBiquadFilter(){ return { type:"", frequency: param("filt"), Q: param("q"), connect(){}, disconnect(){} }; },
      createBufferSource(){ return { buffer:null, connect(){}, start(){}, stop(){} }; },
      createBuffer(){ return { getChannelData(){ return new Float32Array(100); } }; },
      createDynamicsCompressor(){
        return { threshold: param("th"), knee: param("kn"), ratio: param("ra"), attack: param("at"), release: param("re"), connect(){}, disconnect(){} };
      },
      resume(){ return Promise.resolve(); },
      close(){}
    };

  };

  const read = name =>
    fs.readFileSync(path.join(root, name), "utf8");

  /* eval 안에서 선언한 const/let은 그 eval 안에만 남는다. 그래서
     세 파일과 "안을 들여다보는 창"을 한 번에 evaluate 한다.
     __eval은 같은 자리에서 직접 eval을 부르므로 안쪽 이름을 다 본다. */
  win.eval(
    read("i18n.js") + "\n;\n" +
    read("midi-engine.js") + "\n;\n" +
    read("app.js") + "\n;\n" +
    "globalThis.__eval = function(code){ return eval(code); };"
  );

  return win;

}


/* 편집기 안에서 코드를 돌리고 결과를 받아 온다 */
function run(win, code){

  return win.__eval(
    "(function(){\n" + code + "\n})()"
  );

}


/* ============================================================
   1. 서버용 worker.js가 엔진과 같은지
   ============================================================
   worker.js는 midi-engine.js 전체 + fetch 핸들러다. 한쪽만 고치면
   아무 오류 없이 서버와 브라우저가 서로 다른 MML을 뱉는다.
   그래서 글자 단위로 견준다. */
function testWorkerSync(){

  section("서버 worker.js 동기화");

  const workerPath =
    path.join(root, "server", "worker.js");

  if(!fs.existsSync(workerPath)){

    check(
      "server/worker.js 있음",
      false,
      "파일을 찾지 못했습니다"
    );

    return;

  }

  const engine =
    fs.readFileSync(path.join(root, "midi-engine.js"), "utf8");

  const worker =
    fs.readFileSync(workerPath, "utf8");

  check(
    "worker.js가 midi-engine.js를 그대로 품고 있음",
    worker.startsWith(engine.trimEnd()) ||
    worker.includes(engine.trimEnd()),
    "엔진을 고친 뒤 worker.js에 반영하지 않았습니다"
  );

}


/* ============================================================
   1-2. 노트를 가두는 CSS가 없는지
   ============================================================
   .note에 content-visibility나 contain을 걸면 paint 격리가 함께
   붙어, 상자 밖으로 나가는 자식이 전부 잘린다. 기법 이름표는 노트
   위에, 기법 코드는 노트 오른쪽에, 길이 손잡이는 바깥 3px에 그려
   지므로 죄다 사라진다. 실제로 이 한 줄 때문에 기법 표시가 통째로
   없어진 적이 있다.

   jsdom은 화면을 실제로 그리지 않아 잘림을 볼 수 없다. 그래서
   규칙 자체를 읽어 본다. 편집 중이 아닌 트랙(.note.other)은 잘릴
   것이 없으므로 걸어도 된다. */
function testNoteNotClipped(){

  section("노트 CSS 격리");

  const css =
    fs.readFileSync(path.join(root, "styles.css"), "utf8");

  /* 주석을 걷어내고 규칙만 본다 */
  const bare =
    css.replace(/\/\*[\s\S]*?\*\//g, "");

  const blocks =
    [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)];

  const guilty =
    blocks.filter(
      ([, selector, body])=>{

        const target =
          selector
            .split(",")
            .map(one=>one.trim())
            .some(
              one=>
                one === ".note" ||
                one.startsWith(".note:")
            );

        if(!target){
          return false;
        }

        return (
          /content-visibility\s*:/.test(body) ||
          /(^|[\s;])contain\s*:/.test(body)
        );

      }
    );

  check(
    ".note 자체에는 그리기 격리를 걸지 않았다",
    guilty.length === 0,
    guilty.length
      ? guilty.map(g=>g[1].trim()).join(", ") +
        " 에 걸려 있어 기법 이름표가 잘립니다"
      : ""
  );

}


/* ============================================================
   2. 사전이 네 말 모두에 갖춰져 있는지
   ============================================================ */
function testDictionary(win){

  section("말 사전");

  const report = run(win, `
    const codes = I18N_LANGS.map(x=>x.code);
    const base = Object.keys(I18N.ko);
    const missing = {};

    for(const code of codes){

      if(code === "ko") continue;

      const gap = base.filter(
        key=>I18N[code][key] === undefined
      );

      if(gap.length) missing[code] = gap;

    }

    return { total: base.length, codes, missing };
  `);

  check(
    "네 말이 모두 있음",
    report.codes.length === 4,
    report.codes.join(",")
  );

  for(const code of report.codes){

    if(code === "ko") continue;

    const gap = report.missing[code];

    check(
      code + " 번역이 " + report.total + "개 모두 있음",
      !gap,
      gap ? "빠진 것: " + gap.slice(0, 6).join(", ") : ""
    );

  }

}


/* ============================================================
   3. 미디를 읽어 노트로 펴고, 기법이 화면에 보이는지
   ============================================================
   .note에 content-visibility가 걸려 기법 이름표가 통째로 잘렸던
   적이 있다. DOM에 글자가 있는지까지 본다. */
function testMidiImport(win, midi){

  section("미디 불러오기와 기법 표시");

  const report = run(win, `
    const buffer = new Uint8Array(${JSON.stringify([...midi])}).buffer;
    const song = convert(buffer);
    const loaded = songToTracks(song);

    applyLoadedTracks(loaded);

    const notes = [...document.querySelectorAll(".note")];

    return {
      trackCount: tracks.length,
      noteCount: tracks[0].notes.length,
      withTech: notes.filter(el=>el.classList.contains("has-tech")).length,
      firstTech: notes[0] && notes[0].querySelector(".tech")
        ? notes[0].querySelector(".tech").textContent
        : "",
      firstCode: notes[0] && notes[0].querySelector(".tech-code")
        ? notes[0].querySelector(".tech-code").textContent
        : "",
      mml: [...document.querySelectorAll(".out-field")].map(f=>f.value)
    };
  `);

  check(
    "트랙 하나를 만들었다",
    report.trackCount === 1,
    "트랙 " + report.trackCount + "개"
  );

  check(
    "노트 여섯 개를 폈다",
    report.noteCount === 6,
    "노트 " + report.noteCount + "개"
  );

  check(
    "기법이 노트에 붙었다",
    report.withTech === 6,
    "붙은 노트 " + report.withTech + "개"
  );

  check(
    "기법 이름표가 화면에 그려졌다",
    report.firstTech.length > 0,
    "이름표가 비어 있습니다 (paint 격리로 잘렸을 수 있음)"
  );

  check(
    "기법 코드가 화면에 그려졌다",
    report.firstCode.length > 0,
    "코드가 비어 있습니다"
  );

  check(
    "MML이 나왔다",
    report.mml.length === 1 && report.mml[0].length > 0,
    JSON.stringify(report.mml)
  );

}


/* ============================================================
   4. 말을 바꿔도 MML은 그대로인지
   ============================================================
   악기 이름은 보이는 글자만 번역해야 한다. 열쇠까지 번역해 버리면
   기법표를 못 찾아 곡이 조용히 깨진다. */
function testLanguageDoesNotChangeMml(win){

  section("말 바꾸기");

  const report = run(win, `
    const out = {};

    for(const item of I18N_LANGS){

      setLang(item.code);

      out[item.code] = [...document.querySelectorAll(".out-field")]
        .map(f=>f.value)
        .join("|");

    }

    setLang("ko");

    return {
      mml: out,
      instrument: document.querySelector(".out-name").textContent.trim()
    };
  `);

  const values =
    Object.values(report.mml);

  check(
    "네 말 모두에서 MML이 같다",
    values.every(v=>v === values[0]),
    JSON.stringify(report.mml)
  );

  check(
    "MML이 비어 있지 않다",
    values[0].length > 0
  );

}


/* ============================================================
   5. 고르기와 여러 개 옮기기
   ============================================================ */
function testSelectionAndMove(win){

  section("고르기와 옮기기");

  const report = run(win, `
    const before = tracks[0].notes.map(n=>n.bar + "/" + n.row);

    setPickMode(true);

    const els = [...document.querySelectorAll(".note")];

    const fire = (type, x, y, el)=>{

      const e = new window.MouseEvent(type, {
        bubbles: true, button: 0, clientX: x, clientY: y
      });

      (el || window).dispatchEvent(e);

    };

    [0,1,2].forEach(i=>{
      fire("pointerdown", 10, 10, els[i]);
      fire("pointerup", 10, 10);
    });

    const picked = multiSelection.size;

    /* 고른 것 하나를 잡고 끈다 */
    fire("pointerdown", 100, 100, els[0]);
    fire("pointermove", 140, 130);

    const lifted = ghost ? ghost.items.length : 0;

    fire("pointermove", 260, 130);
    fire("pointerup", 0, 0);

    return {
      picked,
      lifted,
      pickModeAfter: pickMode,
      moved: tracks[0].notes.map(n=>n.bar + "/" + n.row),
      before
    };
  `);

  check(
    "선택 모드에서 세 개를 골랐다",
    report.picked === 3,
    "고른 개수 " + report.picked
  );

  check(
    "고른 세 개가 통째로 딸려 올라왔다",
    report.lifted === 3,
    "집어 든 개수 " + report.lifted
  );

  check(
    "놓고 나면 고르기가 자동으로 꺼진다",
    report.pickModeAfter === false
  );

  check(
    "자리가 실제로 바뀌었다",
    report.moved.join(",") !== report.before.join(",")
  );

}


/* ============================================================
   6. 단축키
   ============================================================ */
function testShortcuts(win){

  section("단축키");

  const report = run(win, `
    const key = (k, opt)=>document.dispatchEvent(
      new window.KeyboardEvent("keydown",
        Object.assign({ key:k, bubbles:true, cancelable:true }, opt || {}))
    );

    key("a", { ctrlKey:true });
    const all = multiSelection.size === tracks[0].notes.length;

    const rowsBefore = tracks[0].notes.map(n=>n.row).join(",");
    key("ArrowUp", { shiftKey:true });
    const rowsUp = tracks[0].notes.map(n=>n.row).join(",");
    key("ArrowDown", { shiftKey:true });
    const rowsBack = tracks[0].notes.map(n=>n.row).join(",");

    key("s", { ctrlKey:true });
    const pickOn = pickMode;
    key("s", { ctrlKey:true });
    const pickOff = pickMode;

    key("a", { ctrlKey:true });
    const countBefore = tracks[0].notes.length;
    key("x", { ctrlKey:true });
    const afterCut = tracks[0].notes.length;
    key("z", { ctrlKey:true });
    const afterUndo = tracks[0].notes.length;

    setPlayheadBar(0);
    key("ArrowRight");
    const step = playheadBar;
    key("Home");
    const home = playheadBar;

    return {
      all, rowsBefore, rowsUp, rowsBack,
      pickOn, pickOff,
      countBefore, afterCut, afterUndo,
      step, home
    };
  `);

  check("Ctrl+A로 전체를 고른다", report.all);

  check(
    "Shift+↑ 로 한 옥타브 올라간다",
    report.rowsUp !== report.rowsBefore
  );

  check(
    "Shift+↓ 로 제자리에 돌아온다",
    report.rowsBack === report.rowsBefore,
    report.rowsBack + " ≠ " + report.rowsBefore
  );

  check(
    "Ctrl+S 로 고르기를 켜고 끈다",
    report.pickOn === true && report.pickOff === false
  );

  check(
    "Ctrl+X 로 잘라낸다",
    report.afterCut === 0,
    "남은 노트 " + report.afterCut
  );

  check(
    "Ctrl+Z 로 되돌린다",
    report.afterUndo === report.countBefore,
    report.afterUndo + " ≠ " + report.countBefore
  );

  check(
    "→ 로 한 박 움직인다",
    report.step === 0.25,
    "이동 " + report.step
  );

  check("Home 으로 맨 앞에 간다", report.home === 0);

}


/* ============================================================
   7. 실행취소 기록이 헤프지 않은지
   ============================================================
   한 걸음마다 곡 전체를 복제하던 때가 있었다. 지금은 트랙마다
   글자로 굳혀 두고, 안 바뀐 트랙은 앞의 것을 그대로 가리킨다. */
function testHistoryReuse(win){

  section("실행취소 기록");

  const report = run(win, `
    /* 트랙을 하나 늘려 두 개로 만든다 */
    tracks.push(JSON.parse(JSON.stringify(tracks[0])));

    saveHistory();
    const a = undoStack[undoStack.length - 1];

    tracks[0].notes[0].row += 1;

    saveHistory();
    const b = undoStack[undoStack.length - 1];

    /* 되돌린 뒤 서로 영향을 주지 않는지 */
    undo();
    undo();
    tracks[0].notes[0].row = 99;
    redo();

    return {
      reused: a[1] === b[1],
      renewed: a[0] !== b[0],
      isolated: tracks[0].notes[0].row !== 99
    };
  `);

  check(
    "안 바뀐 트랙은 앞의 기록을 다시 쓴다",
    report.reused
  );

  check(
    "바뀐 트랙만 새로 굳힌다",
    report.renewed
  );

  check(
    "되돌린 기록이 서로 섞이지 않는다",
    report.isolated
  );

}


/* ============================================================
   8. 자동 저장과 되살리기
   ============================================================ */
function testAutosave(win){

  section("자동 저장");

  const report = run(win, `
    writeAutosave();

    const raw = localStorage.getItem(AUTOSAVE_KEY);

    if(!raw){
      return { wrote:false };
    }

    const saved = JSON.parse(raw);

    return {
      wrote: true,
      version: saved.version,
      trackCount: saved.tracks.length,
      hasNotes: !!(saved.tracks[0] && saved.tracks[0].notes.length)
    };
  `);

  check("작업을 브라우저에 적어 둔다", report.wrote);

  if(report.wrote){

    check(
      "판 번호를 함께 적는다",
      report.version === 1,
      "version " + report.version
    );

    check("트랙이 들어 있다", report.trackCount > 0);

    check("노트가 들어 있다", report.hasNotes);

  }

}


/* ============================================================
   9. 좁은 화면의 패널
   ============================================================ */
function testPanel(win){

  section("좁은 화면 패널");

  const report = run(win, `
    const toggle = document.getElementById("inspectorToggle");

    if(!toggle){
      return { exists:false };
    }

    toggle.dispatchEvent(new window.MouseEvent("click", { bubbles:true }));
    const opened = document.body.classList.contains("panel-open");

    document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key:"Escape", bubbles:true })
    );
    const closedByEsc = !document.body.classList.contains("panel-open");

    return { exists:true, opened, closedByEsc };
  `);

  check("패널 단추가 있다", report.exists);

  if(report.exists){

    check("단추로 패널이 열린다", report.opened);

    check("Esc 로 패널이 닫힌다", report.closedByEsc);

  }

}


/* ============================================================
   10. 트랙 층 캐시
   ============================================================
   renderNotes는 안 바뀐 트랙의 층을 재사용한다(수백 ms → 수십 ms).
   재사용이 과하면 낡은 화면이 남고, 모자라면 최적화가 무의미하다.
   양쪽을 다 잰다. */
function testNoteLayers(win){

  section("트랙 층 캐시");

  const report = run(win, `
    setLang("ko");

    addTrack("피아노");
    addTrack("기타");

    tracks[0].notes.push({ bar:0, len:0.25, row:40, techs:[] });
    tracks[1].notes.push({ bar:0.5, len:0.25, row:50, techs:[] });

    selectedTrack = 0;

    normalizeAllNotes();
    refreshAll();

    const layer = i =>
      grid.querySelector('.note-layer[data-track="' + i + '"]');

    const firstNote = i =>
      layer(i) ? layer(i).querySelector(".note") : null;

    const keep = firstNote(1);

    renderNotes();

    const reused =
      firstNote(1) === keep;

    const keepOther = firstNote(0);

    tracks[1].notes[0].row = 55;

    renderNotes();

    const rebuilt =
      firstNote(1) !== keep;

    const untouched =
      firstNote(0) === keepOther;

    const placed =
      firstNote(1).style.top === (55 * ROW_H + 1) + "px";

    focusTrack(1);
    refreshAll();

    const layers =
      [...grid.querySelectorAll(".note-layer")];

    const zOrder =
      layers[layers.length - 1].dataset.track === "1";

    const roles =
      !firstNote(1).classList.contains("other") &&
      firstNote(0).classList.contains("other");

    return { reused, rebuilt, untouched, placed, zOrder, roles };
  `);

  check("안 바뀐 층은 요소를 재사용한다", report.reused);
  check("바뀐 층은 새로 그린다", report.rebuilt);
  check("그때 안 바뀐 층은 손대지 않는다", report.untouched);
  check("새 자리가 실제로 반영된다", report.placed);
  check("트랙을 바꾸면 활성 층이 맨 위로 온다", report.zOrder);
  check("활성/비활성 표시가 함께 갱신된다", report.roles);

}


/* ============================================================
   11. 기법이 확실히 걸리는가
   ============================================================
   "아주 가끔 기법이 안 먹는다"는 신고에서 나온 것들이다. 셋 다
   악기마다 기법 코드가 다르다(스타카토: 피아노 *13, 기타 *7)는
   데서 비롯됐다. */
function testTechniques(win){

  section("기법 적용");

  const report = run(win, `
    setLang("ko");

    tracks.length = 0;

    addTrack("피아노");
    addTrack("기타");

    tracks[1].notes.push({ bar:0, len:0.25, row:40, techs:[] });

    normalizeAllNotes();
    focusTrack(1);
    refreshAll();

    selectedNote = 0;

    /* (1) 메뉴를 피아노 때 그려 둔 채 기타 노트에 누른 상황 */
    applyTechnique("staccato", "*13");

    const stale =
      tracks[1].notes[0].techs.some(
        t => t.role === "staccato" && t.code === "*7"
      );

    const inMml =
      [...document.querySelectorAll(".out-field")]
        .map(f => f.value).join("").includes("*7");

    /* (2) 그 악기에 아예 없는 역할은 조용히 삼키지 않는다 */
    const before = tracks[1].notes[0].techs.length;

    applyTechnique("tremolo", "*1");

    const untouched =
      tracks[1].notes[0].techs.length === before;

    /* (3) 악기를 바꾸면 코드를 갈아 끼운다 */
    tracks.length = 0;
    addTrack("피아노");
    tracks[0].notes.push({ bar:0, len:0.25, row:40, techs:[] });
    normalizeAllNotes();
    focusTrack(0);
    refreshAll();
    selectedNote = 0;

    applyTechnique("staccato", "*13");
    applyTechnique("fermata", "[2]");

    changeTrackInstrument("기타");

    const remapped =
      tracks[0].notes[0].techs.some(
        t => t.role === "staccato" && t.code === "*7"
      );

    const dropped =
      !tracks[0].notes[0].techs.some(
        t => t.role === "fermata"
      );

    /* (4) 되돌리기 뒤 낡은 선택이 남지 않는다 */
    multiSelection.clear();
    multiSelection.add(0);

    saveHistory();
    tracks[0].notes[0].row = 50;
    undo();

    const cleared =
      multiSelection.size === 0;

    return { stale, inMml, untouched, remapped, dropped, cleared };
  `);

  check("악기가 다르면 역할로 코드를 다시 찾는다", report.stale);
  check("그 결과가 MML에도 나온다", report.inMml);
  check("없는 기법은 노트를 건드리지 않는다", report.untouched);
  check("악기를 바꾸면 코드를 갈아 끼운다", report.remapped);
  check("새 악기에 없는 역할만 뗀다", report.dropped);
  check("되돌리기 뒤 낡은 선택이 남지 않는다", report.cleared);

}


/* ============================================================
   12. 화음을 통째로 다루기
   ============================================================
   화음은 구성음이 함께 움직여야 한다. 하나만 길어지거나 하나만
   이어지면 MML로 적을 수 없는 모양이 된다. */
function testChordEditing(win){

  section("화음 통째로 편집");

  const report = run(win, `
    setLang("ko");

    const mml = () =>
      [...document.querySelectorAll(".out-field")]
        .map(f => f.value).join("");

    const fresh = rows => {
      tracks.length = 0;
      addTrack("피아노");
      rows.forEach(
        row => tracks[0].notes.push({ bar:0, len:0.25, row, techs:[] })
      );
      normalizeAllNotes();
      refreshAll();
    };

    const pickAll = () => {
      multiSelection.clear();
      tracks[0].notes.forEach((n,i) => multiSelection.add(i));
      selectedNote = tracks[0].notes.length - 1;
    };

    /* (1) 길이 버튼이 고른 전부에 걸린다 */
    fresh([40, 44, 47]);
    pickAll();
    changeSelectedNoteLength("2");

    const allHalf =
      tracks[0].notes.every(n => Math.abs(n.len - 0.5) < 1e-9);

    /* (2) 하나라도 막히면 통째로 취소 */
    tracks[0].notes.push({ bar:0.75, len:0.25, row:52, techs:[] });
    normalizeAllNotes();
    refreshAll();

    multiSelection.clear();
    [0,1,2].forEach(i => multiSelection.add(i));
    selectedNote = 2;

    const lensBefore =
      tracks[0].notes.map(n => n.len).join(",");

    changeSelectedNoteLength("1");

    const cancelled =
      tracks[0].notes.map(n => n.len).join(",") === lensBefore;

    /* (3) 화음 구성음을 전부 고르면 이음줄이 걸린다 */
    fresh([40, 44]);

    multiSelection.clear();
    multiSelection.add(0);
    selectedNote = 0;

    changeSelectedNoteLength("tie");

    const partialRefused =
      !tracks[0].notes[0].tie;

    pickAll();
    changeSelectedNoteLength("tie");

    const tiedText = mml();

    const parsed = parseMml(tiedText);

    const mergedRight =
      parsed.groups.length === 1 &&
      parsed.groups[0].notes.length === 2 &&
      parsed.groups[0].notes.every(n => n.ticks === 192);

    /* (3-2) 이은 화음을 다시 누르면 끊긴다 (늘어나면 안 된다) */
    fresh([40, 44]);
    pickAll();
    changeSelectedNoteLength("tie");

    const afterTie =
      tracks[0].notes.length;

    changeSelectedNoteLength("tie");

    const untied =
      tracks[0].notes.every(n => !n.tie) &&
      tracks[0].notes.length === afterTie;

    /* (3-3) 이음줄 사슬에 길이 버튼 — 먼저 합친 뒤 그 길이가 된다 */
    tracks.length = 0;
    addTrack("피아노");
    tracks[0].notes.push({ bar:0, len:.5, row:40, techs:[], tie:true });
    tracks[0].notes.push({ bar:.5, len:.5, row:40, techs:[] });
    normalizeAllNotes();
    clearMultiSelection();
    refreshAll();

    multiSelection.clear();
    multiSelection.add(0);
    selectedNote = 0;

    changeSelectedNoteLength("4");

    const chainOne =
      tracks[0].notes.length === 1 &&
      Math.abs(tracks[0].notes[0].len - 0.25) < 1e-9;

    /* (4) 손잡이: 같은 자리·같은 길이 화음만 함께 움직인다 */
    const fire = (type, x, target) =>
      target.dispatchEvent(
        new window.MouseEvent(type, {
          bubbles:true, cancelable:true, button:0, clientX:x, clientY:10
        })
      );

    const dragEnd = (rows, pick, delta) => {
      tracks.length = 0;
      addTrack("피아노");
      rows.forEach(
        ([bar, len, row]) =>
          tracks[0].notes.push({ bar, len, row, techs:[] })
      );
      normalizeAllNotes();
      refreshAll();
      multiSelection.clear();
      pick.forEach(i => multiSelection.add(i));
      selectedNote = pick[0];
      const el = document.querySelector('.note[data-index="0"]');
      const handle = el.querySelector('.note-resize-handle[data-side="end"]');
      const box = el.getBoundingClientRect();
      fire("pointerdown", box.right - 1, handle);
      const partners = pointerState ? pointerState.partners.length : -1;
      fire("pointermove", box.right - 1 + BAR_W * delta, el);
      fire("pointerup", box.right - 1 + BAR_W * delta, el);
      return { partners, lens: tracks[0].notes.map(n => +n.len.toFixed(4)) };
    };

    /* 가장 흔한 실제 순서: 선택 켬 → 노트를 클릭해 고름 → 선택 끔 → 끝을 잡음.
       선택을 끌 때 고른 것이 지워지면 여기서 하나만 움직인다. */
    const realFlow = (function(){
      tracks.length = 0;
      addTrack("피아노");
      [40,44,47].forEach(row => tracks[0].notes.push({ bar:1, len:.5, row, techs:[] }));
      normalizeAllNotes();
      clearMultiSelection();
      refreshAll();
      setPickMode(false, true);
      wasDragging = false;

      const note = i => document.querySelector('.note[data-index="' + i + '"]');
      const mid = el => { const b = el.getBoundingClientRect(); return (b.left + b.right) / 2; };
      const click = el => { fire("pointerdown", mid(el), el); fire("pointerup", mid(el), el); };

      document.getElementById("selectMode").click();
      click(note(0)); click(note(1)); click(note(2));
      document.getElementById("selectMode").click();

      const kept = multiSelection.size;

      const el = note(0);
      const box = el.getBoundingClientRect();
      fire("pointerdown", box.right - 4, el);
      const partners = pointerState ? pointerState.partners.length : -1;
      fire("pointermove", box.right - 4 + BAR_W * 0.25, el);
      fire("pointerup", box.right - 4 + BAR_W * 0.25, el);
      return { kept, partners, lens: tracks[0].notes.map(n => +n.len.toFixed(4)) };
    })();

    const chord = dragEnd([[1,.5,40],[1,.5,44],[1,.5,47]], [0,1,2], 0.25);

    /* 손잡이 요소가 아니라 끝 근처(가장자리 영역)를 잡아도 같아야 한다.
       실제로는 이쪽이 훨씬 흔하다 — 손잡이는 몇 px뿐이다. */
    const edge = (function(){
      tracks.length = 0;
      addTrack("피아노");
      [40,44].forEach(row => tracks[0].notes.push({ bar:1, len:.5, row, techs:[] }));
      normalizeAllNotes();
      refreshAll();
      multiSelection.clear();
      [0,1].forEach(i => multiSelection.add(i));
      selectedNote = 0;
      const el = document.querySelector('.note[data-index="0"]');
      const box = el.getBoundingClientRect();
      fire("pointerdown", box.right - 4, el);
      const partners = pointerState ? pointerState.partners.length : -1;
      fire("pointermove", box.right - 4 + BAR_W * 0.25, el);
      fire("pointerup", box.right - 4 + BAR_W * 0.25, el);
      return { partners, lens: tracks[0].notes.map(n => +n.len.toFixed(4)) };
    })();
    const chordShrink = dragEnd([[1,.5,40],[1,.5,44]], [0,1], -0.25);
    const unevenLen = dragEnd([[1,.5,40],[1,.75,44]], [0,1], 0.25);
    const otherPlace = dragEnd([[1,.5,40],[2,.5,44]], [0,1], 0.25);

    return {
      allHalf, cancelled, partialRefused, mergedRight, tiedText,
      chord, chordShrink, unevenLen, otherPlace, edge, realFlow,
      untied, chainOne
    };
  `);

  check("길이 버튼이 고른 전부에 걸린다", report.allHalf);
  check("하나라도 막히면 통째로 취소한다", report.cancelled);
  check("화음 구성음 하나만으로는 못 잇는다", report.partialRefused);

  check(
    "화음을 전부 고르면 이어지고 하나의 긴 화음이 된다",
    report.mergedRight,
    report.tiedText
  );

  check(
    "손잡이: 같은 화음은 함께 늘어난다",
    report.chord.partners === 2 &&
    report.chord.lens.every(l => l === 0.75),
    JSON.stringify(report.chord)
  );

  check("이은 화음을 다시 누르면 끊긴다", report.untied);

  check(
    "이음줄 사슬에 길이 버튼을 누르면 하나로 합쳐 그 길이가 된다",
    report.chainOne
  );

  check(
    "선택 모드를 꺼도 고른 것이 남아 화음이 함께 움직인다",
    report.realFlow.kept === 3 &&
    report.realFlow.partners === 2 &&
    report.realFlow.lens.every(l => l === 0.75),
    JSON.stringify(report.realFlow)
  );

  check(
    "끝 근처를 잡아도(손잡이 요소가 아니어도) 화음이 함께 움직인다",
    report.edge.partners === 1 &&
    report.edge.lens.every(l => l === 0.75),
    JSON.stringify(report.edge)
  );

  check(
    "손잡이: 같은 화음은 함께 줄어든다",
    report.chordShrink.partners === 1 &&
    report.chordShrink.lens.every(l => l === 0.25),
    JSON.stringify(report.chordShrink)
  );

  check(
    "손잡이: 길이가 다르면 잡은 음만",
    report.unevenLen.partners === 0 &&
    report.unevenLen.lens.join() === "0.75,0.75",
    JSON.stringify(report.unevenLen)
  );

  check(
    "손잡이: 자리가 다르면 잡은 음만",
    report.otherPlace.partners === 0 &&
    report.otherPlace.lens.join() === "0.75,0.5",
    JSON.stringify(report.otherPlace)
  );


}


/* ============================================================
   13. 이음줄 사슬은 하나로 다룬다
   ============================================================
   c2&c4 는 화면에 막대 하나다. 복사·삭제·이동이 머리 토막만 다루면
   붙여넣은 음이 짧아지고, 지운 자리에 꼬리가 남아 "잘린" 것처럼
   보인다. */
function testTieChainHandling(win){

  section("이음줄 사슬");

  const report = run(win, `
    setLang("ko");

    const fresh = () => {
      tracks.length = 0;
      addTrack("피아노");
      tracks[0].notes.push({ bar:0, len:0.5, row:40, techs:[], tie:true });
      tracks[0].notes.push({ bar:0.5, len:0.25, row:40, techs:[] });
      normalizeAllNotes();
      refreshAll();
    };

    /* (1) 복사는 사슬 전체, 붙여넣기는 이음줄까지 */
    fresh();
    selectedNote = 0;
    multiSelection.clear();
    copyNotesButton.click();

    const copiedAll =
      clipboard.length === 2 && clipboard[0].tie === true;

    /* (2) 삭제는 꼬리까지 */
    fresh();
    selectedNote = 0;
    multiSelection.clear();
    noteDeleteButton.click();

    const deletedAll =
      tracks[0].notes.length === 0;

    /* (3) 옮기기는 꼬리까지 */
    fresh();
    setPickMode(false);
    multiSelection.clear();
    multiSelection.add(0);
    selectedNote = 0;

    const movingCount = (function(){
      liftNotesForMove(
        new window.MouseEvent("pointerdown", { clientX:0, clientY:0 }),
        0,
        false
      );
      const n = ghost ? ghost.items.length : 0;
      discardGhost();
      return n;
    })();

    /* (4) 붙여넣기: 이음줄과 길이가 그대로 온다 */
    fresh();
    selectedNote = 0;
    multiSelection.clear();
    copyNotesButton.click();

    tracks.length = 0;
    addTrack("피아노");
    refreshAll();

    startGhost(clipboard.map(item => ({ ...item })), { bar:2, row:40 });
    commitGhost();

    const pasted = tracks[0].notes;

    const pastedRight =
      pasted.length === 2 &&
      pasted[0].tie === true &&
      Math.abs(pasted[0].len - 0.5) < 1e-9 &&
      Math.abs(pasted[1].len - 0.25) < 1e-9 &&
      Math.abs((pasted[0].bar + pasted[0].len) - pasted[1].bar) < 1e-9;

    const pastedMml =
      [...document.querySelectorAll(".out-field")].map(f => f.value).join("");

    return { copiedAll, deletedAll, movingCount, pastedRight, pastedMml };
  `);

  check("복사는 사슬 전체를 이음줄째 담는다", report.copiedAll);
  check("삭제는 꼬리까지 지운다", report.deletedAll);
  check("옮기기는 꼬리까지 든다", report.movingCount === 2, "든 개수 " + report.movingCount);
  check("붙여넣으면 길이와 이음줄이 그대로 온다", report.pastedRight, report.pastedMml);

}


/* ============================================================
   14. 1/96 눈금으로 늘리고 줄이기
   ============================================================
   자리 눈금(SNAP)과 같은 1/96마디 단위로 길이가 움직여야 한다.
   정확히 적히는 길이는 손을 놓을 때 이음줄 토막으로 갈라지므로
   사슬 합계로 잰다. */
function testFineResize(win){

  section("1/96 눈금 길이 조절");

  const report = run(win, `
    applyZoom(6);

    const fire = (type, x, target) =>
      target.dispatchEvent(
        new window.MouseEvent(type, {
          bubbles:true, cancelable:true, button:0, clientX:x, clientY:10
        })
      );

    const tick = n => Math.round(n * WHOLE);

    const total = () =>
      tieChainIndexes(tracks[0], 0)
        .reduce((a, i) => a + tracks[0].notes[i].len, 0);

    const chainEnd = () => {
      const ix = tieChainIndexes(tracks[0], 0);
      const last = tracks[0].notes[ix[ix.length - 1]];
      return last.bar + last.len;
    };

    const setup = () => {
      tracks.length = 0;
      addTrack("피아노");
      tracks[0].notes.push({ bar:1, len:.5, row:40, techs:[] });
      tracks[0].notes.push({ bar:3, len:.25, row:44, techs:[] });
      normalizeAllNotes();
      clearMultiSelection();
      refreshAll();
      wasDragging = false;
    };

    const nudge = (side, dir) => {
      const el = document.querySelector('.note[data-index="0"]');
      const b = el.getBoundingClientRect();
      const x = side === "end" ? b.right - 4 : b.left + 4;
      fire("pointerdown", x, el);
      fire("pointermove", x + dir * BAR_W * SNAP, el);
      fire("pointerup", x + dir * BAR_W * SNAP, el);
    };

    setup();
    const grow = [];
    for(let k = 0; k < 3; k++){ nudge("end", +1); grow.push(tick(total())); }

    setup();
    const front = [];
    for(let k = 0; k < 3; k++){ nudge("start", -1); front.push(tick(tracks[0].notes[0].bar) + "~" + tick(chainEnd())); }

    setup();
    nudge("end", +1);
    const text = [...document.querySelectorAll(".out-field")].map(f => f.value).join("");
    const parsed = parseMml(text);
    const starts = parsed.groups.filter(g => g.notes.some(n => !n.rest)).map(g => g.start);

    return { grow, front, starts, text };
  `);

  check("뒤로 한 눈금씩: 4틱씩 늘어난다", report.grow.join() === "196,200,204", report.grow.join());
  check("앞으로 한 눈금씩: 끝을 붙잡고 시작만 4틱씩", report.front.join() === "380~576,376~576,372~576", report.front.join());
  check("MML에서 뒤 음의 자리가 흔들리지 않는다", report.starts.join() === "384,1152", report.text);

}


/* ============================================================
   15. 이음줄 꼬리는 길을 막지 않는다 · 단축키 방향
   ============================================================ */
function testChainSpansAndKeys(win){

  section("이음줄 꼬리와 단축키");

  const report = run(win, `
    setLang("ko");

    /* (1) 옆 구성음의 꼬리 토막이 늘리기를 막으면 안 된다 */
    tracks.length = 0;
    addTrack("피아노");
    for(const row of [40, 44]){
      tracks[0].notes.push(
        { bar:1, len:.25, row, techs:[], tie:true },
        { bar:1.25, len:1/6, row, techs:[], tie:true },
        { bar:1.25 + 1/6, len:.09375, row, techs:[] }
      );
    }
    normalizeAllNotes();
    clearMultiSelection();
    refreshAll();

    const head40 = tracks[0].notes.find(n => n.row === 40 && Math.round(n.bar * WHOLE) === 384);
    const room = roomAt(noteSpans(tracks[0], head40), head40.bar);
    const notBlocked = room > 0.6;   // 뒤에 아무것도 없으니 넉넉해야 한다

    /* (2) 떠 있는 동안 사슬은 한 막대 */
    multiSelection.clear();
    tracks[0].notes.forEach((n, i) => multiSelection.add(i));
    liftNotesForMove(new window.MouseEvent("pointerdown", { clientX:0, clientY:0 }), 0, false);
    const ghostBars = document.querySelectorAll(".note.ghost").length;
    const ghostPieces = ghost ? ghost.items.length : 0;
    discardGhost();

    /* (3) Shift+↑ 는 올라간다 */
    tracks.length = 0;
    addTrack("피아노");
    tracks[0].notes.push({ bar:0, len:.25, row:60, techs:[] });
    normalizeAllNotes();
    clearMultiSelection();
    refreshAll();
    selectedNote = 0;
    const k0 = rowToKey(tracks[0].notes[0].row);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key:"ArrowUp", shiftKey:true, bubbles:true, cancelable:true }));
    const k1 = rowToKey(tracks[0].notes[0].row);

    /* (4) 맥의 Option+T (key "†") 도 트랙 추가에 닿는다 */
    let reached = false;
    const orig = trackAddButton.click.bind(trackAddButton);
    trackAddButton.click = () => { reached = true; orig(); };
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key:"†", code:"KeyT", altKey:true, bubbles:true, cancelable:true }));
    trackAddButton.click = orig;

    return { notBlocked, room, ghostBars, ghostPieces, up: k1 - k0, reached };
  `);

  check("옆 구성음의 이음줄 꼬리가 늘리기를 막지 않는다", report.notBlocked, "room " + report.room);
  check("떠 있는 동안 사슬은 한 막대로 보인다", report.ghostBars === 2 && report.ghostPieces === 6, report.ghostBars + "/" + report.ghostPieces);
  check("Shift+↑ 는 한 옥타브 올라간다", report.up === 12, "변화 " + report.up);
  check("맥의 Option+T 도 트랙 추가에 닿는다", report.reached);

}


/* ============================================================
   16. 기법이 미리듣기에 반영되는가
   ============================================================
   "기법을 걸었는데 재생하면 평음만 난다"는 신고에서 나왔다.
   재생 코드가 기법을 아예 보지 않았다. */
function testTechniquePlayback(win){

  section("기법 미리듣기");

  const report = run(win, `
    const ctx = new AudioContext();
    playback = { ctx, master: ctx.createGain(), nodes: [] };

    const base = { at:0, until:0.5, key:60, velocity:12, percussion:false, voice:VOICES["피아노"], trackIndex:0 };

    const play = techs => {
      __audioLog.length = 0;
      playOne(ctx, { ...base, techs }, 1);
      return __audioLog.slice();
    };

    const peak = l => Math.max(...l.filter(e => e[0] === "gain" && e[1] === "exp").map(e => e[2]));
    const firstStop = l => Math.min(...l.filter(e => e[0] === "osc" && e[1] === "stop").map(e => e[3]));
    const starts = l => [...new Set(l.filter(e => e[0] === "osc" && e[1] === "start").map(e => +e[3].toFixed(3)))];

    const plain = play([]);
    const stac = play(["staccato"]);
    const acc = play(["accent"]);
    const grace = play(["graceUp"]);
    const bend = play(["bendUp"]);
    const vib = play(["vibrato"]);

    return {
      staccatoShorter: firstStop(stac) < firstStop(plain),
      accentLouder: peak(acc) > peak(plain) * 1.3,
      graceStarts: starts(grace),
      bendDetune: bend.filter(e => e[0] === "detune").length >= 2,
      vibratoLfo: starts(vib).length >= 1 && vib.filter(e => e[0] === "osc" && e[1] === "start").length > plain.filter(e => e[0] === "osc" && e[1] === "start").length
    };
  `);

  check("스타카토는 짧게 끊긴다", report.staccatoShorter);
  check("악센트는 더 세다", report.accentLouder);
  check("꾸밈음은 본음 앞에 따로 울리고 본음이 늦게 시작한다", report.graceStarts.length === 2, report.graceStarts.join(","));
  check("벤드는 음정이 미끄러진다", report.bendDetune);
  check("비브라토는 흔드는 발진기가 하나 더 붙는다", report.vibratoLfo);

}


/* ============================================================
   달린다
   ============================================================ */
function main(){

  const midi = makeTestMidi();

  testWorkerSync();
  testNoteNotClipped();

  const win = boot();

  testDictionary(win);
  testMidiImport(win, midi);
  testLanguageDoesNotChangeMml(win);
  testSelectionAndMove(win);
  testShortcuts(win);
  testHistoryReuse(win);
  testAutosave(win);
  testPanel(win);
  testNoteLayers(win);
  testTechniques(win);
  testChordEditing(win);
  testTieChainHandling(win);
  testFineResize(win);
  testChainSpansAndKeys(win);
  testTechniquePlayback(win);

  console.log("");

  if(failures.length){

    console.log(
      "실패 " + failures.length + "개 / 통과 " + passed + "개"
    );

    for(const line of failures){

      console.log("  - " + line);

    }

    process.exit(1);

  }

  console.log("모두 통과 — " + passed + "개");

}


main();
