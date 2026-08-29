// ══════════════════════════════════════════
// 트랙 — 하루에 무엇을 기록할지
// ══════════════════════════════════════════
//
// 사람마다 남기고 싶은 게 다르고, 종류마다 필요한 화면도 다르다.
//   이동 경로  → 구글 타임라인을 받아 → 경로 애니메이션
//   이소티논   → 그날 먹은 양 → 짧은 기록
// 그래서 "무엇을 기록하는가"를 선언으로 적고, 화면은 그 선언을 보고 그린다.
//
// 필드 타입이 곧 콘텐츠 계층이다. 지금은 number·text·photo가 있고,
// scale(1~5)·bool(했다/안 했다)이 다음 후보다.
//
// 전용 화면이 필요한 트랙은 view를 준다(경로가 그렇다). 나머지는 fields만 적으면
// 기본 폼이 알아서 그려진다.

const TRACKS = [
  {
    id: 'route',
    name: '이동 경로',
    icon: '🗺️',
    always: true,               // 이 앱의 기본이라 끌 수 없다
    view: 'route',              // 전용 화면 (지도 재생기)
    /** 캘린더 셀에 무엇을 보일지 */
    cell: v => (v ? { thumb: v, sub: fmtDist(v.d || 0) } : null),
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
];

const trackById = id => TRACKS.find(t => t.id === id) || null;

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
  return TRACKS.filter(t => isOn(t.id) || has.includes(t.id));
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
          `<input id="${id}" class="tf-input" type="number" inputmode="numeric" ` +
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
    if(f.type === 'text'){
      const cur = v[f.key] || '';
      return `<div class="tf" data-key="${f.key}" data-type="text">` +
        `<label class="tf-label" for="${id}">${escapeHtml(f.label)}</label>` +
        `<textarea id="${id}" class="tf-text" rows="2" maxlength="${f.max}" ` +
          `placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(cur)}</textarea>` +
        `</div>`;
    }
    return '';
  }).join('');
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

  box.querySelectorAll('.tf-chip').forEach(c => c.addEventListener('click', () => {
    const el = c.closest('.tf').querySelector('.tf-input');
    el.value = (el.value.trim() !== '' && +el.value === +c.dataset.v) ? '' : c.dataset.v;
    sync();
    clearTimeout(timer);
    onChange(read());          // 칩은 눌린 즉시 저장 — 기다릴 이유가 없다
  }));
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

window.DiaryTracks = { TRACKS, trackById, isOn, setOn, tracksFor, fieldsHtml, wireFields, openShot, SETTING_KEY };
