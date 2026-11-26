/* app-info.js — 「かさねん」「つよいん」「きどりん」共通：アプリ情報・利用上の注意・保存データ消去
 * ギジュツドットコム「教育用アプリの公開・授業利用ガイドライン」（2026-11-13制定）第2・7・8節への対応用
 * 使い方：各HTMLの </body> 直前に <script src="app-info.js?v=1.0"></script> を追加
 *        strength.html は画面を差し替えるため，strength.js が画面復元後に window.AppInfo.mount() を呼ぶ

 * Copyright (c) 2026 Hiroyuki Muramatsu / Shinshu-u
 * https://gijyutu.com/main/
 * Released under the MIT License
 */
(function(){
  if (window.AppInfo) return;

  // ===== ここを公開時に記入 =====
  const INFO = {
    version: 'Ver 2.50',
    updated: '2026年11月26日',                 // 【要記入】最終更新日
    name: 'かさねん・つよいん・きどりん',
    dataClass: 'B（利用者の端末内でのみ情報を扱うアプリ）',
    target: '主に中学校 技術・家庭科（技術分野）「材料と加工の技術」および教員研修',
    purpose: '3D CADで設計した作品のSTLを使い，形の確認（かさねん）・強度の予想（つよいん）・木取り図の作成（きどりん）を通して，設計と材料・加工のつながりを考える。',
    aiUse: '本アプリ開発には生成AIを活用しています。生成AIの出力は作成者が内容・動作を確認しています。アプリ動作中に生成AIは使用していません。',
    guidelineName: 'ギジュツドットコムにおける教育用アプリの公開・授業利用ガイドライン',
    guidelineUrl: 'https://gijyutu.com/main/app_guide',
    developer: 'Hiroyuki Muramatsu / Shinshu-u',
    contact: 'https://gijyutu.com/main/inquiry',
    license: 'MIT License',
    devices: 'Chromebook・Windows（Chrome／Edge），iPad（Safari）　画面 1366×768 以上推奨' // 【要記入】実際に動作確認した端末
  };

  const LS_KEYS = ['kidorin_current_stl','kidorin_pending_strength_stl','kidorin_session_stl',
    'kidorin_unit_mode','kidorin_pending_strength_params','kidorin_pending_strength_direction'];
  const SS_KEYS = ['kidorin_session_stl','kidorin_strength_html','kidorin_strength_html_backup','kidorin_strength_skip_intro'];
  const DBS = ['kidorin_shared_stl_db','kidorin_strength_screen_db'];

  function deleteDb(name){
    return new Promise(resolve=>{
      try{
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = ()=>resolve();
      }catch(e){ resolve(); }
    });
  }
  async function clearAll(){
    LS_KEYS.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
    SS_KEYS.forEach(k=>{ try{ sessionStorage.removeItem(k); }catch(e){} });
    if (window.indexedDB) for (const n of DBS) await deleteDb(n);
  }

  function css(){
    if (document.getElementById('app-info-style')) return;
    const s = document.createElement('style');
    s.id = 'app-info-style';
    s.textContent = `
#appInfoBtn{position:fixed;left:10px;bottom:8px;z-index:100001;padding:6px 12px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#334155;font:700 12px/1.2 system-ui,"Noto Sans JP",sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18);min-height:32px}
#appInfoModal{position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px}
#appInfoModal.open{display:flex}
#appInfoModal .card{width:min(720px,96vw);max-height:90vh;overflow:auto;background:#fff;color:#1f2937;border-radius:14px;padding:20px 24px;text-align:left;font:14px/1.75 system-ui,"Noto Sans JP",sans-serif}
#appInfoModal h2{margin:0 0 8px;font-size:18px;color:#0b57d0}
#appInfoModal h3{margin:14px 0 4px;font-size:14px;color:#0f172a}
#appInfoModal dl{display:grid;grid-template-columns:8.5em 1fr;gap:2px 10px;margin:0}
#appInfoModal dt{font-weight:700;color:#475569}#appInfoModal dd{margin:0}
#appInfoModal .notice{background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:8px 10px;font-size:13px}
#appInfoModal .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
#appInfoModal button{padding:8px 16px;border-radius:8px;border:0;font-weight:700;cursor:pointer;min-height:38px}
#appInfoClear{background:#e2e8f0;color:#334155}#appInfoClose{background:#0b57d0;color:#fff}`;
    document.head.appendChild(s);
  }

  function html(){
    return `<div class="card" role="dialog" aria-modal="true" aria-labelledby="appInfoTitle">
<h2 id="appInfoTitle">このアプリについて・利用上の注意</h2>
<dl>
<dt>アプリ名</dt><dd>「${INFO.name}」（${INFO.version}）</dd>
<dt>データ取扱い区分</dt><dd><b>${INFO.dataClass}</b></dd>
<dt>対象</dt><dd>${INFO.target}</dd>
<dt>目的</dt><dd>${INFO.purpose}</dd>
<dt>AI使用</dt><dd>${INFO.aiUse}</dd>
<dt>開発</dt><dd>${INFO.developer}</dd>
<dt>問い合わせ</dt><dd><a href="${INFO.contact}" target="_blank" rel="noopener">${INFO.contact}</a></dd>
<dt>最終更新日</dt><dd>${INFO.updated}</dd>
<dt>動作確認</dt><dd>${INFO.devices}</dd>
<dt>ライセンス</dt><dd>${INFO.license}</dd>
</dl>
<p style="margin:8px 0 0;font-size:13px">※<a href="${INFO.guidelineUrl}" target="_blank" rel="noopener">${INFO.guidelineName}</a></p>
<h3>データの取扱いについて</h3>
<ul style="margin:0 0 0 1.2em;padding:0">
<li>読み込んだSTL（ファイル名を含む）・単位設定は，3アプリで共有するため<b>このブラウザ内だけ</b>に保存します（localStorage／IndexedDB）。</li>
<li>「かさねん」のカメラ映像・背景画像・キャプチャ画像は端末内で処理し，外部へ送信しません。</li>
<li>入力したデータや作品データを，作成者・運営者・外部サービスへ送信・保存することはありません。アクセス解析も行いません。</li>
<li>外部通信は，3D表示などのプログラム（Three.js 等）を公開CDN（unpkg.com，cdn.jsdelivr.net）から読み込むことだけです。</li>
<li>下の「保存データを消去」で，このブラウザに保存したSTL等を消去できます。共用端末では授業の最後に消去してください。</li>
</ul>
<h3>利用上の注意</h3>
<div class="notice">本アプリは，教育目的で作成・公開されています。アプリの表示内容には，誤りや不適切な表現が含まれる場合があります。特に生成AIを活用して作成または動作するアプリでは，生成された内容が正確でない場合があります。学習に用いる際は，教科書，授業資料，信頼できる情報源および教員の説明と照らし合わせてください。<br>
氏名，生年月日，学校名，住所，連絡先，写真，成績，健康・相談に関する情報など，個人を特定できる情報は，教員の指示及び学校・教育委員会等の規程に基づく場合を除き，外部サービスへ送信又は保存しないでください。</div>
<ul style="margin:6px 0 0 1.2em;padding:0">
<li>STLのファイル名に，氏名など個人を特定できる情報を入れないでください（木取り図やPDFのタイトルに表示されます）。</li>
<li>「つよいん」の判定は，スギ相当の代表値を使った設計比較のための概算です。実物の安全を保証するものではなく，評価の確定結果でもありません。</li>
<li>カメラで撮影するときは，人の顔や名札などが写らないようにしましょう。</li>
<li>不適切な表示や不安を感じる内容が出た場合は，操作を止めて先生に知らせてください。</li>
</ul>
<div class="row"><button id="appInfoClear" type="button">保存データを消去</button><button id="appInfoClose" type="button">閉じる</button></div>
</div>`;
  }

  // opts.corner: 'left'（既定）／'right'（左下にパネルがある画面用）
  function mount(opts){
    if (!document.body) return;
    css();
    let b = document.getElementById('appInfoBtn');
    if (!b){
      b = document.createElement('button');
      b.id = 'appInfoBtn'; b.type = 'button'; b.textContent = 'ⓘ このアプリについて';
      b.onclick = open;
      document.body.appendChild(b);
    }
    if (opts && opts.corner === 'right'){ b.style.left = 'auto'; b.style.right = '10px'; }
    if (!document.getElementById('appInfoModal')){
      const m = document.createElement('div');
      m.id = 'appInfoModal'; m.innerHTML = html();
      m.addEventListener('click', e=>{ if (e.target === m) close(); });
      document.body.appendChild(m);
      m.querySelector('#appInfoClose').onclick = close;
      m.querySelector('#appInfoClear').onclick = async ()=>{
        if (!confirm('このブラウザに保存したSTL・設定をすべて消去します。よろしいですか？')) return;
        await clearAll();
        alert('保存データを消去しました。初期メニューに戻ります。');
        location.href = 'index.html';
      };
    }
  }
  function open(){ mount(); document.getElementById('appInfoModal').classList.add('open'); }
  function close(){ const m = document.getElementById('appInfoModal'); if (m) m.classList.remove('open'); }

  window.AppInfo = { INFO, mount, open, close, clearAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
