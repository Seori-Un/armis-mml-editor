/* ============================================================
   MML 심장부 정밀 감사
   ============================================================
   MML 문자열을 만드는 길 두 갈래를 모두 잰다.
     · 편집기 길: 노트 → generateTrackMML → (파서로 되읽기) → 비교
     · 미디 길:   MIDI → convert → track.mml → (파서로 되읽기) → 비교

   판정 기준
     · 길이 인코더: 돌려준 tick == 토큰 합. 요청보다 길게 찍지 않는다.
       못 채운 나머지는 MIN_TICK 미만.
     · 이월기: 몇 번을 이어 불러도 잃어버린 tick의 총합이 MIN_TICK 미만.
     · 왕복: 음 하나하나의 시작·길이 오차 < MIN_TICK,
       누적 오차(트랙 끝 위치)는 정확히 0 또는 < MIN_TICK.
       음높이·세기·화음 구조·템포 자리는 정확히 일치.
   ============================================================ */

const fs = require("fs");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(
  fs.readFileSync("index.html", "utf8"),
  { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" }
);

const w = dom.window;

w.AudioContext = function(){
  return {
    state:"running", currentTime:0, destination:{},
    createGain(){ return { gain:{ value:0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, cancelScheduledValues(){} }, connect(){}, disconnect(){} }; },
    createDynamicsCompressor(){ return { threshold:{}, knee:{}, ratio:{}, attack:{}, release:{}, connect(){}, disconnect(){} }; },
    resume(){ return Promise.resolve(); }, close(){}
  };
};

w.eval(
  ["i18n.js","midi-engine.js","app.js"]
    .map(f=>fs.readFileSync(f,"utf8"))
    .join("\n;\n") +
  "\n;\nglobalThis.__eval = function(code){ return eval(code); };"
);

const run = code => w.__eval("(function(){\n" + code + "\n})()");

let bad = 0;
function report(lines){
  for(const line of lines){
    if(line.startsWith("✗")) bad++;
    console.log(" " + line);
  }
}


/* ── 1. 길이 인코더 전수 검사 ─────────────────────────── */
console.log("\n[1] 길이 인코더 (tick 1~3072 전수)");
report(run(`
  const out = [];
  let worst = 0, fail = 0, firstFail = "";
  for(let tick = 1; tick <= 3072; tick++){
    const r = resolveTickTokens(tick);
    const decoded = r.tokens.reduce((s,t)=>s + tokenTick(t), 0);
    const okTruth = decoded === r.tick;
    const okOver = r.tick <= tick;
    const rest = tick - r.tick;
    const okRest = (tick < MIN_TICK) ? (r.tick === 0) : (rest >= 0 && rest < MIN_TICK);
    const okValid = r.tokens.every(t => tokenTick(t) > 0);
    if(!(okTruth && okOver && okRest && okValid)){
      fail++;
      if(!firstFail) firstFail = tick + " → [" + r.tokens.join(",") + "] tick=" + r.tick + " decoded=" + decoded;
    }
    worst = Math.max(worst, rest);
  }
  out.push(fail ? "✗ 어긋난 tick " + fail + "개, 첫 예: " + firstFail
               : "✓ 3072개 모두: 돌려준 tick == 토큰 합, 초과 없음, 나머지 < MIN_TICK");
  out.push("  (버려지는 나머지 최대 " + worst + "틱 — 이월기가 받아 간다)");
  return out;
`));


/* ── 2. 이월기 보존 법칙 ─────────────────────────────── */
console.log("\n[2] 이월기 — tick 보존 (무작위 5000수 × 20판)");
report(run(`
  let worstDrift = 0, fail = 0;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for(let trial = 0; trial < 20; trial++){
    const take = createTickEmitter();
    let asked = 0, got = 0;
    for(let i = 0; i < 5000; i++){
      const tick = 1 + Math.floor(rnd() * 900);
      asked += tick;
      got += take(tick).tick;
      const drift = asked - got;
      if(drift < 0 || drift >= MIN_TICK) fail++;
      worstDrift = Math.max(worstDrift, drift);
    }
  }
  return [ fail ? "✗ 보존 위반 " + fail + "회"
                : "✓ 10만 수 모두 누적 오차 0 ≤ drift < " + MIN_TICK + " (최대 " + worstDrift + "틱)" ];
`));


/* ── 3. 편집기 왕복 (6틱 격자 = 정확히 표현 가능한 자리) ── */
console.log("\n[3] 편집기 왕복 — 표현 가능한 격자 (200곡 무작위)");
report(run(`
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const legalLen = [...TICK_TABLE.keys()].filter(t => t <= WHOLE * 2);

  const out = [];
  let songs = 0, noteFails = 0, endFails = 0, pitchFails = 0, velFails = 0, tempoFails = 0;
  let firstDetail = "";

  for(let trial = 0; trial < 200; trial++){
    tracks.length = 0;
    addTrack("피아노");
    const tr = tracks[0];
    tr.velocityMarkers = [];
    tr.tempoMarkers = [];

    /* 무작위 곡: 6틱 격자 위에 20~60개, 화음 30%, 세기·템포 마커 몇 개 */
    let tick = Math.floor(rnd() * 8) * MIN_TICK;
    const model = [];
    const count = 20 + Math.floor(rnd() * 40);
    for(let i = 0; i < count; i++){
      const len = legalLen[Math.floor(rnd() * legalLen.length)];
      const key = 24 + Math.floor(rnd() * 72);
      model.push({ start: tick, len, key });
      tr.notes.push({ bar: tick / WHOLE, len: len / WHOLE, row: keyToRow(key), techs: [] });
      if(rnd() < 0.3){
        const key2 = clampKey(key + 3 + Math.floor(rnd() * 7));
        if(key2 !== key){
          model.push({ start: tick, len, key: key2 });
          tr.notes.push({ bar: tick / WHOLE, len: len / WHOLE, row: keyToRow(key2), techs: [] });
        }
      }
      tick += len + (rnd() < 0.4 ? Math.floor(rnd() * 5) * MIN_TICK : 0);
    }
    const markerTicks = [];
    for(let i = 0; i < 3; i++){
      const pos = Math.floor(rnd() * tick / MIN_TICK) * MIN_TICK;
      const vel = 6 + Math.floor(rnd() * 10);
      tr.velocityMarkers.push({ bar: pos / WHOLE, velocity: vel });
      markerTicks.push(pos);
    }
    tr.velocityMarkers.sort((a,b)=>a.bar-b.bar);
    normalizeAllNotes();

    const mml = generateTrackMML(tr);
    let parsed;
    try{ parsed = parseMml(mml); }
    catch(err){ out.push("✗ 파서가 자기 출력물을 못 읽음: " + err.message + "  MML: " + mml.slice(0,60)); return out; }

    /* 되읽은 음 목록 (구성음 단위로 편다) */
    const back = [];
    for(const g of parsed.groups){
      for(const n of g.notes){
        if(n.rest) continue;
        back.push({ start: g.start, len: n.ticks, key: n.key });
      }
    }
    back.sort((a,b)=>a.start-b.start || a.key-b.key);
    const want = model.slice().sort((a,b)=>a.start-b.start || a.key-b.key);

    songs++;
    if(back.length !== want.length){
      noteFails++;
      if(!firstDetail) firstDetail = "음 개수 " + want.length + "→" + back.length + "  MML: " + mml.slice(0,80);
      continue;
    }
    for(let i = 0; i < want.length; i++){
      const a = want[i], b = back[i];
      if(a.key !== b.key) { pitchFails++; if(!firstDetail) firstDetail = "음높이 " + a.key + "→" + b.key; }
      const ds = Math.abs(a.start - b.start);
      const de = Math.abs((a.start + a.len) - (b.start + b.len));
      /* 이월기 규약: 개별 경계는 MIN_TICK 미만까지 밀릴 수 있다.
         대신 어느 쪽으로도 잃어버리는 tick은 없다(끝 위치 검사가 잡는다). */
      if(ds >= MIN_TICK || de >= MIN_TICK){
        noteFails++;
        if(!firstDetail) firstDetail = "자리/길이 (" + a.start + "," + a.len + ")→(" + b.start + "," + b.len + ")  MML: " + mml.slice(0, 100);
        break;
      }
    }

    /* 끝 위치 보존 */
    const wantEnd = Math.max(...want.map(n=>n.start + n.len));
    const backEnd = back.length ? Math.max(...back.map(n=>n.start + n.len)) : 0;
    if(wantEnd !== backEnd){ endFails++; if(!firstDetail) firstDetail = "끝 " + wantEnd + "→" + backEnd; }

    /* 세기: "각 음이 실제로 어떤 세기로 들리는가"가 진실이다.
       마커가 음 한가운데 찍혀 있으면 MML에는 그 자리에 v를 적을 수
       없으므로(음을 쪼개지 않는 한) 다음 경계로 밀리는 것이 맞다 —
       편집기 화면의 noteVelocity도 정확히 같은 규칙으로 듣는다. */
    const effAt = pos => {
      let v = 12;
      for(const e of parsed.velocities){ if(e.tick <= pos) v = e.velocity; else break; }
      return v;
    };
    parsed.velocities.sort((a,b)=>a.tick-b.tick);
    for(const note of tr.notes){
      const pos = Math.round(note.bar * WHOLE);
      const wantV = noteVelocity(tr, note);
      const gotV = effAt(pos);
      if(wantV !== gotV){
        velFails++;
        if(!firstDetail) firstDetail = "음@" + pos + " 세기 " + wantV + "→" + gotV + "  MML: " + mml.slice(0,110);
        break;
      }
    }
    /* 쉼표 안(어느 음의 안쪽도 아닌 자리)에 찍힌, 값이 바뀌는 마커는
       정확히 그 tick에 v가 있어야 한다 — r4v10r4 약속 */
    for(const m of tr.velocityMarkers){
      const pos = Math.round(m.bar * WHOLE);
      if(pos <= 0 || pos >= wantEnd) continue;
      const insideNote = tr.notes.some(n => {
        const s = Math.round(n.bar*WHOLE), e = Math.round((n.bar+n.len)*WHOLE);
        return pos > s && pos < e;
      });
      if(insideNote) continue;
      const before = tr.velocityMarkers
        .map(x => ({ p: Math.round(x.bar*WHOLE), v: x.velocity }))
        .filter(x => x.p < pos).sort((a,b)=>a.p-b.p).pop();
      const baseV = before ? before.v : effAt(0);
      if(baseV === m.velocity) continue;
      /* 마커 자리가 앞 경계에서 MIN_TICK 미만이면 그 조각을 적을 토큰이
         없다. 그때는 엔진이 닿을 수 있는 가장 가까운 경계에 찍는다. */
      const hit = parsed.velocities.some(v => Math.abs(v.tick - pos) < MIN_TICK && v.velocity === m.velocity);
      if(!hit){
        velFails++;
        if(!firstDetail){
          const around = tr.notes
            .map(n => ({ s: Math.round(n.bar*WHOLE), e: Math.round((n.bar+n.len)*WHOLE) }))
            .filter(n => n.e >= pos - 200 && n.s <= pos + 200)
            .map(n => n.s + "~" + n.e).join(" ");
          const vsNear = parsed.velocities.filter(v => Math.abs(v.tick - pos) <= 300)
            .map(v => "v" + v.velocity + "@" + v.tick).join(" ");
          firstDetail = "쉼표 마커 " + pos + "@v" + m.velocity + " 소실 | 기준 " + baseV +
            " | 곡끝 " + wantEnd + " | 근처 음 " + around + " | 근처 v " + (vsNear || "없음") +
            " | MML끝: ..." + mml.slice(-90);
        }
      }
    }
  }

  out.push((noteFails||pitchFails||endFails||velFails)
    ? "✗ 곡 " + songs + "개 중 실패 — 자리/길이 " + noteFails + ", 음높이 " + pitchFails + ", 끝 " + endFails + ", 세기 " + velFails
    : "✓ 200곡: 자리·길이·음높이·화음·끝 위치·세기 마커 전부 일치");
  if(firstDetail) out.push("  첫 사례: " + firstDetail);
  return out;
`));


/* ── 4. 편집기 왕복 — 표현 불가능한 자리(4틱 격자) 오차 한계 ── */
console.log("\n[4] 편집기 왕복 — 격자 밖 자리 (오차는 MIN_TICK 미만, 누적 0)");
report(run(`
  let seed = 424242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  let worstNote = 0, worstEnd = 0, fails = 0;

  for(let trial = 0; trial < 100; trial++){
    tracks.length = 0;
    addTrack("피아노");
    const tr = tracks[0];
    tr.velocityMarkers = []; tr.tempoMarkers = [];

    let tick = 0;
    const model = [];
    for(let i = 0; i < 30; i++){
      const len = MIN_TICK + Math.floor(rnd() * 60) * 4;     // 4틱 배수 → 표에 없는 값 다수
      const key = 36 + Math.floor(rnd() * 48);
      model.push({ start: tick, len, key });
      tr.notes.push({ bar: tick/WHOLE, len: len/WHOLE, row: keyToRow(key), techs: [] });
      tick += len + Math.floor(rnd() * 3) * 4;
    }
    normalizeAllNotes();
    const mml = generateTrackMML(tr);
    let parsed;
    try{ parsed = parseMml(mml); } catch(err){ out.push("✗ 파서 실패: " + err.message); return out; }

    const back = [];
    for(const g of parsed.groups) for(const n of g.notes) if(!n.rest) back.push({ start:g.start, len:n.ticks, key:n.key });
    back.sort((a,b)=>a.start-b.start);
    const want = model.slice().sort((a,b)=>a.start-b.start);
    if(back.length !== want.length){ fails++; continue; }

    for(let i=0;i<want.length;i++){
      const ds = Math.abs(back[i].start - want[i].start);
      const de = Math.abs((back[i].start+back[i].len) - (want[i].start+want[i].len));
      worstNote = Math.max(worstNote, ds, de);
      if(ds >= MIN_TICK || de >= MIN_TICK) fails++;
      if(back[i].key !== want[i].key) fails++;
    }
    const wantEnd = Math.max(...want.map(n=>n.start+n.len));
    const backEnd = Math.max(...back.map(n=>n.start+n.len));
    worstEnd = Math.max(worstEnd, Math.abs(wantEnd - backEnd));
    if(Math.abs(wantEnd - backEnd) >= MIN_TICK) fails++;
  }

  out.push(fails ? "✗ 한계 초과 " + fails + "건 (음 최대 " + worstNote + "틱, 끝 최대 " + worstEnd + "틱)"
                 : "✓ 100곡: 음 오차 최대 " + worstNote + "틱, 끝 오차 최대 " + worstEnd + "틱 (< " + MIN_TICK + ")");
  return out;
`));


/* ── 5. 음높이 전 범위 ───────────────────────────────── */
console.log("\n[5] 음높이 — 건반 0~119 왕복");
report(run(`
  const out = [];
  let fail = 0, first = "";
  for(let key = 0; key <= 119; key++){
    tracks.length = 0;
    addTrack("피아노");
    const tr = tracks[0];
    tr.velocityMarkers = []; tr.tempoMarkers = [];
    tr.notes.push({ bar: 0, len: 0.25, row: keyToRow(key), techs: [] });
    normalizeAllNotes();
    const mml = generateTrackMML(tr);
    const parsed = parseMml(mml);
    const got = parsed.groups[0] && parsed.groups[0].notes[0] ? parsed.groups[0].notes[0].key : -1;
    const expected = clampKey(key);
    if(got !== expected){ fail++; if(!first) first = key + "→" + got + " (기대 " + expected + ")  MML: " + mml; }
  }
  out.push(fail ? "✗ " + fail + "개 어긋남, 첫 예: " + first : "✓ 120개 건반 모두 일치 (범위 밖은 clampKey 규칙대로)");
  return out;
`));


/* ── 6. 미디 왕복 — convert 결과의 mml을 되읽어 자기 그룹과 대조 ── */
console.log("\n[6] 미디 왕복 — 무작위 SMF 60곡 (템포 변경·화음·겹침 포함)");
report(run(`
  let seed = 20240831;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  const vlq = n => { const b=[n&127]; n>>=7; while(n){ b.unshift((n&127)|128); n>>=7; } return b; };

  function makeMidi(){
    const ppq = [96, 192, 480, 960][Math.floor(rnd()*4)];
    const trk = [];
    const ev = (d, bytes) => trk.push(...vlq(d), ...bytes);
    ev(0, [0xC0, Math.floor(rnd()*8)]);
    let pending = [];
    let time = 0;
    const events = [];
    const count = 15 + Math.floor(rnd()*25);
    for(let i=0;i<count;i++){
      const key = 36 + Math.floor(rnd()*48);
      const len = Math.max(1, Math.floor(rnd()*2*ppq));
      events.push({ at: time, on: key });
      events.push({ at: time + len, off: key });
      if(rnd() < 0.25){
        const k2 = key + 4 + Math.floor(rnd()*5);
        events.push({ at: time, on: k2 });
        events.push({ at: time + len, off: k2 });
      }
      if(rnd() < 0.15){
        events.push({ at: time, tempo: 60 + Math.floor(rnd()*140) });
      }
      time += len + (rnd()<0.5 ? Math.floor(rnd()*ppq) : 0);
    }
    events.sort((a,b)=>a.at-b.at);
    let last = 0;
    for(const e of events){
      const d = e.at - last; last = e.at;
      if(e.on !== undefined) ev(d, [0x90, e.on, 60 + Math.floor(rnd()*60)]);
      else if(e.off !== undefined) ev(d, [0x80, e.off, 0]);
      else {
        const micros = Math.round(60000000 / e.tempo);
        ev(d, [0xFF, 0x51, 0x03, (micros>>16)&255, (micros>>8)&255, micros&255]);
      }
    }
    ev(0, [0xFF, 0x2F, 0x00]);
    const head = [0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,(ppq>>8)&255,ppq&255];
    const len = trk.length;
    return new Uint8Array([...head,0x4D,0x54,0x72,0x6B,(len>>24)&255,(len>>16)&255,(len>>8)&255,len&255,...trk]).buffer;
  }

  const out = [];
  let songs = 0, fails = 0, worst = 0, tempoFails = 0;
  let first = "";

  for(let trial = 0; trial < 60; trial++){
    let song;
    try{ song = convert(makeMidi()); }
    catch(err){ fails++; if(!first) first = "convert 예외: " + err.message; continue; }

    /* 사용자가 보는 진실은 songToTracks가 그려 주는 화면이다.
       "화면에 보이는 것 == 붙여넣을 MML" 이 지켜야 할 약속이므로
       그 둘을 맞대어 본다. */
    let loaded;
    try{ loaded = songToTracks(song); }
    catch(err){ fails++; if(!first) first = "songToTracks 예외: " + err.message; continue; }

    for(let ti = 0; ti < loaded.length; ti++){
      const screen = loaded[ti];
      const mml = song.tracks[ti] ? song.tracks[ti].mml : "";
      songs++;

      let parsed;
      try{ parsed = parseMml(mml); }
      catch(err){ fails++; if(!first) first = "파서 예외: " + err.message + "  MML: " + mml.slice(0,80); continue; }

      const wantNotes = screen.notes.map(n => ({
        start: Math.round(n.bar * WHOLE),
        end: Math.round((n.bar + n.len) * WHOLE),
        key: clampKey(rowToKey(n.row))
      })).sort((a,b)=>a.start-b.start || a.key-b.key);

      const wantFull = screen.notes.map(n => ({
        start: Math.round(n.bar * WHOLE),
        end: Math.round((n.bar + n.len) * WHOLE),
        key: clampKey(rowToKey(n.row)),
        vel: noteVelocity(screen, n)
      })).sort((a,b)=>a.start-b.start || a.key-b.key);

      const backNotes = [];
      for(const g of parsed.groups) for(const n of g.notes) if(!n.rest) backNotes.push({ start: g.start, end: g.start + n.ticks, key: n.key, vel: n.velocity });
      backNotes.sort((a,b)=>a.start-b.start || a.key-b.key);

      if(wantFull.length !== backNotes.length){
        fails++;
        if(!first) first = "음 개수 화면 " + wantFull.length + " vs MML " + backNotes.length + "  MML: " + mml.slice(0,90);
        continue;
      }
      for(let i=0;i<wantFull.length;i++){
        const a = wantFull[i], b = backNotes[i];
        const ds = Math.abs(a.start-b.start), de = Math.abs(a.end-b.end);
        worst = Math.max(worst, ds, de);
        if(a.key !== b.key || ds >= MIN_TICK || de >= MIN_TICK){
          fails++;
          if(!first) first = "음 " + i + " 화면(" + a.start + "~" + a.end + ",k" + a.key + ") vs MML(" + b.start + "~" + b.end + ",k" + b.key + ")  MML: " + mml.slice(0,110);
          break;
        }
        /* 세기는 구성음 단위로 정확히 (v는 같은 틱 안에서도 순서가 있다) */
        if(a.vel !== b.vel){
          fails++;
          if(!first) first = "세기 음" + i + " @" + a.start + " 화면 v" + a.vel + " vs MML v" + b.vel + "  MML: " + mml.slice(0,110);
          break;
        }
      }
    }

    /* 템포: 화면 마커 == 모든 트랙 MML의 t (0 위치 제외, 자리·값 정확) */
    const screenTempos = (loaded[0] ? songToTracks(song) : null, null);
    {
      const markers = (function(){
        const first = loaded[0];
        return first ? null : null;
      })();
    }
    {
      const loadedTempos = (loaded.tempoMarkers || (loaded[0] && loaded[0].tempoMarkers) || []);
      for(const track of song.tracks){
        let parsed;
        try{ parsed = parseMml(track.mml); } catch(err){ continue; }
        for(const tt of parsed.tempos){
          if(tt.tick === 0) continue;
          const hit = loadedTempos.some(m => Math.round(m.bar * WHOLE) === tt.tick && m.tempo === clampTempo(tt.tempo));
          if(!hit){ tempoFails++; if(!first) first = "MML의 t" + tt.tempo + "@" + tt.tick + " 가 화면 마커에 없음"; }
        }
      }
    }
  }

  out.push((fails||tempoFails)
    ? "✗ 트랙 " + songs + "개 중 실패 " + fails + ", 템포 자리 불일치 " + tempoFails
    : "✓ 트랙 " + songs + "개: 음 오차 < " + MIN_TICK + "틱 (최대 " + worst + "), 템포 자리 정확");
  if(first) out.push("  첫 사례: " + first);
  return out;
`));

console.log("");
console.log(bad ? ("문제 항목 " + bad + "개 — 위 사례부터 파고든다") : "여섯 관문 모두 통과");
process.exit(bad ? 1 : 0);
