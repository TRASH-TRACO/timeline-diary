// ══════════════════════════════════════════
// 지도 수학 — 어느 지도 라이브러리를 쓰든 같다
// ══════════════════════════════════════════
// 배율 계산을 여기 두는 이유: Leaflet에는 getBoundsZoom이 있지만 카카오에는 없다.
// (카카오는 setBounds로 실제로 움직여봐야 레벨을 알 수 있다 — 화면이 튄다)
// 웹 메르카토르 기준으로 직접 계산하면 두 지도에 같은 값을 줄 수 있고,
// 브라우저 없이 테스트할 수도 있다.

const TILE_PX = 256;
const clampLat = a => Math.max(-85.05112878, Math.min(85.05112878, a));

/** 위도 → 메르카토르 y (0~1) */
function mercY(lat){
  const s = Math.sin(clampLat(lat) * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
/** 경도 → 메르카토르 x (0~1) */
const mercX = lng => (lng + 180) / 360;

/** @returns {{minLat,maxLat,minLng,maxLng}} */
function boundsOf(lls){
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for(const [lat, lng] of lls){
    if(lat < minLat) minLat = lat;
    if(lat > maxLat) maxLat = lat;
    if(lng < minLng) minLng = lng;
    if(lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * 주어진 좌표들이 화면에 다 들어오는 배율.
 * 배율은 Leaflet 기준(클수록 확대). 카카오 레벨은 어댑터가 변환한다.
 *
 * @param lls   [[lat,lng], ...]
 * @param size  {w,h} 픽셀
 * @param pad   여백 비율 (0.25면 사방 25% 여유)
 * @param range {min,max}
 */
function fitZoom(lls, size, pad, range){
  if(!lls.length) return range ? range.min : 0;
  const b = boundsOf(lls);
  const p = 1 + (pad || 0) * 2;
  // 지도상 차지하는 비율 (0~1). 한 점뿐이면 0이 되므로 최소값을 둔다.
  const fx = Math.max(Math.abs(mercX(b.maxLng) - mercX(b.minLng)) * p, 1e-9);
  const fy = Math.max(Math.abs(mercY(b.minLat) - mercY(b.maxLat)) * p, 1e-9);
  const z = Math.min(
    Math.log2(size.w / (TILE_PX * fx)),
    Math.log2(size.h / (TILE_PX * fy))
  );
  const lo = range ? range.min : 0, hi = range ? range.max : 22;
  return Math.max(lo, Math.min(hi, z));
}

/** 좌표들의 한가운데 */
function centerOf(lls){
  const b = boundsOf(lls);
  return [(b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2];
}

/** 픽셀당 미터 (해당 위도·배율에서) */
function metersPerPixel(lat, zoom){
  return 156543.03392 * Math.cos(clampLat(lat) * Math.PI / 180) / Math.pow(2, zoom);
}

export { fitZoom, centerOf, boundsOf, metersPerPixel, mercX, mercY };
