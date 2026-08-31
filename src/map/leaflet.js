// ══════════════════════════════════════════
// 지도 어댑터 — Leaflet + XYZ 타일 (기본)
// ══════════════════════════════════════════
// 배경지도는 키 없이 바로 쓸 수 있는 OpenStreetMap이 기본이다.
// VWorld처럼 일반 XYZ 타일을 주는 곳이면 url·attribution만 바꾸면 된다.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fitZoom } from './geo.js';

const OSM = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 기여자',
  maxZoom: 19,
};

const ll = a => L.latLng(a[0], a[1]);

export const name = 'leaflet';

/** @returns {Promise<object>} 지도 어댑터 */
export async function create(el, opts){
  const tile = (opts && opts.tile) || OSM;
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer(tile.url, { attribution: tile.attribution, maxZoom: tile.maxZoom || 19 }).addTo(map);

  const zoomCtl = el.querySelector('.leaflet-control-zoom');

  return {
    native: map,          // 원본 지도 객체 — 디버깅·계측용
    name: 'leaflet',
    minZoom: 3,
    maxZoom: Math.min(17, tile.maxZoom || 19),

    size(){ const s = map.getSize(); return { w: s.x, h: s.y }; },
    zoom(){ return map.getZoom(); },
    fitZoom(lls, pad){ return fitZoom(lls, this.size(), pad, { min: this.minZoom, max: this.maxZoom }); },

    setView(a, z){ map.setView(ll(a), z, { animate: false }); },
    panTo(a){ map.panTo(ll(a), { animate: false }); },
    flyTo(a, z, sec){ map.flyTo(ll(a), z, { duration: sec }); },
    fitBounds(lls, pad){
      map.fitBounds(L.latLngBounds(lls.map(ll)), { padding: [pad, pad], maxZoom: this.maxZoom, animate: false });
    },
    flyToBounds(lls, pad, sec){
      map.flyToBounds(L.latLngBounds(lls.map(ll)), { padding: [pad, pad], maxZoom: this.maxZoom, duration: sec });
    },
    stop(){ map.stop(); },
    relayout(){ map.invalidateSize(); },

    line(lls, style){
      const line = L.polyline(lls.map(ll), {
        className: style.cls, color: style.color, weight: style.weight,
        opacity: style.opacity, lineJoin: 'round', lineCap: 'round',
      }).addTo(map);
      return { setPath(next){ line.setLatLngs(next.map(ll)); } };
    },
    dot(a, style){
      const m = L.circleMarker(ll(a), {
        className: style.cls, radius: style.radius, color: style.stroke,
        weight: style.weight, fillColor: style.fill, fillOpacity: 1,
      }).addTo(map);
      if(style.front) m.bringToFront();
      return { setPosition(next){ m.setLatLng(ll(next)); } };
    },
    visit(a, style, popupHtml){
      const m = L.circleMarker(ll(a), {
        className: style.cls, radius: style.radius, color: style.stroke,
        weight: style.weight, fillColor: style.fill, fillOpacity: 1,
      }).addTo(map);
      if(popupHtml) m.bindPopup(popupHtml);
    },
    label(a, html, cls){
      L.marker(ll(a), {
        icon: L.divIcon({ className: 'mp-pin ' + cls, html: `<span>${html}</span>`, iconSize: null }),
        interactive: false,
      }).addTo(map);
    },

    onZoomStart(fn){ map.on('zoomstart', fn); },
    onZoomEnd(fn){ map.on('zoomend', fn); },
    /**
     * 사용자가 직접 지도를 만졌을 때. movestart/zoomstart로 잡으면 우리 카메라가
     * 움직일 때도 똑같이 나서 구분이 안 된다 — 제스처만 콕 집어 듣는다.
     */
    onUserGesture(fn){
      map.on('dragstart', fn);
      el.addEventListener('wheel', fn, { passive: true });
      el.addEventListener('dblclick', fn);
      el.addEventListener('keydown', e => { if(['+', '-', '=', '_'].includes(e.key)) fn(); });
      el.addEventListener('touchstart', e => { if(e.touches && e.touches.length > 1) fn(); }, { passive: true });
      // 확대/축소 버튼 — Leaflet이 컨트롤에서 클릭 전파를 막으므로 캡처 단계에서 받는다
      el.addEventListener('click', e => {
        if(e.target.closest && e.target.closest('.leaflet-control-zoom')) fn();
      }, true);
      void zoomCtl;
    },

    destroy(){ map.stop(); map.remove(); },
  };
}
