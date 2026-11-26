/*
 * 3D AR合成ビューア「かさねん」
 * Copyright (c) 2026 Hiroyuki Muramatsu / Shinshu-u
 * https://gijyutu.com/main/
 * Released under the MIT License
 */



// ================================================================
// 起動時の自動読み込み設定
// ================================================================
// index.html の <body data-default-model="..."> で指定したモデルを、起動時に自動表示します。
// 対応形式: STL / GLB / GLTF
// 空欄、未指定、ファイルが見つからない、読み込めない場合は、従来どおり通常起動します。
let autoLoadedAtStartup = false;

if (!window.THREE) {
  window.addEventListener('DOMContentLoaded', () => {
    const notice = document.createElement('div');
    notice.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;background:#fff;color:#111;border:2px solid #d33;border-radius:12px;padding:14px 16px;font-family:sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);';
    notice.innerHTML = '<b>「かさねん」を起動できません。</b><br>Three.jsを読み込めませんでした。インターネット接続を確認してください。移動ボタンはそのまま使えます。';
    document.body.appendChild(notice);
  });
}


// ================================================================
// 3アプリ共通：STL共有
// ================================================================
async function sharedStlInfo(){
  if (window.SharedStl && window.SharedStl.getAsync) return await window.SharedStl.getAsync();
  if (window.SharedStl) return window.SharedStl.get();
  try {
    const raw = localStorage.getItem('kidorin_current_stl') || localStorage.getItem('kidorin_pending_strength_stl');
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function dataUrlToArrayBuffer(dataUrl){
  const arr = String(dataUrl || '').split(',');
  const bin = atob(arr[1] || '');
  const u8 = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

function arrayBufferToDataUrl(buffer){
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
  }
  return 'data:application/sla;base64,' + btoa(binary);
}

/* ===== 単位切替（mm / cm）：きどりんと共有 ===== */
let kasanenUnitMode = 'mm';
try { kasanenUnitMode = localStorage.getItem('kidorin_unit_mode') || 'mm'; } catch(e){}
function kasanenUnitLabel(){ return kasanenUnitMode; }
function kasanenMmToDisplay(mm){ return kasanenUnitMode === 'cm' ? mm / 10 : mm; }
function kasanenGeoScale(){ return kasanenUnitMode === 'cm' ? 10 : 1; }
function saveUnitMode(mode){
  kasanenUnitMode = mode;
  try { localStorage.setItem('kidorin_unit_mode', mode); } catch(e){}
}

function saveSharedStl(buffer, name){
  try {
    const fname = name || 'model.stl';
    if (!String(fname).toLowerCase().endsWith('.stl')) return;
    const payload = { name: fname, dataUrl: arrayBufferToDataUrl(buffer) };
    if (window.SharedStl && window.SharedStl.setAsync) window.SharedStl.setAsync(payload).catch(e=>console.warn('STL共有保存に失敗しました',e));
    else if (window.SharedStl) window.SharedStl.set(payload);
    else {
      localStorage.setItem('kidorin_current_stl', JSON.stringify(payload));
      localStorage.removeItem('kidorin_pending_strength_stl');
    }
  } catch(e) { console.warn('STL共有保存に失敗しました', e); }
}

async function tryLoadSharedStl(){
  const data = await sharedStlInfo();
  if (!data || !data.dataUrl) return false;
  try {
    const buf = dataUrlToArrayBuffer(data.dataUrl);
    await handleModel(buf, data.name || 'model.stl');
    return true;
  } catch(e) {
    console.warn('共有STLの読み込みに失敗しました', e);
    return false;
  }
}

function getDefaultModelFile() {
  const fromBody = document.body?.dataset?.defaultModel;
  const fromGlobal = window.KASANEN_DEFAULT_MODEL || window.DEFAULT_MODEL_FILE;
  return String(fromBody || fromGlobal || '').trim();
}

function getModelFileName(path) {
  try {
    const url = new URL(path, window.location.href);
    const name = url.pathname.split('/').pop() || path;
    return decodeURIComponent(name).toLowerCase();
  } catch (e) {
    return String(path).split('/').pop().split('?')[0].split('#')[0].toLowerCase();
  }
}

function isSupportedModelFile(path) {
  const name = getModelFileName(path);
  return name.endsWith('.stl') || name.endsWith('.glb') || name.endsWith('.gltf');
}

async function tryLoadDefaultModel() {
  const defaultModelFile = getDefaultModelFile();
  if (!defaultModelFile || !isSupportedModelFile(defaultModelFile)) return false;

  try {
    const res = await fetch(defaultModelFile, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Default model not found: ${res.status}`);

    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) throw new Error('Default model is empty');

    await handleModel(buf, getModelFileName(defaultModelFile));
    autoLoadedAtStartup = true;
    return true;
  } catch (err) {
    console.info('Default model was not loaded. Starting normally.', err);
    return false;
  }
}

function showNormalStartup() {
  const startOverlay = document.getElementById('startOverlay');
  const modelControls = document.getElementById('modelControls');
  const dropZone = document.getElementById('dropZone');

  if (startOverlay) startOverlay.style.display = 'none';
  if (modelControls) modelControls.style.display = 'block';
  if (dropZone) dropZone.style.display = 'flex';
}

// ================================================================
// ユーティリティ
// ================================================================
function eachMesh(root, fn) {
  if (!root) return;
  if (root.traverse) root.traverse(o => (o.isMesh||o.isSkinnedMesh||o.isInstancedMesh) && fn(o));
  else if (root.isMesh) fn(root);
}
function forEachMaterial(mesh, fn) {
  if (!mesh.material) return;
  if (Array.isArray(mesh.material)) mesh.material.forEach(fn);
  else fn(mesh.material);
}

// ================================================================
// 木取りアプリ由来：STLを連結成分（部品）に分離する
// ================================================================
const PART_COLORS_HEX = [
  0xdbeafe, 0xfde68a, 0xfecdd3, 0xd1fae5, 0xe9d5ff,
  0xfed7aa, 0xbfdbfe, 0xfbcfe8, 0xfde2e4, 0xddd6fe,
  0xc7f9cc, 0xfaedcd
];

function separateGeometries(geometry) {
  const positions = geometry.attributes.position.array;
  const numTriangles = positions.length / 9;
  const visited = new Array(numTriangles).fill(false);
  const adjacency = new Map();
  const edgeToTriangles = new Map();
  const precision = 1e4;

  for (let i = 0; i < numTriangles; i++) {
    const verts = [];
    for (let j = 0; j < 3; j++) {
      const vi = i * 9 + j * 3;
      const x = Math.round(positions[vi]   * precision) / precision;
      const y = Math.round(positions[vi+1] * precision) / precision;
      const z = Math.round(positions[vi+2] * precision) / precision;
      verts.push(`${x}|${y}|${z}`);
    }
    for (let j = 0; j < 3; j++) {
      const v1 = verts[j], v2 = verts[(j+1)%3];
      const ek = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
      if (!edgeToTriangles.has(ek)) edgeToTriangles.set(ek, []);
      edgeToTriangles.get(ek).push(i);
    }
  }
  for (const tris of edgeToTriangles.values()) {
    if (tris.length === 2) {
      const [a, b] = tris;
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
  }
  const result = [];
  for (let i = 0; i < numTriangles; i++) {
    if (!visited[i]) {
      const comp = [], queue = [i];
      visited[i] = true;
      while (queue.length) {
        const cur = queue.shift();
        comp.push(cur);
        for (const nb of (adjacency.get(cur)||[])) {
          if (!visited[nb]) { visited[nb]=true; queue.push(nb); }
        }
      }
      const pos = new Float32Array(comp.length * 9);
      for (let k=0;k<comp.length;k++)
        for (let v=0;v<9;v++) pos[k*9+v]=positions[comp[k]*9+v];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      result.push(g);
    }
  }
  return result;
}

// ================================================================
// 状態
// ================================================================
let wireOn = false;
let originalMaterials = new Map();
let coloredGroup = null;   // 色分け表示用グループ
let isColored    = false;

const dropZone       = document.getElementById('dropZone');
const modelControls  = document.getElementById('modelControls');
const btnLoadModel   = document.getElementById('btnLoadModel');
const modelInput     = document.getElementById('modelInput');
const bgControls     = document.getElementById('bgControls');
const btnToggleWire  = document.getElementById('btnToggleWire');
const btnShowStats   = document.getElementById('btnShowStats');
const btnToggleDimensions = document.getElementById('btnToggleDimensions');
const statsPanel     = document.getElementById('statsPanel');
const btnColorParts  = document.getElementById('btnColorParts');
const btnCapture     = document.getElementById('btnCapture');
const btnImage       = document.getElementById('btnImage');
const btnCamera      = document.getElementById('btnCamera');
const btnReloadModel = document.getElementById('btnReloadModel');
const btnBackAR      = document.getElementById('btnBackAR');
const btnSwitchCamera= document.getElementById('btnSwitchCamera');
const fileInput      = document.getElementById('fileInput');
const video          = document.getElementById('video');
const canvas         = document.getElementById('arCanvas');

let scene, camera, renderer, controls, current;
let dimensionGroup = null;
let dimensionsOn = false;
let modelOriginalSize = null;
let modelOriginalScale = 1;
let modelMeta = { type: '', generator: '' };
let raycaster, pointer, dragPlane, dragOffset, dragging = false;
let videoDevices=[], currentCameraIndex=0, currentStream=null;

// ================================================================
// Three.js 初期化
// ================================================================
function initThree(w, h) {
  scene    = new THREE.Scene();
  // 淡色の部品を見分けやすい濃紺背景。初期メニュー経由でも必ず適用する。
  scene.background = new THREE.Color(0x172033);
  camera   = new THREE.PerspectiveCamera(45, w/h, 0.1, 10000);
  camera.position.set(0, 0, 150);

  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, preserveDrawingBuffer:true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(5, 10, 7.5);
  scene.add(dir);

  raycaster  = new THREE.Raycaster();
  pointer    = new THREE.Vector2();
  dragPlane  = new THREE.Plane();
  dragOffset = new THREE.Vector3();

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onOrientationChange);
  // 初期のVW/VH CSS変数をセット
  document.documentElement.style.setProperty('--vw', window.innerWidth * 0.01 + 'px');
  document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  animate();
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// スマホ回転時にviewport/フォントが縮まないよう orientationchange でも対応
function onOrientationChange() {
  // 回転後に実際のサイズが確定するまで少し待ってからリサイズ
  setTimeout(() => {
    onResize();
    // viewport の visual viewport に合わせて font-size の基準をリセット
    document.documentElement.style.setProperty('--vw', window.innerWidth * 0.01 + 'px');
    document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  }, 200);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateDimensionLabelScale();
  renderer.render(scene, camera);
}

function fit(obj) {
  // まず正規化スケールを計算するために元バウンディングを取得
  const box0 = new THREE.Box3().setFromObject(obj);
  const sph0 = box0.getBoundingSphere(new THREE.Sphere());
  const r0 = sph0.radius;
  const TARGET = 100;
  const scale = r0 > 0 ? TARGET / (r0 * 2) : 1;

  // スケールをセット
  obj.scale.set(scale, scale, scale);

  // スケール後のバウンディングを再計算して中心・距離を正確に求める
  const box1 = new THREE.Box3().setFromObject(obj);
  const sph1 = box1.getBoundingSphere(new THREE.Sphere());
  const center = sph1.center;
  const r1     = sph1.radius;

  // オブジェクト中心をワールド原点に移動（確実に画面中央に収める）
  obj.position.sub(center);

  // カメラをモデル正面に配置
  const dist = r1 > 0 ? r1 * 2.5 : TARGET * 1.5;
  camera.position.set(0, 0, dist);
  camera.near = dist * 0.001;
  camera.far  = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}


// ================================================================
// 寸法表示
// ================================================================
function disposeObject3D(obj) {
  if (!obj) return;
  if (obj.traverse) obj.traverse(child => {
    if (child.geometry && child.geometry.dispose) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(mat => {
        if (mat.map && mat.map.dispose) mat.map.dispose();
        if (mat.dispose) mat.dispose();
      });
    }
  });
}

function makeTextSprite(text) {
  const canvas2d = document.createElement('canvas');
  canvas2d.width = 768;
  canvas2d.height = 176;
  const ctx = canvas2d.getContext('2d');
  ctx.clearRect(0, 0, canvas2d.width, canvas2d.height);
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(24, 24, canvas2d.width - 48, canvas2d.height - 48);
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = 5;
  ctx.strokeRect(24, 24, canvas2d.width - 48, canvas2d.height - 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas2d.width / 2, canvas2d.height / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas2d);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  sprite.userData.fixedScreenSize = true;
  sprite.userData.screenHeightPx = 52;
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

function clearDimensions() {
  if (dimensionGroup) {
    scene.remove(dimensionGroup);
    disposeObject3D(dimensionGroup);
    dimensionGroup = null;
  }
}

function getActiveModelObject() {
  return (isColored && coloredGroup) ? coloredGroup : current;
}

function getDisplayedAndOriginalSize(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const displayed = new THREE.Vector3();
  box.getSize(displayed);

  let original = null;
  if (modelOriginalSize) {
    original = modelOriginalSize.clone();
  } else {
    const scale = Math.abs(root?.scale?.x || modelOriginalScale || 1) || 1;
    original = displayed.clone().divideScalar(scale);
  }

  // Tinkercad由来でm単位のように極端に小さい場合だけmmに寄せる
  const mx = Math.max(original.x, original.y, original.z);
  if (mx > 0 && mx < 1) original.multiplyScalar(1000);
  return { box, displayed, original };
}

function createDimensions(root) {
  if (!root) return null;
  const info = getDisplayedAndOriginalSize(root);
  if (!info) return null;
  const { box, displayed, original } = info;
  const maxLen = Math.max(displayed.x, displayed.y, displayed.z) || 1;
  const margin = maxLen * 0.055;
  const tickLen = Math.max(maxLen * 0.045, 3);
  const labelScale = Math.max(maxLen * 0.105, 7);
  const min = box.min;
  const max = box.max;
  const dims = new THREE.Group();
  dims.name = 'dimensionGroup';

  addDimension(dims,
    new THREE.Vector3(min.x, min.y - margin, max.z + margin),
    new THREE.Vector3(max.x, min.y - margin, max.z + margin),
    'W ' + kasanenMmToDisplay(original.x * kasanenGeoScale()).toFixed(1) + ' ' + kasanenUnitLabel(),
    new THREE.Vector3(0, 1, 0), labelScale, tickLen);

  addDimension(dims,
    new THREE.Vector3(max.x + margin, min.y, max.z + margin),
    new THREE.Vector3(max.x + margin, max.y, max.z + margin),
    'H ' + kasanenMmToDisplay(original.y * kasanenGeoScale()).toFixed(1) + ' ' + kasanenUnitLabel(),
    new THREE.Vector3(1, 0, 0), labelScale, tickLen);

  addDimension(dims,
    new THREE.Vector3(max.x + margin, min.y - margin, min.z),
    new THREE.Vector3(max.x + margin, min.y - margin, max.z),
    'D ' + kasanenMmToDisplay(original.z * kasanenGeoScale()).toFixed(1) + ' ' + kasanenUnitLabel(),
    new THREE.Vector3(0, 1, 0), labelScale, tickLen);

  return dims;
}

function setDimensionsVisible(on) {
  dimensionsOn = !!on;
  clearDimensions();
  if (btnToggleDimensions) {
    btnToggleDimensions.textContent = dimensionsOn ? '📏 寸法非表示' : '📏 寸法表示';
    btnToggleDimensions.classList.toggle('active', dimensionsOn);
  }
  if (dimensionsOn) {
    const root = getActiveModelObject();
    dimensionGroup = createDimensions(root);
    if (dimensionGroup) scene.add(dimensionGroup);
  }
}

function updateDimensionLabelScale() {
  if (!dimensionGroup || !camera || !renderer) return;
  const h = Math.max(renderer.domElement.clientHeight || window.innerHeight || 1, 1);
  const fovRad = THREE.MathUtils.degToRad(camera.fov || 45);
  const camPos = new THREE.Vector3();
  const objPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  dimensionGroup.traverse(obj => {
    if (!obj.isSprite || !obj.userData.fixedScreenSize) return;
    obj.getWorldPosition(objPos);
    const dist = Math.max(camPos.distanceTo(objPos), 0.001);
    const screenHeightPx = obj.userData.screenHeightPx || 52;
    const aspect = obj.userData.aspectRatio || 4;
    const visibleWorldHeight = 2 * dist * Math.tan(fovRad / 2);
    const worldHeight = visibleWorldHeight * (screenHeightPx / h);
    obj.scale.set(worldHeight * aspect, worldHeight, 1);
  });
}

function refreshDimensionsIfNeeded() {
  if (dimensionsOn) setDimensionsVisible(true);
}

if (btnToggleDimensions) {
  btnToggleDimensions.addEventListener('click', () => setDimensionsVisible(!dimensionsOn));
}

// ================================================================
// モデル読み込み
// ================================================================
async function handleModel(buf, name) {
  if (!renderer) initThree(window.innerWidth, window.innerHeight);
  clearDimensions();
  if (current) scene.remove(current);
  if (coloredGroup) { scene.remove(coloredGroup); coloredGroup=null; }
  isColored = false;
  if (btnColorParts) btnColorParts.textContent = 'STL部品区別';

  name = getModelFileName(name);
  if (name.endsWith('.stl')) {
    saveSharedStl(buf, name);
    modelMeta.type='stl'; modelMeta.generator='stl';
    const geom = new THREE.STLLoader().parse(buf);
    geom.computeVertexNormals();
    current = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color:0xaaaaaa, metalness:0.3, roughness:0.7
    }));
  } else {
    const gltf = await new Promise((res,rej)=>new THREE.GLTFLoader().parse(buf,'',res,rej));
    current = gltf.scene;
    try {
      const gen=(gltf?.parser?.json?.asset?.generator)||'';
      modelMeta.type='glb'; modelMeta.generator=String(gen||'');
    } catch(e){}
  }

  const originalBox = new THREE.Box3().setFromObject(current);
  modelOriginalSize = new THREE.Vector3();
  originalBox.getSize(modelOriginalSize);
  scene.add(current);
  fit(current);
  modelOriginalScale = Math.abs(current?.scale?.x || 1) || 1;
  refreshDimensionsIfNeeded();

  dropZone.style.display       = 'none';
  modelControls.style.display  = 'none';
  bgControls.style.display     = 'flex';
  canvas.style.display         = 'block';
  btnBackAR.style.display      = 'none';
  btnCapture.style.display     = 'none';

  // STLのときだけ色分けボタンを有効化
  if (btnColorParts) {
    btnColorParts.style.display = name.endsWith('.stl') ? 'inline-block' : 'none';
  }
}

// ================================================================
// STL部品色分け
// ================================================================
if (btnColorParts) {
  btnColorParts.addEventListener('click', () => {
    if (!current) return;

    if (isColored && coloredGroup) {
      // トグル：元に戻す
      scene.remove(coloredGroup);
      coloredGroup = null;
      scene.add(current);
      current.visible = true;
      isColored = false;
      btnColorParts.textContent = 'STL部品区別';
      refreshDimensionsIfNeeded();
      return;
    }

    // STL geometry を取得
    let sourceGeom = null;
    eachMesh(current, m => { if (!sourceGeom) sourceGeom = m.geometry; });
    if (!sourceGeom) return;

    // 部品に分離
    const geos = separateGeometries(sourceGeom);
    if (geos.length <= 1) {
      // 1部品しかない場合も色を付けて表示
    }

    // 色分けグループを作成
    coloredGroup = new THREE.Group();

    // 元のモデルのスケール・位置を引き継ぐ
    coloredGroup.scale.copy(current.scale);
    coloredGroup.position.copy(current.position);
    coloredGroup.rotation.copy(current.rotation);

    geos.forEach((geo, idx) => {
      geo.computeVertexNormals();
      const col = PART_COLORS_HEX[idx % PART_COLORS_HEX.length];
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        metalness: 0.1,
        roughness: 0.7,
        transparent: true,
        opacity: 0.92,
      });
      coloredGroup.add(new THREE.Mesh(geo, mat));
    });

    // 元モデルを隠して色分け表示
    current.visible = false;
    scene.add(coloredGroup);
    isColored = true;
    btnColorParts.textContent = `部品区別中 (${geos.length}個) ／元に戻す`;
    refreshDimensionsIfNeeded();
  });
}

// ================================================================
// ファイル読み込みUI
// ================================================================
btnLoadModel.onclick = () => { modelInput.value=''; modelInput.click(); };
modelInput.onchange  = async () => {
  const f=modelInput.files[0]; if(!f) return;
  const buf=await f.arrayBuffer(); await handleModel(buf, f.name);
};

window.addEventListener('dragover', e=>e.preventDefault());
window.addEventListener('drop',     e=>e.preventDefault());
dropZone.addEventListener('drop', async e=>{
  e.preventDefault();
  const f=e.dataTransfer.files[0]; if(!f) return;
  const buf=await f.arrayBuffer(); await handleModel(buf, f.name);
});
canvas.addEventListener('drop', async e=>{
  e.preventDefault();
  const f=e.dataTransfer.files[0]; if(!f) return;
  const buf=await f.arrayBuffer(); await handleModel(buf, f.name);
});
canvas.addEventListener('dragover', e=>e.preventDefault());

// ================================================================
// モデル移動操作
// ================================================================
canvas.addEventListener('pointerdown', e=>{
  const activeObj = (isColored && coloredGroup) ? coloredGroup : current;
  if (!activeObj) return;
  pointer.x=(e.clientX/window.innerWidth)*2-1;
  pointer.y=-(e.clientY/window.innerHeight)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const ints=raycaster.intersectObject(activeObj,true);
  if(ints.length){
    dragging=true;
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(), ints[0].point);
    dragOffset.copy(ints[0].point).sub(activeObj.position);
    controls.enabled=false;
  }
});
canvas.addEventListener('pointermove', e=>{
  if(!dragging) return;
  const activeObj=(isColored&&coloredGroup)?coloredGroup:current;
  pointer.x=(e.clientX/window.innerWidth)*2-1;
  pointer.y=-(e.clientY/window.innerHeight)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const pos=new THREE.Vector3();
  if(raycaster.ray.intersectPlane(dragPlane,pos)){
    activeObj.position.copy(pos.sub(dragOffset));
    // coloredGroupとcurrentを同期
    if(isColored&&coloredGroup) current.position.copy(coloredGroup.position);
    else if(coloredGroup) coloredGroup.position.copy(current.position);
  }
});
canvas.addEventListener('pointerup',    ()=>{ dragging=false; controls.enabled=true; refreshDimensionsIfNeeded(); });
canvas.addEventListener('pointerleave', ()=>{ dragging=false; controls.enabled=true; refreshDimensionsIfNeeded(); });

// ================================================================
// 背景操作
// ================================================================
btnImage.onclick=()=>{
  fileInput.accept='image/*';
  fileInput.onchange=async()=>{
    const f=fileInput.files[0]; if(!f) return;
    const url=URL.createObjectURL(f);
    new THREE.TextureLoader().load(url,tex=>{
      scene.background=tex;
      canvas.classList.add('has-ar-background');
      renderer.render(scene,camera);
    });
    video.style.display='none';
    canvas.style.display='block';
    btnBackAR.style.display='inline-block';
    btnCapture.style.display='inline-block';
  };
  fileInput.click();
};

// ギジュツドットコム ガイドライン対応：カメラ使用時の注意（このタブで初回のみ表示）
function showCameraNotice(){
  try{ if(sessionStorage.getItem('kasanen_camera_notice_shown')==='1') return; sessionStorage.setItem('kasanen_camera_notice_shown','1'); }catch(e){}
  const old=document.getElementById('cameraNotice'); if(old) old.remove();
  const n=document.createElement('div');
  n.id='cameraNotice';
  n.setAttribute('role','status');
  n.style.cssText='position:fixed;left:50%;bottom:52px;transform:translateX(-50%);z-index:100000;width:min(560px,92vw);background:#fff;color:#1f2937;border:2px solid #f59e0b;border-radius:12px;padding:10px 14px;font:700 13px/1.6 system-ui,"Noto Sans JP",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);text-align:left;';
  n.innerHTML='📹 カメラの映像はこの端末の中だけで使い，外部には送信しません。<br>人の顔や名札など，個人が分かるものが写らないようにしましょう。<button type="button" style="float:right;margin-top:4px;padding:4px 12px;border:0;border-radius:8px;background:#0b57d0;color:#fff;font-weight:700;cursor:pointer;min-height:32px">OK</button>';
  n.querySelector('button').onclick=()=>n.remove();
  document.body.appendChild(n);
  setTimeout(()=>{ if(n.parentNode) n.remove(); }, 9000);
}

btnCamera.onclick=async()=>{
  showCameraNotice();
  video.style.display='block'; canvas.style.display='block';
  bgControls.style.display='flex';
  btnBackAR.style.display='inline-block';
  btnCapture.style.display='inline-block';
  btnSwitchCamera.style.display='inline-block';
  try {
    const tmp=await navigator.mediaDevices.getUserMedia({video:true});
    tmp.getTracks().forEach(t=>t.stop());
    const devices=await navigator.mediaDevices.enumerateDevices();
    videoDevices=devices.filter(d=>d.kind==='videoinput');
    const bi=videoDevices.findIndex(d=>
      d.label.toLowerCase().includes('back')||
      d.label.toLowerCase().includes('environment')||
      d.label.includes('背面'));
    currentCameraIndex=(bi!==-1)?bi:0;
    await startCamera({video:{deviceId:{exact:videoDevices[currentCameraIndex].deviceId}}});
  } catch(err){
    console.warn('背面カメラ取得失敗:',err);
    await startCamera({video:{facingMode:'user'}});
  }
};

btnSwitchCamera.onclick=async()=>{
  if(videoDevices.length<=1) return;
  currentCameraIndex=(currentCameraIndex+1)%videoDevices.length;
  await startCamera({video:{deviceId:{exact:videoDevices[currentCameraIndex].deviceId}}});
};

async function startCamera(constraints){
  if(currentStream) currentStream.getTracks().forEach(t=>t.stop());
  const stream=await navigator.mediaDevices.getUserMedia(constraints);
  currentStream=stream; video.srcObject=stream;
  video.onloadedmetadata=()=>{
    scene.background=new THREE.VideoTexture(video);
    canvas.classList.add('has-ar-background');
  };
}

btnCapture.onclick=()=>{
  const dataURL=renderer.domElement.toDataURL('image/jpeg',0.92);
  const now=new Date();
  const ts=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const a=document.createElement('a');
  a.href=dataURL; a.download=`capture_${ts}.jpg`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

btnReloadModel.onclick=()=>{
  clearDimensions();
  canvas.classList.remove('has-ar-background');
  if (scene) scene.background = new THREE.Color(0x172033);
  modelOriginalSize = null;
  modelOriginalScale = 1;
  if(current) scene.remove(current);
  if(coloredGroup){ scene.remove(coloredGroup); coloredGroup=null; }
  isColored=false;
  bgControls.style.display='none';
  canvas.style.display='none';
  video.style.display='none';
  modelControls.style.display='block';
  dropZone.style.display='flex';
  btnCapture.style.display='none';
  btnBackAR.style.display='none';
  btnSwitchCamera.style.display='none';
  if(currentStream){ currentStream.getTracks().forEach(t=>t.stop()); currentStream=null; }
};

btnBackAR.onclick=()=>{
  scene.background=new THREE.Color(0x172033);
  canvas.classList.remove('has-ar-background');
  btnBackAR.style.display='none';
  btnCapture.style.display='none';
  btnSwitchCamera.style.display='none';
  video.style.display='none';
  canvas.style.display='block';
  if(currentStream){ currentStream.getTracks().forEach(t=>t.stop()); currentStream=null; }
};

// ================================================================
// ポリゴン表示切替
// ================================================================
if(btnToggleWire){
  btnToggleWire.onclick=()=>{
    if(!current) return;
    wireOn=!wireOn;
    const targets=[];
    eachMesh(current,m=>targets.push(m));
    if(isColored&&coloredGroup) eachMesh(coloredGroup,m=>targets.push(m));
    targets.forEach(m=>{
      forEachMaterial(m,mat=>{
        if(wireOn){
          if(!originalMaterials.has(mat))
            originalMaterials.set(mat,{
              wireframe:'wireframe' in mat?mat.wireframe:undefined,
              flatShading:'flatShading' in mat?mat.flatShading:undefined
            });
          if('wireframe' in mat) mat.wireframe=true;
          if('flatShading' in mat) mat.flatShading=true;
        } else {
          const saved=originalMaterials.get(mat);
          if(saved){
            if('wireframe' in mat&&saved.wireframe!==undefined) mat.wireframe=saved.wireframe;
            if('flatShading' in mat&&saved.flatShading!==undefined) mat.flatShading=saved.flatShading;
          } else {
            if('wireframe' in mat) mat.wireframe=false;
            if('flatShading' in mat) mat.flatShading=false;
          }
        }
        mat.needsUpdate=true;
      });
    });
    if(!wireOn) originalMaterials.clear();
  };
}

// ================================================================
// 統計情報
// ================================================================
function computeStats(root){
  let meshes=0,materials=0,tris=0,verts=0,drawCalls=0;
  eachMesh(root,m=>{
    meshes++; drawCalls++;
    const mat=m.material;
    if(Array.isArray(mat)) materials+=mat.length; else if(mat) materials+=1;
    const g=m.geometry; if(!g) return;
    if(g.index&&g.index.count) tris+=g.index.count/3;
    else if(g.attributes?.position) tris+=g.attributes.position.count/3;
    if(g.attributes?.position) verts+=g.attributes.position.count;
  });
  const box=new THREE.Box3().setFromObject(root);
  const size=new THREE.Vector3(); box.getSize(size);
  try{ const s=(root?.scale?.x)||1; if(s&&s!==0) size.divideScalar(s); }catch(e){}
  try{ const mx=Math.max(size.x,size.y,size.z); if(mx<1) size.multiplyScalar(1000); }catch(e){}
  return{meshes,materials,tris:Math.round(tris),verts:Math.round(verts),drawCalls,
    bbox:{w:+size.x.toFixed(3),h:+size.y.toFixed(3),d:+size.z.toFixed(3)}};
}

if(btnShowStats){
  // 統計パネルをダブルクリックで閉じる
  statsPanel.addEventListener('dblclick', () => {
    statsPanel.style.display = 'none';
  });
  statsPanel.title = 'ダブルクリックで閉じる';

  btnShowStats.onclick=()=>{
    if(!current) return;
    const s=computeStats(current);
    const show=(statsPanel.style.display==='none'||statsPanel.style.display==='');
    statsPanel.style.display=show?'block':'none';
    if(show){
      statsPanel.textContent=
`📐 3Dモデル統計情報

メッシュ数: ${s.meshes}
マテリアル数: ${s.materials}
三角形数: ${s.tris.toLocaleString()}
頂点数: ${s.verts.toLocaleString()}
ドローコール: ${s.drawCalls}

サイズ (${kasanenUnitLabel()})
  W: ${kasanenMmToDisplay(s.bbox.w * kasanenGeoScale()).toFixed(1)}
  H: ${kasanenMmToDisplay(s.bbox.h * kasanenGeoScale()).toFixed(1)}
  D: ${kasanenMmToDisplay(s.bbox.d * kasanenGeoScale()).toFixed(1)}`;
    }
  };
}


// ================================================================
// 起動時処理：HTMLで指定された既定モデルがあれば自動読み込み、なければ通常起動
// ================================================================
window.addEventListener('DOMContentLoaded', async () => {
  const navMenu = document.getElementById('btnMenu');
  const navTsuyoin = document.getElementById('btnTsuyoin');
  const navKidorin = document.getElementById('btnKidorin');
  if (navMenu) navMenu.onclick = () => { window.location.href = 'index.html'; };
  if (navTsuyoin) navTsuyoin.onclick = () => { window.location.href = 'kidori.html?openStrength=1&headless=1'; };
  if (navKidorin) navKidorin.onclick = () => { window.location.href = 'kidori.html'; };

  // 単位切替ボタン
  const unitBtn = document.getElementById('btnUnitToggle');
  if (unitBtn) {
    unitBtn.textContent = kasanenUnitMode;
    unitBtn.addEventListener('click', () => {
      const next = kasanenUnitMode === 'mm' ? 'cm' : 'mm';
      saveUnitMode(next);
      unitBtn.textContent = next;
      // 寸法表示を更新
      if (dimensionsOn) setDimensionsVisible(true);
    });
  }

  const sharedLoaded = await tryLoadSharedStl();
  if (sharedLoaded) return;
  const loaded = await tryLoadDefaultModel();
  if (!loaded) showNormalStartup();
});


// ================================================================
// スタート画像クリック時処理
// HTMLで指定された既定モデルがあれば読み込み、なければ通常起動
// ================================================================
const startOverlay = document.getElementById('startOverlay');
const startImage   = document.getElementById('startImage');

if (startImage) {
  startImage.addEventListener('click', async () => {
    const loaded = await tryLoadDefaultModel();

    if (loaded) {
      if (startOverlay) startOverlay.style.display = 'none';
    } else {
      showNormalStartup();
    }
  });
}

