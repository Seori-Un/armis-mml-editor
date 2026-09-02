/* ============================================================
   말 바꾸기 (i18n)
   ============================================================
   화면에 나오는 모든 글을 여기 한곳에 모아 둔다.
   app.js는 t("키")로만 부르고, 어떤 말로 나갈지는 이 파일이 정한다.

   쓰는 법
     t("play.noTracks")                 → 그냥 꺼내 쓴다
     t("select.picked", { n: 12 })      → {n} 자리에 값을 끼운다

   화면(index.html)에 있는 글은 표시만 달아 두면 알아서 채워진다.
     <button data-i18n="toolbar.undo">되돌리기</button>
     <button data-i18n-title="toolbar.undoTip">…</button>
     <span data-i18n-html="rail.empty">…</span>   ← <br> 같은 걸 넣을 때

   악기 이름은 번역해도 "보이는 글자"만 바뀐다. 프로그램 안에서는
   언제나 한국어 이름("피아노")을 열쇠로 쓴다 — 기법표도, MML 변환도
   그 이름으로 찾기 때문에 여기서 바꾸면 곡이 깨진다.
   ============================================================ */

const I18N_LANGS = [
  { code:"ko", label:"한국어" },
  { code:"en", label:"English" },
  { code:"ja", label:"日本語" },
  { code:"zh", label:"中文" }
];


const I18N = {

/* ------------------------------------------------------------
   한국어
------------------------------------------------------------ */
ko:{

  "lang.name":"한국어",

  "midi.modeTitle":"합주곡인가요, 솔로곡인가요?",
  "midi.modeText":"솔로(악기 하나)면 파트를 전부 합쳐 세 트랙으로 고르게 나눕니다. 한 사람이 트랙 셋으로 다 연주할 수 있게 트랙마다 3000자 안에 맞춥니다. 합주면 MIDI의 파트를 그대로 둡니다.",
  "midi.modeSolo":"솔로 (한 사람이 연주)",
  "midi.modeEnsemble":"합주 (여러 악기)",

  "out.charsTip":"게임이 세는 글자 수(음표+쉼표) {n} / 최대 {max} · 문자열 길이 {raw}",
  "out.charsOverTip":"게임 한도 {max}를 넘었습니다({n}). 붙여넣으면 뒤가 잘립니다.",

  "toolbar.barPrevTip":"한 마디 뒤로 (Ctrl+←)",
  "toolbar.barNextTip":"한 마디 앞으로 (Ctrl+→)",
  "toolbar.barStartTip":"맨 처음으로 (Home)",
  "toolbar.barEndTip":"곡의 맨 끝으로 (End)",
  "toolbar.pauseTip":"일시정지 — 다시 누르면 이어서 재생",
  "board.timeTip":"재생 머리 위치 / 곡 전체 길이",

  "tech.replacedPost":"* 기법은 한 음에 하나만 붙습니다. 해제됨: {list}",

  "note.someBlocked":"고른 음 중 그 길이가 들어가지 않는 음이 있어 바꾸지 않았습니다.",
  "tie.chordPartial":"화음은 구성음을 모두 골라야 이을 수 있습니다.",
  "tie.chordUneven":"화음 구성음의 길이가 서로 달라 이을 수 없습니다.",

  "tech.droppedOnChange":"이 악기에 없는 기법은 해제되었습니다: {list}",

  "tech.notAvailable":"이 악기에는 없는 기법입니다.",

  "toolbar.insertBars":"마디<br>삽입",
  "toolbar.insertBarsTip":"재생 머리 자리에 빈 마디를 끼웁니다 (Ctrl+B)",
  "toolbar.removeBars":"마디<br>삭제",
  "toolbar.removeBarsTip":"재생 머리 자리부터 마디를 들어냅니다 (Ctrl+Shift+B)",
  "bars.insertTitle":"{bar}마디 앞에 빈 마디를 끼울까요?",
  "bars.insertText":"뒤쪽 노트와 마커가 모두 그만큼 밀립니다. 끼우는 자리에 걸쳐 있던 음은 그 자리에서 둘로 나뉩니다.",
  "bars.removeTitle":"{bar}마디부터 들어낼까요?",
  "bars.removeText":"그 구간의 노트와 마커가 사라지고 뒤쪽이 당겨집니다. 실행취소(Ctrl+Z)로 되돌릴 수 있습니다.",
  "bars.inserted":"{n}마디를 끼웠습니다.",
  "bars.removed":"{n}마디를 들어냈습니다. (노트 {notes}개)",

  "marker.copiedVelocity":"세기 마커 v{value} 를 복사했습니다.",
  "marker.copiedTempo":"템포 마커 {value} 를 복사했습니다.",
  "marker.pasted":"재생 머리 자리에 붙였습니다.",
  "marker.pastedSplit":"붙이면서 음 {n}개를 나눴습니다.",

  "inspector.cutTip":"자르기 — 재생 머리(노란 선)가 지나는 자리에서 음을 나눕니다 (Ctrl+K)",
  "cut.nothing":"노란 선에 걸친 음이 없습니다.",
  "cut.done":"{n}개를 나눴습니다.",

  "toolbar.panel":"패널",
  "toolbar.panelTip":"세기 · 기법 · 템포 패널 열기",
  "inspector.title":"패널",
  "common.close":"닫기",

  "app.title":"아르미스 MML 편집기",

  "common.ok":"확인",
  "common.cancel":"취소",
  "common.delete":"삭제",
  "common.keep":"그대로 두기",
  "common.done":"완료",
  "common.copy":"복사",
  "common.copyNamed":"{name} 복사",
  "common.confirm":"confirm",

  "toolbar.saveFile":"저장",
  "toolbar.saveFileTip":"지금 작업을 파일로 내려받습니다",
  "toolbar.openFile":"열기",
  "toolbar.openFileTip":"저장해 둔 작업 파일을 불러옵니다",
  "file.exported":"파일로 저장했습니다.",
  "file.imported":"{name} 을(를) 불러왔습니다.",
  "file.importFail":"이 파일은 읽을 수 없습니다.",
  "file.nothingToSave":"저장할 트랙이 없습니다.",
  "restore.done":"이전 작업을 이어서 불러왔습니다.",
  "restore.failed":"이전 작업을 되살리지 못했습니다.",
  "autosave.full":"자동 저장 공간이 가득 찼습니다. 파일로 저장해 두세요.",
  "toolbar.openMidi":"midi 파일 선택",
  "toolbar.noFile":"불러온 파일이 없습니다",
  "toolbar.undo":"되돌<br>리기",
  "toolbar.undoTip":"실행취소",
  "toolbar.redo":"다시<br>하기",
  "toolbar.redoTip":"다시하기",
  "toolbar.technique":"기법",
  "toolbar.techniqueTip":"현재 악기의 기법 선택",
  "toolbar.noteAdd":"+",
  "toolbar.noteAddTip":"노트 추가 — 가운데에 뜬 뒤 끌어다 놓습니다",
  "toolbar.noteDelete":"삭제",
  "toolbar.noteDeleteTip":"선택한 노트 또는 마커 또는 트랙 삭제",
  "toolbar.select":"선택",
  "toolbar.selectTip":"여러 개 고르기 — 노트를 눌러 담거나 빼고, 빈 곳을 끌어 감쌉니다 (Ctrl+클릭과 같음)",
  "toolbar.copy":"복사",
  "toolbar.copyTip":"고른 노트 복사",
  "toolbar.paste":"붙여<br>넣기",
  "toolbar.pasteTip":"붙여넣기 — 가운데에 뜬 뒤 끌어다 놓습니다",
  "toolbar.playTip":"재생",
  "toolbar.stopTip":"정지",
  "toolbar.zoomOut":"축소",
  "toolbar.zoomIn":"확대",
  "toolbar.zoomReset":"클릭하면 100%로",
  "toolbar.language":"언어",

  "rail.title":"트랙",
  "rail.addTrack":"트랙 추가",
  "rail.empty":"midi 파일을 불러오거나, 아래에서 악기를 골라 트랙을 만드세요.",

  "board.octave":"옥타브",
  "board.timeTable":"타임 테이블",
  "board.tempoTip":"클릭하여 템포 직접 입력",
  "board.tempoInput":"템포 직접 입력",

  "inspector.noteLength":"음표 길이",
  "inspector.triplet":"셋잇단",
  "inspector.dotTie":"점 · 이음줄",
  "inspector.dotTip":"점음표 — 길이를 1.5배로. 셋잇단에도 붙는다",
  "inspector.tieTip":"이음줄 — 뒤 음과 이어 한 소리로. 이어질 음이 없으면 새로 만든다",
  "inspector.tripletHalf":"2분음표 셋잇단",
  "inspector.tripletQuarter":"4분음표 셋잇단",
  "inspector.tripletEighth":"8분음표 셋잇단",
  "inspector.tripletSixteenth":"16분음표 셋잇단",
  "inspector.tripletThirtySecond":"32분음표 셋잇단",
  "inspector.velocity":"세기",
  "inspector.velocityAria":"벨로시티",
  "inspector.tempo":"템포",
  "inspector.tempoDown":"템포 내리기",
  "inspector.tempoUp":"템포 올리기",
  "inspector.tempoDirect":"클릭하여 직접 입력",
  "inspector.technique":"기법",

  "menu.technique":"기법",
  "menu.instrument":"악기",
  "menu.instrumentChange":"아르미스 악기 바꾸기",
  "menu.markerStack":"같은 자리의 마커",

  "outputResize.tip":"끌어서 출력 창 높이 조절",

  "time.position":"{m}마디 {b}박",
  "out.chars":"{n}자",
  "out.empty":"midi 파일을 불러오거나 트랙을 추가하면 MML이 여기에 나옵니다.",
  "out.noSelection":"왼쪽에서 트랙을 고르면 MML이 여기에 나옵니다.",
  "out.placeholder":"MML을 여기에 붙여 넣으면 위에 노트로 그려집니다",

  "marker.stacked":"{n}개가 겹쳐 있습니다. 눌러서 고르세요.",

  "note.selectFirst":"먼저 노트를 선택하세요.",
  "note.floatingRemoved":"떠 있던 노트를 지웠습니다.",
  "note.removed":"{n}개 지웠습니다.",
  "note.maxLength":"뒤에 다른 음이 있어 {n}분음표까지만 들어갑니다.",
  "note.handleStart":"앞을 잡고 끌어 시작 위치와 길이 조절",
  "note.handleEnd":"끝을 잡고 끌어 길이 조절",

  "tie.broken":"이음줄을 끊었습니다.",
  "tie.chordOnly":"화음은 이을 수 없습니다. 홑음에서만 됩니다.",
  "tie.otherNote":"그 자리에는 다른 음이 있습니다. 같은 음정이어야 이을 수 있습니다.",
  "tie.noRoom":"이을 자리가 없습니다.",

  "tech.noneForInstrument":"이 악기에 등록된 기법이 없습니다.",
  "tech.noneShort":"사용 가능한 기법 없음",

  "track.selectFirst":"먼저 트랙을 고르세요.",
  "track.minOne":"트랙은 최소 1개가 필요합니다.",
  "track.deleteTitle":"{name} 트랙을 삭제할까요?",
  "track.deleteText":"이 트랙의 노트와 마커가 함께 사라집니다. 실행취소(Ctrl+Z)로 되돌릴 수 있습니다.",

  "select.picked":"{n}개 골랐습니다.",
  "select.none":"고른 노트가 없습니다.",

  "copy.selectFirst":"복사할 노트를 먼저 고르세요.",
  "copy.done":"{n}개 복사했습니다.",
  "paste.empty":"복사해 둔 노트가 없습니다.",
  "paste.dragHint":"끌어서 자리를 잡고 손을 놓으세요.",

  "drop.reverted":"제자리로 되돌렸습니다.",
  "drop.cancelled":"놓기를 그만뒀습니다.",
  "drop.invalid":"여기에는 놓을 수 없습니다. 다시 끌어 옮기세요.",

  "mml.badLength":"길이 {n} 는 쓸 수 없습니다.",
  "mml.noNumber":"{pos}번째 글자 뒤에 숫자가 없습니다.",
  "mml.unclosedBracket":"닫히지 않은 [ 가 있습니다.",
  "mml.badChar":"{pos}번째 글자 '{ch}' 를 읽을 수 없습니다.",
  "mml.unclosedTech":"구간 기법 {code} 가 닫히지 않았습니다.",
  "mml.parseFail":"읽지 못했습니다 — {message}",

  "midi.reading":"읽는 중… {name}",
  "midi.noTracks":"{name} — 음표가 있는 트랙을 찾지 못했습니다",
  "midi.parts":" · 파트 {parts}개 중 소리가 있는 {used}개",
  "midi.trackLimit":" (아르미스는 한 사람이 {n}트랙까지입니다)",
  "midi.loadFail":"불러오지 못했습니다 — {message}",
  "midi.workerUnavailable":"미디 변환 워커를 쓸 수 없습니다",

  "play.noTracks":"고른 트랙이 없습니다.",
  "play.nothingAhead":"재생 머리 뒤에 소리가 없습니다.",
  "play.audioLost":"소리가 끊겨 재생을 멈췄습니다. 다시 눌러 주세요.",
  "audio.blocked":"소리를 켜지 못했습니다. 화면을 한 번 누른 뒤 다시 시도해 주세요.",

  "inst.피아노":"피아노",
  "inst.바이올린":"바이올린",
  "inst.고쟁":"고쟁",
  "inst.태평소":"태평소",
  "inst.피리":"피리",
  "inst.베이스":"베이스",
  "inst.기타":"기타",
  "inst.북":"북",
  "inst.드럼":"드럼",
  "inst.퉁소":"퉁소",
  "inst.비파":"비파",
  "inst.이호":"이호",
  "inst.신디사이저":"신디사이저",

  "tn.tremolo":"트레몰로",
  "tn.vibrato":"비브라토",
  "tn.bendUp":"벤드 업",
  "tn.bendDown":"벤드 다운",
  "tn.harmonic":"하모닉스",
  "tn.cluster":"클러스터",
  "tn.cut":"컷",
  "tn.graceUp":"위 꾸밈음",
  "tn.graceDown":"아래 꾸밈음",
  "tn.doubleTongue":"더블 텅잉",
  "tn.tap":"타공음",
  "tn.nogi":"노기",
  "tn.staccato":"스타카토",
  "tn.accent":"악센트",
  "tn.shoutMale":"남성 추임새",
  "tn.shoutFemale":"여성 추임새",
  "tn.flutter":"플러터",
  "tn.bowTremolo":"활 트레몰로",
  "tn.timbre":"음색 변화",
  "tn.mute":"뮤트",
  "tn.pullOff":"풀 오프",
  "tn.hammerOn":"해머 온",
  "tn.fermata":"페르마타",
  "tn.legato":"레가토",
  "tn.glissando":"글리산도"

},


/* ------------------------------------------------------------
   English
------------------------------------------------------------ */
en:{

  "lang.name":"English",

  "midi.modeTitle":"Ensemble or solo?",
  "midi.modeText":"Solo (one instrument) merges every part and splits the notes evenly across three tracks, each kept under 3000 characters so one player can perform it all. Ensemble keeps the MIDI parts as they are.",
  "midi.modeSolo":"Solo (one player)",
  "midi.modeEnsemble":"Ensemble (several instruments)",

  "out.charsTip":"Notes + rests as the game counts them: {n} / max {max} · string length {raw}",
  "out.charsOverTip":"Over the game limit of {max} ({n}). The tail will be cut off when pasted.",

  "toolbar.barPrevTip":"Back one bar (Ctrl+←)",
  "toolbar.barNextTip":"Forward one bar (Ctrl+→)",
  "toolbar.barStartTip":"Jump to start (Home)",
  "toolbar.barEndTip":"Jump to song end (End)",
  "toolbar.pauseTip":"Pause — press again to resume",
  "board.timeTip":"Playhead position / total length",

  "tech.replacedPost":"A note can carry only one * technique. Removed: {list}",

  "note.someBlocked":"Nothing changed — that length does not fit for at least one of the selected notes.",
  "tie.chordPartial":"To tie a chord, select every note in it.",
  "tie.chordUneven":"The notes in this chord have different lengths, so they cannot be tied.",

  "tech.droppedOnChange":"Techniques this instrument does not have were removed: {list}",

  "tech.notAvailable":"This instrument does not have that technique.",

  "toolbar.insertBars":"Insert<br>bars",
  "toolbar.insertBarsTip":"Insert empty bars at the playhead (Ctrl+B)",
  "toolbar.removeBars":"Delete<br>bars",
  "toolbar.removeBarsTip":"Remove bars starting at the playhead (Ctrl+Shift+B)",
  "bars.insertTitle":"Insert empty bars before bar {bar}?",
  "bars.insertText":"Everything after it shifts along, notes and markers alike. A note lying across the seam is split there, and its tail moves with the rest.",
  "bars.removeTitle":"Remove bars from bar {bar}?",
  "bars.removeText":"The notes and markers in that stretch go away and everything after pulls back. Ctrl+Z undoes it.",
  "bars.inserted":"Inserted {n} bars.",
  "bars.removed":"Removed {n} bars ({notes} notes).",

  "marker.copiedVelocity":"Copied velocity marker v{value}.",
  "marker.copiedTempo":"Copied tempo marker {value}.",
  "marker.pasted":"Pasted at the playhead.",
  "marker.pastedSplit":"Pasted, splitting {n} notes.",

  "inspector.cutTip":"Split — cuts notes where the playhead (yellow line) crosses them (Ctrl+K)",
  "cut.nothing":"No note crosses the yellow line.",
  "cut.done":"Split {n} notes.",

  "toolbar.panel":"Panel",
  "toolbar.panelTip":"Open the velocity, technique and tempo panel",
  "inspector.title":"Panel",
  "common.close":"Close",

  "app.title":"Armis MML Editor",

  "common.ok":"OK",
  "common.cancel":"Cancel",
  "common.delete":"Delete",
  "common.keep":"Keep",
  "common.done":"Copied",
  "common.copy":"Copy",
  "common.copyNamed":"Copy {name}",
  "common.confirm":"confirm",

  "toolbar.saveFile":"Save",
  "toolbar.saveFileTip":"Download the current work as a file",
  "toolbar.openFile":"Open",
  "toolbar.openFileTip":"Load a saved work file",
  "file.exported":"Saved to a file.",
  "file.imported":"Loaded {name}.",
  "file.importFail":"This file could not be read.",
  "file.nothingToSave":"There is no track to save.",
  "restore.done":"Picked up where you left off.",
  "restore.failed":"Could not restore the previous work.",
  "autosave.full":"Autosave storage is full. Please save to a file.",
  "toolbar.openMidi":"Open MIDI file",
  "toolbar.noFile":"No file loaded",
  "toolbar.undo":"Undo",
  "toolbar.undoTip":"Undo",
  "toolbar.redo":"Redo",
  "toolbar.redoTip":"Redo",
  "toolbar.technique":"Tech",
  "toolbar.techniqueTip":"Choose a technique for the current instrument",
  "toolbar.noteAdd":"+",
  "toolbar.noteAddTip":"Add a note — it appears in the middle, then drag it into place",
  "toolbar.noteDelete":"Delete",
  "toolbar.noteDeleteTip":"Delete the selected note, marker or track",
  "toolbar.select":"Select",
  "toolbar.selectTip":"Multi-select — click notes to add or remove, or drag across empty space (same as Ctrl+click)",
  "toolbar.copy":"Copy",
  "toolbar.copyTip":"Copy selected notes",
  "toolbar.paste":"Paste",
  "toolbar.pasteTip":"Paste — it appears in the middle, then drag it into place",
  "toolbar.playTip":"Play",
  "toolbar.stopTip":"Stop",
  "toolbar.zoomOut":"Zoom out",
  "toolbar.zoomIn":"Zoom in",
  "toolbar.zoomReset":"Click to reset to 100%",
  "toolbar.language":"Language",

  "rail.title":"tracks",
  "rail.addTrack":"Add track",
  "rail.empty":"Load a MIDI file, or pick an instrument below to create a track.",

  "board.octave":"octave",
  "board.timeTable":"time table",
  "board.tempoTip":"Click to type a tempo",
  "board.tempoInput":"Type a tempo",

  "inspector.noteLength":"note length",
  "inspector.triplet":"triplet",
  "inspector.dotTie":"dot · tie",
  "inspector.dotTip":"Dotted — 1.5× the length. Works on triplets too",
  "inspector.tieTip":"Tie — joins with the next note as one sound. Creates one if there is nothing to join",
  "inspector.tripletHalf":"Half-note triplet",
  "inspector.tripletQuarter":"Quarter-note triplet",
  "inspector.tripletEighth":"Eighth-note triplet",
  "inspector.tripletSixteenth":"Sixteenth-note triplet",
  "inspector.tripletThirtySecond":"Thirty-second-note triplet",
  "inspector.velocity":"velocity",
  "inspector.velocityAria":"Velocity",
  "inspector.tempo":"tempo",
  "inspector.tempoDown":"Lower the tempo",
  "inspector.tempoUp":"Raise the tempo",
  "inspector.tempoDirect":"Click to type a value",
  "inspector.technique":"technique",

  "menu.technique":"technique",
  "menu.instrument":"instrument",
  "menu.instrumentChange":"Change Armis instrument",
  "menu.markerStack":"Markers at this spot",

  "outputResize.tip":"Drag to resize the output panel",

  "time.position":"bar {m}, beat {b}",
  "out.chars":"{n} chars",
  "out.empty":"Load a MIDI file or add a track and the MML will appear here.",
  "out.noSelection":"Choose a track on the left and the MML will appear here.",
  "out.placeholder":"Paste MML here and it will be drawn as notes above",

  "marker.stacked":"{n} markers overlap here. Click to choose one.",

  "note.selectFirst":"Select a note first.",
  "note.floatingRemoved":"Removed the floating note.",
  "note.removed":"Deleted {n} notes.",
  "note.maxLength":"Another note follows, so this fits a 1/{n} note at most.",
  "note.handleStart":"Drag the left edge to move the start and change the length",
  "note.handleEnd":"Drag the right edge to change the length",

  "tie.broken":"Tie removed.",
  "tie.chordOnly":"Chords cannot be tied. Single notes only.",
  "tie.otherNote":"A different note is in the way. Ties need the same pitch.",
  "tie.noRoom":"There is no room to tie.",

  "tech.noneForInstrument":"No techniques are registered for this instrument.",
  "tech.noneShort":"No techniques available",

  "track.selectFirst":"Choose a track first.",
  "track.minOne":"At least one track is required.",
  "track.deleteTitle":"Delete the {name} track?",
  "track.deleteText":"Its notes and markers go with it. You can undo this with Ctrl+Z.",

  "select.picked":"Selected {n} notes.",
  "select.none":"No notes selected.",

  "copy.selectFirst":"Select the notes you want to copy first.",
  "copy.done":"Copied {n} notes.",
  "paste.empty":"Nothing has been copied yet.",
  "paste.dragHint":"Drag it into place and let go.",

  "drop.reverted":"Moved back to where it was.",
  "drop.cancelled":"Drop cancelled.",
  "drop.invalid":"It cannot go here. Drag it somewhere else.",

  "mml.badLength":"Length {n} cannot be used.",
  "mml.noNumber":"No number after character {pos}.",
  "mml.unclosedBracket":"There is an unclosed [.",
  "mml.badChar":"Character {pos} '{ch}' cannot be read.",
  "mml.unclosedTech":"Range technique {code} was never closed.",
  "mml.parseFail":"Could not read it — {message}",

  "midi.reading":"Reading… {name}",
  "midi.noTracks":"{name} — no track with notes was found",
  "midi.parts":" · {used} of {parts} parts have sound",
  "midi.trackLimit":" (Armis allows {n} tracks per player)",
  "midi.loadFail":"Could not load it — {message}",
  "midi.workerUnavailable":"The MIDI conversion worker is unavailable",

  "play.noTracks":"No track is selected.",
  "play.nothingAhead":"There is no sound after the playhead.",
  "play.audioLost":"Audio was interrupted, so playback stopped. Press play again.",
  "audio.blocked":"Could not start audio. Click the page once and try again.",

  "inst.피아노":"Piano",
  "inst.바이올린":"Violin",
  "inst.고쟁":"Guzheng",
  "inst.태평소":"Taepyeongso",
  "inst.피리":"Piri",
  "inst.베이스":"Bass",
  "inst.기타":"Guitar",
  "inst.북":"Buk drum",
  "inst.드럼":"Drums",
  "inst.퉁소":"Tungso",
  "inst.비파":"Pipa",
  "inst.이호":"Erhu",
  "inst.신디사이저":"Synthesizer",

  "tn.tremolo":"Tremolo",
  "tn.vibrato":"Vibrato",
  "tn.bendUp":"Bend up",
  "tn.bendDown":"Bend down",
  "tn.harmonic":"Harmonic",
  "tn.cluster":"Cluster",
  "tn.cut":"Cut",
  "tn.graceUp":"Grace note up",
  "tn.graceDown":"Grace note down",
  "tn.doubleTongue":"Double tonguing",
  "tn.tap":"Tap",
  "tn.nogi":"Nogi",
  "tn.staccato":"Staccato",
  "tn.accent":"Accent",
  "tn.shoutMale":"Shout (male)",
  "tn.shoutFemale":"Shout (female)",
  "tn.flutter":"Flutter tonguing",
  "tn.bowTremolo":"Bow tremolo",
  "tn.timbre":"Timbre shift",
  "tn.mute":"Mute",
  "tn.pullOff":"Pull-off",
  "tn.hammerOn":"Hammer-on",
  "tn.fermata":"Fermata",
  "tn.legato":"Legato",
  "tn.glissando":"Glissando"

},


/* ------------------------------------------------------------
   日本語
------------------------------------------------------------ */
ja:{

  "lang.name":"日本語",

  "midi.modeTitle":"合奏曲ですか、ソロ曲ですか？",
  "midi.modeText":"ソロ（楽器一つ）なら全パートを合わせて3トラックに均等に分けます。一人で3トラックを演奏できるよう、各トラック3000文字以内に収めます。合奏ならMIDIのパートをそのまま使います。",
  "midi.modeSolo":"ソロ（一人で演奏）",
  "midi.modeEnsemble":"合奏（複数の楽器）",

  "out.charsTip":"ゲームが数える文字数（音符＋休符）{n} / 最大 {max} · 文字列長 {raw}",
  "out.charsOverTip":"ゲームの上限 {max} を超えています（{n}）。貼り付けると末尾が切れます。",

  "toolbar.barPrevTip":"1小節戻る（Ctrl+←）",
  "toolbar.barNextTip":"1小節進む（Ctrl+→）",
  "toolbar.barStartTip":"最初へ（Home）",
  "toolbar.barEndTip":"曲の最後へ（End）",
  "toolbar.pauseTip":"一時停止 — もう一度押すと続きから",
  "board.timeTip":"再生位置 / 曲全体の長さ",

  "tech.replacedPost":"* 系の奏法は一音に一つだけです。外しました: {list}",

  "note.someBlocked":"選んだ音の中に入らないものがあるため、変更しませんでした。",
  "tie.chordPartial":"和音をつなぐには構成音をすべて選んでください。",
  "tie.chordUneven":"和音の構成音の長さが違うためつなげません。",

  "tech.droppedOnChange":"この楽器にない奏法は外しました: {list}",

  "tech.notAvailable":"この楽器にはない奏法です。",

  "toolbar.insertBars":"小節<br>挿入",
  "toolbar.insertBarsTip":"再生位置に空の小節を挿入します（Ctrl+B）",
  "toolbar.removeBars":"小節<br>削除",
  "toolbar.removeBarsTip":"再生位置から小節を取り除きます（Ctrl+Shift+B）",
  "bars.insertTitle":"{bar}小節の前に空の小節を入れますか？",
  "bars.insertText":"後ろの音符とマーカーがその分ずれます。切れ目にかかっていた音はそこで二つに分かれます。",
  "bars.removeTitle":"{bar}小節から取り除きますか？",
  "bars.removeText":"その区間の音符とマーカーが消え、後ろが詰まります。Ctrl+Z で戻せます。",
  "bars.inserted":"{n}小節を挿入しました。",
  "bars.removed":"{n}小節を取り除きました。（音符 {notes} 個）",

  "marker.copiedVelocity":"強さマーカー v{value} をコピーしました。",
  "marker.copiedTempo":"テンポマーカー {value} をコピーしました。",
  "marker.pasted":"再生位置に貼り付けました。",
  "marker.pastedSplit":"貼り付け時に音 {n} 個を分けました。",

  "inspector.cutTip":"分割 — 再生位置（黄色い線）が通る所で音を分けます（Ctrl+K）",
  "cut.nothing":"黄色い線にかかる音がありません。",
  "cut.done":"{n} 個を分けました。",

  "toolbar.panel":"パネル",
  "toolbar.panelTip":"強さ・奏法・テンポのパネルを開く",
  "inspector.title":"パネル",
  "common.close":"閉じる",

  "app.title":"アルミス MML エディタ",

  "common.ok":"OK",
  "common.cancel":"キャンセル",
  "common.delete":"削除",
  "common.keep":"そのまま",
  "common.done":"完了",
  "common.copy":"コピー",
  "common.copyNamed":"{name} をコピー",
  "common.confirm":"confirm",

  "toolbar.saveFile":"保存",
  "toolbar.saveFileTip":"今の作業をファイルとして保存します",
  "toolbar.openFile":"開く",
  "toolbar.openFileTip":"保存した作業ファイルを読み込みます",
  "file.exported":"ファイルに保存しました。",
  "file.imported":"{name} を読み込みました。",
  "file.importFail":"このファイルは読み込めません。",
  "file.nothingToSave":"保存するトラックがありません。",
  "restore.done":"前回の作業を読み込みました。",
  "restore.failed":"前回の作業を復元できませんでした。",
  "autosave.full":"自動保存の空きがありません。ファイルに保存してください。",
  "toolbar.openMidi":"MIDI ファイルを選択",
  "toolbar.noFile":"ファイルが読み込まれていません",
  "toolbar.undo":"元に<br>戻す",
  "toolbar.undoTip":"元に戻す",
  "toolbar.redo":"やり<br>直す",
  "toolbar.redoTip":"やり直す",
  "toolbar.technique":"奏法",
  "toolbar.techniqueTip":"現在の楽器の奏法を選ぶ",
  "toolbar.noteAdd":"+",
  "toolbar.noteAddTip":"音符を追加 — 中央に現れるので、そこからドラッグして置きます",
  "toolbar.noteDelete":"削除",
  "toolbar.noteDeleteTip":"選んだ音符・マーカー・トラックを削除",
  "toolbar.select":"選択",
  "toolbar.selectTip":"複数選択 — 音符をクリックして出し入れ、空いた所をドラッグで囲みます（Ctrl+クリックと同じ）",
  "toolbar.copy":"コピー",
  "toolbar.copyTip":"選んだ音符をコピー",
  "toolbar.paste":"貼り<br>付け",
  "toolbar.pasteTip":"貼り付け — 中央に現れるので、そこからドラッグして置きます",
  "toolbar.playTip":"再生",
  "toolbar.stopTip":"停止",
  "toolbar.zoomOut":"縮小",
  "toolbar.zoomIn":"拡大",
  "toolbar.zoomReset":"クリックで 100% に戻す",
  "toolbar.language":"言語",

  "rail.title":"トラック",
  "rail.addTrack":"トラックを追加",
  "rail.empty":"MIDI ファイルを読み込むか、下から楽器を選んでトラックを作ってください。",

  "board.octave":"オクターブ",
  "board.timeTable":"タイムテーブル",
  "board.tempoTip":"クリックしてテンポを入力",
  "board.tempoInput":"テンポを入力",

  "inspector.noteLength":"音符の長さ",
  "inspector.triplet":"三連符",
  "inspector.dotTie":"付点 · タイ",
  "inspector.dotTip":"付点 — 長さを 1.5 倍に。三連符にも付きます",
  "inspector.tieTip":"タイ — 次の音とつないで一つの音に。つなぐ音がなければ新しく作ります",
  "inspector.tripletHalf":"2分音符の三連符",
  "inspector.tripletQuarter":"4分音符の三連符",
  "inspector.tripletEighth":"8分音符の三連符",
  "inspector.tripletSixteenth":"16分音符の三連符",
  "inspector.tripletThirtySecond":"32分音符の三連符",
  "inspector.velocity":"強さ",
  "inspector.velocityAria":"ベロシティ",
  "inspector.tempo":"テンポ",
  "inspector.tempoDown":"テンポを下げる",
  "inspector.tempoUp":"テンポを上げる",
  "inspector.tempoDirect":"クリックして直接入力",
  "inspector.technique":"奏法",

  "menu.technique":"奏法",
  "menu.instrument":"楽器",
  "menu.instrumentChange":"アルミスの楽器を変える",
  "menu.markerStack":"同じ位置のマーカー",

  "outputResize.tip":"ドラッグして出力欄の高さを変える",

  "time.position":"{m}小節 {b}拍",
  "out.chars":"{n}文字",
  "out.empty":"MIDI ファイルを読み込むかトラックを追加すると、ここに MML が出ます。",
  "out.noSelection":"左でトラックを選ぶと、ここに MML が出ます。",
  "out.placeholder":"ここに MML を貼り付けると、上に音符として描かれます",

  "marker.stacked":"{n} 個が重なっています。クリックして選んでください。",

  "note.selectFirst":"先に音符を選んでください。",
  "note.floatingRemoved":"浮いていた音符を消しました。",
  "note.removed":"{n} 個消しました。",
  "note.maxLength":"後ろに別の音があるので、{n}分音符までしか入りません。",
  "note.handleStart":"左端をドラッグして開始位置と長さを変える",
  "note.handleEnd":"右端をドラッグして長さを変える",

  "tie.broken":"タイを外しました。",
  "tie.chordOnly":"和音はつなげません。単音だけです。",
  "tie.otherNote":"そこには別の音があります。同じ高さでないとつなげません。",
  "tie.noRoom":"つなぐ場所がありません。",

  "tech.noneForInstrument":"この楽器に登録された奏法はありません。",
  "tech.noneShort":"使える奏法なし",

  "track.selectFirst":"先にトラックを選んでください。",
  "track.minOne":"トラックは最低 1 つ必要です。",
  "track.deleteTitle":"{name} トラックを削除しますか？",
  "track.deleteText":"このトラックの音符とマーカーも一緒に消えます。Ctrl+Z で元に戻せます。",

  "select.picked":"{n} 個選びました。",
  "select.none":"選んだ音符がありません。",

  "copy.selectFirst":"コピーする音符を先に選んでください。",
  "copy.done":"{n} 個コピーしました。",
  "paste.empty":"コピーした音符がありません。",
  "paste.dragHint":"ドラッグして位置を決め、手を離してください。",

  "drop.reverted":"元の位置に戻しました。",
  "drop.cancelled":"配置をやめました。",
  "drop.invalid":"ここには置けません。別の場所へドラッグしてください。",

  "mml.badLength":"長さ {n} は使えません。",
  "mml.noNumber":"{pos} 文字目の後に数字がありません。",
  "mml.unclosedBracket":"閉じていない [ があります。",
  "mml.badChar":"{pos} 文字目 '{ch}' が読めません。",
  "mml.unclosedTech":"区間奏法 {code} が閉じていません。",
  "mml.parseFail":"読み取れませんでした — {message}",

  "midi.reading":"読み込み中… {name}",
  "midi.noTracks":"{name} — 音符のあるトラックが見つかりません",
  "midi.parts":" · {parts} パート中、音のある {used} パート",
  "midi.trackLimit":"（アルミスは 1 人 {n} トラックまでです）",
  "midi.loadFail":"読み込めませんでした — {message}",
  "midi.workerUnavailable":"MIDI 変換ワーカーが使えません",

  "play.noTracks":"選んだトラックがありません。",
  "play.nothingAhead":"再生位置より後に音がありません。",
  "play.audioLost":"音が途切れたので再生を止めました。もう一度押してください。",
  "audio.blocked":"音を出せませんでした。画面を一度クリックしてからもう一度お試しください。",

  "inst.피아노":"ピアノ",
  "inst.바이올린":"バイオリン",
  "inst.고쟁":"古箏",
  "inst.태평소":"太平簫",
  "inst.피리":"ピリ",
  "inst.베이스":"ベース",
  "inst.기타":"ギター",
  "inst.북":"太鼓",
  "inst.드럼":"ドラム",
  "inst.퉁소":"洞簫",
  "inst.비파":"琵琶",
  "inst.이호":"二胡",
  "inst.신디사이저":"シンセサイザー",

  "tn.tremolo":"トレモロ",
  "tn.vibrato":"ビブラート",
  "tn.bendUp":"ベンドアップ",
  "tn.bendDown":"ベンドダウン",
  "tn.harmonic":"ハーモニクス",
  "tn.cluster":"クラスター",
  "tn.cut":"カット",
  "tn.graceUp":"上の装飾音",
  "tn.graceDown":"下の装飾音",
  "tn.doubleTongue":"ダブルタンギング",
  "tn.tap":"タップ",
  "tn.nogi":"ノギ",
  "tn.staccato":"スタッカート",
  "tn.accent":"アクセント",
  "tn.shoutMale":"掛け声（男）",
  "tn.shoutFemale":"掛け声（女）",
  "tn.flutter":"フラッタータンギング",
  "tn.bowTremolo":"ボウトレモロ",
  "tn.timbre":"音色変化",
  "tn.mute":"ミュート",
  "tn.pullOff":"プリングオフ",
  "tn.hammerOn":"ハンマリングオン",
  "tn.fermata":"フェルマータ",
  "tn.legato":"レガート",
  "tn.glissando":"グリッサンド"

},


/* ------------------------------------------------------------
   中文
------------------------------------------------------------ */
zh:{

  "lang.name":"中文",

  "midi.modeTitle":"是合奏曲还是独奏曲？",
  "midi.modeText":"独奏（单一乐器）会合并所有声部并均匀分到三条轨道，每条控制在3000字以内，让一个人用三轨演奏完整曲子。合奏则保留MIDI原有声部。",
  "midi.modeSolo":"独奏（一人演奏）",
  "midi.modeEnsemble":"合奏（多种乐器）",

  "out.charsTip":"游戏计数（音符+休止符）{n} / 上限 {max} · 字符串长度 {raw}",
  "out.charsOverTip":"超过游戏上限 {max}（{n}）。粘贴后末尾会被截断。",

  "toolbar.barPrevTip":"后退一小节（Ctrl+←）",
  "toolbar.barNextTip":"前进一小节（Ctrl+→）",
  "toolbar.barStartTip":"跳到开头（Home）",
  "toolbar.barEndTip":"跳到曲末（End）",
  "toolbar.pauseTip":"暂停 — 再按一次继续播放",
  "board.timeTip":"播放头位置 / 全曲长度",

  "tech.replacedPost":"一个音符只能带一个 * 技法。已移除：{list}",

  "note.someBlocked":"所选音符中有放不下该长度的，因此未做更改。",
  "tie.chordPartial":"要连接和弦，请选中它的全部音符。",
  "tie.chordUneven":"和弦各音长度不同，无法连接。",

  "tech.droppedOnChange":"已移除该乐器没有的技法：{list}",

  "tech.notAvailable":"该乐器没有这种技法。",

  "toolbar.insertBars":"插入<br>小节",
  "toolbar.insertBarsTip":"在播放头处插入空白小节（Ctrl+B）",
  "toolbar.removeBars":"删除<br>小节",
  "toolbar.removeBarsTip":"从播放头处删除小节（Ctrl+Shift+B）",
  "bars.insertTitle":"要在第 {bar} 小节前插入空白小节吗？",
  "bars.insertText":"后面的音符和标记都会随之后移。跨在接缝上的音符会在那里分成两个。",
  "bars.removeTitle":"要从第 {bar} 小节开始删除吗？",
  "bars.removeText":"该区间的音符和标记会消失，后面的内容前移。可用 Ctrl+Z 撤销。",
  "bars.inserted":"已插入 {n} 个小节。",
  "bars.removed":"已删除 {n} 个小节（音符 {notes} 个）。",

  "marker.copiedVelocity":"已复制力度标记 v{value}。",
  "marker.copiedTempo":"已复制速度标记 {value}。",
  "marker.pasted":"已粘贴到播放头位置。",
  "marker.pastedSplit":"粘贴时切分了 {n} 个音符。",

  "inspector.cutTip":"切分 — 在播放头（黄线）经过的位置把音符切开（Ctrl+K）",
  "cut.nothing":"没有音符跨过黄线。",
  "cut.done":"切分了 {n} 个。",

  "toolbar.panel":"面板",
  "toolbar.panelTip":"打开力度、技法与速度面板",
  "inspector.title":"面板",
  "common.close":"关闭",

  "app.title":"Armis MML 编辑器",

  "common.ok":"确定",
  "common.cancel":"取消",
  "common.delete":"删除",
  "common.keep":"保留",
  "common.done":"已复制",
  "common.copy":"复制",
  "common.copyNamed":"复制 {name}",
  "common.confirm":"confirm",

  "toolbar.saveFile":"保存",
  "toolbar.saveFileTip":"把当前工作下载为文件",
  "toolbar.openFile":"打开",
  "toolbar.openFileTip":"载入已保存的工作文件",
  "file.exported":"已保存为文件。",
  "file.imported":"已载入 {name}。",
  "file.importFail":"无法读取该文件。",
  "file.nothingToSave":"没有可保存的音轨。",
  "restore.done":"已接着上次的工作。",
  "restore.failed":"无法恢复上次的工作。",
  "autosave.full":"自动保存空间已满，请保存为文件。",
  "toolbar.openMidi":"选择 MIDI 文件",
  "toolbar.noFile":"尚未载入文件",
  "toolbar.undo":"撤销",
  "toolbar.undoTip":"撤销",
  "toolbar.redo":"重做",
  "toolbar.redoTip":"重做",
  "toolbar.technique":"技法",
  "toolbar.techniqueTip":"选择当前乐器的技法",
  "toolbar.noteAdd":"+",
  "toolbar.noteAddTip":"添加音符 — 出现在中间后拖到位置上",
  "toolbar.noteDelete":"删除",
  "toolbar.noteDeleteTip":"删除选中的音符、标记或音轨",
  "toolbar.select":"选择",
  "toolbar.selectTip":"多选 — 点击音符加入或移出，在空白处拖动框选（等同 Ctrl+点击）",
  "toolbar.copy":"复制",
  "toolbar.copyTip":"复制选中的音符",
  "toolbar.paste":"粘贴",
  "toolbar.pasteTip":"粘贴 — 出现在中间后拖到位置上",
  "toolbar.playTip":"播放",
  "toolbar.stopTip":"停止",
  "toolbar.zoomOut":"缩小",
  "toolbar.zoomIn":"放大",
  "toolbar.zoomReset":"点击回到 100%",
  "toolbar.language":"语言",

  "rail.title":"音轨",
  "rail.addTrack":"添加音轨",
  "rail.empty":"载入 MIDI 文件，或在下面选一个乐器来新建音轨。",

  "board.octave":"八度",
  "board.timeTable":"时间表",
  "board.tempoTip":"点击直接输入速度",
  "board.tempoInput":"输入速度",

  "inspector.noteLength":"音符时值",
  "inspector.triplet":"三连音",
  "inspector.dotTie":"附点 · 连音线",
  "inspector.dotTip":"附点 — 时值变为 1.5 倍，三连音也适用",
  "inspector.tieTip":"连音线 — 与后一个音连成一个音。没有可连的音时会新建一个",
  "inspector.tripletHalf":"二分音符三连音",
  "inspector.tripletQuarter":"四分音符三连音",
  "inspector.tripletEighth":"八分音符三连音",
  "inspector.tripletSixteenth":"十六分音符三连音",
  "inspector.tripletThirtySecond":"三十二分音符三连音",
  "inspector.velocity":"力度",
  "inspector.velocityAria":"力度",
  "inspector.tempo":"速度",
  "inspector.tempoDown":"降低速度",
  "inspector.tempoUp":"提高速度",
  "inspector.tempoDirect":"点击直接输入",
  "inspector.technique":"技法",

  "menu.technique":"技法",
  "menu.instrument":"乐器",
  "menu.instrumentChange":"更换 Armis 乐器",
  "menu.markerStack":"同一位置的标记",

  "outputResize.tip":"拖动调整输出栏高度",

  "time.position":"第 {m} 小节 第 {b} 拍",
  "out.chars":"{n} 字",
  "out.empty":"载入 MIDI 文件或添加音轨后，这里会显示 MML。",
  "out.noSelection":"在左侧选择音轨后，这里会显示 MML。",
  "out.placeholder":"把 MML 粘贴到这里，上方就会画成音符",

  "marker.stacked":"这里有 {n} 个标记重叠，点击选择。",

  "note.selectFirst":"请先选择音符。",
  "note.floatingRemoved":"已删除浮动的音符。",
  "note.removed":"已删除 {n} 个。",
  "note.maxLength":"后面还有音符，最多只能放 {n} 分音符。",
  "note.handleStart":"拖动左端调整起点和时值",
  "note.handleEnd":"拖动右端调整时值",

  "tie.broken":"已断开连音线。",
  "tie.chordOnly":"和弦不能连音，只能用于单音。",
  "tie.otherNote":"那里有别的音符。音高相同才能连。",
  "tie.noRoom":"没有可以连的位置。",

  "tech.noneForInstrument":"该乐器没有登记的技法。",
  "tech.noneShort":"没有可用技法",

  "track.selectFirst":"请先选择音轨。",
  "track.minOne":"至少需要一条音轨。",
  "track.deleteTitle":"要删除 {name} 音轨吗？",
  "track.deleteText":"这条音轨的音符和标记会一起消失。可以用 Ctrl+Z 撤销。",

  "select.picked":"已选择 {n} 个。",
  "select.none":"没有选中的音符。",

  "copy.selectFirst":"请先选择要复制的音符。",
  "copy.done":"已复制 {n} 个。",
  "paste.empty":"还没有复制过音符。",
  "paste.dragHint":"拖到位置后松手。",

  "drop.reverted":"已放回原处。",
  "drop.cancelled":"已取消放置。",
  "drop.invalid":"这里放不下，请拖到别处。",

  "mml.badLength":"时值 {n} 无法使用。",
  "mml.noNumber":"第 {pos} 个字符后面没有数字。",
  "mml.unclosedBracket":"有未闭合的 [。",
  "mml.badChar":"第 {pos} 个字符 '{ch}' 无法识别。",
  "mml.unclosedTech":"区间技法 {code} 没有闭合。",
  "mml.parseFail":"无法读取 — {message}",

  "midi.reading":"读取中… {name}",
  "midi.noTracks":"{name} — 找不到含音符的音轨",
  "midi.parts":" · {parts} 个声部中有声音的 {used} 个",
  "midi.trackLimit":"（Armis 每人最多 {n} 条音轨）",
  "midi.loadFail":"载入失败 — {message}",
  "midi.workerUnavailable":"无法使用 MIDI 转换 worker",

  "play.noTracks":"没有选中的音轨。",
  "play.nothingAhead":"播放头之后没有声音。",
  "play.audioLost":"声音中断，播放已停止。请再按一次。",
  "audio.blocked":"无法启动声音。请先点击页面，然后再试一次。",

  "inst.피아노":"钢琴",
  "inst.바이올린":"小提琴",
  "inst.고쟁":"古筝",
  "inst.태평소":"太平箫",
  "inst.피리":"觱篥",
  "inst.베이스":"贝斯",
  "inst.기타":"吉他",
  "inst.북":"鼓（北）",
  "inst.드럼":"架子鼓",
  "inst.퉁소":"洞箫",
  "inst.비파":"琵琶",
  "inst.이호":"二胡",
  "inst.신디사이저":"合成器",

  "tn.tremolo":"震音",
  "tn.vibrato":"揉弦",
  "tn.bendUp":"上推弦",
  "tn.bendDown":"下推弦",
  "tn.harmonic":"泛音",
  "tn.cluster":"音簇",
  "tn.cut":"切音",
  "tn.graceUp":"上倚音",
  "tn.graceDown":"下倚音",
  "tn.doubleTongue":"双吐",
  "tn.tap":"打音",
  "tn.nogi":"诺基",
  "tn.staccato":"断奏",
  "tn.accent":"重音",
  "tn.shoutMale":"吆喝（男）",
  "tn.shoutFemale":"吆喝（女）",
  "tn.flutter":"花舌",
  "tn.bowTremolo":"碎弓",
  "tn.timbre":"音色变化",
  "tn.mute":"闷音",
  "tn.pullOff":"勾弦",
  "tn.hammerOn":"击弦",
  "tn.fermata":"延长记号",
  "tn.legato":"连奏",
  "tn.glissando":"滑音"

}

};


/* 지금 쓰는 말. 한 번 고르면 이 브라우저에 남는다. */
let currentLang = "ko";


function detectLang(){

  /* 저장해 둔 것이 먼저다 */
  try{

    const saved =
      localStorage.getItem("armis-lang");

    if(saved && I18N[saved]){
      return saved;
    }

  }catch(error){}

  /* 처음 온 사람은 브라우저 설정을 따른다 */
  const list =
    (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || "ko"];

  for(const raw of list){

    const code =
      String(raw).toLowerCase();

    if(code.startsWith("ko")) return "ko";
    if(code.startsWith("ja")) return "ja";
    if(code.startsWith("zh")) return "zh";
    if(code.startsWith("en")) return "en";

  }

  return "en";

}


/* ============================================================
   글 꺼내기
   ============================================================
   t("note.removed", { n:3 })  →  "3개 지웠습니다."

   찾는 글이 그 말에 없으면 한국어로, 그것도 없으면 열쇠를 그대로
   돌려준다. 번역이 하나 빠져도 화면이 비어 버리지는 않게 하려는 것이다. */
function t(key, vars){

  const table =
    I18N[currentLang] ||
    I18N.ko;

  let text =
    table[key];

  if(text === undefined){

    text =
      I18N.ko[key];

  }

  if(text === undefined){

    return key;

  }

  if(vars){

    text =
      text.replace(
        /\{(\w+)\}/g,
        (whole, name)=>
          vars[name] !== undefined
            ? vars[name]
            : whole
      );

  }

  return text;

}


/* 악기 이름 — 보이는 글자만 바꾼다.
   프로그램 안에서는 계속 한국어 이름을 열쇠로 쓴다. */
function instrumentLabel(name){

  const base =
    typeof getBaseInstrument === "function"
      ? getBaseInstrument(name)
      : name;

  const label =
    t("inst." + base);

  return label === ("inst." + base)
    ? name
    : label;

}


function techniqueLabel(role){

  const label =
    t("tn." + role);

  return label === ("tn." + role)
    ? role
    : label;

}


/* index.html에 달아 둔 표시를 실제 글로 채운다 */
function applyI18nToDom(root){

  const scope =
    root || document;

  scope.querySelectorAll("[data-i18n]").forEach(
    el=>{

      el.textContent =
        t(el.dataset.i18n);

    }
  );

  scope.querySelectorAll("[data-i18n-html]").forEach(
    el=>{

      el.innerHTML =
        t(el.dataset.i18nHtml);

    }
  );

  scope.querySelectorAll("[data-i18n-title]").forEach(
    el=>{

      el.title =
        t(el.dataset.i18nTitle);

    }
  );

  scope.querySelectorAll("[data-i18n-aria]").forEach(
    el=>{

      el.setAttribute(
        "aria-label",
        t(el.dataset.i18nAria)
      );

    }
  );

  scope.querySelectorAll("[data-i18n-placeholder]").forEach(
    el=>{

      el.placeholder =
        t(el.dataset.i18nPlaceholder);

    }
  );

  document.title =
    t("app.title");

  document.documentElement.lang =
    currentLang;

}


/* 말을 바꾼다.
   화면에 붙어 있는 글은 여기서 바로 갈아 끼우고,
   그림(노트·마커·출력)은 app.js가 이 알림을 받아 다시 그린다. */
function setLang(code){

  if(!I18N[code]){
    return;
  }

  currentLang = code;

  try{

    localStorage.setItem(
      "armis-lang",
      code
    );

  }catch(error){}

  applyI18nToDom();

  document.dispatchEvent(
    new CustomEvent("i18n:changed")
  );

}


currentLang = detectLang();
