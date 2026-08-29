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
    const v = {};
    for(const k of level.fields) if(val[k] !== undefined) v[k] = val[k];
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
      const ph = pub.t[id].photos;
      if(Array.isArray(ph)) out.photos += ph.length;
    }
  }
  return out;
}

window.DiaryShare = { redactRoute, routeSummary, projectDay, previewShare, HOME_RADIUS, HOME_NAMES };
