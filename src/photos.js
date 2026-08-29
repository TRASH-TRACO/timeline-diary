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
const MAX_PX = 1600;          // 긴 변
const QUALITY = 0.82;
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
async function shrink(file){
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if(bmp.close) bmp.close();
  return new Promise((res, rej) =>
    c.toBlob(b => (b ? res(b) : rej(new Error('사진을 변환하지 못했어요'))), 'image/jpeg', QUALITY));
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
async function add(file){
  if(!/^image\//.test(file.type || '')) throw new Error('이미지 파일만 올릴 수 있어요');
  const blob = await shrink(file);
  const id = newId();
  await idbSet('p:' + id, blob);
  await addPending(id);
  upload(id).catch(() => {});     // 실패해도 기기엔 남아 있다
  return id;
}

/** 아직 못 올린 사진을 올린다. 로그인 직후에 부른다. */
async function upload(id){
  const uid = uidNow();
  if(!uid) return false;
  const blob = await idbGet('p:' + id);
  if(!blob){ await dropPending(id); return false; }
  const { m, s } = await storage();
  await m.uploadBytes(m.ref(s, path(uid, id)), blob, { contentType: 'image/jpeg' });
  await dropPending(id);
  return true;
}
async function syncPending(){
  if(!uidNow()) return 0;
  let n = 0;
  for(const id of await getPending()){
    try{ if(await upload(id)) n++; }
    catch(e){ console.warn('[photos] 업로드 실패:', id, e.code || e.message); break; }
  }
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
    try{
      const { m, s } = await storage();
      const href = await m.getDownloadURL(m.ref(s, path(uid, id)));
      const res = await fetch(href);
      blob = await res.blob();
      await idbSet('p:' + id, blob);
    }catch(e){
      console.warn('[photos] 받아오지 못했습니다:', id, e.code || e.message);
      return null;
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

/** 이 기기에 남은 사진 용량 (데이터 화면용) */
async function usage(){
  const ids = await idbKeysWithPrefix('p:');
  let bytes = 0;
  for(const k of ids){
    const b = await idbGet(k);
    if(b && b.size) bytes += b.size;
  }
  return { count: ids.length, bytes, pending: (await getPending()).length };
}

window.DiaryPhotos = { add, url, remove, syncPending, usage, MAX_PX };
