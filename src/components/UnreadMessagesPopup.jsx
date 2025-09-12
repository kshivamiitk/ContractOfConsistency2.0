// src/components/UnreadMessagesPopup.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

const LAST_SEEN_KEY = 'chat-last-seen-v1';
const DEFAULT_LOOKBACK_HOURS = 24; // if no lastSeen, look back this far

function short(text = '', max = 120) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

export default function UnreadMessagesPopup({ session }) {
  const navigate = useNavigate();
  const userId = session?.user?.id;
  const [loading, setLoading] = useState(false);
  const [newMessages, setNewMessages] = useState([]); // flat list
  const [profilesMap, setProfilesMap] = useState({});
  const [open, setOpen] = useState(false);

  // compute lastSeen
  const lastSeen = useMemo(() => {
    try {
      const raw = localStorage.getItem(LAST_SEEN_KEY);
      if (!raw) return dayjs().subtract(DEFAULT_LOOKBACK_HOURS, 'hour').toISOString();
      return raw;
    } catch (e) {
      return dayjs().subtract(DEFAULT_LOOKBACK_HOURS, 'hour').toISOString();
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        // 1) fetch rooms where user is participant
        const { data: rooms, error: roomsErr } = await supabase.from('chat_rooms').select('*');
        if (roomsErr) throw roomsErr;
        const myRooms = (rooms || []).filter(r => Array.isArray(r.metadata?.participants) && r.metadata.participants.includes(userId));
        const roomIds = myRooms.map(r => r.id).filter(Boolean);
        if (roomIds.length === 0) {
          setNewMessages([]);
          setOpen(false);
          setLoading(false);
          return;
        }

        // 2) fetch messages in these rooms newer than lastSeen (exclude messages from yourself)
        const { data: msgs, error: msgsErr } = await supabase
          .from('messages')
          .select('id,room_id,sender_id,content,created_at,attachments')
          .in('room_id', roomIds)
          .gt('created_at', lastSeen)
          .order('created_at', { ascending: false })
          .limit(200);

        if (msgsErr) throw msgsErr;
        const filtered = (msgs || []).filter(m => m.sender_id !== userId);

        if (!mounted) return;

        if (filtered.length > 0) {
          setNewMessages(filtered);
          setOpen(true);
        } else {
          setNewMessages([]);
          setOpen(false);
        }

        // 3) fetch sender profiles for mapping names
        const senders = Array.from(new Set(filtered.map(m => m.sender_id).filter(Boolean)));
        if (senders.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', senders);
          const map = {};
          (profs || []).forEach(p => (map[p.id] = p.full_name || p.id));
          setProfilesMap(map);
        } else {
          setProfilesMap({});
        }
      } catch (err) {
        console.error('UnreadMessagesPopup fetch error', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // lastSeen is intentionally constant per mount to define "since last visit"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function markAllSeenAndClose() {
    try {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    } catch (e) { /* ignore */ }
    setOpen(false);
  }

  async function openChatForRoom(roomId) {
    // set last seen to now then navigate to chat with opening hint
    try {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
      // set target room so ChatPage will auto-open it (we'll add a small key reader there)
      localStorage.setItem('chat-open-room', roomId);
    } catch (e) {}
    setOpen(false);
    navigate('/chat');
  }

  if (!open) return null;

  // Group messages by room for UI
  const grouped = newMessages.reduce((acc, m) => {
    (acc[m.room_id] = acc[m.room_id] || []).push(m);
    return acc;
  }, {});

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.45)', padding: 20
    }}>
      <div style={{ width: 'min(980px, 96%)', maxHeight: '84vh', overflowY: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>New messages since your last visit</h3>
            <div style={{ color: '#666', fontSize: 13 }}>{dayjs(lastSeen).fromNow ? dayjs(lastSeen).format('YYYY-MM-DD HH:mm') : lastSeen}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={markAllSeenAndClose} style={{ padding: '8px 12px', borderRadius: 8 }}>Dismiss</button>
          </div>
        </div>

        {loading && <div style={{ color: '#666' }}>Loading...</div>}

        {!loading && Object.keys(grouped).length === 0 && (
          <div style={{ color: '#666' }}>No new messages.</div>
        )}

        {!loading && Object.keys(grouped).map(roomId => {
          const msgs = grouped[roomId];
          return (
            <div key={roomId} style={{ borderTop: '1px solid #f2f6fb', paddingTop: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>{/* try to show room title if we can fetch it */}
                  Room: {roomId}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openChatForRoom(roomId)} style={{ padding: '6px 10px', borderRadius: 8 }}>Open chat</button>
                </div>
              </div>

              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                {msgs.slice(0, 10).map(m => (
                  <div key={m.id} style={{ padding: 10, borderRadius: 8, background: '#f8fafc', display: 'flex', gap: 10 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #eef2f7' }}>
                      {(profilesMap[m.sender_id] || '').slice(0,1).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ fontWeight: 700 }}>{profilesMap[m.sender_id] || m.sender_id}</div>
                        <div style={{ color: '#666', fontSize: 12 }}>{dayjs(m.created_at).format('YYYY-MM-DD HH:mm')}</div>
                      </div>
                      <div style={{ marginTop: 6, color: '#222' }}>{short(m.content, 200) || (m.attachments && m.attachments.length ? '[Attachment]' : '')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={() => { markAllSeenAndClose(); navigate('/chat'); }} style={{ padding: '8px 12px', borderRadius: 8 }}>Open Chat Hub</button>
        </div>
      </div>
    </div>
  );
}
