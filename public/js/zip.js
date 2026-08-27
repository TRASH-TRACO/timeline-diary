// ══════════════════════════════════════════
// 아주 작은 ZIP 리더 — Takeout .zip을 풀지 않고 바로 읽기 위한 것
// ══════════════════════════════════════════
// 파일 전체를 메모리에 올리지 않는다. Blob.slice로 중앙 디렉터리와
// 필요한 항목만 잘라 읽고, 압축 해제는 브라우저 내장 DecompressionStream에 맡긴다.
// (외부 라이브러리 없음 · Zip64도 처리)

const SIG_EOCD = 0x06054b50, SIG_EOCD64_LOC = 0x07064b50, SIG_EOCD64 = 0x06064b50;
const SIG_CD   = 0x02014b50, SIG_LFH = 0x04034b50;

const zipSupported = () => typeof DecompressionStream === 'function';

async function dv(blob, start, end){
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** ZIP 안의 파일 목록. @returns {Array<{name,method,cSize,uSize,offset}>} */
async function zipEntries(blob){
  const size = blob.size;
  if(size < 22) throw new Error('ZIP 파일이 아니에요');

  // 1) 끝에서부터 EOCD(중앙 디렉터리 끝 표식)를 찾는다 — 주석이 붙어 있을 수 있어 뒤로 훑는다
  const tailLen = Math.min(size, 66 * 1024);
  const tail = await dv(blob, size - tailLen, size);
  let eocd = -1;
  for(let i = tail.byteLength - 22; i >= 0; i--){
    if(tail.getUint32(i, true) === SIG_EOCD){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error('ZIP 형식을 읽지 못했어요');

  let cdCount = tail.getUint16(eocd + 10, true);
  let cdSize  = tail.getUint32(eocd + 12, true);
  let cdOff   = tail.getUint32(eocd + 16, true);

  // 2) 4GB 넘는 압축 파일(Zip64)이면 진짜 값은 별도 레코드에 있다
  if(cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF || cdCount === 0xFFFF){
    const loc = eocd - 20;
    if(loc >= 0 && tail.getUint32(loc, true) === SIG_EOCD64_LOC){
      const z64Off = Number(tail.getBigUint64(loc + 8, true));
      const z = await dv(blob, z64Off, Math.min(size, z64Off + 56));
      if(z.getUint32(0, true) === SIG_EOCD64){
        cdCount = Number(z.getBigUint64(32, true));
        cdSize  = Number(z.getBigUint64(40, true));
        cdOff   = Number(z.getBigUint64(48, true));
      }
    }
  }

  // 3) 중앙 디렉터리를 통째로 읽고 항목을 훑는다
  const cd = await dv(blob, cdOff, cdOff + cdSize);
  const dec = new TextDecoder('utf-8');
  const bytes = new Uint8Array(cd.buffer);
  const out = [];
  let p = 0;
  for(let n = 0; n < cdCount && p + 46 <= cd.byteLength; n++){
    if(cd.getUint32(p, true) !== SIG_CD) break;
    const method  = cd.getUint16(p + 10, true);
    let   cSize   = cd.getUint32(p + 20, true);
    let   uSize   = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extLen  = cd.getUint16(p + 30, true);
    const cmtLen  = cd.getUint16(p + 32, true);
    let   offset  = cd.getUint32(p + 42, true);
    const name    = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // Zip64 확장 필드 — 0xFFFFFFFF로 표시된 값만 순서대로 8바이트씩 들어 있다
    if(uSize === 0xFFFFFFFF || cSize === 0xFFFFFFFF || offset === 0xFFFFFFFF){
      let x = p + 46 + nameLen;
      const xEnd = x + extLen;
      while(x + 4 <= xEnd){
        const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
        if(id === 0x0001){
          let q = x + 4;
          if(uSize  === 0xFFFFFFFF && q + 8 <= xEnd){ uSize  = Number(cd.getBigUint64(q, true)); q += 8; }
          if(cSize  === 0xFFFFFFFF && q + 8 <= xEnd){ cSize  = Number(cd.getBigUint64(q, true)); q += 8; }
          if(offset === 0xFFFFFFFF && q + 8 <= xEnd){ offset = Number(cd.getBigUint64(q, true)); }
          break;
        }
        x += 4 + len;
      }
    }
    if(!name.endsWith('/')) out.push({ name, method, cSize, uSize, offset });
    p += 46 + nameLen + extLen + cmtLen;
  }
  return out;
}

/** 항목 하나를 텍스트로 꺼낸다. */
async function zipReadText(blob, entry){
  const lfh = await dv(blob, entry.offset, entry.offset + 30);
  if(lfh.getUint32(0, true) !== SIG_LFH) throw new Error('손상된 ZIP 항목: ' + entry.name);
  const nameLen = lfh.getUint16(26, true), extLen = lfh.getUint16(28, true);
  const start = entry.offset + 30 + nameLen + extLen;
  const data = blob.slice(start, start + entry.cSize);

  if(entry.method === 0) return data.text();                 // 무압축
  if(entry.method !== 8) throw new Error('지원하지 않는 압축 방식: ' + entry.name);
  if(!zipSupported()) throw new Error('이 브라우저는 ZIP 해제를 지원하지 않아요');
  const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

window.DiaryZip = { zipEntries, zipReadText, zipSupported };
