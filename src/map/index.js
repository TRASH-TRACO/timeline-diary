// ══════════════════════════════════════════
// 지도 어댑터 고르기
// ══════════════════════════════════════════
// 기본은 Leaflet + OpenStreetMap — 키가 필요 없어 설정 없이 돌아간다.
// 카카오맵을 쓰려면 환경 변수 두 개를 넣고 재배포하면 된다(README 참고).
//
//   VITE_MAP_PROVIDER = kakao
//   VITE_KAKAO_KEY    = 카카오 개발자 사이트의 JavaScript 키
//
// 카카오 쪽이 어떤 이유로든 실패하면(키 누락·도메인 미등록·SDK 차단) 조용히
// Leaflet으로 되돌린다. 지도가 아예 안 뜨는 것보다 낫다.

import * as leaflet from './leaflet.js';

const env = import.meta.env || {};

export const config = {
  provider: (env.VITE_MAP_PROVIDER || 'leaflet').toLowerCase(),
  kakaoKey: env.VITE_KAKAO_KEY || '',
  // 다른 XYZ 타일로 바꾸려면 여기만 고치면 된다 (VWorld 등).
  tile: env.VITE_TILE_URL ? {
    url: env.VITE_TILE_URL,
    attribution: env.VITE_TILE_ATTR || '',
    maxZoom: +(env.VITE_TILE_MAXZOOM || 19),
  } : null,
};

/**
 * 지도 어댑터를 만든다. 실패하면 Leaflet으로 되돌린다.
 * @returns {Promise<{adapter:object, fellBack:(string|null)}>}
 */
export async function createAdapter(el, want){
  const provider = (want || config.provider);
  if(provider === 'kakao'){
    try{
      const kakao = await import('./kakao.js');
      const adapter = await kakao.create(el, { key: config.kakaoKey });
      return { adapter, fellBack: null };
    }catch(e){
      console.warn('[map] 카카오맵을 쓰지 못해 OpenStreetMap으로 되돌립니다:', e.message);
      el.innerHTML = '';
      const adapter = await leaflet.create(el, { tile: config.tile });
      return { adapter, fellBack: e.message };
    }
  }
  const adapter = await leaflet.create(el, { tile: config.tile });
  return { adapter, fellBack: null };
}
