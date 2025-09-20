// src/pages/AnnouncementPage.jsx
import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

/**
 * Announcement page — optimistic writes + robust likes behavior.
 * Works with your `profiles` table (id, full_name, public_profile).
 */

function fmt(ts) { return ts ? dayjs(ts).format('DD MMM YYYY, HH:mm') : ''; }

export default function AnnouncementPage({ session }) {
  const userId = session?.user?.id;
  const [loading, setLoading] = useState(true);
  const [announcements, setAnnouncements] = useState([]);

  // create form
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  // edit form
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // comment inputs per announcement
  const [commentInputs, setCommentInputs] = useState({});

  // cached profiles map
  const profilesRef = useRef({});
  const channelRef = useRef(null);

  // keep a set of optimistic ids (so we don't double-handle)
  const optimisticIdsRef = useRef(new Set());

  useEffect(() => {
    loadAll();
    setupRealtime();
    return cleanupRealtime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // load announcements + comments + likes
  async function loadAll() {
    setLoading(true);
    try {
      // announcements
      const { data: posts, error: postsErr } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (postsErr) throw postsErr;

      const postIds = (posts || []).map(p => p.id);

      // comments
      let comments = [];
      if (postIds.length) {
        const { data: cdata, error: cErr } = await supabase
          .from('announcement_comments')
          .select('*')
          .in('announcement_id', postIds)
          .order('created_at', { ascending: true });
        if (cErr) throw cErr;
        comments = cdata || [];
      }

      // likes
      const { data: likeRows, error: lErr } = await supabase
        .from('announcement_likes')
        .select('announcement_id, user_id');
      if (lErr) throw lErr;

      // fetch profiles for authors and commenters
      const authorIds = Array.from(new Set((posts || []).map(p => p.author_id).filter(Boolean)
        .concat((comments || []).map(c => c.author_id).filter(Boolean))));
      await fetchProfilesIfNeeded(authorIds);

      // build maps
      const commentsMap = (comments || []).reduce((acc, c) => {
        acc[c.announcement_id] = acc[c.announcement_id] || [];
        acc[c.announcement_id].push(c);
        return acc;
      }, {});

      const likesMap = (likeRows || []).reduce((acc, l) => {
        acc[l.announcement_id] = acc[l.announcement_id] || { count: 0, users: new Set() };
        acc[l.announcement_id].count += 1;
        acc[l.announcement_id].users.add(l.user_id);
        return acc;
      }, {});

      const normalized = (posts || []).map(p => {
        const likesInfo = likesMap[p.id] || { count: 0, users: new Set() };
        return {
          ...p,
          comments: commentsMap[p.id] || [],
          likes_count: likesInfo.count || 0,
          liked_by_me: !!(userId && likesInfo.users.has(userId))
        };
      });

      setAnnouncements(normalized);
      setLoading(false);
    } catch (err) {
      console.error('loadAll error', err);
      setAnnouncements([]);
      setLoading(false);
    }
  }

  async function fetchProfilesIfNeeded(ids = []) {
    const need = Array.from(new Set((ids || []).filter(Boolean))).filter(id => !profilesRef.current[id]);
    if (!need.length) return;
    try {
      const { data, error } = await supabase.from('profiles').select('id, full_name, public_profile').in('id', need);
      if (error) { console.warn('fetchProfiles error', error); return; }
      (data || []).forEach(p => profilesRef.current[p.id] = p);
    } catch (e) { console.warn('fetchProfiles unexpected', e); }
  }

  // Realtime subscriptions (announcements/comments/likes)
  function setupRealtime() {
    if (channelRef.current) return;
    const ch = supabase.channel('public:announcements')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, payload => {
        const p = payload.new;
        // ignore if we already added via optimistic id placeholder with temp id
        if (optimisticIdsRef.current.has(String(p.id))) return;
        // fetch profile for author if needed
        if (p?.author_id) fetchProfilesIfNeeded([p.author_id]);
        setAnnouncements(prev => {
          // don't duplicate if exists by id
          if (prev.some(x => x.id === p.id)) return prev;
          return [{ ...p, comments: [], likes_count: 0, liked_by_me: false }, ...prev];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'announcements' }, payload => {
        const p = payload.new;
        setAnnouncements(prev => prev.map(x => x.id === p.id ? { ...x, title: p.title, content: p.content, updated_at: p.updated_at } : x));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'announcements' }, payload => {
        const p = payload.old;
        setAnnouncements(prev => prev.filter(x => x.id !== p.id));
      })

      // comments
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcement_comments' }, payload => {
        const c = payload.new;
        // ensure profile cached
        if (c?.author_id) fetchProfilesIfNeeded([c.author_id]);
        setAnnouncements(prev => prev.map(a => a.id === c.announcement_id ? { ...a, comments: [...(a.comments || []), c] } : a));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'announcement_comments' }, payload => {
        const c = payload.new;
        setAnnouncements(prev => prev.map(a => a.id === c.announcement_id ? { ...a, comments: (a.comments || []).map(cc => cc.id === c.id ? c : cc) } : a));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'announcement_comments' }, payload => {
        const c = payload.old;
        setAnnouncements(prev => prev.map(a => a.id === c.announcement_id ? { ...a, comments: (a.comments || []).filter(cc => cc.id !== c.id) } : a));
      })

      // likes
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcement_likes' }, payload => {
        const l = payload.new;
        setAnnouncements(prev => prev.map(a => {
          if (a.id !== l.announcement_id) return a;
          return { ...a, likes_count: (a.likes_count || 0) + 1, liked_by_me: a.liked_by_me || l.user_id === userId };
        }));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'announcement_likes' }, payload => {
        const l = payload.old;
        setAnnouncements(prev => prev.map(a => {
          if (a.id !== l.announcement_id) return a;
          const newCount = Math.max(0, (a.likes_count || 1) - 1);
          const liked_by_me = (l.user_id === userId) ? false : a.liked_by_me;
          return { ...a, likes_count: newCount, liked_by_me };
        }));
      })
      .subscribe();

    channelRef.current = ch;
  }

  async function cleanupRealtime() {
    if (!channelRef.current) return;
    try { await channelRef.current.unsubscribe(); } catch (e) { /* ignore */ }
    channelRef.current = null;
  }

  // ------------------ Optimistic create ------------------
  async function createAnnouncement(e) {
    e?.preventDefault();
    if (!userId) { alert('Please sign in'); return; }
    const t = title.trim(), c = content.trim();
    if (!t || !c) { alert('Title and content are required'); return; }

    // create a temporary optimistic item with negative id
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const optimistic = {
      id: tmpId,
      title: t,
      content: c,
      author_id: userId,
      created_at: new Date().toISOString(),
      likes_count: 0,
      liked_by_me: false,
      comments: [],
      optimistic: true
    };
    optimisticIdsRef.current.add(tmpId);
    setAnnouncements(prev => [optimistic, ...prev]);
    setTitle(''); setContent('');

    try {
      // attempt to insert and return the inserted row
      const { data, error } = await supabase.from('announcements').insert({ title: t, content: c, author_id: userId }).select().single();
      if (error) {
        // remove optimistic and show error
        setAnnouncements(prev => prev.filter(p => p.id !== tmpId));
        optimisticIdsRef.current.delete(tmpId);
        console.error('createAnnouncement error', error);
        alert('Failed to create announcement: ' + (error.message || JSON.stringify(error)));
        return;
      }
      // reconcile: replace optimistic item with server row (by tmp id -> server id)
      setAnnouncements(prev => {
        const found = prev.findIndex(p => p.id === tmpId);
        if (found === -1) {
          // item removed by other means — just add returned row to top
          return [{ ...data, comments: [], likes_count: 0, liked_by_me: false }, ...prev];
        } else {
          const copy = [...prev];
          copy[found] = { ...data, comments: [], likes_count: 0, liked_by_me: false };
          return copy;
        }
      });
      optimisticIdsRef.current.delete(tmpId);
    } catch (err) {
      // network/exception: revert optimistic item and show error
      setAnnouncements(prev => prev.filter(p => p.id !== tmpId));
      optimisticIdsRef.current.delete(tmpId);
      console.error('createAnnouncement unexpected', err);
      alert('Unexpected error creating announcement (see console)');
    }
  }

  // ------------------ Likes optimistic toggle ------------------
  // toggles like on client immediately, calls supabase and reverts on error
  async function toggleLike(announcementId) {
    if (!userId) { alert('Please sign in'); return; }
    // find announcement
    const post = announcements.find(a => String(a.id) === String(announcementId));
    if (!post) return;

    const wasLiked = !!post.liked_by_me;
    // optimistic update
    setAnnouncements(prev => prev.map(a => a.id === announcementId ? { ...a, liked_by_me: !wasLiked, likes_count: (a.likes_count || 0) + (wasLiked ? -1 : 1) } : a));

    try {
      if (wasLiked) {
        const { error } = await supabase.from('announcement_likes').delete().match({ announcement_id: announcementId, user_id: userId });
        if (error) {
          // revert
          setAnnouncements(prev => prev.map(a => a.id === announcementId ? { ...a, liked_by_me: wasLiked, likes_count: (a.likes_count || 0) + (wasLiked ? 1 : -1) } : a));
          console.error('toggleLike delete error', error);
          alert('Failed to remove like: ' + (error.message || JSON.stringify(error)));
        }
      } else {
        const { error } = await supabase.from('announcement_likes').insert({ announcement_id: announcementId, user_id: userId });
        if (error) {
          // revert
          setAnnouncements(prev => prev.map(a => a.id === announcementId ? { ...a, liked_by_me: wasLiked, likes_count: (a.likes_count || 0) + (wasLiked ? 1 : -1) } : a));
          console.error('toggleLike insert error', error);
          alert('Failed to add like: ' + (error.message || JSON.stringify(error)));
        }
      }
    } catch (err) {
      // network/exception revert
      setAnnouncements(prev => prev.map(a => a.id === announcementId ? { ...a, liked_by_me: wasLiked, likes_count: (a.likes_count || 0) + (wasLiked ? 1 : -1) } : a));
      console.error('toggleLike unexpected', err);
      alert('Unexpected error while toggling like (see console)');
    }
  }

  // comments, edit, delete and other helpers are kept mostly same; minimal safe implementations:

  function setCommentInput(announcementId, value) {
    setCommentInputs(prev => ({ ...prev, [announcementId]: value }));
  }

  async function addComment(announcementId) {
    const contentVal = (commentInputs[announcementId] || '').trim();
    if (!userId) { alert('Please sign in'); return; }
    if (!contentVal) return;
    try {
      const { data, error } = await supabase.from('announcement_comments').insert({ announcement_id: announcementId, author_id: userId, content: contentVal }).select().single();
      if (error) { console.error('addComment error', error); alert('Failed to add comment: ' + (error.message || JSON.stringify(error))); return; }
      setCommentInputs(prev => ({ ...prev, [announcementId]: '' }));
      // realtime subscription will append comment automatically; but we can also optimistically append if needed
    } catch (err) { console.error('addComment unexpected', err); alert('Unexpected error adding comment'); }
  }

  function startEdit(post) {
    setEditingId(post.id);
    setEditTitle(post.title || '');
    setEditContent(post.content || '');
  }

  async function saveEdit(postId) {
    if (!editTitle.trim() || !editContent.trim()) { alert('Title & content required'); return; }
    try {
      const { data, error } = await supabase.from('announcements').update({ title: editTitle.trim(), content: editContent.trim(), updated_at: new Date().toISOString() }).eq('id', postId).select().single();
      if (error) { console.error('saveEdit error', error); alert('Failed to save edit: ' + (error.message || JSON.stringify(error))); return; }
      setEditingId(null); setEditTitle(''); setEditContent('');
    } catch (err) { console.error('saveEdit unexpected', err); alert('Unexpected error saving edit'); }
  }

  async function removeAnnouncement(postId) {
    if (!confirm('Delete this announcement?')) return;
    try {
      const { data, error } = await supabase.from('announcements').delete().eq('id', postId).select();
      if (error) { console.error('removeAnnouncement error', error); alert('Delete failed: ' + (error.message || JSON.stringify(error))); return; }
      // optimistic UI remove
      setAnnouncements(prev => prev.filter(a => a.id !== postId));
    } catch (err) { console.error('removeAnnouncement unexpected', err); alert('Unexpected error deleting announcement'); }
  }

  async function editComment(comment) {
    if (!comment || comment.author_id !== userId) { alert('Not allowed'); return; }
    const newText = prompt('Edit comment', comment.content);
    if (newText === null) return;
    try {
      const { data, error } = await supabase.from('announcement_comments').update({ content: newText, updated_at: new Date().toISOString() }).eq('id', comment.id).select().single();
      if (error) { console.error('editComment error', error); alert('Failed to edit comment: ' + (error.message || JSON.stringify(error))); }
    } catch (err) { console.error('editComment unexpected', err); alert('Unexpected error editing comment'); }
  }

  async function deleteComment(comment) {
    if (!confirm('Delete this comment?')) return;
    try {
      const { error } = await supabase.from('announcement_comments').delete().eq('id', comment.id);
      if (error) { console.error('deleteComment error', error); alert('Failed to delete comment: ' + (error.message || JSON.stringify(error))); return; }
      // realtime will sync removal
    } catch (err) { console.error('deleteComment unexpected', err); alert('Unexpected error deleting comment'); }
  }

  function getProfileName(userIdToLook) {
    const p = profilesRef.current[userIdToLook];
    if (!p) return userIdToLook;
    const publicProfile = (typeof p.public_profile === 'boolean') ? p.public_profile : true;
    if (!publicProfile) return 'Private profile';
    return p.full_name || userIdToLook;
  }

  // render
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h2>Announcements</h2>

      {userId ? (
        <form onSubmit={createAnnouncement} style={{ background: '#fff', padding: 16, borderRadius: 8, marginBottom: 18, boxShadow: '0 6px 18px rgba(0,0,0,0.04)' }}>
          <h3 style={{ marginTop: 0 }}>Create announcement</h3>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ width: '100%', padding: 10, marginBottom: 8, borderRadius: 6, border: '1px solid #ddd' }} />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write announcement..." rows={4} style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #ddd' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="submit" style={{ padding: '8px 12px', borderRadius: 6 }}>Publish</button>
          </div>
        </form>
      ) : (
        <div style={{ marginBottom: 18 }}>Sign in to create announcements, comment, or like.</div>
      )}

      {loading ? <div>Loading...</div> : announcements.map(post => (
        <article key={post.id} style={{ background: '#fff', padding: 16, borderRadius: 8, marginBottom: 12, boxShadow: '0 6px 18px rgba(0,0,0,0.04)', opacity: post.optimistic ? 0.9 : 1 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{post.title}</div>
              <div style={{ color: '#666', fontSize: 13 }}>{getProfileName(post.author_id)} · {fmt(post.created_at)}</div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => toggleLike(post.id)} style={{ padding: '6px 8px', borderRadius: 6 }}>
                  {post.liked_by_me ? '❤️ Liked' : '🤍 Like'} ({post.likes_count || 0})
                </button>
              </div>

              {userId === post.author_id && !post.optimistic && (
                <>
                  <button onClick={() => startEdit(post)} style={{ padding: '6px 8px', borderRadius: 6 }}>Edit</button>
                  <button onClick={() => removeAnnouncement(post.id)} style={{ padding: '6px 8px', borderRadius: 6 }}>Delete</button>
                </>
              )}
            </div>
          </header>

          <div style={{ marginTop: 10 }}>
            {editingId === post.id ? (
              <>
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd', marginBottom: 8 }} />
                <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={4} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button onClick={() => saveEdit(post.id)} style={{ padding: '6px 10px' }}>Save</button>
                  <button onClick={() => { setEditingId(null); setEditTitle(''); setEditContent(''); }} style={{ padding: '6px 10px' }}>Cancel</button>
                </div>
              </>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{post.content}</div>
            )}
          </div>

          {/* comments */}
          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#444', fontWeight: 700, marginBottom: 6 }}>Comments ({(post.comments || []).length})</div>

            {(post.comments || []).map(c => (
              <div key={c.id} style={{ padding: 8, borderRadius: 6, border: '1px solid #f0f0f0', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{getProfileName(c.author_id)}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{fmt(c.created_at)}</div>
                </div>
                <div style={{ marginTop: 6 }}>{c.content}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {userId === c.author_id && <button onClick={() => editComment(c)} style={{ padding: '4px 8px' }}>Edit</button>}
                  {userId === c.author_id && <button onClick={() => deleteComment(c)} style={{ padding: '4px 8px' }}>Delete</button>}
                </div>
              </div>
            ))}

            {userId ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input placeholder="Write a comment..." value={commentInputs[post.id] || ''} onChange={(e) => setCommentInput(post.id, e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
                <button onClick={() => addComment(post.id)} style={{ padding: '8px 12px', borderRadius: 6 }}>Comment</button>
              </div>
            ) : (
              <div style={{ color: '#666', marginTop: 8 }}>Sign in to comment</div>
            )}
          </div>
        </article>
      ))}

      {announcements.length === 0 && !loading && <div>No announcements yet.</div>}
    </div>
  );
}
