// src/pages/ChatPage.jsx (replacement)
// NOTE: assumes src/supabaseClient.js exports `supabase` (v2 client)
import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

const BUCKET = 'chat-uploads';
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB

function formatTS(ts) { return ts ? dayjs(ts).format('HH:mm YYYY-MM-DD') : ''; }

export default function ChatPage({ session }) {
  const myId = session?.user?.id;
  const myEmail = session?.user?.email || '';
  const [profiles, setProfiles] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]); // items: { file, previewUrl }
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { src, name }
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const namesRef = useRef({ [myId]: myEmail });

  useEffect(() => {
    if (!myId) return;
    init();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  async function init() {
    await Promise.all([loadProfiles(), loadRooms()]);
    setupRealtime();
    // global paste handler for images
    window.addEventListener('paste', handlePaste);
  }

  async function cleanup() {
    try {
      window.removeEventListener('paste', handlePaste);
      if (channelRef.current) {
        await channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    } catch (err) { console.warn('cleanup err', err); }
  }

  // ---- paste handler (images from clipboard) ----
  function handlePaste(e) {
    if (!e.clipboardData) return;
    const items = Array.from(e.clipboardData.items || []);
    const files = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const file = it.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      addPendingFiles(files);
    }
  }

  // ---- load participants from profiles table ----
  async function loadProfiles() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, public_profile')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('profiles select err', error);
        setProfiles([]);
        return;
      }

      const list = (data || [])
        .filter(p => p && p.id && p.id !== myId && (p.public_profile ?? true))
        .map(p => ({ id: p.id, name: p.full_name || p.id }));
      list.forEach(u => (namesRef.current[u.id] = u.name || u.id));
      setProfiles(list);
      console.info('Profiles loaded:', list.length);
    } catch (err) {
      console.error('loadProfiles unexpected', err);
      setProfiles([]);
    }
  }

  // ---- load rooms ----
  async function loadRooms() {
    try {
      const { data, error } = await supabase.from('chat_rooms').select('*').order('created_at', { ascending: false });
      if (error) { console.error('chat_rooms select err', error); setRooms([]); return; }
      const mine = (data || []).filter(r => Array.isArray(r.metadata?.participants) && r.metadata.participants.includes(myId));
      setRooms(mine);
    } catch (err) { console.error('loadRooms unexpected', err); setRooms([]); }
  }

  // ---- open room & load messages ----
  async function openRoom(room) {
    setActiveRoom(room);
    setMessages([]);
    await fetchMessages(room);
  }

  async function fetchMessages(room) {
    if (!room) return;
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('room_id', room.id).order('created_at', { ascending: true }).limit(200);
      if (error) { console.error('fetchMessages err', error); setMessages([]); return; }
      // normalize attachments
      const normalized = (data || []).map(m => ({ ...m, attachments: m.attachments || [] }));
      // ensure attachment URLs are present
      await Promise.all(normalized.map(async (m) => {
        if (m.attachments && m.attachments.length > 0) {
          for (const att of m.attachments) {
            if (!att.url && att.path) {
              att.url = await safeGetUrlForPath(att.path);
            }
          }
        }
      }));
      setMessages(normalized);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    } catch (err) {
      console.error('fetchMessages unexpected', err);
      setMessages([]);
    }
  }

  // ---- realtime ----
  function setupRealtime() {
    if (channelRef.current) return;
    const ch = supabase.channel('public:chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new;
        if (!msg) return;
        // if for active room, append; else update rooms preview
        if (activeRoom && msg.room_id === activeRoom.id) {
          (async () => {
            // ensure url for attachments exist
            if (msg.attachments && msg.attachments.length > 0) {
              for (const att of msg.attachments) {
                if (!att.url && att.path) att.url = await safeGetUrlForPath(att.path);
              }
            }
            setMessages(cur => [...cur, msg]);
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
          })();
        }
        setRooms(prev => {
          const idx = prev.findIndex(r => r.id === msg.room_id);
          if (idx === -1) return prev;
          const copy = [...prev];
          copy[idx] = { ...copy[idx], last_message: msg.content, last_ts: msg.created_at };
          return copy;
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_rooms' }, (payload) => {
        const r = payload.new;
        if (!r) return;
        const parts = r.metadata?.participants || [];
        if (Array.isArray(parts) && parts.includes(myId)) setRooms(prev => [r, ...prev]);
      })
      .subscribe();
    channelRef.current = ch;
  }

  // ---- storage helpers ----
  async function safeGetUrlForPath(path) {
    try {
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub?.publicUrl ?? pub?.public_url ?? pub?.url ?? pub?.publicUrl;
      if (publicUrl) return publicUrl;
    } catch (e) { /* ignore */ }
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
      if (error) {
        console.error('storage.upload error', error);
        throw error;
      }
      const url = await safeGetUrlForPath(data.path);
      results.push({ name: file.name, size: file.size, type: file.type, path: data.path, url });
    }
    return results;
  }

  // ---- create/find 1:1 room and open ----
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
      if (found) { if (!rooms.some(r => r.id === found.id)) setRooms(prev => [found, ...prev]); openRoom(found); return; }
      const participantsArr = [myId, otherId].sort();
      const metadata = { participants: participantsArr, participant_names: [namesRef.current[participantsArr[0]] || participantsArr[0], namesRef.current[participantsArr[1]] || participantsArr[1]] };
      const { data, error } = await supabase.from('chat_rooms').insert({ title: `Chat: ${otherName}`, is_private: true, metadata }).select().single();
      if (error) { console.error('create room error', error); return; }
      setRooms(prev => [data, ...prev]);
      openRoom(data);
    } catch (err) { console.error('openDirectRoom unexpected', err); }
  }

  // ---- send message with attachments ----
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
      setRooms(prev => prev.map(r => r.id === activeRoom.id ? { ...r, last_message: payload.content || '[Attachment]', last_ts: data.created_at } : r));
    } catch (err) {
      console.error('sendMessageWithFiles err', err);
      alert(err.message || 'Failed to send message');
    } finally { setUploading(false); setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 120); }
  }

  // helper for display name
  function getDisplayName(id) { return namesRef.current[id] || id; }

  // ---- pending files helpers (add/clear/remove) ----
  function addPendingFiles(fileList) {
    const files = Array.from(fileList || []);
    const newItems = [];
    for (const f of files) {
      // limit size
      if (f.size > MAX_FILE_SIZE) {
        alert(`${f.name} exceeds max size of ${Math.round(MAX_FILE_SIZE/(1024*1024))} MB`);
        continue;
      }
      const previewUrl = URL.createObjectURL(f);
      newItems.push({ file: f, previewUrl });
    }
    setPendingFiles(cur => [...cur, ...newItems]);
  }

  function removePendingFile(index) {
    setPendingFiles(cur => {
      const copy = [...cur];
      const [removed] = copy.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return copy;
    });
  }

  function clearPendingFiles() {
    setPendingFiles(cur => {
      cur.forEach(it => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
      return [];
    });
  }

  // cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      pendingFiles.forEach(it => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // drag/drop handlers
  function onDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave(e) {
    e.preventDefault();
    setDragOver(false);
  }
  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) addPendingFiles(files);
  }

  // ensure messages attachments have URLs (for rare cases)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updated = [];
      for (const m of messages) {
        let changed = false;
        if (m.attachments && m.attachments.length > 0) {
          for (const att of m.attachments) {
            if (!att.url && att.path) {
              const url = await safeGetUrlForPath(att.path);
              if (url) { att.url = url; changed = true; }
            }
          }
        }
        if (changed) updated.push(m);
      }
      if (!cancelled && updated.length > 0) {
        setMessages(cur => cur.map(msg => {
          const found = updated.find(u => u.id === msg.id);
          return found ? found : msg;
        }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]); // only run when messages change

  // render
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 320, background: '#fff', padding: 12, borderRadius: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0 }}>People</h3>
          <div>
            <button onClick={loadProfiles} style={{ marginRight: 8 }}>Refresh</button>
            <button onClick={loadRooms}>Rooms</button>
          </div>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 8 }}>
          {profiles.length === 0 ? <div style={{ color: '#666' }}>No participants found</div> : profiles.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
              <div>{p.name}</div>
              <button onClick={() => openDirectRoom(p.id, p.name)}>Chat</button>
            </div>
          ))}
        </div>

        <hr style={{ margin: '12px 0' }} />
        <h4 style={{ margin: 0 }}>Your rooms</h4>
        <div style={{ marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
          {rooms.length === 0 && <div style={{ color: '#666' }}>No rooms yet</div>}
          {rooms.map(r => (
            <div key={r.id} onClick={() => openRoom(r)} style={{ padding: 8, borderRadius: 6, background: activeRoom?.id === r.id ? '#eef' : '#fafafa', cursor: 'pointer', border: '1px solid #eee', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 600 }}>{r.title || r.metadata?.participant_names?.join(', ')}</div>
                <small style={{ color: '#666' }}>{r.last_ts ? formatTS(r.last_ts) : ''}</small>
              </div>
              <div style={{ color: '#666', fontSize: 13 }}>{r.last_message ? r.last_message.slice(0, 80) : <i>No messages</i>}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            background: '#fff',
            padding: 12,
            borderRadius: 6,
            minHeight: 520,
            display: 'flex',
            flexDirection: 'column',
            border: dragOver ? '2px dashed #66a' : '1px solid transparent',
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {activeRoom ? <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0 }}>{activeRoom.title}</h3>
                <div style={{ color: '#666', fontSize: 13 }}>{(activeRoom.metadata?.participant_names || []).join(', ')}</div>
              </div>
              <div style={{ color: '#666', fontSize: 12 }}>{activeRoom.is_private ? 'Private' : 'Public'}</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginTop: 12, paddingRight: 8 }}>
              {messages.map(m => (
                <div key={m.id} style={{ marginBottom: 10, display: 'flex', flexDirection: m.sender_id === myId ? 'row-reverse' : 'row' }}>
                  <div style={{ maxWidth: '75%', background: m.sender_id === myId ? '#dcf8c6' : '#f1f0f0', padding: 8, borderRadius: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{getDisplayName(m.sender_id)}</div>
                    {m.content && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                    {m.attachments && Array.isArray(m.attachments) && m.attachments.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {m.attachments.map((att, i) => {
                          const isImage = att.type?.startsWith('image/');
                          const isVideo = att.type?.startsWith('video/');
                          // safer url extraction
                          const url = att.url || (att.path ? att.url : null);
                          if (isImage) return (
                            <img
                              key={i}
                              src={url}
                              alt={att.name}
                              style={{ maxWidth: 300, borderRadius: 8, cursor: 'pointer' }}
                              onClick={() => setLightbox({ src: url, name: att.name })}
                            />
                          );
                          if (isVideo) return <video key={i} src={url} controls style={{ maxWidth: 360, borderRadius: 8 }} />;
                          return <a key={i} href={url} target="_blank" rel="noreferrer" style={{ padding: '6px 8px', border: '1px solid #eee', borderRadius: 6 }}>{att.name}</a>;
                        })}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>{formatTS(m.created_at)}</div>
                    {m.failed && <div style={{ color: 'red' }}>Failed to send</div>}
                    {m.optimistic && <div style={{ color: '#666' }}>Sending...</div>}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Write a message... (press Enter to send, Shift+Enter for newline)"
                  style={{ flex: 1, padding: 10, borderRadius: 6, border: '1px solid #ddd', minHeight: 44, resize: 'vertical' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessageWithFiles(); } }}
                />

                <label style={{ display: 'inline-flex' }}>
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*,application/pdf,application/zip"
                    style={{ display: 'none' }}
                    onChange={(e) => { addPendingFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
                  />
                  <button>📎</button>
                </label>

                <button onClick={sendMessageWithFiles} disabled={uploading || (!text.trim() && pendingFiles.length === 0)}>{uploading ? 'Sending...' : 'Send'}</button>
              </div>

              {pendingFiles.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, overflowX: 'auto' }}>
                  {pendingFiles.map((p, i) => {
                    const f = p.file;
                    const isImage = f.type?.startsWith('image/');
                    const isVideo = f.type?.startsWith('video/');
                    const url = p.previewUrl;
                    return (
                      <div key={i} style={{ border: '1px solid #eee', padding: 6, borderRadius: 6, minWidth: 120 }}>
                        {isImage && <img src={url} alt={f.name} style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 6 }} />}
                        {isVideo && <video src={url} style={{ width: 160, height: 100 }} controls />}
                        {!isImage && !isVideo && <div style={{ fontSize: 12 }}>{f.name}</div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                          <small style={{ fontSize: 11 }}>{Math.round(f.size/1024)} KB</small>
                          <button onClick={() => removePendingFile(i)}>Remove</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </> : <div style={{ color: '#666' }}>Select a participant or room to start chatting. You can paste images (Ctrl/Cmd+V) or drag files into this area.</div>}
        </div>
      </div>

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
}
