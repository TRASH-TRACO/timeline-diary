// ══════════════════════════════════════════
// Firebase 설정
// ══════════════════════════════════════════
// 여기 있는 값들은 비밀이 아닙니다. 웹 앱의 Firebase 설정은 브라우저에 그대로
// 실려 나가는 공개 값이고, 실제 접근 통제는 두 군데서 합니다.
//   1) firestore.rules — 남의 문서를 못 읽게 막는다
//   2) Authentication → 승인된 도메인 — 남의 사이트에서 로그인을 못 쓰게 막는다
// 그래서 저장소에 그대로 두어도 됩니다.
//
// 다른 Firebase 프로젝트로 옮기려면 아래 기본값을 고치거나,
// Vercel 환경 변수(VITE_FB_*)로 덮어쓰세요. 자세한 건 README.md 참고.

const env = import.meta.env || {};

export const firebaseConfig = {
  apiKey:            env.VITE_FB_API_KEY     || 'AIzaSyD7X0NgYVXAN6hGv9nIutpxFCQK_PrYiDA',
  // 기본값은 Firebase가 주는 인증 도메인입니다. 승인된 도메인에만 등록돼 있으면
  // 어느 주소에서든 동작합니다(로그인 팝업 주소창에 firebaseapp.com이 잠깐 보입니다).
  // 팝업에도 내 도메인을 보이고 싶으면 이 값을 내 도메인으로 바꾸고
  // vercel.json의 /__/auth 리라이트를 살려 두세요 — README에 설명해 뒀습니다.
  authDomain:        env.VITE_FB_AUTH_DOMAIN || 'study-3f275.firebaseapp.com',
  projectId:         env.VITE_FB_PROJECT_ID  || 'study-3f275',
  storageBucket:     env.VITE_FB_STORAGE     || 'study-3f275.firebasestorage.app',
  messagingSenderId: env.VITE_FB_SENDER_ID   || '365352183497',
  appId:             env.VITE_FB_APP_ID      || '1:365352183497:web:3659e2fe9562dd5b79cf18',
};
