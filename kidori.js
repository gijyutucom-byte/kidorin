/*
 * STLから木取り図作成「きどりん」
 * Copyright (c) 2026 Hiroyuki Muramatsu / Shinshu-u
 * https://gijyutu.com/main/
 * Released under the MIT License
 */

/* ===== 入力：全角→半角／数値以外を除去（板サイズ・間隔） =====
  - 全角数字や全角記号（．－）が入っても半角へ変換します
  - 数値以外の文字は無視（自動で削除）します
*/
function toHalfWidth(str){
  if (str == null) return '';
  return String(str)
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[．]/g, '.')
    .replace(/[－]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[，]/g, ',')
    .replace(/[　\s]/g, '');
}
// keep only numeric characters, allow one leading sign and one dot
function sanitizeNumericString(str){
  const s = toHalfWidth(str);
  let t = s.replace(/[^0-9.+-]/g, '');
  // allow only one leading sign
  t = t.replace(/[+-]/g, (m, offset)=> (offset===0 ? m : ''));
  // allow only one dot
  const firstDot = t.indexOf('.');
  if (firstDot !== -1){
    t = t.slice(0, firstDot+1) + t.slice(firstDot+1).replace(/\./g,'');
  }
  return t;
}
function normalizeNumericInput(el){
  if (!el) return;
  const before = el.value ?? '';
  const after = sanitizeNumericString(before);
  if (before !== after) el.value = after;
}

// 切断線の凡例（板1の上）を表示するための上方向の余白(mm)
const TOP_PAD = 16;

/* ===== 単位切替（mm / cm） ===== */
let unitMode = 'mm';
try { unitMode = localStorage.getItem('kidorin_unit_mode') || 'mm'; } catch(e){}
/** 入力値を内部mm値に変換する係数（cm→mm: ×10, mm→mm: ×1） */
function unitInputToMm(val) { return unitMode === 'cm' ? val * 10 : val; }
/** 内部mm値を表示値に変換（mm→cm: ÷10, mm→mm: ×1） */
function mmToDisplay(mmVal) { return unitMode === 'cm' ? mmVal / 10 : mmVal; }
/** 現在の単位ラベル */
function unitLabel() { return unitMode; }
/** 面積の単位ラベル */
function unitAreaLabel() { return unitMode === 'cm' ? 'cm²' : 'mm²'; }
/** 寸法テキスト（丸め付き） */
function formatDim(mmVal) {
  const v = mmToDisplay(mmVal);
  return String(Math.round(v * 10) / 10);
}
/** 寸法テキスト（整数丸め + 単位） */
function dimWithUnit(mmVal) {
  return Math.round(mmToDisplay(mmVal)) + ' ' + unitLabel();
}

const PART_COLORS = ['#dbeafe','#fde68a','#fecdd3','#d1fae5','#e9d5ff','#fed7aa','#bfdbfe','#fbcfe8','#fde2e4','#ddd6fe','#c7f9cc','#faedcd'];
const partColorMap = new Map();

function formatMm(value){
  return String(Math.round((Number(value) || 0) * 10) / 10);
}
function toPartKey(w, h){
  const a = Math.round(Math.max(w, h));
  const b = Math.round(Math.min(w, h));
  return `${a}x${b}`;
}

/**
 * 形状を考慮したパーツキーを生成する。
 * 投影三角形の頂点を正規化・量子化して文字列化し、寸法キーと結合する。
 * 同寸法でも輪郭（形状）が異なる部品には別の色が割り当てられる。
 */
function toShapeKey(w, h, projection, bounds){
  const dimKey = toPartKey(w, h);
  // 頂点を [0,100] の格子に正規化して量子化（浮動小数点の誤差を吸収）
  const Q = 4; // 量子化ステップ（mm単位で丸め）
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const vset = new Set();
  projection.forEach(tri => {
    [tri.p1, tri.p2, tri.p3].forEach(p => {
      const nx = Math.round((p.x - bounds.minX) / rangeX * 100 / Q) * Q;
      const ny = Math.round((p.y - bounds.minY) / rangeY * 100 / Q) * Q;
      vset.add(`${nx},${ny}`);
    });
  });
  const shapeHash = Array.from(vset).sort().join('|');
  return `${dimKey}__${shapeHash}`;
}
function getColorForPartKey(key){
  if (!partColorMap.has(key)) partColorMap.set(key, PART_COLORS[partColorMap.size % PART_COLORS.length]);
  return partColorMap.get(key);
}
function rotatedBBoxRel(w,h,angleDeg){
  const rad = angleDeg * Math.PI/180;
  const cx = w/2, cy = h/2;
  const pts = [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}].map(p=>{
    const dx=p.x-cx, dy=p.y-cy;
    return {x: dx*Math.cos(rad) - dy*Math.sin(rad) + cx, y: dx*Math.sin(rad) + dy*Math.cos(rad) + cy};
  });
  const minX=Math.min(...pts.map(p=>p.x));
  const maxX=Math.max(...pts.map(p=>p.x));
  const minY=Math.min(...pts.map(p=>p.y));
  const maxY=Math.max(...pts.map(p=>p.y));
  return {minX, minY, maxX, maxY, width:maxX-minX, height:maxY-minY};
}
function getBoardsSpecSafe(){
  return (window.sheets && Array.isArray(window.sheets)) ? window.sheets : getBoardsSpec();
}
function findBoardForPart(partEl, specs){
  specs = specs || getBoardsSpecSafe();
  const w = parseFloat(partEl.dataset.partW || '0') || 0;
  const h = parseFloat(partEl.dataset.partH || '0') || 0;
  const y = parseFloat(partEl.dataset.y || '0') || 0;
  const angle = parseFloat(partEl.dataset.angle || '0') || 0;
  const bb = rotatedBBoxRel(w,h,angle);
  const centerY = y + (bb.minY + bb.maxY) / 2;
  let best = null;
  let bestDist = Infinity;
  specs.forEach((s, idx)=>{
    const d = Math.abs(centerY - (s.yOffset + s.width/2));
    if (d < bestDist){ bestDist = d; best = {index: idx, spec: s}; }
  });
  return best;
}
function isPartAcrossGrain(partEl){
  const w = parseFloat(partEl.dataset.partW || '0') || 0;
  const h = parseFloat(partEl.dataset.partH || '0') || 0;
  const angle = ((parseFloat(partEl.dataset.angle || '0') || 0) % 360 + 360) % 360;
  if (w <= 0 || h <= 0) return false;
  const longAxisOriginal = (w >= h) ? 'x' : 'y';
  const longAxisNow = (angle % 180 === 90) ? (longAxisOriginal === 'x' ? 'y' : 'x') : longAxisOriginal;
  return longAxisNow !== 'x';
}
function getPartBoardFitWarning(partEl, specs){
  specs = specs || getBoardsSpecSafe();
  const w = parseFloat(partEl.dataset.partW || '0') || 0;
  const h = parseFloat(partEl.dataset.partH || '0') || 0;
  const x = parseFloat(partEl.dataset.x || '0') || 0;
  const y = parseFloat(partEl.dataset.y || '0') || 0;
  const angle = parseFloat(partEl.dataset.angle || '0') || 0;
  if (w <= 0 || h <= 0 || !specs || !specs.length) {
    return { warning:false, overflow:false, verticalTooLarge:false, board:null };
  }
  const bb = rotatedBBoxRel(w, h, angle);
  const board = findBoardForPart(partEl, specs);
  if (!board || !board.spec) {
    return { warning:false, overflow:false, verticalTooLarge:false, board:null };
  }
  const s = board.spec;
  const EPS = 0.5;
  const partRect = {
    minX: x + bb.minX,
    maxX: x + bb.maxX,
    minY: y + bb.minY,
    maxY: y + bb.maxY
  };
  const overflow = (
    partRect.minX < -EPS ||
    partRect.maxX > s.length + EPS ||
    partRect.minY < s.yOffset - EPS ||
    partRect.maxY > s.yOffset + s.width + EPS
  );
  const verticalTooLarge = bb.height > s.width + EPS;
  return {
    warning: overflow || verticalTooLarge,
    overflow,
    verticalTooLarge,
    board,
    partRect,
    bbox: bb
  };
}
function updatePartBadgePosition(partEl){
  const badge = partEl.querySelector('.part-no-badge');
  const grainTag = partEl.querySelector('.part-grain-tag');
  const boardTag = partEl.querySelector('.part-board-warning-tag');
  if (!badge) return;
  const w = parseFloat(partEl.dataset.partW || '0') || 0;
  const h = parseFloat(partEl.dataset.partH || '0') || 0;
  const angle = parseFloat(partEl.dataset.angle || '0') || 0;
  const bb = rotatedBBoxRel(w,h,angle);
  badge.setAttribute('transform', `translate(${bb.minX + 14} ${bb.minY + 14})`);
  const tagX = Math.max(bb.minX + 32, 6);
  const tagY = Math.max(bb.minY + 14, 10);
  if (grainTag){
    grainTag.setAttribute('x', String(tagX));
    grainTag.setAttribute('y', String(tagY));
  }
  if (boardTag){
    const hasGrain = partEl.classList.contains('grain-warning');
    boardTag.setAttribute('x', String(tagX));
    boardTag.setAttribute('y', String(hasGrain ? tagY + 12 : tagY));
  }
}
function refreshPartVisualState(partEl){
  if (!partEl) return;
  const grainWarning = isPartAcrossGrain(partEl);
  const boardWarningInfo = getPartBoardFitWarning(partEl);
  const boardWarning = !!(boardWarningInfo && boardWarningInfo.warning);
  const warning = grainWarning || boardWarning;
  partEl.classList.toggle('grain-warning', grainWarning);
  partEl.classList.toggle('board-fit-warning', boardWarning);
  const grainTag = partEl.querySelector('.part-grain-tag');
  if (grainTag){
    grainTag.style.display = grainWarning ? 'block' : 'none';
    grainTag.style.fill = '#b42318';
    grainTag.style.fontWeight = '700';
  }
  const boardTag = partEl.querySelector('.part-board-warning-tag');
  if (boardTag){
    boardTag.style.display = boardWarning ? 'block' : 'none';
    boardTag.style.fill = '#b42318';
    boardTag.style.fontWeight = '700';
  }
  const outline = partEl.querySelector('.part-outline');
  if (outline){
    outline.setAttribute('stroke', warning ? '#b42318' : 'black');
    outline.setAttribute('stroke-width', warning ? '0.9' : '0.5');
  }
  const dimText = partEl.querySelector('.part-dim-text');
  if (dimText){
    dimText.setAttribute('fill', warning ? '#b42318' : '#111');
    dimText.style.fontWeight = warning ? '700' : '400';
  }
  const badgeCircle = partEl.querySelector('.part-no-circle');
  if (badgeCircle){
    badgeCircle.setAttribute('stroke', warning ? '#b42318' : '#333');
    badgeCircle.setAttribute('stroke-width', warning ? '1.2' : '0.8');
  }
  updatePartBadgePosition(partEl);
}
function collectYieldData(){
  const svg = document.querySelector('#svg-container svg');
  if (!svg) return null;
  const specs = getBoardsSpecSafe();
  const rows = [];
  let totalBoardArea = 0;
  let totalUsedArea = 0;
  specs.forEach((s, i)=>{
    const boardArea = Math.max(0, s.length * s.width);
    let usedArea = 0;
    Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).forEach(p=>{
      const board = findBoardForPart(p, specs);
      if (!board || board.index !== i) return;
      usedArea += (parseFloat(p.dataset.partW || '0') || 0) * (parseFloat(p.dataset.partH || '0') || 0);
    });
    totalBoardArea += boardArea;
    totalUsedArea += usedArea;
    rows.push({label:`板${i + 1}`, boardArea, usedArea, rate: boardArea > 0 ? (usedArea / boardArea * 100) : 0});
  });
  return {rows, totalBoardArea, totalUsedArea, overall: totalBoardArea > 0 ? (totalUsedArea / totalBoardArea * 100) : 0};
}
function getYieldHtml(){
  const data = collectYieldData();
  if (!data) return 'STLを読み込むと材料利用率が表示されます。';
  const areaUnit = unitAreaLabel();
  // 面積はmm²→cm²の場合 ÷100
  const areaDiv = unitMode === 'cm' ? 100 : 1;
  const fmtArea = (v) => String(Math.round((v / areaDiv) * 10) / 10);
  const rowsHtml = data.rows.map(r=>`<div class="yield-row"><span>${r.label}</span><span><span class="yield-rate">${r.rate.toFixed(1)}%</span> <span class="sub">(${fmtArea(r.usedArea)} / ${fmtArea(r.boardArea)} ${areaUnit})</span></span></div>`).join('');
  return `${rowsHtml}<div class="yield-row"><span><strong>全体</strong></span><span><strong class="yield-rate">${data.overall.toFixed(1)}%</strong> <span class="sub">(${fmtArea(data.totalUsedArea)} / ${fmtArea(data.totalBoardArea)} ${areaUnit})</span></span></div>`;
}
function renderYieldInfo(){
  const el = document.getElementById('yieldInfo');
  if (el) el.innerHTML = getYieldHtml();
}
function getGrainWarningsHtml(){
  const svg = document.querySelector('#svg-container svg');
  if (!svg) return '木目方向や板サイズ・配置位置に注意があるときに表示されます。';
  const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
  const specs = getBoardsSpecSafe();
  const grainWarnings = parts.filter(p=>isPartAcrossGrain(p));
  const boardWarnings = parts
    .map(p=>({part:p, info:getPartBoardFitWarning(p, specs)}))
    .filter(row=>row.info && row.info.warning);
  if (!grainWarnings.length && !boardWarnings.length){
    return '<div class="ok-text">木取りの警告はありません。</div><div class="sub">木目方向と，部品が板の中に収まっているかを確認します。</div>';
  }
  let html = '';
  if (grainWarnings.length){
    const items = grainWarnings.map(p=>`<li>${p.dataset.partLabel || p.id} の長い辺が木目方向と一致していません。</li>`).join('');
    html += `<div class="warning-text">${grainWarnings.length}個の部品で木取りの注意があります。</div><ul>${items}</ul><div class="sub">木目方向 = 強度の学習用警告です。必要に応じて向きを再確認してください。</div>`;
  }
  if (boardWarnings.length){
    const items = boardWarnings.map(row=>{
      const p = row.part;
      const boardLabel = row.info && row.info.board ? `板${row.info.board.index + 1}` : '板';
      return `<li>${p.dataset.partLabel || p.id}（${boardLabel}）：板に部品がすべて収まっていません。板サイズもしくは部品サイズを確認ください。</li>`;
    }).join('');
    html += `<div class="warning-text" style="margin-top:${grainWarnings.length ? '8px' : '0'};">板サイズ・配置位置注意</div><ul>${items}</ul>`;
  }
  return html;
}
function renderGrainWarnings(){
  const el = document.getElementById('grainWarnings');
  if (el) el.innerHTML = getGrainWarningsHtml();
}
function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}
function collectBomItems(){
  const svg = document.querySelector('#svg-container svg');
  if (!svg) return null;
  const groups = new Map();
  Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).forEach(p=>{
    const w = parseFloat(p.dataset.partW || '0') || 0;
    const h = parseFloat(p.dataset.partH || '0') || 0;
    const color = p.dataset.partColor || getColorForPartKey(toPartKey(w, h));
    const label = p.dataset.partLabel || p.id || '部品';
    // 色は形状ごとに一意（toShapeKey で割り当て済み）なのでグループキーに使う
    if (!groups.has(color)) groups.set(color, {w:Math.max(w,h), h:Math.min(w,h), count:0, color, labels:[]});
    const group = groups.get(color);
    group.count += 1;
    group.labels.push(label);
  });
  return Array.from(groups.values()).map(g=>({
    ...g,
    name: g.labels.join('・')
  })).sort((a,b)=> (b.w*b.h) - (a.w*a.h));
}
function getBomHtml(options = {}){
  const items = collectBomItems();
  if (!items) return 'STLを読み込むと部品表が表示されます。';
  if (!items.length) return '部品はありません。';
  const tableClass = options.asTable ? 'bom-table' : 'bom-table bom-table-main';
  const u = unitLabel();
  return `<table class="${tableClass}"><thead><tr><th>部品名</th><th class="chip-cell">部品の色</th><th>寸法</th><th class="count-cell">個数</th></tr></thead><tbody>${items.map(g=>`<tr><td>${escapeHtml(g.name)}</td><td class="chip-cell"><span class="color-chip" style="background:${g.color}"></span></td><td>${Math.round(mmToDisplay(g.w))} × ${Math.round(mmToDisplay(g.h))} ${u}</td><td class="count-cell">${g.count}</td></tr>`).join('')}</tbody></table>`;
}
function renderBomList(){
  const el = document.getElementById('bomList');
  if (el) el.innerHTML = getBomHtml();
}
function ensureBomTableStyles(){
  if (document.getElementById('kidorin-bom-table-style')) return;
  const style = document.createElement('style');
  style.id = 'kidorin-bom-table-style';
  style.textContent = `
    #bomList .bom-table-main{width:100%;border-collapse:collapse;font-size:12px;table-layout:auto;}
    #bomList .bom-table-main th,#bomList .bom-table-main td{border:1px solid #ddd;padding:4px 5px;text-align:left;vertical-align:middle;white-space:nowrap;}
    #bomList .bom-table-main th{background:#f7f7f7;font-weight:700;}
    #bomList .bom-table-main .chip-cell{width:48px;text-align:center;}
    #bomList .bom-table-main .count-cell{width:42px;text-align:center;}
    #bomList .bom-table-main .color-chip{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,0.2);vertical-align:middle;}
  `;
  document.head.appendChild(style);
}
function updateLearningPanels(){ ensureBomTableStyles(); renderYieldInfo(); renderGrainWarnings(); renderBomList(); if (typeof window.refreshStrengthAfterLearningPanel === 'function') window.refreshStrengthAfterLearningPanel(); }

/* ===== STLから木取り図作成「きどりん」：メインスクリプト（ブラウザ完結） ===== */

function openHelpWindow(){
      const w = window.open('about:blank', 'helpWindow_' + Date.now(), 'popup=yes,width=900,height=700,resizable=yes,scrollbars=yes');
      if (!w) { alert('ポップアップがブロックされました'); return; }
      const htmlDoc = `<!doctype html><html><head><meta charset="utf-8"><title>ヘルプ</title>
        <style>
          html,body{margin:0;padding:0;background:#fff;}
          body{font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;}
          .bar{padding:10px 12px; border-bottom:1px solid #ddd; display:flex; gap:8px; align-items:center;}
          .bar button{padding:6px 10px; cursor:pointer;}
          .help-wrap{padding:16px 18px;}
          .h-title{margin:6px 0 12px 0; font-size:20px; font-weight:800;}
          .h-head{margin:16px 0 8px 0; font-size:16px; font-weight:800; color:#0b57d0;}
          ul{margin:6px 0 0 22px;}
          li{margin:6px 0; line-height:1.55;}
        </style></head><body>
          
    <div style="position:fixed;right:16px;bottom:16px;z-index:1000;">
      <button onclick="window.close()" style="padding:8px 14px;font-size:14px;cursor:pointer;">閉じる</button>
    </div>
    
          <div class="help-wrap">
  <h2 class="h-title">STLから木取り図作成「きどりん」の使い方</h2>

  <h3 class="h-head">■このツールでできること</h3>
  <ul>
    <li>CADで作成したSTLファイルを部品にして，木の板の上に並べて「木取り図」を作れます。</li>
    <li>読み込めるのは，STL形式のファイルのみです。</li>
    <li>板の長さと幅は，実際に使う材料に合わせて自由に設定できます。必要に応じて追加もできます。</li>
    <li>板を追加した場合は，「レイアウト初期化」を押してください。</li>
    <li>部品はマウスのドラッグで位置調整，右クリック／ダブルクリック（タッチ操作はダブルタップ）で90度回転できます。</li>
    <li>部品は長い方向が木目方向（板の長手方向）になるようにします。異なる場合は赤色の警告が出るので，右クリック／ダブルクリック（ダブルタップ）で回転させてください。</li>
    <li>「Zoom+」で画面表示拡大，「Zoom-」で画面縮小表示ができます。</li>
    <li>位置が決まったら，「レイアウト決定」で横方向のみ「部品の間隔」に合わせ，左端と上端を詰めて部品がきれいにならびます。</li>
    <li>できあがった木取り図は，PDFにして保存・印刷できます。また，タイトル・歩留まり・木取りの注意・部品表を含めたPNG画像として保存し，対応ブラウザではクリップボードにもコピーできます。</li>
  </ul>

  <h3 class="h-head">■3Dビューア</h3>
  <ul>
    <li>「3D表示」ボタンを押すと，読み込んだSTLファイルを別ウィンドウで3D表示します。</li>
    <li>部品ごとに色分けされ，木取り図の色と対応しています。</li>
    <li>左ドラッグでモデルを回転，右ドラッグで移動，マウスホイールで拡大・縮小ができます。</li>
    <li>「リセット」ボタンを押すと，初期の視点に戻ります。</li>
    <li>3Dビューアを使うには，先にSTLファイルを読み込んでおく必要があります。</li>
  </ul>

  <h3 class="h-head">■コツ</h3>
  <ul>
    <li>部品が板からはみ出すときは，回転させるか，それでもだめな場合は，再度設計を見直してください。</li>
    <li>「部品の間隔」は，部品どうしのすき間です。ノコギリで切ったり，きれいに仕上げるための切りしろとして間を空けます。</li>
    <li>途中で困ったらWebアプリ自体を再度読み込み，STLファイル読み込みから始めます。</li>
    <li>CADで作成した際に，全体をグループ化して１つにしていると部品に分解できません。かならず部品を組み立てた状態にしてください。</li>
  </ul>

</div>
    
    </body></html>`;
      try {
        w.document.open();
        w.document.write(htmlDoc);
        w.document.close();
      } catch (e) {
        try { w.document.documentElement.innerHTML = htmlDoc; } catch (e2) {}
      }
    }

/* ===== 3D表示：別ウィンドウでSTLを Three.js でレンダリング ===== */
function open3dWindow() {
  if (!stlArrayBufferCache) {
    alert('先にSTLファイルを読み込んでください。');
    return;
  }

  const w = window.open('about:blank', '3dViewer_' + Date.now(),
    'popup=yes,width=900,height=700,resizable=yes,scrollbars=no');
  if (!w) { alert('ポップアップがブロックされました。'); return; }

  // ArrayBuffer を Base64 に変換してポップアップへ埋め込む
  const bytes = new Uint8Array(stlArrayBufferCache);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);

  // 木取り図と色を合わせる：SVG上の部品を part-0, part-1... の順に色を収集
  // geometriesCache のインデックス順 = part-{index} の order と一致
  const svg = document.querySelector('#svg-container svg');
  const colorsBySvg = [];
  if (svg) {
    Array.from(svg.querySelectorAll('g[id^="part-"]')).forEach(el => {
      const idx = parseInt((el.id || '').replace('part-', ''), 10);
      if (!isNaN(idx)) colorsBySvg[idx] = el.dataset.partColor || null;
    });
  }
  // フォールバック：partColorMap から partKey 順に取得、それもなければデフォルトパレット
  const fallbackColors = ['#dbeafe','#fde68a','#fecdd3','#d1fae5','#e9d5ff',
                          '#fed7aa','#bfdbfe','#fbcfe8','#fde2e4','#ddd6fe','#c7f9cc','#faedcd'];
  // geometriesCache.length 分の色配列を構築
  const colors = Array.from({length: geometriesCache.length}, (_, i) =>
    colorsBySvg[i] || fallbackColors[i % fallbackColors.length]
  );

  const htmlDoc = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>STL 3Dビューア - きどりん</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:100%;height:100%;background:#1a1a2e;overflow:hidden;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}
  #canvas-wrap{position:absolute;inset:0;}
  canvas{display:block;width:100%!important;height:100%!important;}
  #toolbar{
    position:absolute;top:10px;left:50%;transform:translateX(-50%);
    display:flex;gap:8px;align-items:center;
    background:rgba(255,255,255,0.12);backdrop-filter:blur(6px);
    border-radius:8px;padding:6px 14px;color:#fff;font-size:13px;
    white-space:nowrap;pointer-events:none;
  }
  #toolbar span{opacity:0.7;}
  #close-btn{
    position:absolute;top:10px;right:14px;
    background:rgba(255,255,255,0.15);border:none;color:#fff;
    padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;
  }
  #close-btn:hover{background:rgba(255,255,255,0.28);}
  #reset-btn, #dimension-toggle-btn{
    position:absolute;top:10px;
    background:rgba(255,255,255,0.15);border:none;color:#fff;
    padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;
  }
  #reset-btn{right:90px;}
  #dimension-toggle-btn{right:174px;}
  #reset-btn:hover, #dimension-toggle-btn:hover{background:rgba(255,255,255,0.28);}
  #dimension-toggle-btn.active{background:rgba(255,255,255,0.32);font-weight:700;}
  #info{
    position:absolute;bottom:12px;left:50%;transform:translateX(-50%);
    color:rgba(255,255,255,0.45);font-size:11px;pointer-events:none;
  }
</style>
</head>
<body>
<div id="canvas-wrap"><canvas id="c"></canvas></div>
<div id="toolbar">
  <span>左ドラッグ：回転　　右ドラッグ：移動　　ホイール：ズーム</span>
</div>
<button id="dimension-toggle-btn" type="button">寸法表示</button>
<button id="reset-btn" onclick="resetCamera()">リセット</button>
<button id="close-btn" onclick="window.close()">閉じる</button>
<div id="info" id="info"></div>

<script src="https://unpkg.com/three@0.128.0/build/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/STLLoader.js"></script>
<script>
// ---- Base64 → ArrayBuffer ----
const b64 = ${JSON.stringify(base64)};
function b64ToBuffer(b64){
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8  = new Uint8Array(buf);
  for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  return buf;
}

// ---- 単位 ----
const UNIT_LABEL = ${JSON.stringify(unitLabel())};
const UNIT_DIV = ${unitMode === 'cm' ? 10 : 1};
const GEO_SCALE = ${unitMode === 'cm' ? 10 : 1};

// ---- 部品ごとの色 ----
const COLORS = ${JSON.stringify(colors)};


// ---- Scene setup ----
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.FogExp2(0x1a1a2e, 0.0008);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);

// Lights
const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(1, 2, 1.5);
dirLight.castShadow = true;
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x8899ff, 0.35);
fillLight.position.set(-1, -1, -1);
scene.add(fillLight);

// ---- Load STL ----
const loader = new THREE.STLLoader();
const geometry = loader.parse(b64ToBuffer(b64));

// Compute bounding box of full model
geometry.computeBoundingBox();
const fullBB = geometry.boundingBox;
const center = new THREE.Vector3();
fullBB.getCenter(center);
const size   = new THREE.Vector3();
fullBB.getSize(size);
const maxDim = Math.max(size.x, size.y, size.z);

// ---- Separate into connected components and color each ----
const positions = geometry.attributes.position.array;
const numTri    = positions.length / 9;
const precision = 1e4;

// Build edge→triangles map
const edgeMap = new Map();
for(let i=0;i<numTri;i++){
  const verts=[];
  for(let j=0;j<3;j++){
    const idx=i*9+j*3;
    const x=Math.round(positions[idx]*precision)/precision;
    const y=Math.round(positions[idx+1]*precision)/precision;
    const z=Math.round(positions[idx+2]*precision)/precision;
    verts.push(x+'|'+y+'|'+z);
  }
  for(let j=0;j<3;j++){
    const v1=verts[j],v2=verts[(j+1)%3];
    const ek=v1<v2?v1+','+v2:v2+','+v1;
    if(!edgeMap.has(ek)) edgeMap.set(ek,[]);
    edgeMap.get(ek).push(i);
  }
}
const adj=new Map();
for(const tris of edgeMap.values()){
  if(tris.length===2){
    const [a,b]=tris;
    if(!adj.has(a)) adj.set(a,[]);
    if(!adj.has(b)) adj.set(b,[]);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
}

// BFS to find components
const visited=new Uint8Array(numTri);
const components=[];
for(let i=0;i<numTri;i++){
  if(!visited[i]){
    const comp=[],queue=[i];
    visited[i]=1;
    while(queue.length){
      const t=queue.shift();
      comp.push(t);
      for(const nb of (adj.get(t)||[])){
        if(!visited[nb]){visited[nb]=1;queue.push(nb);}
      }
    }
    components.push(comp);
  }
}

// Build a Mesh per component
const group = new THREE.Group();
let dimensionGroup = null;
let dimensionsOn = false;
const dimensionToggleBtn = document.getElementById('dimension-toggle-btn');
components.forEach((comp, ci)=>{
  const pos = new Float32Array(comp.length*9);
  for(let k=0;k<comp.length;k++){
    const src=comp[k]*9;
    pos.set(positions.subarray(src,src+9), k*9);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.computeVertexNormals();

  const hex = parseInt(COLORS[ci % COLORS.length].replace('#',''), 16);
  const mat = new THREE.MeshPhongMaterial({
    color: hex,
    shininess: 60,
    specular: 0x444444,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
});


// Center group
// STL の座標系は Z 軸が上（CAD 標準）のため、X 軸で -90° 回転して Y 軸が上になるよう補正
group.scale.set(GEO_SCALE, GEO_SCALE, GEO_SCALE);
group.rotation.x = -Math.PI / 2;
group.position.sub(new THREE.Vector3(center.x * GEO_SCALE, center.z * GEO_SCALE, -center.y * GEO_SCALE));
scene.add(group);

const scaledMaxDim = maxDim * GEO_SCALE;


// ---- Dimension display ----
function disposeObject3D(obj) {
  if (!obj) return;
  if (obj.traverse) obj.traverse(function(child){
    if (child.geometry && child.geometry.dispose) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(function(mat){
        if (mat.map && mat.map.dispose) mat.map.dispose();
        if (mat.dispose) mat.dispose();
      });
    }
  });
}

function makeTextSprite(text) {
  const canvas2d = document.createElement('canvas');
  canvas2d.width = 512;
  canvas2d.height = 128;
  const ctx = canvas2d.getContext('2d');
  ctx.clearRect(0, 0, canvas2d.width, canvas2d.height);
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(18, 18, canvas2d.width - 36, canvas2d.height - 36);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, canvas2d.width - 36, canvas2d.height - 36);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas2d.width / 2, canvas2d.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas2d);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  sprite.userData.fixedScreenSize = true;
  sprite.userData.screenHeightPx = 64;
  sprite.userData.aspectRatio = canvas2d.width / canvas2d.height;
  return sprite;
}

function addDimLine(targetGroup, a, b, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineBasicMaterial({ color: color || 0xffff00, depthTest: false });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 998;
  targetGroup.add(line);
}

function addDimension(targetGroup, start, end, label, tickDir, labelScale, tickLen) {
  addDimLine(targetGroup, start, end);
  const t = tickDir.clone().normalize().multiplyScalar(tickLen);
  addDimLine(targetGroup, start.clone().sub(t), start.clone().add(t));
  addDimLine(targetGroup, end.clone().sub(t), end.clone().add(t));
  const sprite = makeTextSprite(label);
  sprite.position.copy(start.clone().lerp(end, 0.5));
  sprite.scale.set(labelScale * 1.45, labelScale * 0.36, 1);
  targetGroup.add(sprite);
}

function createDimensions(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const displayedSize = new THREE.Vector3();
  box.getSize(displayedSize);
  const maxLen = Math.max(displayedSize.x, displayedSize.y, displayedSize.z) || 1;
  const margin = maxLen * 0.045;
  const tickLen = Math.max(maxLen * 0.045, 3);
  const labelScale = Math.max(maxLen * 0.105, 7);
  const min = box.min;
  const max = box.max;
  const dims = new THREE.Group();
  dims.name = 'dimensionGroup';

  addDimension(dims,
    new THREE.Vector3(min.x, min.y - margin, max.z + margin),
    new THREE.Vector3(max.x, min.y - margin, max.z + margin),
    'W ' + (displayedSize.x / UNIT_DIV).toFixed(1) + ' ' + UNIT_LABEL,
    new THREE.Vector3(0, 1, 0), labelScale, tickLen);

  addDimension(dims,
    new THREE.Vector3(max.x + margin, min.y, max.z + margin),
    new THREE.Vector3(max.x + margin, max.y, max.z + margin),
    'H ' + (displayedSize.y / UNIT_DIV).toFixed(1) + ' ' + UNIT_LABEL,
    new THREE.Vector3(1, 0, 0), labelScale, tickLen);

  addDimension(dims,
    new THREE.Vector3(max.x + margin, min.y - margin, min.z),
    new THREE.Vector3(max.x + margin, min.y - margin, max.z),
    'D ' + (displayedSize.z / UNIT_DIV).toFixed(1) + ' ' + UNIT_LABEL,
    new THREE.Vector3(0, 1, 0), labelScale, tickLen);

  return dims;
}

function clearDimensions() {
  if (dimensionGroup) {
    scene.remove(dimensionGroup);
    disposeObject3D(dimensionGroup);
    dimensionGroup = null;
  }
}

function setDimensionsVisible(on) {
  dimensionsOn = !!on;
  clearDimensions();
  if (dimensionToggleBtn) {
    dimensionToggleBtn.textContent = dimensionsOn ? '寸法非表示' : '寸法表示';
    dimensionToggleBtn.classList.toggle('active', dimensionsOn);
  }
  if (dimensionsOn) {
    dimensionGroup = createDimensions(group);
    if (dimensionGroup) scene.add(dimensionGroup);
  }
}

function updateFixedScreenDimensionLabels() {
  if (!dimensionGroup || !camera || !renderer) return;
  const h = Math.max(renderer.domElement.clientHeight || window.innerHeight || 1, 1);
  const fovRad = THREE.MathUtils.degToRad(camera.fov || 45);
  const camPos = new THREE.Vector3();
  const objPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  dimensionGroup.traverse(function(obj){
    if (!obj.isSprite || !obj.userData.fixedScreenSize) return;
    obj.getWorldPosition(objPos);
    const dist = Math.max(camPos.distanceTo(objPos), 0.001);
    const screenHeightPx = obj.userData.screenHeightPx || 64;
    const aspect = obj.userData.aspectRatio || 4;
    const visibleWorldHeight = 2 * dist * Math.tan(fovRad / 2);
    const worldHeight = visibleWorldHeight * (screenHeightPx / h);
    obj.scale.set(worldHeight * aspect, worldHeight, 1);
  });
}

if (dimensionToggleBtn) {
  dimensionToggleBtn.addEventListener('click', function(){
    setDimensionsVisible(!dimensionsOn);
  });
}

// Camera initial position
// 一般的な 3D ビューアに合わせ、正面やや斜め上から見た角度で初期表示
// camTheta: 極角（0=真上, π/2=水平）　camPhi: 方位角（0=Z正方向=正面）
let camDist   = scaledMaxDim * 2.2;
let camTheta  = Math.PI / 2 - Math.PI / 8;  // 水平より少し上（約67.5°の仰角）
let camPhi    = 0;                            // 正面（Z軸手前）
let panOffset = new THREE.Vector3();

function setCameraFromSpherical(){
  camera.position.set(
    camDist * Math.sin(camTheta) * Math.sin(camPhi) + panOffset.x,
    camDist * Math.cos(camTheta)                    + panOffset.y,
    camDist * Math.sin(camTheta) * Math.cos(camPhi) + panOffset.z
  );
  camera.lookAt(panOffset);
}
setCameraFromSpherical();

function resetCamera(){
  camDist  = scaledMaxDim * 2.2;
  camTheta = Math.PI / 2 - Math.PI / 8;
  camPhi   = 0;
  panOffset.set(0,0,0);
  setCameraFromSpherical();
  if (dimensionsOn) setDimensionsVisible(true);
}

// Update info
const infoEl = document.getElementById('info');
infoEl.textContent =
  '部品数: ' + components.length + '　サイズ: ' +
  Math.round(size.x * GEO_SCALE / UNIT_DIV) + ' × ' + Math.round(size.y * GEO_SCALE / UNIT_DIV) + ' × ' + Math.round(size.z * GEO_SCALE / UNIT_DIV) + ' ' + UNIT_LABEL;

// ---- Resize ----
function resize(){
  const W=window.innerWidth, H=window.innerHeight;
  renderer.setSize(W,H);
  camera.aspect=W/H;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

// ---- Mouse controls ----
let mouse = {down:false, btn:0, lastX:0, lastY:0};

canvas.addEventListener('contextmenu', e=>e.preventDefault());

canvas.addEventListener('mousedown', e=>{
  mouse.down=true; mouse.btn=e.button;
  mouse.lastX=e.clientX; mouse.lastY=e.clientY;
});
window.addEventListener('mouseup', ()=>{ mouse.down=false; });

window.addEventListener('mousemove', e=>{
  if(!mouse.down) return;
  const dx=e.clientX-mouse.lastX;
  const dy=e.clientY-mouse.lastY;
  mouse.lastX=e.clientX; mouse.lastY=e.clientY;

  if(mouse.btn===0){
    // Rotate
    camPhi   -= dx * 0.008;
    camTheta  = Math.max(0.05, Math.min(Math.PI-0.05, camTheta - dy * 0.008));
  } else if(mouse.btn===2){
    // Pan
    const right = new THREE.Vector3();
    const up    = new THREE.Vector3();
    camera.getWorldDirection(up);        // forward
    right.crossVectors(up, camera.up).normalize();
    const upDir = new THREE.Vector3().crossVectors(right, up).normalize();
    const panSpeed = camDist * 0.001;
    panOffset.addScaledVector(right, -dx * panSpeed);
    panOffset.addScaledVector(upDir,  dy * panSpeed);
  }
  setCameraFromSpherical();
});

canvas.addEventListener('wheel', e=>{
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.1 : 0.91;
  camDist = Math.max(scaledMaxDim * 0.1, Math.min(scaledMaxDim * 20, camDist * factor));
  setCameraFromSpherical();
}, {passive:false});

// Touch controls
let touches = {};
let lastPinchDist = null;
canvas.addEventListener('touchstart', e=>{
  e.preventDefault();
  for(const t of e.changedTouches) touches[t.identifier]={x:t.clientX,y:t.clientY};
}, {passive:false});
canvas.addEventListener('touchend', e=>{
  for(const t of e.changedTouches) delete touches[t.identifier];
  lastPinchDist=null;
}, {passive:false});
canvas.addEventListener('touchmove', e=>{
  e.preventDefault();
  const ids=Object.keys(touches);
  if(ids.length===1){
    const t=e.changedTouches[0];
    const dx=t.clientX-touches[t.identifier].x;
    const dy=t.clientY-touches[t.identifier].y;
    camPhi  -= dx*0.008;
    camTheta = Math.max(0.05,Math.min(Math.PI-0.05,camTheta-dy*0.008));
    touches[t.identifier]={x:t.clientX,y:t.clientY};
    setCameraFromSpherical();
  } else if(e.touches.length===2){
    const a=e.touches[0],b=e.touches[1];
    const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    if(lastPinchDist!==null){
      const factor=lastPinchDist/d;
      camDist=Math.max(scaledMaxDim*0.1,Math.min(scaledMaxDim*20,camDist*factor));
      setCameraFromSpherical();
    }
    lastPinchDist=d;
  }
  for(const t of e.changedTouches) touches[t.identifier]={x:t.clientX,y:t.clientY};
},{passive:false});

// ---- Render loop ----
function animate(){
  requestAnimationFrame(animate);
  updateFixedScreenDimensionLabels();
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>`;

  try {
    w.document.open();
    w.document.write(htmlDoc);
    w.document.close();
  } catch(e) {
    try { w.document.documentElement.innerHTML = htmlDoc; } catch(e2) {
      alert('3Dビューアの表示に失敗しました: ' + (e && e.message ? e.message : e));
    }
  }
}

/* ===== 表示：PDF用タイトル更新 ===== */
let currentStlFileName = ''; // PDF保存ファイル名のためにファイル名をキャッシュ

function updateDocTitle(name){
  currentStlFileName = name || '';
  const el = document.getElementById('docTitle');
  if (!el) return;
  el.textContent = `STLから木取り図作成「きどりん」　STLのファイル名：${name || '-'}`;
}

/* ===== 木取り図表示：A4横1ページの印刷画面を別ウィンドウで開く ===== */
function openPdfWindow(){
  const svg = document.querySelector('svg');
  if (!svg) { alert('SVGが見つかりません'); return; }

  Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).forEach(refreshPartVisualState);
  const clone = svg.cloneNode(true);

  // Expand viewBox to include all content
  try {
    const bbox = svg.getBBox();
    const pad = 10;
    clone.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad*2} ${bbox.height + pad*2}`);
  } catch(e) {}

  // For fitting into 1 page with header: make SVG responsive inside a fixed A4 page box.
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  clone.setAttribute('style', 'width:100%;height:100%;');

  const titleEl = document.getElementById('docTitle');
  const titleText = titleEl ? titleEl.textContent : 'STL木取り作成　STLのファイル名：-';

  const sheets = (window.sheets && Array.isArray(window.sheets)) ? window.sheets : [];
  const pdfUnit = unitLabel();
  const infoHtml = sheets.map((s, i)=>{
    const n = i + 1;
    const len = formatDim(s.length ?? 0);
    const wid = formatDim(s.width ?? 0);
    const gap = formatDim(s.margin ?? 0);
    return `<div>板${n}：長さ ${len} ${pdfUnit}／幅 ${wid} ${pdfUnit}／部品の間隔 ${gap} ${pdfUnit}</div>`;
  }).join('');

  const yieldHtml = getYieldHtml();
  const grainHtml = getGrainWarningsHtml();
  const bomHtml = getBomHtml({asTable:true});


  // PDF保存時のデフォルトファイル名 = ページタイトル（ブラウザの印刷→PDF保存の挙動を利用）
  const stlBaseName = currentStlFileName.replace(/\.stl$/i, '') || '木取り図';
  const pdfTitle = `${stlBaseName}_木取り図`;

  const w = window.open('about:blank', 'pdfWindow_' + Date.now(), 'popup=yes,width=1100,height=800,resizable=yes,scrollbars=yes');
  if (!w) { alert('ポップアップがブロックされました'); return; }

  const htmlDoc = `<!doctype html><html><head><meta charset="utf-8"><title>${pdfTitle}</title>
    <style>
      html,body{margin:0;padding:0;background:#fff;}
      /* Force single page A4 landscape */
      @page{size:A4 landscape;margin:0;}
      body{overflow:hidden;}
      .page{
        width:297mm;
        min-height:210mm;
        box-sizing:border-box;
        padding:7mm;
        display:flex;
        flex-direction:column;
        gap:2mm;
        page-break-inside:avoid;
        break-inside:avoid;
      }
      .noprint{margin:0;}
      .title{margin:0; font-size:16px;}
      .info{margin:0; font-size:11px; line-height:1.35;}
      .svgbox{
        flex:0 0 auto;
        height:105mm;
        overflow:hidden;
        display:flex;
        align-items:center;
        justify-content:center;
        border:1px solid #ddd;
      }
      .svgbox svg{width:100%; height:100%;}
      .summary-grid{display:flex;gap:2mm;align-items:stretch;}
      .summary-card{flex:1 1 0;border:1px solid #ddd;border-radius:2mm;padding:2mm 2.5mm;font-size:10px;line-height:1.35;}
      .summary-card h4{margin:0 0 1.5mm 0;font-size:11px;}
      .yield-row{display:flex;justify-content:space-between;gap:2mm;border-bottom:1px dashed #ddd;padding:0.8mm 0;}
      .yield-row:last-child{border-bottom:none;}
      .yield-rate{font-weight:700;}
      .warning-text{color:#b42318;font-weight:700;}
      .ok-text{color:#1f7a1f;font-weight:700;}
      .sub{font-size:9px;color:#666;}
      .summary-card ul{margin:1mm 0 0 4mm;padding:0;}
      .summary-card li{margin:0.6mm 0;}
      .bom-table{width:100%;border-collapse:collapse;font-size:9.5px;}
      .bom-table th,.bom-table td{border:1px solid #ddd;padding:1mm 1.2mm;text-align:left;vertical-align:middle;}
      .bom-table th{background:#f7f7f7;}
      .count-cell{text-align:center;width:10mm;}
      .chip-cell{width:6mm;}
      .color-chip{display:inline-block;width:4mm;height:4mm;border-radius:1mm;border:1px solid rgba(0,0,0,0.2);}
      @media print {
        .noprint{display:none;}
        html,body{width:297mm;height:210mm;overflow:hidden;}
      }
      button{padding:6px 10px;}
    </style>
    </head><body>
      <div class="page">
        <div class="noprint" style="position:fixed;right:16px;bottom:16px;z-index:1000;display:flex;gap:8px;"><button onclick="window.print()">印刷/保存(PDF)</button><button onclick="saveAndCopyImage()">画像保存/クリップボード</button></div>
        <h3 class="title">${titleText}</h3>
        <div class="info">${infoHtml}</div>
        <div class="svgbox">${clone.outerHTML}</div>
        <div class="summary-grid">
          <section class="summary-card"><h4>板の歩留まり</h4>${yieldHtml}</section>
          <section class="summary-card"><h4>木取りの注意</h4>${grainHtml}</section>
          <section class="summary-card"><h4>部品表</h4>${bomHtml}</section>
        </div>
      </div>
    <script>
      function loadSvgTextAsImage(svgText){
        return new Promise((resolve, reject) => {
          let settled = false;
          let objectUrl = null;
          let timer = null;

          const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
              objectUrl = null;
            }
          };
          const finishOk = (img) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(img);
          };
          const finishNg = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err || new Error('SVG画像の変換に失敗しました'));
          };
          const startLoad = (src, fallback) => {
            const img = new Image();
            img.onload = () => finishOk(img);
            img.onerror = () => {
              if (fallback) fallback();
              else finishNg(new Error('SVG画像の変換に失敗しました'));
            };
            timer = setTimeout(() => {
              if (fallback) fallback();
              else finishNg(new Error('SVG画像の読み込みが完了しませんでした'));
            }, 3000);
            img.src = src;
          };
          const tryDataUrl = () => {
            if (timer) clearTimeout(timer);
            if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
              objectUrl = null;
            }
            startLoad('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText), null);
          };

          try {
            const svgBlob = new Blob([svgText], {type:'image/svg+xml;charset=utf-8'});
            objectUrl = URL.createObjectURL(svgBlob);
            startLoad(objectUrl, tryDataUrl);
          } catch (e) {
            tryDataUrl();
          }
        });
      }

      async function svgToPngBlob(){
        const svgEl = document.querySelector('.svgbox svg');
        if (!svgEl) throw new Error('木取り図のSVGが見つかりません');
        const clone = svgEl.cloneNode(true);
        const bbox = svgEl.getBoundingClientRect();
        const width = Math.max(1, Math.round(bbox.width * 2));
        const height = Math.max(1, Math.round(bbox.height * 2));
        clone.setAttribute('width', width);
        clone.setAttribute('height', height);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        const svgText = new XMLSerializer().serializeToString(clone);
        const img = await loadSvgTextAsImage(svgText);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG変換に失敗しました')), 'image/png'));
      }

      function roundRectPath(ctx, x, y, w, h, r){
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
      }

      function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxY){
        const raw = String(text || '').replace(/\s+/g, ' ').trim();
        if (!raw) return y;
        let line = '';
        for (const ch of raw) {
          const test = line + ch;
          if (ctx.measureText(test).width > maxWidth && line) {
            if (y + lineHeight > maxY) return y;
            ctx.fillText(line, x, y);
            y += lineHeight;
            line = ch;
          } else {
            line = test;
          }
        }
        if (line && y + lineHeight <= maxY) {
          ctx.fillText(line, x, y);
          y += lineHeight;
        }
        return y;
      }

      function svgElementToImage(svgEl, width, height){
        const svgClone = svgEl.cloneNode(true);
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svgClone.setAttribute('width', String(width));
        svgClone.setAttribute('height', String(height));
        svgClone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        const svgText = new XMLSerializer().serializeToString(svgClone);
        return loadSvgTextAsImage(svgText);
      }

      async function pageToPngBlob(){
        const page = document.querySelector('.page');
        if (!page) throw new Error('木取り図ページが見つかりません');

        const W = 1600;
        const H = 1131; // A4横比率
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.textBaseline = 'top';

        const pad = 42;
        let y = pad;
        ctx.fillStyle = '#111111';
        ctx.font = 'bold 28px system-ui, sans-serif';
        const title = document.querySelector('.title')?.textContent || document.title;
        ctx.fillText(title, pad, y);
        y += 38;

        ctx.font = '18px system-ui, sans-serif';
        const infoLines = Array.from(document.querySelectorAll('.info div')).map(el => el.textContent || '').filter(Boolean);
        infoLines.forEach(line => { ctx.fillText(line, pad, y); y += 24; });
        y += 10;

        const svgbox = document.querySelector('.svgbox');
        const svgEl = svgbox ? svgbox.querySelector('svg') : null;
        const svgX = pad;
        const svgY = y;
        const svgW = W - pad * 2;
        const svgH = 565;
        ctx.strokeStyle = '#dddddd';
        ctx.lineWidth = 2;
        ctx.strokeRect(svgX, svgY, svgW, svgH);
        if (svgEl) {
          const img = await svgElementToImage(svgEl, svgW, svgH);
          ctx.drawImage(img, svgX, svgY, svgW, svgH);
        }
        y += svgH + 22;

        const cards = Array.from(document.querySelectorAll('.summary-card'));
        const gap = 14;
        const cardW = (W - pad * 2 - gap * 2) / 3;
        const cardH = H - y - pad;
        cards.slice(0, 3).forEach((card, i) => {
          const x = pad + i * (cardW + gap);
          roundRectPath(ctx, x, y, cardW, cardH, 10);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#dddddd';
          ctx.lineWidth = 2;
          ctx.stroke();

          let ty = y + 18;
          ctx.fillStyle = '#111111';
          ctx.font = 'bold 20px system-ui, sans-serif';
          ctx.fillText(card.querySelector('h4')?.textContent || '', x + 16, ty);
          ty += 32;
          ctx.font = '16px system-ui, sans-serif';

          if (card.querySelector('.bom-table')) {
            const rows = Array.from(card.querySelectorAll('tbody tr'));
            rows.forEach(row => {
              const txt = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim()).filter(Boolean).join('　');
              ty = wrapText(ctx, txt, x + 16, ty, cardW - 32, 22, y + cardH - 12);
            });
          } else {
            const lines = Array.from(card.querySelectorAll('.yield-row, li, .warning-text, .ok-text, .sub'));
            if (lines.length) {
              lines.forEach(el => {
                ty = wrapText(ctx, el.textContent || '', x + 16, ty, cardW - 32, 22, y + cardH - 12);
              });
            } else {
              wrapText(ctx, card.textContent || '', x + 16, ty, cardW - 32, 22, y + cardH - 12);
            }
          }
        });

        return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG変換に失敗しました')), 'image/png'));
      }

      function downloadPngBlob(blob, filename){
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      async function copyImageToClipboard(blob){
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
          return true;
        }
        return false;
      }

      async function saveAndCopyImage(){
        let blob;
        let fullPage = true;
        try {
          blob = await pageToPngBlob();
        } catch (pageError) {
          // 前バージョンで動作していたSVG保存方式にフォールバックする。
          // これにより，表を含む画像生成が失敗してもPNG保存自体は止めない。
          fullPage = false;
          blob = await svgToPngBlob();
        }

        try {
          downloadPngBlob(blob, document.title + '.png');
          try {
            const copied = await copyImageToClipboard(blob);
            if (copied) {
              alert((fullPage ? '木取り図ページ全体' : '木取り図') + 'をPNG保存し，クリップボードにもコピーしました。');
            } else {
              alert((fullPage ? '木取り図ページ全体' : '木取り図') + 'をPNG保存しました。クリップボードコピーはこのブラウザでは利用できません。');
            }
          } catch (clipError) {
            alert((fullPage ? '木取り図ページ全体' : '木取り図') + 'をPNG保存しました。クリップボードコピーはブラウザに許可されませんでした。');
          }
        } catch (e) {
          alert('画像保存/クリップボードに失敗しました: ' + (e && e.message ? e.message : e));
        }
      }
    </script>
    </body></html>`;

  try {
    w.document.open();
    w.document.write(htmlDoc);
    w.document.close();
  } catch (e) {
    try {
      w.document.documentElement.innerHTML = htmlDoc;
    } catch (e2) {
      alert('木取り図表示の生成に失敗しました: ' + (e && e.message ? e.message : e));
    }
  }
}


/* ===== UI部品（ボタン・入力）参照 ===== */
const stlInput = document.getElementById('stl-input');

  // docTitle update is merged into the main stlInput change handler below
const svgContainer = document.getElementById('svg-container');
const boardLengthInput = document.getElementById('board-length');
const boardWidthInput = document.getElementById('board-width');
const marginInput = document.getElementById('margin');
const updateLayoutButton = document.getElementById('update-layout-button');
const finalizeLayoutButton = document.getElementById('finalize-layout-button');
const addBoardButton = document.getElementById('add-board-button');
  const helpBtn = document.getElementById('helpBtn');
  if (helpBtn) {
    helpBtn.addEventListener('click', (e)=>{ e.preventDefault(); openHelpWindow(); });
  }

  // 3Dビューアボタン
  const view3dBtn = document.getElementById('view3d-button');
  if (view3dBtn) {
    view3dBtn.addEventListener('click', (e)=>{ e.preventDefault(); open3dWindow(); });
  }


  // 木取り図表示 button is already in HTML; just attach the click handler
  const pdfButton = document.getElementById('pdf-button');
  if (pdfButton) {
    pdfButton.addEventListener('click', (e)=>{ e.preventDefault(); openPdfWindow(); });
  }

  const kidoriMenuButton = document.getElementById('kidori-menu-button');
  if (kidoriMenuButton) {
    kidoriMenuButton.addEventListener('click', (e)=>{ e.preventDefault(); window.location.href = 'index.html'; });
  }

  const kidoriKasanenButton = document.getElementById('kidori-kasanen-button');
  if (kidoriKasanenButton) {
    kidoriKasanenButton.addEventListener('click', (e)=>{ e.preventDefault(); window.location.href = 'kasanen.html'; });
  }

  const kidoriTsuyoinButton = document.getElementById('kidori-tsuyoin-button');
  if (kidoriTsuyoinButton) {
    kidoriTsuyoinButton.addEventListener('click', (e)=>{
      e.preventDefault();
      if (stlArrayBufferCache && typeof window.openStrengthWindow === 'function') {
        window.openStrengthWindow();
        return;
      }
      if ((window.SharedStl && window.SharedStl.has()) || localStorage.getItem('kidorin_current_stl') || localStorage.getItem('kidorin_pending_strength_stl')) {
        window.location.href = 'kidori.html?openStrength=1&headless=1';
      } else {
        window.location.href = 'strength.html?needUpload=1';
      }
    });
  }

const extraBoardsContainer = document.getElementById('extra-boards');

const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');

let geometriesCache = [];
let zoomScale = 1;
let responsiveFitScale = 1;

function getSvgViewBoxSize(svg) {
  if (!svg) return { width: 0, height: 0 };
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  if (vb && vb.width && vb.height) return { width: vb.width, height: vb.height };
  return {
    width: parseFloat(svg.getAttribute('width')) || 0,
    height: parseFloat(svg.getAttribute('height')) || 0
  };
}

function getBoardContentSize(svg) {
  // STL読み込み直後の自動表示倍率は，部品のはみ出しではなく「板」が
  // 描画エリアにちょうど収まることを基準にする。
  try {
    const rects = Array.from(svg.querySelectorAll('.board-rect'));
    if (rects.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      rects.forEach(r => {
        const x = parseFloat(r.getAttribute('x')) || 0;
        const y = parseFloat(r.getAttribute('y')) || 0;
        const w = parseFloat(r.getAttribute('width')) || 0;
        const h = parseFloat(r.getAttribute('height')) || 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      });
      if (isFinite(minX) && isFinite(minY) && maxX > minX && maxY > minY) {
        return { width: maxX - minX, height: maxY - minY };
      }
    }
  } catch(e) {}
  return getSvgViewBoxSize(svg);
}

function updateResponsiveFitScale(svg) {
  if (!svg || !svgContainer) { responsiveFitScale = 1; return; }

  const cw = Math.max(1, svgContainer.clientWidth - 12);
  const ch = Math.max(1, svgContainer.clientHeight - 12);

  // 板の長さ（横幅基準）
  const boardRects = Array.from(svg.querySelectorAll('.board-rect'));
  const longestBoardLength = boardRects.length
    ? Math.max(...boardRects.map(r => parseFloat(r.getAttribute('width')) || 0))
    : 0;

  // 全部品の配置範囲を取得（部品が板からはみ出している場合に対応）
  let maxPartX = 0, maxPartY = 0;
  Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).forEach(p => {
    const x = parseFloat(p.dataset.x || '0') || 0;
    const y = parseFloat(p.dataset.y || '0') || 0;
    const w = parseFloat(p.dataset.partW || '0') || 0;
    const h = parseFloat(p.dataset.partH || '0') || 0;
    const angle = parseFloat(p.dataset.angle || '0') || 0;
    const bb = rotatedBBoxRel(w, h, angle);
    maxPartX = Math.max(maxPartX, x + bb.maxX);
    maxPartY = Math.max(maxPartY, y + bb.maxY);
  });

  // 必要な幅・高さ：板のサイズと部品の配置範囲の大きい方を使う
  const contentSize = getBoardContentSize(svg);
  const requiredW = Math.max(longestBoardLength, maxPartX, contentSize.width || 0);
  const requiredH = Math.max(contentSize.height || 0, maxPartY);

  if (!requiredW || !requiredH) { responsiveFitScale = 1; return; }

  const widthFitScale = cw / requiredW;
  const heightFitScale = ch / requiredH;

  // 部品が板からはみ出している場合は縦横両方が収まるスケールを使う
  const hasOverflowX = maxPartX > longestBoardLength * 1.02;
  const hasOverflowY = maxPartY > (contentSize.height || 0) * 1.02;
  if (hasOverflowX || hasOverflowY) {
    // はみ出しあり：縦横ともに収まるよう両方の min を取る
    responsiveFitScale = Math.min(widthFitScale, heightFitScale);
  } else {
    // 通常：横幅基準。縦が著しくはみ出す場合のみ縦基準に切り替え
    responsiveFitScale = widthFitScale;
    if (isFinite(heightFitScale) && heightFitScale > 0 && heightFitScale < responsiveFitScale * 0.7) {
      responsiveFitScale = heightFitScale;
    }
  }

  responsiveFitScale *= 0.97;
  if (!isFinite(responsiveFitScale) || responsiveFitScale <= 0) responsiveFitScale = 1;
}

function getCurrentDisplayScale() {
  return Math.max(0.01, zoomScale * responsiveFitScale);
}

/* ===== 表示範囲を板・部品・注記の全体に合わせる =====
 * SVGのviewBoxが板寸法だけのままだと，板からはみ出した部品や部品名が
 * 画面端で切れてしまう。描画済み要素の実際の外接範囲を取得し，
 * 余白を加えたviewBoxへ更新する。
 */
function updateSvgViewBoxToAllContent(svg, extraPad = 12) {
  if (!svg) return;

  let minX = 0;
  let minY = -TOP_PAD;
  let maxX = 1;
  let maxY = 1;

  try {
    const specs = getBoardsSpecSafe();
    if (specs && specs.length) {
      maxX = Math.max(1, ...specs.map(s => Number(s.length) || 0));
      maxY = Math.max(1, ...specs.map(s => (Number(s.yOffset) || 0) + (Number(s.width) || 0)));
    }
  } catch (e) {}

  // SVG内の実際の描画範囲を利用する。文字，回転済み部品，切断線も含まれる。
  try {
    const box = svg.getBBox();
    if (box && Number.isFinite(box.x) && Number.isFinite(box.y) &&
        Number.isFinite(box.width) && Number.isFinite(box.height)) {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }
  } catch (e) {
    // getBBoxが使えない場合は部品データから補完する。
    Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).forEach(p => {
      const x = parseFloat(p.dataset.x || '0') || 0;
      const y = parseFloat(p.dataset.y || '0') || 0;
      const w = parseFloat(p.dataset.partW || '0') || 0;
      const h = parseFloat(p.dataset.partH || '0') || 0;
      const angle = parseFloat(p.dataset.angle || '0') || 0;
      const bb = rotatedBBoxRel(w, h, angle);
      minX = Math.min(minX, x + bb.minX);
      minY = Math.min(minY, y + bb.minY);
      maxX = Math.max(maxX, x + bb.maxX);
      maxY = Math.max(maxY, y + bb.maxY);
    });
  }

  const pad = Math.max(6, Number(extraPad) || 12);
  const viewX = minX - pad;
  const viewY = minY - pad;
  const viewW = Math.max(1, maxX - minX + pad * 2);
  const viewH = Math.max(1, maxY - minY + pad * 2);

  svg.setAttribute('viewBox', `${viewX} ${viewY} ${viewW} ${viewH}`);
  svg.setAttribute('width', `${viewW}mm`);
  svg.setAttribute('height', `${viewH}mm`);
}

// Multiple boards support (stacked vertically in a single SVG)
// board[0] uses the existing inputs; additional boards are created dynamically.
function getInputValue(input, fallback = 0) {
  if (input && input.value !== undefined && input.value !== null && input.value !== '') return input.value;
  return fallback;
}

let boards = [
  { lengthInput: boardLengthInput, widthInput: boardWidthInput, marginInput: marginInput }
];


/* ===== 表示：Zoom（拡大・縮小） ===== */
function applyZoomToSvg(svg) {
  if (!svg) return;
  updateResponsiveFitScale(svg);
  const size = getSvgViewBoxSize(svg);
  const scale = getCurrentDisplayScale();

  // CSS transform で縮小すると，SVGの見た目とマウス座標の対応がずれやすい。
  // そこで viewBox はそのままに，表示サイズ(width/height)だけをpx指定して
  // 描画エリア内に収める。内部座標・部品配置データには影響しない。
  svg.style.transform = 'none';
  svg.style.transformOrigin = '0 0';
  if (size.width && size.height) {
    svg.style.width = `${Math.max(1, size.width * scale)}px`;
    svg.style.height = `${Math.max(1, size.height * scale)}px`;
  }
}
function updateZoom(delta) {
  zoomScale = Math.max(0.1, Math.min(10, zoomScale * delta));
  const svg = svgContainer.querySelector('svg');
  applyZoomToSvg(svg);
}
if (zoomInBtn) zoomInBtn.addEventListener('click', () => updateZoom(1.1));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => updateZoom(0.9));
window.addEventListener('resize', () => {
  const svg = svgContainer.querySelector('svg');
  if (svg) applyZoomToSvg(svg);
});

/* ===== 単位切替ハンドラ ===== */
const unitSelect = document.getElementById('unit-select');
if (unitSelect) {
  // ページ読み込み時に保存済み単位を反映
  unitSelect.value = unitMode;
  if (unitMode === 'cm') {
    const u = unitLabel();
    const b1LenLabel = document.querySelector('#board1-settings label[for="board-length"]');
    const b1WidLabel = document.querySelector('#board1-settings label[for="board-width"]');
    const b1MarLabel = document.querySelector('#board1-settings label[for="margin"]');
    if (b1LenLabel) b1LenLabel.textContent = `板1の長さ (${u})`;
    if (b1WidLabel) b1WidLabel.textContent = `板1の幅 (${u})`;
    if (b1MarLabel) b1MarLabel.textContent = `部品の間隔 (${u})`;
    // 入力値をcmに変換（初期値はmmで書かれているため）
    if (boardLengthInput) boardLengthInput.value = Math.round((parseFloat(boardLengthInput.value) || 0) * 0.1 * 100) / 100;
    if (boardWidthInput) boardWidthInput.value = Math.round((parseFloat(boardWidthInput.value) || 0) * 0.1 * 100) / 100;
    if (marginInput) marginInput.value = Math.round((parseFloat(marginInput.value) || 0) * 0.1 * 100) / 100;
  }
  unitSelect.addEventListener('change', () => {
    const prev = unitMode;
    const next = unitSelect.value;
    if (prev === next) return;
    unitMode = next;
    try { localStorage.setItem('kidorin_unit_mode', next); } catch(e){}
    const factor = (prev === 'mm' && next === 'cm') ? 0.1 : 10; // mm→cm: ÷10, cm→mm: ×10
    const u = unitLabel();

    // 板1のラベルと値を更新
    const b1LenLabel = document.querySelector('#board1-settings label[for="board-length"]');
    const b1WidLabel = document.querySelector('#board1-settings label[for="board-width"]');
    const b1MarLabel = document.querySelector('#board1-settings label[for="margin"]');
    if (b1LenLabel) b1LenLabel.textContent = `板1の長さ (${u})`;
    if (b1WidLabel) b1WidLabel.textContent = `板1の幅 (${u})`;
    if (b1MarLabel) b1MarLabel.textContent = `部品の間隔 (${u})`;

    // 板1の入力値を変換
    if (boardLengthInput) boardLengthInput.value = Math.round((parseFloat(boardLengthInput.value) || 0) * factor * 100) / 100;
    if (boardWidthInput) boardWidthInput.value = Math.round((parseFloat(boardWidthInput.value) || 0) * factor * 100) / 100;
    if (marginInput) marginInput.value = Math.round((parseFloat(marginInput.value) || 0) * factor * 100) / 100;

    // 追加板のラベルと値を変換
    const extraGroups = extraBoardsContainer.querySelectorAll('.board-settings');
    extraGroups.forEach((group, gi) => {
      const idx = gi + 2; // 板2, 板3, ...
      const labels = group.querySelectorAll('label');
      labels.forEach(lbl => {
        const text = lbl.textContent;
        if (text.includes('長さ')) lbl.textContent = `板${idx}の長さ (${u})`;
        else if (text.includes('幅')) lbl.textContent = `板${idx}の幅 (${u})`;
        else if (text.includes('間隔')) lbl.textContent = `部品の間隔 (${u})`;
      });
      group.querySelectorAll('input[type="number"]').forEach(inp => {
        inp.value = Math.round((parseFloat(inp.value) || 0) * factor * 100) / 100;
      });
    });

    // 部品の寸法テキストを更新
    const svg = svgContainer.querySelector('svg');
    if (svg) {
      svg.querySelectorAll('g[data-x][id^="part-"] .part-dim-text').forEach(dt => {
        const partEl = dt.closest('g[data-x]');
        if (!partEl) return;
        const w = parseFloat(partEl.dataset.partW || '0') || 0;
        const h = parseFloat(partEl.dataset.partH || '0') || 0;
        const label = partEl.dataset.partLabel || partEl.id;
        dt.textContent = `${label}  ${Math.round(mmToDisplay(w))} × ${Math.round(mmToDisplay(h))} ${u}`;
      });
      // 寸法線テキストも更新
      svg.querySelectorAll('g.board-dims text').forEach(t => {
        const raw = t.textContent;
        // 既存の数値+単位を抽出して再フォーマット
        const m = raw.match(/^([\d.]+)\s*(mm|cm)$/);
        if (m) {
          const mmVal = prev === 'cm' ? parseFloat(m[1]) * 10 : parseFloat(m[1]);
          t.textContent = dimWithUnit(mmVal);
        }
      });
    }

    // 学習パネル（歩留まり・部品表）を更新
    updateLearningPanels();
    // 板情報テキストを更新
    renderBoardInfo();

    // STLが読み込み済みなら部品のジオメトリスケールが変わるため再描画
    if (geometriesCache.length > 0) {
      displayAsSvg(geometriesCache);
    } else {
      showInitialBoard();
    }
  });
}

stlInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    updateDocTitle(file.name);
    loadFile(file);
});

/* ===== 起動時：初期設定の板を表示 ===== */
function showInitialBoard() {
    const specs = getBoardsSpec();
    const board1 = specs[0] || { length: 1000, width: 160, margin: 5, yOffset: 0 };
    const maxBoardLength = Math.max(...specs.map(b => b.length), board1.length);
    const totalBoardsHeight = specs.reduce((acc, b, i) => acc + b.width + (i < specs.length - 1 ? (b.gap||20) : 0), 0) || board1.width;

    // 既存のSVGがあればキャンバスサイズだけ更新して再利用、なければ新規作成
    let svg = svgContainer.querySelector('svg');
    if (!svg) {
        svgContainer.innerHTML = '';
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
        svgContainer.appendChild(svg);
    }
    // 板の枚数・サイズに合わせてキャンバスを更新
    svg.setAttribute("width", `${maxBoardLength}mm`);
    svg.setAttribute("height", `${totalBoardsHeight + TOP_PAD}mm`);
    svg.setAttribute("viewBox", `0 ${-TOP_PAD} ${maxBoardLength} ${totalBoardsHeight + TOP_PAD}`);
    redrawBoardsOnly(svg);
    updateSvgViewBoxToAllContent(svg);
    applyZoomToSvg(svg);
}

/* ===== STL読み込み後の自動フィット（部品が描画エリアに収まらない場合に縮小） ===== */
function autoFitAfterLoad() {
    const svg = svgContainer.querySelector('svg');
    if (!svg) return;
    // updateResponsiveFitScale が部品のはみ出しを含めてスケールを計算するので、
    // zoomScale をリセットして applyZoomToSvg を呼ぶだけでよい。
    zoomScale = 1;
    applyZoomToSvg(svg);
}
svgContainer.addEventListener('dragover', (event) => { event.preventDefault(); svgContainer.style.borderColor = '#333'; });
svgContainer.addEventListener('dragleave', () => { svgContainer.style.borderColor = '#ccc'; });
svgContainer.addEventListener('drop', (event) => {
    event.preventDefault();
    svgContainer.style.borderColor = '#ccc';
    const file = event.dataTransfer.files[0];
    if (file) loadFile(file);
});
addBoardButton.addEventListener('click', () => {
    // Create a new board settings group with the same defaults as board 1
    const idx = boards.length + 1;

    const group = document.createElement('div');
    group.className = 'board-settings';
    const u = unitLabel();
    const defLen = unitMode === 'cm' ? 100 : 1000;
    const defWid = unitMode === 'cm' ? 16 : 160;
    const defMar = unitMode === 'cm' ? 0.5 : 5;
    group.innerHTML = `
      <div class="input-group">
        <label>板${idx}の長さ (${u})</label>
        <input type="number" value="${getInputValue(boardLengthInput, defLen)}" class="board-length" />
      </div>
      <div class="input-group">
        <label>板${idx}の幅 (${u})</label>
        <input type="number" value="${getInputValue(boardWidthInput, defWid)}" class="board-width" />
      </div>
      <div class="input-group">
        <label>部品の間隔 (${u})</label>
        <input type="number" value="${getInputValue(marginInput, defMar)}" class="board-margin" />
      </div>
    `;
    extraBoardsContainer.appendChild(group);

    const lengthInput = group.querySelector('.board-length');
    const widthInput  = group.querySelector('.board-width');
    const marginInputEl = group.querySelector('.board-margin');
    boards.push({ lengthInput, widthInput, marginInput: marginInputEl });

    // 板追加後は常に showInitialBoard でキャンバスサイズ・板描画を更新
    // （STL読み込み済みの場合も部品はそのまま保持され、板だけ追加される）
    showInitialBoard();
    // 部品がある場合はフィットスケールも再計算
    if (geometriesCache.length > 0) autoFitAfterLoad();
});

updateLayoutButton.addEventListener('click', () => {
    if (geometriesCache.length > 0) {
        displayAsSvg(geometriesCache);
    } else {
        showInitialBoard();
    }
});

/* ===== リセット：初期状態（板のみ・部品なし）に戻す ===== */
const resetLayoutButton = document.getElementById('reset-layout-button');
if (resetLayoutButton) {
    resetLayoutButton.addEventListener('click', () => {
        if (!confirm('リセットすると，読み込んだSTLと配置情報がすべて消えます。よろしいですか？')) return;

        // STL・部品データをクリア
        geometriesCache = [];
        stlArrayBufferCache = null;
        zoomScale = 1;
        partColorMap.clear();
        try {
          if (window.SharedStl) window.SharedStl.clear();
          else {
            localStorage.removeItem('kidorin_current_stl');
            localStorage.removeItem('kidorin_pending_strength_stl');
          }
          sessionStorage.removeItem('kidorin_strength_html');
          sessionStorage.removeItem('kidorin_strength_html_backup');
          // 強度画面（STLを埋め込んだHTML）の保存先も消去する
          if (window.indexedDB) indexedDB.deleteDatabase('kidorin_strength_screen_db');
        } catch(e) {}

        // 追加した板を削除し、boards を板1のみに戻す
        if (extraBoardsContainer) extraBoardsContainer.innerHTML = '';
        boards = [{ lengthInput: boardLengthInput, widthInput: boardWidthInput, marginInput: marginInput }];

        // 学習パネルを初期テキストに戻す
        const yieldEl = document.getElementById('yieldInfo');
        if (yieldEl) yieldEl.innerHTML = 'STLを読み込むと材料利用率が表示されます。';
        const grainEl = document.getElementById('grainWarnings');
        if (grainEl) grainEl.innerHTML = '木目方向や板サイズ・配置位置に注意があるときに表示されます。';
        const bomEl = document.getElementById('bomList');
        if (bomEl) bomEl.innerHTML = 'STLを読み込むと部品リストが表示されます。';

        // ファイル選択をリセット
        if (stlInput) stlInput.value = '';

        // 板だけ表示
        showInitialBoard();
    });
}


// 「レイアウト決定」：各板ごとに、現在その板に半分以上乗っている部品を、順序・回転を変えずに左端から詰め直す
if (finalizeLayoutButton) finalizeLayoutButton.addEventListener('click', () => {
    const svg = svgContainer.querySelector('svg');
    if (!svg) return;

    const specs = getBoardsSpec();
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));

    // Part metadata: W/H/area stored in dataset; fallback to bbox if absent
    // ユーザーが移動した後の順番を尊重するため、現在のX座標（左→右）でソートする
    const partMeta = parts.map(el => {
        const w = parseFloat(el.dataset.partW || el.dataset.w || '0') || 0;
        const h = parseFloat(el.dataset.partH || el.dataset.h || '0') || 0;
        const area = parseFloat(el.dataset.partArea || '0') || (w*h);
        const angle = (parseFloat(el.dataset.angle || '0') || 0) % 360;
        const x = parseFloat(el.dataset.x || '0') || 0;
        const y = parseFloat(el.dataset.y || '0') || 0;
        const idNum = parseInt((el.id || '').replace('part-',''), 10);
        return { el, w, h, area, angle, x, y, idNum: isNaN(idNum)?999999:idNum };
    }).sort((a, b) => {
        // 現在のX座標で左→右にソート。同じX座標のときはY座標（上→下）で判定
        if (Math.abs(a.x - b.x) > 1) return a.x - b.x;
        return a.y - b.y;
    });

    // rotatedBBoxRel はグローバル関数を利用
    function overlapArea(a, b){
        const x1=Math.max(a.minX,b.minX);
        const y1=Math.max(a.minY,b.minY);
        const x2=Math.min(a.maxX,b.maxX);
        const y2=Math.min(a.maxY,b.maxY);
        if (x2<=x1 || y2<=y1) return 0;
        return (x2-x1)*(y2-y1);
    }

    
    function drawBoardDimensions(svg, specs, boardParts){
        // remove old dimension graphics
        svg.querySelectorAll('g.board-dims').forEach(g=>g.remove());

        const ns = 'http://www.w3.org/2000/svg';
        boardParts.forEach((plist, bi)=>{
            const s = specs[bi];
            const g = document.createElementNS(ns,'g');
            g.setAttribute('class','board-dims');

            // compute used width
// - horizontal layout: sum(width) + spacing
// - vertical layout: used width is the actual X-span of all placed parts (supports multiple columns)
const margin = s.margin;
let sumW = 0;
let maxW = 0;
let minPlacedX = Infinity;
let maxPlacedX = -Infinity;

plist.forEach(p=>{
            if (p.el && p.el.dataset && p.el.dataset.offboard === '1') { return; }
    const bb = rotatedBBoxRel(p.w, p.h, p.angle);
    sumW += bb.width;
    maxW = Math.max(maxW, bb.width);

    // placed extent in board coords (dataset.x/y are translate of the outer group)
    const px = parseFloat(p.el.dataset.x || '0') || 0;
    minPlacedX = Math.min(minPlacedX, px + bb.minX);
    maxPlacedX = Math.max(maxPlacedX, px + bb.maxX);
});

const mode = (plist[0] && plist[0].el && plist[0].el.dataset.layoutMode) ? plist[0].el.dataset.layoutMode : 'h';
const spacing = (mode === 'h') ? (Math.max(0, plist.length-1) * margin) : 0;

const used = (mode === 'h') ? (sumW + spacing) : Math.max(0, maxPlacedX - minPlacedX);

            const remaining = s.length - used;

            // baseline under the board
            const y = s.yOffset + s.width + 10; // 寸法線：板の少し下（mm）
            const tickH = 6;

            function svgEl(tag, attrs){
                const el = document.createElementNS(ns, tag);
                for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
                return el;
            }

            const STROKE_COMMON = {stroke:'#333','stroke-width':'1','vector-effect':'non-scaling-stroke'};

            function addDimSegment(x1,x2,val){
                g.appendChild(svgEl('line', {x1, y1:y, x2, y2:y, ...STROKE_COMMON}));
                const tickAttrs = {x1, y1:y - tickH/2, x2:x1, y2:y + tickH/2, ...STROKE_COMMON};
                g.appendChild(svgEl('line', tickAttrs));
                g.appendChild(svgEl('line', {...tickAttrs, x1:x2, x2}));
                const text = svgEl('text', {x:(x1+x2)/2, y:y - 2,
                    'text-anchor':'middle', 'dominant-baseline':'ideographic',
                    'font-size':'10', fill:'#333', 'pointer-events':'none'});
                text.textContent = dimWithUnit(val);
                g.appendChild(text);
            }

            const usedClamped = Math.max(0, Math.min(s.length, used));
            addDimSegment(0, usedClamped, usedClamped);

            const remClamped = Math.max(0, s.length - usedClamped);
            if (remClamped > 0){
                addDimSegment(usedClamped, s.length, remClamped);
            } else {
                addDimSegment(s.length, s.length, 0);
            }

            svg.appendChild(g);
        });
    }

// assign parts to boards
    // Rule:
    // 1) If a part overlaps a board by >=50% of its area, assign to the board with the largest overlap.
    // 2) Otherwise, assign to the board with the largest (non-zero) overlap.
    // 3) If no overlap at all, assign by the part's center Y to the nearest board band.
    const boardParts = specs.map(()=>[]);
    partMeta.forEach(p=>{
        const bboxRel = rotatedBBoxRel(p.w, p.h, p.angle);
        const bboxAbs = {
            minX: p.x + bboxRel.minX,
            maxX: p.x + bboxRel.maxX,
            minY: p.y + bboxRel.minY,
            maxY: p.y + bboxRel.maxY
        };

        let bestIdx = -1;
        let bestOv = 0;

        specs.forEach((s, i)=>{
            const boardRect = {minX:0, maxX:s.length, minY:s.yOffset, maxY:s.yOffset+s.width};
            const ov = overlapArea(bboxAbs, boardRect);
            if (ov > bestOv){
                bestOv = ov;
                bestIdx = i;
            }
        });

        // Prefer boards that satisfy >=50% rule
        if (bestIdx >= 0 && bestOv >= 0.5 * p.area){
            boardParts[bestIdx].push(p);
            return;
        }

        // Otherwise, if any overlap, still assign to the max-overlap board (so all parts are processed)
        if (bestIdx >= 0 && bestOv > 0){
            boardParts[bestIdx].push(p);
            return;
        }

        // No overlap: assign by nearest board band using part centerY
        const centerY = (bboxAbs.minY + bboxAbs.maxY) / 2;
        let nearestIdx = 0;
        let nearestDist = Infinity;
        specs.forEach((s, i)=>{
            const bandCenter = s.yOffset + s.width/2;
            const d = Math.abs(centerY - bandCenter);
            if (d < nearestDist){
                nearestDist = d;
                nearestIdx = i;
            }
        });
        boardParts[nearestIdx].push(p);
    });

// reposition per board (auto: horizontal or vertical), preserving order + rotation
    // Rules:
    // - If the parts are currently arranged more "vertically" (spreadY > spreadX)
    //   AND (sum of part heights + spacing) fits within board width, then stack vertically.
    // - Otherwise, place horizontally (left-to-right) with spacing.
    // - In vertical mode: align left edges to the left-most part position, and align to the board top edge.
    // - In horizontal mode: align to board top edge and left edge starts at 0.
    // reposition per board (auto: horizontal or vertical), preserving order + rotation
// Rules:
// - Determine if the CURRENT arrangement on this board is more vertical than horizontal (spreadY > spreadX).
// - If so, and if (sum of part heights + vertical gaps) fits within board width, then stack vertically.
// - Vertical mode: align all parts' left edge to the LEFTMOST part currently on that board.
// - Otherwise: keep the standard horizontal layout (left-to-right), align to board top, left edge starts at 0.
boardParts.forEach((plist, bi)=>{
    const s = specs[bi];
    const gap = s.margin;
    const edgeGap = 0;           // 板の左端は部品間隔を空けずに詰める
    const verticalEdgeGap = 0;   // 縦方向には部品の間隔を効かせず、上部にそろえる
        const EPS = 0.5; // mm tolerance for near-exact fits

    if (!plist || plist.length === 0) return;

    const placed = plist.map(p=>{
        const bbRel = rotatedBBoxRel(p.w, p.h, p.angle);
        const bbAbs = {minX: p.x + bbRel.minX, maxX: p.x + bbRel.maxX,
                       minY: p.y + bbRel.minY, maxY: p.y + bbRel.maxY};
        return { p, bbRel, bbAbs };
    // 板内でもユーザーが並べた左→右の順を尊重してソート
    }).sort((a, b) => {
        const cx_a = (a.bbAbs.minX + a.bbAbs.maxX) / 2;
        const cx_b = (b.bbAbs.minX + b.bbAbs.maxX) / 2;
        if (Math.abs(cx_a - cx_b) > 1) return cx_a - cx_b;
        return (a.bbAbs.minY + a.bbAbs.maxY) / 2 - (b.bbAbs.minY + b.bbAbs.maxY) / 2;
    });

    const minX = Math.min(...placed.map(o=>o.bbAbs.minX));
    const maxX = Math.max(...placed.map(o=>o.bbAbs.maxX));
    const minY = Math.min(...placed.map(o=>o.bbAbs.minY));
    const maxY = Math.max(...placed.map(o=>o.bbAbs.maxY));

    // Use center spread to decide vertical tendency (less sensitive to a single wide part)
    const minCX = Math.min(...placed.map(o=>(o.bbAbs.minX+o.bbAbs.maxX)/2));
    const maxCX = Math.max(...placed.map(o=>(o.bbAbs.minX+o.bbAbs.maxX)/2));
    const minCY = Math.min(...placed.map(o=>(o.bbAbs.minY+o.bbAbs.maxY)/2));
    const maxCY = Math.max(...placed.map(o=>(o.bbAbs.minY+o.bbAbs.maxY)/2));
    const spreadX = Math.max(0, maxCX - minCX);
    const spreadY = Math.max(0, maxCY - minCY);

    const sumHeights = placed.reduce((acc,o)=>acc + o.bbRel.height, 0);
const needH = sumHeights + Math.max(0, placed.length - 1) * gap;

// Decide vertical tendency:
// - Base requirement: stacked height fits within board width
// - Additionally: detect if parts are arranged in vertical columns (1+ parts share similar X)
//   This works even when there are already multiple columns (spreadX may exceed spreadY).
const avgW = placed.reduce((acc,o)=>acc + o.bbRel.width, 0) / placed.length;
const tol = Math.max(20, Math.min(80, avgW * 0.6)); // clustering tolerance in mm

const centers = placed.map(o=>({cx:(o.bbAbs.minX+o.bbAbs.maxX)/2}));
centers.sort((a,b)=>a.cx-b.cx);

let colCount = 0;
let maxColSize = 0;
let curSize = 0;
let lastCx = null;
centers.forEach(c=>{
    if (lastCx === null || Math.abs(c.cx - lastCx) > tol){
        if (curSize > 0){
            colCount += 1;
            maxColSize = Math.max(maxColSize, curSize);
        }
        curSize = 1;
        lastCx = c.cx;
    } else {
        curSize += 1;
        // keep lastCx as the running average to stabilize clusters
        lastCx = (lastCx * (curSize-1) + c.cx) / curSize;
    }
});
if (curSize > 0){
    colCount += 1;
    maxColSize = Math.max(maxColSize, curSize);
}

const hasColumn = (maxColSize >= 2); // at least one vertical column exists
const wantVertical = hasColumn || ((spreadY > spreadX) && (needH <= (s.width + 0.5)));

    if (wantVertical) {
            // Vertical layout that RESPECTS the user's current column arrangement.
            // 1) Detect current columns by clustering X centers (uses avgW/tol from outer scope).
            // 2) Keep each part in its current column (no merging across columns).
            // 3) Pack each column top-to-bottom, left edges aligned to the column's left-most part.
            // 4) Keep columns in their current left-to-right order.

            // Build sortable list with current X center
            const items = placed.map(o=>({
                o,
                cx: (o.bbAbs.minX + o.bbAbs.maxX) / 2
            })).sort((a,b)=>a.cx-b.cx);

            // Make column clusters by CX proximity
            let cols = [];
            items.forEach(it=>{
                if (cols.length === 0) {
                    cols.push({cx: it.cx, parts: [it.o]});
                    return;
                }
                const last = cols[cols.length-1];
                if (Math.abs(it.cx - last.cx) <= tol) {
                    last.parts.push(it.o);
                    // update running center
                    last.cx = (last.cx * (last.parts.length-1) + it.cx) / last.parts.length;
                } else {
                    cols.push({cx: it.cx, parts: [it.o]});
                }
            });

            // For each column: preserve its current left edge (minX) and order by current Y (top to bottom)
            cols.forEach(c=>{
                c.leftX = Math.min(...c.parts.map(o=>o.bbAbs.minX));
                c.maxW  = Math.max(...c.parts.map(o=>o.bbRel.width));
                c.parts.sort((a,b)=>a.bbAbs.minY - b.bbAbs.minY);
                c.needH = c.parts.reduce((acc,o)=>acc + o.bbRel.height, 0) + Math.max(0, c.parts.length-1)*gap;
            });
// Split columns if needed so that each resulting column fits within board width (in Y).
// This allows 3+ parts to still use vertical layout by wrapping into additional columns.
let canVertical = true;
const splitCols = [];

cols.forEach(c=>{
    let curParts = [];
    let curH = 0;
    let curW = 0;

    const flush = ()=>{
        if (curParts.length){
            splitCols.push({ parts: curParts, maxW: curW });
        }
    };

    c.parts.forEach(o=>{
        const h = o.bbRel.height;
        const w = o.bbRel.width;

        if (h > (s.width + 0.5)) {
            canVertical = false; // single part too tall for the board
        }

        const addH = (curParts.length ? (gap + h) : h);

        if (curParts.length && (curH + addH > (s.width + 0.5))) {
            flush();
            curParts = [o];
            curH = h;
            curW = w;
        } else {
            if (!curParts.length) {
                curParts = [o];
                curH = h;
                curW = w;
            } else {
                curParts.push(o);
                curH += gap + h;
                curW = Math.max(curW, w);
            }
        }
    });

    flush();
});

if (!canVertical) {
    // fall back to horizontal layout
    let curX = edgeGap;
    const topY = s.yOffset + verticalEdgeGap;
    placed.forEach(o=>{
        const bb = o.bbRel;
        const newX = curX - bb.minX;
        const newY = topY - bb.minY;
        o.p.el.dataset.x = newX;
        o.p.el.dataset.y = newY;
        o.p.el.dataset.layoutMode = 'h';
        o.p.el.dataset.offboard = '1';
        o.p.el.setAttribute('transform', `translate(${newX} ${newY})`);
        curX += bb.width + gap;
    });
} else {
    // Use the split columns for vertical layout
    cols = splitCols;

    // Keep columns left-to-right as placed (based on original left edges, approximated by current X center)
    // (split columns inherit their source column order via iteration order)

                // Keep columns left-to-right as placed

// Re-layout columns from the left edge with the specified gap.
// - preserves column order
// - enforces gap between columns
// - starts at x=0 without a leading margin
const totalW = cols.reduce((acc,c)=>acc + c.maxW, 0) + Math.max(0, cols.length-1)*gap;

if (totalW > s.length + EPS) {
    // Partial vertical layout: place as many columns as fit from the left,
    // and lay out the remaining parts horizontally OUTSIDE the board (to the right).
    let runningX = edgeGap;
    const overflowParts = [];

    cols.forEach((c, idx)=>{
        const neededX = (idx === 0) ? c.maxW : (gap + c.maxW);
        if (runningX + neededX <= s.length + EPS) {
            if (idx !== 0) runningX += gap;
            let curY = s.yOffset + verticalEdgeGap;
            const colLeft = runningX;

            c.parts.forEach((o, partIdx)=>{
                const bb = o.bbRel;
                // 1番目の部品は基準面にピタッと合わせる。2番目以降は部品間隔を空ける
                if (partIdx > 0) curY += gap;
                const newX = colLeft - bb.minX;
                const newY = curY - bb.minY;
                o.p.el.dataset.x = newX;
                o.p.el.dataset.y = newY;
                o.p.el.dataset.layoutMode = 'v';
                o.p.el.dataset.offboard = '0';
                o.p.el.setAttribute('transform', `translate(${newX} ${newY})`);
                curY += bb.height;
            });

            runningX += c.maxW;
        } else {
            overflowParts.push(...c.parts);
        }
    });

    // Overflow parts: horizontal row to the right of the board (keeps them visible)
    let curX = s.length + gap;
    const topY = s.yOffset;
    overflowParts.forEach(o=>{
        const bb = o.bbRel;
        const newX = curX - bb.minX;
        const newY = topY - bb.minY;
        o.p.el.dataset.x = newX;
        o.p.el.dataset.y = newY;
        o.p.el.dataset.layoutMode = 'h';
        o.p.el.dataset.offboard = '1';
        o.p.el.setAttribute('transform', `translate(${newX} ${newY})`);
        curX += bb.width + gap;
    });
} else {
    let runningX = edgeGap;  // 左端から間隔を空ける
    cols.forEach((c, idx)=>{
        if (idx !== 0) runningX += gap;
        let curY = s.yOffset + verticalEdgeGap;  // 上辺にそろえる
        const colLeft = runningX;

        c.parts.forEach((o, partIdx)=>{
            const bb = o.bbRel;
            // 1番目の部品は基準面にピタッと合わせる。2番目以降は部品間隔を空ける
            if (partIdx > 0) curY += gap;
            const newX = colLeft - bb.minX;
            const newY = curY - bb.minY;
            o.p.el.dataset.x = newX;
            o.p.el.dataset.y = newY;
            o.p.el.dataset.layoutMode = 'v';
                    o.p.el.dataset.offboard = '0';
            o.p.el.setAttribute('transform', `translate(${newX} ${newY})`);
            curY += bb.height;
        });

        runningX += c.maxW;
    });
}}
        } else {
        let curX = edgeGap;  // 左端から間隔を空ける
        const topY = s.yOffset + verticalEdgeGap;  // 上辺にそろえる

        placed.forEach(o=>{
            const bb = o.bbRel;
            const newX = curX - bb.minX;
            const newY = topY - bb.minY;

            o.p.el.dataset.x = newX;
            o.p.el.dataset.y = newY;
            o.p.el.dataset.layoutMode = 'h';
                    o.p.el.dataset.offboard = '0';
            o.p.el.setAttribute('transform', `translate(${newX} ${newY})`);

            curX += bb.width + gap;
        });
    }
});



    // draw dimension lines for each board (used width + remaining)
    drawBoardDimensions(svg, specs, boardParts);
    drawCutLines(svg);
    Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).forEach(refreshPartVisualState);
    updateSvgViewBoxToAllContent(svg, 16);
    applyZoomToSvg(svg);
    updateLearningPanels();

});


/* ===== STL読み込み ===== */
let stlArrayBufferCache = null; // 3Dビューア用にバッファをキャッシュ
function arrayBufferToDataUrl(buffer){
    try{
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for(let i=0;i<bytes.length;i+=chunk){
            const sub = bytes.subarray(i, i+chunk);
            binary += String.fromCharCode.apply(null, sub);
        }
        return 'data:application/sla;base64,' + btoa(binary);
    }catch(e){ return null; }
}

async function loadArrayBufferAsStl(contents, fileName, options = {}) {
    if (!(contents instanceof ArrayBuffer) || contents.byteLength === 0) {
        throw new Error('STLデータが空、または読み込めない形式です。');
    }
    const name = fileName || 'model.stl';
    stlArrayBufferCache = contents.slice(0);

    if (options.persist !== false) {
        try{
            const dataUrl = arrayBufferToDataUrl(contents);
            if(dataUrl){
                const payload = { name, dataUrl };
                if (window.SharedStl && window.SharedStl.setAsync) await window.SharedStl.setAsync(payload);
                else if (window.SharedStl) window.SharedStl.set(payload);
                else localStorage.setItem('kidorin_current_stl', JSON.stringify(payload));
            }
        }catch(storageErr){ console.warn('STLの共有保存に失敗しました', storageErr); }
    }

    updateDocTitle(name);
    if (!window.THREE || !THREE.STLLoader) throw new Error('STLLoaderを読み込めませんでした。インターネット接続を確認してください。');
    const loader = new THREE.STLLoader();
    const geometry = loader.parse(contents);
    if (!geometry || !geometry.attributes || !geometry.attributes.position || geometry.attributes.position.count < 3) {
        throw new Error('STLの三角形データを確認できませんでした。');
    }
    geometriesCache = separateGeometries(geometry);
    if (!geometriesCache.length) throw new Error('STLから部品を取り出せませんでした。');
    zoomScale = 1;
    displayAsSvg(geometriesCache);
    return true;
}

function loadFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) { resolve(false); return; }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                resolve(await loadArrayBufferAsStl(e.target.result, file.name || 'model.stl'));
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(reader.error || new Error('STLファイルの読み込みに失敗しました。'));
        reader.readAsArrayBuffer(file);
    });
}
window.loadStlFileFromStrength = function(file){
    return loadFile(file);
};


/* ===== STLの部品分離（連結成分の分解） ===== */
function separateGeometries(geometry) {
    // （この関数は変更ありません）
    const positions = geometry.attributes.position.array;
    const numTriangles = positions.length / 9;
    const visited = new Array(numTriangles).fill(false);
    const adjacency = new Map();
    const edgeToTriangles = new Map();
    const precision = 1e4;
    for (let i = 0; i < numTriangles; i++) {
        const triangleVertices = [];
        for (let j = 0; j < 3; j++) {
            const vertIndex = i * 9 + j * 3;
            const x = Math.round(positions[vertIndex] * precision) / precision;
            const y = Math.round(positions[vertIndex + 1] * precision) / precision;
            const z = Math.round(positions[vertIndex + 2] * precision) / precision;
            const key = `${x}|${y}|${z}`;
            triangleVertices.push(key);
        }
        for (let j = 0; j < 3; j++) {
            const v1 = triangleVertices[j], v2 = triangleVertices[(j + 1) % 3];
            const edgeKey = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
            if (!edgeToTriangles.has(edgeKey)) edgeToTriangles.set(edgeKey, []);
            edgeToTriangles.get(edgeKey).push(i);
        }
    }
    for (const triangles of edgeToTriangles.values()) {
        if (triangles.length === 2) {
            const [triA, triB] = triangles;
            if (!adjacency.has(triA)) adjacency.set(triA, []);
            if (!adjacency.has(triB)) adjacency.set(triB, []);
            adjacency.get(triA).push(triB);
            adjacency.get(triB).push(triA);
        }
    }
    const separatedGeometries = [];
    for (let i = 0; i < numTriangles; i++) {
        if (!visited[i]) {
            const componentTriangles = [], queue = [i];
            visited[i] = true;
            while (queue.length > 0) {
                const currentTri = queue.shift();
                componentTriangles.push(currentTri);
                const neighbors = adjacency.get(currentTri) || [];
                for (const neighbor of neighbors) {
                    if (!visited[neighbor]) {
                        visited[neighbor] = true;
                        queue.push(neighbor);
                    }
                }
            }
            const newPositions = new Float32Array(componentTriangles.length * 9);
            for (let k = 0; k < componentTriangles.length; k++) {
                const triIndex = componentTriangles[k];
                for (let v = 0; v < 9; v++) newPositions[k * 9 + v] = positions[triIndex * 9 + v];
            }
            const newGeo = new THREE.BufferGeometry();
            newGeo.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
            separatedGeometries.push(newGeo);
        }
    }
    return separatedGeometries;
}



/* ===== 板の設定（複数板・縦に積む） ===== */
function getBoardsSpec() {
    // Returns [{length,width,margin,yOffset}] stacked vertically (always in mm)
    const gap = 20; // mm gap between boards (visual separation)
    const specsRaw = boards.map(b => ({
        length: Math.max(0, unitInputToMm(parseFloat(getInputValue(b.lengthInput, unitMode === 'cm' ? 100 : 1000)) || 0)),
        width: Math.max(0, unitInputToMm(parseFloat(getInputValue(b.widthInput, unitMode === 'cm' ? 16 : 160)) || 0)),
        margin: Math.max(0, unitInputToMm(parseFloat(getInputValue(b.marginInput, unitMode === 'cm' ? 0.5 : 5)) || 0)),
    }));
    let y = 0;
    const specs = specsRaw.map((s, i) => {
        const yOffset = y;
        y += s.width + (i < specsRaw.length - 1 ? gap : 0);
        return { ...s, yOffset, gap };
    });
    window.sheets = specs;
    return specs;
}

/* ===== 描画：板（木目・点線枠）だけを描き直す ===== */
function redrawBoardsOnly(svg) {
    if (!svg) return;
    
    // --- Wood texture pattern for boards ---
    // Remove any existing defs to avoid duplicate pattern IDs
    svg.querySelectorAll('defs').forEach(d => d.remove());
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    pattern.setAttribute("id", "boardPattern");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    // 10mm間隔で横方向ライン（木目風）
    pattern.setAttribute("width", "10");
    pattern.setAttribute("height", "10");

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", "10");
    bg.setAttribute("height", "10");
    bg.setAttribute("fill", "#F0E0B2");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "0");
    line.setAttribute("x2", "10");
    line.setAttribute("y2", "0");
    line.setAttribute("stroke", "#b57a3a");
    line.setAttribute("stroke-width", "0.8");
    line.setAttribute("opacity", "0.55");

    pattern.appendChild(bg);
    pattern.appendChild(line);
    defs.appendChild(pattern);
    svg.appendChild(defs);

const specs = getBoardsSpec();
    // Remove old boards layer
    const old = svg.querySelector('#boards-layer');
    if (old) old.remove();

    const boardsLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    boardsLayer.setAttribute('id', 'boards-layer');

    specs.forEach((b, i) => {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.classList.add("board-rect");
        rect.setAttribute("x", 0);
        rect.setAttribute("y", b.yOffset);
        rect.setAttribute("width", b.length);
        rect.setAttribute("height", b.width);
        rect.setAttribute("fill", "url(#boardPattern)");
        rect.setAttribute("data-board-index", String(i + 1));
        boardsLayer.appendChild(rect);
    });

    // Insert boards layer at the top so it stays behind parts
    svg.insertBefore(boardsLayer, svg.firstChild);
    renderBoardInfo();
    // 切断線は「レイアウト決定」を押したときだけ表示する。
    // 板を描き直す（初期表示・板の追加など）ときは，配置が変わるため一旦消す。
    clearCutLines(svg);
}

/* ===== 描画：切断線（赤い点線）と凡例 =====
  仕様：
  - 各部品の実際の輪郭（三角形メッシュの外郭エッジ）を外側に「部品の間隔」の
    半分だけオフセットした形状で赤い点線の切断線を引く。
    → 斜め辺・円弧状の輪郭にも対応。
  - 一番上の板（板1）の上辺は「基準面」に部品をそろえて置くため，
    その基準面側（部品の上辺）には切断線を引かない。
  - 縦に部品が複数並ぶ場合，2番目以降の部品は設定した部品間隔をあける。
  - 各部品の左右端の切断線は，板の下端まで縦に伸ばす。
    ただし下に他の部品がある場合は，その部品の切断線の手前で止める。
*/

// ---------- ジオメトリユーティリティ ----------

/** 三角形メッシュから外郭エッジを抽出する。
 *  3D メッシュを 2D 投影した場合，同じエッジが複数の面から現れるため
 *  count===1 ではなく各 count レベルのエッジセットを全て返す。
 *  呼び出し元（getPartLocalContour）が最大面積ポリゴンを選択する。
 *  面積ゼロの縮退三角形（面に対して垂直な側面など）は除外する。 */
function extractOutlineEdgesByCount(triangles){
  const edgeMap = new Map();
  const Q = 1e4;
  function vkey(p){ return `${Math.round(p.x*Q)/Q},${Math.round(p.y*Q)/Q}`; }

  const AREA_EPS = 0.01;
  triangles.forEach(tri=>{
    const {p1, p2, p3} = tri;
    const area = Math.abs((p2.x-p1.x)*(p3.y-p1.y) - (p3.x-p1.x)*(p2.y-p1.y)) / 2;
    if (area < AREA_EPS) return;

    const verts = [p1, p2, p3];
    for (let i=0;i<3;i++){
      const a = verts[i], b = verts[(i+1)%3];
      const ka = vkey(a), kb = vkey(b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edgeMap.has(ek)) edgeMap.set(ek, {a, b, count:0});
      edgeMap.get(ek).count++;
    }
  });

  if (!edgeMap.size) return {};

  // count ごとにエッジをグループ化
  const byCount = new Map();
  edgeMap.forEach(v=>{
    if (!byCount.has(v.count)) byCount.set(v.count, []);
    byCount.get(v.count).push({a:v.a, b:v.b});
  });
  return byCount;
}

// 後方互換のラッパー（count===minCount を返す従来動作）
function extractOutlineEdges(triangles){
  const byCount = extractOutlineEdgesByCount(triangles);
  if (!byCount.size) return [];
  const minCount = Math.min(...Array.from(byCount.keys()));
  return byCount.get(minCount) || [];
}

/** 外郭エッジを連結して順序付きポリゴン列に組み上げる。
 *  スロット・ノッチなど T 字分岐（degree-4 頂点）がある場合も
 *  「最も時計回りなエッジを選ぶ」半エッジ走査で正しく外郭を抽出する。 */
function buildOutlinePolygons(edges){
  if (!edges.length) return [];
  const Q = 1e4;
  function vkey(p){ return `${Math.round(p.x*Q)/Q},${Math.round(p.y*Q)/Q}`; }

  // 隣接リストと座標マップを構築
  const adj = new Map();
  const ptMap = new Map();
  edges.forEach(e=>{
    const ka=vkey(e.a), kb=vkey(e.b);
    if(!adj.has(ka)) adj.set(ka,[]);
    if(!adj.has(kb)) adj.set(kb,[]);
    if(!ptMap.has(ka)) ptMap.set(ka, e.a);
    if(!ptMap.has(kb)) ptMap.set(kb, e.b);
    adj.get(ka).push(kb);
    adj.get(kb).push(ka);
  });

  // 半エッジ走査：各有向エッジを出発点として使用済みフラグで管理
  // 分岐点では「最も時計回り（SVG y下向き座標系）の次エッジ」を選ぶことで
  // 外郭ポリゴンを正しくトレースする
  const usedHE = new Set();
  const polygons = [];

  for (const [startKey] of adj.entries()){
    for (const initNextKey of adj.get(startKey)){
      if (usedHE.has(`${startKey}→${initNextKey}`)) continue;

      const poly = [];
      let prevKey = startKey;
      let curKey  = initNextKey;

      for (let iter = 0; iter < edges.length * 3; iter++){
        const heK = `${prevKey}→${curKey}`;
        if (usedHE.has(heK)) break;
        usedHE.add(heK);

        poly.push(ptMap.get(curKey));
        if (curKey === startKey) break; // ループ閉鎖

        const neighbors = adj.get(curKey) || [];
        const prevPt = ptMap.get(prevKey);
        const curPt  = ptMap.get(curKey);
        const inDx = curPt.x - prevPt.x, inDy = curPt.y - prevPt.y;

        // 分岐点で最も時計回り（最も右手方向）のエッジを選ぶ
        let bestKey = null, bestAng = Infinity;
        for (const nb of neighbors){
          if (nb === prevKey && neighbors.length > 1) continue; // 折り返し禁止（選択肢がある場合）
          const nbPt = ptMap.get(nb);
          const outDx = nbPt.x - curPt.x, outDy = nbPt.y - curPt.y;
          // atan2(cross, dot): 負に近いほど時計回り（SVG y下向き）
          const ang = Math.atan2(inDx*outDy - inDy*outDx, inDx*outDx + inDy*outDy);
          if (ang < bestAng){ bestAng = ang; bestKey = nb; }
        }
        if (!bestKey) break;
        prevKey = curKey;
        curKey  = bestKey;
      }

      if (poly.length >= 3) polygons.push(poly);
    }
  }

  // 面積で外郭（時計回り＝SVGで正の面積）のみを残し，重複を除去
  function polyArea(pts){
    let s = 0;
    for (let i=0;i<pts.length;i++){ const a=pts[i],b=pts[(i+1)%pts.length]; s+=a.x*b.y-b.x*a.y; }
    return s/2;
  }
  const outer = polygons.filter(p => polyArea(p) > 0.5);
  const seen  = new Map();
  return outer.filter(p=>{
    const key = Math.round(Math.abs(polyArea(p)));
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

/** ポリゴンが反時計回りかどうか（正なら反時計回り，負なら時計回り） */
function polygonArea(pts){
  let s=0;
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    s += (a.x*b.y - b.x*a.y);
  }
  return s/2;
}

/** ポリゴンを外側に d だけオフセット（Minkowski法で各辺を外向き法線方向に d ずらし角を処理） */
function offsetPolygon(pts, d){
  const n = pts.length;
  if (n < 3) return pts;
  // SVG座標系（y軸下向き）：外向き法線 = (dy/len, -dx/len)。
  // これは画面上の時計回り（area>0）の頂点順に対して成立する。
  const area = polygonArea(pts);
  // 時計回り（area>0）に統一する
  const ordered = area > 0 ? pts.slice() : pts.slice().reverse();

  const offsets = [];
  for (let i=0;i<n;i++){
    const a = ordered[i], b = ordered[(i+1)%n];
    const dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.sqrt(dx*dx+dy*dy);
    if (len < 1e-9){ offsets.push({nx:0,ny:0}); continue; }
    // 時計回り・y下向きの外向き法線 = (dy/len, -dx/len)
    offsets.push({nx: dy/len, ny: -dx/len});
  }

  const result = [];
  for (let i=0;i<n;i++){
    const prev = (i-1+n)%n;
    const n1 = offsets[prev], n2 = offsets[i];
    const a = ordered[i];
    // バイセクタ（隣接2辺の外向き法線の平均方向）でオフセット
    const bx = n1.nx+n2.nx, by = n1.ny+n2.ny;
    const blen = Math.sqrt(bx*bx+by*by);
    if (blen < 1e-9){
      result.push({x: a.x+n2.nx*d, y: a.y+n2.ny*d});
    } else {
      const bn = {x: bx/blen, y: by/blen};
      const cosHalf = bn.x*n2.nx + bn.y*n2.ny;
      // miter長さ = d / cos(半角)。スパイク防止のため上限5d
      const miter = cosHalf > 0.1 ? d/cosHalf : d*5;
      result.push({x: a.x+bn.x*miter, y: a.y+bn.y*miter});
    }
  }
  return result;
}

/**
 * 部品のローカル輪郭ポリゴンを取得する。
 * `.part-outline` 内の polygon 要素から三角形を読み取り，
 * 外郭エッジを抽出→連結→最大の輪郭ポリゴンを返す。
 * 失敗したときは矩形フォールバック。
 */
function getPartLocalContour(partEl){
  const w = parseFloat(partEl.dataset.partW||'0')||0;
  const h = parseFloat(partEl.dataset.partH||'0')||0;
  const outlineGroup = partEl.querySelector('.part-outline');
  if (!outlineGroup) return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];

  const tris = [];
  Array.from(outlineGroup.querySelectorAll('polygon')).forEach(poly=>{
    const pts = (poly.getAttribute('points')||'').trim().split(/\s+/).map(s=>{
      const [x,y]=s.split(',').map(Number); return {x,y};
    });
    if(pts.length>=3) tris.push({p1:pts[0],p2:pts[1],p3:pts[2]});
  });

  if (!tris.length) return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];

  // 各 count レベルのエッジを全て試し，最大面積ポリゴンを採用する
  const byCount = extractOutlineEdgesByCount(tris);
  if (!byCount.size) return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];

  function polyArea(pts){
    let s=0;
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];s+=a.x*b.y-b.x*a.y;}
    return Math.abs(s/2);
  }

  const bboxArea = w * h;
  let bestPoly = null;
  let bestArea  = 0;

  // count の小さい順に試す（小さいほど外郭に近い傾向）
  const sortedCounts = Array.from(byCount.keys()).sort((a,b)=>a-b);
  for (const cnt of sortedCounts){
    const edges = byCount.get(cnt);
    const polys = buildOutlinePolygons(edges);
    for (const poly of polys){
      const a = polyArea(poly);
      // バウンディングボックス面積の 50%〜110% の範囲で最大面積のものを採用
      if (a > bboxArea * 0.5 && a <= bboxArea * 1.1 && a > bestArea){
        bestArea = a;
        bestPoly = poly;
      }
    }
    if (bestPoly) break; // 最小 count で見つかればそれを使う
  }

  if (bestPoly && bestPoly.length >= 3) return bestPoly;

  // フォールバック：バウンディングボックス矩形
  return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
}

/**
 * 部品の輪郭ポリゴンを，回転・移動適用後の絶対座標に変換する。
 * outer: translate(px,py)  inner(.rot-group): rotate(angle,cx,cy)
 */
function getPartAbsoluteContour(partEl){
  const px = parseFloat(partEl.dataset.x||'0')||0;
  const py = parseFloat(partEl.dataset.y||'0')||0;
  const angle = parseFloat(partEl.dataset.angle||'0')||0;
  const cx = parseFloat(partEl.dataset.centerX||'0')||0;
  const cy = parseFloat(partEl.dataset.centerY||'0')||0;
  const local = getPartLocalContour(partEl);
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return local.map(p=>{
    // rotate around (cx,cy)
    const dx=p.x-cx, dy=p.y-cy;
    const rx=dx*cos-dy*sin+cx;
    const ry=dx*sin+dy*cos+cy;
    // translate
    return {x:rx+px, y:ry+py};
  });
}

// ---------- メイン：切断線描画 ----------

function getPartCutRects(svg, specs){
  // 後方互換: 縦方向の延長線計算に使うバウンディングボックス情報を返す
  specs = specs || getBoardsSpecSafe();
  const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
  const result = specs.map(()=>[]);
  parts.forEach(p=>{
    if (p.dataset && p.dataset.offboard === '1') return;
    const w = parseFloat(p.dataset.partW || '0') || 0;
    const h = parseFloat(p.dataset.partH || '0') || 0;
    const x = parseFloat(p.dataset.x || '0') || 0;
    const y = parseFloat(p.dataset.y || '0') || 0;
    const angle = parseFloat(p.dataset.angle || '0') || 0;
    if (w <= 0 || h <= 0) return;
    const bb = rotatedBBoxRel(w, h, angle);
    const board = findBoardForPart(p, specs);
    if (!board || board.index < 0) return;
    const s = board.spec;
    const half = Math.max(0, (s.margin || 0) / 2);
    const rect = {
      minX: x + bb.minX,
      maxX: x + bb.maxX,
      minY: y + bb.minY,
      maxY: y + bb.maxY
    };
    result[board.index].push({ el:p, rect, half, boardIndex: board.index });
  });
  return result;
}

function clearCutLines(svg){
  if (!svg) return;
  const layer = svg.querySelector('#cut-lines-layer');
  if (layer) layer.remove();
  const legend = svg.querySelector('#cut-legend');
  if (legend) legend.remove();
}

function drawCutLines(svg){
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const specs = getBoardsSpecSafe();

  const oldLayer = svg.querySelector('#cut-lines-layer');
  if (oldLayer) oldLayer.remove();

  const layer = document.createElementNS(ns, 'g');
  layer.setAttribute('id', 'cut-lines-layer');

  const STROKE_ATTRS = {
    stroke: '#e00000',
    'stroke-width': '0.5',        // 0.5mm — SVGユーザー座標（mm単位）で指定
    'stroke-dasharray': '3,2',    // 3mm on, 2mm off — 短い斜め辺でも確実に表示される
    fill: 'none'
    // vector-effect: non-scaling-strokeを使わない。
    // Chromiumでは non-scaling-stroke があると stroke-dasharray も
    // スクリーンピクセル単位になり，縮小表示時に短い斜め辺が見えなくなるため。
  };
  function applyStroke(el){
    for (const [k,v] of Object.entries(STROKE_ATTRS)) el.setAttribute(k, v);
  }
  function svgLine(x1, y1, x2, y2){
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    applyStroke(el);
    layer.appendChild(el);
  }
  function svgPolyline(pts){
    if (pts.length < 2) return;
    const el = document.createElementNS(ns, 'polyline');
    el.setAttribute('points', pts.map(p=>`${p.x},${p.y}`).join(' '));
    applyStroke(el);
    layer.appendChild(el);
  }
  function svgPolygon(pts){
    if (pts.length < 3) return;
    const el = document.createElementNS(ns, 'polygon');
    el.setAttribute('points', pts.map(p=>`${p.x},${p.y}`).join(' '));
    applyStroke(el);
    layer.appendChild(el);
  }

  const EPS = 0.5;
  // bboxベースのデータ（縦延長線の停止判定に使用）
  const boardRects = getPartCutRects(svg, specs);

  /**
   * ポリゴンを水平線 y = clipY でクリップし，y >= clipY の部分だけ残す
   * （Sutherland-Hodgman アルゴリズム・1辺版）
   */
  function clipPolygonAbove(pts, clipY){
    if (!pts || pts.length < 3) return pts;
    const inside = p => p.y >= clipY - EPS;
    const intersect = (a, b) => {
      // 直線 a-b と y=clipY の交点
      const t = (clipY - a.y) / (b.y - a.y);
      return { x: a.x + t*(b.x - a.x), y: clipY };
    };
    const output = [];
    for (let i = 0; i < pts.length; i++){
      const cur = pts[i], prev = pts[(i - 1 + pts.length) % pts.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn){
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn){
        output.push(intersect(prev, cur));
      }
    }
    return output;
  }

  specs.forEach((s, bi)=>{
    const items = boardRects[bi];
    if (!items || !items.length) return;
    const boardTop = s.yOffset;
    const boardBottom = s.yOffset + s.width;
    const half = Math.max(0, (s.margin || 0) / 2);

    items.forEach(item=>{
      const partEl = item.el;
      const r = item.rect;

      // 全ての板で上辺が基準面（部品を板の上端に揃えて置く面）→ 上側の切断線不要
      const isReferenceTop = Math.abs(r.minY - boardTop) <= half + EPS + 1;

      // ---- 実際の輪郭ポリゴンを取得・オフセット ----
      const absPoly = getPartAbsoluteContour(partEl);
      let offsetPoly = offsetPolygon(absPoly, half);

      if (!offsetPoly || offsetPoly.length < 3){
        // フォールバック：矩形で描画
        const cutL=r.minX-half, cutR=r.maxX+half, cutT=r.minY-half, cutB=r.maxY+half;
        svgLine(cutL, cutB, cutR, cutB);
        if (!isReferenceTop) svgLine(cutL, cutT, cutR, cutT);
        const sideTop = isReferenceTop ? r.minY : cutT;
        svgLine(cutL, sideTop, cutL, cutB);
        svgLine(cutR, sideTop, cutR, cutB);
        return;
      }

      if (!isReferenceTop){
        // 基準面でない：オフセットポリゴン全体を描画
        svgPolygon(offsetPoly);
      } else {
        // 基準面側（上辺）を除く：y >= boardTop の部分だけ残してポリゴン描画
        // オフセットポリゴンの上端は boardTop - half（つまり負値の場合あり）なので
        // boardTop でクリップして基準面以上（下方向）だけ描画する
        const clipped = clipPolygonAbove(offsetPoly, boardTop);
        if (clipped && clipped.length >= 2){
          // クリップ後はポリラインとして描画（上辺は開口）
          // クリップにより上辺が直線 y=boardTop に置き換わっているが，
          // その辺は描画不要なので始点→終点が boardTop 上にある辺を除いて描画する
          // → 単純に「y=boardTop の水平辺を除いた残り」をポリラインで出力
          const n = clipped.length;
          let segments = [];
          let cur = null;
          for (let i = 0; i < n; i++){
            const a = clipped[i];
            const b = clipped[(i+1) % n];
            // y=boardTop の水平辺（クリップで生じた基準面辺）はスキップ
            const isTopEdge = Math.abs(a.y - boardTop) < EPS && Math.abs(b.y - boardTop) < EPS;
            if (isTopEdge){
              if (cur && cur.length >= 2) segments.push(cur);
              cur = null;
            } else {
              if (!cur) cur = [a];
              cur.push(b);
            }
          }
          if (cur && cur.length >= 2) segments.push(cur);
          // 連続するセグメントを1本のポリラインにまとめる
          segments.forEach(seg => svgPolyline(seg));
        }
      }
    });

    // ---- 縦の切断線を板の下端まで伸ばす（bboxベース） ----
    items.forEach(item=>{
      const r = item.rect;
      const cutB = r.maxY + half;
      const xs = [r.minX - half, r.maxX + half];
      xs.forEach(xPos=>{
        let stopY = boardBottom + half;
        items.forEach(other=>{
          if (other === item) return;
          const o = other.rect;
          const oCutL = o.minX - half;
          const oCutR = o.maxX + half;
          const oCutT = o.minY - half;
          if (xPos > oCutL - EPS && xPos < oCutR + EPS && oCutT > cutB - EPS){
            if (oCutT < stopY) stopY = oCutT;
          }
        });
        if (stopY > cutB + EPS){
          svgLine(xPos, cutB, xPos, stopY);
        }
      });
    });
  });

  svg.appendChild(layer);
  drawCutLegend(svg, specs);
}

function drawCutLegend(svg, specs){
  const ns = 'http://www.w3.org/2000/svg';
  specs = specs || getBoardsSpecSafe();
  const old = svg.querySelector('#cut-legend');
  if (old) old.remove();
  if (!specs || !specs.length) return;

  const s0 = specs[0];
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('id', 'cut-legend');

  // 板1の左上（左寄せ）に配置。板の上端より少し上に表示する。
  const x = 0;
  const y = (s0.yOffset || 0) - 6;

  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(y));
  text.setAttribute('text-anchor', 'start');
  text.setAttribute('dominant-baseline', 'ideographic');
  text.setAttribute('font-size', '9');
  text.setAttribute('font-weight', '700');
  text.setAttribute('pointer-events', 'none');

  const black = document.createElementNS(ns, 'tspan');
  black.setAttribute('fill', '#000');
  black.textContent = '黒線：仕上げ線，';
  const red = document.createElementNS(ns, 'tspan');
  red.setAttribute('fill', '#e00000');
  red.textContent = '赤線：切断線';

  text.appendChild(black);
  text.appendChild(red);
  g.appendChild(text);
  svg.appendChild(g);
}


function displayAsSvg(geometries) {
    svgContainer.innerHTML = '';
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");


    const specs = getBoardsSpec();
    const board1 = specs[0] || { length: 1000, width: 140, margin: 5, yOffset: 0 };
    const boardLength = board1.length;
    const boardWidth = board1.width;
    const margin = board1.margin;

    const maxBoardLength = Math.max(...specs.map(b => b.length), boardLength);
    const totalBoardsHeight = specs.reduce((acc, b, i) => acc + b.width + (i < specs.length - 1 ? b.gap : 0), 0) || boardWidth;

    // 原寸(mm)で出力
    svg.setAttribute("width", `${maxBoardLength}mm`);
    svg.setAttribute("height", `${totalBoardsHeight + TOP_PAD}mm`);
    svg.setAttribute("viewBox", `0 ${-TOP_PAD} ${maxBoardLength} ${totalBoardsHeight + TOP_PAD}`);

    svgContainer.appendChild(svg);

    // Boards background (do not change parts color; only board area)
    redrawBoardsOnly(svg);

    // --- Layout (keeps existing behavior: lays out from board 1, top-left) ---
    let currentOffsetX = margin;
    let currentOffsetY = board1.yOffset;
    let rowMaxHeight = 0;

    // allow overflow beyond initial drawing extents (boards stacked)
    let maxExtentX = maxBoardLength;
    let maxExtentY = totalBoardsHeight;

    geometries.forEach((geometry, index) => {
        const positions = geometry.attributes.position.array;
        if (positions.length === 0) return;

        const projections = { xy: [], xz: [], yz: [] };
        let boundsXY = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        let boundsXZ = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        let boundsYZ = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        // 3D外形寸法。簡易解析では，3方向寸法の最小値を板厚候補として使う。
        let bounds3D = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
        function expand3d(p){
            if(p.x<bounds3D.minX) bounds3D.minX=p.x;
            if(p.x>bounds3D.maxX) bounds3D.maxX=p.x;
            if(p.y<bounds3D.minY) bounds3D.minY=p.y;
            if(p.y>bounds3D.maxY) bounds3D.maxY=p.y;
            if(p.z<bounds3D.minZ) bounds3D.minZ=p.z;
            if(p.z>bounds3D.maxZ) bounds3D.maxZ=p.z;
        }

        for (let i = 0; i < positions.length; i += 9) {
            const p1_3d={x:positions[i],y:positions[i+1],z:positions[i+2]},
                  p2_3d={x:positions[i+3],y:positions[i+4],z:positions[i+5]},
                  p3_3d={x:positions[i+6],y:positions[i+7],z:positions[i+8]};
            expand3d(p1_3d); expand3d(p2_3d); expand3d(p3_3d);
            projections.xy.push({p1:{x:p1_3d.x,y:p1_3d.y},p2:{x:p2_3d.x,y:p2_3d.y},p3:{x:p3_3d.x,y:p3_3d.y}});
            projections.xz.push({p1:{x:p1_3d.x,y:p1_3d.z},p2:{x:p2_3d.x,y:p2_3d.z},p3:{x:p3_3d.x,y:p3_3d.z}});
            projections.yz.push({p1:{x:p1_3d.y,y:p1_3d.z},p2:{x:p2_3d.y,y:p2_3d.z},p3:{x:p3_3d.y,y:p3_3d.z}});
        }

        function expandBounds(bounds, tris){
            tris.forEach(tri=>{
                [tri.p1,tri.p2,tri.p3].forEach(p=>{
                    if(p.x<bounds.minX) bounds.minX=p.x;
                    if(p.x>bounds.maxX) bounds.maxX=p.x;
                    if(p.y<bounds.minY) bounds.minY=p.y;
                    if(p.y>bounds.maxY) bounds.maxY=p.y;
                });
            });
        }
        expandBounds(boundsXY, projections.xy);
        expandBounds(boundsXZ, projections.xz);
        expandBounds(boundsYZ, projections.yz);

        const areaXY=(boundsXY.maxX-boundsXY.minX)*(boundsXY.maxY-boundsXY.minY),
              areaXZ=(boundsXZ.maxX-boundsXZ.minX)*(boundsXZ.maxY-boundsXZ.minY),
              areaYZ=(boundsYZ.maxX-boundsYZ.minX)*(boundsYZ.maxY-boundsYZ.minY);

        let bestProjection=projections.xy;
        let bestBounds=boundsXY;
        let bestProjAxis='xy';
        if(areaXZ>areaXY && areaXZ>=areaYZ){bestProjection=projections.xz;bestBounds=boundsXZ;bestProjAxis='xz';}
        else if(areaYZ>areaXY && areaYZ>areaXZ){bestProjection=projections.yz;bestBounds=boundsYZ;bestProjAxis='yz';}

        // cm モードでは STL 座標を 10 倍して内部mm座標に変換（CADがcm単位の場合に対応）
        const geoScale = unitMode === 'cm' ? 10 : 1;

        const partWidth = (bestBounds.maxX - bestBounds.minX) * geoScale;
        const partHeight = (bestBounds.maxY - bestBounds.minY) * geoScale;
        if (!isFinite(partWidth) || !isFinite(partHeight) || partWidth<=0 || partHeight<=0) return;

        // line-break layout within board 1 (same as before)
        if (currentOffsetX + partWidth + margin > boardLength) {
            currentOffsetX = margin;
            currentOffsetY += rowMaxHeight;
            rowMaxHeight = 0;
        }

        const initialX = currentOffsetX;
        const initialY = currentOffsetY;

        // ---- Two-level grouping (translate outer, rotate inner) ----
        const outer = document.createElementNS("http://www.w3.org/2000/svg", "g");
        outer.id = `part-${index}`;
        outer.dataset.x = initialX;
        outer.dataset.y = initialY;
        outer.dataset.angle = 0;

        // Normalize to local coordinates (0..W, 0..H) so rotation never "flies away"
        const centerX = partWidth / 2;
        const centerY = partHeight / 2;
        const partNo = index + 1;
        const partLabel = `部品${partNo}`;
        const partKey = toPartKey(partWidth, partHeight);          // BOM・寸法グループ用
        const shapeKey = toShapeKey(partWidth, partHeight, bestProjection, bestBounds); // 色識別用
        const partColor = getColorForPartKey(shapeKey);
        outer.dataset.centerX = centerX;
        outer.dataset.centerY = centerY;
        outer.dataset.partW = partWidth;
        outer.dataset.partH = partHeight;
        outer.dataset.partNo = partNo;
        outer.dataset.partLabel = partLabel;
        outer.dataset.partKey = partKey;
        outer.dataset.partColor = partColor;
        outer.dataset.projAxis = bestProjAxis;
        const size3dX = Math.max(0, bounds3D.maxX - bounds3D.minX) * geoScale;
        const size3dY = Math.max(0, bounds3D.maxY - bounds3D.minY) * geoScale;
        const size3dZ = Math.max(0, bounds3D.maxZ - bounds3D.minZ) * geoScale;
        const sorted3dDims = [size3dX, size3dY, size3dZ].filter(v => Number.isFinite(v) && v > 0).sort((a,b)=>a-b);
        const inferredThickness = sorted3dDims.length ? sorted3dDims[0] : 0;
        outer.dataset.size3dX = size3dX;
        outer.dataset.size3dY = size3dY;
        outer.dataset.size3dZ = size3dZ;
        outer.dataset.min3dX = bounds3D.minX * geoScale;
        outer.dataset.max3dX = bounds3D.maxX * geoScale;
        outer.dataset.min3dY = bounds3D.minY * geoScale;
        outer.dataset.max3dY = bounds3D.maxY * geoScale;
        outer.dataset.min3dZ = bounds3D.minZ * geoScale;
        outer.dataset.max3dZ = bounds3D.maxZ * geoScale;
        outer.dataset.inferredThickness = inferredThickness;
        outer.dataset.thicknessSource = 'stl';

        outer.setAttribute("transform", `translate(${initialX} ${initialY})`);

        const inner = document.createElementNS("http://www.w3.org/2000/svg", "g");
        inner.classList.add("rot-group");
        inner.setAttribute("transform", `rotate(0, ${centerX}, ${centerY})`);

        const outlineGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        outlineGroup.setAttribute("class","part-outline");
        outlineGroup.setAttribute("stroke","black");
        outlineGroup.setAttribute("stroke-width","0.5");
        outlineGroup.setAttribute("fill","none");
        outlineGroup.setAttribute("vector-effect","non-scaling-stroke");

        const fillGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        fillGroup.setAttribute("fill", partColor);
        fillGroup.setAttribute("stroke","none");

        bestProjection.forEach(tri=>{
          const points=`${(tri.p1.x-bestBounds.minX)*geoScale},${(tri.p1.y-bestBounds.minY)*geoScale} ${(tri.p2.x-bestBounds.minX)*geoScale},${(tri.p2.y-bestBounds.minY)*geoScale} ${(tri.p3.x-bestBounds.minX)*geoScale},${(tri.p3.y-bestBounds.minY)*geoScale}`;
          const outlinePoly=document.createElementNS("http://www.w3.org/2000/svg","polygon");
          outlinePoly.setAttribute("points",points);
          outlineGroup.appendChild(outlinePoly);

          const fillPoly=document.createElementNS("http://www.w3.org/2000/svg","polygon");
          fillPoly.setAttribute("points",points);
          fillGroup.appendChild(fillPoly);
        });

        inner.appendChild(outlineGroup);
        inner.appendChild(fillGroup);


        // 寸法表示：常に「通常表示」（回転させない）。外側gに載せることで移動は追従し、回転は追従しない。
        const dimText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        dimText.setAttribute("class", "part-dim-text");
        dimText.setAttribute("x", centerX.toString());
        dimText.setAttribute("y", centerY.toString());
        dimText.setAttribute("text-anchor", "middle");
        dimText.setAttribute("dominant-baseline", "middle");

        const badge = document.createElementNS("http://www.w3.org/2000/svg", "g");
        badge.setAttribute("class", "part-no-badge");
        const badgeCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        badgeCircle.setAttribute("class", "part-no-circle");
        badgeCircle.setAttribute("r", "9");
        badgeCircle.setAttribute("fill", partColor);
        const badgeText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        badgeText.setAttribute("class", "part-no-text");
        badgeText.setAttribute("text-anchor", "middle");
        badgeText.setAttribute("dominant-baseline", "central");
        badgeText.textContent = String(partNo);
        badge.appendChild(badgeCircle);
        badge.appendChild(badgeText);

        const grainTag = document.createElementNS("http://www.w3.org/2000/svg", "text");
        grainTag.setAttribute("class", "part-grain-tag");
        grainTag.textContent = '木目注意';

        const boardWarningTag = document.createElementNS("http://www.w3.org/2000/svg", "text");
        boardWarningTag.setAttribute("class", "part-board-warning-tag");
        boardWarningTag.textContent = '板サイズ・配置位置注意';

        // store approximate 2D area (sum of triangle areas) for board-assignment in 「レイアウト決定」
        let partArea = 0;
        bestProjection.forEach(tri => {
          const ax = (tri.p1.x - bestBounds.minX) * geoScale, ay = (tri.p1.y - bestBounds.minY) * geoScale;
          const bx = (tri.p2.x - bestBounds.minX) * geoScale, by = (tri.p2.y - bestBounds.minY) * geoScale;
          const cx = (tri.p3.x - bestBounds.minX) * geoScale, cy = (tri.p3.y - bestBounds.minY) * geoScale;
          partArea += Math.abs((ax*(by-cy) + bx*(cy-ay) + cx*(ay-by)) / 2);
        });
        outer.dataset.partArea = partArea;

        dimText.textContent = `${partLabel}  ${Math.round(mmToDisplay(partWidth))} × ${Math.round(mmToDisplay(partHeight))} ${unitLabel()}`;

        outer.appendChild(inner);
        outer.appendChild(dimText);
        outer.appendChild(badge);
        outer.appendChild(grainTag);
        outer.appendChild(boardWarningTag);
        svg.appendChild(outer);
        refreshPartVisualState(outer);

        // Track required drawing extents (allow overflow beyond initial board size & stacked boards)
        maxExtentX = Math.max(maxExtentX, initialX + partWidth + margin);
        maxExtentY = Math.max(maxExtentY, initialY + partHeight + margin);

        currentOffsetX += partWidth + margin;
        if (partHeight > rowMaxHeight) rowMaxHeight = partHeight;
    });

    // Expand SVG canvas if parts exceed the initial drawing extents
    const requiredLength = Math.max(maxBoardLength, maxExtentX);
    const DIM_EXTRA_PAD = 40; // extra space (mm) for dimension lines below boards
    const requiredHeight = Math.max(totalBoardsHeight,  maxExtentY) + DIM_EXTRA_PAD;
    svg.setAttribute('width', `${requiredLength}mm`);
    svg.setAttribute('height', `${requiredHeight + TOP_PAD}mm`);
    svg.setAttribute('viewBox', `0 ${-TOP_PAD} ${requiredLength} ${requiredHeight + TOP_PAD}`);

    // Keep boards visible; boards themselves remain same size, but viewBox can grow
    redrawBoardsOnly(svg);

    // make interactive
    makeInteractive(svg);
    // 部品名・警告表示を含む実際の描画範囲までviewBoxを広げる。
    updateSvgViewBoxToAllContent(svg, 16);
    // 部品が描画エリアをはみ出す場合に自動縮小。なければ通常のフィット表示。
    autoFitAfterLoad();
    updateLearningPanels();
}

/* ===== 操作：移動・回転の反映（中心回転） ===== */
function updateTransform(outer) {
    const x = parseFloat(outer.dataset.x) || 0;
    const y = parseFloat(outer.dataset.y) || 0;
    outer.setAttribute('transform', `translate(${x}, ${y})`);

    const angle = parseFloat(outer.dataset.angle) || 0;
    const cx = parseFloat(outer.dataset.centerX) || 0;
    const cy = parseFloat(outer.dataset.centerY) || 0;
    const inner = outer.querySelector('.rot-group');
    if (inner) {
      inner.setAttribute('transform', `rotate(${angle}, ${cx}, ${cy})`);
    }
    refreshPartVisualState(outer);
}

/* ===== 操作：ドラッグ移動／右クリック・ダブルタップで90°回転 ===== */
function makeInteractive(svg) {
    // ---- 回転処理（右クリック・ダブルタップ共通） ----
    function rotatePart(outer) {
        let angle = parseFloat(outer.dataset.angle) || 0;
        angle = (angle + 90) % 360;
        outer.dataset.angle = angle;
        updateTransform(outer);
        // 配置が変わったので，古い切断線は消す（「レイアウト決定」で再表示）
        clearCutLines(svg);
        updateSvgViewBoxToAllContent(svg, 16);
        applyZoomToSvg(svg);
        updateLearningPanels();
    }

    // 右クリックで90度回転（PC）
    svg.addEventListener('contextmenu', (e) => {
        const outer = e.target.closest && e.target.closest('g[data-x]');
        if (!outer) return;
        e.preventDefault();
        e.stopPropagation();
        rotatePart(outer);
    });

    // ダブルクリックで90度回転（PC）
    svg.addEventListener('dblclick', (e) => {
        const outer = e.target.closest && e.target.closest('g[data-x]');
        if (!outer) return;
        e.preventDefault();
        e.stopPropagation();
        rotatePart(outer);
    });

    // ダブルタップで90度回転（タッチデバイス）
    // 300ms以内の2回タップ、かつ指の移動が10px以内の場合のみ回転
    const DOUBLE_TAP_MS   = 300; // ダブルタップ判定時間（ms）
    const DOUBLE_TAP_MOVE = 10;  // 移動許容距離（px）：これ以上動いたらドラッグと判断
    let lastTap = { time: 0, x: 0, y: 0, target: null };

    svg.addEventListener('touchend', (e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        const now = Date.now();
        const dx = touch.clientX - lastTap.x;
        const dy = touch.clientY - lastTap.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const outer = touch.target.closest && touch.target.closest('g[data-x]');

        if (
            outer &&
            now - lastTap.time < DOUBLE_TAP_MS &&
            dist < DOUBLE_TAP_MOVE &&
            lastTap.target === outer
        ) {
            // ダブルタップ確定：ブラウザのデフォルト（ズームなど）を抑止して回転
            e.preventDefault();
            rotatePart(outer);
            // 連続判定を防ぐためリセット
            lastTap = { time: 0, x: 0, y: 0, target: null };
        } else {
            lastTap = { time: now, x: touch.clientX, y: touch.clientY, target: outer };
        }
    }, { passive: false });

    // ドラッグ：タッチ・マウス共通、慣性なし・位置補正なし
    // touch-action:none を設定してブラウザのスクロール横取りを防ぎ感度を向上
    interact('g[data-x]')
        .styleCursor(false)      // interact.js 側のカーソル自動変更を無効（手動管理）
        .draggable({
            inertia: false,
            modifiers: [],
            // タッチ操作でブラウザのスクロール・ズームを抑止する
            // （これがないとiPadでイベントがブラウザに横取りされる）
            listeners: {
                start(event) {
                    event.target.style.cursor = 'grabbing';
                    svg.appendChild(event.target); // 前面へ
                },
                move(event) {
                    const target = event.target;

                    // 表示倍率（自動フィット倍率 × 手動ズーム倍率）だけで内部座標へ戻す。
                    // これにより，従来どおりのドラッグ挙動を保ちつつ，自動フィット表示とも両立させる。
                    const scale = Math.max(0.01, getCurrentDisplayScale());
                    const x = (parseFloat(target.dataset.x) || 0) + (event.dx / scale);
                    const y = (parseFloat(target.dataset.y) || 0) + (event.dy / scale);
                    target.dataset.x = x;
                    target.dataset.y = y;
                    updateTransform(target);
                },
                end(event) {
                    event.target.style.cursor = 'grab';
                    // ドラッグで配置が変わったので，古い切断線は消す（「レイアウト決定」で再表示）
                    clearCutLines(svg);
                    updateSvgViewBoxToAllContent(svg, 16);
                    applyZoomToSvg(svg);
                    updateLearningPanels();
                }
            }
        });

    // SVG要素全体に touch-action:none を付与してブラウザのスクロール介入を防ぐ
    // （interact.js の設定だけでは不十分なケースがあるため CSS でも明示する）
    svg.style.touchAction = 'none';
}

/* ===== PDF表示用：板の寸法一覧 ===== */
function renderBoardInfo(){
  const el = document.getElementById('boardInfo');
  if (!el) return;
  if (!window.sheets || !Array.isArray(window.sheets) || window.sheets.length === 0){
    el.innerHTML = '';
    return;
  }
  const u = unitLabel();
  const rows = window.sheets.map((s, i)=>{
    const n = i + 1;
    const len = formatDim(s.length ?? 0);
    const wid = formatDim(s.width ?? 0);
    const gap = formatDim(s.margin ?? 0);
    return `<div class="board-row">板${n}：長さ ${len} ${u}／幅 ${wid} ${u}／部品の間隔 ${gap} ${u}</div>`;
  }).join('');
  el.innerHTML = rows;
}

/* ===== 教育用：梁要素による簡易FEM解析＋3Dたわみアニメーション =====
 * 注意：3DソリッドFEMではなく，部品を1次元の梁要素に近似した教育用の簡易有限要素モデルです。
 */
(function(){
  // 材料は中学1年生向けに「スギ相当」の1種類へ固定する。
  // E・許容応力は教材用の代表値であり，実物の安全性を保証する値ではない。
  const SUGI_MATERIAL = {
    key:'sugi',
    label:'スギ相当（教材用）',
    E:5880,                 // 資料 表2-11 スギ柾目のヤング係数 60 tf/cm2 を換算した代表値 MPa（旧値は75tf/cm2としていたが資料で確認できなかったため修正）
    allow:18,               // 資料の曲げ破壊強さに安全側の余裕をみた教材用許容値 MPa
    compressionAllow:12,    // 資料の圧縮強さに安全側の余裕をみた教材用許容値 MPa
    densityKgM3:380         // 資料の気乾比重0.38から求めた代表密度 kg/m3
  };
  // 古い保存データの softwood を読み込んでも同じ材料になるよう互換性を残す。
  const MATERIALS = { sugi:SUGI_MATERIAL, softwood:SUGI_MATERIAL };
  const SUPPORTS = {
    auto:           { label:'STL形状から自動判定' },
    simple_center:  { label:'両端で支える・真ん中に本を置く' },
    simple_uniform: { label:'両端で支える・全体に本を置く' },
    cantilever:     { label:'片側だけ固定して先に本を置く' }
  };
  const FORCE_DIRECTIONS = {
    top:  { label:'上からの力', shortLabel:'上から', description:'本を上に置いたときの曲がりやすさを見ます。' },
    side: { label:'左右からの力', shortLabel:'左右から', description:'横から押されたときのゆれ・曲がりやすさを見ます。' }
  };
  const JOINT_METHODS = {
    glue: { label:'接着剤のみ', shortLabel:'接着剤', factor:1.00, note:'面でくっつけます。はがれる向きの力に注意します。' },
    nails: { label:'釘のみ', shortLabel:'釘', factor:1.55, note:'釘のまわりに力が集まりやすいので，ずれや回転に注意します。' },
    glue_nails: { label:'接着剤＋釘', shortLabel:'接着剤＋釘', factor:0.75, note:'面と点の両方で支えるので，比較的安定しやすいです。' }
  };
  function normalizeForceDirection(direction){
    return direction === 'side' ? 'side' : 'top';
  }

  function num(id, fallback){
    const el = document.getElementById(id);
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) ? v : fallback;
  }
  function strengthLoadKg(){
    return Math.max(0, num('book-count', 10)) * Math.max(0, num('book-weight', 0.5));
  }
  function currentMaterial(){
    return SUGI_MATERIAL;
  }
  function currentSupport(){
    const key = (document.getElementById('support-condition') || {}).value || 'auto';
    return { key, ...(SUPPORTS[key] || SUPPORTS.auto) };
  }
  function currentJointMethod(){
    const key = (document.getElementById('joint-method') || {}).value || 'glue_nails';
    return { key, ...(JOINT_METHODS[key] || JOINT_METHODS.glue_nails) };
  }
  function femElementCount(){
    // 教材画面では解析の細かさを選ばせず，安定して軽い16分割へ固定する。
    return 16;
  }
  function thicknessMode(){
    const el = document.getElementById('thickness-mode');
    return el ? el.value : 'stl';
  }
  function manualThicknessMm(){
    return Math.max(1, num('member-thickness', 12));
  }
  function inferredThicknessMm(partEl){
    const t = parseFloat(partEl && partEl.dataset ? partEl.dataset.inferredThickness : '');
    return Number.isFinite(t) && t > 0 ? t : NaN;
  }
  function memberThicknessMm(partEl){
    if (thicknessMode() === 'stl') {
      const t = inferredThicknessMm(partEl);
      if (Number.isFinite(t) && t > 0) return Math.max(1, t);
    }
    return manualThicknessMm();
  }
  function effectiveMaterialForPart(partEl, material){
    const grainMisaligned = typeof isPartAcrossGrain === 'function' && isPartAcrossGrain(partEl);
    // 木目が部材の長い方向と合わない場合は，曲がりやすさと許容強度を別々に補正する。
    // 角度を細かく入力させず，「合う／合わない」の2段階にして操作を簡単にする。
    const eFactor = grainMisaligned ? 0.65 : 1.0;
    const strengthFactor = grainMisaligned ? 0.55 : 1.0;
    return {
      E:Math.max(1, (material.E || 8000) * eFactor),
      allow:Math.max(0.1, (material.allow || 18) * strengthFactor),
      compressionAllow:Math.max(0.1, (material.compressionAllow || 12) * strengthFactor),
      grainMisaligned,
      grainFactor:grainMisaligned ? (1 / strengthFactor) : 1.0
    };
  }
  function contactPenaltyFromRatio(ratio){
    if (!Number.isFinite(ratio)) return 1.0;
    const r = Math.max(0.05, Math.min(1, ratio));
    return Math.max(1, Math.min(2.2, 1 / Math.sqrt(r)));
  }
  function thicknessSourceLabel(partEl){
    if (thicknessMode() === 'stl' && Number.isFinite(inferredThicknessMm(partEl))) return 'STL推定';
    return '手入力';
  }
  function collectInferredThicknessStats(){
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return null;
    const vals = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'))
      .map(p => inferredThicknessMm(p))
      .filter(v => Number.isFinite(v) && v > 0)
      .sort((a,b)=>a-b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 ? vals[mid] : (vals[mid-1] + vals[mid]) / 2;
    const min = vals[0];
    const max = vals[vals.length - 1];
    return { count: vals.length, min, max, median };
  }
  function partIndexFromEl(el){
    const m = String(el.id || '').match(/part-(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }
  function riskLabel(risk){
    if (risk >= 0.72) return {label:'見直したい', cls:'danger', color:'#dc2626'};
    if (risk >= 0.42) return {label:'確かめたい', cls:'caution', color:'#f59e0b'};
    return {label:'余裕あり', cls:'safe', color:'#16a34a'};
  }

  function getPart3dBox(partEl){
    const get = name => parseFloat(partEl && partEl.dataset ? partEl.dataset[name] : '');
    const box = {
      x:{min:get('min3dX'), max:get('max3dX'), size:get('size3dX')},
      y:{min:get('min3dY'), max:get('max3dY'), size:get('size3dY')},
      z:{min:get('min3dZ'), max:get('max3dZ'), size:get('size3dZ')}
    };
    if (!Number.isFinite(box.x.size)) box.x.size = box.x.max - box.x.min;
    if (!Number.isFinite(box.y.size)) box.y.size = box.y.max - box.y.min;
    if (!Number.isFinite(box.z.size)) box.z.size = box.z.max - box.z.min;
    return box;
  }
  function overlapLen(aMin, aMax, bMin, bMax){
    return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
  }
  function getBoxDimsSorted(partEl){
    const box = getPart3dBox(partEl);
    const axes = ['x','y','z'];
    const dims = axes.map(a=>({axis:a, size:box[a].size})).filter(d=>Number.isFinite(d.size) && d.size > 0).sort((a,b)=>a.size-b.size);
    return {box, axes, dims, thicknessAxis:dims[0] ? dims[0].axis : '', inPlane:dims.slice(1).map(d=>d.axis)};
  }
  function isHorizontalPlatePart(partEl){
    const o = getBoxDimsSorted(partEl);
    if (o.dims.length < 3) return false;
    const t = o.dims[0].size;
    return o.thicknessAxis === 'z' && t <= Math.max(30, o.dims[1].size * 0.28);
  }
  function isLargeVerticalSupportPanel(partEl){
    // 背板・側板のような「支えるための大きな縦板」は，棚板や張り出し部品のような
    // 曲げ判定対象にしない。
    // v2.25: 背板が全面でなく中段だけに付いている場合でも，横ゆれを抑える
    // ブレース板として扱えるように，十分に横長で薄い縦板を背板候補に含める。
    const o = getBoxDimsSorted(partEl);
    if (o.dims.length < 3) return false;
    if (o.thicknessAxis === 'z') return false; // 水平板は除外しない
    const z = o.box.z.size || 0;
    const horizontalSpan = Math.max(o.box.x.size || 0, o.box.y.size || 0);
    const horizontalThin = Math.min(o.box.x.size || 0, o.box.y.size || 0);
    const t = Math.max(1, o.dims[0].size || 12);
    const thin = o.dims[0].size <= Math.max(30, horizontalSpan * 0.16);
    const broad = horizontalSpan >= 120;
    const veryWideThin = horizontalThin <= Math.max(35, t * 2.4) && horizontalSpan / Math.max(1, horizontalThin) >= 4.0;
    const tallFull = z >= Math.max(120, horizontalSpan * 0.45);
    const bracePanel = z >= Math.max(45, horizontalSpan * 0.30);
    // 全面の背板，または中段に貼った横長の背板は，構造を支える側として扱う。
    return !!(thin && broad && veryWideThin && (tallFull || bracePanel));
  }


  function isBackPanelForSideLoad(partEl){
    // 左右から押すとき，背面・正面に貼る板は横ゆれを抑える「補強板」として扱う。
    // ただし左右の側板（薄さ方向が左右方向の板）は，横から押されたときに
    // 付け根が弱点になる部品なので，背板として除外しない。
    const o = getBoxDimsSorted(partEl);
    if (o.dims.length < 3 || o.thicknessAxis === 'z') return false;
    const box = o.box;
    const z = box.z.size || 0;
    const xSpan = box.x.size || 0;
    const ySpan = box.y.size || 0;
    const t = Math.max(1, o.dims[0].size || memberThicknessMm(partEl) || 12);
    // 「左右から」の力では，左右方向に広がる面材（薄さ方向がおおむね奥行き方向）を
    // 背板・正面板として扱う。薄さ方向が x のものは側板なので除外しない。
    const frontBackPlane = o.thicknessAxis !== 'x' && xSpan >= Math.max(90, ySpan * 1.25);
    const thin = ySpan <= Math.max(32, t * 2.6) || o.thicknessAxis === 'y';
    const wideThin = xSpan / Math.max(1, Math.min(xSpan, ySpan)) >= 3.0;
    const enoughHeight = z >= Math.max(45, xSpan * 0.22);
    const broadBack = xSpan >= 100;
    return !!(frontBackPlane && thin && wideThin && enoughHeight && broadBack);
  }

  function detectSidePanelRootForSideLoad(partEl){
    // v2.42: 左右の側板が背板・正面板の一辺にだけ付いて前後方向へ張り出す場合，
    // 側板の「付け根」が弱点になる。これを背板扱いで除外せず，側板根元リスクとして拾う。
    if (!partEl || isBottomBasePart(partEl) || isHorizontalPlatePart(partEl) || isBackPanelForSideLoad(partEl)) return null;
    const o = getBoxDimsSorted(partEl);
    if (o.dims.length < 3 || o.thicknessAxis === 'z') return null;
    const box = o.box;
    const xSpan = box.x.size || 0;
    const ySpan = box.y.size || 0;
    const z = box.z.size || 0;
    const t = Math.max(1, o.dims[0].size || memberThicknessMm(partEl) || 12);
    const sidePlateShape = xSpan <= Math.max(32, t * 2.8) && ySpan >= Math.max(55, xSpan * 3.0) && z >= Math.max(35, t * 2.5);
    if (!sidePlateShape) return null;
    const svg = document.querySelector('#svg-container svg');
    const panels = svg ? Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).filter(q => q !== partEl && isBackPanelForSideLoad(q)) : [];
    let best = null;
    const tol = Math.max(5, t * 1.2);
    panels.forEach(q => {
      const qb = getPart3dBox(q);
      const zOverlap = overlapLen(box.z.min, box.z.max, qb.z.min, qb.z.max);
      if (zOverlap < Math.max(20, z * 0.35)) return;
      const yAtMin = Math.abs(box.y.min - qb.y.max) <= tol || Math.abs(box.y.min - qb.y.min) <= tol || (qb.y.max >= box.y.min - tol && qb.y.min <= box.y.min + tol);
      const yAtMax = Math.abs(box.y.max - qb.y.min) <= tol || Math.abs(box.y.max - qb.y.max) <= tol || (qb.y.min <= box.y.max + tol && qb.y.max >= box.y.max - tol);
      if (!yAtMin && !yAtMax) return;
      // 側板と背板がL字に接している場合，x方向は重ならず端面同士で接することがある。
      const xOverlap = overlapLen(box.x.min, box.x.max, qb.x.min, qb.x.max);
      const xEdgeTouch = Math.abs(box.x.max - qb.x.min) <= tol || Math.abs(box.x.min - qb.x.max) <= tol || xOverlap > 0;
      if (!xEdgeTouch) return;
      const fixedEnd = yAtMax ? 'max' : 'min';
      const score = zOverlap + ySpan * 0.2;
      if (!best || score > best.score) best = {axis:'y', fixedEnd, spanMm:Math.max(1, ySpan), widthMm:Math.max(1, z), thickness:t, score};
    });
    // 背板候補が未検出でも，薄い左右側板の形なら根元リスクとして弱めに拾う。
    if (!best) best = {axis:'y', fixedEnd:'max', spanMm:Math.max(1, ySpan), widthMm:Math.max(1, z), thickness:t, score:0, inferred:true};
    return best;
  }

  function isSideSwayPanelForSideLoad(partEl){
    // 左右荷重では，天板の曲げではなく，側板・縦板が斜めに倒れる横ゆれを主に見る。
    // 背板候補・底板・水平板は対象外にし，縦長の板を側板候補にする。
    if (!partEl || isBottomBasePart(partEl) || isHorizontalPlatePart(partEl) || isBackPanelForSideLoad(partEl)) return false;
    const o = getBoxDimsSorted(partEl);
    if (o.dims.length < 3 || o.thicknessAxis === 'z') return false;
    const z = o.box.z.size || 0;
    const horizontalSpan = Math.max(o.box.x.size || 0, o.box.y.size || 0);
    const t = Math.max(1, o.dims[0].size || memberThicknessMm(partEl) || 12);
    const thin = t <= Math.max(35, horizontalSpan * 0.35);
    const tall = z >= Math.max(80, horizontalSpan * 0.55);
    const notTiny = horizontalSpan >= 35;
    return !!(thin && tall && notTiny);
  }

  function getSideBraceInfo(){
    // 背面板・正面板・側面補強板など，横ゆれを抑える面材を数える。
    // 1枚だけより，前後や左右に2枚入っている方が，箱形に近くなり横ゆれを抑えやすい。
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return {count:0, distinctPlanes:0, axes:{}, factorSide:1.15, factorTop:1.10, note:'補強板なし'};
    const panels = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).filter(p => isBackPanelForSideLoad(p));
    const axes = {};
    panels.forEach(p => {
      const o = getBoxDimsSorted(p);
      const ax = o.thicknessAxis || 'unknown';
      const box = o.box || getPart3dBox(p);
      const center = ax && box[ax] ? (box[ax].min + box[ax].max) / 2 : 0;
      const t = Math.max(1, (o.dims[0] && o.dims[0].size) || memberThicknessMm(p) || 12);
      if (!axes[ax]) axes[ax] = [];
      axes[ax].push({el:p, center, t});
    });
    let distinctPlanes = 0;
    Object.keys(axes).forEach(ax => {
      const arr = axes[ax].slice().sort((a,b)=>a.center-b.center);
      let groups = [];
      arr.forEach(item => {
        const tol = Math.max(24, item.t * 4.0);
        const last = groups[groups.length-1];
        if (!last || Math.abs(item.center - last.center) > tol) groups.push({center:item.center, n:1});
        else { last.center = (last.center * last.n + item.center) / (last.n + 1); last.n += 1; }
      });
      distinctPlanes += groups.length;
    });
    let factorSide = 1.15;
    let factorTop = 1.10;
    let note = '補強板なし';
    if (panels.length >= 2 && distinctPlanes >= 2) {
      factorSide = 0.22;
      factorTop = 0.38;
      note = '補強板が複数面にあるため，横ゆれをかなり抑える扱い';
    } else if (panels.length >= 2) {
      factorSide = 0.32;
      factorTop = 0.45;
      note = '補強板が複数あるため，横ゆれを強く抑える扱い';
    } else if (panels.length === 1) {
      // 1枚の補強板は横ゆれを抑えるが，箱形構造ほど十分ではない。
      // 授業用には「注意〜かなり注意」側に残りやすくする。
      factorSide = 0.70;
      factorTop = 0.78;
      note = '補強板が1枚あるため，横ゆれは少し抑えますが，まだ注意が必要な扱い';
    }
    return {count:panels.length, distinctPlanes, axes, factorSide, factorTop, note};
  }

  function hasBackPanelForSideLoad(){
    return getSideBraceInfo().count > 0;
  }

  function sideBraceFactorForLoad(forceDirection){
    const info = getSideBraceInfo();
    return normalizeForceDirection(forceDirection) === 'side' ? info.factorSide : info.factorTop;
  }

  function sideBraceNote(){
    return getSideBraceInfo().note;
  }


  function isTopFrameSupportPart(partEl){
    // 上から荷重をかけたときに，天板だけでなく側板・縦板が支える構造を拾う。
    // 背板候補や底板・水平板は除外し，細長い縦板・脚・側板を対象にする。
    if (!partEl || isBottomBasePart(partEl) || isHorizontalPlatePart(partEl) || isBackPanelForSideLoad(partEl)) return false;
    const o = getBoxDimsSorted(partEl);
    if (o.dims.length < 3 || o.thicknessAxis === 'z') return false;
    const z = o.box.z.size || 0;
    const horizontalSpan = Math.max(o.box.x.size || 0, o.box.y.size || 0);
    const t = Math.max(1, o.dims[0].size || memberThicknessMm(partEl) || 12);
    const thin = t <= Math.max(35, horizontalSpan * 0.38);
    const tall = z >= Math.max(70, horizontalSpan * 0.55);
    const notTiny = horizontalSpan >= 30;
    return !!(thin && tall && notTiny);
  }

  function reachesLowerLoadPath(qbox, pbox){
    // 天板の近くにぶら下がる短い側板・飾り板は，下から荷重を支える部材ではない。
    // 作品の最下部付近まで届くか，天板下面から最下部までの高さの大半を連続して受け持つ部材だけを
    // 「支えのある天板」の支持部材として数える。
    const svg = document.querySelector('#svg-container svg');
    if (!svg || !qbox || !pbox) return false;
    const boxes = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).map(getPart3dBox);
    const globalMinZ = boxes.length ? Math.min(...boxes.map(b => Number(b.z && b.z.min) || 0)) : 0;
    const undersideZ = Number(pbox.z && pbox.z.min) || 0;
    const totalDrop = Math.max(1, undersideZ - globalMinZ);
    const supportDrop = Math.max(0, undersideZ - (Number(qbox.z && qbox.z.min) || 0));
    const nearBottom = (Number(qbox.z && qbox.z.min) || 0) <= globalMinZ + Math.max(18, totalDrop * 0.22);
    const reachesMostOfHeight = supportDrop >= totalDrop * 0.68;
    return nearBottom || reachesMostOfHeight;
  }

  function hasVerticalSupportsForHorizontalPlate(partEl){
    // 水平な天板・棚板が，左右または前後の縦板・脚で支えられているかを概算する。
    // 支えが複数ある場合は，単純な梁の曲げだけで赤くなりすぎないように使う。
    // v2.49: 天板が脚・側板の「上に載る」だけでなく，側面の端に接着されている場合も
    // 支えとして数える。従来はXY面の重なりが小さいと支えを見落とし，天板を危険側に
    // 誤判定することがあった。
    if (!partEl || !isHorizontalPlatePart(partEl)) return false;
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return false;
    const pbox = getPart3dBox(partEl);
    const t = Math.max(1, memberThicknessMm(partEl));
    const tol = Math.max(4, t * 1.4);
    const edgeTol = Math.max(6, t * 1.8);
    const candidates = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'))
      .filter(q => q !== partEl && isTopFrameSupportPart(q));
    const supports = [];
    candidates.forEach(q => {
      const qbox = getPart3dBox(q);
      if (!reachesLowerLoadPath(qbox, pbox)) return;
      const zTouch = Math.abs((qbox.z.max || 0) - (pbox.z.min || 0)) <= tol ||
        (qbox.z.max >= pbox.z.min - tol && qbox.z.min <= pbox.z.max + tol);
      if (!zTouch) return;
      const ox = overlapLen(pbox.x.min, pbox.x.max, qbox.x.min, qbox.x.max);
      const oy = overlapLen(pbox.y.min, pbox.y.max, qbox.y.min, qbox.y.max);
      const plateArea = Math.max(1, (pbox.x.size || 1) * (pbox.y.size || 1));
      const overlapArea = ox * oy;
      const nearXMin = qbox.x.max >= pbox.x.min - edgeTol && qbox.x.min <= pbox.x.min + edgeTol;
      const nearXMax = qbox.x.min <= pbox.x.max + edgeTol && qbox.x.max >= pbox.x.max - edgeTol;
      const nearYMin = qbox.y.max >= pbox.y.min - edgeTol && qbox.y.min <= pbox.y.min + edgeTol;
      const nearYMax = qbox.y.min <= pbox.y.max + edgeTol && qbox.y.max >= pbox.y.max - edgeTol;
      const xEdgeSupport = (nearXMin || nearXMax) && oy >= Math.max(12, (pbox.y.size || 1) * 0.08);
      const yEdgeSupport = (nearYMin || nearYMax) && ox >= Math.max(12, (pbox.x.size || 1) * 0.08);
      if (overlapArea < Math.max(18, plateArea * 0.010) && !xEdgeSupport && !yEdgeSupport) return;
      supports.push({
        cx:(qbox.x.min + qbox.x.max) / 2,
        cy:(qbox.y.min + qbox.y.max) / 2,
        ox, oy,
        minX:qbox.x.min, maxX:qbox.x.max, minY:qbox.y.min, maxY:qbox.y.max,
        edgeXMin:nearXMin, edgeXMax:nearXMax, edgeYMin:nearYMin, edgeYMax:nearYMax
      });
    });
    if (supports.length < 2) return false;
    const pcx = (pbox.x.min + pbox.x.max) / 2;
    const pcy = (pbox.y.min + pbox.y.max) / 2;
    const leftRight = supports.some(s => s.cx < pcx - t) && supports.some(s => s.cx > pcx + t);
    const frontBack = supports.some(s => s.cy < pcy - t) && supports.some(s => s.cy > pcy + t);
    const edgeX = supports.some(s => s.edgeXMin || s.minX <= pbox.x.min + edgeTol) && supports.some(s => s.edgeXMax || s.maxX >= pbox.x.max - edgeTol);
    const edgeY = supports.some(s => s.edgeYMin || s.minY <= pbox.y.min + edgeTol) && supports.some(s => s.edgeYMax || s.maxY >= pbox.y.max - edgeTol);
    return leftRight || frontBack || edgeX || edgeY || supports.length >= 3;
  }


  function getTopPlateSupportInfo(partEl){
    // v2.48: 上から荷重をかける天板・棚板について，左右の側板・脚・縦板で
    // 下から支えられている場合や，天板の端面が縦板に接合されている場合は，
    // 片持ちや細い梁としてではなく，「支えのある天板」として評価する。
    if (!partEl || !isHorizontalPlatePart(partEl)) return null;
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return null;
    const pbox = getPart3dBox(partEl);
    const t = Math.max(1, memberThicknessMm(partEl));
    const zTol = Math.max(8, t * 2.2);
    const edgeTol = Math.max(6, t * 1.8);
    const minArea = Math.max(18, (pbox.x.size || 1) * (pbox.y.size || 1) * 0.006);
    const pcx = (pbox.x.min + pbox.x.max) / 2;
    const pcy = (pbox.y.min + pbox.y.max) / 2;
    const supports = [];
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
    parts.forEach(q => {
      if (q === partEl || isBottomBasePart(q) || isHorizontalPlatePart(q)) return;
      const qbox = getPart3dBox(q);
      if (!reachesLowerLoadPath(qbox, pbox)) return;
      const qHeight = qbox.z.size || 0;
      const qLargestHorizontal = Math.max(qbox.x.size || 0, qbox.y.size || 0);
      const qThin = Math.min(qbox.x.size || Infinity, qbox.y.size || Infinity, qbox.z.size || Infinity);
      const verticalLike = qHeight >= Math.max(35, qLargestHorizontal * 0.45) || isTopFrameSupportPart(q) || isLargeVerticalSupportPanel(q);
      if (!verticalLike) return;
      // 支えの上端が天板の下面近くにある，または側板が天板の高さまで入り込んでいる場合を支えとみなす。
      const zSupports = Math.abs((qbox.z.max || 0) - (pbox.z.min || 0)) <= zTol ||
        (qbox.z.max >= pbox.z.min - zTol && qbox.z.min <= pbox.z.max + zTol);
      if (!zSupports) return;
      const ox = overlapLen(pbox.x.min, pbox.x.max, qbox.x.min, qbox.x.max);
      const oy = overlapLen(pbox.y.min, pbox.y.max, qbox.y.min, qbox.y.max);
      const area = ox * oy;
      // 端面接合・側板上端接合も支えとして拾う。
      // XYの重なりだけを見ると，側板が天板の側面に付く構造を見落としやすい。
      const nearXMin = qbox.x.max >= pbox.x.min - edgeTol && qbox.x.min <= pbox.x.min + edgeTol;
      const nearXMax = qbox.x.min <= pbox.x.max + edgeTol && qbox.x.max >= pbox.x.max - edgeTol;
      const nearYMin = qbox.y.max >= pbox.y.min - edgeTol && qbox.y.min <= pbox.y.min + edgeTol;
      const nearYMax = qbox.y.min <= pbox.y.max + edgeTol && qbox.y.max >= pbox.y.max - edgeTol;
      const xEdgeSupport = (nearXMin || nearXMax) && oy >= Math.max(12, (pbox.y.size || 1) * 0.08);
      const yEdgeSupport = (nearYMin || nearYMax) && ox >= Math.max(12, (pbox.x.size || 1) * 0.08);
      if (area < minArea && !xEdgeSupport && !yEdgeSupport) return;
      supports.push({
        el:q,
        cx:(qbox.x.min + qbox.x.max) / 2,
        cy:(qbox.y.min + qbox.y.max) / 2,
        ox, oy, area:Math.max(area, xEdgeSupport || yEdgeSupport ? minArea : 0),
        minX:qbox.x.min, maxX:qbox.x.max, minY:qbox.y.min, maxY:qbox.y.max,
        edgeXMin:nearXMin, edgeXMax:nearXMax, edgeYMin:nearYMin, edgeYMax:nearYMax,
        thin:qThin
      });
    });
    if (supports.length < 2) return null;
    const xSpread = Math.max(...supports.map(s => s.cx)) - Math.min(...supports.map(s => s.cx));
    const ySpread = Math.max(...supports.map(s => s.cy)) - Math.min(...supports.map(s => s.cy));
    const leftRight = supports.some(s => s.cx < pcx - Math.max(8,t)) && supports.some(s => s.cx > pcx + Math.max(8,t));
    const frontBack = supports.some(s => s.cy < pcy - Math.max(8,t)) && supports.some(s => s.cy > pcy + Math.max(8,t));
    const edgeX = supports.some(s => s.edgeXMin || s.minX <= pbox.x.min + Math.max(12,t*2.5)) && supports.some(s => s.edgeXMax || s.maxX >= pbox.x.max - Math.max(12,t*2.5));
    const edgeY = supports.some(s => s.edgeYMin || s.minY <= pbox.y.min + Math.max(12,t*2.5)) && supports.some(s => s.edgeYMax || s.maxY >= pbox.y.max - Math.max(12,t*2.5));
    const supported = leftRight || frontBack || edgeX || edgeY || supports.length >= 3 || Math.max(xSpread, ySpread) >= Math.min(pbox.x.size || 0, pbox.y.size || 0) * 0.45;
    if (!supported) return null;
    const span = Math.max(1, Math.max(18, leftRight || edgeX ? (pbox.x.size || 1) : (frontBack || edgeY ? (pbox.y.size || 1) : Math.min(pbox.x.size || 1, pbox.y.size || 1))));
    const width = Math.max(1, (Math.abs(span - (pbox.x.size || 0)) < 0.1) ? (pbox.y.size || 1) : (pbox.x.size || 1));
    const bearingSupports = supports.filter(s => (s.ox || 0) * (s.oy || 0) >= minArea);
    const edgeOnlySupports = supports.filter(s => ((s.ox || 0) * (s.oy || 0) < minArea) && (s.edgeXMin || s.edgeXMax || s.edgeYMin || s.edgeYMax));
    return {
      supports,
      spanMm:span,
      widthMm:width,
      supported:true,
      bearingSupportCount:bearingSupports.length,
      edgeOnlySupportCount:edgeOnlySupports.length,
      edgeBondedOnly:bearingSupports.length === 0 && edgeOnlySupports.length >= 2
    };
  }


  function detectSmallAttachmentToSupportPanel(partEl){
    // v2.15: 背板・側板から小さな部品が片側だけ出ている構造を拾う。
    // 例：上部にぶら下がる小部品，背板から前に出る短い部品など。
    // 大きな背板・側板そのものは isLargeVerticalSupportPanel で除外済み。
    if (!partEl || isHorizontalPlatePart(partEl) || isLargeVerticalSupportPanel(partEl)) return null;
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return null;
    const pbox = getPart3dBox(partEl);
    const dimsInfo = getBoxDimsSorted(partEl);
    if (dimsInfo.dims.length < 3) return null;
    const thickness = Math.max(1, parseFloat(partEl.dataset.inferredThickness || '0') || dimsInfo.dims[0].size || 12);
    const largest = dimsInfo.dims[2].size || 0;
    const middle = dimsInfo.dims[1].size || 0;
    const smallest = dimsInfo.dims[0].size || 0;
    // あまりに大きい部品は「支える側」の部品として扱い，ここでは拾わない。
    const compact = largest <= 260 && middle <= 180 && smallest <= Math.max(35, thickness * 1.8);
    if (!compact) return null;

    const tol = Math.max(3, thickness * 1.2);
    const axes = ['x','y','z'];
    let best = null;
    const supports = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'))
      .filter(q => q !== partEl && isLargeVerticalSupportPanel(q));

    supports.forEach(q=>{
      const qbox = getPart3dBox(q);
      axes.forEach(axis=>{
        const others = axes.filter(a => a !== axis);
        const ov1 = overlapLen(pbox[others[0]].min, pbox[others[0]].max, qbox[others[0]].min, qbox[others[0]].max);
        const ov2 = overlapLen(pbox[others[1]].min, pbox[others[1]].max, qbox[others[1]].min, qbox[others[1]].max);
        const faceArea = Math.max(1, pbox[others[0]].size * pbox[others[1]].size);
        const areaRatio = (ov1 * ov2) / faceArea;
        if (areaRatio < 0.035) return;

        // 面が接している，またはSTL上で少し重なっている場合も接合として扱う。
        const touches =
          Math.abs(pbox[axis].min - qbox[axis].max) <= tol ||
          Math.abs(pbox[axis].max - qbox[axis].min) <= tol ||
          (qbox[axis].min <= pbox[axis].max + tol && qbox[axis].max >= pbox[axis].min - tol && (qbox[axis].size || 0) <= Math.max(40, (pbox[axis].size || 0) * 2.5));
        if (!touches) return;

        // 接している面と直交する方向のうち，長い方を「出ている／ぶら下がっている長さ」とみなす。
        const spanAxis = others.map(a=>({axis:a, size:pbox[a].size || 0})).sort((a,b)=>b.size-a.size)[0];
        const widthAxis = others.map(a=>({axis:a, size:pbox[a].size || 0})).sort((a,b)=>a.size-b.size)[0];
        const span = Math.max(1, spanAxis ? spanAxis.size : largest);
        const width = Math.max(1, widthAxis ? widthAxis.size : middle);
        const overhangRatio = span / thickness;
        // 小部品でも L/t が小さすぎるものは片持ちとして扱わない。
        if (overhangRatio < 4.0) return;
        const verticalBonus = (spanAxis && spanAxis.axis === 'z') ? 50 : 20;
        const score = areaRatio * 220 + overhangRatio * 10 + span * 0.15 + verticalBonus;
        if (!best || score > best.score) {
          const sAxis = spanAxis ? spanAxis.axis : axis;
          const spanTol = Math.max(tol * 1.6, thickness * 1.6, 6);
          const supportNearMin = qbox[sAxis].max >= pbox[sAxis].min - spanTol && qbox[sAxis].min <= pbox[sAxis].min + spanTol;
          const supportNearMax = qbox[sAxis].min <= pbox[sAxis].max + spanTol && qbox[sAxis].max >= pbox[sAxis].max - spanTol;
          let fixedEnd = 'min';
          if (sAxis === 'z') fixedEnd = 'max';
          else if (supportNearMax && !supportNearMin) fixedEnd = 'max';
          else if (supportNearMin && !supportNearMax) fixedEnd = 'min';
          best = {axis: sAxis, contactAxis: axis, fixedEnd, size: span, width, score, supportArea:areaRatio, overhangRatio};
        }
      });
    });
    return best;
  }

  function detectCompactOneSideAttachment(partEl){
    // v2.16: 上部の小さな受け・突起のように，大きな板へ片側だけで付く部品を検出する。
    // 従来は「大きな縦板」への接触だけを見ていたため，天板・背板・側板に付いた小部品を安全側に見落とすことがあった。
    if (!partEl || isBottomBasePart(partEl) || isLargeVerticalSupportPanel(partEl)) return null;
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return null;
    const pbox = getPart3dBox(partEl);
    const info = getBoxDimsSorted(partEl);
    if (info.dims.length < 3) return null;
    const thickness = Math.max(1, parseFloat(partEl.dataset.inferredThickness || '0') || info.dims[0].size || 12);
    const smallest = info.dims[0].size || 0;
    const middle = info.dims[1].size || 0;
    const largest = info.dims[2].size || 0;
    const pVol = Math.max(1, (pbox.x.size || 0) * (pbox.y.size || 0) * (pbox.z.size || 0));

    // 棚板・底板のような大きな面材はここでは拾わず，通常の両端支持判定に回す。
    // 一方，150×70×15程度の受け材・小部品は拾えるようにする。
    const compact = largest <= 240 && middle <= 190 && smallest <= Math.max(35, thickness * 2.2);
    if (!compact) return null;

    const axes = ['x','y','z'];
    const tol = Math.max(3, thickness * 1.35);
    let best = null;
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).filter(q => q !== partEl);

    parts.forEach(q=>{
      const qbox = getPart3dBox(q);
      const qVol = Math.max(1, (qbox.x.size || 0) * (qbox.y.size || 0) * (qbox.z.size || 0));
      const qLargest = Math.max(qbox.x.size || 0, qbox.y.size || 0, qbox.z.size || 0);
      const largerSupport = qVol >= pVol * 1.8 || qLargest >= largest * 1.35 || isLargeVerticalSupportPanel(q) || isHorizontalPlatePart(q);
      if (!largerSupport) return;

      axes.forEach(axis=>{
        const others = axes.filter(a => a !== axis);
        const ov1 = overlapLen(pbox[others[0]].min, pbox[others[0]].max, qbox[others[0]].min, qbox[others[0]].max);
        const ov2 = overlapLen(pbox[others[1]].min, pbox[others[1]].max, qbox[others[1]].min, qbox[others[1]].max);
        const faceArea = Math.max(1, pbox[others[0]].size * pbox[others[1]].size);
        const areaRatio = (ov1 * ov2) / faceArea;
        if (areaRatio < 0.025) return;

        const touchMin = Math.abs(pbox[axis].min - qbox[axis].max) <= tol;
        const touchMax = Math.abs(pbox[axis].max - qbox[axis].min) <= tol;
        const shallowOverlap = qbox[axis].min <= pbox[axis].max + tol && qbox[axis].max >= pbox[axis].min - tol;
        if (!touchMin && !touchMax && !shallowOverlap) return;

        // 接合面と直交する2方向のうち長い方を，実際に飛び出す／ぶら下がる長さとして使う。
        const spanAxis = others.map(a=>({axis:a, size:pbox[a].size || 0})).sort((a,b)=>b.size-a.size)[0];
        const widthAxis = others.map(a=>({axis:a, size:pbox[a].size || 0})).sort((a,b)=>a.size-b.size)[0];
        const span = Math.max(1, spanAxis ? spanAxis.size : largest);
        const width = Math.max(1, widthAxis ? widthAxis.size : middle);
        const overhangRatio = span / thickness;
        if (overhangRatio < 3.0) return;

        // 接触が部品の一部だけの場合ほど，釘だけ・接着だけでは弱く出るようにする。
        const partialContactBonus = areaRatio < 0.20 ? 45 : 15;
        const verticalBonus = (spanAxis && spanAxis.axis === 'z') ? 55 : 20;
        const score = areaRatio * 260 + overhangRatio * 15 + span * 0.18 + verticalBonus + partialContactBonus;
        if (!best || score > best.score) {
          const sAxis = spanAxis ? spanAxis.axis : axis;
          const spanTol = Math.max(tol * 1.6, thickness * 1.6, 6);
          const supportNearMin = qbox[sAxis].max >= pbox[sAxis].min - spanTol && qbox[sAxis].min <= pbox[sAxis].min + spanTol;
          const supportNearMax = qbox[sAxis].min <= pbox[sAxis].max + spanTol && qbox[sAxis].max >= pbox[sAxis].max - spanTol;
          // 縦に垂れる小部品は，上側が接合部，下側が自由端になりやすい。
          // 接合部ではなく先端側が大きく動くよう，固定側を記録して3Dアニメで使う。
          let fixedEnd = 'min';
          if (sAxis === 'z') fixedEnd = 'max';
          else if (supportNearMax && !supportNearMin) fixedEnd = 'max';
          else if (supportNearMin && !supportNearMax) fixedEnd = 'min';
          best = {axis: sAxis, contactAxis: axis, fixedEnd, size: span, width, score, supportArea:areaRatio, overhangRatio, partialContact: areaRatio < 0.20};
        }
      });
    });
    return best;
  }

  function contactSummaryForPart(partEl){
    const svg = document.querySelector('#svg-container svg');
    const pbox = getPart3dBox(partEl);
    const axes = ['x','y','z'];
    const t = parseFloat(partEl.dataset.inferredThickness || '0') || Math.min(pbox.x.size||Infinity, pbox.y.size||Infinity, pbox.z.size||Infinity) || 12;
    const tol = Math.max(1.5, t * 0.55);
    const contactsByAxis = {};
    axes.forEach(a => contactsByAxis[a] = {min:0, max:0, minArea:0, maxArea:0});
    if (!svg) return {contactsByAxis, tol};
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).filter(q=>q!==partEl);
    parts.forEach(q=>{
      const qbox = getPart3dBox(q);
      axes.forEach(axis=>{
        const others = axes.filter(a=>a!==axis);
        const ov1 = overlapLen(pbox[others[0]].min, pbox[others[0]].max, qbox[others[0]].min, qbox[others[0]].max);
        const ov2 = overlapLen(pbox[others[1]].min, pbox[others[1]].max, qbox[others[1]].min, qbox[others[1]].max);
        const faceArea = Math.max(1, pbox[others[0]].size * pbox[others[1]].size);
        const areaRatio = (ov1 * ov2) / faceArea;
        if (areaRatio < 0.012) return;
        const touchMin = Math.abs(pbox[axis].min - qbox[axis].max) <= tol;
        const touchMax = Math.abs(pbox[axis].max - qbox[axis].min) <= tol;
        const intersects = (qbox[axis].max > pbox[axis].min - tol && qbox[axis].min < pbox[axis].max + tol);
        if (touchMin || (intersects && Math.abs(qbox[axis].max - pbox[axis].min) <= tol*2.5)) {
          contactsByAxis[axis].min += 1;
          contactsByAxis[axis].minArea += areaRatio;
        }
        if (touchMax || (intersects && Math.abs(qbox[axis].min - pbox[axis].max) <= tol*2.5)) {
          contactsByAxis[axis].max += 1;
          contactsByAxis[axis].maxArea += areaRatio;
        }
      });
    });
    return {contactsByAxis, tol};
  }
  function detectHorizontalEndSupports(partEl, axis, tol){
    // 水平棚板では，端面がぴったり接していなくても，左右の側板や縦板が棚板の下・横に
    // 入っているだけで両端支持に近くなる。端部近くにある縦板を支点として数える。
    const svg = document.querySelector('#svg-container svg');
    const pbox = getPart3dBox(partEl);
    const otherAxis = axis === 'x' ? 'y' : 'x';
    const span = pbox[axis].size || 1;
    const depth = pbox[otherAxis].size || 1;
    const edgeZone = Math.max(tol * 3, span * 0.18);
    const zTol = Math.max(tol * 1.8, 5);
    const out = {min:false, max:false, minScore:0, maxScore:0};
    if (!svg) return out;
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]')).filter(q=>q!==partEl);
    parts.forEach(q=>{
      const qbox = getPart3dBox(q);
      const qDims = getBoxDimsSorted(q);
      // 縦方向に高さがある部品を支え候補にする。薄い背板・側板も支え候補。
      const verticalEnough = (qbox.z.size || 0) >= Math.max(20, (pbox.z.size || 1) * 2.0);
      if (!verticalEnough) return;
      const ovPerp = overlapLen(pbox[otherAxis].min, pbox[otherAxis].max, qbox[otherAxis].min, qbox[otherAxis].max);
      const perpRatio = ovPerp / Math.max(1, depth);
      if (perpRatio < 0.08) return;
      const zTouchesOrIntersects = (
        Math.abs(qbox.z.max - pbox.z.min) <= zTol ||
        (qbox.z.min <= pbox.z.max + zTol && qbox.z.max >= pbox.z.min - zTol)
      );
      if (!zTouchesOrIntersects) return;
      const nearMin = qbox[axis].max >= pbox[axis].min - tol && qbox[axis].min <= pbox[axis].min + edgeZone;
      const nearMax = qbox[axis].min <= pbox[axis].max + tol && qbox[axis].max >= pbox[axis].max - edgeZone;
      const score = perpRatio + Math.min(1, (qbox.z.size || 0) / Math.max(1, pbox.z.size || 1)) * 0.12;
      if (nearMin) { out.min = true; out.minScore = Math.max(out.minScore, score); }
      if (nearMax) { out.max = true; out.maxScore = Math.max(out.maxScore, score); }
    });
    return out;
  }

  function detectBroadOneEdgeHorizontalCantilever(partEl, contactsByAxis, tol){
    // v2.40: 幅の広い水平棚板が，背板・側板などの一辺だけで支えられて
    // 前方・側方へ大きく張り出している場合を「片持ち棚板」として先に拾う。
    // 従来は左右端の縦板を見つけると両端支持と判断してしまい，
    // 壁付け棚のような構造を安全側に見落とすことがあった。
    if (!partEl || !isHorizontalPlatePart(partEl)) return null;
    const pbox = getPart3dBox(partEl);
    const t = Math.max(1, memberThicknessMm(partEl));
    let best = null;
    ['x','y'].forEach(axis => {
      const c = contactsByAxis && contactsByAxis[axis];
      if (!c) return;
      const span = pbox[axis].size || 0;
      const widthAxis = axis === 'x' ? 'y' : 'x';
      const width = Math.max(1, pbox[widthAxis].size || 1);
      if (span < Math.max(55, t * 3.8)) return;
      const end = detectHorizontalEndSupports(partEl, axis, tol || Math.max(3, t * 1.1));
      const minSupport = (c.minArea >= 0.020) || end.min;
      const maxSupport = (c.maxArea >= 0.020) || end.max;
      // その軸の片側だけに支えがあり，反対側に支えがない場合に限定する。
      if (minSupport === maxSupport) return;
      const oneSideArea = Math.max(c.minArea || 0, c.maxArea || 0, end.minScore || 0, end.maxScore || 0);
      const otherSideArea = Math.min(c.minArea || 0, c.maxArea || 0);
      const overhangRatio = span / t;
      const broadShelf = width >= Math.max(45, t * 3.0);
      const largeEnoughContact = oneSideArea >= 0.020;
      if (!broadShelf || !largeEnoughContact || otherSideArea >= 0.030 || overhangRatio < 3.4) return;
      const fixedEnd = maxSupport ? 'max' : 'min';
      const score = oneSideArea * 260 + overhangRatio * 10 + span * 0.10 + width * 0.05;
      if (!best || score > best.score) {
        best = { axis, fixedEnd, size: span, width, supportArea: oneSideArea, overhangRatio, score };
      }
    });
    return best;
  }
  function inferSupportFromGeometry(partEl){
    const svg = document.querySelector('#svg-container svg');
    const fallback = { key:'simple_center', label:'両端で支える・真ん中に本を置く', auto:false, note:'手動設定または標準設定', spanMm:NaN, widthMm:NaN, supportFactor:1 };
    if (!svg || !partEl) return fallback;
    const info = getBoxDimsSorted(partEl);
    const pbox = info.box;
    const axes = info.axes;
    const dims = info.dims;
    if (dims.length < 2) return fallback;
    const inPlane = info.inPlane;
    const {contactsByAxis, tol} = contactSummaryForPart(partEl);

    // 大きな背板・側板は「支える部品」であり，張り出し部品として片持ち判定しない。
    if (isLargeVerticalSupportPanel(partEl)) {
      return {
        key:'simple_center',
        label:'支えるための縦板として扱う',
        auto:true,
        note:'大きな縦板なので，棚板を支える部品として扱い，片持ちはり判定から外します。',
        spanMm:Math.max(1, Math.max(pbox.x.size || 0, pbox.y.size || 0)),
        widthMm:Math.max(1, pbox.z.size || 1),
        supportFactor:0.55,
        supportPanel:true
      };
    }

    const compactAttachment = detectCompactOneSideAttachment(partEl);
    if (compactAttachment) {
      return {
        key:'cantilever',
        label:'STL形状から片側だけ固定と判定',
        auto:true,
        note:'大きな板に小部品が片側だけで付いています。釘だけの場合は特に，付け根に力が集まりやすいため，片持ちはりとして扱います。',
        spanMm:Math.max(1, compactAttachment.size),
        widthMm:Math.max(1, compactAttachment.width),
        supportFactor: compactAttachment.partialContact ? 4.20 : 3.60,
        cantileverLike:true,
        contactAreaRatio:compactAttachment.supportArea,
        deformAxis:compactAttachment.axis,
        fixedEnd:compactAttachment.fixedEnd || (compactAttachment.axis === 'z' ? 'max' : 'min'),
        attachmentLike:true,
        compactAttachment:true
      };
    }

    const supportPanelAttachment = detectSmallAttachmentToSupportPanel(partEl);
    if (supportPanelAttachment) {
      return {
        key:'cantilever',
        label:'STL形状から片側だけ固定と判定',
        auto:true,
        note:'背板や側板などの大きな支え部品に片側だけで付いている小部品です。付け根に力が集まりやすいため，片持ちはりとして扱います。',
        spanMm:Math.max(1, supportPanelAttachment.size),
        widthMm:Math.max(1, supportPanelAttachment.width),
        supportFactor:3.25,
        cantileverLike:true,
        contactAreaRatio:supportPanelAttachment.supportArea,
        deformAxis:supportPanelAttachment.axis,
        fixedEnd:supportPanelAttachment.fixedEnd || (supportPanelAttachment.axis === 'z' ? 'max' : 'min'),
        attachmentLike:true
      };
    }

    // v2.40: 壁や背板の一辺だけで支えられる広い水平棚板は，
    // 左右端に縦板が見えても「両端支持」より先に片持ちとして扱う。
    if (isHorizontalPlatePart(partEl)) {
      const broadCant = detectBroadOneEdgeHorizontalCantilever(partEl, contactsByAxis, tol);
      if (broadCant) {
        return {
          key:'cantilever',
          label:'STL形状から片持ち棚板と判定',
          auto:true,
          note:'水平棚板が一辺だけで支えられ，反対側へ張り出しているため，片持ち棚板として扱います。上からの力や横からの力で付け根の接合部に負担が集まりやすい構造です。',
          spanMm:Math.max(1,broadCant.size),
          widthMm:Math.max(1,broadCant.width),
          supportFactor:4.60,
          cantileverLike:true,
          freeEndLoad:true,
          fixedEndJointFactor:1.70,
          contactAreaRatio:broadCant.supportArea,
          deformAxis:broadCant.axis,
          fixedEnd:broadCant.fixedEnd || 'min',
          attachmentLike:true,
          broadShelfCantilever:true
        };
      }
    }

    // 水平棚板は，左右または前後に支えがあるかを最優先で見る。
    // 端面接触だけでなく，端部近くの縦板・側板も両端支持として数える。
    if (isHorizontalPlatePart(partEl)) {
      let bestSimple = null;
      ['x','y'].forEach(axis=>{
        const c = contactsByAxis[axis];
        const end = detectHorizontalEndSupports(partEl, axis, tol);
        const minSupport = (c.minArea >= 0.018) || end.min;
        const maxSupport = (c.maxArea >= 0.018) || end.max;
        const size = pbox[axis].size || 0;
        const widthAxis = axis === 'x' ? 'y' : 'x';
        const width = pbox[widthAxis].size || 1;
        if (minSupport && maxSupport) {
          const score = size + (c.minArea + c.maxArea + end.minScore + end.maxScore) * 160;
          if (!bestSimple || score > bestSimple.score) bestSimple = {axis, size, width, score};
        }
      });
      if (bestSimple) {
        return {
          key:'simple_center',
          label:'STL形状から両端で支えると判定',
          auto:true,
          note:'棚板の両側に側板や支えになる部品があるため，両端で支えられている棚板として扱います。',
          spanMm:Math.max(1,bestSimple.size),
          widthMm:Math.max(1,bestSimple.width),
          supportFactor:1,
          contactAreaRatio:1
        };
      }
    }

    // 両端支持が見つからない場合だけ片持ち候補を見る。
    // 背板・側板のような大きな縦板は上で除外済み。
    // v2.14: 上部の小さな張り出し部品は，水平に突き出すだけでなく，
    //        上面だけで支えられて下に垂れる「縦向きの片持ち部品」になることがある。
    //        そのため，水平板ではない小部品に限り z 方向も片持ち候補に入れる。
    let bestCant = null;
    const candidateAxes = Array.from(new Set([...(inPlane || []), 'x', 'y', 'z']))
      .filter(axis => axes.includes(axis));
    candidateAxes.forEach(axis=>{
      // 水平棚板は z 方向を片持ちスパンにしない。
      // 一方，細い縦向き部品は z 方向に片側固定で垂れている場合があるため候補にする。
      if (axis === 'z' && isHorizontalPlatePart(partEl)) return;
      const c = contactsByAxis[axis];
      if (!c) return;
      const size = pbox[axis].size;
      if (!Number.isFinite(size) || size <= 0) return;
      const otherAxes = axes.filter(a => a !== axis);
      const widthAxis = otherAxes
        .map(a => ({axis:a, size:pbox[a].size || 0}))
        .sort((a,b)=>b.size-a.size)[0]?.axis || otherAxes[0];
      const width = Math.max(1, pbox[widthAxis].size || Math.max(parseFloat(partEl.dataset.partW||'0')||1, parseFloat(partEl.dataset.partH||'0')||1));
      const oneSideArea = Math.max(c.minArea, c.maxArea);
      const otherSideArea = Math.min(c.minArea, c.maxArea);
      const oneSideSupported = oneSideArea >= 0.014 && otherSideArea < 0.018;
      const thickness = Math.max(1, parseFloat(partEl.dataset.inferredThickness || '0') || dims[0]?.size || 12);
      const overhangRatio = size / thickness;
      const slender = size / Math.max(1, width);

      // z方向に垂れる小部品は，幅に対して必ずしも細長く見えないことがあるので，
      // L/t が十分大きく，片側だけが接していれば片持ち候補として扱う。
      const verticalBracket = axis === 'z' && overhangRatio >= 4.0 && size <= Math.max(220, thickness * 18);
      const horizontalBracket = axis !== 'z' && slender >= 1.05;
      // v2.39: 幅の広い棚板が背板・側板の片側の面だけに付く場合も片持ちとして扱う。
      // 従来は「細長い部品」だけを片持ち候補にしていたため，幅300mm×奥行140mmのような
      // 広い棚板が背板から張り出す構造を安全側に見落とすことがあった。
      // 両端支持が見つからず，一辺だけで大きく接している水平板なら，幅が広くても片持ち棚板として判定する。
      const broadHorizontalShelfCantilever = axis !== 'z' && isHorizontalPlatePart(partEl) &&
        size >= Math.max(45, thickness * 4.0) &&
        oneSideArea >= 0.045 && otherSideArea < 0.018;

      if (oneSideSupported && overhangRatio >= 3.6 && (horizontalBracket || verticalBracket || broadHorizontalShelfCantilever)) {
        const verticalBonus = axis === 'z' ? 45 : 0;
        const score = oneSideArea * 180 + overhangRatio * 7 + size * 0.12 + verticalBonus;
        let fixedEnd = 'min';
        if (axis === 'z') fixedEnd = (c.maxArea > c.minArea) ? 'max' : 'min';
        else fixedEnd = (c.maxArea > c.minArea) ? 'max' : 'min';
        if (!bestCant || score > bestCant.score) bestCant = {axis, fixedEnd, size, width, score, supportArea:oneSideArea, overhangRatio};
      }
    });
    if (bestCant) {
      return {
        key:'cantilever',
        label:'STL形状から片側だけ固定と判定',
        auto:true,
        note:'片側だけが他の部品に接していて，反対側が張り出しているため，片持ちはりとして扱います。',
        spanMm:Math.max(1,bestCant.size),
        widthMm:Math.max(1,bestCant.width),
        supportFactor:2.35,
        cantileverLike:true,
        contactAreaRatio:bestCant.supportArea,
        deformAxis:bestCant.axis,
        fixedEnd:bestCant.fixedEnd || (bestCant.axis === 'z' ? 'max' : 'min')
      };
    }
    return fallback;
  }
  function resolveSupportForPart(partEl){
    const support = currentSupport();
    if (support.key === 'auto') return inferSupportFromGeometry(partEl);
    return { ...support, auto:false, note:'手動で選んだ支え方です。', spanMm:NaN, widthMm:NaN, supportFactor:1 };
  }

  // 小規模な連立一次方程式をガウス消去で解く。
  // 梁要素FEMは部品ごとに数十自由度なので，ブラウザ上でも十分に軽い。
  function solveLinearSystem(A, b){
    const n = b.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      if (Math.abs(M[pivot][col]) < 1e-12) continue;
      if (pivot !== col) { const tmp = M[col]; M[col] = M[pivot]; M[pivot] = tmp; }
      const div = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= div;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        if (Math.abs(factor) < 1e-14) continue;
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map(row => Number.isFinite(row[n]) ? row[n] : 0);
  }

  function addBeamElement(K, Fv, e, le, EI, eqLoads){
    const k = EI / Math.pow(le, 3);
    const ke = [
      [ 12*k,    6*le*k, -12*k,    6*le*k],
      [6*le*k, 4*le*le*k, -6*le*k, 2*le*le*k],
      [-12*k,   -6*le*k,  12*k,   -6*le*k],
      [6*le*k, 2*le*le*k, -6*le*k, 4*le*le*k]
    ];
    const ids = [2*e, 2*e+1, 2*(e+1), 2*(e+1)+1];
    for (let i=0; i<4; i++) {
      for (let j=0; j<4; j++) K[ids[i]][ids[j]] += ke[i][j];
      if (eqLoads) Fv[ids[i]] += eqLoads[i];
    }
    return {ke, ids, eqLoads:eqLoads || [0,0,0,0]};
  }

  // 1次元Euler-Bernoulli梁要素による簡易FEM。
  // 自由度は各節点のたわみ v と回転角 theta。下向きを正として扱う。
  function runBeamFem(L, E, I, Fload, supportKey, elements){
    const nEl = Math.max(4, Math.min(40, elements || 16));
    const nNode = nEl + 1;
    const dof = nNode * 2;
    const le = L / nEl;
    const EI = E * I;
    const K = Array.from({length:dof}, () => Array(dof).fill(0));
    const Fv = Array(dof).fill(0);
    const elems = [];

    for (let e=0; e<nEl; e++) {
      let eq = [0,0,0,0];
      if (supportKey === 'simple_uniform') {
        const q = Fload / L; // N/mm，全体に等分布
        eq = [q*le/2, q*le*le/12, q*le/2, -q*le*le/12];
      }
      elems.push(addBeamElement(K, Fv, e, le, EI, eq));
    }

    if (supportKey === 'cantilever') {
      Fv[2*nEl] += Fload; // 自由端に集中荷重
    } else if (supportKey === 'simple_center') {
      const mid = Math.round(nEl / 2); // nElは偶数推奨。中央節点に集中荷重
      Fv[2*mid] += Fload;
    }

    const fixed = (supportKey === 'cantilever') ? [0, 1] : [0, 2*nEl];
    const fixedSet = new Set(fixed);
    const free = [];
    for (let i=0; i<dof; i++) if (!fixedSet.has(i)) free.push(i);
    const Kr = free.map(i => free.map(j => K[i][j]));
    const Fr = free.map(i => Fv[i]);
    const ur = solveLinearSystem(Kr, Fr);
    const u = Array(dof).fill(0);
    free.forEach((idx, i) => { u[idx] = ur[i] || 0; });

    const v = [];
    for (let i=0; i<nNode; i++) v.push(u[2*i]);
    let maxMoment = 0;
    elems.forEach(el => {
      const ue = el.ids.map(id => u[id] || 0);
      const internal = [0,0,0,0];
      for (let i=0; i<4; i++) {
        for (let j=0; j<4; j++) internal[i] += el.ke[i][j] * ue[j];
        internal[i] -= el.eqLoads[i];
      }
      maxMoment = Math.max(maxMoment, Math.abs(internal[1]), Math.abs(internal[3]));
    });

    const maxDeflection = Math.max(...v.map(x => Math.abs(x)));
    const maxV = Math.max(0.000001, maxDeflection);
    const shape = v.map((vv, i) => ({x:i/nEl, v:vv, norm:Math.abs(vv)/maxV}));
    return { maxDeflection, maxMoment, nodes: shape, elements:nEl };
  }

  function isBottomBasePart(partEl){
    // 底板は床や机に直接置かれる部品で，棚板のように曲がりを判定する対象から外す。
    // STLのZ方向を高さとみなし，最も低い位置にあり，かつ板状で水平に広い部品を底板候補にする。
    const svg = document.querySelector('#svg-container svg');
    if (!svg || !partEl) return false;
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
    const boxes = parts.map(p => ({el:p, box:getPart3dBox(p)}));
    const valid = boxes.filter(o => Number.isFinite(o.box.z.min) && Number.isFinite(o.box.z.size));
    if (!valid.length) return false;
    const globalMinZ = Math.min(...valid.map(o => o.box.z.min));
    const pbox = getPart3dBox(partEl);
    const t = Math.max(1, parseFloat(partEl.dataset.inferredThickness || '') || Math.min(pbox.x.size||Infinity, pbox.y.size||Infinity, pbox.z.size||Infinity) || 12);
    const tol = Math.max(1.5, t * 0.45);
    const nearBottom = Math.abs(pbox.z.min - globalMinZ) <= tol;
    const dims = [pbox.x.size, pbox.y.size, pbox.z.size].filter(v => Number.isFinite(v) && v > 0).sort((a,b)=>a-b);
    if (dims.length < 3) return false;
    const plateLike = dims[0] <= Math.max(25, dims[1] * 0.22);
    const horizontalWide = pbox.z.size <= Math.max(t * 1.8, dims[0] * 1.8);
    const largeArea = (pbox.x.size * pbox.y.size) >= Math.max(2500, dims[1] * dims[2] * 0.35);

    // v2.43: 床・机に接している最下段の水平板は，構造上は床で支えられるため，
    // 強度評価の対象から外す。片持ち状に見えても，床についている底板は評価対象にしない。
    // その代わり，左右荷重時は左右の側板の付け根・接合部を評価対象に残す。
    return !!(nearBottom && plateLike && horizontalWide && largeArea);
  }

  function calculateRiskForPart(partEl, loadKg, material, forceDirection = 'top'){
    // 強度計算で使う長さ・幅。
    // 木取りSVG由来の partW/partH は，3Dの板厚方向が混ざって「134×15」のように
    // 実際の天板幅を小さく見積もることがある。STLの3D外形が取れる場合，水平板は
    // x-y平面の実寸（例：134×124×15）を優先して使う。
    let w = parseFloat(partEl.dataset.partW || '0') || 0;
    let h = parseFloat(partEl.dataset.partH || '0') || 0;
    try {
      const b3 = getPart3dBox(partEl);
      const sx = Math.max(0, b3?.x?.size || 0);
      const sy = Math.max(0, b3?.y?.size || 0);
      const sz = Math.max(0, b3?.z?.size || 0);
      const tGuess = Math.max(1, memberThicknessMm(partEl) || 12);
      const horizontalByBox = sz <= Math.max(32, tGuess * 2.2) && sx >= Math.max(25, tGuess * 2.0) && sy >= Math.max(25, tGuess * 2.0);
      if (horizontalByBox) {
        w = Math.max(sx, sy);
        h = Math.max(1, Math.min(sx, sy));
      }
    } catch(e) {}
    const longMm = Math.max(w, h);       // 梁のスパン L とみなす
    const shortMm = Math.max(1, Math.min(w, h)); // 棚板の奥行き・幅 b とみなす
    const thicknessMm = memberThicknessMm(partEl); // STL 3D外形から推定。必要に応じて手入力値で上書き。
    const support = resolveSupportForPart(partEl);
    const F = Math.max(0, loadKg) * 9.80665;     // N
    const L = Math.max(1, Number.isFinite(support.spanMm) && support.spanMm > 0 ? support.spanMm : longMm);
    const b = Math.max(1, Number.isFinite(support.widthMm) && support.widthMm > 0 ? support.widthMm : shortMm);
    const t = Math.max(1, thicknessMm);
    const effectiveMaterial = effectiveMaterialForPart(partEl, material);
    const E = effectiveMaterial.E;               // N/mm2
    const dir = normalizeForceDirection(forceDirection);
    const compositeTopInfo=dir==='top'?getCompositeTopCantileverInfo(partEl):null;
    if(compositeTopInfo&&loadKg>0){
      return calculateCompositeTopCantileverRisk(partEl,loadKg,material,compositeTopInfo);
    }

    // v2.52: 水平棚板がなく，上部の短い側板2枚で本を受ける形を評価する。
    // 各側板は背板との付け根で固定された片持ち梁とみなし，下向き曲げと接合部の回転・はがれを計算する。
    const topSideInfo = dir === 'top' ? getTopCantileverSidePlateInfo(partEl) : null;
    if (topSideInfo) {
      const joint=currentJointMethod();
      const allow=effectiveMaterial.allow;
      const L=Math.max(1,topSideInfo.spanMm||longMm);
      const depth=Math.max(1,topSideInfo.sectionDepthMm||shortMm);
      const width=Math.max(1,topSideInfo.sectionWidthMm||t);
      const I=width*Math.pow(depth,3)/12;
      const Mmax=F*L; // 自由端付近に本を置く安全側の近似
      const stress=(Mmax*(depth/2))/Math.max(1e-6,I);
      const delta=F*Math.pow(L,3)/(3*Math.max(1,E)*Math.max(1e-6,I));
      const deflectionLimit=Math.max(0.5,L/150);
      const memberRaw=Math.max(stress/Math.max(0.1,allow),delta/deflectionLimit)*1.15;
      // 5kgを左右2枚で受ける（1枚2.5kg）条件を基準に，接着面のはがれ・回転を安全側に評価。
      const perPlateBaseKg=2.5;
      const loadRatio=Math.max(0,loadKg/perPlateBaseKg);
      const overhangRatio=L/Math.max(1,depth);
      const jointBase=joint.key==='glue' ? 0.78 : (joint.key==='nails' ? 0.88 : 0.48);
      const jointRaw=loadRatio*jointBase*(1+Math.max(0,overhangRatio-1)*0.18);
      const raw=Math.max(memberRaw,jointRaw);
      const risk=Math.max(0,raw/1.25);
      const nodes=Array.from({length:Math.max(5,femElementCount()+1)},(_,i)=>{
        const x=i/Math.max(1,femElementCount());
        const norm=Math.pow(x,2)*(3-2*x);
        return {x,v:norm,norm};
      });
      return {
        risk,raw,memberRaw,jointRaw,
        cantileverLike:true,attachmentLike:true,compactAttachment:false,overhangRatio,
        memberRisk:Math.max(0,memberRaw/1.25),jointRisk:Math.max(0,jointRaw/1.25),
        jointMethodKey:joint.key,jointMethodLabel:joint.label,jointMethodNote:joint.note,jointMethodFactor:joint.factor,
        jointDirectionFactor:1.7,supportAuto:true,
        supportNote:'上部の短い側板が背板から前へ張り出しているため，下向き荷重を受ける片持ち部材として見ています。板の曲げと，背板との付け根のはがれ・回転のうち厳しい方を判定します。',
        supportKey:'top_cantilever_side_plate',supportFactor:2.2,freeEndLoad:true,fixedEndJointFactor:1.7,
        deformAxis:topSideInfo.longAxis||'y',fixedEnd:topSideInfo.fixedEnd||'max',deflectionScore:delta,
        longMm:L,shortMm:depth,slenderness:L/Math.max(1,depth),grainFactor:effectiveMaterial.grainFactor,
        grainMisaligned:effectiveMaterial.grainMisaligned,contactPenalty:1.25,sideFactor:1,
        forceDirection:dir,forceDirectionLabel:FORCE_DIRECTIONS[dir].label,thicknessMm:width,
        supportLabel:'上からの力：上部側板を片持ち部材として判定',loadN:F,I,momentNmm:Mmax,
        stressMpa:stress,allowMpa:allow,safetyFactor:allow/Math.max(0.001,stress),
        deflectionMm:delta,deflectionLimitMm:deflectionLimit,femNodes:nodes,femElements:femElementCount(),
        failureMode:'上部側板の曲げ・付け根の接合部'
      };
    }


    // v2.51: 上からの荷重では，先に左右の側板・脚から床・底板へ続く支持経路を確認する。
    // 形状の一部が張り出して片持ち候補になっていても，天板全体を下から支える経路が
    // 2か所以上確認できる場合は，片持ち補正を解除して『支えのある天板』として評価する。
    // v2.47: 上からの荷重で，天板が左右の側板・脚・縦板に載っている場合は，
    // 片持ち判定よりも「支えのある天板」として優先評価する。
    // 5kg程度の荷重で 134×124×15mm 程度の天板が限界超えになる誤判定を防ぐ。
    if (dir === 'top' && isHorizontalPlatePart(partEl)) {
      const topSupport = getTopPlateSupportInfo(partEl);
      if (topSupport && topSupport.supported) {
        const joint = currentJointMethod();
        const allow = effectiveMaterial.allow;
        const Ltop = Math.max(1, Math.min(topSupport.spanMm || longMm, longMm));
        const btop = Math.max(1, topSupport.widthMm || shortMm);
        const Itop = btop * Math.pow(t, 3) / 12;
        const femTop = runBeamFem(Ltop, E, Itop, F, 'simple_uniform', femElementCount());
        const MmaxTop = femTop.maxMoment;
        const deltaTop = femTop.maxDeflection;
        const stressTop = (MmaxTop * (t / 2)) / Math.max(1e-6, Itop);
        const stressRiskTop = stressTop / allow;
        const deflectionLimitTop = Ltop / 200;
        const deflectionRiskTop = deltaTop / Math.max(0.1, deflectionLimitTop);
        const loadRatio = Math.max(0, F / 49.0);
        // v2.50: 下から面で受けている天板と，側面だけを接着している天板を分けて評価する。
        // 側面接着だけの構造は，板の曲げが小さくても接着面のはがれ・回転が先に問題になりやすい。
        const edgeBondedOnly = !!topSupport.edgeBondedOnly;
        let jointBase;
        if (edgeBondedOnly) {
          jointBase = joint.key === 'nails' ? 0.42 : (joint.key === 'glue' ? 0.52 : 0.28);
        } else {
          jointBase = joint.key === 'nails' ? 0.18 : (joint.key === 'glue' ? 0.15 : 0.09);
        }
        const plateArea = Math.max(1, btop * Ltop);
        const contactArea = (topSupport.supports || []).reduce((sum, s) => sum + Math.max(0, s.area || 0), 0);
        const contactRatio = Math.min(1, contactArea / plateArea);
        const contactPenalty = contactPenaltyFromRatio(contactRatio);
        const edgeBondPenalty = edgeBondedOnly ? 1.35 : 1.0;
        const jointRaw = loadRatio * jointBase * contactPenalty * edgeBondPenalty;
        const memberRaw = Math.max(stressRiskTop, deflectionRiskTop);
        const raw = Math.max(memberRaw, jointRaw);
        const risk = Math.max(0, raw / 1.25);
        return {
          risk, raw, memberRaw, jointRaw,
          cantileverLike:false, attachmentLike:false, compactAttachment:false, overhangRatio:Ltop / Math.max(1, t),
          memberRisk:Math.max(0, memberRaw / 1.25),
          jointRisk:Math.max(0, jointRaw / 1.25),
          jointMethodKey:joint.key, jointMethodLabel:joint.label, jointMethodNote:joint.note, jointMethodFactor:joint.factor,
          jointDirectionFactor:1.0, supportAuto:true,
          supportNote:edgeBondedOnly
            ? '上からの力では，この天板は複数の縦板に接していますが，下から面で受けるのではなく側面接着が中心です。板の曲げに加え，接着面のはがれ・回転を厳しめに見ています。'
            : '上からの力では，この天板は左右の側板・脚・縦板に支えられているため，片持ちではなく支えのある天板として見ています。',
          supportKey:edgeBondedOnly ? 'top_edge_bonded_plate' : 'top_supported_plate', supportFactor:edgeBondedOnly ? 1.35 : 1, deformAxis:'z', fixedEnd:'min',
          deflectionScore:deltaTop, longMm:Ltop, shortMm:btop, slenderness:Ltop / Math.max(1, btop),
          grainFactor:effectiveMaterial.grainFactor, grainMisaligned:effectiveMaterial.grainMisaligned, contactPenalty, sideFactor:1, forceDirection:dir, forceDirectionLabel:FORCE_DIRECTIONS[dir].label,
          thicknessMm, supportLabel:'上からの力：側板・脚で支えられた天板として判定', loadN:F,
          I:Itop, momentNmm:MmaxTop, stressMpa:stressTop, allowMpa:allow,
          safetyFactor:allow / Math.max(0.001, stressTop), deflectionMm:deltaTop, deflectionLimitMm:deflectionLimitTop,
          femNodes:femTop.nodes, femElements:femTop.elements
        };
      }
    }

    // v2.45: 左右から押す荷重では，水平な天板・棚板そのものの曲げを主な破損対象にしない。
    // 天板が片持ち形状として誤検出されても，側面荷重時は側板の付け根・接合部を優先して評価する。
    // ここで水平板は「フレームをつなぐ板」として低めに扱い，赤表示になりすぎる誤判定を抑える。
    if (dir === 'side' && isHorizontalPlatePart(partEl)) {
      const joint = currentJointMethod();
      const allow = effectiveMaterial.allow;
      const loadRatio = Math.max(0, F / 49.0);
      const braceFactor = sideBraceFactorForLoad('side');
      const supportedFactor = hasVerticalSupportsForHorizontalPlate(partEl) ? 0.50 : 0.75;
      const jointFactor = joint.key === 'nails' ? 1.15 : (joint.key === 'glue' ? 0.95 : 0.70);
      const memberRaw = loadRatio * 0.08 * braceFactor * supportedFactor;
      const jointRaw = loadRatio * 0.11 * braceFactor * supportedFactor * jointFactor;
      const raw = Math.max(memberRaw, jointRaw);
      const risk = Math.max(0, raw / 1.30);
      const stressMpa = Math.max(0.01, raw * allow * 0.28);
      const delta = Math.max(0, loadRatio * Math.max(1, L) * 0.00055 * braceFactor * supportedFactor);
      const deflectionLimit = L / 200;
      const nodes = Array.from({length: Math.max(5, femElementCount() + 1)}, (_, i) => {
        const x = i / Math.max(1, femElementCount());
        return {x, v:Math.sin(Math.PI*x) * 0.18, norm:Math.sin(Math.PI*x) * 0.18};
      });
      return {
        risk, raw, memberRaw, jointRaw,
        cantileverLike:false, attachmentLike:false, compactAttachment:false, overhangRatio:L / Math.max(1, t),
        memberRisk:Math.max(0, memberRaw / 1.25),
        jointRisk:Math.max(0, jointRaw / 1.25),
        jointMethodKey:joint.key, jointMethodLabel:joint.label, jointMethodNote:joint.note, jointMethodFactor:joint.factor,
        jointDirectionFactor:1.0, supportAuto:!!support.auto,
        supportNote:'左右からの力では，天板・棚板そのものの曲げではなく，左右の側板の付け根・接合部を中心に見ています。この水平板は主な危険対象から外して低めに判定します。 ' + sideBraceNote(),
        supportKey:'side_horizontal_tie', supportFactor:1, deformAxis:'z', fixedEnd:'min',
        deflectionScore:delta, longMm:L, shortMm:b, slenderness:L / Math.max(1, b),
        grainFactor:1, sideFactor:1, forceDirection:dir, forceDirectionLabel:FORCE_DIRECTIONS[dir].label,
        thicknessMm, supportLabel:'左右の力：天板・棚板は主対象外', loadN:F,
        I:(t * Math.pow(Math.max(1,b),3) / 12), momentNmm:raw * 1000, stressMpa, allowMpa:allow,
        safetyFactor:allow / Math.max(0.001, stressMpa), deflectionMm:delta, deflectionLimitMm:deflectionLimit,
        femNodes:nodes, femElements:femElementCount()
      };
    }


    // 上からの荷重を支える側板・脚は，総荷重を支えの本数・断面に応じて分けたうえで，
    // 圧縮と座屈を簡易評価する。新しい入力項目は増やさず，STL寸法から自動計算する。
    if (dir === 'top' && isTopFrameSupportPart(partEl)) {
      const box = getPart3dBox(partEl);
      const height = Math.max(1, box.z.size || longMm);
      const sx = Math.max(1, box.x.size || thicknessMm);
      const sy = Math.max(1, box.y.size || thicknessMm);
      const area = Math.max(1, sx * sy);
      const ix = sx * Math.pow(sy, 3) / 12;
      const iy = sy * Math.pow(sx, 3) / 12;
      const imin = Math.max(1e-6, Math.min(ix, iy));
      const joint = currentJointMethod();
      const compressionAllow = effectiveMaterial.compressionAllow;
      const compressionStress = F / area;
      const compressionRisk = compressionStress / compressionAllow;
      const pcr = Math.PI * Math.PI * E * imin / Math.pow(height, 2); // 両端ピン相当の教材用概算
      const bucklingRisk = F / Math.max(1e-6, pcr);
      const contactPenalty = contactPenaltyFromRatio(support.contactAreaRatio);
      const loadRatio = Math.max(0, F / 49.0);
      const jointFactor = joint.key === 'nails' ? 1.35 : (joint.key === 'glue' ? 1.10 : 0.78);
      const jointRaw = loadRatio * 0.16 * jointFactor * contactPenalty;
      const memberRaw = Math.max(compressionRisk, bucklingRisk);
      const raw = Math.max(memberRaw, jointRaw);
      const risk = Math.max(0, raw / 1.15);
      const axialShortening = F * height / Math.max(1e-6, area * E);
      const deflectionLimit = height / 300;
      const safetyFactor = compressionAllow / Math.max(0.001, compressionStress);
      const nodes = Array.from({length: Math.max(5, femElementCount() + 1)}, (_, i) => {
        const x = i / Math.max(1, femElementCount());
        return {x, v:x*x, norm:x*x};
      });
      return {
        risk, raw, memberRaw, jointRaw,
        cantileverLike:false, attachmentLike:true, compactAttachment:false, overhangRatio:height / Math.max(1, Math.min(sx, sy)),
        memberRisk:Math.max(0, memberRaw / 1.15),
        jointRisk:Math.max(0, jointRaw / 1.15),
        jointMethodKey:joint.key, jointMethodLabel:joint.label, jointMethodNote:joint.note, jointMethodFactor:joint.factor,
        jointDirectionFactor:1.0, contactPenalty, supportAuto:!!support.auto,
        supportNote:'上からの重さは，側板・脚などの支えへ分け，つぶれと細長い部材の座屈を見ています。',
        supportKey:'top_frame_sway', supportFactor:1, deformAxis:'z', fixedEnd:'min',
        deflectionScore:axialShortening, longMm:height, shortMm:Math.max(sx, sy), slenderness:height / Math.max(1, Math.min(sx, sy)),
        grainFactor:effectiveMaterial.grainFactor, grainMisaligned:effectiveMaterial.grainMisaligned, sideFactor:1,
        forceDirection:dir, forceDirectionLabel:FORCE_DIRECTIONS[dir].label,
        thicknessMm:Math.min(sx, sy), supportLabel:'上からの力：支えの圧縮・座屈として判定', loadN:F,
        I:imin, momentNmm:0, stressMpa:compressionStress, allowMpa:compressionAllow, safetyFactor,
        deflectionMm:axialShortening, deflectionLimitMm:deflectionLimit, femNodes:nodes, femElements:femElementCount(),
        compressionRisk, bucklingRisk, failureMode:bucklingRisk > compressionRisk ? '座屈' : '圧縮'
      };
    }

    // v2.23: 左右から押す場合は，天板・棚板の曲げよりも，
    // 側板や縦板が斜めに倒れる「横ゆれ」と接合部の回転を主に見る。
    // そのため，縦板を側板候補として扱い，z方向（高さ方向）に沿って上部ほど横へ動く簡易モデルにする。
    const sideRoot = dir === 'side' ? detectSidePanelRootForSideLoad(partEl) : null;
    if (sideRoot) {
      const joint = currentJointMethod();
      const allow = effectiveMaterial.allow;
      const Lroot = Math.max(1, sideRoot.spanMm || longMm);
      const Wroot = Math.max(1, sideRoot.widthMm || shortMm);
      const panelT = Math.max(1, sideRoot.thickness || thicknessMm);
      const loadRatio = Math.max(0, F / 49.0);
      const overhangRatio = Lroot / panelT;
      const heightRatio = Wroot / panelT;
      const jointFactor = joint.key === 'nails' ? 2.05 : (joint.key === 'glue' ? 1.48 : 1.05);
      const braceFactor = sideBraceFactorForLoad('side');
      // 側板の板面そのものではなく，背板・正面板に取り付く一辺の接合部に
      // 曲げ・回転が集まると考える。背板1枚があっても片側根元の弱さは残す。
      const rootBase = loadRatio * (overhangRatio / 10.5 + heightRatio / 18.0);
      const memberRaw = rootBase * 0.82 * Math.max(0.72, braceFactor);
      const jointRaw = rootBase * jointFactor * 1.18 * Math.max(0.72, braceFactor);
      const raw = Math.max(memberRaw, jointRaw);
      const risk = Math.max(0, raw / 1.22);
      const stressMpa = Math.max(0.05, raw * allow * 0.55);
      const delta = Math.max(0, loadRatio * Lroot * 0.0065 * jointFactor * Math.max(0.75, braceFactor));
      const deflectionLimit = Lroot / 150;
      const safetyFactor = allow / Math.max(0.001, stressMpa);
      const nodes = Array.from({length: Math.max(5, femElementCount() + 1)}, (_, i) => {
        const x = i / Math.max(1, femElementCount());
        return {x, v:x*x, norm:x*x};
      });
      return {
        risk, raw, memberRaw, jointRaw,
        cantileverLike:true, attachmentLike:true, compactAttachment:false, overhangRatio,
        memberRisk:Math.max(0, memberRaw / 1.10),
        jointRisk:Math.max(0, jointRaw / 1.10),
        jointMethodKey:joint.key, jointMethodLabel:joint.label, jointMethodNote:joint.note, jointMethodFactor:joint.factor,
        jointDirectionFactor:1.75, supportAuto:true,
        supportNote:'左右からの力では，左右の側板が背板・正面板に取り付く一辺の付け根に力が集まりやすい構造として見ています。側板の根元・接合部に注意が必要です。 ' + sideBraceNote(),
        supportKey:'side_panel_root', supportFactor:1, deformAxis:sideRoot.axis || 'y', fixedEnd:sideRoot.fixedEnd || 'max',
        deflectionScore:delta, longMm:Lroot, shortMm:Wroot, slenderness:Lroot / Math.max(1, Wroot),
        grainFactor:1, sideFactor:1, forceDirection:dir, forceDirectionLabel:FORCE_DIRECTIONS[dir].label,
        thicknessMm:panelT, supportLabel:'左右の力：側板の付け根として判定', loadN:F,
        I: (panelT * Math.pow(Math.max(1, Wroot),3) / 12), momentNmm:raw * 1000, stressMpa, allowMpa:allow, safetyFactor,
        deflectionMm:delta, deflectionLimitMm:deflectionLimit, femNodes:nodes, femElements:femElementCount()
      };
    }

    if (dir === 'side' && isSideSwayPanelForSideLoad(partEl)) {
      const box = getPart3dBox(partEl);
      const info = getBoxDimsSorted(partEl);
      const height = Math.max(1, box.z.size || longMm);
      const panelWidth = Math.max(1, Math.max(box.x.size || 0, box.y.size || 0));
      const panelT = Math.max(1, thicknessMm);
      const joint = currentJointMethod();
      const allow = effectiveMaterial.allow;
      const loadRatio = Math.max(0, F / 49.0);
      const hOverT = height / panelT;
      const swayBase = loadRatio * (hOverT / 18.0);
      const jointFactor = joint.key === 'nails' ? 1.95 : (joint.key === 'glue' ? 1.35 : 0.95);
      const backBraceFactor = sideBraceFactorForLoad('side');
      const jointRaw = swayBase * jointFactor * 1.65 * backBraceFactor;
      const memberRaw = swayBase * 1.05 * backBraceFactor;
      const raw = Math.max(memberRaw, jointRaw);
      const risk = Math.max(0, raw / 1.10);
      const stressMpa = Math.max(0.05, raw * allow * 0.55);
      const delta = Math.max(0, loadRatio * height * 0.0045 * jointFactor * backBraceFactor);
      const deflectionLimit = height / 160;
      const safetyFactor = allow / Math.max(0.001, stressMpa);
      const nodes = Array.from({length: Math.max(5, femElementCount() + 1)}, (_, i) => {
        const x = i / Math.max(1, femElementCount());
        return {x, v:x*x, norm:x*x};
      });
      return {
        risk, raw, memberRaw, jointRaw,
        cantileverLike:false, attachmentLike:true, compactAttachment:false, overhangRatio:hOverT,
        memberRisk:Math.max(0, memberRaw / 1.10),
        jointRisk:Math.max(0, jointRaw / 1.10),
        jointMethodKey:joint.key, jointMethodLabel:joint.label, jointMethodNote:joint.note, jointMethodFactor:joint.factor,
        jointDirectionFactor:1.65, supportAuto:!!support.auto,
        supportNote:'左右からの力なので，天板ではなく，側板・縦板が斜めに倒れる横ゆれとして見ています。' + ' ' + sideBraceNote(),
        supportKey:'side_sway', supportFactor:1, deformAxis:'z', fixedEnd:'min',
        deflectionScore:delta, longMm:height, shortMm:panelWidth, slenderness:height / Math.max(1, panelWidth),
        grainFactor:1, sideFactor:1, forceDirection:dir, forceDirectionLabel:FORCE_DIRECTIONS[dir].label,
        thicknessMm:panelT, supportLabel:'左右の力：側板の横ゆれとして判定', loadN:F,
        I: (panelT * Math.pow(panelWidth,3) / 12), momentNmm:raw * 1000, stressMpa, allowMpa:allow, safetyFactor,
        deflectionMm:delta, deflectionLimitMm:deflectionLimit, femNodes:nodes, femElements:femElementCount()
      };
    }


    // 左右からの力では，水平な天板・棚板そのものの曲げは主役ではないため，
    // 横ゆれに比べて低めに扱う。上からの力の場合は従来どおり梁として計算する。
    const sideHorizontalDamping = 1.0;

    // 上からの力：板厚方向に曲がると考え，I = 幅×厚さ^3/12。
    // 左右からの力：横から押されるため，板の幅方向を立てた向きの曲げとして近似し，I = 厚さ×幅^3/12。
    // これは教育用の簡易モデルで，接合部のゆるみや棚全体のねじれは安全側に少し割増して扱います。
    const I = (dir === 'side') ? (t * Math.pow(b, 3) / 12) : (b * Math.pow(t, 3) / 12);
    const c = (dir === 'side') ? (b / 2) : (t / 2);

    const grainFactor = effectiveMaterial.grainFactor;
    const sideFactor = dir === 'side' ? 1.18 : 1.0;
    const fem = runBeamFem(L, E, I, F, support.key === 'auto' ? 'simple_center' : support.key, femElementCount());
    const Mmax = fem.maxMoment * sideFactor;
    const delta = fem.maxDeflection * sideFactor;
    const stressMpa = (Mmax * c) / I;
    const allow = effectiveMaterial.allow;
    const safetyFactor = allow / Math.max(0.001, stressMpa);
    const deflectionLimit = L / 200; // 教材用の目安：スパンの1/200
    const stressRisk = stressMpa / allow;
    const deflectionRisk = delta / Math.max(0.1, deflectionLimit);
    const slenderness = longMm / shortMm;
    const shelfLikeFactor = slenderness >= 1.5 ? 1.0 : 0.55;
    const cantileverLike = (support.key === 'cantilever') || !!support.cantileverLike;
    const cantileverConnectionFactor = cantileverLike ? (support.supportFactor || 2.20) : 1.0;
    const attachmentFactor = support.attachmentLike ? 1.35 : 1.0;
    // 片側だけで支える部品は，部材の曲げだけでなく「付け根の接合部」に大きな力が出やすい。
    // そのため，板そのもののたわみ・応力とは別に，L/t（出ている長さ÷板厚）と荷重から接合部リスクを加える。
    const effectiveShelfFactor = cantileverLike ? 1.0 : shelfLikeFactor;
    const memberRaw = Math.max(stressRisk, deflectionRisk) * effectiveShelfFactor * sideFactor * cantileverConnectionFactor * attachmentFactor * sideHorizontalDamping;
    const joint = currentJointMethod();
    const jointDirectionFactor = dir === 'side' ? 1.85 : 1.35;
    const overhangRatio = L / Math.max(1, t);
    const loadRatio = Math.max(0, F / 49.0); // 約5kgを基準。0荷重ならリスクも0。
    const contactPenalty = contactPenaltyFromRatio(support.contactAreaRatio);
    const fixedEndJointFactor = cantileverLike ? Math.max(1, Number(support.fixedEndJointFactor) || 1) : 1;
    const cantileverJointRaw = cantileverLike ? (loadRatio * overhangRatio / 15) * joint.factor * jointDirectionFactor * cantileverConnectionFactor * attachmentFactor * contactPenalty * fixedEndJointFactor : 0;
    // 釘だけで片側固定された小部品は，板そのものの曲げよりも付け根のずれ・回転が先に問題になりやすい。
    // 教育用の安全側補正として，L/t が大きい片持ち部品では最低でも注意〜危険側に出るように接合リスクを加える。
    const nailsCantileverRaw = (cantileverLike && joint.key === 'nails') ? (0.72 + Math.max(0, overhangRatio - 3.0) * 0.18) * loadRatio * (dir === 'side' ? 1.25 : 1.0) * attachmentFactor : 0;
    const glueCantileverRaw = (cantileverLike && joint.key === 'glue') ? (0.55 + Math.max(0, overhangRatio - 3.0) * 0.11) * loadRatio * attachmentFactor : 0;
    const jointRaw = Math.max(memberRaw * joint.factor * jointDirectionFactor * contactPenalty, cantileverJointRaw, nailsCantileverRaw * contactPenalty, glueCantileverRaw * contactPenalty);
    const raw = Math.max(memberRaw, jointRaw);
    const risk = Math.max(0, raw / 1.25);
    const memberRisk = Math.max(0, memberRaw / 1.25);
    const jointRisk = Math.max(0, jointRaw / 1.25);
    const deflectionScore = Math.max(0, delta);
    return { risk, raw, memberRaw, jointRaw, cantileverLike, attachmentLike:!!support.attachmentLike, compactAttachment:!!support.compactAttachment, overhangRatio, memberRisk, jointRisk, jointMethodKey:joint.key, jointMethodLabel:joint.label, jointMethodNote:joint.note, jointMethodFactor:joint.factor, jointDirectionFactor, supportAuto:!!support.auto, supportNote:support.note || '', supportKey:support.key, supportFactor:(support.supportFactor||1), freeEndLoad:!!support.freeEndLoad, fixedEndJointFactor, deformAxis:(support.deformAxis || ''), fixedEnd:(support.fixedEnd || 'min'), deflectionScore, longMm, shortMm, slenderness, grainFactor, grainMisaligned:effectiveMaterial.grainMisaligned, contactPenalty, sideFactor, forceDirection:dir, forceDirectionLabel:FORCE_DIRECTIONS[dir].label, thicknessMm, supportLabel:support.label, loadN:F, I, momentNmm:Mmax, stressMpa, allowMpa:allow, safetyFactor, deflectionMm:delta, deflectionLimitMm:deflectionLimit, femNodes:fem.nodes, femElements:fem.elements };
  }
  function ensureStrengthSvgParts(){
    // v2.40: 「つよいん」を直接開いた場合など，木取りSVGの部品gがまだ生成されない
    // 状態でも強度評価できるよう，STLの連結成分から評価用の非表示gを作る。
    let svg = document.querySelector('#svg-container svg');
    const hasParts = svg && svg.querySelector('g[data-x][id^="part-"]');
    if (hasParts) return svg;
    if (!Array.isArray(geometriesCache) || !geometriesCache.length) return svg;
    const container = document.getElementById('svg-container') || document.body;
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '1');
      svg.setAttribute('height', '1');
      svg.setAttribute('viewBox', '0 0 1 1');
      svg.style.position = 'absolute';
      svg.style.left = '-9999px';
      svg.style.top = '-9999px';
      svg.style.width = '1px';
      svg.style.height = '1px';
      svg.dataset.strengthVirtualSvg = '1';
      container.appendChild(svg);
    }
    geometriesCache.forEach((geometry, index) => {
      if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
      const pos = geometry.attributes.position.array;
      if (!pos || !pos.length) return;
      let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
      for(let i=0;i<pos.length;i+=3){
        const x=pos[i], y=pos[i+1], z=pos[i+2];
        if(x<minX)minX=x; if(x>maxX)maxX=x;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
        if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
      }
      const sx=Math.max(0,maxX-minX), sy=Math.max(0,maxY-minY), sz=Math.max(0,maxZ-minZ);
      if(!isFinite(sx)||!isFinite(sy)||!isFinite(sz)||Math.max(sx,sy,sz)<=0) return;
      const dims=[sx,sy,sz].filter(v=>v>0).sort((a,b)=>a-b);
      const t=dims[0]||0;
      const inPlane=[{axis:'x',size:sx},{axis:'y',size:sy},{axis:'z',size:sz}].sort((a,b)=>b.size-a.size);
      const w=inPlane[0]?.size || sx;
      const h=inPlane[1]?.size || sy;
      const g=document.createElementNS('http://www.w3.org/2000/svg','g');
      g.id='part-'+index;
      g.dataset.x='0';
      g.dataset.y='0';
      g.dataset.angle='0';
      g.dataset.centerX=String(w/2);
      g.dataset.centerY=String(h/2);
      g.dataset.partW=String(w);
      g.dataset.partH=String(h);
      g.dataset.partNo=String(index+1);
      g.dataset.partLabel='部品'+(index+1);
      g.dataset.partKey=Math.round(w)+'x'+Math.round(h);
      g.dataset.partColor='#93c5fd';
      g.dataset.projAxis='virtual';
      g.dataset.size3dX=String(sx); g.dataset.size3dY=String(sy); g.dataset.size3dZ=String(sz);
      g.dataset.min3dX=String(minX); g.dataset.max3dX=String(maxX);
      g.dataset.min3dY=String(minY); g.dataset.max3dY=String(maxY);
      g.dataset.min3dZ=String(minZ); g.dataset.max3dZ=String(maxZ);
      g.dataset.inferredThickness=String(t);
      g.dataset.thicknessSource='stl';
      g.dataset.strengthVirtualPart='1';
      g.style.display='none';
      svg.appendChild(g);
    });
    return svg;
  }


  function detectCompositeTopCantileverSideFrames(){
    // 背板と左右の張り出し側板がCADの和演算で1つの連結成分になったSTLを検出する。
    // 部品分離できない場合でも，頂点座標の段差から左右2枚の側板を推定する。
    const svg=document.querySelector('#svg-container svg');
    if(!svg||!Array.isArray(geometriesCache)) return [];
    const parts=Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
    const out=[];
    function levels(pos,axis){
      const set=new Set();
      for(let i=axis;i<pos.length;i+=3) set.add(Math.round(pos[i]*100)/100);
      return Array.from(set).sort((a,b)=>a-b);
    }
    function orientation(p,index,geo,sideAxis,reachAxis){
      const pos=geo&&geo.attributes&&geo.attributes.position&&geo.attributes.position.array;
      if(!pos||pos.length<9) return null;
      const lv=[levels(pos,0),levels(pos,1),levels(pos,2)];
      const side=lv[sideAxis],reach=lv[reachAxis],z=lv[2];
      if(side.length<4||reach.length<3||z.length<3) return null;
      const gaps=[];
      [side,reach,z].forEach(a=>{for(let i=1;i<a.length;i++){const d=a[i]-a[i-1];if(d>0.2)gaps.push(d);}});
      gaps.sort((a,b)=>a-b);
      const typical=Math.max(1,Number(collectInferredThicknessStats()?.median)||gaps[0]||12);
      const leftT=side[1]-side[0],rightT=side[side.length-1]-side[side.length-2];
      const backT=reach[reach.length-1]-reach[reach.length-2];
      const topH=z[z.length-1]-z[z.length-2];
      const overhang=reach[reach.length-2]-reach[0];
      const centerWidth=side[side.length-2]-side[1];
      const thinOK=v=>v>0&&v<=Math.max(30,typical*2.2);
      if(!thinOK(leftT)||!thinOK(rightT)||!thinOK(backT)) return null;
      if(topH<Math.max(35,typical*2.5)||overhang<Math.max(55,typical*4)||centerWidth<Math.max(70,typical*5)) return null;
      const box=getPart3dBox(p);
      if(!box||box.z.size<topH+typical*2) return null;
      return {p,index,sideCount:2,overhangMm:overhang,plateHeightMm:topH,
        thicknessMm:(leftT+rightT)/2,backThicknessMm:backT,
        longAxis:reachAxis===0?'x':'y',fixedEnd:'max',composite:true};
    }
    parts.forEach(p=>{
      const index=partIndexFromEl(p),geo=geometriesCache[index];
      if(!geo)return;
      const best=[orientation(p,index,geo,0,1),orientation(p,index,geo,1,0)]
        .filter(Boolean).sort((a,b)=>b.overhangMm-a.overhangMm)[0];
      if(best)out.push(best);
    });
    return out;
  }
  function getCompositeTopCantileverInfo(partEl){
    // v12.0: 一体化した背板＋左右側板の抽出は、縦向きの上部フレームだけに適用する。
    // 水平な天板まで複合片持ちフレームとして拾うと、左右の脚で支えられた通常天板を
    // 片持ち扱いしてしまうため、水平板は必ず通常の支持経路判定へ回す。
    if (!partEl || isHorizontalPlatePart(partEl)) return null;
    return detectCompositeTopCantileverSideFrames().find(x=>x.p===partEl)||null;
  }
  function calculateCompositeTopCantileverRisk(partEl,loadKg,material,info){
    const load=Math.max(0,Number(loadKg)||0);
    const eachLoad=load/Math.max(1,info.sideCount||2);
    const F=eachLoad*9.80665;
    const L=Math.max(1,info.overhangMm||1),h=Math.max(1,info.plateHeightMm||1);
    const t=Math.max(1,info.thicknessMm||memberThicknessMm(partEl)||12);
    const effective=effectiveMaterialForPart(partEl,material),E=effective.E,allow=effective.allow;
    const I=t*Math.pow(h,3)/12,M=F*L;
    const stress=(M*(h/2))/Math.max(1e-6,I);
    const delta=F*Math.pow(L,3)/Math.max(1e-6,3*E*I);
    const memberRaw=Math.max(stress/Math.max(.001,allow),delta/Math.max(.1,L/200));
    const joint=currentJointMethod();
    const loadRatio=load/5;
    const overhangRatio=L/Math.max(1,h);
    const jointBase=joint.key==='glue'?.56:(joint.key==='nails'?.48:.30);
    const jointRaw=loadRatio*(jointBase+Math.max(0,overhangRatio-.8)*.18)*1.18;
    const raw=Math.max(memberRaw,jointRaw),risk=Math.max(0,raw/1.25);
    const nodes=Array.from({length:Math.max(5,femElementCount()+1)},(_,i)=>{const x=i/Math.max(1,femElementCount());return{x,v:x*x,norm:x*x};});
    return {risk,raw,memberRaw,jointRaw,compositeTopCantilever:true,cantileverLike:true,attachmentLike:true,
      compactAttachment:false,overhangRatio:L/Math.max(1,t),memberRisk:memberRaw/1.25,jointRisk:jointRaw/1.25,
      jointMethodKey:joint.key,jointMethodLabel:joint.label,jointMethodNote:joint.note,jointMethodFactor:joint.factor,
      jointDirectionFactor:1.7,contactPenalty:1.25,supportAuto:true,
      supportNote:'背板と左右の側板が1部品に結合されたSTLから，上部左右の張り出し側板を抽出し，本の重さを2枚へ分けています。側板の曲げと背板との付け根の接合部のうち厳しい方を判定します。',
      supportKey:'top_composite_cantilever_side_plates',supportFactor:2.2,freeEndLoad:true,fixedEndJointFactor:1.8,
      deformAxis:info.longAxis||'y',fixedEnd:info.fixedEnd||'max',deflectionScore:delta,longMm:L,shortMm:h,
      slenderness:L/Math.max(1,h),grainFactor:effective.grainFactor,grainMisaligned:effective.grainMisaligned,
      sideFactor:1,forceDirection:'top',forceDirectionLabel:FORCE_DIRECTIONS.top.label,thicknessMm:t,
      supportLabel:'上からの力：上部左右の片持ち側板として判定',loadN:load*9.80665,I,momentNmm:M,
      stressMpa:stress,allowMpa:allow,safetyFactor:allow/Math.max(.001,stress),deflectionMm:delta,
      deflectionLimitMm:L/200,femNodes:nodes,femElements:femElementCount(),
      failureMode:'上部左右の側板の曲げ・背板との付け根の接合部'};
  }

  function detectTopCantileverSidePlates(){
    // 水平な棚板がない作品で，本を左右の短い側板の上端に渡して置く形を検出する。
    // 例：背板から前方へ張り出した左右2枚の縦板。上荷重では各板を片持ち梁として扱う。
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return [];
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
    if (!parts.length) return [];
    const rows = parts.map(p => ({p, box:getPart3dBox(p)}));
    const valid = rows.filter(r => r.box && ['x','y','z'].every(a => Number.isFinite(r.box[a].min) && Number.isFinite(r.box[a].max)));
    if (!valid.length) return [];
    const globalMinZ = Math.min(...valid.map(r => r.box.z.min));
    const globalMaxZ = Math.max(...valid.map(r => r.box.z.max));
    const globalH = Math.max(1, globalMaxZ - globalMinZ);
    const stats = collectInferredThicknessStats();
    const typicalT = Math.max(1, Number(stats && stats.median) || 12);
    const nearTopTol = Math.max(18, typicalT * 2.0);

    const backs = valid.filter(r => {
      const b=r.box;
      const thin=Math.min(b.x.size,b.y.size);
      const wide=Math.max(b.x.size,b.y.size);
      return b.z.size >= globalH * 0.70 && thin <= Math.max(30, typicalT*2.2) && wide >= Math.max(80, typicalT*6);
    });

    const out=[];
    valid.forEach(r => {
      const b=r.box;
      if (globalMaxZ - b.z.max > nearTopTol) return;
      if (b.z.size < Math.max(35, typicalT*2.5) || b.z.size > globalH*0.62) return;
      const thinAxis = b.x.size <= b.y.size ? 'x' : 'y';
      const longAxis = thinAxis === 'x' ? 'y' : 'x';
      const thin = b[thinAxis].size;
      const span = b[longAxis].size;
      if (thin > Math.max(30, typicalT*2.2) || span < Math.max(65, typicalT*5)) return;
      let best=null;
      backs.forEach(backRow => {
        if (backRow.p === r.p) return;
        const q=backRow.box;
        const zOverlap=Math.max(0,Math.min(b.z.max,q.z.max)-Math.max(b.z.min,q.z.min));
        if (zOverlap < Math.min(b.z.size, q.z.size)*0.55) return;

        // 側板は背板の端面に接するため，板厚方向では面積をもって重ならず，
        // 境界面で接するだけのSTLが多い。従来の overlap 判定ではこの形を
        // 見落としていたので，重なりだけでなく端面間の距離も見る。
        const crossAxis=thinAxis;
        const crossOverlap=Math.max(0,Math.min(b[crossAxis].max,q[crossAxis].max)-Math.max(b[crossAxis].min,q[crossAxis].min));
        const crossGap=Math.max(0,Math.max(b[crossAxis].min,q[crossAxis].min)-Math.min(b[crossAxis].max,q[crossAxis].max));
        if (crossOverlap < Math.min(b[crossAxis].size,q[crossAxis].size)*0.20 &&
            crossGap > Math.max(2.0, typicalT*0.22)) return;

        // 張り出し方向では，背板の板厚分だけ側板端部と重なる形を接合とみなす。
        const longOverlap=Math.max(0,Math.min(b[longAxis].max,q[longAxis].max)-Math.max(b[longAxis].min,q[longAxis].min));
        const touchMin=Math.abs(b[longAxis].min-q[longAxis].max);
        const touchMax=Math.abs(b[longAxis].max-q[longAxis].min);
        const nearMin=Math.abs(b[longAxis].min-q[longAxis].min);
        const nearMax=Math.abs(b[longAxis].max-q[longAxis].max);
        const contactTol=Math.max(5, typicalT*1.20);
        if (longOverlap < Math.max(3, typicalT*0.45) &&
            Math.min(touchMin,touchMax,nearMin,nearMax) > contactTol) return;

        // 背板との重なりが側板のどちらの端に近いかで固定端を決める。
        const overlapCenter=(Math.max(b[longAxis].min,q[longAxis].min)+Math.min(b[longAxis].max,q[longAxis].max))/2;
        const distToMin=Math.abs(overlapCenter-b[longAxis].min);
        const distToMax=Math.abs(b[longAxis].max-overlapCenter);
        const fixedEnd=distToMin<=distToMax?'min':'max';
        const score=zOverlap+longOverlap+Math.max(0,crossOverlap)-crossGap*4;
        if (!best || score>best.score) best={back:backRow.p,fixedEnd,score};
      });
      if (!best) return;
      out.push({
        p:r.p,
        back:best.back,
        spanMm:span,
        sectionDepthMm:b.z.size,
        sectionWidthMm:thin,
        fixedEnd:best.fixedEnd,
        longAxis,
        thinAxis
      });
    });
    return out;
  }

  function getTopCantileverSidePlateInfo(partEl){
    return detectTopCantileverSidePlates().find(x => x.p === partEl) || null;
  }

  function getTopLoadSurfaceState(){
    // 上から本を載せる場合，作品の上部に実際の水平な受け面があるかを確認する。
    // 背板の上端や短い側板の上に本CGだけが表示される状態を，安全な棚板として扱わない。
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return {supported:true, candidates:[], reason:''};
    const allParts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
    if (!allParts.length) return {supported:true, candidates:[], reason:''};
    const boxes = allParts.map(p => ({p, box:getPart3dBox(p)}));
    const globalMaxZ = Math.max(...boxes.map(r => Number(r.box?.z?.max) || 0));
    const thicknessStats = collectInferredThicknessStats();
    const typicalT = Math.max(1, Number(thicknessStats && thicknessStats.median) || 12);
    const topTol = Math.max(24, typicalT * 3.0);
    const horizontal = allParts.filter(p => !isBottomBasePart(p) && isHorizontalPlatePart(p));
    const candidates = horizontal.filter(p => {
      const b = getPart3dBox(p);
      const area = Math.max(0, Number(b?.x?.size) || 0) * Math.max(0, Number(b?.y?.size) || 0);
      const nearTop = globalMaxZ - (Number(b?.z?.max) || 0) <= topTol;
      return nearTop && area >= Math.max(900, typicalT * typicalT * 8);
    });
    if (candidates.length) return {supported:true, candidates, mode:'horizontal_surface', globalMaxZ, topTol, reason:''};
    const sidePlates = detectTopCantileverSidePlates();
    if (sidePlates.length >= 2) {
      return {
        supported:true,
        candidates:sidePlates.map(x => x.p),
        sidePlateInfos:sidePlates,
        mode:'cantilever_side_plates',
        globalMaxZ,
        topTol,
        reason:'本の重さを，上部左右の張り出した側板の上端で受ける形として判定します。'
      };
    }
    const compositeFrames=detectCompositeTopCantileverSideFrames();
    if(compositeFrames.length){
      return {supported:true,candidates:compositeFrames.map(x=>x.p),compositeInfos:compositeFrames,
        mode:'composite_cantilever_side_plates',globalMaxZ,topTol,
        reason:'背板と側板が一体化したSTLから，上部左右の張り出し側板を抽出して判定します。'};
    }
    const highestHorizontalZ = horizontal.length
      ? Math.max(...horizontal.map(p => Number(getPart3dBox(p)?.z?.max) || 0))
      : NaN;
    const gap = Number.isFinite(highestHorizontalZ) ? Math.max(0, globalMaxZ - highestHorizontalZ) : NaN;
    return {
      supported:false,
      candidates:[],
      globalMaxZ,
      highestHorizontalZ,
      gap,
      topTol,
      reason:Number.isFinite(gap)
        ? `本を置く高さの近くに水平な棚板がありません（最上部との差 約${gap.toFixed(0)}mm）。`
        : '本を載せる水平な棚板が見つかりません。'
    };
  }

  function calculateTopLoadSupportCheck(loadKg){
    const state = getTopLoadSurfaceState();
    const load = Math.max(0, Number(loadKg) || 0);
    if (state.supported || load <= 0) return {risk:0, raw:0, supported:true, note:'本を載せる水平な面を確認できました。'};
    return {
      risk:1.20,
      raw:1.20,
      supported:false,
      judge:riskLabel(1.20),
      note:state.reason + ' この形では本の重さを棚板へ伝えられないため，部材の曲げ計算より先に設計を見直す必要があります。'
    };
  }

  function partPlanAreaWeight(partEl){
    const box = getPart3dBox(partEl);
    const area3d = Math.max(0, box.x.size || 0) * Math.max(0, box.y.size || 0);
    if (area3d > 0) return area3d;
    const w = parseFloat(partEl.dataset.partW || '0') || 0;
    const h = parseFloat(partEl.dataset.partH || '0') || 0;
    return Math.max(1, w * h);
  }
  function topSupportWeight(partEl){
    const box = getPart3dBox(partEl);
    return Math.max(1, memberThicknessMm(partEl) * Math.max(1, box.x.size || 0, box.y.size || 0));
  }
  function sideResistanceWeight(partEl){
    const box = getPart3dBox(partEl);
    const h = Math.max(1, box.z.size || 1);
    const width = Math.max(1, box.x.size || 0, box.y.size || 0);
    return Math.max(1, memberThicknessMm(partEl) * width / Math.sqrt(h));
  }
  function distributeLoad(loadMap, noteMap, targets, totalKg, weightFn, note){
    if (!targets.length || totalKg <= 0) return;
    const weights = targets.map(p => Math.max(0.0001, Number(weightFn(p)) || 0.0001));
    const sum = weights.reduce((a,b)=>a+b,0) || 1;
    targets.forEach((p, i) => {
      const share = totalKg * weights[i] / sum;
      loadMap.set(p, (loadMap.get(p) || 0) + share);
      const old = noteMap.get(p) || '';
      noteMap.set(p, old ? `${old} ${note}` : note);
    });
  }
  function buildLoadAllocation(parts, totalLoadKg, forceDirection){
    const dir = normalizeForceDirection(forceDirection);
    const loadMap = new Map(parts.map(p => [p, 0]));
    const noteMap = new Map();
    const total = Math.max(0, totalLoadKg);
    if (!parts.length || total <= 0) return {loadMap, noteMap, summary:'荷重は0です。'};

    if (dir === 'top') {
      const topSurfaceState = getTopLoadSurfaceState();
      const horizontalAll = parts.filter(p => isHorizontalPlatePart(p));
      // 本CGが置かれる上部付近の水平板だけを荷重対象にする。
      // 下段棚や底板へ荷重を分散して安全側に見積もらない。
      const horizontal = topSurfaceState.supported && topSurfaceState.candidates.length
        ? topSurfaceState.candidates.filter(p => parts.includes(p))
        : [];
      const supports = parts.filter(p => isTopFrameSupportPart(p));
      const topCantileverSidePlates = (topSurfaceState.mode === 'cantilever_side_plates' || topSurfaceState.mode === 'composite_cantilever_side_plates')
        ? (topSurfaceState.candidates || []).filter(p => parts.includes(p))
        : [];

      if (topCantileverSidePlates.length) {
        distributeLoad(loadMap, noteMap, topCantileverSidePlates, total, () => 1,
          '水平棚板がないため，本の重さを上部左右の張り出した側板へ均等に分けています。各側板は背板との付け根を固定端とする片持ち部材として評価します。');
      }

      // v2.46: 片持ち棚板がある場合，画面の本CGと同じく，荷重はその棚板へ載るものとして扱う。
      // 従来は底板を含む全水平板へ面積配分していたため，片持ち棚板が受ける荷重が薄まり，
      // 「10kgでも余裕あり」のように安全側へ寄りすぎることがあった。
      const cantileverHorizontal = horizontal.filter(p => {
        try {
          const support = inferSupportFromGeometry(p);
          return !!(support && (support.key === 'cantilever' || support.cantileverLike || support.broadShelfCantilever));
        } catch(e) { return false; }
      });

      if (!topCantileverSidePlates.length && cantileverHorizontal.length) {
        // 複数ある場合は最上段だけを荷重対象にする。本CGも最上段へ置かれるため表示と計算を一致させる。
        const centers = cantileverHorizontal.map(p => {
          const box = getPart3dBox(p);
          return {p, z:(Number(box?.z?.min) + Number(box?.z?.max)) / 2};
        }).filter(r => Number.isFinite(r.z));
        const topZ = centers.length ? Math.max(...centers.map(r => r.z)) : NaN;
        const zTol = Math.max(6, collectInferredThicknessStats()?.median || 12);
        const targets = Number.isFinite(topZ)
          ? centers.filter(r => topZ - r.z <= zTol).map(r => r.p)
          : cantileverHorizontal;
        distributeLoad(loadMap, noteMap, targets, total, partPlanAreaWeight,
          '片持ち棚板では，本の重さを最上段の張り出した棚板へ集中して載せています。');
      } else if (!topCantileverSidePlates.length && horizontal.length) {
        distributeLoad(loadMap, noteMap, horizontal, total, partPlanAreaWeight,
          '上にのせる重さを，水平な棚板・天板の面積に応じて分けています。');
      }
      if (!topCantileverSidePlates.length && supports.length) {
        // 荷重は棚板を通って支えへ伝わるため，支え側にも同じ総荷重を反力として分配する。
        distributeLoad(loadMap, noteMap, supports, total, topSupportWeight,
          '棚板から伝わる重さを，側板・脚の断面に応じて分けています。');
      }
      if (!topCantileverSidePlates.length && !horizontal.length && !supports.length) {
        distributeLoad(loadMap, noteMap, parts, total, () => 1,
          '支え方を判定できないため，部品へ均等に分けています。');
      }
      return {
        loadMap,
        noteMap,
        unsupportedTopLoad:!topSurfaceState.supported,
        topSurfaceState,
        summary:!topSurfaceState.supported
          ? topSurfaceState.reason + ' 本を載せる面を追加してから強度を比較してください。'
          : (topCantileverSidePlates.length
            ? '水平棚板がないため，本の重さを上部左右の張り出した側板へ分け，側板の下向き曲げと背板との付け根の接合部を評価しています。'
            : (cantileverHorizontal.length
              ? '片持ち棚板では，本CGと同じ最上段の張り出した棚板へ総重量を載せ，付け根の部材・接合部を評価しています。'
              : '上にのせる総重量を，上部の棚板・天板には面積に応じて，側板・脚には支える断面に応じて自動で分けています。'))
      };
    }

    let resistors = parts.filter(p => !isHorizontalPlatePart(p) &&
      (isSideSwayPanelForSideLoad(p) || !!detectSidePanelRootForSideLoad(p)));
    if (!resistors.length) resistors = parts.filter(p => !isHorizontalPlatePart(p));
    if (!resistors.length) resistors = parts.slice();
    distributeLoad(loadMap, noteMap, resistors, total, sideResistanceWeight,
      '横から押す力を，横ゆれを受ける側板・脚へ自動で分けています。');

    // 水平板は枠をつなぐ働きだけを簡易評価するため，総横力の20%を水平板同士で分ける。
    const ties = parts.filter(p => isHorizontalPlatePart(p));
    distributeLoad(loadMap, noteMap, ties, total * 0.20, partPlanAreaWeight,
      '水平板は枠をつなぐ部材として，横力の一部だけを分けています。');
    return {
      loadMap,
      noteMap,
      summary:'横から押す力を，側板・脚の大きさに応じて自動で分けています。水平板は枠をつなぐ働きだけを低めに見ています。'
    };
  }

  function geometryVolumeMm3(geometry){
    const pos = geometry && geometry.attributes && geometry.attributes.position && geometry.attributes.position.array;
    if (!pos || pos.length < 9) return 0;
    let sixVolume = 0;
    for (let i=0; i+8<pos.length; i+=9) {
      const ax=pos[i], ay=pos[i+1], az=pos[i+2];
      const bx=pos[i+3], by=pos[i+4], bz=pos[i+5];
      const cx=pos[i+6], cy=pos[i+7], cz=pos[i+8];
      sixVolume += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx);
    }
    return Math.abs(sixVolume) / 6;
  }
  function calculateOverturningCheck(sideLoadKgEquivalent){
    const svg = ensureStrengthSvgParts();
    if (!svg || !Array.isArray(geometriesCache) || !geometriesCache.length) return null;
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'));
    if (!parts.length) return null;
    const boxes = parts.map(getPart3dBox).filter(b =>
      b && ['x','y','z'].every(a => Number.isFinite(b[a].min) && Number.isFinite(b[a].max)));
    if (!boxes.length) return null;
    const minX=Math.min(...boxes.map(b=>b.x.min)), maxX=Math.max(...boxes.map(b=>b.x.max));
    const minY=Math.min(...boxes.map(b=>b.y.min)), maxY=Math.max(...boxes.map(b=>b.y.max));
    const minZ=Math.min(...boxes.map(b=>b.z.min)), maxZ=Math.max(...boxes.map(b=>b.z.max));
    const baseMm = Math.max(1, Math.min(maxX-minX, maxY-minY)); // 短い底面方向を使い安全側に見る
    const heightMm = Math.max(1, maxZ-minZ);
    const volumeMm3 = geometriesCache.reduce((sum,g)=>sum+geometryVolumeMm3(g),0);
    const massKg = volumeMm3 * (currentMaterial().densityKgM3 || 380) / 1e9;
    if (!Number.isFinite(massKg) || massKg <= 0.02) return null;
    const forceN = Math.max(0, sideLoadKgEquivalent) * 9.80665;
    const pushHeightMm = heightMm * 0.80;
    const overturnMoment = forceN * pushHeightMm;
    const restoringMoment = massKg * 9.80665 * baseMm / 2;
    const risk = Math.max(0, overturnMoment / Math.max(1e-6, restoringMoment));
    return {
      risk,
      raw:risk,
      forceN,
      massKg,
      baseMm,
      heightMm,
      pushHeightMm,
      judge:riskLabel(risk),
      note:'作品の重さと底面の短い向きから，横から上の方を押したときの転倒しやすさを概算しています。'
    };
  }

  function collectStrengthRows(forceDirection = 'top'){
    const svg = ensureStrengthSvgParts();
    if (!svg) return [];
    const totalLoadKg = strengthLoadKg();
    const material = currentMaterial();
    const normalizedDirection = normalizeForceDirection(forceDirection);
    // v12.1: 上荷重で実際に荷重を受ける候補は、大きな縦板に見えても計算対象へ残す。
    // 水平天板は getTopPlateSupportInfo() により支持天板として再評価されるため、
    // 脚で支えられた通常天板を片持ち扱いすることはない。
    const topSurfaceStateForRows = normalizedDirection === 'top' ? getTopLoadSurfaceState() : null;
    const topLoadCandidateSet = new Set(
      topSurfaceStateForRows && Array.isArray(topSurfaceStateForRows.candidates)
        ? topSurfaceStateForRows.candidates
        : []
    );
    const parts = Array.from(svg.querySelectorAll('g[data-x][id^="part-"]'))
      .filter(p => {
        if (isBottomBasePart(p)) return false;
        if (normalizedDirection === 'side') return !isBackPanelForSideLoad(p);
        if (topLoadCandidateSet.has(p)) return true;
        return !isLargeVerticalSupportPanel(p) || isTopFrameSupportPart(p);
      });
    const allocation = buildLoadAllocation(parts, totalLoadKg, forceDirection);
    const rows = parts.map((p, order) => {
        const appliedLoadKg = Math.max(0, allocation.loadMap.get(p) || 0);
        const c = calculateRiskForPart(p, appliedLoadKg, material, forceDirection);
        const judge = riskLabel(c.risk);
        return {
          index: partIndexFromEl(p),
          order,
          label: c.compositeTopCantilever ? '上部左右の片持ち側板' : (p.dataset.partLabel || p.id || `部品${order + 1}`),
          partEl: p,
          material: material.label,
          loadKg:appliedLoadKg,
          totalLoadKg,
          loadShareNote:allocation.noteMap.get(p) || '',
          ...c,
          judge
        };
      });
    if (normalizeForceDirection(forceDirection) === 'top' && allocation.unsupportedTopLoad) {
      const unsupported = {
        index:-1, order:-1, label:'本を載せる水平な棚板', partEl:null, material:material.label,
        loadKg:totalLoadKg, totalLoadKg, loadShareNote:allocation.summary || '',
        risk:1.20, raw:1.20, memberRaw:1.20, jointRaw:1.20, memberRisk:1.20, jointRisk:1.20,
        jointMethodKey:currentJointMethod().key, jointMethodLabel:currentJointMethod().label, jointMethodNote:'接合方法以前に，本を受ける水平な部材が必要です。',
        jointMethodFactor:1, jointDirectionFactor:1, supportAuto:true,
        supportNote:(allocation.topSurfaceState && allocation.topSurfaceState.reason) || '本を載せる水平な棚板が見つかりません。',
        supportKey:'unsupported_top_load', supportFactor:1, deformAxis:'z', fixedEnd:'min',
        deflectionScore:0, longMm:0, shortMm:0, slenderness:0, grainFactor:1, grainMisaligned:false, contactPenalty:1, sideFactor:1,
        forceDirection:'top', forceDirectionLabel:FORCE_DIRECTIONS.top.label, thicknessMm:0,
        supportLabel:'上からの力：本を載せる面がないため判定不能', loadN:Math.max(0,totalLoadKg)*9.80665,
        I:0, momentNmm:0, stressMpa:0, allowMpa:material.allow || 18, safetyFactor:0, deflectionMm:0, deflectionLimitMm:0,
        femNodes:[], femElements:0, failureMode:'本を載せる面がない', cantileverLike:false, attachmentLike:false, compactAttachment:false, overhangRatio:0,
        judge:riskLabel(1.20)
      };
      rows.push(unsupported);
    }
    rows.sort((a,b)=> b.risk - a.risk);
    rows.loadAllocationSummary = allocation.summary;
    return rows;
  }
  function removeStrengthOverlays(svg){
    if (!svg) return;
    svg.querySelectorAll('.strength-overlay,.strength-risk-tag').forEach(el => el.remove());
    svg.querySelectorAll('g[data-x][id^="part-"]').forEach(p => {
      p.classList.remove('strength-safe','strength-caution','strength-danger');
      delete p.dataset.strengthRisk;
      delete p.dataset.strengthJudge;
    });
  }
  function applyStrengthOverlays(rows){
    const svg = document.querySelector('#svg-container svg');
    if (!svg) return;
    removeStrengthOverlays(svg);
    const ns = 'http://www.w3.org/2000/svg';
    rows.forEach(row => {
      const p = row.partEl;
      if (!p) return;
      const w = parseFloat(p.dataset.partW || '0') || 0;
      const h = parseFloat(p.dataset.partH || '0') || 0;
      const judge = row.judge;
      p.dataset.strengthRisk = String(Math.round(row.risk * 100) / 100);
      p.dataset.strengthJudge = judge.label;
      p.classList.add(`strength-${judge.cls}`);

      const overlay = document.createElementNS(ns, 'rect');
      overlay.setAttribute('class', `strength-overlay strength-${judge.cls}`);
      overlay.setAttribute('x', '0');
      overlay.setAttribute('y', '0');
      overlay.setAttribute('width', String(w));
      overlay.setAttribute('height', String(h));
      overlay.setAttribute('rx', '2');
      overlay.setAttribute('ry', '2');
      overlay.setAttribute('pointer-events', 'none');
      p.insertBefore(overlay, p.firstChild);

      const tag = document.createElementNS(ns, 'text');
      tag.setAttribute('class', `strength-risk-tag strength-${judge.cls}`);
      tag.setAttribute('x', String(Math.max(4, w - 42)));
      tag.setAttribute('y', '13');
      tag.setAttribute('pointer-events', 'none');
      tag.textContent = judge.label;
      p.appendChild(tag);
    });
  }
  function buildStrengthReportHtml(rows, options = {}){
    const forceDirection = normalizeForceDirection(options.forceDirection || ((rows && rows[0] && rows[0].forceDirection) || 'top'));
    const directionInfo = FORCE_DIRECTIONS[forceDirection];
    const loadKg = strengthLoadKg();
    const material = currentMaterial();
    const support = currentSupport();
    const loadN = loadKg * 9.80665;
    const thicknessStats = collectInferredThicknessStats();
    const thicknessInfo = thicknessMode() === 'stl' && thicknessStats
      ? `STL推定 中央値${formatDim(thicknessStats.median)}${unitLabel()}（範囲 ${formatDim(thicknessStats.min)}〜${formatDim(thicknessStats.max)}${unitLabel()}）`
      : `手入力 ${formatDim(manualThicknessMm())}${unitLabel()}`;
    const joint = currentJointMethod();
    const items = (rows || []).map(r => {
      const grainNote = r.grainMisaligned || r.grainFactor > 1 ? '木目の向きに注意。木取り図で回転すると改善することがあります。' : '木目の向きはよさそうです。';
      const jointNote = r.jointRisk > r.memberRisk ? `接合部の注意が大きめです。${escapeHtml(r.jointMethodNote)}` : escapeHtml(r.jointMethodNote);
      const supportNote = r.supportAuto ? `<br><span class="sub">支え方：${escapeHtml(r.supportLabel)}。${escapeHtml(r.supportNote)}</span>` : '';
      const cantileverNote = r.cantileverLike ? `<br><span class="sub">片側で支える形なので，付け根の接合部も注意して見ています。</span>` : '';
      const attachmentNote = r.attachmentLike ? `<br><span class="sub">大きな板に小部品が片側だけで付いているため，付け根の接合部を強めに見ています。</span>` : '';
      const loadShareText = forceDirection === 'side' ? `この部品が受ける横力：約${r.loadN.toFixed(0)}N` : `この部品に分けた重さ：約${r.loadKg.toFixed(2)}kg`;
      const contactNote = r.contactPenalty > 1.15 ? '<br><span class="sub">接している面が小さいため，つなぎ目を少し厳しく見ています。</span>' : '';
      const modeNote = r.failureMode ? `<br><span class="sub">主に見ている現象：${escapeHtml(r.failureMode)}</span>` : '';
      const note = `${grainNote}<br><span class="sub">${loadShareText}。${escapeHtml(r.loadShareNote || '')}</span><br><span class="sub">${jointNote}</span>${supportNote}${cantileverNote}${attachmentNote}${contactNote}${modeNote}`;
      const sf = r.safetyFactor >= 99 ? '99+' : r.safetyFactor.toFixed(1);
      const thicknessText = r.supportKey === 'unsupported_top_load'
        ? '―<br><span class="sub">水平な棚板なし</span>'
        : `${Math.round(mmToDisplay(r.longMm))}×${Math.round(mmToDisplay(r.shortMm))}×${formatDim(r.thicknessMm)}${unitLabel()}<br><span class="sub">${escapeHtml(thicknessSourceLabel(r.partEl))}</span>`;
      const jointText = `${escapeHtml(r.jointMethodLabel)}<br><span class="sub">接合リスク ${Math.round(r.jointRisk*100)}%</span>`;
      return `<tr class="strength-row-${r.judge.cls}"><td>${escapeHtml(r.label)}</td><td><b>${r.judge.label}</b></td><td>${thicknessText}</td><td>${formatDim(r.deflectionMm)}${unitLabel()}<br><span class="sub">目安 ${formatDim(r.deflectionLimitMm)}${unitLabel()}まで</span></td><td>${r.stressMpa.toFixed(1)}MPa<br><span class="sub">材料の目安 ${r.allowMpa.toFixed(1)}MPa</span></td><td>${sf}</td><td>${jointText}</td><td>${note}</td></tr>`;
    }).join('');
    const conditionText = forceDirection === 'side'
      ? `横から押す力：約${loadN.toFixed(0)}N（約${loadKg.toFixed(1)}kg重）`
      : `本${Math.round(num('book-count',10))}冊 × ${num('book-weight',0.5).toFixed(2)}kg = 約${loadKg.toFixed(1)}kg（約${loadN.toFixed(0)}N）`;
    const allocationText = (rows && rows.loadAllocationSummary) || '';
    const overturn = forceDirection === 'side' ? calculateOverturningCheck(loadKg) : null;
    const topLoadCheck = forceDirection === 'top' ? calculateTopLoadSupportCheck(loadKg) : null;
    const overturnHtml = overturn
      ? `<div class="global-check ${overturn.judge.cls}"><b>作品全体の転倒：</b>${overturn.judge.label}　<span class="sub">作品の重さ 約${overturn.massKg.toFixed(2)}kg／底面 約${Math.round(mmToDisplay(overturn.baseMm))}${unitLabel()}／押す高さ 約${Math.round(mmToDisplay(overturn.pushHeightMm))}${unitLabel()}。${escapeHtml(overturn.note)}</span></div>`
      : '';
    const topLoadHtml = topLoadCheck && !topLoadCheck.supported
      ? `<div class="global-check danger"><b>本を載せる面：</b>見直したい　<span class="sub">${escapeHtml(topLoadCheck.note)}</span></div>`
      : '';
    return `<div class="strength-summary"><b>${directionInfo.label}：</b>${directionInfo.description}<br><b>いまの条件：</b>${conditionText}<br><b>材料：</b>${material.label}　<b>支え方：</b>${support.label}　<span class="sub">（通常はSTL形状から自動で見ます）</span>　<b>板の厚さ：</b>${thicknessInfo}<br><b>接合：</b>${joint.label}（${joint.note}）<br><span class="sub">${escapeHtml(allocationText)}</span></div>
      ${topLoadHtml}
      ${overturnHtml}
      <table class="strength-table"><thead><tr><th>部品</th><th>結果</th><th>大きさ</th><th>曲がりやすさ</th><th>負担の目安</th><th>余裕</th><th>接合</th><th>ひとこと</th></tr></thead><tbody>${items || '<tr><td colspan="8">部品がありません。</td></tr>'}</tbody></table>
      <div class="sub">※これは設計を比べるための授業用予想で，実物の安全を保証するものではありません。材料はスギ相当の代表値で固定し，総荷重はSTL形状から各部品へ自動で分けています。節・割れ・含水率，接着剤の種類，釘の太さ・長さ・本数，作り方で実際の強さは変わります。</div>`;
  }

  function renderStrengthInfo(){
    const el = document.getElementById('strengthInfo');
    const svg = document.querySelector('#svg-container svg');
    if (!svg || !svg.querySelector('g[data-x][id^="part-"]')) {
      if (el) el.innerHTML = 'STLを読み込むと，部品ごとの簡易強度判定を表示できます。';
      return [];
    }
    const rows = collectStrengthRows('top');
    applyStrengthOverlays(rows);
    if (el) el.innerHTML = buildStrengthReportHtml(rows, {forceDirection:'top'});
    return rows;
  }

  function base64FromArrayBuffer(buf){
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 8192;
    for(let i=0; i<bytes.length; i+=chunk){
      binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
    }
    return btoa(binary);
  }

  function getStrengthRisksByIndex(rows){
    const maxIdx = rows.reduce((m,r)=>Math.max(m, Number.isFinite(r.index)?r.index:-1), -1);
    const risks = Array.from({length: Math.max(0, maxIdx + 1)}, () => ({risk:0, judge:'余裕あり'}));
    rows.forEach(r => {
      if (r.index >= 0) risks[r.index] = { risk:r.risk, raw:r.raw || 0, judge:r.judge.label, label:r.label, appliedLoadKg:r.loadKg || 0, deflectionScore:r.deflectionScore, femNodes:r.femNodes || [], femElements:r.femElements || 0, supportKey: r.supportKey || currentSupport().key, forceDirection:r.forceDirection || 'top', deformAxis:r.deformAxis || '', fixedEnd:r.fixedEnd || 'min' };
    });
    return risks;
  }

  window.runStrengthCheck = function(){
    try {
      return renderStrengthInfo();
    } catch (e) {
      const el = document.getElementById('strengthInfo');
      const msg = '簡易FEM解析の実行中にエラーが発生しました：' + (e && e.message ? e.message : e);
      if (el) el.innerHTML = '<div class=\"warning-text\">' + escapeHtml(msg) + '</div><div class=\"sub\">STLを読み込み直すか，板厚を「手入力」に切り替えて再実行してください。</div>';
      console.error(e);
      return [];
    }
  };



  function showStrengthIntroPopup(onOk){
    const old = document.getElementById('strength-intro-modal');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'strength-intro-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:18px;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="width:min(680px,94vw);background:#fff;color:#222;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.32);padding:24px 28px;text-align:left;line-height:1.8;">
        <h2 style="margin:0 0 12px 0;font-size:20px;color:#0b57d0;">強度を確認する前に</h2>
        <p style="margin:0 0 8px 0;font-weight:700;">これは設計を比べるための授業用シミュレーションです。</p>
        <p style="margin:0 0 8px 0;">接合の違いは，接着剤だけ・釘だけ・接着剤＋釘で力の受け方が変わることを見せるための目安です。</p>
        <p style="margin:0 0 8px 0;">材料はスギ相当の代表値で計算します。実際の強さは，節・割れ・水分，接着剤や釘，作り方で変わり，安全を保証するものではありません。</p>
        <p style="margin:0 0 12px 0;">木目の向きで注意になった部品は，木取り図で右クリック／ダブルクリックして回転し，もう一度「強度を確認」を押すと結果と3D表示が更新されます。</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px;">
          <button id="strength-intro-cancel" type="button" style="padding:10px 18px;border:1px solid #bbb;background:#f5f5f5;border-radius:8px;font-weight:700;cursor:pointer;">戻る</button>
          <button id="strength-intro-ok" type="button" style="padding:10px 26px;border:none;background:#0b57d0;color:#fff;border-radius:8px;font-weight:800;cursor:pointer;">確認して強度を確認</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close(); });
    const cancel = overlay.querySelector('#strength-intro-cancel');
    const ok = overlay.querySelector('#strength-intro-ok');
    if (cancel) cancel.addEventListener('click', close);
    if (ok) ok.addEventListener('click', ()=>{ close(); if (typeof onOk === 'function') onOk(); });
  }


  // 強度画面HTMLの受け渡し専用ストレージ。
  // 画面内容・計算処理には触れず、sessionStorageの容量不足だけを回避する。
  async function saveStrengthHtmlForTransition(html){
    const DB_NAME = 'kidorin_strength_screen_db';
    const STORE = 'screens';
    const KEY = 'current';
    if (!window.indexedDB) {
      sessionStorage.setItem('kidorin_strength_html', html);
      return;
    }
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
        tx.objectStore(STORE).put(html, KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('強度画面を保存できませんでした'));
        tx.onabort = () => reject(tx.error || new Error('強度画面の保存が中断されました'));
      });
      // 古い小容量版が残っている場合は誤読を防ぐ。
      try { sessionStorage.removeItem('kidorin_strength_html'); } catch(e) {}
    } finally {
      db.close();
    }
  }

  window.openStrengthWindow = window.openStrength3dWindow = function(skipIntro){
    let suppressIntro = !!skipIntro;
    try{
      if(sessionStorage.getItem('kidorin_strength_skip_intro')==='1') suppressIntro=true;
      sessionStorage.removeItem('kidorin_strength_skip_intro');
    }catch(e){}
    if (!stlArrayBufferCache) {
      alert('先にSTLファイルを読み込んでください。');
      return;
    }
    // 強度確認の説明は，画面遷移後に強度確認画面内で表示する。
    const rowsTop = collectStrengthRows('top');
    const rowsSide = collectStrengthRows('side');
    // 強度確認は別画面内で表示するため，木取り図本体には色や判定マークを残さない。
    const riskSets = { top: getStrengthRisksByIndex(rowsTop), side: getStrengthRisksByIndex(rowsSide) };
    const reports = { top: buildStrengthReportHtml(rowsTop, {forceDirection:'top'}), side: buildStrengthReportHtml(rowsSide, {forceDirection:'side'}) };
    const globalRiskSets = { top:calculateTopLoadSupportCheck(strengthLoadKg()), side:(calculateOverturningCheck(strengthLoadKg()) || {risk:0, unavailable:true}) };
    const loadKg = strengthLoadKg();
    const material = currentMaterial();
    const b64 = base64FromArrayBuffer(stlArrayBufferCache);
    const reportHtml = reports.top;
    const paramSnapshot = {
      bookCount: Math.round(num('book-count',10)),
      bookWeight: num('book-weight',0.5),
      thicknessMode: thicknessMode(),
      memberThickness: manualThicknessMm(),
      materialKey:'sugi',
      supportKey: currentSupport().key,
      femElements:16,
      jointMethod: currentJointMethod().key
    };

    const htmlDoc = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="tsuyoin-render-version" content="12.1"><title>強度確認 - きどりん</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:#151827;color:#fff;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans JP",sans-serif}body{--panel-w:clamp(330px,31vw,400px)}#canvas-wrap{position:absolute;left:calc(var(--panel-w) + 28px);right:0;top:0;bottom:0}canvas{display:block;width:100%!important;height:100%!important}.viewer-head{position:absolute;left:18px;top:16px;right:18px;z-index:10;background:#0f172a;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:12px 14px;backdrop-filter:blur(8px);box-shadow:0 8px 24px rgba(0,0,0,.25)}.viewer-head h1{font-size:22px;margin-bottom:6px}.viewer-head p{font-size:13px;line-height:1.6;color:rgba(255,255,255,.9)}.big-result{margin-top:8px;padding:10px 12px;border-radius:12px;font-size:20px;font-weight:900;letter-spacing:.02em;text-align:center;background:#ecfdf5;color:#052e16;border:3px solid #16a34a;text-shadow:none}.big-result.caution{background:#fffbeb;color:#78350f;border-color:#d97706}.big-result.danger{background:#fef2f2;color:#7f1d1d;border-color:#dc2626}.big-result .force-display{display:block;margin-top:5px;font-size:14px;line-height:1.35;font-weight:900;letter-spacing:0;color:inherit}.panel{position:absolute;left:14px;top:14px;bottom:14px;width:var(--panel-w);overflow:hidden;background:rgba(10,15,30,.86);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);border-radius:12px;padding:12px 14px;box-shadow:0 8px 28px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px}.panel h2{font-size:16px;margin-bottom:7px}.panel p{font-size:12px;line-height:1.6;color:rgba(255,255,255,.82)}.legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}.chip{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:700}.dot{width:13px;height:13px;border-radius:50%;display:inline-block}.safe{background:#22c55e}.caution{background:#f59e0b}.danger{background:#ef4444}.controls{position:absolute;right:18px;bottom:18px;display:none;gap:8px;align-items:center;background:rgba(10,15,30,.78);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:10px;z-index:12}.controls button{padding:7px 12px;border:0;border-radius:8px;cursor:pointer;font-weight:700}.controls label{font-size:12px;display:flex;align-items:center;gap:6px}.controls input{width:120px}.load-test-box{min-width:300px}.load-test-main{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800}.load-test-main input{width:170px}.load-test-readout{margin-top:5px;font-size:12px;line-height:1.45;color:rgba(255,255,255,.88)}.load-test-readout b{font-size:15px}.load-test-readout .break{color:#fecaca;font-weight:900}.load-test-readout .safeText{color:#bbf7d0;font-weight:800}.load-test-readout .cautionText{color:#fde68a;font-weight:800}.note{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);font-size:11px;color:rgba(255,255,255,.55);white-space:nowrap}.label{position:absolute;pointer-events:none;background:rgba(0,0,0,.68);border:1px solid rgba(255,255,255,.4);padding:4px 7px;border-radius:6px;font-size:12px;white-space:nowrap;transform:translate(-50%,-50%)}.strength-intro-overlay{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:18px}.strength-intro-card{width:min(720px,94vw);background:#fff;color:#222;border-radius:14px;box-shadow:0 18px 54px rgba(0,0,0,.42);padding:24px 28px;text-align:left;line-height:1.8}.strength-intro-card h2{margin:0 0 12px 0;font-size:20px;color:#0b57d0}.strength-intro-card p{margin:0 0 8px 0;font-size:15px}.strength-intro-card .lead{font-weight:800}.strength-intro-card button{padding:10px 28px;border:none;background:#0b57d0;color:#fff;border-radius:8px;font-weight:900;cursor:pointer;font-size:15px}#viewerStatus{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);z-index:5;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:10px 14px;color:#fff;font-size:13px}.strength-summary{font-size:12px;line-height:1.6;margin:8px 0 10px;color:rgba(255,255,255,.9)}.strength-table{width:100%;min-width:720px;border-collapse:collapse;font-size:11px;background:rgba(255,255,255,.96);color:#111;border-radius:8px;overflow:hidden}.strength-table th,.strength-table td{border:1px solid rgba(0,0,0,.14);padding:5px 6px;vertical-align:top}.panel #report{display:none!important;overflow:auto;max-width:100%;max-height:26vh;padding-bottom:4px;margin-bottom:10px;border-radius:8px}.panel #report::-webkit-scrollbar{height:8px}.panel #report::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:8px}.strength-table th{background:#eef2ff}.strength-row-safe td{background:#ecfdf5}.strength-row-caution td{background:#fffbeb}.strength-row-danger td{background:#fef2f2}.sub{font-size:10px;color:#666}.direction-tabs{display:none;gap:8px;margin:10px 0 0}.direction-tabs button{flex:1;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:8px 6px;background:rgba(255,255,255,.12);color:#fff;font-weight:700;cursor:pointer}.direction-tabs button.active{background:#2563eb}.param-box{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:8px;margin:10px 0}.param-box label{display:grid;grid-template-columns:minmax(88px,1fr) minmax(120px,1.2fr);gap:6px;align-items:center;font-size:11px;margin:4px 0}.param-box input,.param-box select{width:100%;padding:4px;border-radius:5px;border:1px solid #ccc}.param-box button{width:100%;padding:7px 10px;border:0;border-radius:7px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer;margin-top:6px}.fixed-param{font-size:10px;line-height:1.45;color:rgba(255,255,255,.78);background:rgba(255,255,255,.07);border-radius:6px;padding:5px 7px;margin:5px 0}.global-check{border:2px solid #22c55e;background:#ecfdf5;color:#111;border-radius:8px;padding:7px 9px;margin:7px 0;font-size:12px}.global-check.caution{border-color:#f59e0b;background:#fffbeb}.global-check.danger{border-color:#ef4444;background:#fef2f2}.strength-file-box{background:rgba(37,99,235,.12);border:1px dashed rgba(147,197,253,.75);border-radius:8px;padding:8px;margin:10px 0}.strength-file-box label{display:block;font-size:12px;font-weight:800;margin-bottom:5px}.strength-file-box input{width:100%;font-size:12px}.strength-file-box .hint{font-size:10px;line-height:1.45;color:rgba(255,255,255,.72);margin-top:4px}#closeTop{background:#22c55e;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 4px 14px rgba(34,197,94,.35)}.head-title-row{display:flex;align-items:center;gap:12px;margin-bottom:6px}.head-title-row h1{margin:0}#toggle{background:#0b57d0;color:#fff}@media(max-width:900px){#canvas-wrap{left:0;top:44%;}.panel{width:auto;right:14px;bottom:56%;}.viewer-head{left:12px;right:12px;top:10px;padding:10px}.viewer-head h1{font-size:18px}.viewer-head p{font-size:12px}.big-result{font-size:18px;padding:8px}.controls{left:12px;right:12px;justify-content:center;flex-wrap:wrap}.strength-table{min-width:680px}}canvas{touch-action:none}.tsuyoin-title-badge{display:inline-flex;align-items:center;padding:10px 14px;border-radius:10px;background:#f97316;color:#fff;font-size:18px;font-weight:900;box-shadow:0 4px 14px rgba(249,115,22,.28)}@media(max-height:780px){.panel{top:8px;bottom:8px;width:360px;padding:10px}.panel h2{font-size:14px}.panel p,.strength-summary{font-size:11px}.param-box label{font-size:10px;grid-template-columns:88px 1fr}.viewer-head{top:8px;left:10px;right:10px;padding:8px 10px}.viewer-head h1{font-size:19px}.viewer-head p{font-size:11px}.legend{margin-top:4px}.big-result{font-size:19px;padding:7px}.direction-tabs{margin-top:6px}.direction-tabs button{padding:6px}.controls{right:10px;bottom:10px;padding:7px;gap:6px}.load-test-box{min-width:250px}.load-test-main input{width:130px}.controls label input{width:90px}#canvas-wrap{left:385px}.panel #report{max-height:32vh}.strength-file-box{padding:6px;margin:6px 0}.param-box{padding:6px;margin:6px 0}}@media(max-width:1180px){#canvas-wrap{left:370px}.panel{width:350px}.strength-table{min-width:620px}.controls{max-width:calc(100vw - 390px);flex-wrap:wrap}.load-test-box{min-width:240px}}@media(pointer:coarse){button,input,select{min-height:36px}.direction-tabs button{min-height:40px}.controls{padding:10px}.controls input[type=range]{height:30px}.panel{overflow:auto;-webkit-overflow-scrolling:touch}}
#canvas-wrap{left:calc(var(--panel-w) + 28px);top:0;bottom:0}.panel{right:auto;bottom:14px;width:var(--panel-w);overflow:hidden}.student-report-button{display:block;width:100%;min-height:42px;border:2px solid #93c5fd;border-radius:10px;background:#1d4ed8;color:#fff;font-size:14px;font-weight:900;cursor:pointer;padding:8px 12px;margin-bottom:7px}.panel .strength-file-box{margin-top:auto}@media(max-height:720px){#canvas-wrap{top:0}.viewer-head{padding:8px 10px;top:8px;left:10px;right:10px}.viewer-head h1{font-size:18px}.viewer-head p,.legend{display:none}.big-result{font-size:16px;padding:7px 9px}.big-result .force-display{font-size:12px}.panel{top:8px;bottom:8px;padding:8px 10px;gap:5px}.student-report-button{min-height:36px;font-size:12px;padding:6px 9px}.strength-file-box{display:none}}@media(max-width:850px){body{--panel-w:320px}#canvas-wrap{left:348px;top:0}.panel{left:8px;right:auto;top:8px;bottom:8px;width:320px;overflow:hidden}.viewer-head p{font-size:11px}.big-result{font-size:16px}.viewer-head{left:10px;right:10px}.note{display:none}}@media(max-width:700px){body{--panel-w:300px}#canvas-wrap{left:324px;top:0}.panel{width:300px}.viewer-head .legend,.viewer-head p{display:none}} </style></head><body><div id="canvas-wrap"><canvas id="c"></canvas><div id="viewerStatus">3Dモデルを読み込んでいます…</div><div class="viewer-head"><div class="head-title-row"><button id="closeTop" onclick="parent.closeStrengthPage && parent.closeStrengthPage()">最初に戻る</button><h1>強度確認</h1></div><p>本を載せたときや，横から押されたときに，どの部品が曲がりやすいかを予想します。緑は計算上の余裕あり，黄色は確かめたい，赤は見直したいです。</p><div class="legend"><span class="chip"><span class="dot safe"></span>余裕あり</span><span class="chip"><span class="dot caution"></span>確かめたい</span><span class="chip"><span class="dot danger"></span>見直したい</span></div><div id="bigResult" class="big-result"><span class="judge-text">判定：計算上は余裕がありそう</span><span id="forceLevelDisplay" class="force-display">ふつう　5kg（技術の教科書約10冊分）</span></div><div class="direction-tabs"><button id="dirTop" class="active" type="button">上から</button><button id="dirLeft" type="button">左から</button><button id="dirRight" type="button">右から</button></div></div></div>
<div class="panel"><h2>判定結果</h2><div id="report"></div><div class="strength-file-box"><label for="strengthStlInput">別のSTLを読み込む</label><input id="strengthStlInput" type="file" accept=".stl"><div class="hint">ここで読み込んだSTLは木取り画面にも反映されます。</div></div><h2>条件を変えて試す</h2><p>重さ・板厚・支え方・つなぎ方だけを変えて比べます。材料はスギ相当で固定です。</p><div class="param-box"><b style="font-size:12px">詳しい条件</b><div class="fixed-param">材料：スギ相当（教材用）／解析：16分割（固定）</div><label>本の冊数<input id="pBookCount" type="number" min="0" step="1"></label><label>1冊の重さ(kg)<input id="pBookWeight" type="number" min="0" step="0.1"></label><label>板厚<select id="pThicknessMode"><option value="stl">STLから推定</option><option value="manual">手入力</option></select></label><label>手入力板厚(mm)<input id="pMemberThickness" type="number" min="1" step="1"></label><label>支え方<select id="pSupport"><option value="auto">STL形状から自動判定</option><option value="simple_center">両端で支える・真ん中に本</option><option value="simple_uniform">両端で支える・全体に本</option><option value="cantilever">片側だけ固定</option></select></label><label>接合方法<select id="pJoint"><option value="glue">接着剤のみ</option><option value="nails">釘のみ</option><option value="glue_nails">接着剤＋釘</option></select></label><input id="pMaterial" type="hidden" value="sugi"><input id="pFem" type="hidden" value="16"><button id="rerun" type="button">この条件で見直す</button></div></div>
<div class="controls"><button id="toggle">一時停止</button><div class="load-test-box"><div class="load-test-main"><span id="loadTestTitle">上にのせる重さ</span><input id="loadSlider" type="range" min="0" max="30" step="0.5" value="0"><span id="loadKgLabel">0.0kg</span></div><div id="loadTestReadout" class="load-test-readout">荷重を上げると，色・判定・曲がり方が変わります。</div></div><label>変形倍率 <input id="amp" type="range" min="0" max="3" step="0.1" value="1.4"></label><button id="reset">視点リセット</button></div>${suppressIntro ? '' : '<div id="strengthIntroInPage" class="strength-intro-overlay"><div class="strength-intro-card"><h2>強度確認の前に</h2><p class="lead">これは設計を比べるための授業用シミュレーションです。</p><p>接合の違いは，接着剤だけ・釘だけ・接着剤＋釘で力の受け方が変わることを見せるための目安です。</p><p>材料はスギ相当の代表値で計算します。実際の強さは，節・割れ・水分，接着剤や釘，作り方で変わり，安全を保証するものではありません。</p><p>木目の向きで注意になった部品は，木取り図で右クリック／ダブルクリックして回転し，もう一度「強度を確認」を押すと結果と3D表示が更新されます。</p><div style="text-align:right;margin-top:18px"><button id="strengthIntroClose" type="button">確認してはじめる</button></div></div></div>'}<div class="note">左ドラッグ：回転　右ドラッグ：移動　ホイール：ズーム　※授業用に曲がり方を大きく見せています</div>
<script src="https://unpkg.com/three@0.128.0/build/three.min.js"></script><script src="https://unpkg.com/three@0.128.0/examples/js/loaders/STLLoader.js"></script>
<script>
const b64=${JSON.stringify(b64)};
const RISK_SETS=${JSON.stringify(riskSets)};
const GLOBAL_RISK_SETS=${JSON.stringify(globalRiskSets)};
const BASE_RISK_SETS=JSON.parse(JSON.stringify(RISK_SETS));
const BASE_GLOBAL_RISK_SETS=JSON.parse(JSON.stringify(GLOBAL_RISK_SETS));
let FORCE_DIR='top';
let LOAD_TEST_KG=0;
let RISKS=RISK_SETS[FORCE_DIR]||[];
let GLOBAL_RISK=GLOBAL_RISK_SETS[FORCE_DIR]||{risk:0};
const REPORTS=${JSON.stringify(reports)};
const REPORT_HTML=REPORTS[FORCE_DIR]||${JSON.stringify(reportHtml)};
const PARAMS=${JSON.stringify(paramSnapshot)};
const BASE_LOAD_KG=Math.max(0.1,(Number(PARAMS.bookCount)||0)*(Number(PARAMS.bookWeight)||0));
const SUPPORT_KEY=PARAMS.supportKey || 'simple_center';const JOINT_METHOD=PARAMS.jointMethod||'glue_nails';
const reportEl=document.getElementById('report');const bigResultEl=document.getElementById('bigResult');
function riskKeyForDir(dir){return (dir==='left'||dir==='right')?'side':'top';}
function scaledRisksForKey(key){const base=BASE_RISK_SETS[key]||[];const kg=Math.max(0,LOAD_TEST_KG);const scale=kg/BASE_LOAD_KG;return base.map(r=>{if(!r)return r;const nr=Object.assign({},r);nr.baseRisk=r.risk||0;nr.risk=(r.risk||0)*scale;nr.loadScale=scale;return nr;});}
function scaledGlobalRiskForKey(key){const base=BASE_GLOBAL_RISK_SETS[key]||{risk:0};const scale=Math.max(0,LOAD_TEST_KG)/BASE_LOAD_KG;const out=Object.assign({},base);out.baseRisk=Number(base.risk)||0;out.risk=out.baseRisk*scale;out.loadScale=scale;return out;}
function maxRiskOf(list){let maxRisk=0;(list||[]).forEach(r=>{maxRisk=Math.max(maxRisk,r&&Number.isFinite(r.risk)?r.risk:0)});maxRisk=Math.max(maxRisk,GLOBAL_RISK&&Number.isFinite(GLOBAL_RISK.risk)?GLOBAL_RISK.risk:0);return maxRisk;}
function highestMemberRisk(){let best=null;(RISKS||[]).forEach(r=>{if(!r||!Number.isFinite(r.risk))return;if(!best||r.risk>best.risk)best=r;});return best;}
function riskClass(v){return v>=.72?'danger':(v>=.42?'caution':'safe');}
function overallJudge(){const member=highestMemberRisk();const memberRisk=member&&Number.isFinite(member.risk)?member.risk:0;const globalRisk=GLOBAL_RISK&&Number.isFinite(GLOBAL_RISK.risk)?GLOBAL_RISK.risk:0;const combined=Math.max(memberRisk,globalRisk);const side=FORCE_DIR==='left'||FORCE_DIR==='right';let text='判定：計算上は余裕がありそう';if(combined>=1)text='判定：計算上の目安を超えています';else if(combined>=.72)text='判定：設計を見直したい';else if(combined>=.42)text='判定：設計を確かめたい';if(side&&globalRisk>=.42&&memberRisk>=.42){text=globalRisk>=1||memberRisk>=1?'判定：部材・接合部と転倒に注意（計算上の目安超過）':'判定：部材・接合部と転倒を見直したい';}else if(side&&globalRisk>=.42){text=globalRisk>=1?'判定：転倒に注意（計算上の目安超過）':'判定：転倒を確かめたい';}else if(side&&memberRisk>=.42){text=memberRisk>=1?'判定：部材・接合部に注意（計算上の目安超過）':'判定：部材・接合部を見直したい';}return {text:text,cls:riskClass(combined),member:member,memberRisk:memberRisk,globalRisk:globalRisk};}
function loadLevelText(kg){return kg<=3?'軽い':(kg<=7?'ふつう':'重い')}function textbookCount(kg){return Math.max(0,Math.round((Number(kg)||0)/0.5))}function setBigResult(){if(!bigResultEl)return;const j=overallJudge();let detail='';const side=FORCE_DIR==='left'||FORCE_DIR==='right';if(side){const mcls=riskClass(j.memberRisk),gcls=riskClass(j.globalRisk);const mlabel=mcls==='danger'?'見直したい':(mcls==='caution'?'確かめたい':'余裕あり');const glabel=gcls==='danger'?'目安超過':(gcls==='caution'?'確かめたい':'余裕あり');const memberName=j.member&&j.member.label?j.member.label:'部材';detail='<span class="force-display">部材・接合部：'+mlabel+(j.member&&j.member.label?'（'+memberName+'）':'')+'　／　作品全体：'+glabel+'</span>';}
bigResultEl.innerHTML='<span class="judge-text">'+j.text+'</span><span id="forceLevelDisplay" class="force-display">'+loadLevelText(LOAD_TEST_KG)+'　'+LOAD_TEST_KG.toFixed(1).replace(/\.0$/,'')+'kg（技術の教科書約'+textbookCount(LOAD_TEST_KG)+'冊分）</span>'+detail;bigResultEl.className='big-result '+(j.cls==='safe'?'':j.cls);}function updateLoadTestReadout(){const slider=document.getElementById('loadSlider');const kgLabel=document.getElementById('loadKgLabel');const title=document.getElementById('loadTestTitle');const out=document.getElementById('loadTestReadout');const side=FORCE_DIR==='left'||FORCE_DIR==='right';const forceN=LOAD_TEST_KG*9.80665;if(title)title.textContent=side?'横から押す力':'上にのせる重さ';if(kgLabel)kgLabel.textContent=side?forceN.toFixed(0)+'N':LOAD_TEST_KG.toFixed(1)+'kg';const maxRisk=maxRiskOf(RISKS);let cls='safeText',msg='計算上は余裕がありそうです。';if(maxRisk>=1){cls='break';msg='計算上の目安を超えています。設計を見直してください。';}else if(maxRisk>=.72){cls='break';msg='設計を見直したい範囲です。';}else if(maxRisk>=.42){cls='cautionText';msg='設計を確かめたい範囲です。';}const amount=side?'<b>'+forceN.toFixed(0)+'N</b>（約'+LOAD_TEST_KG.toFixed(1)+'kg重）':'<b>'+LOAD_TEST_KG.toFixed(1)+'kg</b>（本で約 '+(LOAD_TEST_KG/Math.max(0.1,Number(PARAMS.bookWeight)||0.5)).toFixed(0)+'冊分）';if(out)out.innerHTML=amount+'　<span class="'+cls+'">'+msg+'</span>';if(slider){let threshold=Infinity;const key=riskKeyForDir(FORCE_DIR);const base=BASE_RISK_SETS[key]||[];base.forEach(r=>{const br=r&&r.risk?Number(r.risk):0;if(br>0)threshold=Math.min(threshold,BASE_LOAD_KG/br);});const gbr=BASE_GLOBAL_RISK_SETS[key]&&Number(BASE_GLOBAL_RISK_SETS[key].risk);if(gbr>0)threshold=Math.min(threshold,BASE_LOAD_KG/gbr);const maxKg=Math.min(60,Math.max(BASE_LOAD_KG*2,Number.isFinite(threshold)?threshold*1.3:30,10));if(Math.abs(Number(slider.max)-maxKg)>0.5)slider.max=String(Math.ceil(maxKg));}}
function refreshScaledRisks(){const key=riskKeyForDir(FORCE_DIR);RISKS=scaledRisksForKey(key);GLOBAL_RISK=scaledGlobalRiskForKey(key);setBigResult();updateLoadTestReadout();if(window.updateStrengthScene)window.updateStrengthScene();}
function setReport(dir){FORCE_DIR=(dir==='left'||dir==='right')?dir:'top';const key=riskKeyForDir(FORCE_DIR);if(reportEl)reportEl.innerHTML=REPORTS[key]||'';const dt=document.getElementById('dirTop'),dl=document.getElementById('dirLeft'),dr=document.getElementById('dirRight');if(dt)dt.classList.toggle('active',FORCE_DIR==='top');if(dl)dl.classList.toggle('active',FORCE_DIR==='left');if(dr)dr.classList.toggle('active',FORCE_DIR==='right');refreshScaledRisks();}if(reportEl)reportEl.innerHTML=REPORT_HTML;['pBookCount','pBookWeight','pThicknessMode','pMemberThickness','pMaterial','pSupport','pJoint','pFem'].forEach(id=>{});document.getElementById('pBookCount').value=PARAMS.bookCount;document.getElementById('pBookWeight').value=PARAMS.bookWeight;document.getElementById('pThicknessMode').value=PARAMS.thicknessMode;document.getElementById('pMemberThickness').value=PARAMS.memberThickness;document.getElementById('pMaterial').value=PARAMS.materialKey;document.getElementById('pSupport').value=PARAMS.supportKey;document.getElementById('pJoint').value=PARAMS.jointMethod||'glue_nails';document.getElementById('pFem').value=PARAMS.femElements;const dt0=document.getElementById('dirTop'),dl0=document.getElementById('dirLeft'),dr0=document.getElementById('dirRight');if(dt0)dt0.onclick=()=>setReport('top');if(dl0)dl0.onclick=()=>setReport('left');if(dr0)dr0.onclick=()=>setReport('right');const loadSlider=document.getElementById('loadSlider');if(loadSlider){LOAD_TEST_KG=BASE_LOAD_KG;loadSlider.value=String(LOAD_TEST_KG);loadSlider.oninput=()=>{LOAD_TEST_KG=Number(loadSlider.value)||0;refreshScaledRisks();};}refreshScaledRisks();document.getElementById('rerun').onclick=()=>{try{const d=parent.document;d.getElementById('book-count').value=document.getElementById('pBookCount').value;d.getElementById('book-weight').value=document.getElementById('pBookWeight').value;d.getElementById('thickness-mode').value=document.getElementById('pThicknessMode').value;d.getElementById('member-thickness').value=document.getElementById('pMemberThickness').value;d.getElementById('strength-material').value='sugi';d.getElementById('support-condition').value=document.getElementById('pSupport').value;d.getElementById('joint-method').value=document.getElementById('pJoint').value;d.getElementById('fem-elements').value='16';if(parent.openStrengthWindow)parent.openStrengthWindow(true);}catch(e){alert('再計算に失敗しました: '+e.message)}};
const strengthStlInput=document.getElementById('strengthStlInput');
if(strengthStlInput){
  strengthStlInput.onchange=async()=>{
    const file=strengthStlInput.files && strengthStlInput.files[0];
    if(!file)return;
    try{
      const status=document.getElementById('viewerStatus');
      if(status){status.style.display='block';status.textContent='STLを読み込み直しています…';}
      if(parent && parent.loadStlFileFromStrength){
        await parent.loadStlFileFromStrength(file);
        if(parent.openStrengthWindow){parent.openStrengthWindow(true);}
      }else{
        alert('親画面へSTLを反映できませんでした。');
      }
    }catch(e){
      alert('STLの読み込みに失敗しました: '+(e&&e.message?e.message:e));
    }
  };
}
const introClose=document.getElementById('strengthIntroClose');if(introClose){introClose.onclick=()=>{const intro=document.getElementById('strengthIntroInPage');if(intro)intro.remove();};}
function b64ToBuffer(b64){const bin=atob(b64);const buf=new ArrayBuffer(bin.length);const u8=new Uint8Array(buf);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return buf;}
function colorForRisk(r){if(r>=.72)return 0xef4444;if(r>=.42)return 0xf59e0b;return 0x22c55e;}
const canvas=document.getElementById('c');const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(window.devicePixelRatio);renderer.shadowMap.enabled=true;const scene=new THREE.Scene();scene.background=new THREE.Color(0x151827);scene.fog=new THREE.FogExp2(0x151827,.0007);const camera=new THREE.PerspectiveCamera(45,1,.1,100000);scene.add(new THREE.AmbientLight(0xffffff,.48));const dl=new THREE.DirectionalLight(0xffffff,.95);dl.position.set(1.4,2,1.2);scene.add(dl);const fill=new THREE.DirectionalLight(0x9db5ff,.35);fill.position.set(-1,-.5,-1);scene.add(fill);
const loader=new THREE.STLLoader();const geometry=loader.parse(b64ToBuffer(b64));geometry.computeBoundingBox();const fullBB=geometry.boundingBox;const center=new THREE.Vector3();fullBB.getCenter(center);const size=new THREE.Vector3();fullBB.getSize(size);const maxDim=Math.max(size.x,size.y,size.z)||1;
const posAll=geometry.attributes.position.array;const numTri=posAll.length/9;const precision=1e4;const edgeMap=new Map();for(let i=0;i<numTri;i++){const vs=[];for(let j=0;j<3;j++){const idx=i*9+j*3;const x=Math.round(posAll[idx]*precision)/precision;const y=Math.round(posAll[idx+1]*precision)/precision;const z=Math.round(posAll[idx+2]*precision)/precision;vs.push(x+'|'+y+'|'+z)}for(let j=0;j<3;j++){const a=vs[j],b=vs[(j+1)%3];const k=a<b?a+','+b:b+','+a;if(!edgeMap.has(k))edgeMap.set(k,[]);edgeMap.get(k).push(i)}}const adj=new Map();for(const ts of edgeMap.values()){if(ts.length===2){const[a,b]=ts;if(!adj.has(a))adj.set(a,[]);if(!adj.has(b))adj.set(b,[]);adj.get(a).push(b);adj.get(b).push(a)}}const visited=new Uint8Array(numTri);const comps=[];for(let i=0;i<numTri;i++){if(!visited[i]){const comp=[],q=[i];visited[i]=1;while(q.length){const t=q.shift();comp.push(t);for(const nb of(adj.get(t)||[])){if(!visited[nb]){visited[nb]=1;q.push(nb)}}}comps.push(comp)}}
const group=new THREE.Group();const deformables=[];comps.forEach((comp,ci)=>{const arr=new Float32Array(comp.length*9);for(let k=0;k<comp.length;k++){arr.set(posAll.subarray(comp[k]*9,comp[k]*9+9),k*9)}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(arr,3));geo.computeVertexNormals();geo.computeBoundingBox();const risk=(RISKS[ci]&&RISKS[ci].risk)||0;const mat=new THREE.MeshPhongMaterial({color:colorForRisk(risk),shininess:65,specular:0x444444,side:THREE.DoubleSide,transparent:true,opacity:.94});const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);const bb=geo.boundingBox;const ext=new THREE.Vector3();bb.getSize(ext);const rr=RISKS[ci]||{};let axis=(rr.deformAxis==='x'||rr.deformAxis==='y'||rr.deformAxis==='z')?rr.deformAxis:(ext.x>=ext.y?'x':'y');const min=axis==='x'?bb.min.x:(axis==='y'?bb.min.y:bb.min.z);const max=axis==='x'?bb.max.x:(axis==='y'?bb.max.y:bb.max.z);const cen=(min+max)/2;const half=Math.max((max-min)/2,1);deformables.push({mesh,geo,orig:new Float32Array(arr),risk,axis,fixedEnd:rr.fixedEnd||'min',supportKey:rr.supportKey||'',cen,half,centerX:(bb.min.x+bb.max.x)/2,centerY:(bb.min.y+bb.max.y)/2,centerZ:(bb.min.z+bb.max.z)/2,amp:maxDim*(.012+Math.min(1.25,risk)*.055),nodes:(RISKS[ci]&&RISKS[ci].femNodes)||[],label:RISKS[ci]&&RISKS[ci].judge?RISKS[ci].judge:''})});group.rotation.x=-Math.PI/2;group.position.sub(new THREE.Vector3(center.x,center.z,-center.y));scene.add(group);function applyRiskSetToMeshes(){deformables.forEach((d,ci)=>{const rr=(RISKS[ci]||{});d.risk=rr.risk||0;d.nodes=rr.femNodes||[];d.label=rr.judge||'';if(rr.fixedEnd)d.fixedEnd=rr.fixedEnd;d.supportKey=rr.supportKey||'';if(rr.deformAxis==='x'||rr.deformAxis==='y'||rr.deformAxis==='z'){d.axis=rr.deformAxis;const bb=d.geo.boundingBox||new THREE.Box3().setFromBufferAttribute(d.geo.attributes.position);const min=d.axis==='x'?bb.min.x:(d.axis==='y'?bb.min.y:bb.min.z);const max=d.axis==='x'?bb.max.x:(d.axis==='y'?bb.max.y:bb.max.z);d.cen=(min+max)/2;d.half=Math.max((max-min)/2,1);}d.amp=maxDim*(.012+Math.min(1.25,d.risk)*.055);if(d.mesh&&d.mesh.material&&d.mesh.material.color)d.mesh.material.color.setHex(colorForRisk(d.risk));});if(typeof updateLoadVisibility==='function')updateLoadVisibility();}window.updateStrengthScene=applyRiskSetToMeshes;
const grid=new THREE.GridHelper(maxDim*1.7,20,0x455066,0x293144);grid.position.y=-maxDim*.52;scene.add(grid);
const modelBox=new THREE.Box3().setFromObject(group);
const modelSize=new THREE.Vector3();modelBox.getSize(modelSize);
const modelCenter=new THREE.Vector3();modelBox.getCenter(modelCenter);
function estimateFrontInfo(){
  // 正面をSTL形状から推定する。X/Zのどちらが奥行き方向かも判定する。
  // 開いている側は端面付近の頂点数が少なくなりやすいので，X方向・Z方向の両方を比較する。
  try{
    const counts={x:{plus:0,minus:0},z:{plus:0,minus:0}};
    const epsX=Math.max(modelSize.x*.18, maxDim*.035, 6);
    const epsZ=Math.max(modelSize.z*.18, maxDim*.035, 6);
    deformables.forEach(d=>{
      const arr=d.orig||[];
      for(let i=0;i<arr.length;i+=3){
        // group.rotation.x=-90deg を反映した簡易ワールド座標
        const wx=arr[i]+group.position.x;
        const wz=arr[i+1]*Math.sin(-Math.PI/2)+arr[i+2]*Math.cos(-Math.PI/2)+group.position.z;
        if(wx>modelBox.max.x-epsX) counts.x.plus++;
        if(wx<modelBox.min.x+epsX) counts.x.minus++;
        if(wz>modelBox.max.z-epsZ) counts.z.plus++;
        if(wz<modelBox.min.z+epsZ) counts.z.minus++;
      }
    });
    function score(c){
      const total=Math.max(1,c.plus+c.minus);
      return {imbalance:Math.abs(c.plus-c.minus)/total, minCount:Math.min(c.plus,c.minus), total};
    }
    const sx=score(counts.x), sz=score(counts.z);
    // 端面の偏りが大きい方向を「前後方向」とみなす。差が小さい場合は従来通りZを優先。
    let axis='z';
    if(sx.imbalance > sz.imbalance + 0.08) axis='x';
    const c=counts[axis];
    let sign=1;
    if(Math.abs(c.plus-c.minus) >= Math.max(20,(c.plus+c.minus)*.08)) sign = c.plus < c.minus ? 1 : -1;
    return {axis, sign};
  }catch(e){return {axis:'z', sign:1};}
}
const VIEW_FRONT=estimateFrontInfo();
const VIEW_FRONT_AXIS=VIEW_FRONT.axis;
const VIEW_FRONT_SIGN=VIEW_FRONT.sign;
function screenRightVector(){
  // 正面から見た画面右方向。右から/左からの荷重方向の基準にする。
  if(VIEW_FRONT_AXIS==='z') return new THREE.Vector3(VIEW_FRONT_SIGN>=0?1:-1,0,0);
  // 正面が+Xなら画面右は-Z，正面が-Xなら画面右は+Z
  return new THREE.Vector3(0,0,VIEW_FRONT_SIGN>=0?-1:1);
}
function sideForceVector(){
  // 力がモデルへ向かう方向。右からなら画面右側から左向き，左からなら画面左側から右向き。
  const r=screenRightVector();
  return (FORCE_DIR==='right') ? r.clone().multiplyScalar(-1) : r.clone();
}
function sideOriginSign(){
  // 画面右側から来るか（+1），画面左側から来るか（-1）。
  return FORCE_DIR==='right' ? 1 : -1;
}
function sideExtentAlongRight(sign){
  const r=screenRightVector();
  const useX=Math.abs(r.x)>0.5;
  if(useX) return sign>0 ? modelBox.max.x : modelBox.min.x;
  return sign>0 ? modelBox.max.z : modelBox.min.z;
}
function addJointMarkers(){
  const showGlue = JOINT_METHOD==='glue' || JOINT_METHOD==='glue_nails';
  const showNails = JOINT_METHOD==='nails' || JOINT_METHOD==='glue_nails';
  if(showGlue){
    const mat=new THREE.MeshPhongMaterial({color:0x38bdf8,transparent:true,opacity:.26,side:THREE.DoubleSide});
    const edgeW=Math.max(maxDim*.018,2);
    [['L',modelBox.min.x+edgeW/2],['R',modelBox.max.x-edgeW/2]].forEach(pair=>{
      const geo=new THREE.BoxGeometry(edgeW,Math.max(modelSize.y*.92,4),Math.max(modelSize.z*.92,4));
      const m=new THREE.Mesh(geo,mat);m.position.set(pair[1],modelCenter.y,modelCenter.z);scene.add(m);
    });
  }
  if(showNails){
    const mat=new THREE.MeshPhongMaterial({color:0xf8fafc,shininess:80,specular:0x999999});
    const r=Math.max(maxDim*.012,1.5);
    const xs=[modelBox.min.x+r*1.5,modelBox.max.x-r*1.5];
    const ys=[modelBox.min.y+modelSize.y*.28,modelBox.max.y-modelSize.y*.28];
    xs.forEach(x=>ys.forEach(y=>{
      const geo=new THREE.SphereGeometry(r,16,12);const s=new THREE.Mesh(geo,mat);s.position.set(x,y,modelBox.max.z+r*.45);scene.add(s);
    }));
  }
}
addJointMarkers();
const loadObjects=[];const topLoadObjects=[];const sideLoadObjects=[];
const topArrowDir=new THREE.Vector3(0,-1,0);
const bookMaterials=[
  new THREE.MeshPhongMaterial({color:0xb45309,transparent:true,opacity:.98}),
  new THREE.MeshPhongMaterial({color:0x2563eb,transparent:true,opacity:.98}),
  new THREE.MeshPhongMaterial({color:0x15803d,transparent:true,opacity:.98}),
  new THREE.MeshPhongMaterial({color:0xbe123c,transparent:true,opacity:.98})
];
const pageMat=new THREE.MeshPhongMaterial({color:0xfff7df,transparent:true,opacity:1});
const spineMaterials=[
  new THREE.MeshPhongMaterial({color:0x7c2d12}),
  new THREE.MeshPhongMaterial({color:0x1e3a8a}),
  new THREE.MeshPhongMaterial({color:0x14532d}),
  new THREE.MeshPhongMaterial({color:0x881337})
];
const loadGap=Math.max(maxDim*.012,2);
function loadVisualTiers(){
  return [{books:4,arrow:1.00},{books:10,arrow:1.22},{books:20,arrow:1.45}];
}
function loadVisualSpec(kg){
  const tiers=loadVisualTiers();
  if(kg<=3)return tiers[0];
  if(kg<=7)return tiers[1];
  return tiers[2];
}
function addTopLoadMarker(x,z,scale){
  const topY=modelBox.max.y;
  const displayScale=Math.max(1,Number(scale)||1);
  // 3段階（軽い/ふつう/重い）ぶんの本をあらかじめすべて積んでおき，
  // 「力の大きさ」を切り替えたときは冊数タグで表示/非表示を切り替えるだけにする。
  // こうすることで，切り替えのたびにシーンを作り直さなくても即座に反映できる。
  const TIERS=loadVisualTiers();
  const maxBooks=TIERS[TIERS.length-1].books;

  // A4（210mm×297mm）に近い縦横比で、天板に収まる範囲で1冊分の大きさを決める。
  // 複数冊は横に並べず、そのまま真上に積み重ねる。
  const A4_RATIO=297/210; // 奥行き(D) / 幅(W)
  const usableW=Math.max(modelSize.x*.55,60)*displayScale;
  const usableD=Math.max(modelSize.z*.55,60)*displayScale;
  let bookD=Math.min(usableD, usableW*A4_RATIO);
  let bookW=bookD/A4_RATIO;
  if(bookW>usableW){ bookW=usableW; bookD=bookW*A4_RATIO; }
  bookW=Math.min(bookW, modelSize.x*.85);
  bookD=Math.min(bookD, modelSize.z*.85);
  bookW=Math.max(bookW, Math.min(modelSize.x*.34,40));
  bookD=Math.max(bookD, Math.min(modelSize.z*.30,56));

  const coverH=Math.max(Math.min(maxDim*.006,2.4),1.2);
  const pagesH=Math.max(Math.min(maxDim*.012,4.2),2.2);
  const oneBookH=coverH*2+pagesH;
  const stackGap=Math.max(oneBookH*.08,.35);
  const tierStackTopY={};
  let stackTopY=topY+loadGap;

  for(let level=0;level<maxBooks;level++){
    const baseY=topY+loadGap+level*(oneBookH+stackGap);
    const rot=(level%2===0?-0.025:0.025);
    const px=x+(level%2===0?-1:1)*Math.min(bookW*.014,1.8);
    const pz=z+((level%3)-1)*Math.min(bookD*.012,1.4);
    const matIndex=level%bookMaterials.length;

    const lower=new THREE.Mesh(new THREE.BoxGeometry(bookW,coverH,bookD),bookMaterials[matIndex]);
    lower.position.set(px,baseY+coverH/2,pz); lower.rotation.y=rot; lower.userData.baseY=lower.position.y; lower.userData.bookLevel=level;
    scene.add(lower); loadObjects.push(lower); topLoadObjects.push(lower);

    const pages=new THREE.Mesh(new THREE.BoxGeometry(bookW*.965,pagesH,bookD*.94),pageMat);
    pages.position.set(px,baseY+coverH+pagesH/2,pz); pages.rotation.y=rot; pages.userData.baseY=pages.position.y; pages.userData.bookLevel=level;
    scene.add(pages); loadObjects.push(pages); topLoadObjects.push(pages);

    const upper=new THREE.Mesh(new THREE.BoxGeometry(bookW,coverH,bookD),bookMaterials[matIndex]);
    upper.position.set(px,baseY+coverH+pagesH+coverH/2,pz); upper.rotation.y=rot; upper.userData.baseY=upper.position.y; upper.userData.bookLevel=level;
    scene.add(upper); loadObjects.push(upper); topLoadObjects.push(upper);

    const spine=new THREE.Mesh(new THREE.BoxGeometry(Math.max(bookW*.045,1.4),pagesH*.94,bookD*.94),spineMaterials[matIndex]);
    spine.position.set(px-bookW*.48,baseY+coverH+pagesH/2,pz); spine.rotation.y=rot; spine.userData.baseY=spine.position.y; spine.userData.bookLevel=level;
    scene.add(spine); loadObjects.push(spine); topLoadObjects.push(spine);

    stackTopY=Math.max(stackTopY,baseY+oneBookH);
    TIERS.forEach(tier=>{ if(level===tier.books-1) tierStackTopY[tier.books]=stackTopY; });
  }

  TIERS.forEach(tier=>{
    const topAt=tierStackTopY[tier.books]||stackTopY;
    const arrowLen=Math.max(maxDim*.20*tier.arrow,28);
    const arrowOriginY=topAt+arrowLen+Math.max(oneBookH*.35,5);
    const arrow=new THREE.ArrowHelper(topArrowDir,new THREE.Vector3(x,arrowOriginY,z),arrowLen,0x3b82f6,Math.max(maxDim*.065*tier.arrow,10),Math.max(maxDim*.034*tier.arrow,6));
    arrow.userData.arrowBooks=tier.books;
    scene.add(arrow); loadObjects.push(arrow); topLoadObjects.push(arrow);
  });
  return null;
}
function addSideLoadMarker(y,z,scale){
  const blockW=Math.max(maxDim*.05*scale,4),blockH=Math.max(maxDim*.15*scale,10),blockD=Math.max(maxDim*.12*scale,8);
  const alongX=Math.abs(screenRightVector().x)>0.5;
  const blockGeo=alongX ? new THREE.BoxGeometry(blockW,blockH,blockD) : new THREE.BoxGeometry(blockD,blockH,blockW);
  const block=new THREE.Mesh(blockGeo,bookMaterials[0]);
  block.position.set(modelCenter.x,y,z);
  block.userData.kind='sideBlock';block.userData.blockW=blockW;block.userData.baseY=y;block.userData.baseZ=z;block.userData.alongX=alongX;
  scene.add(block);loadObjects.push(block);sideLoadObjects.push(block);
  const out=Math.max(maxDim*.28*scale,30);
  const arrow=new THREE.ArrowHelper(sideForceVector(),modelCenter.clone(),out-loadGap,0x60a5fa,Math.max(maxDim*.055*scale,7),Math.max(maxDim*.028*scale,4));
  arrow.userData.kind='sideArrow';arrow.userData.baseY=y;arrow.userData.baseZ=z;arrow.userData.out=out;arrow.userData.scale=scale;arrow.userData.alongX=alongX;
  scene.add(arrow);loadObjects.push(arrow);sideLoadObjects.push(arrow);
  return block;
}
function buildTopLoads(){
  const z=modelCenter.z;
  if(SUPPORT_KEY==='simple_uniform'){
    addTopLoadMarker(modelCenter.x,z,1.0);
    const barGeo=new THREE.BoxGeometry(Math.max(modelSize.x*.88,20),Math.max(maxDim*.012,1.5),Math.max(modelSize.z*.72,12));
    const barMat=new THREE.MeshPhongMaterial({color:0x3b82f6,transparent:true,opacity:.23});
    const bar=new THREE.Mesh(barGeo,barMat);bar.position.set(modelCenter.x,modelBox.max.y+loadGap+Math.max(maxDim*.018,2)/2,z);bar.userData.baseY=bar.position.y;
    scene.add(bar);loadObjects.push(bar);topLoadObjects.push(bar);
  }else if(SUPPORT_KEY==='cantilever'){
    addTopLoadMarker(modelCenter.x+modelSize.x*.32,z,1.05);
  }else{
    addTopLoadMarker(modelCenter.x,z,1.05);
  }
}
function buildSideLoads(){
  const z=modelCenter.z;
  for(let k=-1;k<=1;k++){addSideLoadMarker(modelCenter.y+modelSize.y*(k*.22),z,.85);}
  const barW=Math.max(maxDim*.02,2);
  const alongX=Math.abs(screenRightVector().x)>0.5;
  const sideBarGeo=alongX ? new THREE.BoxGeometry(barW,Math.max(modelSize.y*.72,20),Math.max(modelSize.z*.18,8)) : new THREE.BoxGeometry(Math.max(modelSize.x*.18,8),Math.max(modelSize.y*.72,20),barW);
  const sideBarMat=new THREE.MeshPhongMaterial({color:0x60a5fa,transparent:true,opacity:.22});
  const sideBar=new THREE.Mesh(sideBarGeo,sideBarMat);sideBar.position.set(modelCenter.x,modelCenter.y,z);
  sideBar.userData.kind='sideBar';sideBar.userData.barW=barW;sideBar.userData.baseY=modelCenter.y;sideBar.userData.baseZ=z;sideBar.userData.alongX=alongX;
  scene.add(sideBar);loadObjects.push(sideBar);sideLoadObjects.push(sideBar);
}
buildTopLoads();buildSideLoads();
const infoDiv=document.createElement('div');infoDiv.className='label';infoDiv.style.left='50%';infoDiv.style.top='88%';document.body.appendChild(infoDiv);function updateLoadVisibility(){
  const isSide=(FORCE_DIR==='left'||FORCE_DIR==='right');
  const isTop=FORCE_DIR==='top';
  const topBooksToShow=loadVisualSpec(Math.max(0,LOAD_TEST_KG||0)).books;
  topLoadObjects.forEach(o=>{
    if(typeof o.userData.bookLevel==='number'){ o.visible=isTop && o.userData.bookLevel<topBooksToShow; }
    else if(typeof o.userData.arrowBooks==='number'){ o.visible=isTop && o.userData.arrowBooks===topBooksToShow; }
    else { o.visible=isTop; }
  });
  sideLoadObjects.forEach(o=>{
    o.visible=isSide;if(!isSide)return;
    const right=screenRightVector();
    const force=sideForceVector();
    const side=sideOriginSign();
    const alongX=Math.abs(right.x)>0.5;
    if(o.userData.kind==='sideArrow'){
      const out=o.userData.out||Math.max(maxDim*.28,30);
      const edge=sideExtentAlongRight(side);
      const origin= modelCenter.clone().add(right.clone().multiplyScalar(side*out));
      if(alongX) origin.x=edge + side*out; else origin.z=edge + side*out;
      origin.y=o.userData.baseY; origin.z=alongX?o.userData.baseZ:origin.z;
      if(!alongX) origin.x=modelCenter.x;
      o.position.copy(origin);
      o.setDirection(force);
      o.setLength(Math.max(out-loadGap,5),Math.max(maxDim*.055*(o.userData.scale||1),7),Math.max(maxDim*.028*(o.userData.scale||1),4));
    }else if(o.userData.kind==='sideBlock'){
      const bw=o.userData.blockW||maxDim*.05;
      const edge=sideExtentAlongRight(side);
      if(alongX){
        o.position.x=edge + side*(loadGap+bw/2); o.position.z=o.userData.baseZ;
      }else{
        o.position.z=edge + side*(loadGap+bw/2); o.position.x=modelCenter.x;
      }
      o.userData.baseX=o.position.x; o.userData.baseZ2=o.position.z;
    }else if(o.userData.kind==='sideBar'){
      const bw=o.userData.barW||maxDim*.02;
      const edge=sideExtentAlongRight(side);
      if(alongX){
        o.position.x=edge + side*(loadGap+bw/2); o.position.z=o.userData.baseZ;
      }else{
        o.position.z=edge + side*(loadGap+bw/2); o.position.x=modelCenter.x;
      }
      o.userData.baseX=o.position.x; o.userData.baseZ2=o.position.z;
    }
  });
  infoDiv.textContent=FORCE_DIR==='left'?'左から押されたときのイメージです':(FORCE_DIR==='right'?'右から押されたときのイメージです':(SUPPORT_KEY==='simple_uniform'?'本を全体に置くイメージです':(SUPPORT_KEY==='cantilever'?'片側だけで支えると先が大きく下がります':'真ん中に本を置くイメージです')));
}
updateLoadVisibility();
function defaultCamPhi(){
  if(VIEW_FRONT_AXIS==='z') return (VIEW_FRONT_SIGN>=0?0:Math.PI)+.15;
  return (VIEW_FRONT_SIGN>=0?Math.PI/2:-Math.PI/2)+.15;
}
let camDist=Math.max(modelSize.x,modelSize.y,modelSize.z,maxDim)*2.6,camTheta=Math.PI/2-Math.PI/7,camPhi=defaultCamPhi(),panOffset=modelCenter.clone();panOffset.y += Math.max(modelSize.y,maxDim)*0.18;function setCamera(){camera.position.set(camDist*Math.sin(camTheta)*Math.sin(camPhi)+panOffset.x,camDist*Math.cos(camTheta)+panOffset.y,camDist*Math.sin(camTheta)*Math.cos(camPhi)+panOffset.z);camera.lookAt(panOffset)}function resetCamera(){camDist=Math.max(modelSize.x,modelSize.y,modelSize.z,maxDim)*2.6;camTheta=Math.PI/2-Math.PI/7;camPhi=defaultCamPhi();panOffset.copy(modelCenter);panOffset.y += Math.max(modelSize.y,maxDim)*0.18;setCamera()}resetCamera();const resetBtn=document.getElementById('reset');if(resetBtn)resetBtn.onclick=resetCamera;let playing=true;const toggleBtn=document.getElementById('toggle');if(toggleBtn)toggleBtn.onclick=()=>{playing=!playing;toggleBtn.textContent=playing?'一時停止':'再生'};function resize(){const wrap=document.getElementById('canvas-wrap');const W=Math.max(1,(wrap&&wrap.clientWidth)||innerWidth),H=Math.max(1,(wrap&&wrap.clientHeight)||innerHeight);renderer.setSize(W,H);camera.aspect=W/H;camera.updateProjectionMatrix()}resize();addEventListener('resize',resize);
let mouse={down:false,btn:0,x:0,y:0};canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('mousedown',e=>{mouse={down:true,btn:e.button,x:e.clientX,y:e.clientY}});addEventListener('mouseup',()=>mouse.down=false);addEventListener('mousemove',e=>{if(!mouse.down)return;const dx=e.clientX-mouse.x,dy=e.clientY-mouse.y;mouse.x=e.clientX;mouse.y=e.clientY;if(mouse.btn===0){camPhi-=dx*.008;camTheta=Math.max(.05,Math.min(Math.PI-.05,camTheta-dy*.008))}else if(mouse.btn===2){const f=new THREE.Vector3();camera.getWorldDirection(f);const right=new THREE.Vector3().crossVectors(f,camera.up).normalize();const upDir=new THREE.Vector3().crossVectors(right,f).normalize();const sp=camDist*.001;panOffset.addScaledVector(right,-dx*sp);panOffset.addScaledVector(upDir,dy*sp)}setCamera()});canvas.addEventListener('wheel',e=>{e.preventDefault();camDist=Math.max(maxDim*.1,Math.min(maxDim*20,camDist*(e.deltaY>0?1.1:.91)));setCamera()},{passive:false});
let touchState={};let lastPinch=0;canvas.addEventListener('touchstart',e=>{e.preventDefault();for(const t of e.changedTouches){touchState[t.identifier]={x:t.clientX,y:t.clientY};}if(e.touches.length===2){const a=e.touches[0],b=e.touches[1];lastPinch=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);}}, {passive:false});canvas.addEventListener('touchend',e=>{for(const t of e.changedTouches){delete touchState[t.identifier];}if(e.touches.length<2)lastPinch=0;}, {passive:false});canvas.addEventListener('touchmove',e=>{e.preventDefault();if(e.touches.length===1){const t=e.touches[0];const p=touchState[t.identifier]||{x:t.clientX,y:t.clientY};const dx=t.clientX-p.x,dy=t.clientY-p.y;camPhi-=dx*.008;camTheta=Math.max(.05,Math.min(Math.PI-.05,camTheta-dy*.008));touchState[t.identifier]={x:t.clientX,y:t.clientY};setCamera();}else if(e.touches.length===2){const a=e.touches[0],b=e.touches[1];const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(lastPinch){camDist=Math.max(maxDim*.1,Math.min(maxDim*20,camDist*(lastPinch/d)));setCamera();}lastPinch=d;for(const t of e.touches){touchState[t.identifier]={x:t.clientX,y:t.clientY};}}}, {passive:false});
function femShapeAt(nodes,x){if(!nodes||nodes.length<2){if(SUPPORT_KEY==='simple_uniform')return Math.sin(Math.PI*x)*.9+.08;if(SUPPORT_KEY==='cantilever')return x*x;return Math.max(0,1-Math.pow((x-.5)*2,2));}x=Math.max(0,Math.min(1,x));for(let i=0;i<nodes.length-1;i++){const a=nodes[i],b=nodes[i+1];if(x>=a.x&&x<=b.x){const r=(x-a.x)/Math.max(1e-6,b.x-a.x);let u=(a.norm||0)*(1-r)+(b.norm||0)*r;if(SUPPORT_KEY==='simple_uniform')u=Math.max(u*.88,Math.sin(Math.PI*x)*.35);if(SUPPORT_KEY==='simple_center')u=Math.pow(Math.max(0,u),1.25);return u;}}return nodes[nodes.length-1].norm||0;}const clock=new THREE.Clock();function animate(){requestAnimationFrame(animate);const t=clock.getElapsedTime();const ampEl=document.getElementById('amp');const ampMul=ampEl?(parseFloat(ampEl.value)||1):1.4;const f=playing?(.35+.65*(.5+.5*Math.sin(t*1.8))):.8;deformables.forEach(d=>{const pos=d.geo.attributes.position.array;const orig=d.orig;const risk=Math.max(.03,Math.min(1.5,d.risk));for(let i=0;i<pos.length;i+=3){pos[i]=orig[i];pos[i+1]=orig[i+1];pos[i+2]=orig[i+2];const coord=d.axis==='x'?orig[i]:(d.axis==='y'?orig[i+1]:orig[i+2]);let x01=Math.max(0,Math.min(1,(coord-(d.cen-d.half))/(2*d.half)));if(d.fixedEnd==='max')x01=1-x01;const u=femShapeAt(d.nodes,x01);if(FORCE_DIR==='left'||FORCE_DIR==='right'){const fv=sideForceVector();pos[i]=orig[i]+fv.x*d.amp*ampMul*f*u*risk;pos[i+2]=orig[i+2]+fv.z*d.amp*ampMul*f*u*risk;}else if(d.supportKey==='top_frame_sway'){const dx=Math.abs(d.centerX-center.x);const dy=Math.abs(d.centerY-center.y);if(dx>=dy){const sg=(d.centerX>=center.x)?1:-1;pos[i]=orig[i]+sg*d.amp*ampMul*f*u*risk*.78;}else{const sg=(d.centerY>=center.y)?1:-1;pos[i+1]=orig[i+1]+sg*d.amp*ampMul*f*u*risk*.78;}pos[i+2]=orig[i+2]-d.amp*ampMul*f*u*risk*.18;}else{pos[i+2]=orig[i+2]-d.amp*ampMul*f*u*risk;}}d.geo.attributes.position.needsUpdate=true;d.geo.computeVertexNormals();});loadObjects.forEach(o=>{const pulse=(.5+.5*Math.sin(t*1.8));if(o.isMesh&&typeof o.userData.baseY==='number'&&o.userData.kind!=='sideBlock'&&o.userData.kind!=='sideBar'){o.position.y=o.userData.baseY+Math.max(0,pulse)*maxDim*.015*ampMul;}if(o.isMesh&&typeof o.userData.baseX==='number'){const right=screenRightVector();const side=((right.x||right.z)>0 ? 1 : -1);const amp=Math.max(0,pulse)*maxDim*.018*ampMul;if(Math.abs(right.x)>0.5){const dir=(o.userData.baseX>modelCenter.x)?1:-1;o.position.x=o.userData.baseX+dir*amp;}else{const baseZ=(typeof o.userData.baseZ2==='number')?o.userData.baseZ2:o.position.z;const dir=(baseZ>modelCenter.z)?1:-1;o.position.z=baseZ+dir*amp;}}});renderer.render(scene,camera);window.__tsuyoin3dReady=true;const vs=document.getElementById('viewerStatus');if(vs)vs.style.display='none'}animate();
</script></body></html>`;
    // 強度確認は別アプリ（strength.html）として開く。
    // STLを含むHTMLは大きくなるため、sessionStorageの容量制限を避けてIndexedDBへ保存する。
    (async function(){
      try {
        await saveStrengthHtmlForTransition(htmlDoc);
        try { sessionStorage.removeItem('kidorin_strength_html_backup'); } catch(e) {}
        window.location.href = 'strength.html';
      } catch(e) {
        alert('強度確認画面の表示に失敗しました: ' + (e && e.message ? e.message : e));
      }
    })();
  };

  function bindStrengthUi(){
    const runBtn = document.getElementById('run-strength-check');
    const animBtn = document.getElementById('strength-3d-button');
    const windowBtn = document.getElementById('strength-window-button');
    if (runBtn && !runBtn.dataset.bound) {
      runBtn.dataset.bound = '1';
      runBtn.addEventListener('click', (e)=>{ e.preventDefault(); if (typeof window.runStrengthCheck === 'function') window.runStrengthCheck(); else renderStrengthInfo(); });
    }
    if (animBtn && !animBtn.dataset.bound) {
      animBtn.dataset.bound = '1';
      animBtn.addEventListener('click', (e)=>{ e.preventDefault(); if (typeof window.openStrengthWindow === 'function') window.openStrengthWindow(); });
    }
    if (windowBtn && !windowBtn.dataset.bound) {
      windowBtn.dataset.bound = '1';
      windowBtn.addEventListener('click', (e)=>{ e.preventDefault(); if (typeof window.openStrengthWindow === 'function') window.openStrengthWindow(); });
    }
    ['book-count','book-weight','member-thickness','thickness-mode','strength-material','support-condition','joint-method','fem-elements'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.strengthBound) {
        el.dataset.strengthBound = '1';
        el.addEventListener('change', () => {
          const info = document.getElementById('strengthInfo');
          if (info && document.querySelector('#svg-container svg g[data-x][id^="part-"]')) window.runStrengthCheck();
        });
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindStrengthUi);
  else bindStrengthUi();

  window.refreshStrengthAfterLearningPanel = function(){
    const svg = document.querySelector('#svg-container svg');
    if (!svg || !svg.querySelector('g[data-x][id^="part-"]')) return;
    if (svg.querySelector('.strength-overlay')) window.runStrengthCheck();
  };

  const originalUpdateLearningPanels = window.updateLearningPanels;
  if (typeof originalUpdateLearningPanels === 'function') {
    window.updateLearningPanels = function(){
      originalUpdateLearningPanels.apply(this, arguments);
      const svg = document.querySelector('#svg-container svg');
      if (svg && svg.querySelector('.strength-overlay') && svg.querySelector('g[data-x][id^="part-"]')) {
        window.runStrengthCheck();
      }
    };
  }
})();


/* ===== 別アプリ（strength.html）から戻った時の状態引き継ぎ ===== */
(function(){
  function applyPendingStrengthParams(){
    try{
      const raw = localStorage.getItem('kidorin_pending_strength_params');
      if(!raw) return false;
      localStorage.removeItem('kidorin_pending_strength_params');
      const p = JSON.parse(raw);
      const map = {
        bookCount:'book-count', bookWeight:'book-weight', thicknessMode:'thickness-mode',
        memberThickness:'member-thickness', materialKey:'strength-material', supportKey:'support-condition',
        jointMethod:'joint-method', femElements:'fem-elements'
      };
      Object.keys(map).forEach(k=>{ const el=document.getElementById(map[k]); if(el && p[k]!=null) el.value = p[k]; });
      return true;
    }catch(e){ console.warn('pending params failed', e); return false; }
  }
  function dataUrlToFile(dataUrl, fileName){
    const arr = dataUrl.split(',');
    const mime = (arr[0].match(/:(.*?);/)||[])[1] || 'application/octet-stream';
    const bin = atob(arr[1] || '');
    const u8 = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    return new File([u8], fileName || 'model.stl', {type:mime});
  }
  function showSharedStlLoadError(error){
    try{
      document.documentElement.classList.remove('headless-strength');
      const old=document.getElementById('shared-stl-load-error'); if(old) old.remove();
      const box=document.createElement('div');
      box.id='shared-stl-load-error';
      box.style.cssText='position:fixed;left:16px;right:16px;top:16px;z-index:1000000;background:#fff7ed;color:#7c2d12;border:3px solid #ea580c;border-radius:14px;padding:14px 16px;font:700 15px/1.6 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
      box.innerHTML='<b>共有したSTLを「きどりん」で読み込めませんでした。</b><br>'+String(error&&error.message?error.message:error)+'<br><span style="font-weight:500">下の「ファイルの選択」から同じSTLを読み直すこともできます。</span>';
      document.body.appendChild(box);
    }catch(e){}
  }
  window.addEventListener('DOMContentLoaded', async ()=>{
    const url = new URL(window.location.href);
    const shouldOpen = url.searchParams.get('openStrength') === '1';
    const fromStrength = url.searchParams.get('fromStrength') === '1';
    const hadParams = applyPendingStrengthParams();
    const sharedData = window.SharedStl ? (window.SharedStl.getAsync ? await window.SharedStl.getAsync() : window.SharedStl.get()) : null;
    const pendingStl = (window.SharedStl ? null : localStorage.getItem('kidorin_pending_strength_stl'));
    const currentStl = (window.SharedStl ? null : localStorage.getItem('kidorin_current_stl'));
    const rawStl = sharedData ? JSON.stringify(sharedData) : (pendingStl || currentStl);
    if(rawStl){
      // pendingデータはSTLの読込成功後に削除する。先に消すと読込失敗時にモデルを失う。
      try{
        if(!window.SharedStl && pendingStl) localStorage.setItem('kidorin_current_stl', pendingStl);
        const data = JSON.parse(rawStl);
        const buffer = (window.SharedStl && window.SharedStl.dataUrlToArrayBuffer)
          ? window.SharedStl.dataUrlToArrayBuffer(data.dataUrl)
          : (function(){
              const arr=String(data.dataUrl||'').split(',');
              const bin=atob(arr[1]||'');
              const u8=new Uint8Array(bin.length);
              for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
              return u8.buffer;
            })();
        if(buffer && typeof loadArrayBufferAsStl === 'function'){
          loadArrayBufferAsStl(buffer, data.name || 'model.stl', {persist:false}).then(()=>{
            try{
              if(window.SharedStl) window.SharedStl.removePending();
              else if(pendingStl) localStorage.removeItem('kidorin_pending_strength_stl');
            }catch(cleanErr){ console.warn('pending STL cleanup failed', cleanErr); }
            if(shouldOpen){
              const openWhenPartsReady = (tryCount=0) => {
                const hasParts = !!document.querySelector('#svg-container svg g[data-x][id^="part-"]');
                if ((hasParts || tryCount >= 20) && typeof window.openStrengthWindow === 'function') {
                  window.openStrengthWindow();
                } else {
                  setTimeout(()=>openWhenPartsReady(tryCount + 1), 100);
                }
              };
              openWhenPartsReady();
            }
          }).catch(e=>{ console.error('STL load failed', e); showSharedStlLoadError(e); });
          return;
        }
      }catch(e){ console.warn('shared STL failed', e); }
    }
    if(shouldOpen || hadParams){
      // 再生成用STLが見つからない場合は，モデルを失った空画面へ進まず旧画面を復元する。
      try{
        const backup = sessionStorage.getItem('kidorin_strength_html_backup');
        if(shouldOpen && !rawStl && backup){
          sessionStorage.setItem('kidorin_strength_html', backup);
          sessionStorage.removeItem('kidorin_strength_html_backup');
          window.location.replace('strength.html?restore=1');
          return;
        }
      }catch(restoreErr){ console.warn('strength backup restore failed', restoreErr); }
      setTimeout(()=>{ if(typeof window.openStrengthWindow==='function') window.openStrengthWindow(); }, 400);
    }
  });
})();
