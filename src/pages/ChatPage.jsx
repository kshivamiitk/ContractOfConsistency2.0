// src/pages/ChatPage.jsx
// NOTE: assumes src/supabaseClient.js exports `supabase` (v2 client)
import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

const BUCKET = 'chat-uploads';
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB
const UNREAD_STORAGE_KEY = 'chat-unread-v1';
const NOTIF_PREF_KEY = 'chat-notif-prefs-v1';

function formatTS(ts) { return ts ? dayjs(ts).format('HH:mm YYYY-MM-DD') : ''; }
function tsToMillis(ts) { return ts ? new Date(ts).getTime() : 0; }

export default function ChatPage({ session }) {
  const myId = session?.user?.id;
  const myEmail = session?.user?.email || '';

  // basic state
  const [profiles, setProfiles] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const activeRoomRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const namesRef = useRef({ [myId]: myEmail });
  const messagesContainerRef = useRef(null);
  const [showNewMessageBtn, setShowNewMessageBtn] = useState(false);

  // unread counts persisted locally
  const [unreadCounts, setUnreadCounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(UNREAD_STORAGE_KEY) || '{}'); } catch (e) { return {}; }
  });

  // notification prefs persisted locally
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(NOTIF_PREF_KEY) || JSON.stringify({ enabled: true, sound: true })); } catch (e) { return { enabled: true, sound: true }; }
  });

  // editing state
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);

  // keep document title updated with unread count
  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((s, v) => s + (v || 0), 0);
    if (totalUnread > 0) {
      document.title = `(${totalUnread}) Chat`;
      useEffect(() => {
        if (typeof onUnreadChange === 'function') {
          onUnreadChange(totalUnread);
        }
      }, [totalUnread, onUnreadChange]);
    } else {
      document.title = 'Chat';
    }
  }, [unreadCounts]);

  // persist unread counts
  useEffect(() => {
    try { localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(unreadCounts || {})); } catch (e) {}
  }, [unreadCounts]);

  // persist notif prefs
  useEffect(() => {
    try { localStorage.setItem(NOTIF_PREF_KEY, JSON.stringify(notifPrefs)); } catch (e) {}
  }, [notifPrefs]);

  useEffect(() => {
    if (!myId) return;
    init();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  async function init() {
    // after you load rooms (inside init() or after loadRooms())
try {
    const targetRoom = localStorage.getItem('chat-open-room');
    if (targetRoom) {
      localStorage.removeItem('chat-open-room');
      // try to fetch the room and open it
      const { data: r } = await supabase.from('chat_rooms').select('*').eq('id', targetRoom).maybeSingle();
      if (r) openRoom(r);
    }
  } catch (e) { console.warn('open-target-room error', e); }
  
    await Promise.all([loadProfiles(), loadRooms()]);
    setupRealtime();
    window.addEventListener('paste', handlePaste);
    window.addEventListener('message', handleWindowMessage);
  }


  async function cleanup() {
    try {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('message', handleWindowMessage);
      if (channelRef.current) {
        await channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    } catch (err) { console.warn('cleanup err', err); }
  }

  function handleWindowMessage(e) {
    // open room from notification click
    try {
      const payload = e?.data || {};
      if (payload?.type === 'open_room' && payload.roomId) {
        // try to find room locally first
        const room = rooms.find(r => r.id === payload.roomId);
        if (room) openRoom(room);
        else {
          // fetch and open
          (async () => {
            const { data } = await supabase.from('chat_rooms').select('*').eq('id', payload.roomId).maybeSingle();
            if (data) openRoom(data);
          })();
        }
        window.focus?.();
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------- Profiles and Rooms ----------------
  async function loadProfiles() {
    try {
      const { data, error } = await supabase.from('profiles').select('id, full_name, public_profile').order('created_at', { ascending: true });
      if (error) { console.error(error); setProfiles([]); return; }
      const list = (data || []).filter(p => p && p.id && p.id !== myId && (p.public_profile ?? true)).map(p => ({ id: p.id, name: p.full_name || p.id }));
      list.forEach(u => (namesRef.current[u.id] = u.name || u.id));
      setProfiles(list);
    } catch (err) { console.error('loadProfiles', err); setProfiles([]); }
  }

  function sortRooms(list) {
    return (list || []).slice().sort((a, b) => tsToMillis(b.last_ts || b.created_at) - tsToMillis(a.last_ts || a.created_at));
  }

  async function loadRooms() {
    try {
      const { data, error } = await supabase.from('chat_rooms').select('*').order('created_at', { ascending: false });
      if (error) { console.error(error); setRooms([]); return; }
      const mine = (data || []).filter(r => Array.isArray(r.metadata?.participants) && r.metadata.participants.includes(myId));
      setRooms(sortRooms(mine));
      // keep existing unread counts for these rooms
      setUnreadCounts(prev => {
        const keep = {};
        (mine || []).forEach(r => { if (prev[r.id]) keep[r.id] = prev[r.id]; });
        return { ...prev, ...keep };
      });
    } catch (err) { console.error(err); setRooms([]); }
  }

  // ---------------- Open room, fetch messages ----------------
  async function openRoom(room) {
    setActiveRoom(room);
    setMessages([]);
    await fetchMessages(room);
    // mark read for this room
    clearUnread(room.id);
    // scroll to bottom
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }));
  }

  async function fetchMessages(room) {
    if (!room) return;
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('room_id', room.id).order('created_at', { ascending: true }).limit(1000);
      if (error) { console.error(error); setMessages([]); return; }
      const normalized = (data || []).map(m => ({ ...m, attachments: m.attachments || [] }));
      await Promise.all(normalized.map(async (m) => {
        if (m.attachments && m.attachments.length > 0) {
          for (const att of m.attachments) {
            if (!att.url && att.path) att.url = await safeGetUrlForPath(att.path);
          }
        }
      }));
      setMessages(normalized);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }));
    } catch (err) { console.error('fetchMessages', err); setMessages([]); }
  }

  // ---------------- Realtime & incoming messages ----------------
  function setupRealtime() {
    if (channelRef.current) return;
    const ch = supabase.channel('public:chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new;
        if (!msg) return;
        (async () => {
          // ensure attachments urls
          if (msg.attachments && msg.attachments.length > 0) {
            for (const att of msg.attachments) {
              if (!att.url && att.path) att.url = await safeGetUrlForPath(att.path);
            }
          }
          // update rooms preview list
          updateRoomFromMessage(msg);
          // if msg for currently open room
          if (activeRoomRef.current && msg.room_id === activeRoomRef.current.id) {
            setMessages(cur => [...cur, msg]);
            // auto-scroll or show new button/unread
            if (isNearBottom()) {
              requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
            } else {
              setShowNewMessageBtn(true);
              incrementUnread(msg.room_id);
              maybeNotify(msg);
            }
          } else {
            // not current room -> increment unread & notify
            incrementUnread(msg.room_id);
            maybeNotify(msg);
          }
          // ensure room exists in left list
          try {
            const { data: r } = await supabase.from('chat_rooms').select('*').eq('id', msg.room_id).maybeSingle();
            if (r) upsertRoomPreview(r);
          } catch (_) {}
        })();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_rooms' }, (payload) => {
        const r = payload.new;
        if (!r) return;
        const parts = r.metadata?.participants || [];
        if (Array.isArray(parts) && parts.includes(myId)) setRooms(prev => sortRooms([r, ...prev]));
      })
      .subscribe();
    channelRef.current = ch;
  }

  function upsertRoomPreview(newRoom) {
    setRooms(prev => {
      const copy = prev.filter(r => r.id !== newRoom.id);
      copy.unshift(newRoom);
      return sortRooms(copy);
    });
  }

  function updateRoomFromMessage(msg) {
    setRooms(prev => {
      const copy = prev.map(r => r.id === msg.room_id ? { ...r, last_message: msg.content, last_ts: msg.created_at } : r);
      return sortRooms(copy);
    });
  }

  // ---------------- Storage helpers (files) ----------------
  async function safeGetUrlForPath(path) {
    if (!path) return null;
    try {
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub?.publicUrl || pub?.public_url || pub?.url || null;
      if (publicUrl) return publicUrl;
    } catch (e) {}
    try {
      const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      if (!error && (signed?.signedUrl || signed?.signed_url)) return signed.signedUrl ?? signed.signed_url;
    } catch (e) { console.warn('createSignedUrl failed', e); }
    return null;
  }

  async function uploadFiles(roomId, fileArray) {
    if (!fileArray || fileArray.length === 0) return [];
    const results = [];
    for (const file of fileArray) {
      if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} exceeds max size of ${Math.round(MAX_FILE_SIZE / (1024*1024))} MB`);
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `uploads/${roomId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${safeName}`;
      const { data, error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) { console.error('storage.upload error', error); throw error; }
      const url = await safeGetUrlForPath(data.path);
      results.push({ name: file.name, size: file.size, type: file.type, path: data.path, url });
    }
    return results;
  }

  // ---------------- Create/find 1:1 room ----------------
  async function openDirectRoom(otherId, otherName) {
    if (!myId || !otherId) return;
    try {
      let found = rooms.find(r => {
        const parts = r.metadata?.participants || [];
        return Array.isArray(parts) && parts.includes(myId) && parts.includes(otherId) && parts.length === 2;
      });
      if (!found) {
        const { data: allRooms } = await supabase.from('chat_rooms').select('*');
        if (allRooms) {
          found = allRooms.find(r => {
            const parts = r.metadata?.participants || [];
            return Array.isArray(parts) && parts.includes(myId) && parts.includes(otherId) && parts.length === 2;
          });
        }
      }
      if (found) { if (!rooms.some(r => r.id === found.id)) setRooms(prev => sortRooms([found, ...prev])); openRoom(found); return; }
      const participantsArr = [myId, otherId].sort();
      const metadata = { participants: participantsArr, participant_names: [namesRef.current[participantsArr[0]] || participantsArr[0], namesRef.current[participantsArr[1]] || participantsArr[1]] };
      const { data, error } = await supabase.from('chat_rooms').insert({ title: `Chat: ${otherName}`, is_private: true, metadata }).select().single();
      if (error) { console.error('create room error', error); return; }
      setRooms(prev => sortRooms([data, ...prev]));
      openRoom(data);
    } catch (err) { console.error('openDirectRoom unexpected', err); }
  }

  // ---------------- Send message ----------------
  async function sendMessageWithFiles() {
    if (!activeRoom) { alert('Open a room first'); return; }
    if (!text.trim() && pendingFiles.length === 0) return;
    setUploading(true);
    try {
      let attachments = [];
      if (pendingFiles.length > 0) {
        const files = pendingFiles.map(p => p.file);
        attachments = await uploadFiles(activeRoom.id, files);
      }
      const payload = { room_id: activeRoom.id, sender_id: myId, content: text.trim() || null, attachments };
      const optimistic = { id: `tmp-${Date.now()}`, ...payload, created_at: new Date().toISOString(), optimistic: true };
      setMessages(cur => [...cur, optimistic]);
      setText(''); clearPendingFiles();
      const { data, error } = await supabase.from('messages').insert(payload).select().single();
      if (error) { console.error('insert message err', error); setMessages(cur => cur.map(m => m.id === optimistic.id ? { ...m, failed: true } : m)); setUploading(false); return; }
      setMessages(cur => { const filtered = cur.filter(m => m.id !== optimistic.id); return [...filtered, data]; });
      setRooms(prev => sortRooms(prev.map(r => r.id === activeRoom.id ? { ...r, last_message: payload.content || '[Attachment]', last_ts: data.created_at } : r)));
      // you sent it -> clear unread for this room
      clearUnread(activeRoom.id);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (err) { console.error('sendMessageWithFiles err', err); alert(err.message || 'Failed to send message'); } finally { setUploading(false); }
  }

  // ---------------- Edit/Delete messages ----------------
  async function startEditing(msg) {
    if (msg.sender_id !== myId) return;
    setEditingMessageId(msg.id);
    setEditingText(msg.content || '');
  }
  async function saveEdit(msgId) {
    const newContent = editingText.trim();
    if (newContent === '') { alert('Message cannot be empty'); return; }
    setMessages(cur => cur.map(m => m.id === msgId ? { ...m, content: newContent, saving: true } : m));
    setEditingMessageId(null);
    setEditingText('');
    try {
      const { data, error } = await supabase.from('messages').update({ content: newContent }).eq('id', msgId).select().single();
      if (error) { console.error('edit err', error); alert('Failed to edit message'); setMessages(cur => cur.map(m => m.id === msgId ? { ...m, saving: false, failed_edit: true } : m)); return; }
      setMessages(cur => cur.map(m => m.id === msgId ? data : m));
    } catch (err) { console.error('saveEdit unexpected', err); setMessages(cur => cur.map(m => m.id === msgId ? { ...m, failed_edit: true } : m)); }
  }
  async function deleteMessage(msgId) {
    if (!confirm('Delete this message? This will mark it as deleted.')) return;
    setMessages(cur => cur.map(m => m.id === msgId ? { ...m, content: '[deleted]', attachments: [], deleting: true } : m));
    try {
      const { data, error } = await supabase.from('messages').update({ content: '[deleted]', attachments: [] }).eq('id', msgId).select().single();
      if (error) { console.error('delete err', error); alert('Failed to delete message'); setMessages(cur => cur.map(m => m.id === msgId ? { ...m, deleting: false } : m)); return; }
      setMessages(cur => cur.map(m => m.id === msgId ? data : m));
    } catch (err) { console.error('deleteMessage unexpected', err); setMessages(cur => cur.map(m => m.id === msgId ? { ...m, deleting: false } : m)); }
  }

  // ---------------- Pending files UI ----------------
  function addPendingFiles(fileList) {
    const files = Array.from(fileList || []);
    const newItems = [];
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) { alert(`${f.name} exceeds max size of ${Math.round(MAX_FILE_SIZE/(1024*1024))} MB`); continue; }
      const previewUrl = URL.createObjectURL(f);
      newItems.push({ file: f, previewUrl });
    }
    setPendingFiles(cur => [...cur, ...newItems]);
  }
  function removePendingFile(index) {
    setPendingFiles(cur => { const copy = [...cur]; const [removed] = copy.splice(index, 1); if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl); return copy; });
  }
  function clearPendingFiles() {
    setPendingFiles(cur => { cur.forEach(it => it.previewUrl && URL.revokeObjectURL(it.previewUrl)); return []; });
  }

  // cleanup previews on unmount
  useEffect(() => () => { pendingFiles.forEach(it => it.previewUrl && URL.revokeObjectURL(it.previewUrl)); }, [pendingFiles]);

  // ---------------- Drag & Drop ----------------
  function onDragOver(e) { e.preventDefault(); setDragOver(true); }
  function onDragLeave(e) { e.preventDefault(); setDragOver(false); }
  function onDrop(e) { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer?.files || []); if (files.length > 0) addPendingFiles(files); }

  // make sure attachments have urls
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updated = [];
      for (const m of messages) {
        let changed = false;
        if (m.attachments && m.attachments.length) {
          for (const att of m.attachments) {
            if (!att.url && att.path) {
              const url = await safeGetUrlForPath(att.path);
              if (url) { att.url = url; changed = true; }
            }
          }
        }
        if (changed) updated.push(m);
      }
      if (!cancelled && updated.length) setMessages(cur => cur.map(msg => updated.find(u => u.id === msg.id) || msg));
    })();
    return () => { cancelled = true; };
  }, [messages.length]);

  // ---------------- Scroll helpers ----------------
  function isNearBottom() {
    const el = messagesContainerRef.current;
    if (!el) return true;
    const threshold = 150;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < threshold;
  }
  function maybeAutoScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (isNearBottom()) { requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })); setShowNewMessageBtn(false); } else setShowNewMessageBtn(true);
  }
  useEffect(() => { maybeAutoScroll(); }, [messages.length]);
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => { if (isNearBottom()) setShowNewMessageBtn(false); };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ---------------- Unread helpers ----------------
  function incrementUnread(roomId) {
    if (!roomId) return;
    setUnreadCounts(prev => { const next = { ...(prev || {}) }; next[roomId] = (next[roomId] || 0) + 1; try { localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(next)); } catch (e) {} return next; });
  }
  function clearUnread(roomId) {
    if (!roomId) return;
    setUnreadCounts(prev => { if (!prev || !prev[roomId]) return prev; const copy = { ...prev }; delete copy[roomId]; try { localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(copy)); } catch (e) {} return copy; });
  }

  // ---------------- Notifications ----------------
  // small beep audio (tiny silent blob replaced with simple sine would be larger; short base64 silent wiggle used)
  const beepData = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

  async function requestNotificationPermission() {
    try {
      if (!('Notification' in window)) { alert('Notifications are not supported in this browser.'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') alert('Notifications not granted. You can enable from browser settings.');
    } catch (e) { console.warn('requestNotificationPermission', e); }
  }

  function playBeep() {
    try {
      if (!notifPrefs.sound) return;
      const audio = new Audio(beepData);
      audio.volume = 0.5;
      audio.play().catch(()=>{});
    } catch (e) {}
  }

  // Make a desktop notification when appropriate
  function maybeNotify(msg) {
    try {
      if (!notifPrefs.enabled) return;
      if (!msg) return;
      if (msg.sender_id === myId) return; // don't notify yourself
      // don't spam: show notification if room not active OR window not focused OR not near bottom
      const roomIsActive = activeRoomRef.current && activeRoomRef.current.id === msg.room_id;
      const windowFocused = document.hasFocus();
      const nearBottom = isNearBottom();
      const shouldNotify = !roomIsActive || !windowFocused || !nearBottom;
      if (!shouldNotify) return;
      // show Notification if allowed
      if (Notification && Notification.permission === 'granted') {
        const title = namesRef.current[msg.sender_id] || 'New message';
        const body = msg.content ? (msg.content.length > 120 ? msg.content.slice(0, 117) + '...' : msg.content) : (msg.attachments && msg.attachments.length ? 'Attachment(s)' : 'New message');
        const n = new Notification(title, { body, tag: `chat-msg-${msg.room_id}`, renotify: true });
        n.onclick = () => {
          window.focus();
          // send a message to the page to open the room (safe cross-scope)
          window.postMessage({ type: 'open_room', roomId: msg.room_id }, '*');
          n.close();
        };
        playBeep();
      } else {
        // if permission not granted, optionally request it automatically the first time user enables
        // (we only prompt when notifPrefs.enabled is true and permission is 'default')
        if (Notification && Notification.permission === 'default') {
          // don't block; request permission in background
          Notification.requestPermission().then(p => {
            if (p === 'granted') {
              // show one immediate notification
              maybeNotify(msg);
            }
          }).catch(()=>{});
        } else {
          // fallback: play beep only
          playBeep();
        }
      }
    } catch (e) { console.warn('maybeNotify', e); }
  }

  // allow user to toggle notification preferences
  function toggleNotifications() {
    const next = { ...notifPrefs, enabled: !notifPrefs.enabled };
    setNotifPrefs(next);
    // request permission if enabling
    if (next.enabled && Notification && Notification.permission === 'default') requestNotificationPermission();
  }
  function toggleSound() {
    setNotifPrefs(prev => ({ ...prev, sound: !prev.sound }));
  }

  // ---------------- UI Render ----------------
  const totalUnread = Object.values(unreadCounts).reduce((s, v) => s + (v || 0), 0);

  return (
    <div style={{ display: 'flex', gap: 16, fontFamily: 'Inter, system-ui, -apple-system, Roboto, Helvetica, Arial', padding: 16, background: '#f5f7fb', height: 'calc(100vh - 32px)', overflow: 'hidden' }}>
      <aside style={{ width: 320, background: '#fff', padding: 16, borderRadius: 12, boxShadow: '0 6px 18px rgba(23,31,63,0.05)', position: 'sticky', top: 16, alignSelf: 'flex-start', height: 'calc(100vh - 48px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>People</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={loadProfiles} style={{ padding: '6px 10px', borderRadius: 8 }}>Refresh</button>
            <button onClick={loadRooms} style={{ padding: '6px 10px', borderRadius: 8 }}>Rooms</button>
          </div>
        </div>

        {/* notification toggles */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={notifPrefs.enabled} onChange={toggleNotifications} /> Notifications
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={notifPrefs.sound} onChange={toggleSound} /> Sound
          </label>
        </div>

        <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 8, paddingRight: 8 }}>
          {profiles.length === 0 ? <div style={{ color: '#666' }}>No participants found</div> : profiles.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 36, height: 36, borderRadius: 18, background: '#e6eef8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{(p.name || '').slice(0,1).toUpperCase()}</div>
                <div>{p.name}</div>
              </div>
              <button onClick={() => openDirectRoom(p.id, p.name)} style={{ padding: '6px 10px', borderRadius: 8 }}>Chat</button>
            </div>
          ))}
        </div>

        <hr style={{ margin: '14px 0', border: 'none', borderTop: '1px solid #f1f5f9' }} />
        <h4 style={{ margin: '0 0 8px 0' }}>Your rooms {totalUnread > 0 && <span style={{ color: '#ef4444', marginLeft: 6 }}>({totalUnread} unread)</span>}</h4>
        <div style={{ maxHeight: 'calc(100% - 360px)', overflowY: 'auto', paddingRight: 8 }}>
          {rooms.length === 0 && <div style={{ color: '#666' }}>No rooms yet</div>}
          {rooms.map(r => (
            <div key={r.id} onClick={() => { openRoom(r); clearUnread(r.id); }} style={{ padding: 12, borderRadius: 8, background: activeRoom?.id === r.id ? '#eef6ff' : '#fff', cursor: 'pointer', border: '1px solid #f1f5f9', marginBottom: 10, position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>{r.title || r.metadata?.participant_names?.join(', ')}</div>
                <small style={{ color: '#888' }}>{r.last_ts ? formatTS(r.last_ts) : ''}</small>
              </div>
              <div style={{ color: '#666', fontSize: 13, marginTop: 6 }}>{r.last_message ? (r.last_message.slice(0, 80)) : <i>No messages</i>}</div>

              {/* unread badge */}
              {unreadCounts && unreadCounts[r.id] > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  minWidth: 20,
                  height: 20,
                  padding: '0 6px',
                  background: '#ef4444',
                  color: 'white',
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700
                }}>
                  {unreadCounts[r.id] > 99 ? '99+' : unreadCounts[r.id]}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          style={{
            background: '#fff',
            padding: 16,
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            border: dragOver ? '2px dashed #66a' : '1px solid transparent',
            boxShadow: '0 8px 30px rgba(20,28,48,0.04)',
            height: '100%'
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {activeRoom ? <>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0 }}>{activeRoom.title}</h3>
                <div style={{ color: '#666', fontSize: 13 }}>{(activeRoom.metadata?.participant_names || []).join(', ')}</div>
              </div>
              <div style={{ color: '#666', fontSize: 12 }}>{activeRoom.is_private ? 'Private' : 'Public'}</div>
            </header>

            <div ref={messagesContainerRef} style={{ flex: 1, overflowY: 'auto', marginTop: 12, paddingRight: 8, paddingBottom: 8 }}>
              {messages.map(m => (
                <div key={m.id} style={{ marginBottom: 12, display: 'flex', gap: 8, justifyContent: m.sender_id === myId ? 'flex-end' : 'flex-start' }}>
                  {m.sender_id !== myId && (
                    <div style={{ width: 36, height: 36, borderRadius: 18, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{(getDisplayName(m.sender_id)||'').slice(0,1).toUpperCase()}</div>
                  )}

                  <div style={{ maxWidth: '78%', position: 'relative' }}>
                    <div style={{ background: m.sender_id === myId ? '#dcf8c6' : '#f7f8fa', padding: 12, borderRadius: 12, boxShadow: '0 4px 14px rgba(22,28,45,0.03)' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{getDisplayName(m.sender_id)}</div>
                        <div style={{ fontSize: 11, color: '#666' }}>{formatTS(m.created_at)}</div>
                        {(m.updated_at && m.updated_at !== m.created_at) && <div style={{ fontSize: 11, color: '#666' }}>• edited</div>}
                      </div>

                      {editingMessageId === m.id ? (
                        <div style={{ marginTop: 8 }}>
                          <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd' }} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m.id); } }} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button onClick={() => saveEdit(m.id)} style={{ padding: '6px 10px' }}>Save</button>
                            <button onClick={() => { setEditingMessageId(null); setEditingText(''); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                      )}

                      {m.attachments && Array.isArray(m.attachments) && m.attachments.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {m.attachments.map((att, i) => {
                            const isImage = att.type?.startsWith('image/');
                            const isVideo = att.type?.startsWith('video/');
                            if (isImage) return (
                              <img key={i} src={att.url} alt={att.name} style={{ maxWidth: 300, borderRadius: 8, cursor: 'pointer' }} onClick={() => setLightbox({ src: att.url, name: att.name })} />
                            );
                            if (isVideo) return <video key={i} src={att.url} controls style={{ maxWidth: 360, borderRadius: 8 }} />;
                            return <a key={i} href={att.url} target="_blank" rel="noreferrer" style={{ padding: '6px 8px', border: '1px solid #eee', borderRadius: 6 }}>{att.name}</a>;
                          })}
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: '#666' }}>{m.failed ? 'Failed to send' : m.optimistic ? 'Sending...' : ''}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {m.sender_id === myId && !m.optimistic && !m.failed && (
                            <>
                              <button onClick={() => startEditing(m)} style={{ padding: '4px 8px', fontSize: 12 }}>Edit</button>
                              <button onClick={() => deleteMessage(m.id)} style={{ padding: '4px 8px', fontSize: 12 }}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {m.sender_id === myId && (
                    <div style={{ width: 36, height: 36, borderRadius: 18, background: '#dcf8c6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{(getDisplayName(m.sender_id)||'').slice(0,1).toUpperCase()}</div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {showNewMessageBtn && (
              <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 110 }}>
                <button onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowNewMessageBtn(false); }} style={{ padding: '8px 12px', borderRadius: 20, boxShadow: '0 6px 18px rgba(20,28,48,0.08)' }}>New messages</button>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message... (press Enter to send, Shift+Enter for newline)" style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px solid #e6eef8', minHeight: 56, resize: 'vertical' }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessageWithFiles(); } }} />

                <label style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <input type="file" multiple accept="image/*,video/*,application/pdf,application/zip" style={{ display: 'none' }} onChange={(e) => { addPendingFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
                  <button style={{ padding: '10px 12px', borderRadius: 12 }}>📎</button>
                </label>

                <button onClick={sendMessageWithFiles} disabled={uploading || (!text.trim() && pendingFiles.length === 0)} style={{ padding: '10px 14px', borderRadius: 12 }}>{uploading ? 'Sending...' : 'Send'}</button>
              </div>

              {pendingFiles.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto' }}>
                  {pendingFiles.map((p, i) => {
                    const f = p.file;
                    const isImage = f.type?.startsWith('image/');
                    const isVideo = f.type?.startsWith('video/');
                    const url = p.previewUrl;
                    return (
                      <div key={i} style={{ border: '1px solid #eee', padding: 8, borderRadius: 8, minWidth: 140, background: '#fff' }}>
                        {isImage && <img src={url} alt={f.name} style={{ width: 180, height: 110, objectFit: 'cover', borderRadius: 8 }} />}
                        {isVideo && <video src={url} style={{ width: 180, height: 110 }} controls />}
                        {!isImage && !isVideo && <div style={{ fontSize: 12 }}>{f.name}</div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                          <small style={{ fontSize: 11 }}>{Math.round(f.size/1024)} KB</small>
                          <button onClick={() => removePendingFile(i)} style={{ fontSize: 12 }}>Remove</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </> : <div style={{ color: '#666' }}>Select a participant or room to start chatting. You can paste images (Ctrl/Cmd+V) or drag files into this area.</div>}
        </div>
      </main>

      {/* Lightbox modal for image preview */}
      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80 }}>
          <div style={{ maxWidth: '92%', maxHeight: '92%', background: '#fff', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{lightbox.name}</div>
              <div>
                <a href={lightbox.src} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>Open</a>
                <button onClick={() => setLightbox(null)}>Close</button>
              </div>
            </div>
            <div style={{ maxWidth: '88vw', maxHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={lightbox.src} alt={lightbox.name} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 6 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // helper to get display name
  function getDisplayName(id) { return namesRef.current[id] || id; }

  // helper to check near-bottom (used by realtime handler)
  function isNearBottom() {
    const el = messagesContainerRef.current;
    if (!el) return true;
    const threshold = 150;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < threshold;
  }

  // increment unread counts exported above
  function incrementUnread(roomId) {
    if (!roomId) return;
    setUnreadCounts(prev => { const next = { ...(prev || {}) }; next[roomId] = (next[roomId] || 0) + 1; try { localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(next)); } catch (e) {} return next; });
  }
  function clearUnread(roomId) {
    if (!roomId) return;
    setUnreadCounts(prev => { if (!prev || !prev[roomId]) return prev; const copy = { ...prev }; delete copy[roomId]; try { localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(copy)); } catch (e) {} return copy; });
  }
}
