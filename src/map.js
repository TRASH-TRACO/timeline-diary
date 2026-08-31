// ══════════════════════════════════════════
// 지도 재생기 — 하루의 이동을 지도 위에서 애니메이션으로
// ══════════════════════════════════════════
//
// 이 파일은 "무엇을 어떻게 보여줄지"만 안다. 지도 자체를 다루는 일(배율·표식·이벤트)은
// src/map/ 아래 어댑터가 맡는다. 덕분에 배경지도를 Leaflet에서 카카오맵으로 갈아끼워도
// 재생 타임라인과 자동 카메라 — 이 앱에서 정작 까다로운 부분 — 는 그대로다.

import { createAdapter } from './map/index.js';

// 하루 전체를 몇 초에 재생할지 (배속 1× 기준). 실제 24시간을 그대로 틀 수는 없다.
const BASE_MS = 24000;
const SPEEDS = [1, 2, 4, 8];
// 한자리에 오래 머문 구간은 이만큼까지만 재생 시간을 준다 — 안 그러면 화면이 멈춘 것처럼 보인다.
const STILL_CAP_RATIO = 0.04;

// 자동 카메라 — 하루 전체에 배율을 고정하면 여행 간 날은 도착지에서 걸어다닌 게
// 점 하나로 뭉개진다. 재생 지점 앞뒤 구간만 화면에 담아 배율을 따라 바꾼다.
// KTX로 이동 중이면 알아서 넓어지고, 골목을 걸으면 좁아진다.
// 창의 크기는 "기록된 점"이 아니라 재생 진행도 기준이다. 긴 직선 구간(KTX·비행기)은
// 경로 단순화 때 점 두 개로 줄어들어서, 시간 창으로 주변 점을 모으면 그 사이에선
// 볼 게 없어져 최대 배율로 확대돼 버린다. 재생될 경로를 직접 샘플링하면 그 문제가 없다.
const CAM_SPAN = 0.05;              // 재생 진행도 앞뒤 5%
const CAM_SAMPLES = 24;
const CAM_PAD = 0.25;               // 화면에 담을 때 사방 여유
// 한 단계 차이로는 배율을 바꾸지 않는다. 그 정도로 따라가면 화면이 계속 들썩이고,
// 어차피 두 단계 이상 벌어져야 "안 보인다"는 느낌이 든다.
// 덕분에 실제로 일어나는 배율 변화는 전부 두 단계 이상 = 전부 flyTo로 간다.
const CAM_ZOOM_STEP = 1.5;
const CAM_INTERVAL_MS = 600;        // 카메라 점검 주기
// 배율은 이 간격 안에 두 번 바꾸지 않는다. 600ms마다 한 단계씩 따라가면
// 9초에 여섯 번씩 바뀌어 화면이 계속 들썩인다.
const ZOOM_COOLDOWN_MS = 1400;


const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * 재생기를 연다.
 * @param {HTMLElement} el   그릴 자리
 * @param {object} enc       저장된 경로
 * @param {string} ds        'YYYY-MM-DD'
 * @returns {{destroy:Function}}
 */
async function open(el, enc, ds){
  const r = DiaryTimeline.decodeRoute(enc);
  if(!r){ el.innerHTML = ''; return { destroy(){} }; }
  const pts = r.points, tz = r.tz;
  const t0 = pts[0][2], t1 = pts[pts.length - 1][2];

  // ── 재생 타임라인 ──
  // 구간마다 "실제 걸린 시간"을 재생 가중치로 쓰되, 오래 머문 구간은 눌러서
  // 지루하지 않게 한다. 시각 표시는 눌리기 전의 진짜 시각을 쓴다.
  const n = pts.length;
  const cap = Math.max(60000, (t1 - t0) * STILL_CAP_RATIO);
  const w = [], cum = [0];
  let dist = [0];
  for(let i = 1; i < n; i++){
    w.push(Math.max(1, Math.min(pts[i][2] - pts[i - 1][2], cap)));
    cum.push(cum[i - 1] + w[i - 1]);
    dist.push(dist[i - 1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  const totalW = cum[n - 1] || 1;
  // 재생 중 누적 거리는 단순화된 점들로 계산되므로 '전체 이동 거리'와 조금 어긋난다.
  // 같은 값을 두 숫자로 보여주면 혼란스러우니, 끝에서 전체와 맞도록 비례 보정한다.
  if(r.dist > 0 && dist[n - 1] > 0){
    const k = r.dist / dist[n - 1];
    dist = dist.map(d => d * k);
  }

  /** 재생 진행도(0~1) → {lat, lng, ms, dist} */
  function at(p){
    if(n === 1) return { lat: pts[0][0], lng: pts[0][1], ms: t0, dist: 0 };
    const target = clamp(p, 0, 1) * totalW;
    let lo = 0, hi = n - 1;
    while(lo < hi - 1){ const mid = (lo + hi) >> 1; if(cum[mid] <= target) lo = mid; else hi = mid; }
    const f = w[lo] ? clamp((target - cum[lo]) / w[lo], 0, 1) : 0;
    const a = pts[lo], b = pts[lo + 1] || a;
    return {
      i: lo, f,
      lat: a[0] + (b[0] - a[0]) * f,
      lng: a[1] + (b[1] - a[1]) * f,
      ms:  a[2] + (b[2] - a[2]) * f,
      dist: dist[lo] + (dist[lo + 1] - dist[lo]) * f,
    };
  }

  // ── 화면 ──
  el.innerHTML =
    `<div class="mp">` +
      `<div class="mp-map"></div>` +
      `<div class="mp-ctl">` +
        `<button class="mp-btn mp-play" type="button" aria-label="재생">▶ 재생</button>` +
        `<input class="mp-scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="시간대 훑어보기">` +
        `<span class="mp-time">${escapeHtml(hmAt(t0, tz))}</span>` +
        `<button class="mp-btn mp-speed" type="button" title="재생 속도">1×</button>` +
        `<button class="mp-btn mp-follow on" type="button" title="재생 지점을 따라다니며 배율도 자동으로 맞춥니다">따라가기</button>` +
        `<button class="mp-btn mp-whole" type="button" title="하루 전체가 보이게 맞춥니다">전체</button>` +
      `</div>` +
      `<div class="mp-read">` +
        `<span>이동 <b class="mp-dist">0 m</b></span>` +
        `<span>전체 <b>${escapeHtml(fmtDist(r.dist))}</b></span>` +
        `<span>${escapeHtml(hmAt(t0, tz))} – ${escapeHtml(hmAt(t1, tz))}</span>` +
      `</div>` +
    `</div>`;

  const mapEl  = el.querySelector('.mp-map');
  const playBtn= el.querySelector('.mp-play');
  const scrub  = el.querySelector('.mp-scrub');
  const timeEl = el.querySelector('.mp-time');
  const speedBtn = el.querySelector('.mp-speed');
  const followBtn= el.querySelector('.mp-follow');
  const wholeBtn = el.querySelector('.mp-whole');
  const distEl = el.querySelector('.mp-dist');

  const { adapter: map, fellBack } = await createAdapter(mapEl);
  if(fellBack) showToast('카카오맵을 쓰지 못해 기본 지도로 표시합니다');

  const latlngs = pts.map(q => [q[0], q[1]]);
  map.fitBounds(latlngs, 28);

  // 아직 안 지나간 길은 옅게 깔아 두고, 지나간 만큼 진하게 덧그린다.
  // 끊긴 자리(집 주변을 도려낸 곳)는 이어 그리지 않는다 — 이어 버리면
  // 잘라낸 지점을 가로지르는 직선이 생겨서 가린 의미가 없어진다.
  DiaryTimeline.segmentsOf(pts, r.breaks).forEach(seg =>
    map.line(seg.map(q => [q[0], q[1]]), { cls: 'mp-base', color: '#94a3b8', weight: 3, opacity: 0.45 }));
  const trail = map.line([latlngs[0]], { cls: 'mp-trail', color: '#10b981', weight: 5, opacity: 0.95 });
  /** 지금 위치까지 지나온 길 — 끊긴 자리 이후만 (그 앞은 이미 깔린 밑선으로 보인다) */
  function trailPath(i, ll){
    let from = 0;
    if(r.breaks && r.breaks.size) r.breaks.forEach(b => { if(b <= i && b > from) from = b; });
    return latlngs.slice(from, i + 1).concat([ll]);
  }

  // 머문 곳
  (r.visits || []).forEach(v => {
    map.visit([v.a / 1e5, v.o / 1e5],
      { cls: 'mp-visit', radius: 6, stroke: '#0f766e', weight: 2, fill: '#ffffff' },
      `<b>${escapeHtml(v.n || '머문 곳')}</b><br>${escapeHtml(hmAt(v.s, tz))} – ${escapeHtml(hmAt(v.e, tz))}<br>${escapeHtml(fmtDur(v.e - v.s))}`);
  });
  // 시작·끝은 색이 아니라 글자로 구분한다
  map.label(latlngs[0],     escapeHtml('시작 ' + hmAt(t0, tz)), 'start');
  map.label(latlngs[n - 1], escapeHtml('끝 ' + hmAt(t1, tz)),   'end');

  const dot = map.dot(latlngs[0],
    { cls: 'mp-dot', radius: 8, stroke: '#ffffff', weight: 3, fill: '#059669', front: true });

  // ── 상태 ──
  let p = 0, playing = false, speedIdx = 0, follow = true, raf = null, last = 0;
  let lastCam = 0, lastZoomAt = 0, settle = null, initTimer = null, destroyed = false;
  // 지도가 확대/축소 애니메이션 중인가.
  // 그 동안에는 지도 위 요소(경로·마커)를 건드리면 안 된다 — 아래 render() 참고.
  let zooming = false;
  // 카메라가 움직이는 중임을 "언제까지"로 관리한다. moveend/zoomend로 플래그를
  // 내리면 직전 동작의 moveend가 새 비행 직후에 도착해 플래그를 지워버리고,
  // 그 틈에 panTo가 끼어들어 비행을 중간에서 잘라 먹는다(z15→z8이 z9에서 끊겼다).
  // 우리가 요청한 시간은 우리가 알고 있으니 이벤트에 기대지 않는다.
  let busyUntil = 0;
  const isBusy = () => performance.now() < busyUntil;
  // 비행 중에는 배율이 소수(예: 9.4)로 돌아온다. 그대로 비교하면 델타가 어중간하게
  // 잡혀 판단이 흔들리므로 반올림해서 본다.
  const curZoom = () => Math.round(map.zoom());

  /** 지금 재생 지점 앞뒤로 곧 지나갈/방금 지나온 구간 */
  function windowPath(cur){
    const a = clamp(p - CAM_SPAN, 0, 1), b = clamp(p + CAM_SPAN, 0, 1);
    const lls = [[cur.lat, cur.lng]];
    for(let i = 0; i <= CAM_SAMPLES; i++){
      const s = at(a + (b - a) * i / CAM_SAMPLES);
      lls.push([s.lat, s.lng]);
    }
    return lls;
  }

  /**
   * 배율을 바꿔 옮긴다.
   * 두 단계 이상 벌어지면 flyTo로 간다 — Leaflet의 setView는 zoomAnimationThreshold
   * (기본 4)를 넘는 변화를 아예 애니메이션하지 않고 순간이동시켜서, 여행 간 날
   * z15→z7 같은 변화가 정확히 거기 걸려 뚝 끊겼다.
   */
  function applyView(ll, z, instant){
    if(instant){ map.setView(ll, z); return; }
    // 배율이 바뀔 땐 언제나 flyTo(어댑터의 '애니메이션 이동')를 쓴다.
    // Leaflet의 setView 애니메이션은 CSS 전환이라
    //  · zoomAnimationThreshold(기본 4)를 넘으면 아예 애니메이션하지 않고 순간이동하고
    //  · 전환이 끝날 때 도는 콜백이 지도가 사라진 뒤에 터진다.
    const delta = Math.abs(z - curZoom());
    const dur = clamp(0.6 + delta * 0.09, 0.6, 1.5);   // 초
    busyUntil = performance.now() + dur * 1000 + 80;   // 끝날 때까지 새 목적지를 받지 않는다
    map.flyTo(ll, z, dur);
  }

  /** 자동 카메라 — 이동은 매 프레임 중앙 고정, 배율은 가끔만 */
  function moveCamera(cur, force){
    if(destroyed || !follow) return;
    // 움직이는 중엔 새 목적지를 주지 않는다. 다만 재생 시작·스크럽 정착처럼
    // 사용자가 방금 시킨 일(force)은 기다리게 두면 안 된다.
    if(!force && isBusy()) return;
    const ll = [cur.lat, cur.lng];
    const now = performance.now();
    if(force || (now - lastCam > CAM_INTERVAL_MS && now - lastZoomAt > ZOOM_COOLDOWN_MS)){
      lastCam = now;
      const z = map.fitZoom(windowPath(cur), CAM_PAD);
      const delta = Math.abs(z - curZoom());
      if(force || delta >= CAM_ZOOM_STEP){
        lastZoomAt = now;
        applyView(ll, Math.round(z), force === 'instant');
        return;
      }
    }
    // 배율은 그대로 두고 마커를 늘 화면 한가운데 붙들어 둔다.
    // 예전엔 마커가 가장자리(가운데 60%)를 벗어날 때만 중앙으로 되돌렸는데,
    // 그러면 0.5초마다 화면이 툭 튀어 흔들리는 느낌이 났다. 매 프레임 조금씩
    // 흘리면 튀는 순간 자체가 없다 — 내비게이션이 쓰는 방식이다.
    map.panTo(ll);
  }

  function render(opts){
    if(destroyed) return;
    const s = at(p);
    const ll = [s.lat, s.lng];
    timeEl.textContent = hmAt(s.ms, tz);
    distEl.textContent = fmtDist(s.dist);
    scrub.value = String(Math.round(p * 1000));

    // 확대·축소가 도는 동안에는 지도 위 요소를 다시 그리지 않는다.
    //
    // 지도는 확대할 때 그리기 컨테이너에 변환을 걸어 그 안의 경로를 통째로 키운다.
    // 그래서 손대지 않은 밑선은 지도와 함께 매끄럽게 커진다. 그런데 그 사이에
    // 경로를 다시 쓰면 좌표가 "변환 이전" 기준으로 계산되어, 걸려 있는 변환과
    // 어긋나 지도에서 떨어져 나온다 — 지도만 확대되고 경로는 안 따라오는 것처럼 보인다.
    // (재보면 확대 한 번에 밑선은 2번, 다시 쓰던 경로는 74번 갱신됐다)
    // 확대가 끝나면 onZoomEnd에서 한 번 맞춘다.
    if(!zooming){
      dot.setPosition(ll);
      trail.setPath(trailPath(s.i || 0, ll));   // 끊김을 지켜 마지막 이어진 구간만
    }
    if(opts && opts.camera) moveCamera(s, opts.force);
  }

  // 사용자가 직접 지도를 움직이면 따라가기를 끈다 — 보려는 곳을 뺏으면 안 된다.
  //
  // movestart/zoomstart로 잡으면 안 된다. 그건 우리 카메라가 움직일 때도 똑같이 나서,
  // "방금 우리가 움직였나" 하는 플래그로 걸러야 하는데 — 재생 중엔 카메라가 600ms마다
  // 움직이므로 그 플래그가 늘 켜져 있어 정작 사용자 조작이 통째로 무시된다.
  // 그래서 사용자 제스처만 콕 집어 듣는다. 애매할 일이 없다.
  function userTookOver(){
    if(!follow) return;
    follow = false;
    busyUntil = 0;
    map.stop();                       // 날아가던 중이면 그 자리에서 멈춰 사용자에게 넘긴다
    followBtn.classList.remove('on');
  }
  map.onZoomStart(() => { zooming = true; });
  // 확대가 끝나는 순간 지도가 소수 배율을 정수로 스냅하면서 투영이 바뀐다.
  // 다음 프레임을 기다리면 그 한 프레임이 화면에서 168px 튄다. 여기서 바로 잡는다.
  map.onZoomEnd(() => {
    zooming = false;
    if(destroyed) return;
    if(follow) map.panTo([at(p).lat, at(p).lng]);
    render();                       // 확대 중 미뤄둔 경로·마커를 여기서 맞춘다
  });
  map.onUserGesture(userTookOver);

  function tick(now){
    if(!playing) return;
    if(!last) last = now;
    const dt = now - last;
    last = now;
    // 배율이 바뀌는 동안에는 시간을 흘리지 않는다 — 마커를 세워두고 카메라만 옮긴다.
    // 확대와 이동이 겹치면 무엇이 움직이는지 읽기 어렵다.
    // (지도는 flyTo가 스스로 몰고 있으므로 여기서 아무것도 안 해도 진행된다)
    if(follow && isBusy()){
      render();
      raf = requestAnimationFrame(tick);
      return;
    }
    p += dt / (BASE_MS / SPEEDS[speedIdx]);
    if(p >= 1){ p = 1; render({ camera: true }); stop(true); return; }
    render({ camera: true });
    raf = requestAnimationFrame(tick);
  }
  function play(){
    if(p >= 1) p = 0;                    // 끝났으면 처음부터
    playing = true; last = 0;
    playBtn.textContent = '❚❚ 일시정지';
    playBtn.setAttribute('aria-label', '일시정지');
    render({ camera: true, force: true });   // 시작하자마자 그 지점 배율로 들어간다
    raf = requestAnimationFrame(tick);
  }
  function stop(ended){
    playing = false;
    cancelAnimationFrame(raf);
    playBtn.textContent = ended ? '↺ 다시 재생' : '▶ 재생';
    playBtn.setAttribute('aria-label', ended ? '다시 재생' : '재생');
  }

  playBtn.addEventListener('click', () => (playing ? stop(false) : play()));
  scrub.addEventListener('input', () => {
    if(playing) stop(false);
    p = +scrub.value / 1000;
    render({ camera: true });
    // 끌고 있는 동안 배율이 계속 바뀌면 어지럽다. 손을 뗀 뒤에 그 지점 배율로 정착시킨다.
    clearTimeout(settle);
    settle = setTimeout(() => render({ camera: true, force: true }), 260);
  });
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speedBtn.textContent = SPEEDS[speedIdx] + '×';
  });
  followBtn.addEventListener('click', () => {
    follow = !follow;
    followBtn.classList.toggle('on', follow);
    if(follow) render({ camera: true, force: true });
  });
  // 하루 전체를 다시 보고 싶을 때
  wholeBtn.addEventListener('click', () => {
    follow = false;
    busyUntil = 0;
    followBtn.classList.remove('on');
    map.stop();
    map.flyToBounds(latlngs, 28, 0.8);
  });

  // 컨테이너가 자리를 잡은 뒤에 크기를 다시 재야 타일이 어긋나지 않는다
  const ro = new ResizeObserver(() => { if(!destroyed) map.relayout(); });
  ro.observe(mapEl);
  initTimer = setTimeout(() => {
    if(destroyed) return;
    map.relayout();
    map.fitBounds(latlngs, 28);
  }, 60);

  render({ camera: true, force: 'instant' });   // 첫 자리잡기만 즉시

  const ctl = {
    map,                       // 지도 어댑터 — 바깥에서 손댈 일이 있으면 여기로
    provider: map.name,
    destroy(){
      // 순서가 중요하다. 날아가던 애니메이션이나 예약된 콜백이 지도가 사라진 뒤에
      // 돌면 Leaflet 내부에서 '_leaflet_pos' 오류가 난다 (날짜를 빠르게 넘길 때 났다).
      destroyed = true;
      stop(false);
      clearTimeout(settle);
      clearTimeout(initTimer);
      ro.disconnect();
      map.stop();                       // 진행 중인 애니메이션 중단
      map.destroy();
      el.innerHTML = '';
      if(window.DiaryMap.current === ctl) window.DiaryMap.current = null;
    }
  };
  window.DiaryMap.current = ctl;    // 지금 열려 있는 재생기
  return ctl;
}

window.DiaryMap = { open, current: null };
// 모듈은 classic script보다 늦게 실행되므로, 준비됐다고 알려준다
if(typeof window.onMapReady === 'function') window.onMapReady();
