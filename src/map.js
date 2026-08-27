// ══════════════════════════════════════════
// 지도 재생기 — 하루의 이동을 지도 위에서 애니메이션으로
// ══════════════════════════════════════════
//
// 기본 배경지도는 OpenStreetMap이다. 키가 필요 없어 설정 없이 바로 돌아간다.
// 카카오맵·네이버맵으로 갈아탈 자리는 TILE 하나로 모아두었다 — 그쪽은 키 발급과
// 도메인 등록이 필요하고 SDK도 Leaflet이 아니라서, 바꿀 때는 이 파일만 손대면 된다.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 기여자',
  maxZoom: 19,
};

// 하루 전체를 몇 초에 재생할지 (배속 1× 기준). 실제 24시간을 그대로 틀 수는 없다.
const BASE_MS = 24000;
const SPEEDS = [1, 2, 4, 8];
// 한자리에 오래 머문 구간은 이만큼까지만 재생 시간을 준다 — 안 그러면 화면이 멈춘 것처럼 보인다.
const STILL_CAP_RATIO = 0.04;

// 자동 카메라 — 하루 전체에 배율을 고정하면 여행 간 날은 도착지에서 걸어다닌 게
// 점 하나로 뭉개진다. 재생 지점 앞뒤 CAM_WINDOW_MS 동안의 움직임만 화면에 담아
// 배율을 따라 바꾼다. KTX로 이동 중이면 알아서 넓어지고, 골목을 걸으면 좁아진다.
// 창의 크기는 "기록된 점"이 아니라 재생 진행도 기준이다. 긴 직선 구간(KTX·비행기)은
// 경로 단순화 때 점 두 개로 줄어들어서, 시간 창으로 주변 점을 모으면 그 사이에선
// 볼 게 없어져 최대 배율로 확대돼 버린다. 재생될 경로를 직접 샘플링하면 그 문제가 없다.
const CAM_SPAN = 0.05;              // 재생 진행도 앞뒤 5%
const CAM_SAMPLES = 24;
const CAM_MIN_ZOOM = 3, CAM_MAX_ZOOM = 17;
const CAM_ZOOM_STEP = 0.8;          // 이만큼 차이 나야 배율을 바꾼다 (덜덜 떠는 것 방지)
const CAM_INTERVAL_MS = 600;        // 배율 재계산 주기

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * 재생기를 연다.
 * @param {HTMLElement} el   그릴 자리
 * @param {object} enc       저장된 경로
 * @param {string} ds        'YYYY-MM-DD'
 * @returns {{destroy:Function}}
 */
function open(el, enc, ds){
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

  const map = L.map(mapEl, { zoomControl: true, attributionControl: true, preferCanvas: true });
  L.tileLayer(TILE.url, { attribution: TILE.attribution, maxZoom: TILE.maxZoom }).addTo(map);

  const latlngs = pts.map(p => [p[0], p[1]]);
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });

  // 아직 안 지나간 길은 옅게 깔아 두고, 지나간 만큼 진하게 덧그린다
  L.polyline(latlngs, { color: '#94a3b8', weight: 3, opacity: 0.45, lineJoin: 'round' }).addTo(map);
  const trail = L.polyline([latlngs[0]], { color: '#10b981', weight: 5, opacity: 0.95, lineJoin: 'round' }).addTo(map);

  // 머문 곳
  (r.visits || []).forEach(v => {
    const ll = [v.a / 1e5, v.o / 1e5];
    L.circleMarker(ll, { radius: 6, color: '#0f766e', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
      .addTo(map)
      .bindPopup(`<b>${escapeHtml(v.n || '머문 곳')}</b><br>${escapeHtml(hmAt(v.s, tz))} – ${escapeHtml(hmAt(v.e, tz))}<br>${escapeHtml(fmtDur(v.e - v.s))}`);
  });
  // 시작·끝은 색이 아니라 글자로 구분한다
  const endIcon = (text, cls) => L.divIcon({ className: 'mp-pin ' + cls, html: `<span>${escapeHtml(text)}</span>`, iconSize: null });
  L.marker(latlngs[0], { icon: endIcon('시작 ' + hmAt(t0, tz), 'start'), interactive: false }).addTo(map);
  L.marker(latlngs[n - 1], { icon: endIcon('끝 ' + hmAt(t1, tz), 'end'), interactive: false }).addTo(map);

  const dot = L.circleMarker(latlngs[0], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#059669', fillOpacity: 1 }).addTo(map);
  dot.bringToFront();

  // ── 상태 ──
  let p = 0, playing = false, speedIdx = 0, follow = true, raf = null, last = 0;
  let lastCam = 0, settle = null;

  /** 지금 재생 지점 앞뒤로 곧 지나갈/방금 지나온 구간의 범위 */
  function windowBounds(cur){
    const a = clamp(p - CAM_SPAN, 0, 1), b = clamp(p + CAM_SPAN, 0, 1);
    const lls = [[cur.lat, cur.lng]];
    for(let i = 0; i <= CAM_SAMPLES; i++){
      const s = at(a + (b - a) * i / CAM_SAMPLES);
      lls.push([s.lat, s.lng]);
    }
    // 한자리에 머무는 중이면 범위가 거의 0이 된다 — 동네가 보일 만큼은 넓혀준다
    return L.latLngBounds(lls).pad(0.25);
  }

  /** 자동 카메라 — 배율은 가끔, 이동은 가장자리에 닿을 때만 */
  function moveCamera(cur, force){
    if(!follow) return;
    const ll = [cur.lat, cur.lng];
    const now = performance.now();
    if(force || now - lastCam > CAM_INTERVAL_MS){
      lastCam = now;
      const b = windowBounds(cur);
      let z = map.getBoundsZoom(b, false);
      z = clamp(z, CAM_MIN_ZOOM, CAM_MAX_ZOOM);
      if(force || Math.abs(z - map.getZoom()) >= CAM_ZOOM_STEP){
        map.setView(ll, Math.round(z), { animate: !force, duration: 0.6 });
        return;
      }
    }
    // 배율은 그대로 두고, 마커가 화면 가운데 60%를 벗어날 때만 옮긴다
    const size = map.getSize();
    const pt = map.latLngToContainerPoint(ll);
    const mx = size.x * 0.2, my = size.y * 0.2;
    if(pt.x < mx || pt.x > size.x - mx || pt.y < my || pt.y > size.y - my){
      map.panTo(ll, { animate: true, duration: 0.4 });
    }
  }

  function render(opts){
    const s = at(p);
    const ll = [s.lat, s.lng];
    dot.setLatLng(ll);
    trail.setLatLngs(latlngs.slice(0, (s.i || 0) + 1).concat([ll]));
    timeEl.textContent = hmAt(s.ms, tz);
    distEl.textContent = fmtDist(s.dist);
    scrub.value = String(Math.round(p * 1000));
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
    followBtn.classList.remove('on');
  }
  map.on('dragstart', userTookOver);                                   // 끌기
  mapEl.addEventListener('wheel', userTookOver, { passive: true });    // 휠 확대
  mapEl.addEventListener('dblclick', userTookOver);                    // 더블클릭 확대
  mapEl.addEventListener('keydown', e => {                             // 키보드 +/-
    if(['+', '-', '=', '_'].includes(e.key)) userTookOver();
  });
  mapEl.addEventListener('touchstart', e => {                          // 두 손가락 핀치
    if(e.touches && e.touches.length > 1) userTookOver();
  }, { passive: true });
  // 확대/축소 버튼 — Leaflet이 컨트롤에서 클릭 전파를 막으므로 캡처 단계에서 받는다
  mapEl.addEventListener('click', e => {
    if(e.target.closest && e.target.closest('.leaflet-control-zoom')) userTookOver();
  }, true);

  function tick(now){
    if(!playing) return;
    if(!last) last = now;
    const dt = now - last;
    last = now;
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
    followBtn.classList.remove('on');
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  });

  // 컨테이너가 자리를 잡은 뒤에 크기를 다시 재야 타일이 어긋나지 않는다
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(mapEl);
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  }, 60);

  render();

  const ctl = {
    map,                       // Leaflet 인스턴스 — 바깥에서 손댈 일이 있으면 여기로
    destroy(){
      stop(false);
      clearTimeout(settle);
      ro.disconnect();
      map.remove();
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
