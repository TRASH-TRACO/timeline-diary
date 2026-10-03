// ══════════════════════════════════════════
// 사진 — 기기에 먼저, 로그인하면 클라우드로
// ══════════════════════════════════════════
//
// 이 앱은 로그인 없이도 쓸 수 있어야 한다. 그런데 Firebase Storage는 로그인이
// 있어야 쓴다. 그래서 사진은 항상 이 기기(IndexedDB)에 먼저 담고, 로그인해 있으면
// 뒤이어 올린다. 못 올린 사진은 목록에 남겨 두었다가 다음 기회에 다시 시도한다.
// 하루 기록에는 사진 자체가 아니라 id만 들어간다.
//
// 저장 위치: users/{uid}/photos/{id}.jpg  (storage.rules 참고)

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.16.0/';
// 사진은 결국 휴대폰 화면에서 본다. 요즘 폰이 가로 400pt 남짓에 3배 밀도라
// 긴 변 1280px이면 화면에 꽉 채워도 더 뭉개질 게 없다. 그보다 크게 담는 건
// 기기 저장소와 클라우드를 둘 다 두 배로 쓰면서 아무도 못 보는 화소를 버는 일이다.
const MAX_PX = 1280;
const QUALITY = 0.78;
// 나중에 "그때랑 지금"을 나란히 놓고 볼 사진은 더 크게 둔다(피부). 트랙 선언이
// px을 주면 그걸 쓴다.
const PENDING = 'photoPending';

let _st = null;
/** Storage SDK를 한 번만 불러온다. sync.js가 이미 앱을 만들었으면 그걸 쓴다. */
async function storage(){
  if(_st) return _st;
  const appMod = await import(/* @vite-ignore */ SDK + 'firebase-app.js');
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
  const m = await import(/* @vite-ignore */ SDK + 'firebase-storage.js');
  _st = { m, s: m.getStorage(app) };
  return _st;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(36).slice(2)).slice(0, 24);
const path = (uid, id) => `users/${uid}/photos/${id}.jpg`;
const uidNow = () => (window.DiarySync && window.DiarySync.uid && window.DiarySync.uid()) || null;

/**
 * 올리기 전에 줄인다. 원본 그대로 두면 한 장에 5MB가 넘어 무료 한도를 금방 먹고
 * 화면에 띄우는 것도 느리다. EXIF 회전 정보는 브라우저가 반영하게 둔다.
 */
async function shrink(file, opts){
  const px = (opts && opts.px) || MAX_PX;
  const q  = (opts && opts.q)  || QUALITY;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, px / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if(bmp.close) bmp.close();
  return new Promise((res, rej) =>
    c.toBlob(b => (b ? res(b) : rej(new Error('사진을 변환하지 못했어요'))), 'image/jpeg', q));
}

const getPending = async () => (await idbGet(PENDING)) || [];
async function setPending(list){ await idbSet(PENDING, list); }
async function addPending(id){
  const p = await getPending();
  if(!p.includes(id)){ p.push(id); await setPending(p); }
}
async function dropPending(id){
  const p = await getPending();
  const n = p.filter(x => x !== id);
  if(n.length !== p.length) await setPending(n);
}

/**
 * 사진 한 장을 받아 저장하고 id를 돌려준다.
 * 기기에는 반드시 남고, 업로드는 되면 하고 안 되면 나중에 다시 시도한다.
 */
async function add(file, opts){
  if(!/^image\//.test(file.type || '')) throw new Error('이미지 파일만 올릴 수 있어요');
  const blob = await shrink(file, opts);
  const id = newId();
  // 기기에 못 담으면 거기서 멈춘다. 예전에는 실패를 모르고 지나가서 빈 id만
  // 하루 기록에 남고 사진은 사라졌다 — 업로드도 기기 사본을 읽으므로 같이 포기했다.
  if(!(await idbSet('p:' + id, blob))){
    throw new Error('이 기기에 저장 공간이 부족해요. 사진을 좀 지우고 다시 해보세요');
  }
  await addPending(id);
  upload(id).catch(() => {});     // 못 올려도 기기엔 남아 있다
  return id;
}

// 마지막 업로드 실패. 사진이 기기에만 쌓이고 있다는 걸 화면이 알아야 한다 —
// 이걸 안 알리면 기기를 바꾸는 날에야 한꺼번에 잃은 걸 알게 된다.
let _upFail = null;
const lastError = () => _upFail;
const pendingCount = async () => (await getPending()).length;
function setFail(e){
  const v = e ? (e.code || e.message || '업로드 실패') : null;
  if(v === _upFail) return;
  _upFail = v;
  if(typeof window.onPhotoSyncChange === 'function') window.onPhotoSyncChange();
}

/** 아직 못 올린 사진을 올린다. 로그인 직후에 부른다. */
async function upload(id){
  const uid = uidNow();
  if(!uid) return false;
  const blob = await idbGet('p:' + id);
  if(!blob){ await dropPending(id); return false; }
  try{
    // SDK를 받아오는 것까지 감싼다. 네트워크가 없거나 버킷이 없으면 uploadBytes에
    // 닿기도 전에 터지는데, 그게 실제로 가장 흔한 실패다.
    const { m, s } = await storage();
    await m.uploadBytes(m.ref(s, path(uid, id)), blob, { contentType: 'image/jpeg' });
  }catch(e){
    setFail(e);
    throw e;
  }
  await dropPending(id);
  setFail(null);
  return true;
}
async function syncPending(){
  if(!uidNow()) return 0;
  let n = 0;
  for(const id of await getPending()){
    try{ if(await upload(id)) n++; }
    catch(e){ console.warn('[photos] 업로드 실패:', id, e.code || e.message); break; }
  }
  if(typeof window.onPhotoSyncChange === 'function') window.onPhotoSyncChange();
  return n;
}

// 화면에 띄울 주소. 기기에 있으면 그걸 쓰고(빠르고 오프라인에서도 된다),
// 없으면 클라우드에서 받아 기기에 채워 넣는다(다른 기기에서 올린 사진).
const _urls = new Map();
async function url(id){
  if(_urls.has(id)) return _urls.get(id);
  let blob = await idbGet('p:' + id);
  if(!blob){
    const uid = uidNow();
    if(!uid) return null;
    let href = null;
    try{
      const { m, s } = await storage();
      href = await m.getDownloadURL(m.ref(s, path(uid, id)));
    }catch(e){
      console.warn('[photos] 주소를 받지 못했습니다:', id, e.code || e.message, path(uid, id));
      return null;
    }
    try{
      const res = await fetch(href);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      blob = await res.blob();
      await idbSet('p:' + id, blob);
    }catch(e){
      // 받아서 기기에 담는 데 실패해도 주소는 손에 있다. <img src="…">는 CORS를
      // 타지 않으므로 버킷 설정이 어떻든 화면에는 뜬다 — 기기 캐시만 포기한다.
      // 사진이 안 보이는 것보다 매번 받아오는 쪽이 낫다.
      console.warn('[photos] 기기에 담지 못해 주소로 띄웁니다:', id, e.message);
      _urls.set(id, href);
      return href;
    }
  }
  const u = URL.createObjectURL(blob);
  _urls.set(id, u);
  return u;
}

async function remove(id){
  _urls.delete(id);
  await idbDel('p:' + id);
  await dropPending(id);
  const uid = uidNow();
  if(!uid) return;
  try{
    const { m, s } = await storage();
    await m.deleteObject(m.ref(s, path(uid, id)));
  }catch(e){
    if(e.code !== 'storage/object-not-found') console.warn('[photos] 삭제 실패:', e.code || e.message);
  }
}

/**
 * 이 기기에 쌓인 사진 (데이터 화면용).
 * quota는 브라우저가 이 사이트에 내준 전체 몫이다 — 사진만의 몫이 아니고,
 * 브라우저마다 어림값이라 "대략 이만큼"으로만 쓴다.
 */
async function usage(){
  const ids = await idbKeysWithPrefix('p:');
  let bytes = 0;
  for(const k of ids){
    const b = await idbGet(k);
    if(b && b.size) bytes += b.size;
  }
  let quota = 0, used = 0;
  try{
    if(navigator.storage && navigator.storage.estimate){
      const e = await navigator.storage.estimate();
      quota = e.quota || 0;
      used = e.usage || 0;
    }
  }catch(_){}
  return { count: ids.length, bytes, pending: (await getPending()).length, quota, used };
}

window.DiaryPhotos = { add, url, remove, syncPending, usage, pendingCount, lastError, MAX_PX };
// 늦게 뜬 사이에 그려진 썸네일을 채우라고 알린다 (지도와 같은 방식)
if(typeof window.onPhotosReady === 'function') window.onPhotosReady();
