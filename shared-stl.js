/* 3アプリ共通STL保存 v1.3
 * 小さなSTLはlocalStorage、大きなSTLはIndexedDBへ保存する。
 * 同一タブ内の遷移ではsessionStorageも併用し、読み込み失敗を避ける。

 * Copyright (c) 2026 Hiroyuki Muramatsu / Shinshu-u
 * https://gijyutu.com/main/
 * Released under the MIT License
 */
(function(){
  if(window.SharedStl && window.SharedStl.version === '1.3') return;
  const CURRENT='kidorin_current_stl';
  const PENDING='kidorin_pending_strength_stl';
  const SESSION='kidorin_session_stl';
  const DB_NAME='kidorin_shared_stl_db';
  const STORE='files';
  const RECORD='current';
  const MAX_LOCAL_CHARS=3_500_000;


  function dataUrlToArrayBuffer(dataUrl){
    const arr=String(dataUrl||'').split(',');
    if(arr.length<2) throw new Error('共有STLのData URLが壊れています');
    const bin=atob(arr[1]||'');
    const u8=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    return u8.buffer;
  }
  function safeParse(raw){ try{return raw?JSON.parse(raw):null;}catch(e){return null;} }
  function readWebStorage(key){
    try{return safeParse(sessionStorage.getItem(key)) || safeParse(localStorage.getItem(key));}
    catch(e){return null;}
  }
  function removeWebStorage(key){
    try{sessionStorage.removeItem(key);}catch(e){}
    try{localStorage.removeItem(key);}catch(e){}
  }
  function writeSmall(value, pending){
    const raw=JSON.stringify(value);
    try{sessionStorage.setItem(SESSION, raw);}catch(e){}
    if(raw.length <= MAX_LOCAL_CHARS){
      try{localStorage.setItem(CURRENT, raw);}catch(e){}
      if(pending){ try{localStorage.setItem(PENDING, raw);}catch(e){} }
    }
  }
  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error || new Error('IndexedDB open failed'));
    });
  }
  async function idbSet(value){
    const db=await openDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(value,RECORD);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error || new Error('IndexedDB write failed'));
      tx.onabort=()=>reject(tx.error || new Error('IndexedDB write aborted'));
    });
    db.close();
  }
  async function idbGet(){
    const db=await openDb();
    const value=await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const req=tx.objectStore(STORE).get(RECORD);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error || new Error('IndexedDB read failed'));
    });
    db.close();
    return value;
  }
  async function idbClear(){
    try{
      const db=await openDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).delete(RECORD);
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error);
      });
      db.close();
    }catch(e){}
  }

  window.SharedStl={
    version:'1.3',
    get(){ return readWebStorage(PENDING) || readWebStorage(SESSION) || readWebStorage(CURRENT); },
    async getAsync(){
      const quick=this.get();
      if(quick && quick.dataUrl) return quick;
      for(let i=0;i<3;i++){
        try{ const value=await idbGet(); if(value&&value.dataUrl) return value; }catch(e){}
        await new Promise(r=>setTimeout(r,80*(i+1)));
      }
      return null;
    },
    has(){ const v=this.get(); return !!(v&&v.dataUrl); },
    async hasAsync(){ const v=await this.getAsync(); return !!(v&&v.dataUrl); },
    set(value,options){
      if(!value||!value.dataUrl) return false;
      writeSmall(value,!!(options&&options.pending));
      idbSet(value).catch(e=>console.warn('STLのIndexedDB保存に失敗しました',e));
      return true;
    },
    async setAsync(value,options){
      if(!value||!value.dataUrl) return false;
      writeSmall(value,!!(options&&options.pending));
      try{await idbSet(value);}catch(e){
        const fallback=this.get();
        if(!(fallback&&fallback.dataUrl)) throw e;
      }
      return true;
    },
    dataUrlToArrayBuffer,
    removePending(){ removeWebStorage(PENDING); },
    async clear(){
      removeWebStorage(CURRENT); removeWebStorage(PENDING); removeWebStorage(SESSION);
      await idbClear();
    }
  };
})();
