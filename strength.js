/*
 * きどりん 強度確認アプリ
 * kidori.html から受け取ったSTL・配置・解析条件を使い，強度確認画面を表示します。
 * データがない場合は，この画面でSTL読み込みを促し，読み込み後に強度確認へ進みます。

 * Copyright (c) 2026 Hiroyuki Muramatsu / Shinshu-u
 * https://gijyutu.com/main/
 * Released under the MIT License
 */
(function(){
  function fileToDataUrl(file){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(reader.error || new Error('ファイル読み込みに失敗しました'));
      reader.readAsDataURL(file);
    });
  }

  // ギジュツドットコム ガイドライン対応：アプリ情報・利用上の注意（app-info.js）
  function mountAppInfo(corner){
    try{ if(window.AppInfo) window.AppInfo.mount({corner: corner || 'left'}); }catch(e){}
  }

  function uploadPrompt(){
    document.body.style.cssText = 'margin:0;background:linear-gradient(160deg,#fff0f6,#f3f0ff);color:#5b4b56;font-family:\'M PLUS Rounded 1c\',system-ui,-apple-system,"Segoe UI","Noto Sans JP",sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.innerHTML = `
      <div style="width:min(760px,94vw);background:#fff;border:1px solid #ffe0ec;border-radius:18px;padding:28px;box-shadow:0 14px 42px rgba(255,140,180,.22);text-align:left;">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
          <a href="index.html" style="display:inline-block;padding:10px 16px;background:#b39aa8;color:#fff;text-decoration:none;border-radius:999px;font-weight:900;">初期メニューに戻る</a>
          <a href="kasanen.html" style="display:inline-block;padding:10px 16px;background:#4da3ff;color:#fff;text-decoration:none;border-radius:999px;font-weight:900;">「かさねん」に移動</a>
          <a href="kidori.html" style="display:inline-block;padding:10px 16px;background:#3ecf8e;color:#fff;text-decoration:none;border-radius:999px;font-weight:900;">「きどりん」に移動</a>
          <h1 style="margin:0;font-size:26px;color:#5b4b56;">「つよいん」</h1>
        </div>
        <p style="line-height:1.8;color:#5b4b56;margin:0 0 18px;">強度確認アプリ「つよいん」を始めるには，STLファイルを読み込んでください。読み込むと，自動で強度確認画面に進みます。</p>
        <div style="background:#fff5fa;border:2px dashed #ffb3d1;border-radius:14px;padding:18px;margin-bottom:18px;">
          <label for="strength-start-stl" style="display:block;font-weight:900;margin-bottom:10px;color:#ff5c8a;">STLファイルを読み込む</label>
          <input id="strength-start-stl" type="file" accept=".stl" style="font-size:15px;max-width:100%;">
          <div id="strength-start-status" style="font-size:13px;color:#6b5866;margin-top:10px;">未選択</div>
        </div>
        <p style="font-size:12px;color:#8a7480;line-height:1.7;margin:0;">読み込んだSTLは，「かさねん」・「つよいん」・「きどりん」で共通に使えます。STLはこの端末のブラウザ内だけに保存され，外部には送信しません。</p>
        <p style="font-size:12px;color:#9a3412;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:6px 10px;line-height:1.6;margin:10px 0 0;">※ファイル名に氏名など個人が分かる情報を入れないでください（木取り図に表示されます）。</p>
      </div>`;
    mountAppInfo('left');
    const input = document.getElementById('strength-start-stl');
    const status = document.getElementById('strength-start-status');
    input.addEventListener('change', async ()=>{
      const file = input.files && input.files[0];
      if(!file) return;
      try{
        status.textContent = '読み込み中：' + file.name;
        const dataUrl = await fileToDataUrl(file);
        const payload = JSON.stringify({
          name: file.name || 'model.stl',
          dataUrl
        });
        if(window.SharedStl) {
          window.SharedStl.set({ name: file.name || 'model.stl', dataUrl }, {pending:true});
        } else {
          localStorage.setItem('kidorin_current_stl', payload);
          localStorage.setItem('kidorin_pending_strength_stl', payload);
        }
        window.location.href = 'kidori.html?openStrength=1&headless=1';
      }catch(err){
        status.textContent = '読み込みに失敗しました。別のSTLで試してください。';
        alert('STLの読み込みに失敗しました: ' + (err && err.message ? err.message : err));
      }
    });
  }

  async function loadStrengthHtmlForTransition(){
    const DB_NAME = 'kidorin_strength_screen_db';
    const STORE = 'screens';
    const KEY = 'current';
    if (window.indexedDB) {
      try {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('強度画面用データベースを開けませんでした'));
        });
        try {
          const html = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(KEY);
            req.onsuccess = () => resolve(req.result || '');
            req.onerror = () => reject(req.error || new Error('強度画面を読み出せませんでした'));
          });
          if (html) return html;
        } finally {
          db.close();
        }
      } catch(e) {
        console.warn('IndexedDBから強度画面を読み出せませんでした', e);
      }
    }
    try { return sessionStorage.getItem('kidorin_strength_html') || ''; }
    catch(e) { return ''; }
  }

  const EXPECTED_RENDER_VERSION = '12.1';

  function strengthHtmlVersion(html){
    const match = String(html || '').match(/<meta\s+name=["']tsuyoin-render-version["']\s+content=["']([^"']+)["']/i)
      || String(html || '').match(/<meta\s+content=["']([^"']+)["']\s+name=["']tsuyoin-render-version["']/i);
    return match ? String(match[1]) : '';
  }

  async function clearStoredStrengthHtml(){
    try { sessionStorage.removeItem('kidorin_strength_html'); } catch(e) {}
    try { sessionStorage.removeItem('kidorin_strength_html_backup'); } catch(e) {}
    if (!window.indexedDB) return;
    const DB_NAME = 'kidorin_strength_screen_db';
    const STORE = 'screens';
    const KEY = 'current';
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('強度画面用データベースを開けませんでした'));
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(KEY);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('古い強度画面を削除できませんでした'));
          tx.onabort = () => reject(tx.error || new Error('古い強度画面の削除が中断されました'));
        });
      } finally { db.close(); }
    } catch(e) {
      console.warn('古い強度画面を削除できませんでした', e);
    }
  }

  async function regenerateStrengthScreen(){
    await clearStoredStrengthHtml();
    try { sessionStorage.setItem('kidorin_strength_skip_intro','1'); } catch(e) {}
    const url = 'kidori.html?openStrength=1&headless=1&render=' + encodeURIComponent(EXPECTED_RENDER_VERSION) + '&t=' + Date.now();
    window.location.replace(url);
  }

  async function renderStrengthHtml(html){
    // 非同期処理後の document.write() は、ブラウザによって埋め込み script が
    // 実行されないことがある。HTML本体を配置してから script を記載順に実行する。
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const scripts = Array.from(parsed.querySelectorAll('script'));
    scripts.forEach(function(script){ script.remove(); });

    document.title = parsed.title || document.title;
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;

    for (const source of scripts) {
      await new Promise(function(resolve, reject){
        const script = document.createElement('script');
        for (const attr of Array.from(source.attributes || [])) {
          script.setAttribute(attr.name, attr.value);
        }
        if (source.src) {
          script.onload = resolve;
          script.onerror = function(){ reject(new Error('描画ライブラリを読み込めませんでした: ' + source.src)); };
          document.body.appendChild(script);
        } else {
          try {
            script.textContent = source.textContent || '';
            document.body.appendChild(script);
            resolve();
          } catch(e) { reject(e); }
        }
      });
    }
  }




  loadStrengthHtmlForTransition().then(async function(html){
    if(!html){ uploadPrompt(); return; }
    const storedVersion = strengthHtmlVersion(html);
    if(storedVersion !== EXPECTED_RENDER_VERSION){
      console.info('古い強度画面を再生成します', {storedVersion, expected:EXPECTED_RENDER_VERSION});
      await regenerateStrengthScreen();
      return;
    }
    await renderStrengthHtml(html);

    // 生成画面の初期化後に、既存の補助UIだけを適用する。
    setTimeout(patchNavigation, 200);
    setTimeout(patchNavigation, 800);
    setTimeout(improveLeftColumnReadability, 250);
    setTimeout(improveLeftColumnReadability, 850);
    setTimeout(createStudentUi, 300);
    setTimeout(createStudentUi, 1000);
    // 画面を差し替えたため，「このアプリについて」ボタンを付け直す（左下は判定パネルがあるので右下へ）
    setTimeout(function(){ mountAppInfo('right'); }, 1100);
  }).catch(function(err){
    console.error(err);
    const status = document.getElementById('viewerStatus');
    if(status){
      status.style.display = 'block';
      status.textContent = '3D表示の初期化に失敗しました: ' + (err && err.message ? err.message : err);
    } else {
      uploadPrompt();
    }
  });

  function getParamsFromStrengthPage(){
    function v(id){ const el=document.getElementById(id); return el ? el.value : ''; }
    return {
      bookCount: v('pBookCount'),
      bookWeight: v('pBookWeight'),
      thicknessMode: v('pThicknessMode'),
      memberThickness: v('pMemberThickness'),
      materialKey: v('pMaterial'),
      supportKey: v('pSupport'),
      jointMethod: v('pJoint'),
      femElements: v('pFem')
    };
  }

  function patchNavigation(){
    const closeTop = document.getElementById('closeTop');
    if(closeTop){
      closeTop.onclick = function(e){
        if(e) e.preventDefault();
        window.location.href = 'index.html';
      };
    }

    if(closeTop){
      closeTop.textContent = '初期メニューに戻る';
      closeTop.style.cssText = 'display:inline-flex;align-items:center;padding:10px 16px;border-radius:999px;background:#b39aa8;color:#fff;font-weight:900;text-decoration:none;font-size:15px;cursor:pointer;border:none;box-shadow:0 4px 14px rgba(179,154,168,.28);';
    }

    let titleRow = document.querySelector('.head-title-row');
    if(titleRow && closeTop && !document.getElementById('tsuyoinTitleBadge')){
      const badge = document.createElement('span');
      badge.id = 'tsuyoinTitleBadge';
      badge.textContent = '「つよいん」';
      badge.style.cssText = 'display:inline-flex;align-items:center;padding:10px 14px;border-radius:999px;background:#ff9142;color:#fff;font-size:18px;font-weight:900;box-shadow:0 4px 14px rgba(255,145,66,.28);';
      titleRow.insertBefore(badge, closeTop);
    }
    if(titleRow && !document.getElementById('goKasanenTop')){
      const btnAr = document.createElement('button');
      btnAr.id = 'goKasanenTop';
      btnAr.type = 'button';
      btnAr.textContent = '「かさねん」に移動';
      btnAr.style.cssText = 'background:#4da3ff;color:#fff;border:0;border-radius:999px;padding:10px 14px;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 4px 14px rgba(77,163,255,.28);';
      btnAr.onclick = function(e){ if(e) e.preventDefault(); window.location.href = 'kasanen.html'; };
      if(closeTop && closeTop.nextSibling){ titleRow.insertBefore(btnAr, closeTop.nextSibling); }
      else { titleRow.insertBefore(btnAr, titleRow.firstChild); }
    }

    if(titleRow && !document.getElementById('goKidoriTop')){
      const btn = document.createElement('button');
      btn.id = 'goKidoriTop';
      btn.type = 'button';
      btn.textContent = '「きどりん」に移動';
      btn.style.cssText = 'background:#3ecf8e;color:#fff;border:0;border-radius:999px;padding:10px 14px;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 4px 14px rgba(62,207,142,.28);';
      btn.onclick = function(e){
        if(e) e.preventDefault();
        window.location.href = 'kidori.html?fromStrength=1';
      };
      const arBtn = document.getElementById('goKasanenTop');
      if(arBtn && arBtn.nextSibling) titleRow.insertBefore(btn, arBtn.nextSibling);
      else if(closeTop && closeTop.nextSibling){ titleRow.insertBefore(btn, closeTop.nextSibling); }
      else { titleRow.insertBefore(btn, titleRow.firstChild); }
    }

    // 「初期メニューに戻る」を一番左に表示（見た目の並べ替えのみで，クリック先・処理は不変）
    if(titleRow && closeTop && titleRow.firstElementChild !== closeTop){
      titleRow.insertBefore(closeTop, titleRow.firstElementChild);
    }

    const rerun = document.getElementById('rerun');
    if(rerun){
      rerun.onclick = function(e){
        if(e) e.preventDefault();
        try{
          localStorage.setItem('kidorin_pending_strength_params', JSON.stringify(getParamsFromStrengthPage()));
          localStorage.setItem('kidorin_pending_strength_direction', currentDirection());
          sessionStorage.setItem('kidorin_strength_skip_intro','1');
          window.location.href = 'kidori.html?openStrength=1&headless=1';
        }catch(err){
          alert('再計算の準備に失敗しました: ' + (err && err.message ? err.message : err));
        }
      };
    }

    const input = document.getElementById('strengthStlInput');
    if(input){
      input.onchange = async function(){
        const file = input.files && input.files[0];
        if(!file) return;
        try{
          localStorage.setItem('kidorin_pending_strength_params', JSON.stringify(getParamsFromStrengthPage()));
          const dataUrl = await fileToDataUrl(file);
          const payload = JSON.stringify({
            name: file.name || 'model.stl',
            dataUrl
          });
          if(window.SharedStl) window.SharedStl.set({ name: file.name || 'model.stl', dataUrl }, {pending:true});
          else {
            localStorage.setItem('kidorin_current_stl', payload);
            localStorage.setItem('kidorin_pending_strength_stl', payload);
          }
          window.location.href = 'kidori.html?openStrength=1&headless=1';
        }catch(err){
          alert('STLの受け渡しに失敗しました: ' + (err && err.message ? err.message : err));
        }
      };
    }
  }

  // ===== 左カラム（設定・部品表まわり）の視認性を自動で底上げする =====
  // kidori.js側が生成した見た目には手を入れず，実際に描画された文字色と背景色の
  // コントラスト比だけを見て，読みにくい組み合わせを安全な色に置き換える。
  // （計算・イベント処理には一切触れない，見た目だけの後処理）
  function parseRgbColor(str){
    const m = str && str.match(/rgba?\(([^)]+)\)/);
    if(!m) return null;
    const parts = m[1].split(',').map(function(s){ return parseFloat(s); });
    if(parts.length < 3) return null;
    return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]];
  }
  function relLuminance(rgb){
    const c = rgb.slice(0,3).map(function(v){
      v = v/255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  }
  function contrastRatio(l1, l2){
    const a = Math.max(l1,l2) + 0.05;
    const b = Math.min(l1,l2) + 0.05;
    return a/b;
  }
  function effectiveBgLuminance(el){
    let node = el;
    while(node){
      const cs = getComputedStyle(node);
      const bg = parseRgbColor(cs.backgroundColor);
      if(bg && bg[3] > 0.4) return relLuminance(bg);
      node = node.parentElement;
    }
    return relLuminance([255,255,255]);
  }
  function findLeftColumn(){
    const canvas = document.querySelector('canvas');
    if(!canvas) return null;
    let node = canvas;
    while(node && node.parentElement){
      const parent = node.parentElement;
      const kids = Array.prototype.filter.call(parent.children, function(c){ return c.nodeType === 1; });
      if(kids.length === 2){
        const idx = kids.indexOf(node);
        return kids[idx === 0 ? 1 : 0];
      }
      node = parent;
    }
    return null;
  }
  function improveLeftColumnReadability(){
    const root = findLeftColumn();
    if(!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let el;
    while((el = walker.nextNode())){
      let hasDirectText = false;
      for(let i=0; i<el.childNodes.length; i++){
        const n = el.childNodes[i];
        if(n.nodeType === 3 && n.textContent.trim()){ hasDirectText = true; break; }
      }
      if(!hasDirectText) continue;
      const cs = getComputedStyle(el);
      const curColor = parseRgbColor(cs.color);
      if(!curColor) continue;
      const bgLum = effectiveBgLuminance(el);
      const curLum = relLuminance(curColor);
      const ratio = contrastRatio(bgLum, curLum);
      if(ratio < 3.6){
        el.style.color = bgLum > 0.5 ? '#3d2a35' : '#ffeaf3';
      }
    }
  }



  // ===== 中学1年生向け「つよいん」表示 =====
  function ensureStudentStyles(){
    if(document.getElementById('tsuyoinStudentCss')) return;
    const link=document.createElement('link');
    link.id='tsuyoinStudentCss'; link.rel='stylesheet'; link.href='style.css?v=9.8';
    document.head.appendChild(link);
  }

  function dispatch(el, type){ if(!el) return; el.dispatchEvent(new Event(type,{bubbles:true})); }
  function clickById(id){ const el=document.getElementById(id); if(el) el.click(); }
  function currentDirection(){
    if(document.getElementById('dirLeft')?.classList.contains('active')) return 'left';
    if(document.getElementById('dirRight')?.classList.contains('active')) return 'right';
    return 'top';
  }
  const TEXTBOOK_KG = 0.5;
  function weightLevelFromKg(kg){ return kg <= 3 ? 'light' : (kg <= 7 ? 'normal' : 'heavy'); }
  function weightSettings(level){
    return level==='light' ? {count:4, each:TEXTBOOK_KG, kg:2} : level==='heavy' ? {count:20, each:TEXTBOOK_KG, kg:10} : {count:10, each:TEXTBOOK_KG, kg:5};
  }
  function kgBooksText(kg){
    const value=Math.max(0,Number(kg)||0);
    return value.toFixed(1).replace(/\.0$/,'')+'kg（技術の教科書約'+Math.round(value/TEXTBOOK_KG)+'冊分）';
  }
  function weightLabel(level){ return level==='light'?'軽い':(level==='heavy'?'重い':'ふつう'); }
  function updateViewerForceDisplay(){
    const slider=document.getElementById('loadSlider');
    const kg=slider ? Number(slider.value)||0 : ((Number(document.getElementById('pBookCount')?.value)||0)*(Number(document.getElementById('pBookWeight')?.value)||TEXTBOOK_KG));
    const el=document.getElementById('forceLevelDisplay');
    if(el) el.textContent=weightLabel(weightLevelFromKg(kg))+'　'+kgBooksText(kg);
  }
  function jointValue(v){ return v==='glue'?'glue':v==='nails'?'nails':'glue_nails'; }

  function updateStudentResult(){
    const big=document.getElementById('bigResult');
    const card=document.getElementById('studentResultCard');
    if(!big || !card) return;
    const cls=big.classList.contains('danger')?'danger':big.classList.contains('caution')?'caution':'safe';
    const label=cls==='danger'?'見直したい':cls==='caution'?'確かめたい':'余裕あり';
    const dir=currentDirection();
    let weak='大きな問題は見つかっていません';
    let reason='この条件では，計算上の負担は比較的小さそうです。';
    let hints=['重さを増やしたときの変化も確かめてみよう'];
    const report=document.getElementById('report');
    const globalDanger=report && report.querySelector('.global-check.danger');
    const globalCaution=report && report.querySelector('.global-check.caution');
    const dangerRow=report && report.querySelector('.strength-row-danger');
    const cautionRow=report && report.querySelector('.strength-row-caution');
    const memberRow=dangerRow||cautionRow;
    let memberWeak='';
    if(memberRow){
      const cells=memberRow.querySelectorAll('td');
      if(cells[0]) memberWeak=cells[0].textContent.trim();
    }
    const hasOverturn=dir==='side' && !!(globalDanger||globalCaution);
    const hasMemberRisk=!!memberWeak;
    if(hasOverturn && hasMemberRisk){
      weak=memberWeak+'の曲げ・付け根・接合部／作品全体の転倒';
    }else if(hasOverturn){
      weak='作品全体の転倒';
    }else if(hasMemberRisk){
      weak=memberWeak;
    }
    if(dir==='top'){
      const topCantileverSide=!!(report && /上部側板を片持ち|上部左右の片持ち側板|上部の短い側板|top_cantilever_side_plate|top_composite_cantilever_side_plates/.test(report.textContent || ''));
      const cantileverTop=!!(report && /片持ち|片側だけ固定|自由端/.test(report.textContent || ''));
      if(topCantileverSide){
        reason=cls==='safe'
          ? '上部左右の張り出した側板へ本の重さを分け，側板の下向き曲げと背板との付け根を計算しています。この条件では計算上の余裕がありそうです。'
          : '本の重さによって，上部の張り出した側板が下向きに曲がり，背板との付け根の接着面や釘に負担が集中します。';
        hints=['水平な棚板を追加する','側板の張り出しを短くする','側板を厚くする','付け根の接合面積を広げる','棚受けを追加する','接着剤と釘を併用する'];
      }else if(cantileverTop){
        reason=cls==='safe'
          ? '片持ち棚板として，自由端に重さを置き，板の曲げと付け根の接合部を計算しています。この条件では計算上の余裕がありそうです。'
          : '片持ち棚板では，自由端に置いた重さによって，板の曲げよりも付け根の接合部へ大きな負担が集まることがあります。';
        hints=['付け根の接合面積を広げる','棚受けや側板を追加する','接着剤と釘を併用する','板を厚くする','張り出す長さを短くする'];
      }else{
        reason=cls==='safe'?'上からの重さを，各部品へ分けた計算では余裕がありそうです。':'上から重さがかかると，板の中央やつなぎ目に負担が集まりやすくなります。';
        hints=['板を厚くする','支える板や脚を増やす','板の長さを短くする'];
      }
    }else{
      if(cls==='safe'){
        reason='横から押す力を分けた計算では，横ゆれ・部材・接合部・転倒の負担は小さそうです。';
        hints=['力を大きくしたときの変化も確かめてみよう'];
      }else if((globalDanger||globalCaution) && memberWeak){
        reason=memberWeak+'に曲げや付け根・接合部の大きな負担が生じており，あわせて作品全体が転倒する可能性もあります。';
        hints=['底面を広くする','重心を低くする','壁や床に固定する','側板を厚くする','付け根の接合面積を広げる','補強材を追加する'];
      }else if(globalDanger||globalCaution){
        reason='背板などで横ゆれが抑えられていても，作品全体の重さ・底面の広さ・押す高さによって転倒する可能性があります。';
        hints=['底面を広くする','重心を低くする','下段に重い物を置く','壁や床に固定する','押す位置を低くする'];
      }else{
        reason='横から押されると，'+(memberWeak||'側板')+'の曲げや付け根・つなぎ目に負担が集まりやすくなります。';
        hints=['側板を厚くする','付け根の接合面積を広げる','補強材を追加する','接着剤と釘を組み合わせる'];
      }
    }
    card.className='student-result-card '+cls;
    const slider=document.getElementById('loadSlider');
    const kg=slider ? Number(slider.value)||0 : 0;
    card.innerHTML='<div class="student-judge">判定：'+label+'</div><div class="student-force">力の大きさ：'+weightLabel(weightLevelFromKg(kg))+'　'+kgBooksText(kg)+'</div><div><b>弱そうなところ：</b>'+weak+'</div><div><b>なぜ？：</b>'+reason+'</div><div><b>どう直す？：</b>'+hints.join('・')+'</div><div class="student-note">※計算上の予想です。正解や評価の確定ではありません。設計を見直すきっかけとして，試作や先生の説明と合わせて確かめましょう。</div>';
    updateViewerForceDisplay();
    const est=document.getElementById('failureEstimateCard');
    if(est) est.hidden = dir!=='top';
  }

  function estimateFailureLoads(){
    const card=document.getElementById('failureEstimateCard');
    if(!card || currentDirection()!=='top') return;
    // リスクは荷重に比例してスケールする（scaledRisksForKeyと同じ前提）ため，
    // スライダーを実際に動かして3Dシーンを何度も更新しなくても，
    // 判定が変わる重さは比例計算だけで求められる。
    // （以前はスライダーを0.5kg刻みで最大120回動かしており，そのたびに
    //   荷重CGの色・曲がり方が一瞬ちらつく原因になっていた）
    const key=typeof riskKeyForDir==='function' ? riskKeyForDir(FORCE_DIR) : 'top';
    const base=(typeof BASE_RISK_SETS!=='undefined' && BASE_RISK_SETS[key]) || [];
    let maxBaseRisk=0;
    base.forEach(r=>{ if(r && Number.isFinite(r.risk)) maxBaseRisk=Math.max(maxBaseRisk, r.risk); });
    const gbrSrc=typeof BASE_GLOBAL_RISK_SETS!=='undefined' ? BASE_GLOBAL_RISK_SETS[key] : null;
    const gbr=gbrSrc && Number(gbrSrc.risk);
    if(Number.isFinite(gbr)) maxBaseRisk=Math.max(maxBaseRisk, gbr);
    const slider=document.getElementById('loadSlider');
    const max=Math.max(0, (slider && Number(slider.max)) || 30);
    const baseLoadKg=typeof BASE_LOAD_KG!=='undefined' ? BASE_LOAD_KG : 1;
    let caution=null,danger=null;
    if(maxBaseRisk>0 && baseLoadKg>0){
      const kgAtRisk=(riskLevel)=>Math.round((riskLevel*baseLoadKg/maxBaseRisk)*2)/2;
      const cautionKg=kgAtRisk(.42);
      const dangerKg=kgAtRisk(.72);
      if(cautionKg<=max) caution=cautionKg;
      if(dangerKg<=max) danger=dangerKg;
    }
    const safe = caution===null ? max : Math.max(0,caution-0.5);
    card.innerHTML='<h3>判定が変わる重さの目安</h3><div><b>余裕あり：</b>'+kgBooksText(safe)+'くらいまで</div><div><b>確かめたい：</b>'+(caution===null?'この範囲では見つかりません':kgBooksText(caution)+'付近から')+'</div><div><b>見直したい：</b>'+(danger===null?'この範囲では見つかりません':kgBooksText(danger)+'付近から')+'</div><p>技術の教科書1冊を約500gとして換算しています。スギ相当の代表値を使った設計比較の目安であり，実物の安全を保証するものではありません。</p>';
  }

  function openDetailedReportWindow(){
    const report=document.getElementById('report');
    if(!report){ alert('詳しい説明を表示できませんでした。'); return; }
    const force=document.getElementById('forceLevelDisplay')?.textContent || '';
    const judge=document.querySelector('#bigResult .judge-text')?.textContent || document.getElementById('bigResult')?.textContent || '';
    const w=window.open('about:blank','tsuyoinDetail_'+Date.now(),'popup=yes,width=980,height=720,resizable=yes,scrollbars=yes');
    if(!w){ alert('別ウインドウが開けません。ポップアップを許可してください。'); return; }
    const reportHtml=report.innerHTML;
    const html='<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>つよいん 詳しい説明</title><style>'+
      '*{box-sizing:border-box}html,body{margin:0;background:#f8fafc;color:#172033;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans JP",sans-serif}body{padding:18px}.wrap{max-width:1100px;margin:0 auto}.head{position:sticky;top:0;z-index:2;background:#fff;border:2px solid #94a3b8;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:0 6px 18px rgba(15,23,42,.12)}h1{font-size:22px;margin:0 0 8px}.judge{font-size:18px;font-weight:900;color:#0f172a}.force{margin-top:5px;font-weight:800;color:#1e3a5f}.close{float:right;border:0;border-radius:9px;background:#475569;color:#fff;padding:9px 16px;font-weight:800;cursor:pointer}.report{background:#fff;border:1px solid #cbd5e1;border-radius:14px;padding:14px;overflow:auto}.strength-summary{font-size:14px;line-height:1.7;color:#1f2937}.strength-table{width:100%;border-collapse:collapse;font-size:13px;color:#111;background:#fff}.strength-table th,.strength-table td{border:1px solid #94a3b8;padding:7px 8px;vertical-align:top;text-align:left}.strength-table th{background:#e2e8f0;color:#0f172a}.strength-row-safe td{background:#ecfdf5}.strength-row-caution td{background:#fffbeb}.strength-row-danger td{background:#fef2f2}.global-check{border:2px solid #16a34a;background:#ecfdf5;color:#111;border-radius:10px;padding:10px;margin:9px 0}.global-check.caution{border-color:#d97706;background:#fffbeb}.global-check.danger{border-color:#dc2626;background:#fef2f2}.sub{color:#475569;font-size:12px}@media(max-width:700px){body{padding:8px}.head{padding:11px}.strength-table{font-size:11px;min-width:700px}.report{overflow:auto;padding:8px}}'+
      '</style></head><body><div class="wrap"><div class="head"><button class="close" onclick="window.close()">閉じる</button><h1>詳しい説明</h1><div class="judge">'+judge+'</div><div class="force">'+force+'</div></div><div class="report">'+reportHtml+'</div></div></body></html>';
    w.document.open(); w.document.write(html); w.document.close();
  }

  function createStudentUi(){
    ensureStudentStyles();
    if(document.getElementById('studentSimplePanel')) return;
    const panel=document.querySelector('.panel');
    if(!panel) return;
    const simple=document.createElement('section'); simple.id='studentSimplePanel'; simple.className='student-simple-panel';
    const total=(Number(document.getElementById('pBookCount')?.value)||10)*(Number(document.getElementById('pBookWeight')?.value)||0.5);
    simple.innerHTML=`<h2>かんたん設定</h2>
      <div class="student-control"><span>力のかけ方</span><div class="seg"><button data-dir="top">上から</button><button data-dir="left">左から</button><button data-dir="right">右から</button></div></div>
      <div class="student-control student-weight-control"><span>力の大きさ</span><div class="seg"><button data-weight="light"><span>軽い</span><small>2kg（約4冊）</small></button><button data-weight="normal"><span>ふつう</span><small>5kg（約10冊）</small></button><button data-weight="heavy"><span>重い</span><small>10kg（約20冊）</small></button></div></div>
      <div class="student-control"><label for="studentJoint">つなぎ方</label><select id="studentJoint"><option value="glue">接着剤</option><option value="nails">釘</option><option value="glue_nails">接着剤＋釘</option></select></div>
      <button id="studentRun" class="student-run">この条件で調べる</button>
      <details class="student-details"><summary>先生・発展学習向けの詳しい設定</summary><div id="advancedSettingsSlot"></div></details>`;
    panel.insertBefore(simple,panel.firstChild);
    const param=document.querySelector('.param-box');
    const slot=document.getElementById('advancedSettingsSlot'); if(param&&slot) slot.appendChild(param);
    const level=weightLevelFromKg(total);
    simple.querySelector('[data-weight="'+level+'"]').classList.add('active');
    const j=document.getElementById('pJoint'); document.getElementById('studentJoint').value=jointValue(j?.value);

    let autoRerunTimer=null;
    function savePendingDirection(dir){
      try{ localStorage.setItem('kidorin_pending_strength_direction', dir || currentDirection()); }catch(e){}
    }
    function runCurrentConditions(){
      const joint=document.getElementById('studentJoint');
      if(joint && document.getElementById('pJoint')) document.getElementById('pJoint').value=joint.value;
      savePendingDirection(currentDirection());
      try{ sessionStorage.setItem('kidorin_strength_skip_intro','1'); }catch(e){}
      clickById('rerun');
    }
    function scheduleAutoRerun(){
      if(autoRerunTimer) clearTimeout(autoRerunTimer);
      autoRerunTimer=setTimeout(runCurrentConditions,160);
    }

    let pendingDir='';
    try{ pendingDir=localStorage.getItem('kidorin_pending_strength_direction') || ''; }catch(e){}
    if(pendingDir==='top' || pendingDir==='left' || pendingDir==='right'){
      clickById('dir'+pendingDir[0].toUpperCase()+pendingDir.slice(1));
    }
    const initialDir=currentDirection();
    simple.querySelectorAll('[data-dir]').forEach(x=>x.classList.toggle('active',x.dataset.dir===initialDir));

    simple.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{
      const dir=b.dataset.dir;
      clickById('dir'+dir[0].toUpperCase()+dir.slice(1));
      simple.querySelectorAll('[data-dir]').forEach(x=>x.classList.toggle('active',x===b));
      savePendingDirection(dir);
      updateStudentResult();
      estimateFailureLoads();
    });
    simple.querySelectorAll('[data-weight]').forEach(b=>b.onclick=()=>{
      const w=weightSettings(b.dataset.weight);
      document.getElementById('pBookCount').value=w.count;
      document.getElementById('pBookWeight').value=w.each;
      const slider=document.getElementById('loadSlider');
      if(slider){slider.value=w.kg;dispatch(slider,'input');}
      simple.querySelectorAll('[data-weight]').forEach(x=>x.classList.toggle('active',x===b));
      document.body.dataset.loadLevel=b.dataset.weight;
      updateStudentResult();
    });
    document.getElementById('studentJoint').addEventListener('change',()=>{
      document.getElementById('pJoint').value=document.getElementById('studentJoint').value;
      scheduleAutoRerun();
    });
    const runBtn=document.getElementById('studentRun');
    runBtn.textContent='この条件でもう一度調べる';
    runBtn.onclick=runCurrentConditions;
    const result=document.createElement('section'); result.id='studentResultCard'; result.className='student-result-card'; simple.insertAdjacentElement('afterend',result);
    const failure=document.createElement('section'); failure.id='failureEstimateCard'; failure.className='failure-estimate-card'; result.insertAdjacentElement('afterend',failure);
    const report=document.getElementById('report');
    if(report && !document.getElementById('studentReportButton')){
      report.style.display='none';
      const detailBtn=document.createElement('button');
      detailBtn.id='studentReportButton'; detailBtn.type='button'; detailBtn.className='student-report-button';
      detailBtn.textContent='詳しい説明を見る';
      detailBtn.onclick=openDetailedReportWindow;
      failure.insertAdjacentElement('afterend',detailBtn);
    }
    ['dirTop','dirLeft','dirRight'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>setTimeout(()=>{updateStudentResult();estimateFailureLoads();},20)));
    document.getElementById('loadSlider')?.addEventListener('input',()=>setTimeout(updateStudentResult,0));
    updateStudentResult(); estimateFailureLoads();
  }

  // 補助UIの適用は、IndexedDBから画面を復元した直後に実行する。
})();
