// ══════════════════════════════════════════
// 여드름 — 하나하나를 번호로 쫓는다
// ══════════════════════════════════════════
//
// 이 앱의 다른 기록은 전부 "그날의 값"이다. 20mg를 먹었다, 500ml를 마셨다.
// 여드름은 다르다. 월요일에 나서 다음 주 목요일에 없어지는 **며칠을 사는 개체**다.
// 그래서 "오늘 여드름 3개"라고 날마다 세어 적으면 정작 묻고 싶은 것 —
// 이 녀석이 며칠째인지, 좁쌀이 염증으로 번졌는지, 턱에만 자꾸 나는지 — 가
// 전부 기록 밖으로 새어 나간다.
//
// 그렇다고 명단을 설정에 따로 두지는 않는다. 설정은 키 하나를 통째로 최신 것이
// 이기는 방식으로 합쳐지기 때문에, 휴대폰과 노트북에서 각각 하나씩 더하면
// 한쪽이 사라진다. 그래서 명단을 저장하지 않고 **날짜에 적힌 사실로부터 세운다**.
//
//   난 날   day.t.acne.v.add  = [{ id, no, type, x, y, itch, note }]
//   진 날   day.t.acne.v.gone = [id, …]
//
// 날마다 따로 적히니 두 기기가 다른 날을 건드리는 한 부딪칠 일이 없고, 명단은
// 언제든 다시 셀 수 있다(roster). 저장은 사실만, 명단은 셈으로.

const AC_TRACK = 'acne';

// 종류 — 둘로 나눈다. 더 잘게 쪼개면(면포·구진·농포·결절) 적는 사람이 매번
// 망설이게 되고, 망설이는 칸은 결국 안 적게 된다.
const AC_TYPES = [
  { v: 'c', name: '좁쌀',   desc: '피지가 막힌 작은 알갱이 (면포)' },
  { v: 'i', name: '염증성', desc: '붉게 부어오른 것 (구진·농포)' },
];
const acTypeOf = v => AC_TYPES.find(t => t.v === v) || null;

// ── 명단 세우기 ─────────────────────────────
let _acCache = null;
/**
 * 지금까지 난 여드름 전부. [{ id, no, type, x, y, itch, note, born, gone }]
 *
 * 날짜순으로 훑으며 난 것을 등록하고 진 것에 날짜를 적는다. 같은 id가 다시
 * 등록되면 나중 것이 이긴다 — 태어난 날의 기록을 고치면 그게 그 여드름이다.
 */
function acRoster(){
  if(_acCache) return _acCache;
  const byId = new Map();
  for(const mk of DiaryStore.monthKeys()){
    const m = DiaryStore.getMonth(mk, false);
    if(!m) continue;
    for(const ds of Object.keys(m.days).sort()){
      const e = m.days[ds].t && m.days[ds].t[AC_TRACK];
      const v = e && e.v;
      if(!v) continue;
      (v.add || []).forEach(s => {
        if(!s || !s.id) return;
        const prev = byId.get(s.id);
        byId.set(s.id, { ...s, born: ds, gone: (prev && prev.gone) || null });
      });
      (v.gone || []).forEach(id => {
        const prev = byId.get(id);
        if(prev) prev.gone = ds;
      });
    }
  }
  // 난 날이 없는 것은 명단에 세울 수 없다 — 태어난 기록이 지워졌거나 아직 안 온 것
  _acCache = [...byId.values()].filter(s => s.born).sort((a, b) => (a.no || 0) - (b.no || 0));
  return _acCache;
}
// 기록이 바뀌면 다시 센다. 세는 건 싸고, 틀린 명단은 비싸다.
if(window.DiaryStore) DiaryStore.onChange(() => { _acCache = null; });

/** 그날 얼굴에 있던 것들. 없어진 날 당일은 아직 있던 것으로 센다. */
const acLiveOn = ds => acRoster().filter(s => s.born <= ds && (!s.gone || s.gone >= ds));
/** 그날 없어진 것들 */
const acGoneOn = ds => acRoster().filter(s => s.gone === ds);
const acNextNo = () => acRoster().reduce((n, s) => Math.max(n, s.no || 0), 0) + 1;
const acNewId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const acDays = (ds, s) => {
  const end = s.gone && s.gone < ds ? s.gone : ds;
  return Math.round((new Date(end + 'T00:00:00') - new Date(s.born + 'T00:00:00')) / 86400000) + 1;
};
const acLived = s => (s.gone ? acDays(s.gone, s) : null);

// ── 쓰기 ────────────────────────────────────
// 어느 날 기록을 고치든 통로는 하나다. add도 gone도 빈 날은 기록을 지운다 —
// 빈 껍데기가 남으면 달력에 아무것도 아닌 표가 서고 '이 날은 빼기'도 막힌다.
async function acSave(ds, v){
  const add = (v.add || []).filter(Boolean);
  const gone = (v.gone || []).filter(Boolean);
  // 빈 칸은 아예 적지 않는다. gone:[]를 남겨 두면 공개본과 Markdown에
  // "이 날 없어진 여드름: 없음" 같은 줄이 날마다 따라붙는다.
  const next = {};
  if(add.length) next.add = add;
  if(gone.length) next.gone = gone;
  await DiaryStore.setTrack(ds, AC_TRACK, Object.keys(next).length ? next : null);
  _acCache = null;
}
const acDayOf = ds => DiaryStore.getTrack(ds, AC_TRACK) || {};

/** 이 날 하나 났다 */
async function acAdd(ds, spot){
  const d = acDayOf(ds);
  const s = {
    id: acNewId(), no: acNextNo(), type: AC_TYPES[0].v,
    x: Math.round((spot.x || .5) * 1000) / 1000,
    y: Math.round((spot.y || .5) * 1000) / 1000,
  };
  await acSave(ds, { ...d, add: (d.add || []).concat([s]) });
  return s;
}
/**
 * 여드름 자체를 고친다.
 *
 * 종류도 메모도 위치도 그 여드름의 것이지 보고 있는 날의 것이 아니다. 그래서
 * 9일에 서서 고쳐도 글은 그 녀석이 태어난 1일 기록에 들어간다.
 */
async function acEdit(id, patch){
  const s = acRoster().find(x => x.id === id);
  if(!s) return null;
  const d = acDayOf(s.born);
  const add = (d.add || []).map(x => (x.id === id ? { ...x, ...patch } : x));
  await acSave(s.born, { ...d, add });
  return acRoster().find(x => x.id === id) || null;
}
/** 이 날 없어졌다 / 아니었다 */
async function acSetGone(ds, id, on){
  const s = acRoster().find(x => x.id === id);
  if(!s) return;
  if(s.gone && s.gone !== ds){            // 다른 날에 적힌 소멸은 먼저 거둔다
    const old = acDayOf(s.gone);
    await acSave(s.gone, { ...old, gone: (old.gone || []).filter(x => x !== id) });
  }
  const d = acDayOf(ds);
  const gone = (d.gone || []).filter(x => x !== id);
  await acSave(ds, { ...d, gone: on ? gone.concat([id]) : gone });
}
/** 아예 지운다 — 잘못 찍었을 때. 태어난 날과 없어진 날 양쪽에서 거둔다. */
async function acRemove(id){
  const s = acRoster().find(x => x.id === id);
  if(!s) return;
  if(s.gone){
    const g = acDayOf(s.gone);
    await acSave(s.gone, { ...g, gone: (g.gone || []).filter(x => x !== id) });
  }
  const b = acDayOf(s.born);
  await acSave(s.born, { ...b, add: (b.add || []).filter(x => x.id !== id) });
}

// ── 얼굴 ────────────────────────────────────
// 사진이 아니라 그림이다. 사진을 쓰면 찍을 때마다 각도와 빛이 달라서 같은 자리가
// 같은 자리로 안 보이고, 무엇보다 얼굴 사진 한 장이 이 화면에 영영 눌러앉는다.
// 그림은 좌표가 고정이라 "지난달 턱에 났던 그 자리"를 그대로 가리킬 수 있다.
const AC_FACE = `
<path class="ac-skin" d="M50 9c-17 0-28 11-28 28 0 4 .2 9 .7 14-2.2.4-3.7 2.6-3.2 5.4.5 2.9 2.7 4.9 4.9 4.6 1.8 7.6 5 14.6 9 19.6 5 6.2 11 9.4 16.6 9.4s11.6-3.2 16.6-9.4c4-5 7.2-12 9-19.6 2.2.3 4.4-1.7 4.9-4.6.5-2.8-1-5-3.2-5.4.5-5 .7-10 .7-14 0-17-11-28-28-28z"/>
<path class="ac-line" d="M23 33c4-9 14-14 27-14s23 5 27 14"/>
<path class="ac-line" d="M33 41c3.5-2.5 8-2.5 11 0M56 41c3-2.5 7.5-2.5 11 0"/>
<ellipse class="ac-line" cx="38.5" cy="49" rx="4.2" ry="2.8"/>
<ellipse class="ac-line" cx="61.5" cy="49" rx="4.2" ry="2.8"/>
<path class="ac-line" d="M50 52v11c0 1.6-1.4 2.6-3 2.6"/>
<path class="ac-line" d="M43 74c2.4 1.8 4.8 2.6 7 2.6s4.6-.8 7-2.6"/>`;

/**
 * 그림이 차지하는 자리. 얼굴은 19.4~80.6 × 9~90에 그려져 있고, 점이 가장자리에서
 * 잘리지 않게 5만큼 여백을 둔다.
 *
 * 보이는 자리와 좌표계가 같아야 한다. 예전에는 0~100 × 0~120을 그대로 썼는데,
 * 그러면 턱 밑 4분의 1이 빈 채로 누를 수 있는 자리로 남아서, 턱을 눌렀는데 점이
 * 얼굴 바깥에 찍혔다. 0~1은 **얼굴의** 왼쪽 끝부터 오른쪽 끝, 이마부터 턱이다.
 */
const AC_VB = { x: 14, y: 4, w: 72, h: 91 };
const acCx = x => AC_VB.x + x * AC_VB.w;
const acCy = y => AC_VB.y + y * AC_VB.h;

/** 얼굴 + 그날의 점들 */
function acFaceSvg(live, sel){
  const dots = live.map(s =>
    `<g class="ac-dot${s.id === sel ? ' on' : ''}${s.gone ? ' gone' : ''}" data-id="${escapeHtml(s.id)}" ` +
        `tabindex="0" role="button" aria-label="${s.no}번 ${escapeHtml((acTypeOf(s.type) || {}).name || '')}">` +
      `<circle class="ac-dot-c ac-t-${escapeHtml(s.type || 'c')}" ` +
        `cx="${acCx(s.x).toFixed(2)}" cy="${acCy(s.y).toFixed(2)}" r="4.6"/>` +
      `<text class="ac-dot-n" x="${acCx(s.x).toFixed(2)}" y="${(acCy(s.y) + 2).toFixed(2)}">${s.no}</text>` +
    `</g>`).join('');
  return `<svg class="ac-svg" viewBox="${AC_VB.x} ${AC_VB.y} ${AC_VB.w} ${AC_VB.h}" role="img" ` +
      `aria-label="얼굴 그림. 여드름 ${live.length}개">${AC_FACE}${dots}</svg>`;
}

// ── 화면 ────────────────────────────────────
let _acSel = null;                       // 펼쳐 둔 여드름

function acRender(box, ds){
  if(!box) return;
  const live = acLiveOn(ds);
  const gone = acGoneOn(ds);
  const shown = live.concat(gone.filter(g => !live.some(l => l.id === g.id)));
  if(_acSel && !shown.some(s => s.id === _acSel)) _acSel = null;

  box.innerHTML =
    `<div class="ac-map">${acFaceSvg(shown, _acSel)}` +
      `<div class="ac-hint">얼굴을 누르면 그 자리에 하나 생깁니다</div>` +
    `</div>` +
    `<div class="ac-side">` +
      `<div class="ac-sum">${acDaySum(ds, live, gone)}</div>` +
      `<div class="ac-list">${shown.map(s => acRowHtml(s, ds)).join('') ||
        `<div class="ac-none">이 날은 기록된 여드름이 없어요</div>`}</div>` +
    `</div>`;
  acWire(box, ds);
}

function acDaySum(ds, live, gone){
  const born = live.filter(s => s.born === ds).length;
  const bits = [`<span>이 날 <b>${live.length}</b>개</span>`];
  if(born) bits.push(`<span class="up">새로 <b>${born}</b></span>`);
  if(gone.length) bits.push(`<span class="down">사라짐 <b>${gone.length}</b></span>`);
  return bits.join('');
}

function acRowHtml(s, ds){
  const t = acTypeOf(s.type);
  const open = s.id === _acSel;
  const dead = !!(s.gone && s.gone <= ds);
  const age = dead ? `${acLived(s)}일 살았음` : `${acDays(ds, s)}일째`;
  return `<div class="ac-row${open ? ' open' : ''}${dead ? ' dead' : ''}" data-id="${escapeHtml(s.id)}">` +
    `<button type="button" class="ac-row-hd" aria-expanded="${open}">` +
      `<span class="ac-no ac-t-${escapeHtml(s.type || 'c')}">${s.no}</span>` +
      `<span class="ac-row-t">${escapeHtml(t ? t.name : '')}` +
        (s.itch ? ' · 😣' : '') + (s.note ? ' · ' + escapeHtml(s.note) : '') + `</span>` +
      `<span class="ac-age">${age}</span>` +
      `<span class="ac-caret" aria-hidden="true">▾</span>` +
    `</button>` +
    `<div class="ac-body">` +
      `<div class="ac-born">${s.born}에 남${s.gone ? ` · ${s.gone}에 사라짐` : ''}</div>` +
      `<div class="ac-types">` + AC_TYPES.map(o =>
        `<button type="button" class="ac-type${o.v === s.type ? ' on' : ''}" data-v="${o.v}" ` +
          `title="${escapeHtml(o.desc)}">${escapeHtml(o.name)}</button>`).join('') + `</div>` +
      `<button type="button" class="ac-itch${s.itch ? ' on' : ''}" aria-pressed="${!!s.itch}">😣 간지러움</button>` +
      `<textarea class="ac-note" rows="1" maxlength="200" ` +
        `placeholder="특이사항을 짧게 (짜냈다, 연고 발랐다…)">${escapeHtml(s.note || '')}</textarea>` +
      `<div class="ac-acts">` +
        (dead
          ? `<button type="button" class="ac-act back">아직 있어요</button>`
          : `<button type="button" class="ac-act done">오늘 없어졌어요</button>`) +
        `<button type="button" class="ac-act del">지우기</button>` +
      `</div>` +
    `</div>` +
  `</div>`;
}

function acWire(box, ds){
  const redraw = () => acRender(box, ds);
  const svg = box.querySelector('.ac-svg');

  // 얼굴을 누르면 그 자리에 하나. 모드를 따로 두지 않는다 — 더하기 버튼을 누르고
  // 다시 자리를 누르는 두 걸음보다, 바로 누르는 한 걸음이 낫다.
  svg.addEventListener('click', async e => {
    const hit = e.target.closest('.ac-dot');
    if(hit){ _acSel = _acSel === hit.dataset.id ? null : hit.dataset.id; redraw(); return; }
    const r = svg.getBoundingClientRect();
    const s = await acAdd(ds, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    _acSel = s.id;
    redraw();
    acAfterWrite(ds);
  });
  box.querySelectorAll('.ac-dot').forEach(g => g.addEventListener('keydown', e => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  }));

  box.querySelectorAll('.ac-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.ac-row-hd').addEventListener('click', () => {
      _acSel = _acSel === id ? null : id;
      redraw();
    });
    row.querySelectorAll('.ac-type').forEach(b => b.addEventListener('click', async () => {
      await acEdit(id, { type: b.dataset.v });
      redraw(); acAfterWrite(ds);
    }));
    const itch = row.querySelector('.ac-itch');
    if(itch) itch.addEventListener('click', async () => {
      const s = acRoster().find(x => x.id === id);
      await acEdit(id, { itch: !(s && s.itch) || undefined });
      redraw(); acAfterWrite(ds);
    });
    const note = row.querySelector('.ac-note');
    if(note){
      autoGrow(note);
      // 접었을 때 보일 한 줄을 글자에 맞춰 고친다. 여기서 통째로 다시 그리면
      // 치던 칸이 새로 만들어져 커서가 빠진다 — 그 줄만 손본다.
      const paintRow = () => {
        const s = acRoster().find(x => x.id === id);
        const t = s && acTypeOf(s.type);
        if(!s) return;
        row.querySelector('.ac-row-t').textContent =
          (t ? t.name : '') + (s.itch ? ' · 😣' : '') + (s.note ? ' · ' + s.note : '');
      };
      let t = null;
      const push = async () => {
        await acEdit(id, { note: note.value.trim() || undefined });
        paintRow();
        acAfterWrite(ds);
      };
      note.addEventListener('input', () => { autoGrow(note); clearTimeout(t); t = setTimeout(push, 500); });
      note.addEventListener('blur', () => { clearTimeout(t); push(); });
    }
    const act = sel => row.querySelector('.ac-act.' + sel);
    const done = act('done');
    if(done) done.addEventListener('click', async () => {
      await acSetGone(ds, id, true);
      _acSel = null; redraw(); acAfterWrite(ds);
    });
    const back = act('back');
    if(back) back.addEventListener('click', async () => {
      await acSetGone(ds, id, false);
      redraw(); acAfterWrite(ds);
    });
    act('del').addEventListener('click', async () => {
      const s = acRoster().find(x => x.id === id);
      if(!confirm(`${s ? s.no + '번' : '이'} 여드름 기록을 지울까요?\n(없어진 게 아니라 잘못 찍었을 때 쓰는 것입니다)`)) return;
      await acRemove(id);
      _acSel = null; redraw(); acAfterWrite(ds);
    });
  });
}

/** 쓰고 난 뒤 바깥 화면 맞추기 — 달력 배지와 달 요약 */
function acAfterWrite(ds){
  if(typeof window.onAcneWrite === 'function') window.onAcneWrite(ds);
}

window.DiaryAcne = {
  TRACK: AC_TRACK, TYPES: AC_TYPES, typeOf: acTypeOf,
  roster: acRoster, liveOn: acLiveOn, goneOn: acGoneOn, days: acDays, lived: acLived,
  add: acAdd, edit: acEdit, setGone: acSetGone, remove: acRemove,
  render: acRender, faceSvg: acFaceSvg,
};
