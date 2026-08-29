// ══════════════════════════════════════════
// 클라우드 동기화 (Firebase Auth + Firestore)
// ══════════════════════════════════════════
//
// 저장 위치: users/{uid}/diary/{YYYY-MM} — 한 달에 문서 하나.
// 병합은 DiaryStore.applyRemote가 "날짜 × 필드별 최신 우선"으로 처리하므로
// 여기서는 충돌을 물어볼 일이 없다. A기기에서 쓴 일기와 B기기에서 올린 경로가
// 서로를 덮어쓰지 않는다.

import { firebaseConfig } from './firebase-config.js';

// Firebase SDK는 정적 import가 아니라 동적으로 불러온다.
// 정적으로 두면 gstatic이 느리거나 막혔을 때 이 모듈이 통째로 실행되지 않고,
// 번들러가 다른 모듈(지도 등)과 한 덩어리로 묶기라도 하면 그쪽까지 같이 죽는다.
// 못 불러와도 앱은 '로그인 없이 사용' 상태로 계속 돌아가야 한다.
const SDK = 'https://www.gstatic.com/firebasejs/12.16.0/';
let GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
    signOutFn, onAuthStateChanged, collection, doc, getDocs, setDoc, onSnapshot, serverTimestamp;
let auth = null, db = null;
let sdkReady = false;

async function loadSDK(){
  const [appMod, authMod, fsMod] = await Promise.all([
    import(/* @vite-ignore */ SDK + 'firebase-app.js'),
    import(/* @vite-ignore */ SDK + 'firebase-auth.js'),
    import(/* @vite-ignore */ SDK + 'firebase-firestore.js'),
  ]);
  ({ GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
     onAuthStateChanged } = authMod);
  signOutFn = authMod.signOut;
  ({ collection, doc, getDocs, setDoc, onSnapshot, serverTimestamp } = fsMod);

  const app = appMod.initializeApp(firebaseConfig);
  auth = authMod.getAuth(app);
  try{
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
    });
  }catch(e){
    console.warn('[sync] 오프라인 캐시 비활성:', e.message);
    db = fsMod.initializeFirestore(app, {});
  }
  sdkReady = true;
}

const PUSH_DEBOUNCE_MS = 1500;
const DOC_SOFT_LIMIT   = 900 * 1024;   // Firestore 문서 상한 1MiB 앞에서 멈춘다

let uid = null;
let unsub = null;
let ready = false;                 // 최초 조정 완료
let suppress = 0;                  // >0 이면 원격 적용 중 (되돌아가는 업로드 방지)
const timers = new Map();          // monthKey → 디바운스 타이머
const myRevs = new Map();          // monthKey → 내가 마지막으로 올린 rev

const colRef = () => collection(db, 'users', uid, 'diary');
const docRef = key => doc(db, 'users', uid, 'diary', key);
// 달 문서는 'YYYY-MM', 그 외(현재는 'settings')는 달이 아니다
const isMonth = id => /^\d{4}-\d{2}$/.test(id);
const newRev = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

function deviceLabel(){
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
           : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac'
           : /Windows/.test(ua) ? 'Windows' : '기기';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome'
           : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return (os + ' ' + br).trim();
}

// ── 상태 표시 ───────────────────────────────
function setChip(text, cls){
  const el = document.getElementById('sync-chip');
  if(!el) return;
  el.textContent = text;
  el.className = 'hdr-btn' + (cls ? ' ' + cls : '');
}
function setUser(t, title){
  const el = document.getElementById('sync-user');
  if(el){ el.textContent = t || ''; el.title = title || ''; }
}
function setLogoutBtn(show){
  const b = document.getElementById('sync-logout');
  if(b) b.style.display = show ? '' : 'none';
}
// 로그인 상태가 바뀌면 화면(로컬 전용 안내 등)도 같이 맞춘다
function notifyAuth(){
  if(typeof window.onAuthChange === 'function') window.onAuthChange();
}

// 콘솔 설정이 빠졌을 때 원인이 화면에 안 드러나므로 한 번만 안내한다
let warned = false;
function warnSetup(e){
  const guide = {
    'permission-denied':
      '서버가 접근을 거부했습니다 — 보안 규칙이 아직 게시되지 않은 것 같습니다.\n\n' +
      'Firebase 콘솔 → Firestore Database → 규칙 탭에\n' +
      '저장소의 firestore.rules 내용을 붙여넣고 "게시"를 눌러주세요.',
    'not-found':
      'Firestore 데이터베이스가 아직 만들어지지 않았습니다.\n\n' +
      'Firebase 콘솔 → Firestore Database → 데이터베이스 만들기'
  }[e && e.code];
  if(guide && !warned){ warned = true; alert(guide); }
}

// ── 원격 문서 해석 ──────────────────────────
function unpack(snap){
  const d = snap.data();
  if(!d || !d.days || typeof d.days !== 'object') return null;
  return { days: d.days, rev: d.rev || null, at: d.updatedAtMs || 0 };
}

// ── 업로드 ──────────────────────────────────
async function pushMonth(key){
  if(!uid || !ready) return;
  const snap = DiaryStore.snapshot(key);
  if(!snap) return;
  const size = JSON.stringify(snap.days).length;
  if(size > DOC_SOFT_LIMIT){
    console.warn('[sync] 문서가 너무 큽니다:', key, size);
    setChip('용량 초과', 'err');
    showToast(`${key}은 너무 커서 동기화하지 못했어요 (이 기기에는 남아 있어요)`);
    return;
  }
  setChip('저장 중', 'busy');
  const rev = newRev();
  try{
    await setDoc(docRef(key), {
      v: 1, rev, days: snap.days,
      device: deviceLabel(),
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now()
    });
    myRevs.set(key, rev);
    await DiaryStore.markClean(key);
    setChip(DiaryStore.dirtyKeys().length ? '저장 중' : '동기화됨',
            DiaryStore.dirtyKeys().length ? 'busy' : 'ok');
  }catch(e){
    console.warn('[sync] 업로드 실패:', e.code || e.message);
    setChip('오프라인', 'err');
    warnSetup(e);
    // 오프라인이면 Firestore가 큐에 쌓아뒀다가 복구되면 알아서 보낸다 — 그건 알릴 일이 아니다.
    // 그 외(권한·용량·형식)는 사용자가 모르면 영영 안 올라가므로 화면에 띄운다.
    if(!['unavailable', 'deadline-exceeded', 'cancelled'].includes(e.code)){
      const msg = e.code === 'invalid-argument'
        ? `${key}은 서버가 받아주지 않았어요 — 새로고침하면 다시 시도합니다`
        : '동기화 실패 — ' + (e.code || e.message);
      showToast(msg);
    }
  }
}

async function pushAllDirty(){
  for(const key of DiaryStore.dirtyKeys()) await pushMonth(key);
  await pushSettings();
}

/** 설정 문서 — 달 문서와 나란히 산다 */
async function pushSettings(){
  if(!uid || !ready || !DiaryStore.settingsDirty()) return;
  try{
    const snap = DiaryStore.settingsSnapshot();
    await setDoc(docRef('settings'), { ...snap, updatedAtMs: Date.now(), device: deviceLabel() });
    await DiaryStore.markSettingsClean();
  }catch(e){
    console.warn('[sync] 설정 업로드 실패:', e.code || e.message);
  }
}

// ── 최초 조정 ───────────────────────────────
async function reconcile(){
  setChip('동기화 중', 'busy');
  let snaps;
  try{
    snaps = await getDocs(colRef());
  }catch(e){
    console.warn('[sync] 원격 조회 실패:', e.code || e.message);
    setChip('오프라인', 'err');
    warnSetup(e);
    ready = true; subscribe(); return;
  }

  const remoteKeys = new Set();
  let sawSettings = false;
  suppress++;
  try{
    for(const s of snaps.docs){
      if(!isMonth(s.id)){
        if(s.id === 'settings'){ sawSettings = true; await DiaryStore.applyRemoteSettings(s.data()); }
        continue;
      }
      const r = unpack(s);
      if(!r) continue;
      remoteKeys.add(s.id);
      await DiaryStore.applyRemote(s.id, { v: 1, days: r.days });
    }
  } finally { suppress--; }
  if(!sawSettings) await DiaryStore.markSettingsDirty();

  ready = true;

  // 원격에 없는 달 + 아직 못 올린 달을 올린다 (비로그인으로 쓰던 기록이 여기서 합류한다)
  for(const key of DiaryStore.monthKeys()){
    if(!remoteKeys.has(key)) await DiaryStore.markDirty(key);
  }
  await pushAllDirty();
  await pushSettings();
  setChip('동기화됨', 'ok');
  subscribe();
}

// ── 실시간 구독 ─────────────────────────────
function subscribe(){
  if(unsub) unsub();
  unsub = onSnapshot(colRef(), qs => {
    if(qs.metadata.hasPendingWrites) return;      // 방금 우리가 쓴 것
    qs.docChanges().forEach(async ch => {
      if(ch.type === 'removed') return;
      if(!isMonth(ch.doc.id)){
        if(ch.doc.id === 'settings') DiaryStore.applyRemoteSettings(ch.doc.data());
        return;
      }
      const r = unpack(ch.doc);
      if(!r) return;
      if(r.rev && r.rev === myRevs.get(ch.doc.id)) return;   // 이미 반영됨
      suppress++;
      try{
        const changed = await DiaryStore.applyRemote(ch.doc.id, { v: 1, days: r.days });
        if(changed) showToast('☁️ 다른 기기의 기록을 받았어요');
      }catch(e){ console.warn('[sync] 적용 실패:', e.message); }
      finally { suppress--; }
    });
  }, err => {
    console.warn('[sync] 구독 오류:', err.code || err.message);
    setChip('오프라인', 'err');
    warnSetup(err);
  });
}

// ── 로그인 ──────────────────────────────────
function beginLoginProgress(){
  try{ sessionStorage.setItem('diaryPendingLogin', '1'); }catch(_){}
  document.documentElement.classList.add('logging-in');
}
function cancelLoginProgress(){
  try{ sessionStorage.removeItem('diaryPendingLogin'); }catch(_){}
  document.documentElement.classList.remove('logging-in');
}

async function login(){
  setChip('로그인 중', 'busy');
  beginLoginProgress();
  const provider = new GoogleAuthProvider();
  try{
    await signInWithPopup(auth, provider);
    cancelLoginProgress();
  }catch(e){
    // 모바일에서 팝업이 막히는 일이 잦아 리디렉션으로 넘어간다 (진행 화면 유지)
    if(['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment'].includes(e.code)){
      try{ await signInWithRedirect(auth, provider); return; }catch(_){}
    }
    cancelLoginProgress();
    console.warn('[sync] 로그인 실패:', e.code || e.message);
    setChip('로그인', '');
    const guide = {
      'auth/operation-not-allowed':
        'Google 로그인이 아직 켜져 있지 않습니다.\n\n' +
        'Firebase 콘솔 → Authentication → Sign-in method → Google → 사용 설정',
      'auth/unauthorized-domain':
        '이 도메인(' + location.hostname + ')이 Firebase에 등록되어 있지 않습니다.\n\n' +
        'Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 추가해주세요.',
      'auth/configuration-not-found':
        'Authentication이 아직 시작되지 않았습니다.\n\n' +
        'Firebase 콘솔 → Authentication → 시작하기'
    }[e.code];
    if(guide) alert(guide);
    else if(e.code) showToast('로그인 실패 — ' + e.code);
  }
}

window.onSyncChipClick = function(){
  if(!sdkReady){
    showToast('로그인 기능을 불러오지 못했어요 — 잠시 후 다시 시도해 주세요');
    return;
  }
  if(!uid){ login(); return; }
  pushAllDirty().then(() => showToast('☁️ 최신 상태로 맞췄어요')).catch(() => {});
};

window.DiarySync = {
  schedulePush(key){
    if(!uid || !ready || suppress > 0) return;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => pushMonth(key), PUSH_DEBOUNCE_MS));
  },
  scheduleSettingsPush(){
    if(!uid || !ready || suppress > 0) return;
    clearTimeout(timers.get('__settings'));
    timers.set('__settings', setTimeout(pushSettings, PUSH_DEBOUNCE_MS));
  },
  signOut(){ return sdkReady ? signOutFn(auth) : Promise.resolve(); },
  syncNow(){ return uid ? pushAllDirty() : Promise.resolve(); },
  isSignedIn(){ return !!uid; },
  isAvailable(){ return sdkReady; }
};

// ── 부팅 ────────────────────────────────────
loadSDK().then(() => {
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, onAuth);
}).catch(e => {
  // SDK를 못 불러왔다 — 로그인·동기화만 빠지고 나머지는 그대로 쓸 수 있다
  console.warn('[sync] Firebase SDK 로드 실패:', e.message);
  setChip('로그인 불가', 'err');
  cancelLoginProgress();
  notifyAuth();
});

async function onAuth(user){
  await window.__diaryReady.catch(() => {});   // 로컬 로드가 끝난 뒤에 조정한다

  if(unsub){ unsub(); unsub = null; }
  timers.forEach(t => clearTimeout(t));
  timers.clear();
  ready = false;

  if(!user){
    uid = null;
    setChip('로그인', '');
    setUser('');
    setLogoutBtn(false);
    cancelLoginProgress();
    notifyAuth();
    return;
  }
  uid = user.uid;
  setUser(user.displayName || user.email || '', user.email || '');
  setLogoutBtn(true);
  cancelLoginProgress();
  notifyAuth();
  try{ await reconcile(); }
  catch(e){
    console.warn('[sync] 조정 실패:', e.message);
    setChip('동기화 오류', 'err');
  }
}
