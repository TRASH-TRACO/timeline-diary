// ══════════════════════════════════════════
// 구글 타임라인 파서 — 반출 파일을 날짜별 경로로 바꾼다
// ══════════════════════════════════════════
//
// 구글이 지금까지 내놓은 반출 형식이 서로 많이 다르다. 네 가지를 모두 받는다.
//
//  A. 안드로이드 기기 반출 (2024~)  Timeline.json
//     { semanticSegments:[...], rawSignals:[...] }
//  B. iOS 기기 반출 (2024~)         location-history.json
//     [ {startTime,endTime,timelinePath|visit|activity}, ... ]   ← 최상위가 배열
//  C. 예전 Takeout 시맨틱 기록      Semantic Location History/2021/2021_JANUARY.json
//     { timelineObjects:[{placeVisit|activitySegment}, ...] }
//  D. 예전 Takeout 원시 기록        Records.json
//     { locations:[{latitudeE7,longitudeE7,timestamp}, ...] }
//
// 좌표 표기도 형식마다 다르다("geo:37.5,127.0" / "37.5665°, 126.9780°" /
// latitudeE7 / latE7 / {lat,lng}) — parseLatLng이 전부 흡수한다.

const MAX_PTS_PER_DAY = 300;   // 하루 경로 최대 점 수 (문서 크기 상한과 직결)
const MIN_STEP_M      = 12;    // 이만큼 못 움직였으면 같은 점으로 본다(GPS 떨림 제거)
const SIMPLIFY_EPS_M  = 18;    // 경로 단순화 허용 오차

// ── 좌표 파싱 ───────────────────────────────
function parseLatLng(v, depth){
  depth = depth || 0;
  if(v == null || depth > 3) return null;
  if(typeof v === 'string'){
    let s = v.trim();
    if(!s) return null;
    if(s.toLowerCase().startsWith('geo:')) s = s.slice(4);
    s = s.replace(/°/g, '');
    const p = s.split(/[,\s]+/).filter(Boolean).map(Number);
    return okLatLng(p[0], p[1]);
  }
  if(typeof v !== 'object') return null;
  if(v.latLng != null) return parseLatLng(v.latLng, depth + 1);
  if(v.LatLng != null) return parseLatLng(v.LatLng, depth + 1);
  if(v.latitudeE7  != null && v.longitudeE7 != null) return okLatLng(v.latitudeE7 / 1e7, v.longitudeE7 / 1e7);
  if(v.latE7       != null && v.lngE7       != null) return okLatLng(v.latE7 / 1e7, v.lngE7 / 1e7);
  if(v.latitude    != null && v.longitude   != null) return okLatLng(+v.latitude, +v.longitude);
  if(v.lat != null && (v.lng != null || v.lon != null)) return okLatLng(+v.lat, +(v.lng != null ? v.lng : v.lon));
  if(v.placeLocation != null) return parseLatLng(v.placeLocation, depth + 1);
  if(v.location     != null) return parseLatLng(v.location, depth + 1);
  if(v.point        != null) return parseLatLng(v.point, depth + 1);
  return null;
}
function okLatLng(a, o){
  if(!isFinite(a) || !isFinite(o)) return null;
  if(Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  if(a === 0 && o === 0) return null;             // 좌표 없음을 0,0으로 채운 레코드
  return [a, o];
}

// 장소 종류 라벨 — 새 형식의 semanticType, 예전 형식의 activityType 모두 커버
const SEMANTIC_LABEL = {
  HOME: '집', Home: '집', INFERRED_HOME: '집',
  WORK: '직장', Work: '직장', INFERRED_WORK: '직장',
  SEARCHED_ADDRESS: '검색한 주소', UNKNOWN: ''
};
const ACT_LABEL = {
  WALKING: '도보', ON_FOOT: '도보', RUNNING: '달리기', HIKING: '등산',
  IN_PASSENGER_VEHICLE: '자동차', DRIVING: '운전', IN_VEHICLE: '자동차',
  CYCLING: '자전거', IN_BUS: '버스', IN_TRAIN: '기차', IN_SUBWAY: '지하철',
  IN_TRAM: '트램', IN_FERRY: '배', FLYING: '비행기', MOTORCYCLING: '오토바이',
  walking: '도보', running: '달리기', cycling: '자전거', in_passenger_vehicle: '자동차',
  in_bus: '버스', in_train: '기차', in_subway: '지하철', flying: '비행기'
};
const actLabel = t => ACT_LABEL[t] || ACT_LABEL[String(t || '').toUpperCase()] || '';

// ── 수집기 ──────────────────────────────────
// 모든 형식을 같은 그릇에 담는다: 점(pts) · 방문(visits) · 이동(moves)
function newAcc(){ return { pts: [], visits: [], moves: [], seen: 0 }; }

// 점 하나 = [위도, 경도, ms, 날짜, 그 기록의 UTC 오프셋(분) 또는 null]
// 오프셋을 점에 같이 들고 다녀야 방문 기록이 없는 날도 현지 시각으로 표시된다.
function pushPt(acc, ll, ms, off){
  if(!ll || !isFinite(ms)) return;
  acc.pts.push([ll[0], ll[1], ms, dsAt(ms, off), off == null ? null : off]);
}

/** 파싱된 JSON 하나를 수집기에 붓는다. 어떤 형식이든 알아서 갈라 받는다. */
function ingest(json, acc){
  if(json == null) return;
  if(Array.isArray(json)){                                  // B. iOS
    json.forEach(seg => ingestSegment(seg, acc));
    return;
  }
  if(typeof json !== 'object') return;
  if(Array.isArray(json.semanticSegments)) json.semanticSegments.forEach(s => ingestSegment(s, acc));   // A
  if(Array.isArray(json.rawSignals))       json.rawSignals.forEach(r => ingestRawSignal(r, acc));       // A
  if(Array.isArray(json.timelineObjects))  json.timelineObjects.forEach(o => ingestLegacy(o, acc));     // C
  if(Array.isArray(json.locations))        json.locations.forEach(l => ingestRecord(l, acc));           // D
  // 세그먼트 하나만 담긴 파일도 있다
  if(json.timelinePath || json.visit || json.activity) ingestSegment(json, acc);
}

// ── A/B. 새 형식 세그먼트 ───────────────────
function ingestSegment(seg, acc){
  if(!seg || typeof seg !== 'object') return;
  acc.seen++;
  const st = tsInfo(seg.startTime), et = tsInfo(seg.endTime);
  // 오프셋: 문자열에 박힌 것 우선, 없으면 안드로이드가 따로 주는 필드
  let off = st && st.off != null ? st.off
          : (typeof seg.startTimeTimezoneUtcOffsetMinutes === 'number' ? seg.startTimeTimezoneUtcOffsetMinutes : null);
  const s = st ? st.ms : null, e = et ? et.ms : (st ? st.ms : null);

  // 이동 궤적
  if(Array.isArray(seg.timelinePath)){
    seg.timelinePath.forEach(p => {
      const ll = parseLatLng(p && p.point != null ? p.point : p);
      if(!ll) return;
      let ms = null;
      const pt = p && p.time != null ? tsInfo(p.time) : null;
      if(pt){ ms = pt.ms; if(off == null) off = pt.off; }
      else if(s != null && p && p.durationMinutesOffsetFromStartTime != null){
        ms = s + (+p.durationMinutesOffsetFromStartTime || 0) * 60000;
      }else if(s != null) ms = s;
      pushPt(acc, ll, ms, off);
    });
  }

  // 머문 장소
  if(seg.visit){
    const top = seg.visit.topCandidate || seg.visit;
    const ll = parseLatLng(top.placeLocation != null ? top.placeLocation : top);
    if(ll && s != null){
      acc.visits.push({
        lat: ll[0], lng: ll[1], s, e: e != null ? e : s, off,
        name: SEMANTIC_LABEL[top.semanticType] || '',
        ds: dsAt(s, off)
      });
      pushPt(acc, ll, s, off);
      if(e != null && e !== s) pushPt(acc, ll, e, off);
    }
  }

  // 이동 구간 (시작/끝만 있는 경우 — 궤적이 없어도 선은 이어진다)
  if(seg.activity){
    const a = seg.activity;
    const sl = parseLatLng(a.start), el = parseLatLng(a.end);
    if(sl && s != null) pushPt(acc, sl, s, off);
    if(el && e != null) pushPt(acc, el, e, off);
    const top = a.topCandidate || {};
    const d = +(a.distanceMeters != null ? a.distanceMeters : a.distance);
    if(s != null){
      acc.moves.push({ ds: dsAt(s, off), type: actLabel(top.type || a.activityType), dist: isFinite(d) ? d : 0 });
    }
  }
}

function ingestRawSignal(sig, acc){
  const pos = sig && (sig.position || sig.activityRecord);
  if(!pos) return;
  const ll = parseLatLng(pos);
  const t = tsInfo(pos.timestamp || pos.time);
  if(ll && t) pushPt(acc, ll, t.ms, t.off);
}

// ── C. 예전 시맨틱 기록 ─────────────────────
function ingestLegacy(o, acc){
  if(!o || typeof o !== 'object') return;
  acc.seen++;
  if(o.placeVisit)      ingestPlaceVisit(o.placeVisit, acc);
  if(o.activitySegment) ingestActivitySegment(o.activitySegment, acc);
}
function ingestPlaceVisit(pv, acc){
  const dur = pv.duration || {};
  const st = tsInfo(dur.startTimestamp || dur.startTimestampMs);
  const et = tsInfo(dur.endTimestamp   || dur.endTimestampMs);
  const ll = parseLatLng(pv.location);
  const off = st ? st.off : null;
  if(ll && st){
    const loc = pv.location || {};
    acc.visits.push({
      lat: ll[0], lng: ll[1], s: st.ms, e: et ? et.ms : st.ms, off,
      name: loc.name || loc.address || SEMANTIC_LABEL[loc.semanticType] || '',
      ds: dsAt(st.ms, off)
    });
    pushPt(acc, ll, st.ms, off);
    if(et) pushPt(acc, ll, et.ms, off);
  }
  if(Array.isArray(pv.childVisits)) pv.childVisits.forEach(c => ingestPlaceVisit(c, acc));
}
function ingestActivitySegment(as, acc){
  const dur = as.duration || {};
  const st = tsInfo(dur.startTimestamp || dur.startTimestampMs);
  const et = tsInfo(dur.endTimestamp   || dur.endTimestampMs);
  const off = st ? st.off : null;
  const s = st ? st.ms : null, e = et ? et.ms : s;
  const sl = parseLatLng(as.startLocation), el = parseLatLng(as.endLocation);
  if(sl && s != null) pushPt(acc, sl, s, off);

  // 시간이 붙은 원시 궤적이 있으면 그걸 쓰고, 없으면 웨이포인트를 시간으로 균등 배분한다
  const raw = as.simplifiedRawPath && as.simplifiedRawPath.points;
  if(Array.isArray(raw) && raw.length){
    raw.forEach(p => {
      const ll = parseLatLng(p);
      const t = tsInfo(p.timestamp || p.timestampMs);
      if(ll) pushPt(acc, ll, t ? t.ms : s, t ? t.off : off);
    });
  }else{
    const wps = (as.waypointPath && as.waypointPath.waypoints) || [];
    if(wps.length && s != null && e != null){
      wps.forEach((w, i) => {
        const ll = parseLatLng(w);
        if(ll) pushPt(acc, ll, s + (e - s) * (i + 1) / (wps.length + 1), off);
      });
    }
  }
  if(el && e != null) pushPt(acc, el, e, off);
  if(s != null){
    const d = +as.distance;
    acc.moves.push({ ds: dsAt(s, off), type: actLabel(as.activityType), dist: isFinite(d) ? d : 0 });
  }
}

// ── D. 원시 위치 기록 ───────────────────────
function ingestRecord(l, acc){
  if(!l) return;
  acc.seen++;
  const ll = parseLatLng(l);
  const t = tsInfo(l.timestamp || l.timestampMs);
  if(!ll || !t) return;
  if(typeof l.accuracy === 'number' && l.accuracy > 500) return;   // 오차 500m 넘는 신호는 버린다
  pushPt(acc, ll, t.ms, t.off);
}

// ── 경로 정리 ───────────────────────────────
/** 위경도 → 미터 평면(로컬 근사). 단순화·거리 계산용. */
function toMeters(pts){
  const lat0 = pts[0][0];
  const kx = 111320 * Math.cos(rad(lat0)), ky = 110540;
  return pts.map(p => [(p[1] - pts[0][1]) * kx, (p[0] - lat0) * ky]);
}
/** Douglas–Peucker 단순화 — 모양은 지키면서 점 수를 줄인다. */
function simplify(pts, eps){
  if(pts.length < 3) return pts;
  const m = toMeters(pts);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while(stack.length){
    const [a, b] = stack.pop();
    if(b - a < 2) continue;
    const [ax, ay] = m[a], [bx, by] = m[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1, fd = eps;
    for(let i = a + 1; i < b; i++){
      const [px, py] = m[i];
      let d;
      if(len2 === 0) d = Math.hypot(px - ax, py - ay);
      else{
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if(d > fd){ fd = d; far = i; }
    }
    if(far > 0){ keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * 하루치 점들을 경로 하나로 정리한다.
 * @returns {{points:Array, dist:number, s:number, e:number}|null}
 */
function buildRoute(dayPts){
  const pts = dayPts.slice().sort((a, b) => a[2] - b[2]);
  // 1) 떨림 제거 — 직전 점에서 MIN_STEP_M 이상 움직였을 때만 남긴다
  const kept = [];
  let dist = 0;
  for(const p of pts){
    if(!kept.length){ kept.push(p); continue; }
    const last = kept[kept.length - 1];
    const d = haversine(last[0], last[1], p[0], p[1]);
    if(d < MIN_STEP_M) continue;   // 같은 자리 — 먼저 찍힌 점의 시각을 유지한다
    dist += d;
    kept.push(p);
  }
  if(kept.length < 2) return kept.length ? { points: kept, dist: 0, s: kept[0][2], e: kept[0][2] } : null;

  // 2) 단순화 → 3) 그래도 많으면 균등 솎아내기 (양 끝은 반드시 남긴다)
  let out = simplify(kept, SIMPLIFY_EPS_M);
  if(out.length > MAX_PTS_PER_DAY){
    const step = out.length / MAX_PTS_PER_DAY;
    const thin = [];
    for(let i = 0; i < MAX_PTS_PER_DAY; i++) thin.push(out[Math.floor(i * step)]);
    if(thin[thin.length - 1] !== out[out.length - 1]) thin.push(out[out.length - 1]);
    out = thin;
  }
  return { points: out, dist, s: kept[0][2], e: kept[kept.length - 1][2] };
}

// ── 저장용 인코딩 ───────────────────────────
// 좌표·시각을 정수 델타로 편 뒤 쉼표로 이은 문자열 하나에 담는다.
//   p = "Δlat(1e-5),Δlng(1e-5),Δt(초), ..."
//
// 왜 배열이 아니라 문자열인가:
//  · Firestore는 배열 원소마다 색인 항목을 만들고, 문서당 색인 항목은 4만 개가 상한이다.
//    하루 300점이면 900개 — 한 달치를 한 문서에 담는 이 구조에선 상한에 바짝 붙는다.
//    문자열이면 색인 항목이 1개다.
//  · Firestore는 배열 안의 배열을 아예 못 담는다.
//  · 덤으로 용량도 준다(대괄호·공백이 사라진다).
function encodePoints(points){
  const out = [];
  let la = 0, ln = 0, t = 0;
  for(const pt of points){
    const a = Math.round(pt[0] * 1e5), o = Math.round(pt[1] * 1e5), sec = Math.round(pt[2] / 1000);
    out.push(a - la, o - ln, sec - t);
    la = a; ln = o; t = sec;
  }
  return out.join(',');
}
function encodeRoute(r, off){
  return { v: 2, p: encodePoints(r.points), d: Math.round(r.dist), s: r.s, e: r.e,
           tz: off == null ? null : off };
}
/**
 * 인코딩된 경로 → {points:[[lat,lng,ms]], dist, s, e, tz, breaks}
 * v1(숫자 배열)과 v2(문자열) 둘 다 읽는다 — 예전에 저장된 것도 그대로 열린다.
 *
 * breaks는 "이 점 앞에서 길이 끊겼다"는 인덱스 집합이다. 집 주변을 가린 경로처럼
 * 중간이 도려내진 경우에 쓴다. 이걸 무시하고 이어 그리면 잘라낸 자리를 가로지르는
 * 직선이 생겨서, 가린 지점이 도로 드러난다.
 */
function decodeRoute(enc){
  if(!enc) return null;
  const raw = typeof enc.p === 'string' ? (enc.p ? enc.p.split(',') : []) : enc.p;
  if(!Array.isArray(raw)) return null;
  const points = [];
  let la = 0, ln = 0, t = 0;
  for(let i = 0; i + 2 < raw.length; i += 3){
    la += +raw[i]; ln += +raw[i + 1]; t += +raw[i + 2];
    points.push([la / 1e5, ln / 1e5, t * 1000]);
  }
  if(!points.length) return null;
  return { points, dist: enc.d || 0, s: enc.s || points[0][2], e: enc.e || points[points.length - 1][2],
           tz: enc.tz == null ? null : enc.tz, visits: enc.v2 || [], moves: enc.m || [],
           breaks: new Set(Array.isArray(enc.b) ? enc.b : []) };
}

/**
 * 수집기 → 날짜별 저장 가능한 경로 맵.
 * @returns {Object<string, object>} 'YYYY-MM-DD' → 인코딩된 경로
 */
function accToDays(acc){
  const byDay = {};
  for(const p of acc.pts){
    (byDay[p[3]] || (byDay[p[3]] = [])).push(p);
  }
  // 그날의 시간대 — 점·방문 어느 쪽이든 먼저 나온 명시적 오프셋을 그날의 기준으로 삼는다
  const offByDay = {};
  for(const p of acc.pts){ if(p[4] != null && offByDay[p[3]] == null) offByDay[p[3]] = p[4]; }
  const visitsByDay = {}, movesByDay = {};
  acc.visits.forEach(v => {
    (visitsByDay[v.ds] || (visitsByDay[v.ds] = [])).push(v);
    if(v.off != null && offByDay[v.ds] == null) offByDay[v.ds] = v.off;
  });
  acc.moves.forEach(m => { (movesByDay[m.ds] || (movesByDay[m.ds] = [])).push(m); });

  const out = {};
  for(const ds in byDay){
    const r = buildRoute(byDay[ds]);
    if(!r) continue;
    const off = offByDay[ds] != null ? offByDay[ds] : null;   // null이면 브라우저 시간대로 표시된다
    const enc = encodeRoute(r, off);

    // 방문 장소 — 같은 자리 반복은 합치고, 오래 머문 순으로 최대 12곳
    const vs = (visitsByDay[ds] || []).slice().sort((a, b) => a.s - b.s);
    const merged = [];
    for(const v of vs){
      const last = merged[merged.length - 1];
      if(last && haversine(last.a / 1e5, last.o / 1e5, v.lat, v.lng) < 60){
        last.e = Math.max(last.e, v.e);
        if(!last.n && v.name) last.n = v.name;
        continue;
      }
      merged.push({ a: Math.round(v.lat * 1e5), o: Math.round(v.lng * 1e5), n: v.name || '', s: v.s, e: v.e });
    }
    enc.v2 = merged.sort((x, y) => (y.e - y.s) - (x.e - x.s)).slice(0, 12).sort((x, y) => x.s - y.s);

    // 이동 수단 요약 — 종류별 거리 합계
    const mm = {};
    (movesByDay[ds] || []).forEach(m => { if(m.type) mm[m.type] = (mm[m.type] || 0) + (m.dist || 0); });
    enc.m = Object.keys(mm).map(k => ({ t: k, d: Math.round(mm[k]) })).sort((x, y) => y.d - x.d).slice(0, 5);
    // 세그먼트가 알려준 이동거리 합이 더 정확하면(원시 점이 성길 때) 그쪽을 쓴다
    const segDist = Object.values(mm).reduce((a, b) => a + b, 0);
    if(segDist > enc.d) enc.d = Math.round(segDist);

    out[ds] = enc;
  }
  return out;
}

/**
 * 끊김을 반영해 이어진 구간들로 쪼갠다.
 * 끊긴 자리를 가로질러 그리면 가린 지점이 직선으로 드러나므로, 그리는 쪽은
 * 반드시 이걸 거쳐야 한다.
 */
function segmentsOf(points, breaks){
  if(!breaks || !breaks.size) return [points];
  const out = [];
  let cur = [];
  points.forEach((p, i) => {
    if(i && breaks.has(i)){ if(cur.length) out.push(cur); cur = []; }
    cur.push(p);
  });
  if(cur.length) out.push(cur);
  return out.filter(s => s.length);
}

window.DiaryTimeline = { newAcc, ingest, accToDays, decodeRoute, encodePoints, segmentsOf, parseLatLng, haversine };
