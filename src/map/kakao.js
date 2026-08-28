// ══════════════════════════════════════════
// 지도 어댑터 — 카카오맵
// ══════════════════════════════════════════
//
// ⚠️ 이 어댑터는 개발 환경에서 검증하지 못했다. 카카오 도메인(dapi.kakao.com,
//    t1.daumcdn.net)이 막혀 있어 SDK를 불러올 수도, 자동 테스트를 돌릴 수도 없었다.
//    그래서 create()가 조금이라도 어긋나면 예외를 던지게 두었고, 부르는 쪽
//    (src/map/index.js)이 그걸 받아 Leaflet으로 되돌린다. 카카오가 안 되더라도
//    지도가 안 뜨는 일은 없다.
//
// 좌표계와 배율 표기가 Leaflet과 다르다.
//  · 카카오는 "레벨"을 쓰고 작을수록 확대다(1이 가장 가깝다). Leaflet은 반대.
//    안팎으로 오가는 값은 전부 Leaflet 기준(클수록 확대)으로 맞춘다.
//  · 고정 픽셀 크기 표식은 Circle(반경이 미터)이 아니라 CustomOverlay(HTML)로 그린다.

import { fitZoom } from './geo.js';

// 카카오 레벨 ↔ Leaflet 배율. 카카오 레벨 1이 대략 z19에 해당한다고 보고 맞춘다.
// (정확한 대응표가 공개돼 있지 않아 근사값이다 — 실제로 보고 어긋나면 이 숫자만 고치면 된다)
const LEVEL_BASE = 20;
const toLevel = z => Math.max(1, Math.min(14, Math.round(LEVEL_BASE - z)));
const toZoom  = lv => LEVEL_BASE - lv;

const SDK_ID = 'kakao-maps-sdk';

/** SDK를 한 번만 불러온다. */
function loadSDK(key){
  if(window.kakao && window.kakao.maps && window.kakao.maps.Map) return Promise.resolve();
  return new Promise((res, rej) => {
    let s = document.getElementById(SDK_ID);
    if(!s){
      s = document.createElement('script');
      s.id = SDK_ID;
      s.async = true;
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
      document.head.appendChild(s);
    }
    const done = () => {
      if(!window.kakao || !window.kakao.maps) return rej(new Error('카카오 SDK가 올라오지 않았습니다'));
      window.kakao.maps.load(res);
    };
    s.addEventListener('load', done, { once: true });
    s.addEventListener('error', () => rej(new Error('카카오 SDK를 불러오지 못했습니다 (키·도메인 등록 확인)')), { once: true });
    if(window.kakao && window.kakao.maps) done();
    setTimeout(() => rej(new Error('카카오 SDK 로드 시간 초과')), 10000);
  });
}

export const name = 'kakao';

export async function create(el, opts){
  const key = opts && opts.key;
  if(!key) throw new Error('카카오 JS 키가 없습니다');
  await loadSDK(key);
  const kakao = window.kakao;
  const LL = a => new kakao.maps.LatLng(a[0], a[1]);

  const map = new kakao.maps.Map(el, { center: LL([37.5665, 126.9780]), level: 5 });
  map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.TOPLEFT);

  const overlays = [];
  let info = null;

  /** 고정 픽셀 크기 표식 — HTML을 그대로 얹는다 */
  function overlay(a, html, cls, zIndex){
    const o = new kakao.maps.CustomOverlay({
      map, position: LL(a), content: `<div class="${cls}">${html}</div>`,
      yAnchor: 0.5, xAnchor: 0.5, zIndex: zIndex || 1,
    });
    overlays.push(o);
    return o;
  }

  return {
    native: map,          // 원본 지도 객체 — 디버깅·계측용
    name: 'kakao',
    minZoom: toZoom(14),          // 가장 넓게
    maxZoom: toZoom(1),           // 가장 가깝게

    size(){ return { w: el.clientWidth || 640, h: el.clientHeight || 380 }; },
    zoom(){ return toZoom(map.getLevel()); },
    fitZoom(lls, pad){ return fitZoom(lls, this.size(), pad, { min: this.minZoom, max: Math.min(17, this.maxZoom) }); },

    setView(a, z){ map.setLevel(toLevel(z)); map.setCenter(LL(a)); },
    panTo(a){ map.setCenter(LL(a)); },        // 즉시 — 매 프레임 부르므로 애니메이션은 쓰지 않는다
    flyTo(a, z, sec){
      // 카카오에는 flyTo가 없다. 중심은 부드럽게 옮기고 레벨은 자체 애니메이션으로 바꾼다.
      map.panTo(LL(a));
      map.setLevel(toLevel(z), { animate: { duration: Math.round(sec * 1000) } });
    },
    fitBounds(lls, pad){
      const b = new kakao.maps.LatLngBounds();
      lls.forEach(a => b.extend(LL(a)));
      map.setBounds(b, pad, pad, pad, pad);
    },
    flyToBounds(lls, pad){ this.fitBounds(lls, pad); },
    stop(){ /* 카카오는 진행 중 애니메이션을 멈추는 공개 API가 없다 */ },
    relayout(){ map.relayout(); },

    line(lls, style){
      const line = new kakao.maps.Polyline({
        map, path: lls.map(LL), strokeWeight: style.weight,
        strokeColor: style.color, strokeOpacity: style.opacity, strokeStyle: 'solid',
      });
      overlays.push(line);
      return { setPath(next){ line.setPath(next.map(LL)); } };
    },
    dot(a, style){
      const o = overlay(a, '', style.cls + ' mp-k-dot', 5);
      return { setPosition(next){ o.setPosition(LL(next)); } };
    },
    visit(a, style, popupHtml){
      const o = overlay(a, '', style.cls + ' mp-k-visit', 3);
      if(popupHtml){
        kakao.maps.event.addListener(o, 'click', () => {
          if(info) info.close();
          info = new kakao.maps.InfoWindow({ content: `<div class="mp-k-info">${popupHtml}</div>`, removable: true });
          info.open(map, new kakao.maps.Marker({ position: LL(a) }));
        });
      }
    },
    // CustomOverlay가 이미 중앙에 맞춰 주므로 Leaflet 핀(.mp-pin)의 transform을
    // 그대로 쓰면 두 번 밀린다. 카카오 전용 클래스를 따로 둔다.
    label(a, html, cls){ overlay(a, html, 'mp-kpin ' + cls, 4); },

    onZoomEnd(fn){ kakao.maps.event.addListener(map, 'zoom_changed', fn); },
    onUserGesture(fn){
      kakao.maps.event.addListener(map, 'dragstart', fn);
      el.addEventListener('wheel', fn, { passive: true });
      el.addEventListener('dblclick', fn);
      el.addEventListener('touchstart', e => { if(e.touches && e.touches.length > 1) fn(); }, { passive: true });
      el.addEventListener('click', e => {
        if(e.target.closest && e.target.closest('.kakao-zoomcontrol, [class*="zoomcontrol"]')) fn();
      }, true);
    },

    destroy(){
      overlays.forEach(o => { try{ o.setMap(null); }catch(_){} });
      if(info){ try{ info.close(); }catch(_){} }
      el.innerHTML = '';
    },
  };
}
