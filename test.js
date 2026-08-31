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

  /* 소리는 시험 대상이 아니므로 흉내만 낸다 */
  win.AudioContext = function(){

    return {
      state: "running",
      currentTime: 0,
      destination: {},
      createGain(){
        return {
          gain: {
            value: 0,
            setValueAtTime(){},
            exponentialRampToValueAtTime(){},
            cancelScheduledValues(){}
          },
          connect(){},
          disconnect(){}
        };
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
