// ══════════════════════════════════════════
// 경로 비주얼라이저 — 하루의 이동을 SVG 한 장으로
// ══════════════════════════════════════════
//
// 색은 "시간"이라는 하나의 연속량을 나타내므로 단일 색상 램프(이른 시각 → 늦은 시각)
// 하나만 쓴다. 무지개로 칠하면 순서가 안 읽힌다. 시작·끝은 색만으로 구분하지 않고
// 글자('시작'/'끝')를 같이 붙인다.
// 밝은 화면은 옅은 색 → 진한 색, 어두운 화면은 어두운 색 → 밝은 색으로
// 각각 따로 고른다(자동 반전이 아니다).

// 밝은 배경(slate-50)에서는 너무 옅은 단계를, 어두운 배경(slate-950)에서는 너무 짙은 단계를
// 각각 빼고 시작한다 — 첫 구간이 배경에 묻히면 '언제 시작했는지'가 안 보인다.
const RAMP_LIGHT = ['#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46'];
const RAMP_DARK  = ['#047857', '#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0'];
const ramp = () => (currentTheme() === 'dark' ? RAMP_DARK : RAMP_LIGHT);

const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** 램프 위 t(0~1) 지점의 색 */
function rampAt(stops, t){
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/** 원본 인덱스 기준 끊김을 잘라낸 구간의 인덱스로 옮긴다 */
function shiftBreaks(breaks, from){
  if(!breaks || !breaks.size) return null;
  const out = new Set();
  breaks.forEach(i => { if(i > from) out.add(i - from); });
  return out.size ? out : null;
}

const MIN_SPAN_DEG = 0.0006;   // 하루 종일 한자리에 있었던 날도 지도가 성립하도록

/**
 * 위경도 → 화면 좌표. 위도에 따른 경도 축소를 반영하고 가로세로 비율을 지킨다.
 * 주어진 사각형(x0,y0,w,h) 안에 가운데 맞춤으로 넣는다 — 축척 막대나 라벨이 들어갈
 * 아래쪽 여백을 경로가 침범하지 않게 하려고 영역을 따로 받는다.
 */
function projector(points, x0, y0, w, h){
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for(const p of points){
    if(p[0] < minLat) minLat = p[0];
    if(p[0] > maxLat) maxLat = p[0];
    if(p[1] < minLng) minLng = p[1];
    if(p[1] > maxLng) maxLng = p[1];
  }
  const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
  const k = Math.max(0.05, Math.cos(rad(cLat)));
  const spanLat = Math.max(maxLat - minLat, MIN_SPAN_DEG);
  const spanLng = Math.max((maxLng - minLng) * k, MIN_SPAN_DEG * k);
  const s = Math.min(w / spanLng, h / spanLat);   // px per degree(위도 기준)
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const fn = p => [
    cx + (p[1] - cLng) * k * s,
    cy - (p[0] - cLat) * s
  ];
  fn.pxPerMeter = s / 110540;
  return fn;
}

const rnd = n => Math.round(n * 10) / 10;
/**
 * 점들을 path의 d로. breaks가 있으면 끊긴 자리에서 붓을 뗀다 —
 * 이어 그리면 집 주변을 도려낸 자리를 가로지르는 직선이 생겨 가린 의미가 없어진다.
 */
function polyD(pts, proj, breaks){
  let d = '';
  DiaryTimeline.segmentsOf(pts, breaks).forEach(seg => {
    seg.forEach((p, i) => { const [x, y] = proj(p); d += (i ? 'L' : 'M') + rnd(x) + ' ' + rnd(y); });
  });
  return d;
}

// 라벨 폭 어림 — 한글은 글자당 약 11px, ASCII는 약 6px (font-size 11 기준)
function estWidth(t){
  let w = 0;
  for(const ch of String(t)) w += ch.charCodeAt(0) > 0x2000 ? 11 : 6;
  return w;
}
const boxHit = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);

// ── 캘린더 셀용 썸네일 ──────────────────────
/** 작은 정사각 SVG 문자열. 셀마다 하루 모양이 보이게 하는 게 목적이라 장식은 없다. */
function thumbSVG(enc, size){
  const r = DiaryTimeline.decodeRoute(enc);
  if(!r) return '';
  const S = size || 46;
  let pts = r.points;
  let breaks = r.breaks;
  if(pts.length > 44){                       // 셀에선 40여 점이면 형태가 다 보인다
    // 솎아내면 인덱스가 밀린다. 끊김을 원본 인덱스 그대로 쓰면 엉뚱한 자리에서
    // 끊기고, 정작 가린 자리는 직선으로 이어져 집이 도로 드러난다.
    const step = pts.length / 44, thin = [], from = [];
    for(let i = 0; i < 44; i++){ const o = Math.floor(i * step); thin.push(pts[o]); from.push(o); }
    thin.push(pts[pts.length - 1]); from.push(pts.length - 1);
    if(breaks && breaks.size){
      const nb = new Set();
      for(let k = 1; k < from.length; k++){
        for(let o = from[k - 1] + 1; o <= from[k]; o++) if(breaks.has(o)){ nb.add(k); break; }
      }
      breaks = nb;
    }
    pts = thin;
  }
  const proj = projector(pts, 5, 5, S - 10, S - 10);
  if(pts.length < 2){
    const [x, y] = proj(pts[0]);
    return `<svg class="thumb" viewBox="0 0 ${S} ${S}" aria-hidden="true"><circle cx="${rnd(x)}" cy="${rnd(y)}" r="3"/></svg>`;
  }
  return `<svg class="thumb" viewBox="0 0 ${S} ${S}" aria-hidden="true"><path d="${polyD(pts, proj, breaks)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ── 축척 막대 ───────────────────────────────
const SCALE_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
function scaleBar(pxPerMeter, maxPx){
  let pick = SCALE_STEPS[0];
  for(const m of SCALE_STEPS){ if(m * pxPerMeter <= maxPx) pick = m; }
  return { meters: pick, px: pick * pxPerMeter, label: pick < 1000 ? pick + ' m' : (pick / 1000) + ' km' };
}

// ── 전체 비주얼라이저 ───────────────────────
const VW = 640, VH = 380;
const PAD_X = 30, PAD_TOP = 26, PAD_BOTTOM = 40;   // 아래쪽은 축척 막대·라벨 자리로 비워둔다

/**
 * 하루 경로를 컨테이너에 그린다.
 * @param el   대상 요소
 * @param enc  저장된(인코딩된) 경로
 * @param ds   'YYYY-MM-DD'
 */
function renderRoute(el, enc, ds){
  const r = DiaryTimeline.decodeRoute(enc);
  if(!r){ el.innerHTML = ''; return; }
  const pts = r.points, tz = r.tz;
  const proj = projector(pts, PAD_X, PAD_TOP, VW - 2 * PAD_X, VH - PAD_TOP - PAD_BOTTOM);
  const stops = ramp();
  const t0 = pts[0][2], t1 = pts[pts.length - 1][2], span = Math.max(1, t1 - t0);

  // 1) 시간대별로 묶어 색을 입힌다 — 점마다 선을 그리지 않고 구간 단위로 묶는다
  const B = Math.max(4, Math.min(24, Math.floor(pts.length / 3) || 4));
  const segs = [];
  let cur = [pts[0]], curB = 0, from = 0;
  for(let i = 1; i < pts.length; i++){
    const b = Math.min(B - 1, Math.floor((pts[i][2] - t0) / span * B));
    if(b !== curB){ cur.push(pts[i]); segs.push({ b: curB, pts: cur, from }); cur = [pts[i]]; curB = b; from = i; }
    else cur.push(pts[i]);
  }
  segs.push({ b: curB, pts: cur, from });

  let paths = '';
  // 바탕에 두꺼운 선을 한 번 깔아 배경 위에서 경로가 끊겨 보이지 않게 한다
  if(pts.length > 1) paths += `<path class="rv-halo" d="${polyD(pts, proj, r.breaks)}" fill="none"/>`;
  segs.forEach(sg => {
    if(sg.pts.length < 2) return;
    paths += `<path d="${polyD(sg.pts, proj, r.breaks && shiftBreaks(r.breaks, sg.from))}" fill="none" stroke="${rampAt(stops, B > 1 ? sg.b / (B - 1) : 1)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  });

  // 2) 축척 막대 자리를 먼저 잡아둔다 — 라벨이 이 위에 얹히지 않도록
  const sb = scaleBar(proj.pxPerMeter, VW * 0.28);
  const bx = 14, by = VH - 14;
  const scale =
    `<g class="rv-scale"><path d="M${bx} ${by - 4}V${by}H${rnd(bx + sb.px)}V${by - 4}"/>` +
    `<text x="${rnd(bx + sb.px + 6)}" y="${by}">${sb.label}</text></g>`;

  // 라벨 배치 — 후보 자리를 순서대로 시도하고, 다 겹치면 아예 적지 않는다.
  // (겹쳐서 못 읽는 라벨보다 없는 편이 낫다. 정보는 아래 '머문 곳' 목록에도 있다)
  const taken = [{ x: bx - 4, y: by - 18, w: sb.px + estWidth(sb.label) + 16, h: 24 }];
  function placeLabel(x, y, text, cls){
    const w = estWidth(text);
    for(const [dx, dy] of [[0, -13], [0, 19], [0, -27], [0, 33]]){
      const lx = Math.max(w / 2 + 6, Math.min(VW - w / 2 - 6, x + dx));
      const ly = y + dy;
      if(ly < 14 || ly > VH - 6) continue;
      const box = { x: lx - w / 2, y: ly - 11, w, h: 15 };
      if(taken.some(b => boxHit(b, box))) continue;
      taken.push(box);
      return `<text class="rv-label${cls ? ' ' + cls : ''}" x="${rnd(lx)}" y="${rnd(ly)}" text-anchor="middle">${escapeHtml(text)}</text>`;
    }
    return '';
  }

  // 3) 머문 장소 — 오래 머물수록 크게
  const visits = (r.visits || []).map(v => ({ ...v, lat: v.a / 1e5, lng: v.o / 1e5, dur: Math.max(0, v.e - v.s) }));
  const maxDur = visits.reduce((m, v) => Math.max(m, v.dur), 0) || 1;
  let marks = '';
  visits.forEach(v => {
    const [x, y] = proj([v.lat, v.lng]);
    const rr = 4 + 5 * Math.sqrt(v.dur / maxDur);
    marks += `<circle class="rv-visit" cx="${rnd(x)}" cy="${rnd(y)}" r="${rnd(rr)}"><title>${escapeHtml((v.n ? v.n + ' · ' : '') + hmAt(v.s, tz) + '~' + hmAt(v.e, tz))}</title></circle>`;
  });
  /** 이 지점에 걸쳐 있는 장소 이름 (시작·끝 라벨에 합쳐 쓰려고) */
  function visitAt(x, y){
    for(const v of visits){
      if(!v.n) continue;
      const [vx, vy] = proj([v.lat, v.lng]);
      if(Math.hypot(vx - x, vy - y) < 14) return v;
    }
    return null;
  }

  // 4) 시작·끝 — 색이 아니라 글자로 구분한다. 가장 중요한 라벨이라 자리를 먼저 차지한다.
  const [sx, sy] = proj(pts[0]), [ex, ey] = proj(pts[pts.length - 1]);
  const sameSpot = Math.hypot(ex - sx, ey - sy) < 14;
  const vS = visitAt(sx, sy), vE = visitAt(ex, ey);
  const named = new Set([vS, vE].filter(Boolean));
  let ends =
    `<circle class="rv-end" cx="${rnd(sx)}" cy="${rnd(sy)}" r="6" style="fill:${rampAt(stops, 0)}"/>` +
    `<circle class="rv-end" cx="${rnd(ex)}" cy="${rnd(ey)}" r="6" style="fill:${rampAt(stops, 1)}"/>`;
  if(pts.length === 1 || (sameSpot && t1 - t0 < 60000)){
    // 하루 종일 한자리 — '시작/끝'을 따로 적으면 같은 말을 두 번 하는 셈이다
    ends += placeLabel(sx, sy, (vS && vS.n ? vS.n + ' ' : '') + hmAt(t0, tz), 'strong');
  }else{
    ends += placeLabel(sx, sy, '시작 ' + hmAt(t0, tz) + (vS ? ' · ' + vS.n : ''), 'strong');
    ends += placeLabel(ex, ey, (sameSpot ? '돌아옴 ' : '끝 ') + hmAt(t1, tz) + (vE && vE !== vS ? ' · ' + vE.n : ''), 'strong');
  }

  // 5) 장소 이름 — 시작·끝 라벨에 이미 적힌 곳은 빼고, 오래 머문 3곳만
  visits.slice().sort((a, b) => b.dur - a.dur).filter(v => v.n && !named.has(v)).slice(0, 3).forEach(v => {
    const [x, y] = proj([v.lat, v.lng]);
    marks += placeLabel(x, y, v.n);
  });

  // 6) 커서(스크럽) — 처음엔 하루의 마지막 위치
  const cursor = `<g class="rv-cursor"><circle r="7"/><circle r="3.5"/></g>`;

  const svg =
    `<svg viewBox="0 0 ${VW} ${VH}" class="rv-svg" role="img" ` +
    `aria-label="${escapeHtml(ds || '')} 이동 경로, 총 ${fmtDist(r.dist)}">` +
    `<rect class="rv-bg" x="0" y="0" width="${VW}" height="${VH}"/>${paths}${marks}${ends}${scale}${cursor}</svg>`;

  const gradId = 'g' + Math.random().toString(36).slice(2, 8);
  const legendStops = stops.map((c, i) => `<stop offset="${(i / (stops.length - 1) * 100).toFixed(0)}%" stop-color="${c}"/>`).join('');
  const legend =
    `<div class="rv-legend">` +
      `<span class="rv-legend-cap">이른 시각</span>` +
      `<svg class="rv-legend-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">` +
        `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">${legendStops}</linearGradient></defs>` +
        `<rect x="0" y="0" width="100" height="8" rx="4" fill="url(#${gradId})"/></svg>` +
      `<span class="rv-legend-cap">늦은 시각</span>` +
    `</div>`;

  const moves = (r.moves || []).filter(m => m.d > 0)
    .map(m => `<span class="rv-move">${escapeHtml(m.t)} <b>${fmtDist(m.d)}</b></span>`).join('');

  const statRow =
    `<div class="rv-stats">` +
      `<div class="rv-stat"><span class="rv-stat-k">이동 거리</span><span class="rv-stat-v">${fmtDist(r.dist)}</span></div>` +
      `<div class="rv-stat"><span class="rv-stat-k">기록 구간</span><span class="rv-stat-v">${hmAt(t0, tz)} – ${hmAt(t1, tz)}</span></div>` +
      `<div class="rv-stat"><span class="rv-stat-k">밖에 있던 시간</span><span class="rv-stat-v">${fmtDur(t1 - t0)}</span></div>` +
      `<div class="rv-stat"><span class="rv-stat-k">머문 곳</span><span class="rv-stat-v">${fmtNum(visits.length)}곳</span></div>` +
    `</div>` + (moves ? `<div class="rv-moves">${moves}</div>` : '');

  el.innerHTML =
    `<div class="rv">` +
      `<div class="rv-map">${svg}<div class="rv-tip" hidden></div></div>` +
      `<div class="rv-scrub-row">` +
        `<input class="rv-scrub" type="range" min="0" max="${pts.length - 1}" value="${pts.length - 1}" step="1" aria-label="하루 시간대 훑어보기">` +
        `<span class="rv-scrub-t">${hmAt(t1, tz)}</span>` +
      `</div>` +
      legend + statRow +
    `</div>`;

  // ── 상호작용 ──
  const svgEl = el.querySelector('.rv-svg');
  const cur2  = el.querySelector('.rv-cursor');
  const tip   = el.querySelector('.rv-tip');
  const slider= el.querySelector('.rv-scrub');
  const tLbl  = el.querySelector('.rv-scrub-t');
  const mapEl = el.querySelector('.rv-map');

  function setCursor(i, showTip){
    i = Math.max(0, Math.min(pts.length - 1, i | 0));
    const p = pts[i], [x, y] = proj(p);
    cur2.setAttribute('transform', `translate(${rnd(x)} ${rnd(y)})`);
    cur2.style.color = rampAt(stops, (p[2] - t0) / span);
    tLbl.textContent = hmAt(p[2], tz);
    if(slider.value !== String(i)) slider.value = String(i);
    if(showTip){
      const box = mapEl.getBoundingClientRect();
      tip.hidden = false;
      tip.textContent = hmAt(p[2], tz);
      tip.style.left = (x / VW * box.width) + 'px';
      tip.style.top  = (y / VH * box.height) + 'px';
    }
  }
  setCursor(pts.length - 1, false);

  slider.addEventListener('input', () => setCursor(+slider.value, false));

  // 지도 위에서 마우스를 움직이면 가장 가까운 기록 지점으로 붙는다
  function nearest(evt){
    const box = svgEl.getBoundingClientRect();
    const mx = (evt.clientX - box.left) / box.width * VW;
    const my = (evt.clientY - box.top) / box.height * VH;
    let best = 0, bd = Infinity;
    for(let i = 0; i < pts.length; i++){
      const [x, y] = proj(pts[i]);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if(d < bd){ bd = d; best = i; }
    }
    return best;
  }
  svgEl.addEventListener('pointermove', e => { if(e.pointerType === 'mouse') setCursor(nearest(e), true); });
  svgEl.addEventListener('pointerleave', () => { tip.hidden = true; });
  svgEl.addEventListener('pointerdown', e => { setCursor(nearest(e), true); });

  return { visits };
}

window.DiaryViz = { thumbSVG, renderRoute };
