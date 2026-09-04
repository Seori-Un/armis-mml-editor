/* ============================================================
   MIDI → MML 변환 엔진
   ============================================================
   변환기 페이지(Armis MML 변환기)에서 그대로 가져온 것이다.
   화면을 그리는 코드는 빼고 변환에 필요한 부분만 남겼다.

   편집기가 여기서 쓰는 것
     convert(buffer)      MIDI 바이트 → song
     song.tracks[i].groups  피아노롤에 놓을 음 (tick·건반 번호)
     buildEvents / eventsToMml   편집기 노트를 다시 MML로

   고칠 일이 생기면 변환기 쪽과 이 블록을 같이 고쳐야 한다.
   ============================================================ */

/* ============================================================
   설정
   ============================================================
   내부 해상도를 tick 단위로 다룬다. (MabiIcco의 MMLTickTable.TPQN 방식)

   TPQN = 96  →  4분음표 96 tick, 온음표 384 tick.
   이 값에서는 2분할과 3분할이 모두 정수로 떨어진다.
     1/32 = 12,  1/64 = 6
     8분 셋잇단(l12) = 32,  16분 셋잇단(l24) = 16,  32분 셋잇단(l48) = 8
   예전처럼 "1/32 격자에 반올림"하지 않으므로 셋잇단이 깨지지 않는다.
   ============================================================ */
const TPQN  = 96;
const WHOLE = TPQN * 4;   // 온음표 tick

/* Armis가 받아들이는 음표 길이 토큰. (게임에서 동작 확인 완료)
   게임이 특정 값을 거부하면 여기서 빼기만 하면 된다.
   3/6/12/24/48 이 셋잇단음표용.
   (MabiIcco의 tickInvTableForMb 구성 + 2분음표 셋잇단 "3")

   TPQN 96에서 정수 tick으로 떨어지는 분모만 쓸 수 있다.
   1,2,3,4,6,8,12,16,24,32,48,64 이 그 목록이고,
   5나 7 같은 값은 tick이 나누어떨어지지 않아 넣어도 무시된다. */
const LENGTH_TOKENS = ["1","1.","2","2.","3","4","4.","8","8.","16","16.","32","32.","64","64.","6","12","24","48"];

/* 한 음을 최대 몇 개 토큰까지 &로 이어붙일지 (MabiIcco COMBN) */
const COMBN = 3;

/* 양자화 방식
   "hybrid" : 2분할 격자와 3분할 격자 중 가까운 쪽으로 스냅 → 셋잇단 보존
   "binary" : 2분할 격자만
   "none"   : 스냅하지 않고 원본 tick 그대로 (연주 데이터의 흔들림까지 그대로) */
let QUANTIZE_MODE = "hybrid";
const BINARY_GRID  = WHOLE / 32;   // 12 tick = 1/32음표
const TRIPLET_GRID = WHOLE / 24;   // 16 tick = 1/24음표(16분 셋잇단)

/* 화음 구성음의 길이
   Armis는 e4:c1 처럼 길이가 다른 화음을 허용하므로 각자 제 길이로 적는다.
   다만 다음 음이 시작하는 위치는 "가장 긴 음"이 정하기 때문에, 가장 긴 음이
   다음 음 시작을 넘어가면 그 지점에서 잘린다. (긴 음이 뒤를 막는 것을 방지) */

/* Armis 한 사람이 쓸 수 있는 트랙 수. 서스테인 트랙도 이 안에서 나눠 쓴다. */
const MAX_TRACKS = 3;

/* Armis가 받는 옥타브 범위. 벗어나는 음은 옥타브 단위로 접어 넣는다. */
const OCTAVE_MIN = 0;
const OCTAVE_MAX = 8;

/* Armis 음량. v6 아래는 소리가 나지 않으므로 6이 실질 하한이다. */
const VEL_MIN = 6;
const VEL_MAX = 15;

/* 곡 전체에서 가장 센 음이 v15가 되도록 한꺼번에 올린다.
   MIDI가 전반적으로 여리게 녹음돼 있으면 게임에서 거의 안 들리기 때문이다.
   차이를 그대로 더하므로 셈여림의 상대 관계는 유지된다. */
const AUTO_BOOT_VELOCITY = true;

/* 지금 쓰는 음량 범위. */
function velRange() {
  return [VEL_MIN, VEL_MAX];
}

const INITIAL_TEMPO = 120;

/* ============================================================
   연주 기법 — 악기마다 번호가 다르다
   ============================================================
   Armis 표기법
     *N  → 음표 "뒤"에 붙는다. 그 음 하나에만 걸린다.  예) c4*13
     [N] → 토글이다. [N]으로 열고 [N]으로 닫으며, 그 사이의 음 전부에 걸린다.
           예) [3]c4d4e4[3]  ← 세 음 모두 레가토
           음마다 찍으면 켜졌다 꺼졌다 반복되므로 반드시 구간으로 감싸야 한다.

   중요: 기법은 그 악기 전용이다. 피아노 스타카토(*13)를 바이올린에 쓰면
   바이올린은 그냥 평음으로 연주한다. 그래서 악기를 바꾸면 그 악기의
   기법 세트로 MML을 다시 만들어야 한다.

   게임에서 확인한 기법
     *1  tremolo   한 음을 아주 빠르게 반복
     *2  vibrato   미묘하게 떨림
     *3  bendUp    음 끝을 살짝 올림
     *4  bendDown  음 끝을 살짝 내림
     *5  harmonic  울리는 소리 (배음)
     *6  cluster   인접 음이 섞인 불협 음색
     *7  cut       소리를 뚝 끊는다. 기타에는 *13이 없어서 이게 스타카토 역할을 한다
     *8  graceUp   친 음보다 위의 음을 짧게 스치는 꾸밈음
     *9  graceDown 아래쪽 꾸밈음
     *10 doubleTongue 음이 두 번 울린다 (더블 텅잉)
     *11 tap       구멍을 한 번 막았다 푸는 소리 (타공음)
     *12 nogi      "노기". 퉁소 전용. 날카로운 소리가 위에서 났다가 제 음으로 내려온다
     *13 staccato  짧게 끊어 연주
     *14 accent    강조
     *15 shoutMale   남성 추임새 (북)
     *16 shoutFemale 여성 추임새 (북)
     *17 flutter   지지직거릴 만큼 빠른 반복 (플러터 텅잉)
     *18 bowTremolo 지지직거리는 빠른 반복. 이호에는 *1이 없어서 이것이 트레몰로 역할이다
     *19 timbre    음색이 바뀐다. 바이올린에서는 나팔 비슷한 소리가 난다
     *20 mute      소리가 아주 작아진다 (데드 노트)
     *21 pullOff   튕기는 소리. *22보다 세다
     *22 hammerOn  튕기는 소리. *21보다 약하다
     [1] vibrato   피아노의 비브라토 (같은 효과인데 표기가 다르다)
     [2] fermata   늘임표
     [3] legato    바이올린. 감싼 구간을 이어서 연주
     [3] glissando 태평소·피리. 같은 번호인데 효과가 다르다
     [4] spiccato  바이올린·이호에서 스타카토 역할을 한다. 두 악기 효과가 같다

   *N은 악기가 달라도 번호와 효과가 같다. 대괄호는 그렇지 않아서
   [3]이 바이올린에서는 레가토, 태평소·피리에서는 글리산도다.
   그래서 번호가 아니라 반드시 역할 이름으로 찾아야 한다.

   악기 변종("메탈 기타", "고음 태평소" 등)은 기본형과 기법이 같다.

   타악기(북·드럼)는 음정 악기가 아니라 건반 하나하나가 서로 다른 타격음이다.
   그래서 MIDI 음정을 그대로 옮기면 안 되고 별도의 대응표가 필요하다.

     드럼  o4c 킥, o4c+ 스네어, o4d 탐1, o4d+ 탐2, o4e 탐3,
           o4f 하이햇(닫음), o4f+ 하이햇(열림), o4g 크래시1, o4g+ 크래시2,
           o4a 라이드, o4a+ 서스펜디드, o4b 카우벨,
           o5c 목탁, o5c+ 핸드벨, o5d 스틱, o5d+ 마라카스, o5e 트라이앵글

     북    o1 구간은 추임새(하!/훽!/싸!/요!/허!/후우!/후!/후싸!/호!/클랩/스냅),
           o4·o5·o6는 각각 북면·북채·북통 세 벌, o7c 저음, o7c+ 젬베 고음, o7d 중음

   자동 판정에 쓰는 이름은 staccato / accent / vibrato / graceUp / graceDown / legato 여섯이다.
   timbre는 MIDI에 근거가 없어서 자동으로 붙이지 않는다.
   목록이 비어 있는 악기는 게임에서 확인하지 못한 것이라 평음으로만 나간다.
   ============================================================ */
const TECHNIQUE_SETS = {
  "피아노":     { graceUp:"*8", graceDown:"*9", staccato:"*13", accent:"*14", vibrato:"[1]", fermata:"[2]" },
  "바이올린":   { vibrato:"*2", graceUp:"*8", graceDown:"*9", accent:"*14", timbre:"*19", legato:"[3]", staccato:"[4]" },
  "고쟁":       { tremolo:"*1", vibrato:"*2", bendUp:"*3", bendDown:"*4", harmonic:"*5", cluster:"*6", graceUp:"*8", graceDown:"*9", accent:"*14" },
  "태평소":     { vibrato:"*2", graceUp:"*8", graceDown:"*9", doubleTongue:"*10", tap:"*11", accent:"*14", flutter:"*17", timbre:"*19", glissando:"[3]" },
  "피리":       { vibrato:"*2", graceUp:"*8", graceDown:"*9", doubleTongue:"*10", tap:"*11", accent:"*14", flutter:"*17", timbre:"*19", glissando:"[3]" },
  "베이스":     { vibrato:"*2", harmonic:"*5", graceUp:"*8", graceDown:"*9", accent:"*14", timbre:"*19", mute:"*20", pullOff:"*21", hammerOn:"*22" },
  "기타":       { vibrato:"*2", harmonic:"*5", staccato:"*7", graceUp:"*8", graceDown:"*9", accent:"*14", timbre:"*19", mute:"*20" },
  "북":         { shoutMale:"*15", shoutFemale:"*16" },
  "드럼":       { accent:"*14" },
  "퉁소":       { vibrato:"*2", graceUp:"*8", graceDown:"*9", doubleTongue:"*10", tap:"*11", nogi:"*12", accent:"*14", timbre:"*19", glissando:"[3]" },
  "비파":       { tremolo:"*1", vibrato:"*2", bendUp:"*3", bendDown:"*4", harmonic:"*5", cluster:"*6", graceUp:"*8", graceDown:"*9", accent:"*14" },
  "이호":       { vibrato:"*2", bendUp:"*3", bendDown:"*4", harmonic:"*5", graceUp:"*8", graceDown:"*9", tap:"*11", accent:"*14", bowTremolo:"*18", timbre:"*19", staccato:"[4]" },
  "신디사이저": {}
};

/* 악기 + 기법 이름 → { code, place }. 그 악기에 없는 기법이면 null.
   place "post"  : *N — 음표 뒤에 붙는다. 그 음 하나에만 걸린다.
   place "range" : [N] — 토글이다. 여는 [N]과 닫는 [N] 사이의 음 전부에 걸린다.
                   그래서 음마다 찍으면 안 되고 구간을 감싸야 한다. */
function techniqueOf(instrument, role) {
  const set = TECHNIQUE_SETS[instrument];
  const code = set && set[role];
  if (!code) return null;
  return { code, place: code.charAt(0) === "[" ? "range" : "post" };
}

/* MIDI에서 자동으로 뽑아낼 수 있는 기법만 켠다.
   상/하, 페르마타 등은 MIDI 데이터만으로 판단할 근거가 없어 자동 적용하지 않는다. */
let AUTO_TECHNIQUE = true;

/* 스타카토 표시를 붙일지. 붙여도 음 길이는 원래 그대로 나가므로
   "표시만큼 더 짧아지는" 방향으로만 달라진다. 게임에서 확인 후 켜세요. */
let AUTO_STACCATO = false;

/* 스타카토: 실제 발음 길이가 그 자리(다음 음까지의 간격)의 이 비율 이하일 때 */
const STACCATO_RATIO = 0.55;

/* 악센트: 주변 음들의 평균 음량보다 이만큼(v 단위) 큰 음 */
const ACCENT_DELTA = 3;
const ACCENT_WINDOW = 8;   // 평균을 낼 앞뒤 음 개수

/* 악센트를 붙인 음의 v를 어떻게 할지.
   "replace" : v를 주변 평균으로 되돌린다. 강조는 *14가 담당 (이중으로 커지지 않음)
   "keep"    : 원래 v를 그대로 두고 *14도 붙인다 (아주 강한 강조) */
const ACCENT_MODE = "replace";

/* 비브라토: 모듈레이션(CC1)이 이 값 이상으로 걸린 구간의 음 */
const VIBRATO_CC_MIN = 40;

/* 꾸밈음(*8 / *9)
   "아주 짧은 음 하나 + 바로 뒤에 붙은 긴 음"을 한 음 + 기법으로 묶는다.
   본음이 꾸밈음의 자리까지 넘겨받으므로 박자는 그대로다.
   조건을 좁게 잡지 않으면 빠른 멜로디가 통째로 꾸밈음으로 먹히니 주의. */
/* 글리산도처럼 아주 빠르게 흐르는 음들은 격자에 맞추면 한 자리로 뭉쳐
   반음 클러스터 화음이 되어 버린다. 원래는 순서대로 흐르던 소리다.
   그래서 "원본에서는 시간차가 있었고 음정이 붙어 있는" 묶음은 화음으로
   보지 않고 1/64음표 간격으로 펼친다. 자리가 모자라면 솎아 낸다. */
const CLUSTER_MIN_NOTES = 3;      // 이 개수 이상 뭉쳤을 때만 검사한다
const CLUSTER_RAW_SPREAD = 2;     // 원본에서 이만큼은 시간차가 있었어야 한다

const GRACE_MAX_INTERVAL = 2;        // 본음과 반음 2개 이내 (1~2도)
const GRACE_MAX_TICK = WHOLE / 32;   // 꾸밈음 자리가 1/32음표 이하
const GRACE_MAIN_RATIO = 4;          // 본음이 꾸밈음보다 이 배 이상 길어야 한다

/* 레가토([3] … [3])
   음이 자기 자리를 거의 다 채워서 다음 음까지 빈틈이 없는 구간을 감싼다.
   토글이라 반드시 짝을 맞춰 닫아야 한다. */
const LEGATO_RATIO = 0.95;     // 발음 길이가 자리의 이 비율 이상이면 다음 음과 이어진 것으로 본다
const LEGATO_MIN_NOTES = 3;    // 이만큼 연속으로 이어져야 레가토를 켠다

/* ============================================================
   악기 맵 (General MIDI)
   ============================================================ */
const INSTRUMENT_MAP = ["acoustic grand piano","bright acoustic piano","electric grand piano","honky-tonk piano","electric piano 1","electric piano 2","harpsichord","clavi","celesta","glockenspiel","music box","vibraphone","marimba","xylophone","tubular bells","dulcimer","drawbar organ","percussive organ","rock organ","church organ","reed organ","accordion","harmonica","tango accordion","acoustic guitar (nylon)","acoustic guitar (steel)","electric guitar (jazz)","electric guitar (clean)","electric guitar (muted)","overdriven guitar","distortion guitar","guitar harmonics","acoustic bass","electric bass (finger)","electric bass (pick)","fretless bass","slap bass 1","slap bass 2","synth bass 1","synth bass 2","violin","viola","cello","contrabass","tremolo strings","pizzicato strings","orchestral harp","timpani","string ensemble 1","string ensemble 2","synthstrings 1","synthstrings 2","choir aahs","voice oohs","synth voice","orchestra hit","trumpet","trombone","tuba","muted trumpet","french horn","brass section","synthbrass 1","synthbrass 2","soprano sax","alto sax","tenor sax","baritone sax","oboe","english horn","bassoon","clarinet","piccolo","flute","recorder","pan flute","blown bottle","shakuhachi","whistle","ocarina","lead 1 (square)","lead 2 (sawtooth)","lead 3 (calliope)","lead 4 (chiff)","lead 5 (charang)","lead 6 (voice)","lead 7 (fifths)","lead 8 (bass + lead)","pad 1 (new age)","pad 2 (warm)","pad 3 (polysynth)","pad 4 (choir)","pad 5 (bowed)","pad 6 (metallic)","pad 7 (halo)","pad 8 (sweep)","fx 1 (rain)","fx 2 (soundtrack)","fx 3 (crystal)","fx 4 (atmosphere)","fx 5 (brightness)","fx 6 (goblins)","fx 7 (echoes)","fx 8 (sci-fi)","sitar","banjo","shamisen","koto","kalimba","bag pipe","fiddle","shanai","tinkle bell","agogo","steel drums","woodblock","taiko drum","melodic tom","synth drum","reverse cymbal","guitar fret noise","breath noise","seashore","bird tweet","telephone ring","helicopter","applause","gunshot"];

const PITCH_CLASS = ["c","c+","d","d+","e","f","f+","g","g+","a","a+","b"];
const REST = "r";

/* 게임에서 고를 수 있는 악기.
   지금은 화면에서 고르기만 하고 변환 결과에는 반영하지 않는다. */
const ARMIS_INSTRUMENTS = ["피아노","북","고쟁","퉁소","바이올린","기타","비파","이호","피리","드럼","베이스","신디사이저","태평소"];

/* ============================================================
   타악기 건반 대응표 (General MIDI 타악기 → 아르미스 건반)
   ============================================================
   북·드럼은 음정 악기가 아니라 건반마다 다른 타격음이 들어 있다.
   MIDI 드럼 트랙의 음정은 GM 규격 번호(35=킥, 38=스네어 …)이므로
   그대로 옮기면 엉뚱한 소리가 난다. 그래서 번호를 갈아끼운다.

   값은 MIDI 키 번호다. o4c = 60 기준.
   아르미스 쪽 소리가 GM보다 적어서 여러 개가 하나로 합쳐지는 건 어쩔 수 없다.
   (탐 6종 → 3종, 심벌 4종 → 2종 등)
   ============================================================ */
const DRUM_KEYS = {                     // 드럼: o4c~o5e
  킥:60, 스네어:61, 탐1:62, 탐2:63, 탐3:64,
  하이햇닫음:65, 하이햇열림:66, 크래시1:67, 크래시2:68,
  라이드:69, 서스펜디드:70, 카우벨:71,
  목탁:72, 핸드벨:73, 스틱:74, 마라카스:75, 트라이앵글:76
};

const BUK_KEYS = {                      // 북: o1 추임새, o4~o6 세 벌, o7 젬베
  클랩:33, 스냅:34,
  북면4:60, 북채4:61, 북통4:62,
  북면5:72, 북채5:73, 북통5:74,
  북면6:84, 북채6:85, 북통6:86,
  젬베저음:96, 젬베고음:97, 젬베중음:98
};

const PERCUSSION_MAPS = {
  "드럼": {
    fallback: DRUM_KEYS.탐1,
    map: {
      35:DRUM_KEYS.킥, 36:DRUM_KEYS.킥,
      37:DRUM_KEYS.스틱, 38:DRUM_KEYS.스네어, 39:DRUM_KEYS.스네어, 40:DRUM_KEYS.스네어,
      41:DRUM_KEYS.탐1, 43:DRUM_KEYS.탐1, 45:DRUM_KEYS.탐1,
      47:DRUM_KEYS.탐2, 48:DRUM_KEYS.탐2,
      50:DRUM_KEYS.탐3,
      42:DRUM_KEYS.하이햇닫음, 44:DRUM_KEYS.하이햇닫음, 46:DRUM_KEYS.하이햇열림,
      49:DRUM_KEYS.크래시1, 52:DRUM_KEYS.크래시2, 55:DRUM_KEYS.크래시2, 57:DRUM_KEYS.크래시2,
      51:DRUM_KEYS.라이드, 53:DRUM_KEYS.라이드, 59:DRUM_KEYS.라이드,
      54:DRUM_KEYS.마라카스, 56:DRUM_KEYS.카우벨, 58:DRUM_KEYS.마라카스,
      60:DRUM_KEYS.탐3, 61:DRUM_KEYS.탐2, 62:DRUM_KEYS.탐3, 63:DRUM_KEYS.탐2, 64:DRUM_KEYS.탐1,
      65:DRUM_KEYS.탐2, 66:DRUM_KEYS.탐1, 67:DRUM_KEYS.카우벨, 68:DRUM_KEYS.카우벨,
      69:DRUM_KEYS.마라카스, 70:DRUM_KEYS.마라카스, 71:DRUM_KEYS.트라이앵글, 72:DRUM_KEYS.트라이앵글,
      73:DRUM_KEYS.마라카스, 74:DRUM_KEYS.마라카스, 75:DRUM_KEYS.스틱,
      76:DRUM_KEYS.목탁, 77:DRUM_KEYS.목탁,
      78:DRUM_KEYS.마라카스, 79:DRUM_KEYS.마라카스,
      80:DRUM_KEYS.트라이앵글, 81:DRUM_KEYS.트라이앵글, 82:DRUM_KEYS.마라카스
    }
  },
  "북": {
    fallback: BUK_KEYS.북면4,
    map: {
      35:BUK_KEYS.북통6, 36:BUK_KEYS.북통6,           // 킥 → 가장 낮은 울림
      37:BUK_KEYS.북채4, 38:BUK_KEYS.북면4, 40:BUK_KEYS.북면4,
      39:BUK_KEYS.클랩,
      41:BUK_KEYS.북통5, 43:BUK_KEYS.북통5, 45:BUK_KEYS.북통5,
      47:BUK_KEYS.북면5, 48:BUK_KEYS.북면5, 50:BUK_KEYS.북면5,
      42:BUK_KEYS.북채5, 44:BUK_KEYS.북채5, 46:BUK_KEYS.북채6,
      49:BUK_KEYS.북면6, 52:BUK_KEYS.북면6, 55:BUK_KEYS.북면6, 57:BUK_KEYS.북면6,
      51:BUK_KEYS.북채6, 53:BUK_KEYS.북채6, 59:BUK_KEYS.북채6,
      54:BUK_KEYS.스냅, 56:BUK_KEYS.북채4, 58:BUK_KEYS.스냅,
      60:BUK_KEYS.젬베고음, 61:BUK_KEYS.젬베중음,
      62:BUK_KEYS.젬베고음, 63:BUK_KEYS.젬베고음, 64:BUK_KEYS.젬베저음,
      65:BUK_KEYS.북면5, 66:BUK_KEYS.북통5, 67:BUK_KEYS.북채4, 68:BUK_KEYS.북채4,
      69:BUK_KEYS.스냅, 70:BUK_KEYS.스냅, 75:BUK_KEYS.북채4,
      76:BUK_KEYS.북채4, 77:BUK_KEYS.북채4, 82:BUK_KEYS.스냅
    }
  }
};

/* 타악기면 GM 번호를 아르미스 건반으로 바꾼다. 음정 악기면 그대로 둔다. */
function mapPercussion(key, instrument) {
  const p = PERCUSSION_MAPS[instrument];
  if (!p) return key;
  const hit = p.map[key];
  return hit === undefined ? p.fallback : hit;
}

/* 특정 건반만 음량을 깎는다.
   드럼 하이햇은 음원 자체가 커서 다른 타격음과 균형이 안 맞는다.
   매핑이 끝난 뒤의 건반 번호를 기준으로 하고, v 하한(VEL_MIN) 아래로는 안 내려간다. */
const VELOCITY_TRIM = {
  "드럼": {
    [DRUM_KEYS.하이햇닫음]: -3,
    [DRUM_KEYS.하이햇열림]: -3
  }
};

function trimVelocity(v, key, instrument) {
  const table = VELOCITY_TRIM[instrument];
  const delta = table && table[key];
  if (!delta) return v;
  const [lo, hi] = velRange();
  return Math.max(lo, Math.min(hi, v + delta));
}

/* ============================================================
   tick 테이블 (모듈 로드 시 1회 생성)
   ============================================================
   MabiIcco MMLTickTable.generateInvTable 이식.
   토큰 1~COMBN개를 더해서 만들 수 있는 모든 tick 길이를 미리 만들어 두고,
   가장 짧게 표기되는 조합을 정답으로 저장한다.
   덕분에 "tick 길이 → MML"이 반올림 없이 정확히 떨어진다.
   ============================================================ */
function tokenTick(token) {
  const dot = token.endsWith(".");
  const n = parseInt(dot ? token.slice(0, -1) : token, 10);
  if (!n) return 0;
  let t = WHOLE / n;
  if (!Number.isInteger(t)) return 0;
  if (dot) {
    if (t % 2 !== 0) return 0;
    t += t / 2;
  }
  return t;
}

const TOKENS = LENGTH_TOKENS
  .map(name => ({ name, tick: tokenTick(name) }))
  .filter(x => x.tick > 0)
  .sort((a, b) => b.tick - a.tick);

const MIN_TICK = Math.min(...TOKENS.map(t => t.tick));   // 표현 가능한 최소 길이

/* 마비꼬 MMLTickTable.MMLPattern.patternLength 그대로 이식.
   단순히 짧은 조합을 고르는 게 아니라 "흔한 길이"에 가중치를 준다.
     1 2 4 8 16       → 글자수 그대로
     1. 2. 4. 8. 16.  → 글자수 ×2
     그 외(32/64/셋잇단 3·6·12·24·48) → 글자수 ×3
   같은 tick을 여러 방법으로 적을 수 있을 때 흔한 음표 쪽을 고르게 되고,
   그 결과 나중에 l(기본 길이) 최적화가 훨씬 잘 먹는다. */
const PLAIN_LENGTHS = ["1", "2", "4", "8", "16"];
function patternCost(list) {
  let len = 0;
  for (const s of list) {
    if (PLAIN_LENGTHS.indexOf(s) >= 0) len += s.length;
    else if (s.endsWith(".") && PLAIN_LENGTHS.indexOf(s.slice(0, -1)) >= 0) len += s.length * 2;
    else len += s.length * 3;
  }
  return len + list.length * 10;
}

const TICK_TABLE = (() => {
  const map = new Map();
  const cost = patternCost;
  const limit = WHOLE * 2 - 1;   // 마비꼬 generateInvTable의 mTick = tick("1")*2 - 1

  const walk = (from, chosen, total) => {
    if (chosen.length) {
      const cur = map.get(total);
      if (!cur || cost(chosen) < cost(cur)) map.set(total, chosen.slice());
    }
    if (chosen.length >= COMBN) return;
    for (let i = from; i < TOKENS.length; i++) {
      const next = total + TOKENS[i].tick;
      if (next > limit) continue;
      chosen.push(TOKENS[i].name);
      walk(i, chosen, next);
      chosen.pop();
    }
  };
  walk(0, [], 0);
  return map;
})();

const TICK_KEYS = [...TICK_TABLE.keys()].sort((a, b) => a - b);

/* 주어진 값 이하 중 표현 가능한 가장 큰 tick */
function largestFitting(tick) {
  let lo = 0, hi = TICK_KEYS.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (TICK_KEYS[mid] <= tick) { best = TICK_KEYS[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

/* tick 길이 → 표현 가능한 토큰 목록 + 실제로 찍히는 tick.
   반환값의 tick은 "실제로 찍힌 길이"다. 요청 길이와 다를 수 있으므로
   커서 계산에는 반드시 이 값을 쓴다. (박자 밀림 방지의 핵심)
   여기서는 요청 tick 중 MIN_TICK 미만으로 남는 "나머지"를 그냥 버린다.
   이 나머지를 절대 잃어버리지 않게 만드는 건 createTickEmitter()의 역할이다. */
/* 2분할 기본 음표. 표에 없는 길이를 깎아 내려갈 때 쓴다. */
const BASE_TOKENS = ["1", "2", "4", "8", "16", "32", "64"]
  .map(name => ({ name, tick: tokenTick(name) }))
  .filter(t => t.tick > 0);

/* 표에 없는 길이를 어떻게 쪼갤지 — 두 가지 방법을 다 계산해서 싼 쪽을 쓴다.

   (A) 마비꼬 MMLTicks.makeMMLText 방식
       온음표부터 차례로 깎아 내려가되, 깎을 때마다 표를 다시 확인한다.
       "큰 값은 큰 값답게" 떨어지므로 384*2=768 같은 값이 c1&c1 로 깔끔하다.
   (B) 예전 방식: 표에서 가장 큰 값을 집는다.
       셋잇단이 섞인 어중간한 길이에서 토큰 수가 적게 나오는 경우가 있다.

   예전에는 (B)만 썼는데, 768 tick(온음표 두 개)이 1.+4.+16.+32 네 토막으로
   찢어지는 문제가 있었다. (A)만 쓰면 이번엔 셋잇단 쪽이 길어진다.
   그래서 patternCost로 재서 짧은 쪽을 고른다. */
function resolveByBase(rem) {
  const out = [];
  let used = 0;
  for (const b of BASE_TOKENS) {
    if (rem < MIN_TICK) break;
    const exact = TICK_TABLE.get(rem);
    if (exact) { out.push(...exact); used += rem; rem = 0; break; }
    while (rem >= b.tick) { out.push(b.name); used += b.tick; rem -= b.tick; }
  }
  return { tokens: out, tick: used };
}

function resolveByLargest(rem) {
  const out = [];
  let used = 0;
  while (rem >= MIN_TICK) {
    const exact = TICK_TABLE.get(rem);
    if (exact) { out.push(...exact); used += rem; rem = 0; break; }
    const fit = largestFitting(rem);
    if (!fit) break;
    out.push(...TICK_TABLE.get(fit));
    used += fit;
    rem -= fit;
  }
  return { tokens: out, tick: used };
}

const tickTokenCache = new Map();

function resolveTickTokens(tick) {
  const hit = tickTokenCache.get(tick);
  if (hit) return hit;
  const r = resolveTickTokensUncached(tick);
  if (tickTokenCache.size < 20000) tickTokenCache.set(tick, r);
  return r;
}

function resolveTickTokensUncached(tick) {
  let rem = Math.max(0, Math.round(tick));
  const out = [];
  let used = 0;

  // 아주 긴 음: "1."을 반복해서 줄인다 (MMLTicks.toMMLText)
  const dottedWhole = tokenTick("1.");
  while (rem > WHOLE * 2) { out.push("1."); rem -= dottedWhole; used += dottedWhole; }

  if (rem >= MIN_TICK) {
    const a = resolveByBase(rem);
    const b = resolveByLargest(rem);
    // 더 많이 채우는 쪽이 우선, 같으면 짧게 찍히는 쪽
    const win = (b.tick > a.tick) ? b
              : (a.tick > b.tick) ? a
              : (patternCost(a.tokens) <= patternCost(b.tokens) ? a : b);
    out.push(...win.tokens);
    used += win.tick;
  }

  return { tokens: out, tick: used };
}

function tokensToText(name, tokens, tie) {
  return tokens.map(t => name + t).join(tie ? "&" : "");
}

/* ============================================================
   tick 오차 이월기 — "오차는 절대 무시하지 않는다"
   ============================================================
   MIN_TICK(6틱, 1/64음표)보다 작은 나머지는 어떤 토큰으로도 표현할 수 없다.
   이걸 그냥 버리면 그 자리 하나는 몇 틱 짧게 나오는데, 문제는 그 뒤로도
   계속 짧게 나온 만큼 밀린 채로 남는다는 것이다. (특히 템포가 겹치면
   양자화 스냅으로 이 나머지가 훨씬 자주 발생한다.)

   createTickEmitter()가 만드는 take()는 "요청 tick + 지난번에 못 채운 나머지"를
   합쳐서 변환하고, 이번에도 못 채운 나머지를 다시 들고 있다가 바로 다음
   호출에 얹는다. 개별 음/쉼표 하나의 실제 길이가 몇 tick 어긋날 수는 있지만
   (최대 MIN_TICK-1 = 5틱, 약 26ms@120bpm), 트랙 전체로 합산하면 tick이
   단 하나도 사라지지 않는다. (표준적인 Bresenham식 오차 이월) */
function createTickEmitter() {
  let carry = 0;
  const take = function (tick) {
    const want = Math.max(0, tick) + carry;
    const r = resolveTickTokens(want);
    carry = want - r.tick;   // 항상 0 이상. 다음 호출로 그대로 넘어간다.
    return r;
  };
  /* 화음 안에서 실제로 찍힌 길이가 계산보다 짧게 나오는 경우가 있다.
     (구성음을 무음+조각+본음으로 쪼개면 토막마다 잔여 틱이 조금씩 생긴다)
     Armis에서 커서를 미는 건 "가장 긴 구성음"이므로, 어느 구성음도 계산한
     길이에 닿지 못하면 그만큼 커서가 덜 전진한다. 그 차이를 여기로 돌려주면
     다음 쉼표나 음이 대신 메워서 박자가 밀리지 않는다. */
  take.giveBack = function (tick) { carry += Math.max(0, tick); };
  return take;
}

/* ============================================================
   변환 유틸
   ============================================================ */
/* 원본 tick → 내부 TPQN tick (MabiIcco MidiFile.convTick) */
function toTick(tick, ppq) {
  if (!isFinite(ppq) || ppq <= 0) return 0;
  return Math.round((tick * TPQN) / ppq);
}

/* 격자 스냅. 2분할·3분할 중 가까운 쪽을 고르므로 셋잇단이 살아남는다. */
function snap(tick) {
  if (QUANTIZE_MODE === "none") return tick;
  const b = Math.round(tick / BINARY_GRID) * BINARY_GRID;
  if (QUANTIZE_MODE === "binary") return b;
  const t = Math.round(tick / TRIPLET_GRID) * TRIPLET_GRID;
  return Math.abs(tick - b) <= Math.abs(tick - t) ? b : t;
}


function keyToPitchClass(k) { return PITCH_CLASS[((k % 12) + 12) % 12]; }
/* 건반 번호 → o 숫자. 이 엔진의 규약은 o0 c = 건반 12다 (oN c = (N+1)×12).
   예전에는 12 미만을 0으로 뭉갰는데, 그러면 건반 0~11도 옥타브 0으로 읽혀
   clampKey가 "범위 안"이라 보고 그대로 통과시켰다. 그 음은 MML에 o0으로
   적혀 실제보다 한 옥타브 높게 연주되고, 편집기로 불러오면 판(행 0~107)
   밖의 행이 되어 화면에서 사라졌다. 음수 옥타브를 그대로 돌려주면
   clampKey의 접기(while < OCTAVE_MIN → +12)가 제대로 작동한다. */
function keyToOctave(k) { return Math.trunc(k / 12) - 1; }

/* 범위를 벗어난 음을 옥타브 단위로 접어 넣는다.
   마비꼬(MMLNoteEvent.toMMLString)는 범위 밖이면 예외를 던져 그 음을 버리는데,
   음이 통째로 사라지는 것보다 옥타브만 옮겨 남기는 편이 낫다. */
function clampKey(k) {
  while (keyToOctave(k) > OCTAVE_MAX) k -= 12;
  while (keyToOctave(k) < OCTAVE_MIN) k += 12;
  return k;
}
function velocityToMml(v) {
  const [lo, hi] = velRange();
  const val = Math.trunc((v * (hi - lo)) / 127) + lo;
  return Math.max(lo, Math.min(hi, val));
}

function microsToBpm(micros) {
  if (!isFinite(micros) || micros <= 0) return INITIAL_TEMPO;
  return Math.max(1, Math.min(1000, Math.round(60000000 / micros)));
}

/* ============================================================
   SMF 파서
   ============================================================ */
function readU32(b, i) { return ((b[i] << 24) | (b[i+1] << 16) | (b[i+2] << 8) | b[i+3]) >>> 0; }
function readU16(b, i) { return ((b[i] << 8) | b[i+1]) >>> 0; }

function readVar(b, i) {
  let value = 0, pos = i, byte;
  do {
    if (pos >= b.length) throw new Error("MIDI 가변길이 값이 잘렸습니다.");
    byte = b[pos++];
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return { value, next: pos };
}

function parseSMF(buffer) {
  const b = new Uint8Array(buffer);
  let i = 0;

  function chunk() {
    if (i + 8 > b.length) throw new Error("MIDI 청크가 손상되었습니다.");
    const id = String.fromCharCode(b[i], b[i+1], b[i+2], b[i+3]);
    i += 4;
    const len = readU32(b, i);
    i += 4;
    if (i + len > b.length) throw new Error("MIDI 청크 길이가 파일 크기를 넘습니다.");
    const data = b.slice(i, i + len);
    i += len;
    return { id, data };
  }

  const head = chunk();
  if (head.id !== "MThd") throw new Error("MIDI 헤더(MThd)를 찾지 못했습니다.");
  if (head.data.length < 6) throw new Error("MIDI 헤더가 너무 짧습니다.");

  const format = readU16(head.data, 0);
  const ntrks  = readU16(head.data, 2);
  const division = readU16(head.data, 4);

  if ((division & 0x8000) !== 0) {
    throw new Error("SMPTE 기준 MIDI는 지원하지 않습니다. PPQ 기준 파일로 저장한 뒤 다시 올려주세요.");
  }
  const ppq = division & 0x7fff;
  if (ppq <= 0) throw new Error("PPQ 값이 올바르지 않습니다.");

  const tracks = [];
  for (let t = 0; t < ntrks && i < b.length; t++) {
    const c = chunk();
    if (c.id !== "MTrk") continue;

    const d = c.data;
    let pos = 0, tick = 0, running = null;
    const events = [];

    while (pos < d.length) {
      const delta = readVar(d, pos);
      pos = delta.next;
      tick += delta.value;
      if (pos >= d.length) break;

      const status = d[pos];
      if (status < 0x80) {
        if (running === null) throw new Error("running status 없이 데이터 바이트가 나왔습니다.");
      } else {
        pos++;
        running = status;
      }

      // 메타 이벤트
      if (running === 0xFF) {
        if (pos >= d.length) break;
        const metaType = d[pos++];
        const len = readVar(d, pos);
        pos = len.next;
        const payload = d.slice(pos, pos + len.value);
        pos += len.value;
        if (metaType === 0x51 && payload.length === 3) {
          const micros = (payload[0] << 16) | (payload[1] << 8) | payload[2];
          events.push({ tick, type: "tempo", bpm: microsToBpm(micros) });
        }
        running = null;      // 메타는 running status를 취소한다
        if (metaType === 0x2F) break;
        continue;
      }

      // SysEx
      if (running === 0xF0 || running === 0xF7) {
        const len = readVar(d, pos);
        pos = len.next + len.value;
        running = null;      // SysEx도 running status를 취소한다
        continue;
      }

      const hi = running & 0xF0;
      const ch = running & 0x0F;

      if (hi === 0x90 || hi === 0x80) {
        if (pos + 2 > d.length) break;
        const key = d[pos++], vel = d[pos++];
        const isOn = (hi === 0x90 && vel > 0);
        events.push({ tick, type: isOn ? "on" : "off", ch, key, vel });
      } else if (hi === 0xC0) {
        if (pos + 1 > d.length) break;
        events.push({ tick, type: "program", ch, program: d[pos++] });
      } else if (hi === 0xB0) {
        if (pos + 2 > d.length) break;
        const cc = d[pos++], value = d[pos++];
        if (cc === 1) events.push({ tick, type: "mod", ch, value });      // 비브라토 판정용
      } else if (hi === 0xA0 || hi === 0xE0) {
        pos += 2;
      } else if (hi === 0xD0) {
        pos += 1;
      }
    }
    tracks.push(events);
  }

  return { format, ppq, tracks };
}

/* ============================================================
   노트 추출 — (트랙, 채널)별로 분리
   ============================================================ */
function collectParts(smf) {
  const parts = new Map();   // "trackIndex:channel" -> part
  const tempos = [];         // {tick, bpm}
  let endTick = 0;

  smf.tracks.forEach((events, trackIndex) => {
    const holding = new Map();  // "ch:key" -> [note, ...]

    const partOf = (ch) => {
      const id = trackIndex + ":" + ch;
      if (!parts.has(id)) {
        parts.set(id, { id, trackIndex, channel: ch, program: null, notes: [], mods: [] });
      }
      return parts.get(id);
    };

    /* 같은 음정이 겹쳐 울릴 때 note-off를 어느 음에 물릴 것인가.

       예전에는 새 note-on이 오면 울리던 음을 그 자리에서 닫았는데, 그러면
       먼저 울리던 음의 note-off가 방금 시작한 음을 대신 죽여 버린다.

         on(0)  on(475)  off(480)  off(955)
         닫고-열기 → 0~475 그리고 475~480 (5 tick 짜리 삑사리)
                       955의 off는 닫을 음이 없어 버려진다

       그래서 같은 음정을 큐로 들고, note-off는 가장 먼저 시작한 음을 닫는다.
       (일반적인 시퀀서와 같은 해석)

         큐 방식 → 0~480 그리고 475~955  ← 둘 다 제 길이

       완전히 같은 자리에서 두 번 눌린 유니즌도 이 방식이면 둘 다 제 길이로
       남고, 뒤에서 화음으로 합칠 때 하나로 정리된다. */
    const closeNote = (ch, key, tick) => {
      const k = ch + ":" + key;
      const queue = holding.get(k);
      if (!queue || !queue.length) return;
      const note = queue.shift();          // 가장 먼저 시작한 음부터 닫는다
      note.endTick = Math.max(note.startTick, tick);
      partOf(ch).notes.push(note);
      if (!queue.length) holding.delete(k);
    };

    const openNote = (ch, key, vel, tick) => {
      const k = ch + ":" + key;
      if (!holding.has(k)) holding.set(k, []);
      holding.get(k).push({ key, velocity: vel, startTick: tick, endTick: tick, ch });
    };

    for (const ev of events) {
      endTick = Math.max(endTick, ev.tick);
      if (ev.type === "tempo") { tempos.push({ tick: ev.tick, bpm: ev.bpm }); continue; }
      if (ev.type === "program") { const p = partOf(ev.ch); if (p.program === null) p.program = ev.program; continue; }
      if (ev.type === "mod") { partOf(ev.ch).mods.push({ tick: ev.tick, value: ev.value }); continue; }
      if (ev.type === "on")  { openNote(ev.ch, ev.key, ev.vel, ev.tick); continue; }
      if (ev.type === "off") { closeNote(ev.ch, ev.key, ev.tick); continue; }
    }

    // 닫히지 않은 음은 트랙 끝에서 닫는다
    for (const [k, queue] of holding) {
      const ch = Number(k.split(":")[0]);
      for (const note of queue) {
        note.endTick = Math.max(note.startTick, endTick);
        partOf(ch).notes.push(note);
      }
    }
    holding.clear();
  });

  return {
    parts: [...parts.values()].filter(p => p.notes.length > 0),
    tempos,
    endTick
  };
}

/* 같은 tick의 템포는 마지막 값만, 값이 안 바뀌면 버린다 */
function normalizeTempos(raw, ppq) {
  const byTick = new Map();
  for (const t of raw) byTick.set(t.tick, t.bpm);
  const sorted = [...byTick.entries()].sort((a, b) => a[0] - b[0]);

  const out = [];
  let last = null;
  if (!sorted.length || sorted[0][0] > 0) { out.push({ pos: 0, bpm: INITIAL_TEMPO }); last = INITIAL_TEMPO; }
  for (const [tick, bpm] of sorted) {
    if (bpm === last) continue;
    out.push({ pos: snap(toTick(tick, ppq)), bpm });
    last = bpm;
  }
  // 스냅 후 같은 자리에 몰린 템포는 마지막 것만
  const merged = [];
  for (const t of out) {
    if (merged.length && merged[merged.length - 1].pos === t.pos) merged[merged.length - 1] = t;
    else merged.push(t);
  }
  return merged;
}

/* ============================================================
   템포 경계 처리 — "화음은 절대 안 쪼갠다 / 단음은 정확히 쪼갠다"
   ============================================================
   음(또는 화음)의 발음 구간 "안쪽"에 템포 변경이 걸리는 경우를 처리한다.

   - 화음(동시에 2음 이상): 쪼개지 않는다. 걸린 템포를 전부 화음 시작
     지점으로 당겨서, 화음이 울리기 직전에 템포가 바뀌도록 한다.
     (여러 개가 한 화음 안에 몰려 있으면 원래 순서대로 화음 시작 지점에
     연달아 찍히고, 최종적으로는 마지막 값이 남는다.)

   - 단음: 정확한 tick 위치에서 두 조각으로 쪼개고 그 사이에 템포를
     끼워 넣는다. Armis에서 템포 사이에도 같은 음을 &로 이어붙일 수
     있다는 전제 하에 동작한다 (c4&t140&c8 형태).

   표현 가능한 최소 길이(MIN_TICK, 1/64음표)보다 짧은 조각이 생기는
   경우에는 쪼개지 않고 가까운 경계(구간 시작 또는 끝) 쪽으로 흡수한다.
   어떤 경우에도 템포 이벤트 자체를 버리지는 않는다 — 최대 MIN_TICK-1
   틱(약 26ms@120bpm) 이내로 위치만 조정될 뿐이다. */
function resolveTempoBoundaries(groups, tempos) {
  const adjustedTempos = tempos.map(t => ({ ...t }));  // song 전체가 공유하는 배열은 건드리지 않는다
  const outGroups = [];

  for (const g of groups) {
    const spanStart = g.start;
    const spanEnd = g.start + g.duration;

    const inside = adjustedTempos.filter(t => t.pos > spanStart && t.pos < spanEnd);
    if (!inside.length) { outGroups.push(g); continue; }

    if (g.notes.length > 1) {
      /* 화음은 타이로 쪼갤 수 없다. 예전에는 템포를 화음 시작으로 당겼는데,
         화음이 놓인 자리가 트랙마다 다르다 보니 같은 템포가 트랙마다 다른
         시각에 걸렸다. 한 번 어긋나면 그 뒤로 영영 어긋난 채로 간다.

         그래서 템포를 옮기는 대신 화음을 템포 자리에서 끊는다.
         화음이 조금 짧아질 뿐 템포는 제자리에 남고, 남은 자리는 쉼표가 된다.
         쉼표는 얼마든지 쪼갤 수 있으므로 뒤따르는 템포도 제자리에 찍힌다. */
      const cut = inside[0].pos - spanStart;
      if (cut >= MIN_TICK) {
        g.duration = cut;
      } else {
        // 끊어 봐야 표현할 수 없을 만큼 앞이면 그때만 화음 시작으로 당긴다
        for (const t of inside) if (t.pos - spanStart < MIN_TICK) t.pos = spanStart;
      }
      outGroups.push(g);
      continue;
    }

    // 단음: 표현 불가능한(MIN_TICK 미만) 조각이 생기지 않도록 경계로 흡수한다.
    inside.sort((a, b) => a.pos - b.pos);
    for (const t of inside) {
      if (t.pos - spanStart < MIN_TICK) t.pos = spanStart;
      else if (spanEnd - t.pos < MIN_TICK) t.pos = spanEnd;
    }

    // 흡수 후에도 정말 "구간 안쪽"에 남아 분할이 필요한 지점만 추린다.
    let splitPoints = [...new Set(
      inside.filter(t => t.pos > spanStart && t.pos < spanEnd).map(t => t.pos)
    )].sort((a, b) => a - b);

    // 서로 MIN_TICK보다 가까운 분할점은 더 나중 값(마지막 템포)만 남긴다.
    const merged = [];
    for (const pos of splitPoints) {
      if (merged.length && pos - merged[merged.length - 1] < MIN_TICK) merged[merged.length - 1] = pos;
      else merged.push(pos);
    }
    splitPoints = merged;

    if (!splitPoints.length) { outGroups.push(g); continue; }

    let pieceStart = spanStart;
    const pieces = [];
    for (const pos of splitPoints) {
      pieces.push({ start: pieceStart, duration: pos - pieceStart });
      pieceStart = pos;
    }
    pieces.push({ start: pieceStart, duration: spanEnd - pieceStart });

    pieces.forEach((piece, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === pieces.length - 1;
      outGroups.push({
        start: piece.start,
        duration: piece.duration,
        notes: g.notes,               // 같은 음이므로 그대로 공유
        velocity: g.velocity,
        // [N] 구간 기법은 쪼개진 조각 전체가 아니라 원래 음 전체를 감싸야 하므로
        // 여는 태그는 첫 조각에만, 닫는 태그는 마지막 조각에만 남긴다.
        open: isFirst ? g.open : undefined,
        close: isLast ? g.close : undefined,
        // *N 기법(스타카토 등)은 마지막으로 소리가 실제로 끊기는 조각에서만 의미가 있다.
        techniques: isLast ? g.techniques : [],
        staccato: isLast ? g.staccato : false,
        tied: !isFirst,               // 앞 조각과 &로 이어붙일 조각인지
        continues: !isLast            // 뒤에 템포로 쪼개진 조각이 더 있는지 (닫는 &가 필요)
      });
    });
  }

  return { groups: outGroups, tempos: adjustedTempos };
}

/* ============================================================
   MML 이벤트 생성
   ============================================================
   1단계 makeGroups()  노트 → 화음 그룹 (+꾸밈음 흡수)
   2단계 buildEvents() MML 이벤트 목록으로
   서스테인 트랙은 makeSustainGroups()가 만든 그룹을 2단계에 그대로 넣는다.
   ============================================================ */
/* 1단계: 노트 → 화음 그룹.
   같은 시작점(또는 1/64음표보다 가까운 시작점)은 한 화음으로 묶는다.
   여기서 정하는 fullDur은 "원래 울리는 길이"이고, 아직 다음 음 시작에
   맞춰 자르지 않는다. 자르는 건 3단계에서 한다. */
/* ── 전역 시작점 지도 ──
   모든 파트의 노트를 시간순으로 훑어, 서로 MIN_TICK(1/64음표) 안에
   시작하는 음들을 한 덩어리로 묶고, 덩어리의 가운데 음 자리를 딱 한 번
   격자에 맞춘다. 조회 함수는 raw 위치 → 그 덩어리의 시작점을 돌려준다.

   이렇게 하면 (1) 한 트랙 안의 화음이 안 갈라지고 (2) 트랙이 달라도
   같이 친 히트는 같은 시작점을 받아 합주가 안 어긋난다.
   시작점은 단조증가를 강제한다 — 스냅이 드물게 순서를 뒤집을 수 있어서다. */
function buildGlobalStartMap(partList, ppq) {
  /* 각 음을 {t: 위치, pk: "파트:건반"} 으로 모은다.
     pk는 아래 "잘린 동시타 붙이기"에서, 같은 트랙의 같은 건반이 겹치는
     덩어리(=빠른 반복음)를 실수로 합쳐 한 음을 지워 버리지 않기 위한 표식이다. */
  const raws = [];
  let pi = 0;
  for (const item of partList) {
    const notes = item && item.part && item.part.notes;
    pi++;
    if (!notes) continue;
    for (const n of notes) raws.push({ t: toTick(n.startTick, ppq), pk: pi + ":" + n.key });
  }
  raws.sort((a, b) => a.t - b.t);

  /* 덩어리 나누기 — 앞에서부터 MIN_TICK 창으로 쌓는다.
     이 방식은 덩어리의 첫 음들이 서로 MIN_TICK 이상 떨어진다는 보장이
     있어, 아래 스냅 단계에서 시작점 충돌(→ 밀기 연쇄)이 거의 없다.
     (틈이 큰 곳에서 자르는 방식도 시험했지만, 빈틈없이 이어지는 곡에서
      1~2틱 간격의 덩어리들이 생겨 밀기가 연쇄되며 오히려 나빠졌다.) */
  const clusters = [];   // 각 원소 = 구성 {t, pk} 배열
  let members = [];

  for (const r of raws) {
    if (!members.length || r.t - members[0].t < MIN_TICK) {
      members.push(r);
    } else {
      clusters.push(members);
      members = [r];
    }
  }
  if (members.length) clusters.push(members);

  /* 잘린 동시타 붙이기.
     무관한 앞 음이 창을 미리 열면, 정말 같이 친 동시타가 창 경계에
     걸려 두 쪽 난다. 그런 자리는 경계 틈이 아주 좁다(0~2틱) — 같이
     친 음들이 이어져 있기 때문이다. 경계 틈이 좁고, 합쳐도 전체 폭이
     2×MIN_TICK을 넘지 않으면 한 덩어리로 되붙인다.
     (진짜 연속된 빠른 음들은 경계 틈이 그보다 넓어 안 붙는다.) */
  {
    const glued = [];
    let prevKeys = null;
    for (const mem of clusters) {
      const keys = new Set(mem.map(m => m.pk));
      const prev = glued[glued.length - 1];
      const overlap =
        prev && prevKeys &&
        [...keys].some(k => prevKeys.has(k));
      if (
        prev &&
        !overlap &&
        mem[0].t - prev[prev.length - 1].t <= 2 &&
        mem[mem.length - 1].t - prev[0].t <= MIN_TICK * 2
      ) {
        prev.push(...mem);
        for (const k of keys) prevKeys.add(k);
      } else {
        glued.push(mem);
        prevKeys = keys;
      }
    }
    clusters.length = 0;
    clusters.push(...glued);
  }

  const froms = [];
  const starts = [];
  let prev = -Infinity;

  for (const mem of clusters) {
    let start = snap(mem[Math.floor((mem.length - 1) / 2)].t);
    /* 스냅이 앞 덩어리와 같은(또는 더 이른) 시작점을 주면 최소음표만큼
       민다. 같은 값을 허용하면 두 덩어리가 한 화음으로 합쳐지고, 같은
       건반이 겹치는 경우(빠른 반복음·트릴) 한 음이 중복으로 지워진다.
       민 자리는 격자를 벗어나지만 carry가 5틱 안에서 메운다. */
    if (start <= prev) start = prev + MIN_TICK;
    froms.push(mem[0].t);
    starts.push(start);
    prev = start;
  }

  return raw => {
    // from <= raw 인 마지막 덩어리를 이진 탐색으로 찾는다
    let lo = 0, hi = froms.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (froms[mid] <= raw) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (ans >= 0) return starts[ans];
    return snap(raw);   // 지도 밖 (이론상 안 온다)
  };
}

function makeGroups(part, instrument, ppq, techs, startOf) {
  const notes = part.notes.map(n => {
    // 타악기는 건반을 갈아끼우고, 편곡 모드에서는 그 외 악기를 옥타브만큼 내린다
    const mapped = mapPercussion(n.key, instrument);
    const key = clampKey(mapped);
    return {
      key,
      pitch: keyToPitchClass(key),
      octave: keyToOctave(key),
      velocity: trimVelocity(velocityToMml(n.velocity), key, instrument),
      raw:   toTick(n.startTick, ppq),          // 격자에 맞추기 전 위치
      start: snap(toTick(n.startTick, ppq)),
      end:   snap(toTick(n.endTick, ppq))
    };
  }).sort((a, b) => (a.raw - b.raw) || (a.key - b.key));

  /* ── 시작점 결정 ──
     "1/64음표보다 가까운 시작점은 한 화음"이다. 격자에 맞춘 뒤가 아니라
     맞추기 전 위치(raw)로 판정해야 한다 — 하이브리드 스냅이 동시에 친
     음들을 2분할·3분할 격자로 갈라 놓으면, 벌어진 뒤에는 화음으로 안
     묶여 구르듯 들리기 때문이다("음이 밀린다").

     startOf(전역 시작점 지도)가 있으면 그것을 쓴다. 지도는 rebuild가
     "모든 파트의 노트"로 한 번 만들어 전 트랙에 같이 넘긴다 — 트랙마다
     따로 격자를 고르면 합주에서 같이 치는 히트가 트랙 사이에서 4~12틱
     어긋나기 때문이다 (alignTempos가 템포에 하는 일과 같은 이치다).
     지도가 없으면(단독 호출) 이 파트 안에서만 같은 계산을 한다. */
  const localStartOf =
    startOf || buildGlobalStartMap([{ part: { notes: part.notes.map(n => ({ startTick: n.startTick })) } }], ppq);

  for (const n of notes) n.start = localStartOf(n.raw);

  /* 같은 시작점 = 한 화음. 같은 음이 두 번 들어오면 더 길게 울리는
     쪽을 남긴다 — 짧은 조각이 남으면 그 음만 뚝 끊겨 삑사리로 들린다. */
  let groups = [];
  for (const n of notes) {
    const last = groups[groups.length - 1];
    if (last && n.start === last.start) {
      const dup = last.notes.find(x => x.key === n.key);
      if (dup) {
        if (n.end > dup.end) { dup.end = n.end; dup.velocity = Math.max(dup.velocity, n.velocity); }
      } else {
        last.notes.push(n);
      }
    } else {
      groups.push({ start: n.start, notes: [n], techniques: [] });
    }
  }
  for (const g of groups) g.notes.sort((a, b) => a.key - b.key);

  /* 글리산도 펼치기.
     한 자리에 뭉친 음들이
       · 원본에서는 시간차가 있었고 (동시에 친 화음이 아니다)
       · 음정이 다닥다닥 붙어 있으면 (도-도#-레 같은 반음 덩어리)
     그건 화음이 아니라 빠르게 흐르던 음들이다. 그대로 쌓으면
     반음 클러스터가 되어 굉장히 지저분하게 들린다.

     다음 음이 시작하기 전까지의 자리에 1/64음표 간격으로 펼치고,
     자리가 모자라면 고르게 솎아 낸다. 음 하나하나보다 훑고 지나가는
     느낌이 중요하므로 몇 개 빠져도 글리산도로 들린다. */
  {
    const spread = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const ns = g.notes;
      if (ns.length < CLUSTER_MIN_NOTES) { spread.push(g); continue; }

      /* 시간 순서대로 훑으며 "한 방향으로 반음~온음씩 움직이는" 가장 긴 구간을
         찾는다. 이 구간만 글리산도로 보고 펼친다.

         묶음 전체를 보면 안 된다. 옥타브 아래 베이스가 하나 섞여 있으면
         음정 폭이 넓어져서 글리산도를 놓치기 때문이다. 실제로
         g+ 하나가 낀 탓에 반음 4개짜리 클러스터가 그대로 남아 있었다. */
      const byRaw = ns.slice().sort((a, b) => a.raw - b.raw);
      let from = 0, to = 0;
      for (let a2 = 0; a2 < byRaw.length; a2++) {
        for (const dir of [1, -1]) {
          let e = a2;
          while (e + 1 < byRaw.length) {
            const step = (byRaw[e + 1].key - byRaw[e].key) * dir;
            if (step < 1 || step > 2) break;    // 반음~온음씩 한 방향으로
            e++;
          }
          if (e - a2 > to - from) { from = a2; to = e; }
        }
      }
      const run = byRaw.slice(from, to + 1);
      const runSpread = run.length > 1 ? run[run.length - 1].raw - run[0].raw : 0;
      if (run.length < CLUSTER_MIN_NOTES || runSpread < CLUSTER_RAW_SPREAD) {
        spread.push(g);
        continue;
      }
      const rest = byRaw.filter(n => run.indexOf(n) < 0);   // 글리산도가 아닌 음들

      const next = groups[i + 1];
      const slot = next ? next.start - g.start : Math.max(...ns.map(n => n.end)) - g.start;
      const room = Math.max(1, Math.floor(slot / MIN_TICK));
      const order = run;
      const keep = Math.min(order.length, room);

      for (let k = 0; k < keep; k++) {
        // 고르게 솎아 낸다 (앞뒤 끝은 반드시 남긴다)
        const idx = keep === 1 ? 0 : Math.round(k * (order.length - 1) / (keep - 1));
        const n = order[idx];
        const at = g.start + k * MIN_TICK;
        // 글리산도가 아닌 음들은 첫 조각에 같이 둔다 (원래 자리에서 울리도록)
        const notes = [{ ...n, start: at, end: Math.max(at + MIN_TICK, n.end) }];
        if (k === 0) for (const r of rest) notes.push({ ...r, start: at });
        notes.sort((x, y) => x.key - y.key);
        spread.push({ start: at, notes, techniques: [] });
      }
    }
    groups = spread;
  }

  /* 꾸밈음 — 짧은 음 하나를 뒤 음의 *8 / *9로 흡수한다.
     본음의 시작을 꾸밈음 자리까지 앞당기므로 뒤 박자가 밀리지 않는다. */
  if (techs.graceUp || techs.graceDown) {
    const kept = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i], next = groups[i + 1];
      if (next && g.notes.length === 1 && next.notes.length === 1) {
        const graceSlot = next.start - g.start;
        const after = groups[i + 2];
        const mainSlot = after ? after.start - next.start
                               : Math.max(MIN_TICK, next.notes[0].end - next.start);
        const diff = g.notes[0].key - next.notes[0].key;
        const tech = diff > 0 ? techs.graceUp : techs.graceDown;
        /* 진짜 꾸밈음은 "아주 짧게 스치고 본음이 길게 남는" 모양이다.
           앞뒤가 비슷한 길이로 이어지면 그건 빠른 패시지의 멜로디이지
           꾸밈음이 아니다. 그걸 흡수해 버리면 음이 통째로 사라지고
           뒤 음까지 앞으로 당겨져 선율이 망가진다.
           그래서 앞 음도 짧아야 하고(prevSlot), 본음이 확실히 길어야 한다. */
        const prevSlot = i > 0 ? g.start - groups[i - 1].start : Infinity;
        if (tech && diff !== 0 && Math.abs(diff) <= GRACE_MAX_INTERVAL
            && graceSlot >= MIN_TICK && graceSlot <= GRACE_MAX_TICK
            && graceSlot * GRACE_MAIN_RATIO <= mainSlot
            && graceSlot * GRACE_MAIN_RATIO <= prevSlot) {
          next.start = g.start;               // 본음이 꾸밈음 자리를 넘겨받는다
          next.techniques.push(tech);
          continue;                           // 꾸밈음 그룹 자체는 버린다
        }
      }
      kept.push(g);
    }
    groups = kept;
  }

  /* 화음 구성음의 길이는 각자 그대로 둔다.
     Armis는 e4:c1 처럼 길이가 다른 화음을 허용하므로, 마비꼬처럼 짧은 음에
     맞춰 잘라낼 필요가 없다. 다만 "다음 음이 시작하는 위치"는 가장 긴 음이
     정하므로, 그룹 전체 길이(=커서 전진량)는 가장 긴 음 기준으로 잡는다. */
  for (const g of groups) {
    g.notes.sort((a, b) => a.key - b.key);
    g.fullDur = Math.max(MIN_TICK, Math.max(...g.notes.map(n => n.end - g.start)));
  }

  if (OPT_TIE_SNAP) snapEndsToSingleTokens(groups);

  return groups;
}

/* ============================================================
   이음줄 양자화 — 음의 끝을 살짝 옮겨 한 토막으로 적히게
   ============================================================
   168틱짜리 음은 글자로 a+4&a+16. (6자)다. 끝을 24틱만 당기면 a+4.
   (3자)가 된다. 화음이면 구성음마다 그만큼 아끼고, 화음 구성음 끝이
   제각각인 것(연주 흔들림)을 가장 긴 것에 맞추면 이음줄이 통째로
   사라진다.

   시작은 절대 건드리지 않는다 — 리듬은 시작이 만든다. 끝만, 그것도
   1/32음표(12틱) 안에서만 옮긴다. 사람이 친 화음의 구성음 끝이 그
   정도 흩어지는 건 흔하고 귀에 거의 안 들린다.

   두 방향이 있다.
     · 짧은 구성음을 그룹의 가장 긴 것까지 늘린다 (그룹 밖으로는
       안 나가므로 다음 음과 겹칠 일이 없다)
     · 그렇게 해도 한 토막이 안 되면, 아래쪽 가장 가까운 한 토막
       길이로 줄인다. 남는 틈은 쉼표(r16 = 3자)가 되는데, 이음줄
       한 토막(&a+16. = 6자)보다 짧다.
   ============================================================ */
let OPT_TIE_SNAP = true;
const TIE_SNAP_TOL = WHOLE / 32;   // 12틱

function isSingleToken(tick) {
  const r = resolveTickTokens(tick);
  return r.tokens.length === 1 && r.tick === tick;
}

function nearestSingleBelow(tick, tol) {
  for (let t = tick; t >= tick - tol && t >= MIN_TICK; t -= 1) {
    if (isSingleToken(t)) return t;
  }
  return null;
}

function snapEndsToSingleTokens(groups) {
  for (const g of groups) {
    const longest = Math.max(...g.notes.map(n => n.end - g.start));

    /* 1) 짧은 구성음을 가장 긴 것에 맞춘다 (12틱 안에서) */
    for (const n of g.notes) {
      const len = n.end - g.start;
      if (len < longest && longest - len <= TIE_SNAP_TOL) n.end = g.start + longest;
    }

    /* 2) 한 토막이 아니면 아래쪽 한 토막으로 줄인다 */
    for (const n of g.notes) {
      const len = n.end - g.start;
      if (len <= 0 || isSingleToken(len)) continue;
      const t = nearestSingleBelow(len, TIE_SNAP_TOL);
      if (t !== null) n.end = g.start + t;
    }

    g.fullDur = Math.max(MIN_TICK, Math.max(...g.notes.map(n => n.end - g.start)));
  }
}

/* 2단계: 서스테인 — 페달 구간 안에서 화음을 계단처럼 쌓는다.

   Armis에서 긴 음은 뒤를 막으므로, 음이 계속 울리게 하려면 새 음이 들어올
   때마다 앞 음들을 같이 다시 쳐 주는 수밖에 없다. 화음 구성음이 전부 같은
   길이(=다음 온셋까지)가 되므로 박자는 그대로다.

   상한을 넘으면 오래된 음부터 버리되 가장 낮은 음은 남긴다. */
/* ============================================================
   MML 이벤트 생성 — 그룹 목록을 MML 이벤트로 바꾼다
   ============================================================
   박자 밀림을 막는 규칙.

   cursor는 "실제로 찍힌 tick"이 아니라 "원본 기준 절대 위치(목표치)"를
   그대로 따라간다. 목표치와 실제 표현 가능한 tick 사이의 차이는
   createTickEmitter()가 만드는 carry가 들고 다니다가 바로 다음 호출에
   얹으므로, 트랙 전체로 보면 tick이 하나도 사라지지 않는다.
   ============================================================ */
/* volumes: 편집기가 찍은 벨로시티 마커. [{pos, v}] 형태로 넘긴다.
   미디 변환에서는 쓰지 않으므로 없으면 그냥 빈 배열이다.

   왜 타임라인에 넣는가 — 쉼표 한가운데에 찍은 마커를 그냥 두면
   MML에는 다음 음 바로 앞에 v가 붙어(r2.v10g4), 편집기에서 본 자리와
   어긋난다. 템포는 이미 이 타임라인을 타고 쉼표를 쪼개므로(r4t150r2),
   벨로시티도 같은 길을 태워 r4v10r4 로 나오게 한다. */
function buildEvents(groups, tempos, instrument, techs, volumes) {
  if (!groups.length) return [];

  // 그룹 길이 결정 + 다음 그룹 시작점까지로 클램프
  groups.forEach((g, idx) => {
    const dur = g.fullDur;
    const next = groups[idx + 1];
    const slot = next ? next.start - g.start : dur;   // 그룹 간격은 항상 MIN_TICK 이상

    /* 스타카토 (바이올린은 스피카토 [4]가 이 역할)
       예전에는 "짧은 음 + 쉼표"를 "자리를 다 채운 음 + 기법"으로 바꿔 적었다.
       기법이 알아서 짧게 끊어 줄 거라고 본 것인데, 실제로 얼마나 짧아지는지
       모르는 상태에서 음을 늘려 적으면 원래보다 길게 울린다.

       그래서 길이는 절대 늘리지 않는다. 음은 언제나 원래 길이 그대로 적고,
       스타카토는 그 위에 표시만 얹는다. 표시가 더 짧게 만들 수는 있어도
       원래보다 길어지는 일은 없다.

       AUTO_STACCATO를 켜면 기법 표시도 함께 붙는다. 게임에서 얼마나 짧아지는지
       확인한 뒤 켜는 것을 권한다. */
    g.duration = Math.max(MIN_TICK, Math.min(dur, slot));
    g.staccato = !!(techs.staccato && next
                    && slot >= MIN_TICK * 2 && dur <= slot * STACCATO_RATIO);
    if (g.staccato && AUTO_STACCATO) g.techniques.push(techs.staccato);

    g.slot = slot;
    g.rawDur = dur;     // 클램프 전 실제 발음 길이. 레가토 판정에 쓴다
  });

  /* 표현할 수 없는 짧은 쉼표를 없앤다 — 마비꼬 MMLEventList.deleteMinRest 이식.
     1/64음표보다 짧은 틈은 어차피 쉼표로 못 적는다. 예전에는 이 틈이 carry로
     넘어가 "다음 음이 몇 tick 일찍 시작하는" 형태가 됐는데, 마비꼬처럼 앞 음을
     늘려 메우면 다음 음은 제 위치에서 시작한다. (사람 귀에는 이쪽이 자연스럽다) */
  for (let i = 0; i + 1 < groups.length; i++) {
    const g = groups[i], next = groups[i + 1];
    const gap = next.start - (g.start + g.duration);
    if (gap > 0 && gap < MIN_TICK) g.duration += gap;
  }

  /* 레가토 — 빈틈 없이 이어지는 구간을 [3] … [3]로 감싼다.
     토글이라 열었으면 반드시 닫아야 하고, 짧게 끊기는 음은 대상이 아니다. */
  if (techs.legato) {
    const linked = groups.map((g, i) => {
      const next = groups[i + 1];
      // 짧게 끊는 음은 앞뒤 어느 쪽으로도 이어지지 않는다
      if (!next || g.staccato || next.staccato) return false;
      return g.rawDur >= g.slot * LEGATO_RATIO;
    });

    let i = 0;
    while (i < groups.length) {
      let j = i;
      while (j < groups.length - 1 && linked[j]) j++;
      if (j - i + 1 >= LEGATO_MIN_NOTES) {
        for (let k = i; k <= j; k++) groups[k].techniques.push(techs.legato);
        i = j + 1;
      } else {
        i++;
      }
    }
  }

  /* 악센트 — 주변 평균보다 뚜렷하게 센 음.
     *14가 강조를 담당하므로 v는 주변 수준으로 되돌린다.
     그러지 않으면 v 상승과 악센트가 겹쳐 그 음만 튄다. */
  if (techs.accent) {
    const own = g => g.notes;
    const vel = groups.map(g => {
      const list = own(g);
      return list.length ? Math.max(...list.map(n => n.velocity)) : 0;
    });
    const [lo, hi] = velRange();
    groups.forEach((g, idx) => {
      if (!vel[idx]) return;
      const from = Math.max(0, idx - ACCENT_WINDOW);
      const to   = Math.min(vel.length, idx + ACCENT_WINDOW + 1);
      let sum = 0, count = 0;
      for (let i = from; i < to; i++) { if (i === idx || !vel[i]) continue; sum += vel[i]; count++; }
      if (!count) return;
      const avg = sum / count;
      if (vel[idx] >= avg + ACCENT_DELTA) {
        g.techniques.push(techs.accent);
        if (ACCENT_MODE === "replace") {
          const back = Math.max(lo, Math.min(hi, Math.round(avg)));
          for (const n of own(g)) n.velocity = back;
        }
      }
    });
  }

  /* 비브라토 — 모듈레이션(CC1)이 걸려 있는 구간 */
  if (techs.vibrato && techs.mods && techs.mods.length) {
    let mi = 0, current = 0;
    for (const g of groups) {
      while (mi < techs.mods.length && techs.mods[mi].pos <= g.start) current = techs.mods[mi++].value;
      if (current >= VIBRATO_CC_MIN) g.techniques.push(techs.vibrato);
    }
  }

  /* 구간 기법([N])을 여닫는 토글로 바꾼다.
     여기까지는 "이 음에 이 기법이 걸린다"고만 표시해 두었고,
     실제 MML에서는 연속 구간의 앞뒤에 한 번씩만 찍어야 한다.
     닫는 순서는 여는 순서의 역순이라 구간이 서로 엇갈리지 않는다. */
  const rangeCodes = [];
  for (const g of groups) {
    for (const t of g.techniques) {
      if (t.place === "range" && rangeCodes.indexOf(t.code) < 0) rangeCodes.push(t.code);
    }
  }
  const hasCode = (g, code) => g.techniques.some(t => t.code === code);
  for (const code of rangeCodes) {
    let i = 0;
    while (i < groups.length) {
      if (!hasCode(groups[i], code)) { i++; continue; }
      let j = i;
      while (j + 1 < groups.length && hasCode(groups[j + 1], code)) j++;
      (groups[i].open  = groups[i].open  || []).push(code);
      (groups[j].close = groups[j].close || []).push(code);
      i = j + 1;
    }
  }

  /* 이 트랙이 끝난 뒤의 템포는 버린다 — 마비꼬 MMLBuilder.toMMLString 이식.
     ("mabi-MMLであれば, 不要な終端テンポは付けない")
     예전에는 곡 끝의 템포를 찍으려고 아무 소리도 없는 쉼표를 몇 마디씩
     깔았다. 그 템포는 이미 다른 트랙이 들고 있으므로 그냥 빼면 된다. */
  const trackEnd = groups[groups.length - 1].start + groups[groups.length - 1].duration;
  const usableTempos = tempos.filter(t => t.pos <= 0 || t.pos < trackEnd);

  // 화음 안쪽에 걸리는 템포는 화음 시작으로 당기고, 단음 안쪽에 걸리는 템포는
  // 정확한 위치에서 음을 쪼개 그 사이에 끼워 넣는다. (화음은 쪼개지 않음)
  const resolved = resolveTempoBoundaries(groups, usableTempos);
  const outGroups = resolved.groups;
  const localTempos = resolved.tempos;

  // 템포 + 화음을 한 타임라인으로
  const usableVolumes = (volumes || []).filter(v => v.pos > 0 && v.pos < trackEnd);

  const timeline = [
    ...localTempos.map(t => ({ pos: t.pos, order: 0, tempo: t.bpm })),
    ...usableVolumes.map(v => ({ pos: v.pos, order: 0.5, volume: v.v })),
    ...outGroups.map(g => ({ pos: g.start, order: 1, group: g }))
  ].sort((a, b) => (a.pos - b.pos) || (a.order - b.order));

  const events = [];
  const takeTicks = createTickEmitter();   // 이 트랙 전체가 하나의 carry를 공유한다
  let cursor = 0, lastOctave = null, lastVelocity = null, lastTempo = null;

  for (let ti = 0; ti < timeline.length; ti++) {
    const item = timeline[ti];
    // 값이 그대로인 표시는 아예 건너뛴다. 여기서 걸러 두지 않으면
    // 아무것도 적히지 않는데 쉼표만 둘로 갈려 r4r4 같은 것이 남는다.
    if (item.group === undefined) {
      if (item.volume !== undefined && item.volume === lastVelocity) continue;
      if (item.tempo !== undefined && item.tempo === lastTempo) continue;
    }

    // 절대 위치 기준으로 쉼표를 채운다. cursor는 목표 위치로 정확히 맞추고,
    // 실제 표현과의 차이는 takeTicks의 carry가 다음 호출로 그대로 넘긴다.
    if (item.pos > cursor) {
      const needed = item.pos - cursor;
      const rest = takeTicks(needed);   // 쉼표는 &로 잇지 않는다
      if (rest.tokens.length) {
        events.push({ type: "Rest", tick: rest.tick, name: REST, tokens: rest.tokens,
                      text: tokensToText(REST, rest.tokens, false) });
      }
      cursor = item.pos;
    }

    if (item.group === undefined) {
      if (item.volume !== undefined) {
        if (item.volume !== lastVelocity) {
          events.push({ type: "Velocity", value: item.volume });
          lastVelocity = item.volume;
        }
        continue;
      }
      if (item.tempo !== lastTempo) {
        events.push({ type: "Tempo", tempo: item.tempo });
        lastTempo = item.tempo;
      }
      continue;
    }

    const g = item.group;

    /* 다음 화음(같은 타임라인에서 뒤에 오는 첫 그룹) — 순서를 고를 때 내다본다 */
    let nextGroup = null;
    for (let k = ti + 1; k < timeline.length; k++) {
      if (timeline[k].group !== undefined) { nextGroup = timeline[k].group; break; }
    }
    // *N은 그 음에만, [N]은 구간의 앞뒤에만 찍는다
    const pre  = (g.open || []).join("");
    const post = (g.techniques || []).filter(t => t.place === "post").map(t => t.code).join("")
               + (g.close || []).slice().reverse().join("");   // 연 순서의 역순으로 닫는다

    // 템포 분할로 생긴 "이어지는 조각"은 앞 조각과 & 로 묶는다.
    // (기법 문자 "&"가 아니라 순수 타이이므로 별도 이벤트 타입으로 낸다.)
    if (g.tied) events.push({ type: "Tie" });

    /* 화음 구성음은 각자 제 길이로 적는다 (e4:c1).
       Armis에서 다음 음이 시작하는 위치는 "가장 긴 음"이 정하므로,
       커서와 carry는 그룹 전체 길이(=가장 긴 음) 하나로만 굴린다. */
    const noteTicks = takeTicks(g.duration);
    /* 화음 구성음은 각자 제 길이로 적는다.
       (예전에는 스타카토로 자리를 채운 그룹을 예외로 뒀는데, 이제 길이를
       늘리지 않으므로 예외가 필요 없다. 그대로 두면 짧은 구성음까지
       가장 긴 음 길이로 늘어나 버린다.) */
    const perNote = g.notes.length > 1;

    /* 구성음 순서를 골라 o·v 글자를 줄인다.
       순서는 소리에 영향이 없다 — 구성음은 어차피 같은 자리에서 함께 울리고
       커서는 가장 긴 구성음이 민다. 자세한 건 bestChordOrder 참고. */
    let noteList = g.notes;
    if (OPT_CHORD_ORDER && noteList.length > 1) {
      noteList = bestChordOrder(noteList, lastOctave, lastVelocity, nextGroup);
    }

    /* 구성음별 길이를 미리 계산한다.
       주의: 커서는 "가장 긴 구성음"이 밀기 때문에, 구성음 중 적어도 하나는
       반드시 그룹 길이와 같아야 한다. 짧은 틈 메우기(deleteMinRest)로 그룹
       길이가 늘어난 경우 모든 구성음이 그보다 짧아져서 박자가 밀렸었다. */
    const owns = noteList.map(n => Math.max(MIN_TICK, Math.min(g.duration, n.end - g.start)));
    const longestOwn = owns.length ? Math.max(...owns) : 0;

    let advEvent = null;     // 이 그룹이 커서를 미는 양을 기록해 둘 이벤트
    let memberTick = 0;      // 지금 쓰고 있는 구성음이 실제로 찍힌 길이
    let emittedMax = 0;      // 구성음들 중 가장 긴 것 = 실제로 커서를 미는 값
    const putNote = (name, r) => {
      const ev = { type: "Note", tick: r.tick, adv: 0,
                   name, tokens: r.tokens, text: tokensToText(name, r.tokens, true) };
      events.push(ev);
      if (!advEvent) advEvent = ev;
      memberTick += r.tick;
      if (memberTick > emittedMax) emittedMax = memberTick;
    };
    const putVel = (v) => {
      if (v !== lastVelocity) {
        events.push({ type: "Velocity", value: v });
        lastVelocity = v;
      }
    };

    noteList.forEach((n, idx) => {
      memberTick = 0;
      if (idx > 0) events.push({ type: "ConnectChord" });
      if (n.octave !== lastOctave) {
        events.push({ type: "Octave", value: n.octave });
        lastOctave = n.octave;
      }
      if (idx === 0 && pre) events.push({ type: "Technique", text: pre });   // [N]은 음표 앞

      /* 서스테인 트랙 구성음.
         늦게 들어오는 음은 v0로 앞자리를 비우고, 아주 작은 조각을 하나 끼운 뒤
         구간 끝까지 이어 붙인다. 조각이 뒷음 음량을 살려 준다.
           v0c16 & v11c64 & c2.
           └무음┘  └조각┘  └본체(v를 물려받는다)┘ */
      putVel(n.velocity);

      let nt = noteTicks;
      // 가장 긴 구성음은 반드시 그룹 길이 그대로 적는다 (커서 기준이 되는 음)
      if (perNote && owns[idx] < longestOwn) {
        const r = resolveTickTokens(owns[idx]);
        if (r.tokens.length && r.tick <= noteTicks.tick) nt = r;
      }
      putNote(n.pitch, nt);
    });
    /* 실제로 찍힌 길이를 그룹의 전진량으로 기록한다.
       계산보다 짧게 나왔으면 그 차이는 carry로 돌려줘 다음에 메우게 한다. */
    if (advEvent) advEvent.adv = emittedMax;
    if (emittedMax < noteTicks.tick) takeTicks.giveBack(noteTicks.tick - emittedMax);

    if (post) events.push({ type: "Technique", text: post });                // *N은 음표 뒤

    // 뒤에 템포로 쪼개진 조각이 더 있으면 여기서도 &로 닫는다.
    // 템포 명령 양쪽에 &가 있어야 이어진 음으로 취급된다 (c4&t140&c8 형태).
    if (g.continues) events.push({ type: "Tie" });

    cursor += g.duration;   // 목표 길이만큼 전진. 실제 표현과의 오차는 carry로 이월된다.
  }

  /* 마지막 음 뒤에 남은 템포는 지운다.
     화음을 템포 자리에서 끊다 보면 곡 끝에 아무것도 울리지 않는 템포가
     하나 남을 수 있다. 소리에는 영향이 없고 글자수만 먹는다. */
  while (events.length && events[events.length - 1].type === "Tempo") events.pop();

  return events;
}

/* 한 파트를 이벤트로 만들기 직전 단계까지 준비한다. */
function prepareTrack(part, ppq, instrument, startOf) {
  const techs = {
    staccato:  AUTO_TECHNIQUE ? techniqueOf(instrument, "staccato")  : null,
    accent:    AUTO_TECHNIQUE ? techniqueOf(instrument, "accent")    : null,
    vibrato:   AUTO_TECHNIQUE ? techniqueOf(instrument, "vibrato")   : null,
    graceUp:   AUTO_TECHNIQUE ? techniqueOf(instrument, "graceUp")   : null,
    graceDown: AUTO_TECHNIQUE ? techniqueOf(instrument, "graceDown") : null,
    legato:    AUTO_TECHNIQUE ? techniqueOf(instrument, "legato")    : null,
    mods: (part.mods || []).map(m => ({ pos: snap(toTick(m.tick, ppq)), value: m.value }))
                           .sort((a, b) => a.pos - b.pos)
  };
  return { techs, groups: makeGroups(part, instrument, ppq, techs, startOf) };
}

/* ============================================================
   템포 위치 맞추기 — 모든 트랙이 같은 자리에서 바뀌어야 한다
   ============================================================
   템포가 화음 한가운데에 걸리면 화음을 쪼갤 수 없으므로 화음 시작으로
   당겨 붙인다. 그런데 트랙마다 화음이 놓인 자리가 다르다 보니, 같은 템포가
   트랙마다 다른 시각에 적용되는 일이 생긴다.

     T0 : ... t70 을 1056에 찍음
     T1 : ... 1056이 긴 화음 안이라 768로 당겨짐

   그러면 768~1056 구간에서 두 트랙의 속도가 달라지고, 그 차이만큼 어긋난
   채로 곡이 끝까지 간다. 한 번 벌어지면 절대 회복되지 않는다.

   그래서 템포를 찍기 전에 모든 트랙을 같이 보고, 어느 한 트랙이라도 당겨야
   한다면 나머지도 같은 자리로 당긴다. 당긴 자리가 또 다른 트랙의 화음
   한가운데면 다시 당긴다. 더 당길 곳이 없을 때까지 반복한다.

   템포가 조금 일찍 바뀌는 것은 귀에 거의 안 띄지만,
   트랙이 어긋나는 것은 곡 전체가 망가진다. ============================================================ */
function alignTempos(groupsByTrack, tempos) {
  const out = tempos.map(t => ({ pos: t.pos, bpm: t.bpm }));

  for (const t of out) {
    if (t.pos <= 0) continue;
    for (let guard = 0; guard < 16; guard++) {
      let moved = false;
      for (const groups of groupsByTrack) {
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          if (g.start >= t.pos) break;
          if (g.notes.length < 2) continue;          // 단음은 쪼갤 수 있다
          const next = groups[i + 1];
          const slot = next ? next.start - g.start : g.fullDur;
          const dur = Math.max(MIN_TICK, Math.min(g.fullDur, slot));
          // 화음은 템포 자리에서 끊어 쓰므로, 끊기에도 너무 이른 경우만 당긴다
          if (t.pos > g.start && t.pos < g.start + dur && t.pos - g.start < MIN_TICK) {
            t.pos = g.start; moved = true; break;
          }
        }
        if (moved) break;
      }
      if (!moved) break;
    }
  }

  // 같은 자리로 몰린 템포는 마지막 것만 남긴다
  out.sort((a, b) => a.pos - b.pos);
  const merged = [];
  for (const t of out) {
    if (merged.length && merged[merged.length - 1].pos === t.pos) merged[merged.length - 1] = t;
    else merged.push(t);
  }
  return merged;
}

function eventToMml(e) {
  switch (e.type) {
    case "ConnectChord": return ":";
    case "Tempo":        return "t" + e.tempo;
    case "Octave":       return "o" + e.value;
    case "Velocity":     return "v" + e.value;
    case "Technique":    return e.text;
    case "Tie":           return "&";
    case "Rest":          return e.text;
    case "Note":           return e.text;
    default:             return "";
  }
}

/* ============================================================
   출력 줄이기 (선택) — 마비꼬 optimizer 패키지에서 가져온 것
   ============================================================
   마비꼬는 MML을 만든 뒤 문자열 최적화를 한 번 더 돌린다. 게임마다 트랙당
   글자수 제한이 있어서 같은 연주를 더 짧게 적을수록 긴 곡을 넣을 수 있다.

   마비꼬의 옥타브 축약(o5o4 → ><, OxLxOptimizer.getOctaveString)은
   Armis가 <, >를 받지 않아 쓸 수 없다. 옥타브는 항상 oN으로만 적는다.

   l은 Armis에서 통하는 것을 게임에서 확인했다(t120l8cdefgab 가 8분음표
   일곱 개로 울림). 그래서 켠다. 실제 곡에서 15~17% 줄어든다.
   ============================================================ */
let OPT_LENGTH = true;    // c4d4e4 → l4cde   (마비꼬 OxLxOptimizer)

/* ============================================================
   게임이 세는 글자 수
   ============================================================
   Armis는 문자열 길이가 아니라 "음표와 쉼표의 개수"를 센다.
     c:e          → 2      (화음 구성음은 각각)
     t120v12o5c4  → 1      (t o v l 과 숫자·점·+ 는 공짜)
     c4&c8        → 2      (이음줄로 이어진 토막도 각각)
   한 파트에 3000까지다. 넘으면 뒤가 잘린다.

   음표 이름 a~g 와 쉼표 r 만 세면 정확하다 — 명령 글자(t o v l)와는
   겹치지 않고, 기법 코드([2] *13)에는 글자가 없다. */
const GAME_CHAR_LIMIT = 3000;

function gameCharCount(mml) {
  const m = String(mml || "").match(/[a-gr]/g);
  return m ? m.length : 0;
}

/* 화음 구성음 순서로 o·v 를 줄인다. 문법을 새로 쓰지 않으므로 늘 켠다. */
let OPT_CHORD_ORDER = true;

/* ============================================================
   화음 구성음 순서 고르기
   ============================================================
   실제 곡을 재 보니 옥타브 명령(oN)이 전체 글자의 21%, 드럼 트랙은
   세기 명령(vN)이 31%였다. 화음이 o4/o5를 걸치면 o4g+:o5c:d+:g+ 처럼
   화음마다 옥타브를 두 번 바꾸고, 다음 화음이 또 o4로 돌아온다.

   구성음의 순서는 소리와 무관하다. 그러니 "지금 옥타브·세기와 같은
   음을 먼저, 다음 화음이 필요로 하는 옥타브·세기로 끝나게" 고르면
   명령을 절반 가까이 아낀다. 구성음은 보통 2~4개라 모든 순서를 다
   따져 봐도 싸다(4! = 24). 여섯 개를 넘으면 정렬로 대신한다.

   다음 화음까지 한 칸 내다본다 — 그쪽이 "우리가 끝난 상태"를 가장
   싸게 받을 수 있는 구성음이 있는지 본다. 그 이상 내다보는 것은
   이득이 미미해 하지 않는다. ============================================================ */
function bestChordOrder(notes, lastOctave, lastVelocity, nextGroup) {
  const velChars = v => 1 + String(v).length;

  const costOf = (order) => {
    let o = lastOctave, v = lastVelocity, c = 0;
    for (const n of order) {
      if (n.octave !== o) { c += 2; o = n.octave; }
      if (n.velocity !== v) { c += velChars(n.velocity); v = n.velocity; }
    }
    if (nextGroup && nextGroup.notes.length) {
      let best = Infinity;
      for (const m of nextGroup.notes) {
        const k = (m.octave !== o ? 2 : 0) + (m.velocity !== v ? velChars(m.velocity) : 0);
        if (k < best) best = k;
      }
      c += best;
    }
    return c;
  };

  if (notes.length > 6) {
    return notes.slice().sort((a, b) =>
      (a.octave === lastOctave ? 0 : 1) - (b.octave === lastOctave ? 0 : 1)
      || (a.velocity === lastVelocity ? 0 : 1) - (b.velocity === lastVelocity ? 0 : 1)
      || a.key - b.key);
  }

  let best = notes, bestCost = costOf(notes);
  const used = new Array(notes.length).fill(false);
  const cur = [];
  const walk = () => {
    if (cur.length === notes.length) {
      const c = costOf(cur);
      if (c < bestCost) { bestCost = c; best = cur.slice(); }
      return;
    }
    for (let i = 0; i < notes.length; i++) {
      if (used[i]) continue;
      used[i] = true; cur.push(notes[i]);
      walk();
      cur.pop(); used[i] = false;
    }
  };
  walk();
  return best;
}

/* l(기본 길이) 최적화 — 마비꼬 OxLxOptimizer 이식.
   "지금 l이 무엇인가"를 상태로 두고, 상태마다 문자열을 하나씩 만들어 가면서
   가장 짧은 것만 남긴다. 매 음마다 "여기서 l을 바꿔 볼까?"를 후보로 넣는다.

   화음 안(:)과 타이(&) 바로 뒤에서는 l을 새로 넣지 않는다.
   그 자리에 l이 끼어도 되는지 게임에서 확인하지 못했기 때문이다. */
function optimizeLength(events) {
  let states = new Map([[null, ""]]);
  const put = (map, key, str) => {
    const cur = map.get(key);
    if (cur === undefined || str.length < cur.length) map.set(key, str);
  };
  const minString = () => {
    let best = null;
    for (const s of states.values()) if (best === null || s.length < best.length) best = s;
    return best === null ? "" : best;
  };
  const appendAll = (text) => { for (const [k, v] of states) states.set(k, v + text); };

  let safeForL = true;   // 직전 토큰이 : 이나 & 가 아닌가

  /* 토막 하나(이름 + 길이)를 모든 후보에 붙인다. 지금 l과 같으면 길이를
     생략하고, 점 하나 차이면 점만 붙인다. safeForL이면 "여기서 l을
     바꾼다"는 후보도 새로 만든다. */
  const putToken = (name, len) => {
    const base = minString();
    const next = new Map();
    for (const [key, sb] of states) {
      let txt;
      if (key === len) txt = name;
      else if (key !== null && len === key + ".") txt = name + ".";
      else txt = name + len;
      put(next, key, sb + txt);
    }
    if (safeForL) {
      put(next, len, base + "l" + len + name);
      if (len.endsWith(".")) {
        const b = len.slice(0, -1);
        put(next, b, base + "l" + b + name + ".");
      }
    }
    states = next;
  };

  for (const e of events) {
    const noteLike = (e.type === "Note" || e.type === "Rest") && e.tokens && e.tokens.length;
    if (!noteLike) {
      const s = eventToMml(e);
      if (s) appendAll(s);
      if (e.type === "ConnectChord" || e.type === "Tie") safeForL = false;
      else if (e.type === "Note" || e.type === "Rest") safeForL = true;
      continue;
    }

    /* 여러 토막짜리도 토막마다 다룬다.
         긴 쉼표  r1.r1.r1.  → l1.rrr
         이음줄   c4&c8      → l4c&c8   (& 뒤에서는 l을 새로 세우지 않는다)
       예전에는 한 토막짜리만 다뤄서 이런 것들이 통째로 빠져나갔다. */
    e.tokens.forEach((len, i) => {
      if (i > 0) {
        if (e.type === "Note") { appendAll("&"); safeForL = false; }
        else safeForL = true;
      }
      putToken(e.name, len);
      safeForL = true;
    });
  }

  return minString();
}

function eventsToMml(events) {
  if (OPT_LENGTH) return optimizeLength(events);
  return events.map(eventToMml).join("");
}

/* ============================================================
   트랙 / 곡
   ============================================================ */
function instrumentName(part) {
  if (part.channel === 9) return "Drum Set";
  const id = part.program === null ? 0 : part.program;
  return INSTRUMENT_MAP[id] || INSTRUMENT_MAP[0];
}

/* ============================================================
   솔로곡 — 파트를 전부 합쳐 세 트랙으로 나눈다
   ============================================================
   피아노 독주 같은 곡은 MIDI가 손(오른손·왼손)이나 성부로 파트를
   나눠 두는데, 그대로 트랙이 되면 한 트랙이 3000자를 훌쩍 넘는다.
   아르미스는 한 사람이 트랙 셋까지 낼 수 있으니, 음을 셋으로 고르게
   나누면 같은 곡을 한 사람이 다 연주할 수 있다.

   나누는 기준은 음역이다. 높은 음역 / 가운데 / 낮은 음역 — 사람이
   손으로 파트를 나눌 때와 같다. 경계 두 개를 두고, 세 트랙의 글자
   수가 가장 고르게 되는 자리로 경계를 옮겨 간다.

   같은 자리에서 시작하는 음은 한 트랙 안에서 자연히 화음(:)이 된다.
   시작이 다른데 겹치는 음은 앞 음이 뒷음 시작에서 잘린다 — 한 트랙은
   한 목소리라 어쩔 수 없다. 음역으로 나누면 이런 겹침이 가장 적다.

   글자 수는 진짜 MML을 만들지 않고 어림한다 (음 개수 + 쉼표가 생길
   틈 개수). 경계를 옮길 때마다 MML을 통째로 만들면 느리기 때문이다.
   ============================================================ */
const SOLO_TRACKS = 3;

function mergeForSolo(parts) {
  /* 타악기(ch9)는 뺀다 — 피아노 건반에 올릴 수 없다 */
  const melodic = parts.filter(p => p.channel !== 9);
  if (!melodic.length) return null;

  const notes = [];
  for (const p of melodic) for (const n of p.notes) notes.push(n);
  notes.sort((a, b) => a.startTick - b.startTick || a.key - b.key);

  return {
    id: "solo",
    trackIndex: melodic[0].trackIndex,
    channel: melodic[0].channel,
    program: melodic[0].program,
    notes,
    mods: []
  };
}

/* 트랙 하나의 글자 수 어림 — 게임이 세는 방식(음표 글자 + 쉼표)에 맞춘다.

   단순히 음 개수만 세면 실제보다 10%쯤 적다. 이유는 둘이다.
     · 한 토막으로 못 적는 길이는 이음줄로 갈라지고, 토막마다 글자다
       (168틱 = c4&c16. = 두 글자)
     · 시작이 다른데 겹치는 음은 앞 음이 뒷음 시작에서 잘려 길이가 바뀐다
   그래서 실제 변환과 같은 눈금(TPQN)으로 옮기고, 같은 방식으로 잘라,
   같은 토큰 표로 토막 수를 센다. 옥타브·세기 명령은 게임도 안 센다. */
function estimateChars(notes, ppq) {
  if (!notes.length) return 0;

  /* 시작 자리별로 묶는다 — 같은 자리는 화음이라 서로 자르지 않는다 */
  const starts = [];
  let lastStart = null;
  for (const n of notes) {
    const st = snap(toTick(n.startTick, ppq));
    const en = snap(toTick(n.endTick, ppq));
    if (st !== lastStart) { starts.push({ start: st, ends: [] }); lastStart = st; }
    starts[starts.length - 1].ends.push(Math.max(st + MIN_TICK, en));
  }

  let chars = 0, cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    const g = starts[i];
    const nextStart = i + 1 < starts.length ? starts[i + 1].start : Infinity;

    if (g.start > cursor) chars += resolveTickTokens(g.start - cursor).tokens.length || 0;   // 쉼표

    let longest = 0;
    for (const end of g.ends) {
      const len = Math.max(MIN_TICK, Math.min(end, nextStart) - g.start);   // 뒷음에 잘린다
      chars += Math.max(1, resolveTickTokens(len).tokens.length);
      if (len > longest) longest = len;
    }
    cursor = g.start + longest;
  }
  return chars;
}

function splitSoloByRegister(merged, ppq) {
  const notes = merged.notes;
  if (notes.length < SOLO_TRACKS) return [merged];

  const keys = [...new Set(notes.map(n => n.key))].sort((a, b) => a - b);
  if (keys.length < SOLO_TRACKS) return [merged];

  /* 경계 (lo, hi): key < lo → 낮은 트랙, key < hi → 가운데, 나머지 → 높은 트랙 */
  const bucket = (lo, hi) => {
    const low = [], mid = [], high = [];
    for (const n of notes) (n.key < lo ? low : n.key < hi ? mid : high).push(n);
    return [high, mid, low];
  };
  const score = (lo, hi) => {
    const b = bucket(lo, hi);
    const c = b.map(list => estimateChars(list, ppq));
    return Math.max(...c) * 1000 + (Math.max(...c) - Math.min(...c));
  };

  /* 시작점: 음 개수 기준 삼등분 */
  const sortedKeys = notes.map(n => n.key).sort((a, b) => a - b);
  let lo = sortedKeys[Math.floor(sortedKeys.length / 3)];
  let hi = sortedKeys[Math.floor(sortedKeys.length * 2 / 3)];
  if (hi <= lo) hi = lo + 1;

  /* 경계를 한 건반씩 옮기며 최대 글자 수를 낮춘다 (언덕 오르기) */
  let best = score(lo, hi);
  for (let round = 0; round < 60; round++) {
    let improved = false;
    for (const [dl, dh] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nl = lo + dl, nh = hi + dh;
      if (nl >= nh) continue;
      const sc = score(nl, nh);
      if (sc < best) { best = sc; lo = nl; hi = nh; improved = true; }
    }
    if (!improved) break;
  }

  const toParts = (l, h) => {
    const [high, mid, low] = bucket(l, h);
    const labels = ["높은음", "가운데", "낮은음"];
    return [high, mid, low].map((list, i) => ({
      id: "solo" + i,
      trackIndex: i,
      channel: merged.channel,
      program: merged.program,
      notes: list,
      mods: [],
      soloLabel: labels[i]
    }));
  };

  return { lo, hi, toParts };
}

/* ============================================================
   미세 조정 — 경계 건반의 음을 옆 트랙으로 조금씩 넘긴다
   ============================================================
   음역 경계만으로는 균형이 거칠다. 경계에 놓인 건반 하나에 음이
   수백 개면, 경계를 한 칸 옮기는 순간 수백 자가 한꺼번에 움직여
   한쪽이 넘치거나 다른 쪽이 넘친다.

   세 트랙은 같은 악기로 동시에 울린다. 그러니 음이 어느 트랙에
   있는지는 소리로 구별되지 않는다 — 겹침이 잘리는 것만 다르다.
   그래서 가장 많은 트랙에서 경계 건반의 음을 시간 순으로(뒤에서부터)
   하나씩 옆 트랙에 넘긴다. 같은 건반이 곡 앞부분은 이 트랙, 뒷부분은
   저 트랙에 놓이는 셈인데, 들리기엔 아무 차이가 없다.

   어림(estimateChars)으로 넘길 만큼을 정하고, 진짜 MML로 재서 남은
   차이를 다시 몇 번 메운다. 진짜 변환은 비싸므로 네 번까지만이다.
   ============================================================ */
function refineSoloSplit(split, buildSong, ppq) {
  const parts = split.toParts(split.lo, split.hi);   // [높은음, 가운데, 낮은음]
  const lists = parts.map(p => p.notes.slice());

  const est = () => lists.map(l => estimateChars(l, ppq));

  /* from 트랙에서 to 트랙과 맞닿은 건반의 음 하나를 넘긴다.
     높은음↔가운데 경계는 높은음의 가장 낮은 건반 / 가운데의 가장 높은 건반. */
  const moveOne = (from, to) => {
    const src = lists[from];
    if (src.length < 2) return false;
    const pickHighest = to < from;   // 위 트랙으로 넘기면 가장 높은 건반부터
    let key = pickHighest ? -Infinity : Infinity;
    for (const n of src) key = pickHighest ? Math.max(key, n.key) : Math.min(key, n.key);
    let idx = -1;   // 그 건반의 음 중 가장 늦은 것
    for (let i = 0; i < src.length; i++) if (src[i].key === key && (idx < 0 || src[i].startTick > src[idx].startTick)) idx = i;
    if (idx < 0) return false;
    const [n] = src.splice(idx, 1);
    const dst = lists[to];
    let at = dst.length;
    while (at > 0 && (dst[at - 1].startTick > n.startTick || (dst[at - 1].startTick === n.startTick && dst[at - 1].key > n.key))) at--;
    dst.splice(at, 0, n);
    return true;
  };

  /* 어림으로 균형 잡기: 가장 많은 트랙에서 더 적은 이웃으로 */
  const balanceByEstimate = (targetGap) => {
    for (let step = 0; step < 400; step++) {
      const c = est();
      const max = Math.max(...c), min = Math.min(...c);
      if (max - min <= targetGap) return;
      const from = c.indexOf(max);
      const neighbours = from === 1 ? [0, 2] : [1];
      const to = neighbours.length === 2 ? (c[0] <= c[2] ? 0 : 2) : neighbours[0];
      /* 차이의 절반쯤을 한꺼번에 넘기고 다시 잰다 — 매번 재면 느리다 */
      const batch = Math.max(1, Math.floor((max - min) / 2));
      for (let k = 0; k < batch; k++) if (!moveOne(from, to)) return;
    }
  };

  balanceByEstimate(4);

  /* 진짜로 재서 남은 차이를 메운다 */
  const realCounts = () => buildSong(lists.map((l, i) => ({ ...parts[i], notes: l }))).tracks.map(t => gameCharCount(t.mml));
  let real = realCounts();
  for (let round = 0; round < 6; round++) {
    const max = Math.max(...real), min = Math.min(...real);
    /* 한도 안에 다 들어갔고 차이도 작으면 그만 */
    if (max <= GAME_CHAR_LIMIT && max - min <= 12) break;
    if (max - min <= 2) break;
    const from = real.indexOf(max);
    const neighbours = from === 1 ? [0, 2] : [1];
    const to = neighbours.length === 2 ? (real[0] <= real[2] ? 0 : 2) : neighbours[0];
    /* 차이의 절반쯤을 넘긴다 (한 음 ≈ 한 글자 남짓) */
    const count = Math.max(1, Math.floor((max - min) / 2));
    for (let k = 0; k < count; k++) if (!moveOne(from, to)) break;
    real = realCounts();
  }

  return lists.map((l, i) => ({ ...parts[i], notes: l }));
}


/* ============================================================
   성부 나눔 (mode: "voices")
   ============================================================
   MML은 한 트랙 안에서 앞 음이 뒷 음 시작을 넘지 못한다. 피아노처럼
   화음을 누른 채 멜로디가 움직이는 곡은 지속음이 죄다 잘려 원본과
   다르게(마른 스타카토처럼) 들린다.

   그래서 "겹치는 음"을 성부로 나눠 트랙에 담아, 지속음이 제 길이대로
   울리게 한다 (서스테인 보존). 트랙 수 제한은 없다 — 필요한 성부만큼
   트랙이 생기고, 게임에서는 한 사람이 트랙 셋이므로 여러 명이 나눠
   연주하면 된다. 음역이 아니라 겹침 기준으로 나누는 것이 핵심이다 —
   솔로 모드(음역 분배)로는 같은 음역 안의 겹침이 그대로 잘린다.
   ============================================================ */

/* 파트의 노트를 화음 덩어리로 묶는다 (전역 시작점 지도와 같은 규칙) */
function chordClustersOf(notes, ppq) {
  const sorted = notes.slice().sort(
    (a, b) => (a.startTick - b.startTick) || (a.key - b.key)
  );
  const clusters = [];
  let cur = null;
  for (const n of sorted) {
    const s = toTick(n.startTick, ppq);
    const e = toTick(n.endTick, ppq);
    if (!cur || s - cur.s >= MIN_TICK) {
      cur = { s, e, notes: [n] };
      clusters.push(cur);
    } else {
      cur.notes.push(n);
      if (e > cur.e) cur.e = e;
    }
  }
  return clusters;
}

/* 이 파트를 한 트랙에 그대로 두면 잘려 나가는 총량(tick) */
function partOverlapLoss(part, ppq) {
  const clusters = chordClustersOf(part.notes, ppq);
  let loss = 0;
  for (let i = 0; i + 1 < clusters.length; i++) {
    const nextStart = clusters[i + 1].s;
    for (const n of clusters[i].notes) {
      loss += Math.max(0, toTick(n.endTick, ppq) - nextStart);
    }
  }
  return loss;
}

/* 한 파트를 겹침 기준으로 성부로 나눈다 — 필요한 만큼 만들되, 최소로.

   규칙: "이미 있는 성부에 자리가 나면(앞 음이 끝났으면) 거기, 아니면
   새 성부". 자리가 없다고 앞 음을 자르는 일이 없으므로 모든 음이 원본
   길이 그대로 울린다 (서스테인 100% 보존).

   화음(같은 시작의 음들)은 통째로 한 성부에 앉힌다 — MML은 한 화음
   안에서 음마다 다른 길이를 적을 수 있어(이음줄), 갈라 앉힐 이유가
   없고, 갈라 앉히면 성부 둘을 동시에 점유해 트랙만 는다. 이 방식은
   구간 색칠(interval coloring)이라 성부 수가 이론상 최소가 된다.

   그 뒤 다지기: 시각이 서로 안 겹치는 성부들을 통째로 합치고, 같은
   시작점의 음은 화음으로 합쳐 트랙에 빈 구간이 남지 않게 한다.

   폭주 방지로 파트당 성부는 12개까지만 만들고, 그 너머는 가장 덜
   잘리는 자리에 앉힌다 (사실상 안 일어난다). */
function splitPartByOverlap(part, ppq) {
  if (part.notes.length === 0) return [part];

  const VOICE_CAP = 12;
  const clusters = chordClustersOf(part.notes, ppq);
  const voices = [];

  for (const c of clusters) {
    const e = Math.max(...c.notes.map(n => toTick(n.endTick, ppq)));

    let pick = null;
    for (const v of voices) {
      if (v.lastEnd <= c.s + 2) {
        if (!pick || v.lastEnd > pick.lastEnd) pick = v;   // 딱 맞는 자리
      }
    }
    if (!pick) {
      if (voices.length < VOICE_CAP) {
        pick = { notes: [], lastEnd: -Infinity };          // 새 성부
        voices.push(pick);
      } else {
        for (const v of voices) {
          if (!pick || v.lastEnd < pick.lastEnd) pick = v; // 가장 덜 잘리는 자리
        }
      }
    }
    pick.notes.push(...c.notes);
    if (e > pick.lastEnd) pick.lastEnd = e;
  }

  if (voices.length <= 1) return [part];

  return voices
    .filter(v => v.notes.length)
    .map((v, i) => ({
      ...part,
      id: part.id + ":v" + i,
      notes: v.notes.slice().sort((a, b) => a.startTick - b.startTick)
    }));
}


/* 두 성부(파트)를 한 트랙에 같이 앉혀도 모든 음이 제 길이대로 울리는가.
   같은 시작점의 음은 화음으로 합쳐진다. */
function voicesFitTogether(a, b, ppq) {
  const merged = chordClustersOf(a.notes.concat(b.notes), ppq);
  for (let i = 0; i < merged.length; i++) {
    const nextS = i + 1 < merged.length ? merged[i + 1].s : Infinity;
    for (const n of merged[i].notes) {
      if (toTick(n.endTick, ppq) > nextS + 2) return false;
    }
  }
  return true;
}

/* ── 글자 수 균형 (서스테인 모드) ──
   트랙 하나가 게임 한도(3000자)를 넘으면:
     ① 같은 악기의 여유 트랙 중 자리가 나는 곳으로 노트를 옮긴다.
        (모든 음이 제 길이대로 울릴 수 있고, 같은 건반이 겹치지 않는
         곳만 받는다 — 겹치면 화음 합칠 때 한 음이 지워진다)
     ② 아무 데도 못 받으면 새 트랙을 만들어 곡 끝쪽 덩어리를 옮긴다.
        (앞쪽을 옮기면 받는 트랙 앞머리에 긴 쉼표가 붙어 글자만 든다)
   글자 수는 MML을 만들어 봐야 아므로, 만들고-재고-옮기기를 한도 안에
   들 때까지(최대 12바퀴) 반복한다. 드럼은 건드리지 않는다. */
function balanceVoiceChars(song) {

  const marks = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫"];

  /* 받아도 되는가: 모든 음이 울리고, 같은 건반이 같은 순간에 겹치지 않는가 */
  const canReceive = (receiverNotes, incoming, ppq) => {
    const merged = chordClustersOf(receiverNotes.concat(incoming), ppq);
    for (let i = 0; i < merged.length; i++) {
      const nextS = i + 1 < merged.length ? merged[i + 1].s : Infinity;
      const keys = new Set();
      for (const n of merged[i].notes) {
        if (toTick(n.endTick, ppq) > nextS + 2) return false;
        if (keys.has(n.key)) return false;
        keys.add(n.key);
      }
    }
    return true;
  };

  const baseOf = label =>
    String(label || "").replace(/ [①-⑫]$/u, "").replace(/ \d+$/, "");

  for (let round = 0; round < 12; round++) {

    // 가장 초과가 큰 트랙
    let worst = -1;
    song.tracks.forEach((tr, i) => {
      if (song.parts[i].channel === 9) return;
      if (
        tr.mml.length > GAME_CHAR_LIMIT &&
        (worst < 0 || tr.mml.length > song.tracks[worst].mml.length)
      ) worst = i;
    });
    if (worst < 0) return;   // 전부 한도 안

    const over = song.parts[worst];
    const excess = song.tracks[worst].mml.length - GAME_CHAR_LIMIT;
    const perNote =
      song.tracks[worst].mml.length / Math.max(1, over.part.notes.length);

    let need = Math.ceil(excess / perNote * 1.15) + 1;

    const clusters = chordClustersOf(over.part.notes, song.ppq);

    /* ① 같은 악기의 여유 트랙으로 — 글자 적은 곳부터 */
    const receivers = song.parts
      .map((p, i) => ({ p, i }))
      .filter(x =>
        x.i !== worst &&
        x.p.channel !== 9 &&
        x.p.part.program === over.part.program &&
        song.tracks[x.i].mml.length <= GAME_CHAR_LIMIT - 150
      )
      .sort((a, b) => song.tracks[a.i].mml.length - song.tracks[b.i].mml.length);

    const moved = new Set();

    for (let ci = clusters.length - 1; ci >= 0 && need > 0; ci--) {
      const c = clusters[ci];
      for (const r of receivers) {
        if (canReceive(r.p.part.notes, c.notes, song.ppq)) {
          r.p.part.notes = r.p.part.notes
            .concat(c.notes)
            .sort((a, b) => a.startTick - b.startTick);
          r.p.noteCount = r.p.part.notes.length;
          moved.add(ci);
          need -= c.notes.length;
          break;
        }
      }
    }

    if (moved.size) {

      over.part.notes = clusters
        .filter((_, ci) => !moved.has(ci))
        .flatMap(c => c.notes);
      over.noteCount = over.part.notes.length;

    } else {

      /* ② 새 트랙 — 곡 끝쪽 덩어리부터 필요한 만큼 */
      let take = Math.ceil(excess / perNote * 1.15) + 1;
      const keep = [];
      const out = [];
      for (let ci = clusters.length - 1; ci >= 0; ci--) {
        if (take > 0) {
          out.unshift(...clusters[ci].notes);
          take -= clusters[ci].notes.length;
        } else {
          keep.unshift(...clusters[ci].notes);
        }
      }
      if (!out.length || !keep.length) return;   // 더는 못 나눈다

      over.part.notes = keep;
      over.noteCount = keep.length;

      const base = baseOf(over.label);
      const used = song.parts.filter(p => baseOf(p.label) === base).length;
      const label = base + " " + (marks[used] || (used + 1));

      const newPart = {
        ...over.part,
        id: over.part.id + ":x" + round,
        notes: out,
        soloLabel: label
      };

      song.parts.push({
        part: newPart,
        label,
        instrument: over.instrument,
        armis: over.armis,
        channel: over.channel,
        noteCount: out.length
      });

    }

    rebuild(song);   // 옮긴 결과로 글자 수를 다시 잰다

  }

}


/* 서스테인 모드의 트랙 구성.

   같은 악기(program)인 파트들은 처음부터 합쳐서 함께 배치한다 —
   피아노 양손처럼 갈라져 들어온 파트도 한 살림으로 보고 성부를
   나누므로, 오른손 성부의 소리 없는 구간에 왼손 음이 들어가고 양손이
   같이 치는 화음은 한 화음으로 합쳐진다. 배치는 구간 색칠(자리가
   나면 그 성부, 아니면 새 성부)이라 성부 수가 이론상 최소다.

   악기가 다른 파트끼리는 섞지 않고, 드럼(ch9)은 타격음이라 잘림이
   소리에 안 남으므로 나누지도 합치지도 않는다. */
function allocateVoices(parts, ppq) {
  const drums = [];
  const byProgram = new Map();

  for (const p of parts) {
    if (p.channel === 9) {
      drums.push(p);
      continue;
    }
    const key = String(p.program);
    if (!byProgram.has(key)) byProgram.set(key, []);
    byProgram.get(key).push(p);
  }

  const marks = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫"];
  const out = [];

  for (const group of byProgram.values()) {

    /* 파트 하나 + 겹침 없음 → 손대지 않는다 (이름도 그대로) */
    if (group.length === 1 && partOverlapLoss(group[0], ppq) <= 0) {
      out.push(group[0]);
      continue;
    }

    const tis =
      [...new Set(group.map(p => p.trackIndex))].sort((a, b) => a - b);

    const joint = {
      ...group[0],
      id: group.map(p => p.id).join("+"),
      notes: group
        .flatMap(p => p.notes)
        .sort((a, b) => a.startTick - b.startTick),
      mods: group
        .flatMap(p => p.mods || [])
        .sort((a, b) => a.tick - b.tick)
    };
    delete joint.soloLabel;

    const voices = splitPartByOverlap(joint, ppq);

    const base =
      tis.map(t => "T" + t).join("+") + " · ch" + group[0].channel;

    voices.forEach((v, i) => {
      v.soloLabel =
        base + (voices.length > 1 ? " " + (marks[i] || (i + 1)) : "");
      out.push(v);
    });

  }

  return out.concat(drums);
}


function convert(buffer, options) {
  const smf = parseSMF(buffer);
  const collected = collectParts(smf);
  const tempoList = normalizeTempos(collected.tempos, smf.ppq);

  let parts = collected.parts;

  const makePartList = list => list.map(part => ({
    part,
    label: part.soloLabel || ("T" + part.trackIndex + " · ch" + part.channel),
    instrument: instrumentName(part),
    armis: part.channel === 9 ? "드럼" : ARMIS_INSTRUMENTS[0],
    channel: part.channel,
    noteCount: part.notes.length
  }));

  /* 성부 나눔: 트랙 여유가 있으면 겹치는 음을 성부로 갈라
     지속음이 제 길이대로 울리게 한다 (위 allocateVoices 참고) */
  if (options && options.mode === "voices") {
    parts = allocateVoices(parts, smf.ppq);
  }

  /* 솔로곡이면 파트를 합쳐 세 트랙으로 다시 나눈다 */
  const solo = !!(options && options.mode === "solo");
  if (solo) {
    const merged = mergeForSolo(parts);
    if (merged) {
      const split = splitSoloByRegister(merged, smf.ppq);
      if (split.toParts) {
        parts = refineSoloSplit(split, list => {
          const trial = { ppq: smf.ppq, format: smf.format, parts: makePartList(list), tracks: [], tempoList: tempoList.slice() };
          rebuild(trial);
          return trial;
        }, smf.ppq);
      } else {
        parts = split;
      }
    }
  }

  // 파트 = MIDI의 (트랙, 채널) 하나. 파트 하나가 보이스 여러 개로 갈라질 수 있다.
  const partList = parts.map(part => ({
    part,                                   // 원본 노트를 들고 있어야 다시 변환할 수 있다
    label: part.soloLabel || ("T" + part.trackIndex + " · ch" + part.channel),
    instrument: instrumentName(part),       // MIDI에 적힌 악기
    armis: part.channel === 9 ? "드럼" : ARMIS_INSTRUMENTS[0],   // ch9는 GM 드럼 채널
    channel: part.channel,
    noteCount: part.notes.length
  }));

  const song = { ppq: smf.ppq, format: smf.format, parts: partList, tracks: [], tempoList, solo };
  rebuild(song);

  /* 서스테인 모드: 한도를 넘는 트랙이 있으면 노트를 옮기거나
     새 트랙을 만들어 전 트랙이 3000자 안에 들게 한다 */
  if (options && options.mode === "voices") {
    balanceVoiceChars(song);
  }

  return song;
}

/* 파트별 악기에 맞춰 MML을 다시 만든다.
   악기를 바꿨을 때 MIDI를 다시 읽을 필요 없이 이 함수만 부르면 된다.
   음량 보정이 곡 전체를 보고 계산되므로 한 파트만 바뀌어도 전부 다시 만든다.
   각 트랙은 song.tempoList 전체를 독립적으로 받아 자기 타임라인에 직접
   삽입한다 — 마비꼬와 달리 Armis는 모든 트랙에 템포가 들어가야 한다.
   (단, 그 트랙이 끝난 뒤의 템포는 마비꼬처럼 붙이지 않는다) */
function rebuild(song) {
  /* 1) 파트별 그룹을 먼저 만들고
     2) 모든 트랙을 같이 보며 템포 위치를 맞춘 뒤
     3) 그 템포로 각 트랙을 찍는다. 순서를 지켜야 트랙이 어긋나지 않는다. */
  /* 전역 시작점 지도 — 모든 파트가 같은 격자 결정을 공유해야
     합주에서 같이 치는 히트가 트랙 사이에서 안 어긋난다. */
  const startOf = buildGlobalStartMap(song.parts, song.ppq);
  const prepared = song.parts.map(p => ({ p, ...prepareTrack(p.part, song.ppq, p.armis, startOf) }));
  const tempoList = alignTempos(prepared.map(x => x.groups), song.tempoList);

  /* 맞춘 템포 자리를 song에도 되쓴다. MML은 이 보정본으로 찍히므로,
     화면(피아노롤의 템포 마커)이 원본을 그대로 보여주면 둘이 MIN_TICK
     미만으로 어긋난다. 화면과 붙여넣는 MML은 언제나 같은 것을 말해야 한다. */
  song.tempoList = tempoList;

  const tracks = [];
  for (const { p, groups, techs } of prepared) {
    const events = buildEvents(groups, tempoList, p.armis, techs);
    if (!events.some(e => e.type === "Note")) continue;
    // groups: 편집기 피아노롤이 음 하나하나의 자리(tick)와 건반 번호를 그리는 데 쓴다
    tracks.push({ owner: p, events, groups, label: p.label });
  }

  song.tracks = tracks;

  if (AUTO_BOOT_VELOCITY && tracks.length) {
    let vmax = 0;
    for (const t of tracks) for (const e of t.events) {
      if (e.type === "Velocity" && e.value > 0) vmax = Math.max(vmax, e.value);
    }
    const diff = VEL_MAX - vmax;
    if (diff > 0) {
      for (const t of tracks) for (const e of t.events) {
        if (e.type !== "Velocity") continue;
        if (e.value === 0) continue;   // v0는 "소리 없음"이라 올리면 안 된다
        e.value += diff;
      }
    }
  }

  for (const t of tracks) {
    t.mml = eventsToMml(t.events);
    // 화음은 가장 긴 음이 커서를 밀므로 그 값(adv)만 센다
    let total = 0;
    for (const e of t.events) {
      if (e.type === "Note") total += (e.adv || 0);
      else if (e.type === "Rest") total += e.tick;
    }
    t.totalTick = total;
  }
}
