// src/utils/storage.js
export const saveJSON = (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} };
export const loadJSON = (k, fallback=null) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; } catch(e) { return fallback; } };
export const removeKey = (k) => { try { localStorage.removeItem(k); } catch(e) {} };
