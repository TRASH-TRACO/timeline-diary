// ══════════════════════════════════════════
// 트랙 — 하루에 무엇을 기록할지
// ══════════════════════════════════════════
//
// 사람마다 남기고 싶은 게 다르고, 종류마다 필요한 화면도 다르다.
//   이동 경로  → 구글 타임라인을 받아 → 경로 애니메이션
//   이소티논   → 그날 먹은 양 → 짧은 기록
//   식사       → 아침·점심·저녁·간식
//   변 상태    → 횟수와 모양
// 그래서 "무엇을 기록하는가"를 선언으로 적고, 화면은 그 선언을 보고 그린다.
//
// 필드 타입이 곧 콘텐츠 계층이다. number·text·photo에 choice(여럿 중 하나)와
// bool(그랬다/아니다)이 더해졌다.
//
// 전용 화면이 필요한 트랙은 view를 준다(경로가 그렇다). 나머지는 fields만 적으면
// 기본 폼이 알아서 그려진다.
//
// 트랙 목록은 고정이 아니다. 여기 적힌 것에 사용자가 추가한 약이 붙는다(아래 '내 약').
// 그래서 목록이 필요한 곳은 TRACKS가 아니라 all()을 부른다.

// 브리스톨 대변 척도 — 변 모양을 말로 옮기려 하면 사람마다 기준이 달라진다.
// 의료에서 쓰는 1~7 척도를 그대로 쓰면 나중에 의사에게 보여줄 수도 있다.
const BRISTOL = [
  { v: 1, name: '1', desc: '딱딱한 알갱이 — 심한 변비' },
  { v: 2, name: '2', desc: '울퉁불퉁한 소시지 모양' },
  { v: 3, name: '3', desc: '표면이 갈라진 소시지 모양' },
  { v: 4, name: '4', desc: '매끈한 소시지 모양 — 가장 좋은 상태' },
  { v: 5, name: '5', desc: '가장자리가 뚜렷한 말랑한 덩어리' },
  { v: 6, name: '6', desc: '가장자리가 뭉개진 죽 같은 변' },
  { v: 7, name: '7', desc: '건더기 없는 물설사' },
];

// 끼니 — 키를 짧게 둔다. 이 값은 그대로 달 문서에 들어가 클라우드까지 올라간다.
const MEALS = [
  { key: 'b', label: '🌅 아침' },
  { key: 'l', label: '☀️ 점심' },
  { key: 'd', label: '🌙 저녁' },
  { key: 's', label: '🍪 간식' },
];

// ── 음식 태그 ───────────────────────────────
// 끼니를 한 줄 글로 받으면 '쌀밥'·'흰쌀밥'·'밥'이 전부 다른 음식이 되어 가짓수를
// 셀 수가 없다. 태그로 받으면 음식에 고정된 이름이 생긴다 — 타이핑이 줄어드는 건
// 그 다음 따라오는 덤이다.
const TAG_MAX = 20;
const splitTags = s => String(s == null ? '' : s)
  .split(/[,·\n]/).map(x => x.trim().replace(/\s+/g, ' ').slice(0, TAG_MAX)).filter(Boolean);
/** 저장된 값을 태그 목록으로. 예전 기록은 한 줄 글이라 읽을 때만 쪼갠다. */
function toTags(v){
  if(Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return v ? splitTags(v) : [];
}

// 한글 초성 — 'ㅆ'만 쳐도 '쌀밥'이 걸리게 한다
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const choOf = s => [...String(s)].map(c => {
  const i = c.charCodeAt(0) - 0xAC00;
  return (i >= 0 && i < 11172) ? CHO[Math.floor(i / 588)] : c;
}).join('');

/** 하루 기록에서 먹은 음식 종류 */
function mealKinds(v){
  const out = new Set();
  if(v) MEALS.forEach(m => toTags(v[m.key]).forEach(t => out.add(t)));
  return out;
}
/** 기간 안에 먹은 음식 종류 */
function mealKindsIn(from, to){
  const out = new Set();
  const days = DiaryStore.daysInRange(from, to);
  for(const ds in days){
    const v = days[ds].t && days[ds].t.meals && days[ds].t.meals.v;
    mealKinds(v).forEach(k => out.add(k));
  }
  return out;
}
const shiftDs = (ds, n) => {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/**
 * 지금까지 적은 음식들 — 자주 · 최근에 먹은 것부터.
 *
 * 사전을 따로 두지 않는다. 관리할 게 없고, 내 식단에만 맞춰 자란다. 미리 채워둔
 * 음식 목록은 내가 안 먹는 것까지 들어 있어서 고르는 데 방해만 된다.
 */
function foodIndex(){
  const seen = new Map();                 // 이름 → { n: 먹은 횟수, last: 마지막 날 }
  for(const key of DiaryStore.monthKeys()){
    const m = DiaryStore.getMonth(key, false);
    if(!m) continue;
    for(const ds in m.days){
      const v = m.days[ds].t && m.days[ds].t.meals && m.days[ds].t.meals.v;
      if(!v) continue;
      MEALS.forEach(mm => toTags(v[mm.key]).forEach(t => {
        const e = seen.get(t) || { n: 0, last: '' };
        e.n++;
        if(ds > e.last) e.last = ds;
        seen.set(t, e);
      }));
    }
  }
  return [...seen.entries()]
    .sort((a, b) => (b[1].n - a[1].n) || (a[1].last < b[1].last ? 1 : -1))
    .map(e => e[0]);
}

/** 입력 중인 글자로 음식 고르기. 앞에서 걸리는 것 → 가운데서 걸리는 것 순. */
function foodSuggest(q, exclude, limit){
  const pool = foodIndex().filter(n => !exclude.includes(n));
  const s = String(q || '').trim().toLowerCase();
  if(!s) return pool.slice(0, limit);
  const cho = /^[ㄱ-ㅎ]+$/.test(s);
  const head = [], rest = [];
  for(const n of pool){
    const hay = cho ? choOf(n) : n.toLowerCase();
    if(hay.startsWith(s)) head.push(n);
    else if(hay.includes(s)) rest.push(n);
  }
  return head.concat(rest).slice(0, limit);
}

const TRACKS = [
  {
    id: 'route',
    name: '이동 경로',
    icon: '🗺️',
    always: true,               // 이 앱의 기본이라 끌 수 없다
    view: 'route',              // 전용 화면 (지도 재생기)
    /** 캘린더 셀에 무엇을 보일지 */
    cell: v => (v ? { thumb: v, sub: fmtDist(v.d || 0) } : null),
    /**
     * 공개 수준. 궤적은 집과 직장 주소를 그대로 드러내므로 — 이 앱은 심지어
     * '시작 00:10 · 집'이라고 라벨까지 붙인다 — 기본값을 '집 주변 가리기'로 둔다.
     */
    share: [
      { id: 'summary', name: '요약만', desc: '이동 거리·시간만, 좌표는 안 나감',
        project: v => DiaryShare.routeSummary(v) },
      { id: 'hide-home', name: '집 주변 가리기', desc: '집·직장 반경 500m를 도려낸 궤적',
        recommended: true, project: v => DiaryShare.redactRoute(v) },
      { id: 'full', name: '궤적 전체', desc: '집 위치가 그대로 드러납니다',
        sensitive: true, project: v => v },
    ],
  },
  {
    id: 'isotretinoin',
    name: '이소티논',
    icon: '💊',
    desc: '먹은 양과 그날의 기록을 남깁니다',
    fields: [
      { key: 'dose', type: 'number', label: '복용량', unit: 'mg',
        min: 0, max: 200, step: 5, quick: [0, 10, 20, 40] },
      { key: 'photos', type: 'photo', label: '피부 상태', max: 4 },
      // 라벨을 그냥 '기록'으로 두면 아래 '오늘의 일기'와 헷갈린다
      { key: 'note', type: 'text', label: '상태 메모', max: 200,
        placeholder: '피부 상태나 부작용을 짧게' },
    ],
    cell: v => (v && v.dose != null ? { badge: v.dose + 'mg' } : null),
    share: [
      { id: 'dose',  name: '복용량만',      fields: ['dose'], recommended: true },
      { id: 'note',  name: '복용량 + 메모', fields: ['dose', 'note'] },
      { id: 'all',   name: '사진까지',      fields: ['dose', 'note', 'photos'], sensitive: true,
        desc: '얼굴·피부 사진이 함께 나갑니다' },
    ],
    /**
     * 월 요약. entries: [{ds, v}] — 날짜순.
     * 누적 복용량은 이 약을 먹는 동안 사람들이 실제로 세는 숫자라 합계를 보여준다.
     */
    summary(entries){
      const taken = entries.filter(e => e.v && e.v.dose > 0);
      if(!taken.length) return null;
      const total = taken.reduce((s, e) => s + e.v.dose, 0);
      return [
        { k: '먹은 날', v: taken.length + '일' },
        { k: '누적 복용량', v: fmtNum(total) + ' mg' },
        { k: '기록한 날', v: entries.filter(e => e.v && (e.v.note || '').trim()).length + '일' },
      ];
    },
  },
  {
    id: 'meals',
    name: '식사',
    icon: '🍚',
    desc: '아침·점심·저녁·간식을 남깁니다',
    // 끼니마다 음식 태그. 집밥은 크게 돌고 돌아서, 몇 번 적고 나면 그 다음부터는
    // 치는 게 아니라 고르는 일이 된다.
    fields: MEALS.map(m => ({
      key: m.key, type: 'tags', label: m.label, max: 12,
      placeholder: '음식 적고 Enter',
    })).concat([
      { key: 'photos', type: 'photo', label: '식사 사진', max: 4 },
    ]),
    cell(v){
      if(!v) return null;
      // 간식은 끼니로 세지 않는다
      const n = MEALS.slice(0, 3).filter(m => toTags(v[m.key]).length).length;
      if(n) return { badge: n + '끼' };
      return (toTags(v.s).length || (v.photos || []).length) ? { badge: '간식' } : null;
    },
    /**
     * 폼 아래 한 줄. 장내세균이 먹는 건 음식의 양이 아니라 가짓수라, 실제로 쓰이는
     * 숫자는 이 달 합계가 아니라 "지금까지 최근 7일"이다 — 오늘 뭘 더 먹을지에
     * 영향을 주는 숫자여야 한다.
     */
    foot(ds){
      const from = shiftDs(ds, -6);
      const week = mealKindsIn(from, ds);
      if(!week.size) return '';
      const day = mealKinds(DiaryStore.getTrack(ds, 'meals')).size;
      return `<span title="${from} ~ ${ds} 동안 먹은 음식 종류">7일 <b>${week.size}</b>가지</span>` +
        (day ? `<span>이 날 <b>${day}</b>가지</span>` : '');
    },
    share: [
      { id: 'meals', name: '먹은 것', fields: MEALS.map(m => m.key), recommended: true },
      { id: 'all', name: '사진까지', fields: MEALS.map(m => m.key).concat(['photos']),
        sensitive: true, desc: '식사 사진이 함께 나갑니다' },
    ],
    summary(entries){
      const days = entries.filter(e => e.v && MEALS.some(m => toTags(e.v[m.key]).length));
      if(!days.length) return null;
      const full = days.filter(e => MEALS.slice(0, 3).every(m => toTags(e.v[m.key]).length)).length;
      const kinds = new Set();
      days.forEach(e => mealKinds(e.v).forEach(k => kinds.add(k)));
      const rows = [{ k: '식사 기록', v: days.length + '일' }];
      if(kinds.size) rows.push({ k: '음식', v: kinds.size + '가지' });
      if(full)       rows.push({ k: '세 끼 다', v: full + '일' });
      return rows;
    },
  },
  {
    id: 'stool',
    name: '변 상태',
    icon: '🚽',
    desc: '횟수와 모양을 남깁니다',
    fields: [
      { key: 'count', type: 'number', label: '횟수', unit: '회',
        min: 0, max: 20, step: 1, quick: [0, 1, 2, 3] },
      { key: 'type', type: 'choice', label: '모양 (브리스톨 척도)', options: BRISTOL,
        hint: '1에 가까울수록 단단하고, 7에 가까울수록 묽습니다' },
      // 이소티논을 비롯해 장을 건드리는 약을 먹는 동안에는 이게 병원에 가야 할
      // 신호일 수 있다. 메모에 묻히지 않게 따로 둔다.
      { key: 'blood', type: 'bool', label: '🩸 피나 점액이 섞였다' },
      { key: 'note', type: 'text', label: '메모', max: 200,
        placeholder: '복통·불편감 같은 걸 짧게' },
    ],
    cell(v){
      if(!v) return null;
      const bits = [];
      if(v.count != null) bits.push(v.count + '회');
      if(v.type != null)  bits.push(v.type + '형');
      return bits.length ? { badge: bits.join('·') } : null;
    },
    share: [
      { id: 'count', name: '횟수만', fields: ['count'], recommended: true },
      { id: 'shape', name: '횟수 + 모양', fields: ['count', 'type', 'blood'] },
      { id: 'all', name: '메모까지', fields: ['count', 'type', 'blood', 'note'],
        sensitive: true, desc: '메모에 적은 증상이 함께 나갑니다' },
    ],
    summary(entries){
      const days = entries.filter(e => e.v && (e.v.count != null || e.v.type != null));
      if(!days.length) return null;
      const counted = days.filter(e => e.v.count != null);
      const rows = [{ k: '변 기록', v: days.length + '일' }];
      if(counted.length){
        const avg = counted.reduce((s, e) => s + e.v.count, 0) / counted.length;
        rows.push({ k: '하루 평균', v: avg.toFixed(1).replace(/\.0$/, '') + '회' });
      }
      const hard = days.filter(e => e.v.type <= 2).length;
      const soft = days.filter(e => e.v.type >= 6).length;
      if(hard) rows.push({ k: '단단한 변', v: hard + '일' });
      if(soft) rows.push({ k: '무른 변', v: soft + '일' });
      return rows;
    },
  },
];

// ── 내 약 ───────────────────────────────────
// 먹는 약은 사람마다 다르다. 이소티논만 미리 적어두고 나머지는 못 적게 하면
// 이 앱은 이소티논 먹는 사람의 것이 되어버린다. 그래서 약은 설정에 담고
// 트랙은 그 설정을 보고 만든다 — 저장 구조도 화면도 미리 선언한 트랙과 똑같다.
//
//   설정 meds: [{ id, name, icon, unit, quick:[숫자…] }]
//   트랙 id:   'med:<id>'
const MEDS_KEY = 'meds';
const MED_PREFIX = 'med:';

function meds(){
  const v = DiaryStore.getSetting(MEDS_KEY, []);
  return Array.isArray(v) ? v : [];
}

/** 약 하나를 트랙 선언으로. 미리 적어둔 트랙과 같은 모양이라 화면 쪽은 구분하지 않는다. */
function medTrack(m){
  const unit = m.unit || '';
  const amount = n => fmtNum(Math.round(n * 100) / 100) + (unit ? ' ' + unit : '');
  return {
    id: MED_PREFIX + m.id,
    name: m.name,
    icon: m.icon || '💊',
    med: m,                     // 이름을 바꾸거나 지울 때 쓸 원본
    // 설명 자리에 "먹은 양과 그날의 기록을 남깁니다"를 약마다 똑같이 반복하면
    // 두 번째 약부터는 읽을 이유가 없는 글이 된다. 이 약만의 정보를 적는다.
    desc: [m.unit && `단위 ${m.unit}`, (m.quick || []).length && `자주 ${m.quick.join(', ')}`]
      .filter(Boolean).join(' · '),
    fields: [
      { key: 'dose', type: 'number', label: '복용량', unit,
        min: 0, max: 9999, step: 'any', quick: m.quick || [] },
      { key: 'note', type: 'text', label: '메모', max: 200,
        placeholder: '그날 느낀 점을 짧게' },
    ],
    cell: v => (v && v.dose != null ? { badge: fmtNum(v.dose) + unit } : null),
    share: [
      { id: 'dose', name: '복용량만',      fields: ['dose'], recommended: true },
      { id: 'note', name: '복용량 + 메모', fields: ['dose', 'note'] },
    ],
    summary(entries){
      const taken = entries.filter(e => e.v && e.v.dose > 0);
      if(!taken.length) return null;
      const total = taken.reduce((s, e) => s + e.v.dose, 0);
      return [
        { k: m.name, v: taken.length + '일' },
        { k: m.name + ' 누적', v: amount(total) },
      ];
    },
  };
}

// 트랙 목록은 캘린더 셀마다 훑는 자리에서도 쓰인다. 약 목록이 그대로면 만들어 둔 걸 쓴다.
let _medCache = { key: null, out: [] };
function medTracks(){
  const src = meds();
  const key = JSON.stringify(src);
  if(_medCache.key !== key) _medCache = { key, out: src.map(medTrack) };
  return _medCache.out;
}

/** 지금 이 앱이 아는 트랙 전부 — 미리 적어둔 것 + 사용자가 추가한 약 */
const all = () => TRACKS.concat(medTracks());

const newMedId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanName = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, 20);

/**
 * 약을 추가한다.
 * @param spec {name, icon, unit, quick:[숫자…]}
 * @returns 추가된 약
 */
async function addMed(spec){
  const name = cleanName(spec && spec.name);
  if(!name) throw new Error('약 이름을 적어주세요');
  if(meds().some(m => m.name === name)) throw new Error('같은 이름의 약이 이미 있어요');
  const quick = (Array.isArray(spec.quick) ? spec.quick : [])
    .filter(n => typeof n === 'number' && isFinite(n) && n >= 0)
    .filter((n, i, a) => a.indexOf(n) === i)
    .slice(0, 5);
  const m = {
    id: newMedId(),
    name,
    icon: String(spec.icon || '').trim().slice(0, 4) || '💊',
    unit: String(spec.unit == null ? '' : spec.unit).trim().slice(0, 6),
    quick,
  };
  await DiaryStore.setSetting(MEDS_KEY, meds().concat([m]));
  await setOn(MED_PREFIX + m.id, true);      // 추가한 순간부터 보여야 한다
  return m;
}

async function renameMed(id, name){
  const nm = cleanName(name);
  if(!nm) throw new Error('약 이름을 적어주세요');
  if(meds().some(m => m.id !== id && m.name === nm)) throw new Error('같은 이름의 약이 이미 있어요');
  const next = meds().map(m => (m.id === id ? { ...m, name: nm } : m));
  await DiaryStore.setSetting(MEDS_KEY, next);
}

/**
 * 약을 목록에서 지운다. 그 약으로 남긴 기록까지 지울지는 부르는 쪽이 정한다
 * (DiaryStore.clearTrack) — 여기서는 선언만 치운다.
 */
async function removeMed(id){
  await DiaryStore.setSetting(MEDS_KEY, meds().filter(m => m.id !== id));
  await setOn(MED_PREFIX + id, false);
}

const trackById = id => all().find(t => t.id === id) || null;

// ── 켜고 끄기 ───────────────────────────────
// 기록이 있는 트랙은 설정과 무관하게 보인다. 다른 기기에서 켠 걸 몰라도
// 기록이 사라진 것처럼 보이면 안 되기 때문이다.
const SETTING_KEY = 'tracks';
function isOn(id){
  const t = trackById(id);
  if(t && t.always) return true;
  const on = DiaryStore.getSetting(SETTING_KEY, {});
  return !!on[id];
}
async function setOn(id, on){
  const cur = { ...DiaryStore.getSetting(SETTING_KEY, {}) };
  if(on) cur[id] = true; else delete cur[id];
  await DiaryStore.setSetting(SETTING_KEY, cur);
}
/** 그날 화면에 보여줄 트랙들 — 켜져 있거나, 그날 기록이 있거나 */
function tracksFor(ds){
  const has = DiaryStore.daysTracks(DiaryStore.getDay(ds) || {});
  const on = DiaryStore.getSetting(SETTING_KEY, {});
  return all().filter(t => t.always || on[t.id] || has.includes(t.id));
}

// ── 기본 폼 ─────────────────────────────────
/** 트랙 값 편집 폼. fields 선언만 보고 그린다. */
function fieldsHtml(track, val){
  const v = val || {};
  return track.fields.map(f => {
    const id = `tf-${track.id}-${f.key}`;
    if(f.type === 'number'){
      const cur = v[f.key];
      const chips = (f.quick || []).map(q =>
        `<button type="button" class="tf-chip${cur === q ? ' on' : ''}" data-v="${q}">${q}${escapeHtml(f.unit || '')}</button>`).join('');
      return `<div class="tf" data-key="${f.key}" data-type="number">` +
        `<label class="tf-label" for="${id}">${escapeHtml(f.label)}</label>` +
        `<div class="tf-num">${chips}` +
          `<input id="${id}" class="tf-input" type="number" inputmode="decimal" ` +
            `min="${f.min}" max="${f.max}" step="${f.step}" placeholder="직접" ` +
            `value="${cur == null ? '' : cur}">` +
          `<span class="tf-unit">${escapeHtml(f.unit || '')}</span>` +
        `</div></div>`;
    }
    if(f.type === 'photo'){
      const ids = Array.isArray(v[f.key]) ? v[f.key] : [];
      const shots = ids.map(pid =>
        `<div class="tf-shot" data-id="${escapeHtml(pid)}">` +
          `<img alt="" loading="lazy">` +
          `<button type="button" class="tf-shot-x" title="사진 빼기" aria-label="사진 빼기">✕</button>` +
        `</div>`).join('');
      // 추가 버튼은 가득 찼을 때도 만들어 두고 보이기만 감춘다. 아예 안 그리면
      // 사진을 뺀 뒤에 되살릴 버튼이 없다.
      return `<div class="tf" data-key="${f.key}" data-type="photo" data-max="${f.max}">` +
        `<label class="tf-label">${escapeHtml(f.label)}</label>` +
        `<div class="tf-shots">${shots}` +
          `<button type="button" class="tf-shot-add">＋<span>사진</span></button>` +
        `</div>` +
        `<input type="file" class="tf-file" accept="image/*" multiple hidden>` +
        `<div class="tf-shot-msg"></div>` +
      `</div>`;
    }
    if(f.type === 'tags'){
      // 입력칸을 칩들 뒤에 같이 둔다 — 적은 것과 적는 자리가 한 줄로 이어져야
      // "목록에 더한다"는 게 눈에 보인다.
      const chips = toTags(v[f.key]).map(t =>
        `<span class="tf-tag" data-v="${escapeHtml(t)}">${escapeHtml(t)}` +
          `<button type="button" class="tf-tag-x" aria-label="${escapeHtml(t)} 빼기">✕</button>` +
        `</span>`).join('');
      return `<div class="tf" data-key="${f.key}" data-type="tags" data-max="${f.max}">` +
        `<label class="tf-label" for="${id}">${escapeHtml(f.label)}</label>` +
        // 제안 목록은 입력칸 바로 아래에 떠야 한다. 흐름 안에 끼워 넣으면 뜰 때마다
        // 아래 칸들이 밀려서, 고르려고 보는 사이에 화면이 움직인다.
        `<div class="tf-tagbox">` +
          `<div class="tf-tags">${chips}` +
            `<input id="${id}" class="tf-tag-in" type="text" autocomplete="off" ` +
              `maxlength="${TAG_MAX}" placeholder="${escapeHtml(f.placeholder || '')}" ` +
              `role="combobox" aria-expanded="false" aria-autocomplete="list" ` +
              `aria-controls="${id}-sug">` +
          `</div>` +
          `<div class="tf-sug" id="${id}-sug" role="listbox" hidden></div>` +
        `</div>` +
      `</div>`;
    }
    if(f.type === 'choice'){
      const cur = v[f.key];
      const sel = (f.options || []).find(o => o.v === cur);
      const opts = (f.options || []).map(o =>
        `<button type="button" class="tf-opt${o.v === cur ? ' on' : ''}" data-v="${o.v}" ` +
          `title="${escapeHtml(o.desc || o.name)}">${escapeHtml(o.name)}</button>`).join('');
      return `<div class="tf" data-key="${f.key}" data-type="choice" ` +
          `data-v="${cur == null ? '' : escapeHtml(String(cur))}" data-hint="${escapeHtml(f.hint || '')}">` +
        `<label class="tf-label">${escapeHtml(f.label)}</label>` +
        `<div class="tf-opts">${opts}</div>` +
        `<div class="tf-opt-d">${escapeHtml(sel ? (sel.desc || sel.name) : (f.hint || ''))}</div>` +
      `</div>`;
    }
    if(f.type === 'bool'){
      const on = v[f.key] === true;
      return `<div class="tf" data-key="${f.key}" data-type="bool" data-v="${on ? '1' : ''}">` +
        `<button type="button" class="tf-bool${on ? ' on' : ''}" aria-pressed="${on}">` +
          `${escapeHtml(f.label)}</button>` +
      `</div>`;
    }
    if(f.type === 'text'){
      const cur = v[f.key] || '';
      const rows = f.rows || 2;
      return `<div class="tf" data-key="${f.key}" data-type="text">` +
        `<label class="tf-label" for="${id}">${escapeHtml(f.label)}</label>` +
        `<textarea id="${id}" class="tf-text${rows === 1 ? ' one' : ''}" rows="${rows}" maxlength="${f.max}" ` +
          `placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(cur)}</textarea>` +
        `</div>`;
    }
    return '';
  }).join('');
}

/** 저장된 값을 사람이 읽는 한 줄로 (공개본 미리보기 등) */
function fieldText(f, val){
  if(val == null) return '';
  if(f && f.type === 'tags') return toTags(val).join(', ');
  if(Array.isArray(val)) return `사진 ${val.length}장`;
  if(!f) return String(val);
  if(f.type === 'bool')   return val ? '예' : '아니오';
  if(f.type === 'choice'){
    const o = (f.options || []).find(x => x.v === val);
    return o ? (o.desc ? `${o.name} — ${o.desc}` : o.name) : String(val);
  }
  if(f.type === 'number' && f.unit) return `${val} ${f.unit}`;
  return String(val);
}

/**
 * 폼에 입력이 생기면 값을 모아 onChange로 넘긴다.
 * 값이 전부 비면 null을 넘겨 "기록 없음"으로 만든다.
 */
function wireFields(box, track, onChange){
  const read = () => {
    const out = {};
    box.querySelectorAll('.tf').forEach(el => {
      const key = el.dataset.key;
      if(el.dataset.type === 'number'){
        const raw = el.querySelector('.tf-input').value.trim();
        if(raw !== '' && isFinite(+raw)) out[key] = +raw;
      }else if(el.dataset.type === 'photo'){
        const ids = [...el.querySelectorAll('.tf-shot')].map(s => s.dataset.id);
        if(ids.length) out[key] = ids;
      }else if(el.dataset.type === 'tags'){
        const tags = [...el.querySelectorAll('.tf-tag')].map(t => t.dataset.v);
        if(tags.length) out[key] = tags;
      }else if(el.dataset.type === 'choice'){
        // 고른 값은 data-v에 문자열로 들어 있다. 숫자로 적힌 선택지(브리스톨 1~7)는
        // 숫자로 되돌려 저장한다 — 나중에 크기를 비교할 수 있어야 한다.
        const raw = el.dataset.v;
        if(raw !== '') out[key] = isFinite(+raw) ? +raw : raw;
      }else if(el.dataset.type === 'bool'){
        // 아니라고 답한 것과 아직 안 적은 것은 같다 — 굳이 false를 남기지 않는다
        if(el.dataset.v) out[key] = true;
      }else{
        const t = el.querySelector('.tf-text').value.trim();
        if(t) out[key] = t;
      }
    });
    return Object.keys(out).length ? out : null;
  };
  const sync = () => {
    // 숫자 칩 선택 표시를 입력값과 맞춘다
    box.querySelectorAll('.tf[data-type="number"]').forEach(el => {
      const raw = el.querySelector('.tf-input').value.trim();
      el.querySelectorAll('.tf-chip').forEach(c =>
        c.classList.toggle('on', raw !== '' && +c.dataset.v === +raw));
    });
  };
  let timer = null;
  const fire = () => { sync(); clearTimeout(timer); timer = setTimeout(() => onChange(read()), 400); };
  // 누르는 즉시 저장 — 버튼은 기다릴 이유가 없다
  const now = () => { clearTimeout(timer); onChange(read()); };

  box.querySelectorAll('.tf-chip').forEach(c => c.addEventListener('click', () => {
    const el = c.closest('.tf').querySelector('.tf-input');
    el.value = (el.value.trim() !== '' && +el.value === +c.dataset.v) ? '' : c.dataset.v;
    sync();
    now();
  }));
  // 여럿 중 하나 — 고른 것을 다시 누르면 취소된다(잘못 눌렀을 때 되돌릴 길)
  box.querySelectorAll('.tf[data-type="choice"]').forEach(el => {
    const desc = el.querySelector('.tf-opt-d');
    el.querySelectorAll('.tf-opt').forEach(b => b.addEventListener('click', () => {
      const off = el.dataset.v === b.dataset.v;
      el.dataset.v = off ? '' : b.dataset.v;
      el.querySelectorAll('.tf-opt').forEach(x => x.classList.toggle('on', !off && x === b));
      if(desc) desc.textContent = off ? (el.dataset.hint || '') : (b.title || '');
      now();
    }));
  });
  // 음식 태그 — 치는 것보다 고르는 게 빨라야 한다
  box.querySelectorAll('.tf[data-type="tags"]').forEach(el => {
    const wrap  = el.querySelector('.tf-tags');
    const input = el.querySelector('.tf-tag-in');
    const sug   = el.querySelector('.tf-sug');
    const max   = +el.dataset.max || 20;
    const ph    = input.placeholder;
    const tagsOf = () => [...el.querySelectorAll('.tf-tag')].map(t => t.dataset.v);
    let hi = -1;                                   // 자동완성에서 짚고 있는 줄

    const paint = () => {
      const full = tagsOf().length >= max;
      input.disabled = full;
      input.placeholder = full ? '' : ph;
    };
    const wireChip = ch => ch.querySelector('.tf-tag-x').addEventListener('click', () => {
      ch.remove(); paint(); now();
    });
    el.querySelectorAll('.tf-tag').forEach(wireChip);

    const opts = () => [...sug.querySelectorAll('.tf-sug-i')];
    const closeSug = () => {
      sug.hidden = true;
      hi = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    };
    /** hi = -1은 "내가 친 글자" 자리. 방향키로 거기까지 돌아올 수 있어야 한다. */
    const setHi = i => {
      hi = i;
      const list = opts();
      list.forEach((b, k) => {
        const on = k === i;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
        if(on) b.scrollIntoView({ block: 'nearest' });
      });
      if(i >= 0 && list[i]) input.setAttribute('aria-activedescendant', list[i].id);
      else input.removeAttribute('aria-activedescendant');
    };
    const openSug = pre => {
      if(input.disabled) return closeSug();
      const items = foodSuggest(input.value, tagsOf(), 10);
      if(!items.length) return closeSug();
      sug.innerHTML = '';
      // 아무것도 안 쳤는데 목록이 뜨면 이게 뭔지부터 알려준다
      if(!input.value.trim()){
        const h = document.createElement('div');
        h.className = 'tf-sug-h';
        h.textContent = '자주 먹는 것';
        sug.appendChild(h);
      }
      items.forEach((n, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tf-sug-i';
        b.id = `${input.id}-o${i}`;
        b.setAttribute('role', 'option');
        b.textContent = n;
        // mousedown에서 잡아야 입력칸이 blur되기 전에 고른 게 들어간다
        b.addEventListener('mousedown', e => { e.preventDefault(); add(n); });
        // 마우스를 얹으면 짚는 자리도 따라간다 — 키보드와 마우스가 서로 안 싸우게
        b.addEventListener('mousemove', () => { if(hi !== i) setHi(i); });
        sug.appendChild(b);
      });
      sug.hidden = false;
      // 화면 아래쪽 칸이면 위로 뒤집는다 — 특히 휴대폰에서 자판이 올라와 있으면
      // 아래로 펼친 목록은 통째로 가려진다.
      sug.classList.remove('up');
      const r = sug.getBoundingClientRect();
      const b = wrap.getBoundingClientRect();
      if(r.bottom > innerHeight - 8 && b.top > innerHeight - b.bottom) sug.classList.add('up');
      input.setAttribute('aria-expanded', 'true');
      setHi(pre ? 0 : -1);
    };
    const moveHi = d => {
      const n = opts().length;
      if(!n) return;
      setHi(d > 0 ? (hi + 1 > n - 1 ? -1 : hi + 1)
                  : (hi - 1 < -1 ? n - 1 : hi - 1));
    };

    function add(raw){
      let hit = false;
      // 쉼표로 붙여넣어도 알아서 쪼갠다 — '쌀밥, 청국장, 된장'
      for(const t of splitTags(raw)){
        if(tagsOf().includes(t) || tagsOf().length >= max) continue;
        const ch = document.createElement('span');
        ch.className = 'tf-tag';
        ch.dataset.v = t;
        ch.append(t);
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'tf-tag-x';
        x.textContent = '✕';
        x.setAttribute('aria-label', t + ' 빼기');
        ch.appendChild(x);
        wrap.insertBefore(ch, input);
        wireChip(ch);
        hit = true;
      }
      input.value = '';
      closeSug();
      paint();
      if(hit) now();
    }

    input.addEventListener('input', () => openSug(false));
    input.addEventListener('focus', () => openSug(false));
    // 치다 만 글자를 그냥 버리지 않는다
    input.addEventListener('blur', () => { if(input.value.trim()) add(input.value); closeSug(); });
    input.addEventListener('keydown', e => {
      if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
        e.preventDefault();
        if(sug.hidden) openSug(e.key === 'ArrowDown');     // ↓로 열면 첫 줄부터 짚는다
        else moveHi(e.key === 'ArrowDown' ? 1 : -1);
      }else if(e.key === 'Enter' || e.key === ','){
        e.preventDefault();
        const list = opts();
        add(hi >= 0 && list[hi] ? list[hi].textContent : input.value);
      }else if(e.key === 'Escape'){
        // 한 번은 목록만 닫고, 한 번 더 누르면 치던 글자를 버린다. blur 때 살려주는
        // 규칙에서 빠져나갈 길이 있어야 한다.
        if(!sug.hidden){ e.stopPropagation(); closeSug(); }
        else if(input.value){ e.stopPropagation(); input.value = ''; }
      }else if(e.key === 'Backspace' && !input.value){
        const last = [...el.querySelectorAll('.tf-tag')].pop();
        if(last){ last.remove(); paint(); now(); }
      }
    });
    // 칩 사이 빈 자리를 눌러도 입력칸으로 들어간다
    wrap.addEventListener('click', e => { if(e.target === wrap) input.focus(); });
    paint();
  });
  box.querySelectorAll('.tf[data-type="bool"]').forEach(el => {
    const b = el.querySelector('.tf-bool');
    b.addEventListener('click', () => {
      const on = !el.dataset.v;
      el.dataset.v = on ? '1' : '';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      now();
    });
  });
  // 사진 — 고르면 줄여서 기기에 담고, 로그인돼 있으면 뒤이어 올라간다
  box.querySelectorAll('.tf[data-type="photo"]').forEach(el => {
    const file = el.querySelector('.tf-file');
    const msg  = el.querySelector('.tf-shot-msg');
    const max  = +el.dataset.max;

    const paint = () => {
      el.querySelectorAll('.tf-shot').forEach(async sh => {
        const img = sh.querySelector('img');
        if(img.src) return;
        const u = await DiaryPhotos.url(sh.dataset.id);
        if(u) img.src = u; else sh.classList.add('missing');
      });
      const add = el.querySelector('.tf-shot-add');
      if(add) add.style.display = el.querySelectorAll('.tf-shot').length >= max ? 'none' : '';
    };
    const wireShot = sh => {
      sh.querySelector('.tf-shot-x').addEventListener('click', async e => {
        e.stopPropagation();
        const id = sh.dataset.id;
        sh.remove();
        paint();
        onChange(read());
        DiaryPhotos.remove(id).catch(() => {});
      });
      sh.querySelector('img').addEventListener('click', () => openShot(sh.dataset.id));
    };
    el.querySelectorAll('.tf-shot').forEach(wireShot);

    const addBtn = el.querySelector('.tf-shot-add');
    if(addBtn) addBtn.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const room = max - el.querySelectorAll('.tf-shot').length;
      const files = [...file.files].slice(0, Math.max(0, room));
      file.value = '';
      if(!files.length) return;
      msg.textContent = '사진 넣는 중…';
      for(const f of files){
        try{
          const id = await DiaryPhotos.add(f);
          const sh = document.createElement('div');
          sh.className = 'tf-shot';
          sh.dataset.id = id;
          sh.innerHTML = '<img alt=""><button type="button" class="tf-shot-x" title="사진 빼기" aria-label="사진 빼기">✕</button>';
          el.querySelector('.tf-shots').insertBefore(sh, addBtn);
          wireShot(sh);
        }catch(e){
          msg.textContent = e.message || '사진을 넣지 못했어요';
          continue;
        }
      }
      msg.textContent = '';
      paint();
      onChange(read());
    });
    paint();
  });

  box.querySelectorAll('.tf-input, .tf-text').forEach(el => el.addEventListener('input', fire));
  box.querySelectorAll('.tf-input, .tf-text').forEach(el => el.addEventListener('blur', () => {
    clearTimeout(timer); onChange(read());
  }));
  sync();
  return { flush(){ clearTimeout(timer); onChange(read()); } };
}

/** 사진 크게 보기 */
function openShot(id){
  DiaryPhotos.url(id).then(u => {
    if(!u) return;
    const box = document.createElement('div');
    box.className = 'shot-view';
    box.innerHTML = `<img src="${u}" alt=""><button class="shot-x" aria-label="닫기">✕</button>`;
    const close = () => box.remove();
    box.addEventListener('click', close);
    document.addEventListener('keydown', function esc(e){
      if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); }
    });
    document.body.appendChild(box);
  });
}

/** 트랙의 기본 공개 수준 (추천으로 표시된 것, 없으면 가장 좁은 것) */
function defaultShareLevel(track){
  const ls = track.share || [];
  return (ls.find(l => l.recommended) || ls[0] || null);
}

window.DiaryTracks = {
  all, trackById, defaultShareLevel, isOn, setOn, tracksFor,
  fieldsHtml, fieldText, wireFields, openShot,
  meds, addMed, renameMed, removeMed, MED_PREFIX,
  toTags, mealKinds, mealKindsIn, foodIndex, foodSuggest,
  SETTING_KEY, MEDS_KEY, BRISTOL, MEALS,
};
