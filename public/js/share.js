// ══════════════════════════════════════════
// 공개용으로 걸러내기
// ══════════════════════════════════════════
//
// 공개의 단위는 필드가 아니라 "기간 × 트랙"이다. 필드 단위로 스위치를 늘어놓으면
// 트랙 10개에 스위치 30개가 되어 아무도 자기가 뭘 켰는지 모르게 되고, 게다가
// "사진은 공개, 복용량은 비공개" 같은 뜻이 안 통하는 조합이 생긴다.
// 그래서 어떤 묶음이 말이 되는지는 트랙이 스스로 선언하고(track.share),
// 사용자는 트랙마다 그중 하나를 고른다.
//
// 여기 있는 함수는 전부 순수 함수다 — 넣은 것만 보고 내놓는다. 무엇이 새는지는
// 브라우저 없이 검증할 수 있어야 한다.

// 집·직장 주변을 가릴 반경(m). 이 안의 점은 통째로 빠진다.
const HOME_RADIUS = 500;
// 이 이름이 붙은 방문은 그 자체가 집·직장을 가리키므로 가릴 기준점이 된다.
const HOME_NAMES = ['집', '직장'];

/**
 * 경로에서 집·직장 주변을 도려낸다.
 *
 * 끝만 자르면 부족하다. 낮에 집에 한 번 들렀으면 그 자리가 궤적 한가운데 남는다.
 * 그래서 기준점(시작·끝·집/직장 방문) 반경 안의 점을 전부 뺀다.
 * 도려낸 자리는 breaks로 표시한다 — 그냥 이어 그리면 잘라낸 지점을 가로지르는
 * 직선이 생겨서 가린 의미가 없어진다.
 *
 * @returns {object|null} 인코딩된 경로. 남는 게 없으면 null.
 */
function redactRoute(enc, opts){
  const R = (opts && opts.radius) || HOME_RADIUS;
  const r = DiaryTimeline.decodeRoute(enc);
  if(!r) return null;
  const pts = r.points;

  // 기준점 — 시작·끝, 그리고 집/직장으로 이름 붙은 방문
  const anchors = [[pts[0][0], pts[0][1]], [pts[pts.length - 1][0], pts[pts.length - 1][1]]];
  (r.visits || []).forEach(v => {
    if(HOME_NAMES.includes(v.n)) anchors.push([v.a / 1e5, v.o / 1e5]);
  });
  const near = (lat, lng) => anchors.some(a => haversine(a[0], a[1], lat, lng) <= R);

  const kept = [];
  const breaks = [];
  let dropped = false;
  for(const p of pts){
    if(near(p[0], p[1])){ dropped = true; continue; }
    if(dropped && kept.length) breaks.push(kept.length);   // 이 점 앞에서 끊겼다
    dropped = false;
    kept.push(p);
  }
  if(kept.length < 2) return null;      // 다 가리고 나면 보여줄 게 없다

  // 방문도 같은 기준으로 — 가린 자리의 방문은 빼고, 남은 것에서도 집·직장 이름은 지운다
  const visits = (r.visits || [])
    .filter(v => !near(v.a / 1e5, v.o / 1e5))
    .map(v => (HOME_NAMES.includes(v.n) ? { ...v, n: '' } : v));

  return {
    v: 2,
    p: DiaryTimeline.encodePoints(kept),
    b: breaks,
    // 이동 거리는 실제로 움직인 값을 그대로 둔다. 궤적만 잘렸을 뿐 그날 8km를
    // 걸은 건 사실이고, 그건 가릴 대상이 아니다.
    d: r.dist,
    s: kept[0][2], e: kept[kept.length - 1][2],
    tz: r.tz,
    v2: visits,
    m: r.moves || [],
    redacted: true,
  };
}

/** 좌표 없이 숫자만 — '요약만' 수준 */
function routeSummary(enc){
  const r = DiaryTimeline.decodeRoute(enc);
  if(!r) return null;
  return {
    summary: true,
    d: r.dist,
    s: r.s, e: r.e, tz: r.tz,
    places: (r.visits || []).length,
    m: r.moves || [],
  };
}

/**
 * 하루 기록에서 공개할 것만 골라낸다.
 * @param day    저장된 하루 기록 { note, t:{...} }
 * @param spec   { note:bool, tracks:{ 트랙id: 수준id } }
 * @returns {object|null} 공개본 하루. 남는 게 없으면 null.
 */
function projectDay(day, spec){
  if(!day || !spec) return null;
  const out = {};
  if(spec.note && day.note) out.note = day.note;

  const t = {};
  for(const id in (spec.tracks || {})){
    const levelId = spec.tracks[id];
    if(!levelId) continue;
    const track = DiaryTracks.trackById(id);
    const level = track && (track.share || []).find(l => l.id === levelId);
    const val = day.t && day.t[id] && day.t[id].v;
    if(!track || !level || val == null) continue;

    if(typeof level.project === 'function'){
      const v = level.project(val);
      if(v != null) t[id] = v;
      continue;
    }
    // 선언된 필드만 옮긴다. 여기 없는 필드는 그냥 안 나간다 —
    // "빼야 할 것을 지운다"가 아니라 "넣을 것만 넣는다"여야 실수가 안 샌다.
    //
    // 사건 목록(변 하나하나)은 안쪽까지 같은 규칙으로 걸러야 한다. 'log'를 통째로
    // 옮기면 '모양까지'를 골랐는데도 사건마다 적은 메모와 사진이 함께 나간다.
    // 그래서 수준은 'log.type'처럼 안쪽 칸을 따로 적고, 여기서 점을 풀어 읽는다.
    const v = {};
    const subs = {};
    for(const k of level.fields){
      const dot = k.indexOf('.');
      if(dot < 0){ if(val[k] !== undefined) v[k] = val[k]; continue; }
      const base = k.slice(0, dot);
      (subs[base] || (subs[base] = [])).push(k.slice(dot + 1));
    }
    for(const base in subs){
      if(!Array.isArray(val[base])) continue;
      // 빈 칸이 되어도 자리는 남긴다. 목록의 길이가 곧 "몇 번 있었나"라서,
      // 내용이 다 빠진 칸을 지우면 횟수가 줄어든 기록이 되어 버린다.
      v[base] = val[base].map(ev => {
        const o = {};
        if(ev && typeof ev === 'object') for(const k of subs[base]) if(ev[k] !== undefined) o[k] = ev[k];
        return o;
      });
    }
    if(Object.keys(v).length) t[id] = v;
  }
  if(Object.keys(t).length) out.t = t;
  return Object.keys(out).length ? out : null;
}

/**
 * 공개본에 실제로 나가는 것들을 미리 훑는다. 발행 전에 "이게 전부입니다"를
 * 보여주기 위한 것 — 사람이 확인할 수 없는 공개는 사고가 난다.
 */
function previewShare(days, spec){
  const out = { days: 0, notes: 0, photos: 0, tracks: {}, first: null, last: null };
  for(const ds of Object.keys(days).sort()){
    const pub = projectDay(days[ds], spec);
    if(!pub) continue;
    out.days++;
    if(!out.first) out.first = ds;
    out.last = ds;
    if(pub.note) out.notes++;
    for(const id in (pub.t || {})){
      out.tracks[id] = (out.tracks[id] || 0) + 1;
      // 어떤 칸이 사진인지는 선언이 안다. 'photos'라는 이름만 세면 부위별 사진
      // (피부의 fh·lc…)과 사건마다 붙은 사진이 통째로 빠진다.
      out.photos += DiaryTracks.photoIdsIn(DiaryTracks.trackById(id), pub.t[id]).length;
    }
  }
  return out;
}

// ── Markdown으로 ────────────────────────────
//
// 같은 공개본을 글로 옮긴다. 거르는 일은 projectDay가 이미 다 했고 여기서는
// 모양만 바꾼다 — 무엇이 나가는지 정하는 자리가 둘이 되면, 한쪽만 고치는 날이
// 반드시 온다.
//
// 받는 쪽이 사람이 아니라 AI 에이전트라서 두 가지를 더 지킨다.
//   1. 저장된 키(fh, type:6)가 아니라 사람이 읽는 말로 적는다. 에이전트는
//      이 앱의 스키마를 모른다.
//   2. 무엇이 빠졌는지도 적는다. 안 적으면 "기록이 없던 날"과 "안 내보낸
//      트랙"을 구분할 수 없어서, 없는 걸 0으로 읽어버린다.

const MD_WD = ['일', '월', '화', '수', '목', '금', '토'];
const mdWeekday = ds => MD_WD[new Date(ds + 'T00:00:00').getDay()] || '';

/** 경로는 좌표 대신 숫자만. 폴리라인을 글로 풀면 쓸모는 없고 길이만 수만 자가 된다. */
function mdRoute(v){
  const out = [];
  if(v.d != null) out.push(`이동 거리: ${fmtDist(v.d)}`);
  if(v.s && v.e)  out.push(`기록 구간: ${hmAt(v.s, v.tz)} – ${hmAt(v.e, v.tz)}`);
  const places = v.places != null ? v.places : (v.v2 || v.visits || []).length;
  if(places) out.push(`머문 곳: ${places}곳`);
  if(v.p) out.push('좌표: 생략 — Markdown에는 담지 않습니다');
  return out;
}

/**
 * 사건 목록은 한 줄로 뭉개지 않는다.
 *
 * "변 3회"만 적으면 하루에 한 줄로 받던 때로 되돌아간다 — 세 번 중 어느 것이
 * 묽었고 어느 것에 피가 있었는지가 다시 사라진다. 한 번에 한 줄씩 적는다.
 * 그랬다/아니다 칸은 '예'를 붙이지 않고 그랬던 것만 적는다 — 읽는 쪽이 사람이든
 * AI든 "🩸 피: 아니오"가 줄줄이 있는 것보다 있는 것만 보이는 쪽이 낫다.
 */
function mdEvents(f, val){
  const list = Array.isArray(val) ? val : [];
  const unit = f.unit || '회';
  const out = [`  - ${f.label}: 총 ${list.length}${unit}`];
  list.forEach((ev, i) => {
    const e = ev || {};
    const bits = [];
    for(const k in e){
      if(k === 'at') continue;                       // 시간은 줄 머리에 적는다
      const sf = DiaryTracks.evField(f, k);
      if(sf && sf.type === 'bool'){ if(e[k]) bits.push(sf.label); continue; }
      const txt = DiaryTracks.fieldText(sf, e[k]);
      if(txt !== '') bits.push(`${sf ? sf.label : k}: ${txt}`);
    }
    out.push(`    - ${i + 1}번째${e.at ? ' ' + e.at : ' (시간 미기록)'}` +
      (bits.length ? ' — ' + bits.join(', ') : ''));
  });
  return out;
}

/**
 * @param days  projectDay를 거친 공개본들 { 'YYYY-MM-DD': pub }
 * @param spec  { note, tracks }
 * @param opts  { from, to, at }
 */
function toMarkdown(days, spec, opts){
  const o = opts || {};
  const list = Object.keys(days).sort();
  const L = [];
  const span = o.from && o.to ? `${o.from} ~ ${o.to}` : '전체';

  // ── 머리말 — 이 파일이 무엇인지, 무엇이 없는지
  const inTracks = [], outTracks = [];
  for(const t of DiaryTracks.all()){
    const level = (t.share || []).find(l => l.id === (spec.tracks || {})[t.id]);
    (level ? inTracks : outTracks).push(level ? `${t.name}(${level.name})` : t.name);
  }
  if(spec.note) inTracks.push('오늘의 일기'); else outTracks.push('오늘의 일기');
  L.push(`# 일기 기록 ${span}`, '');
  L.push(`- 기간: ${span} · 기록이 있는 날 ${list.length}일`);
  L.push(`- 내보낸 때: ${o.at || new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  L.push(`- 담긴 것: ${inTracks.join(', ') || '없음'}`);
  if(outTracks.length) L.push(`- 담기지 않은 것: ${outTracks.join(', ')}`);
  L.push('- 사진은 파일 없이 장수만 적혀 있습니다.');
  L.push('- 여기 없는 날은 위 "담긴 것"에 기록이 없는 날입니다. ' +
    '"담기지 않은 것"은 기록이 있었는지조차 이 파일로는 알 수 없습니다.');
  L.push('');

  // ── 요약 — 추이를 물을 때 쓰라고 미리 더해 둔다. 숨긴 필드는 빠진 채로 계산되니
  //    이 숫자들은 "이 파일에 담긴 것" 기준이다.
  const sums = [];
  for(const t of DiaryTracks.all()){
    if(typeof t.summary !== 'function') continue;
    const entries = list.filter(ds => days[ds].t && days[ds].t[t.id])
      .map(ds => ({ ds, v: days[ds].t[t.id] }));
    if(!entries.length) continue;
    let rows = null;
    try{ rows = t.summary(entries); }catch(e){ console.warn('[share] 요약 실패:', t.id, e); }
    if(rows && rows.length) sums.push(`- **${t.name}** — ` + rows.map(r => `${r.k} ${r.v}`).join(' · '));
  }
  if(sums.length) L.push('## 요약 (이 파일에 담긴 것 기준)', '', ...sums, '');

  // ── 날짜별
  L.push('## 날짜별 기록', '');
  for(const ds of list){
    const pub = days[ds];
    L.push(`### ${ds} (${mdWeekday(ds)})`, '');
    for(const id in (pub.t || {})){
      const t = DiaryTracks.trackById(id);
      if(!t) continue;
      const v = pub.t[id];
      L.push(`- ${t.icon} **${t.name}**`);
      if(id === 'route'){
        mdRoute(v).forEach(line => L.push(`  - ${line}`));
        continue;
      }
      for(const k in v){
        const f = (t.fields || []).find(x => x.key === k);
        if(f && f.type === 'events'){ mdEvents(f, v[k]).forEach(line => L.push(line)); continue; }
        const txt = DiaryTracks.fieldText(f, v[k]);
        if(txt === '') continue;
        L.push(`  - ${f ? f.label : k}: ${txt}`);
      }
    }
    if(pub.note){
      L.push('- ✎ **일기**');
      String(pub.note).split('\n').forEach(line => L.push(`  > ${line}`));
    }
    L.push('');
  }
  return L.join('\n');
}

/**
 * 공개본에 쓰인 id들이 무슨 뜻인지 적은 사전.
 *
 * 저장은 id로 한다 — 'med:mmut7897a1btp'는 이름을 바꿔도 안 변하는 유일한
 * 이름이라 키로 쓰기에 맞다. 문제는 그 파일을 열어 본 사람(이나 AI)에게는
 * 아무 뜻이 없다는 것이다. 키는 그대로 두고 뜻을 따로 적는다.
 *
 * 실제로 나간 트랙·필드만 적는다. 안 내보내기로 한 트랙을 사전에 적어 두면
 * "이 사람이 그걸 기록하고 있다"는 사실이 새어 나간다.
 */
function legend(days){
  const used = {};                      // 트랙 id → 쓰인 칸 이름들
  const sub  = {};                      // 트랙 id → 칸 이름 → 그 안에 쓰인 칸들
  for(const ds in days){
    for(const id in (days[ds].t || {})){
      (used[id] || (used[id] = new Set()));
      const tv = days[ds].t[id];
      for(const k in tv){
        used[id].add(k);
        // 사건 목록 — 안쪽 칸 이름도 뜻을 적어 줘야 한다
        if(!Array.isArray(tv[k])) continue;
        tv[k].forEach(ev => {
          if(!ev || typeof ev !== 'object' || Array.isArray(ev)) return;
          const s = sub[id] || (sub[id] = {});
          const set = s[k] || (s[k] = new Set());
          Object.keys(ev).forEach(kk => set.add(kk));
        });
      }
    }
  }
  /** 칸 하나의 뜻 */
  const desc = f => {
    const d = { label: f.label };
    if(f.unit) d.unit = f.unit;
    if(f.type === 'bool' || f.type === 'photo' || f.type === 'tags') d.type = f.type;
    // 눈금은 숫자만 봐서는 못 읽는다 — 2가 뭔지 같이 적어 준다
    if(f.type === 'choice' && f.options){
      d.options = {};
      f.options.forEach(o => { d.options[o.v] = o.desc || o.name; });
    }
    return d;
  };
  const out = {};
  for(const id in used){
    const t = DiaryTracks.trackById(id);
    if(!t) continue;
    const e = { name: t.name, icon: t.icon };
    const fields = {};
    for(const k of used[id]){
      const f = (t.fields || []).find(x => x.key === k);
      if(!f){ fields[k] = { label: k }; continue; }
      const d = desc(f);
      if(f.type === 'events'){
        // 목록이지 한 값이 아니라는 걸 먼저 적는다. 길이가 곧 횟수다.
        d.type = 'events';
        d.note = `목록입니다. 칸 수가 그날 ${f.label} 횟수입니다.`;
        const keys = (sub[id] || {})[k];
        if(keys){
          d.each = {};
          for(const kk of keys){
            const sf = DiaryTracks.evField(f, kk);
            d.each[kk] = sf ? desc(sf) : { label: kk };
          }
        }
      }
      fields[k] = d;
    }
    if(Object.keys(fields).length) e.fields = fields;
    out[id] = e;
  }
  return out;
}

window.DiaryShare = {
  redactRoute, routeSummary, projectDay, previewShare, toMarkdown, mdEvents, legend,
  HOME_RADIUS, HOME_NAMES,
};
