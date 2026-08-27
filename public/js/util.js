// ══════════════════════════════════════════
// 일기장 — 공용 유틸 (IndexedDB · 날짜 · 거리 · 토스트)
// ══════════════════════════════════════════

// ── IndexedDB (key-value 한 스토어) ─────────
const DB_NAME = 'diary-db', DB_STORE = 'kv';
let _dbp = null;
function idb(){
  if(_dbp) return _dbp;
  _dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { if(!r.result.objectStoreNames.contains(DB_STORE)) r.result.createObjectStore(DB_STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
  return _dbp;
}
async function idbTx(mode, fn){
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, mode);
    const req = fn(tx.objectStore(DB_STORE));
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
// IndexedDB를 못 쓰는 환경(시크릿 모드 등)에서는 localStorage로 물러난다.
async function idbGet(k){
  try{ return await idbTx('readonly', s => s.get(k)); }
  catch(_){ try{ const v = localStorage.getItem('diary:' + k); return v ? JSON.parse(v) : undefined; }catch(__){ return undefined; } }
}
async function idbSet(k, v){
  try{ return await idbTx('readwrite', s => s.put(v, k)); }
  catch(_){ try{ localStorage.setItem('diary:' + k, JSON.stringify(v)); }catch(__){} }
}
async function idbDel(k){
  try{ return await idbTx('readwrite', s => s.delete(k)); }
  catch(_){ try{ localStorage.removeItem('diary:' + k); }catch(__){} }
}

// ── 날짜 ────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0');
/** Date → 'YYYY-MM-DD' (그 Date의 로컬 기준) */
function ymd(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayStr(){ return ymd(new Date()); }
function monthOf(ds){ return ds.slice(0, 7); }

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
/**
 * 타임스탬프 문자열/숫자를 해석한다.
 *
 * 어느 "날짜"에 속하는지는 기록된 곳의 시각을 따라야 한다. 문자열에 +09:00 같은
 * 오프셋이 박혀 있으면 그 벽시계(=문자열에 적힌 연월일)를 그대로 쓰고,
 * Z(UTC)이거나 오프셋이 없으면 이 브라우저의 시간대로 환산한다.
 * (예전 Takeout의 반출 데이터는 전부 UTC라 한국이면 새벽 기록의 날짜가 밀린다)
 *
 * @returns {{ms:number, ds:string, off:(number|null)}|null}
 */
function tsInfo(v){
  if(v == null) return null;
  if(typeof v === 'number' && isFinite(v)){
    const ms = v < 1e12 ? v * 1000 : v;          // 초 단위로 온 경우 보정
    return { ms, ds: ymd(new Date(ms)), off: null };
  }
  const s = String(v).trim();
  if(!s) return null;
  if(/^-?\d{10,16}$/.test(s)) return tsInfo(Number(s));   // timestampMs 같은 숫자 문자열
  const ms = Date.parse(s);
  if(!isFinite(ms)) return null;
  const m = ISO_RE.exec(s);
  if(m && m[7] && m[7] !== 'Z'){
    const sign = m[7][0] === '-' ? -1 : 1;
    const hh = +m[7].slice(1, 3), mm = +m[7].replace(':', '').slice(3, 5);
    return { ms, ds: `${m[1]}-${m[2]}-${m[3]}`, off: sign * (hh * 60 + mm) };
  }
  return { ms, ds: ymd(new Date(ms)), off: null };
}
/** ms를 주어진 오프셋(분) 기준 날짜 문자열로. 오프셋이 없으면 브라우저 로컬. */
function dsAt(ms, off){
  if(off == null) return ymd(new Date(ms));
  return new Date(ms + off * 60000).toISOString().slice(0, 10);
}
/** ms를 주어진 오프셋 기준 'HH:MM'으로 */
function hmAt(ms, off){
  const d = off == null ? new Date(ms) : new Date(ms + off * 60000);
  return off == null ? pad2(d.getHours()) + ':' + pad2(d.getMinutes())
                     : d.toISOString().slice(11, 16);
}

// ── 거리 ────────────────────────────────────
const R_EARTH = 6371008.8;
const rad = d => d * Math.PI / 180;
/** 두 좌표 사이 거리(m) */
function haversine(a1, o1, a2, o2){
  const dLat = rad(a2 - a1), dLon = rad(o2 - o1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}
function fmtDist(m){
  if(!isFinite(m) || m <= 0) return '0 m';
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
}
function fmtDur(ms){
  if(!isFinite(ms) || ms <= 0) return '—';
  const min = Math.round(ms / 60000);
  if(min < 60) return min + '분';
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}
const fmtNum = n => (n || 0).toLocaleString('ko-KR');

// ── DOM ─────────────────────────────────────
function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const $ = id => document.getElementById(id);

let _toastTimer = null;
function showToast(msg){
  let el = $('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast'; el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

// 테마 — 학습 일지와 같은 키(theme)를 공유해 두 페이지의 설정이 함께 움직인다.
function currentTheme(){
  const a = document.documentElement.getAttribute('data-theme');
  return a || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
}
const ICON_SUN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
function applyThemeIcon(){
  const b = $('theme-toggle');
  if(b) b.innerHTML = currentTheme() === 'dark' ? ICON_SUN : ICON_MOON;
}
function toggleTheme(){
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem('theme', next); }catch(_){}
  applyThemeIcon();
  if(typeof window.onThemeChange === 'function') window.onThemeChange();
}
window.toggleTheme = toggleTheme;
matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change', () => {
  applyThemeIcon();
  if(typeof window.onThemeChange === 'function') window.onThemeChange();
});
