import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

/**
 * 이 화면이 언제 것인지 적어 둔다.
 *
 * "고쳤다는데 왜 그대로지"는 코드를 아무리 읽어도 답이 안 나온다. 올린 건 맞는데
 * 브라우저가 들고 있는 게 어느 때 것인지를 모르기 때문이다. 그래서 화면이 스스로
 * 말하게 한다 — 도움말 맨 아래 한 줄이면, 다음부터는 열어 보면 끝이다.
 *
 * Vercel은 빌드할 때 커밋 해시를 환경 변수로 준다. 그게 없으면(내 컴퓨터에서
 * 빌드할 때) git에게 직접 묻고, 그것도 안 되면 시각만 적는다.
 */
function buildStamp(){
  let sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
  if(!sha){
    try{ sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch(_){}
  }
  const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return (sha ? sha.slice(0, 7) + ' · ' : '') + at + ' UTC';
}

export default defineConfig({
  plugins: [{
    name: 'build-stamp',
    transformIndexHtml(html){ return html.split('__BUILD__').join(buildStamp()); },
  }],
});
