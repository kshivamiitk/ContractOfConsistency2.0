// src/pages/DiaryPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

/**
 * DiaryPage - improved professional UI
 *
 * Assumes table `diary_entries` has columns:
 *  id, user_id, date (YYYY-MM-DD), title, content, visibility, created_at
 *
 * Features:
 *  - list + search + quick filters
 *  - editor with preview, autosave draft per-date
 *  - edit existing entries (updates row)
 *  - export CSV for current date
 *  - keyboard shortcuts: Ctrl/Cmd+Enter => Save
 */

function simpleMarkdownToHtml(md) {
  if (!md) return '';
  // Tiny, safe-ish transforms (no external library)
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // bold **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // italic *text*
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // headings # ...
  html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  // links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  // paragraphs (split by two or more newlines)
  const paragraphs = html.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br/>'));
  return paragraphs.map(p => `<p style="margin:0 0 .75rem">${p}</p>`).join('');
}

function exportCsv(entries) {
  if (!entries || entries.length === 0) return;
  const hdr = ['id', 'date', 'title', 'content', 'visibility', 'created_at'];
  const rows = entries.map(e => hdr.map(h => {
    const v = e[h] ?? '';
    // escape quotes
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const csv = [hdr.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `diary-${entries[0]?.date || dayjs().format('YYYY-MM-DD')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DiaryPage({ session }) {
  const userId = session?.user?.id;
  const today = dayjs().format('YYYY-MM-DD');

  const [date, setDate] = useState(today);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  // editor state
  const [editingId, setEditingId] = useState(null); // null => new
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [tags, setTags] = useState([]); // simple comma-separated tags
  const [mood, setMood] = useState('neutral'); // optional mood

  const [query, setQuery] = useState('');
  const [onlyPublic, setOnlyPublic] = useState(false);

  const draftKey = `diary.draft.${userId}.${date}`;
  const savingRef = useRef(false);

  // fetch when user or date changes
  useEffect(() => {
    if (!userId) return;
    fetchEntries();
    // load draft for date
    try {
      const d = localStorage.getItem(`diary.draft.${userId}.${date}`);
      if (d) {
        const parsed = JSON.parse(d);
        setTitle(parsed.title ?? '');
        setContent(parsed.content ?? '');
        setVisibility(parsed.visibility ?? 'private');
        setTags(parsed.tags ?? []);
        setMood(parsed.mood ?? 'neutral');
        setEditingId(parsed.editingId ?? null);
      } else {
        // clear editor for new date
        setEditingId(null);
        setTitle('');
        setContent('');
        setVisibility('private');
        setTags([]);
        setMood('neutral');
      }
    } catch (e) {
      console.warn('load draft failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, date]);

  async function fetchEntries() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('fetch diary err', error);
        setEntries([]);
      } else {
        setEntries(data || []);
      }
    } catch (e) {
      console.error('fetch entries unexpected', e);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  // autosave draft per-date (debounced-ish)
  useEffect(() => {
    const payload = { editingId, title, content, visibility, tags, mood };
    try {
      localStorage.setItem(draftKey, JSON.stringify(payload));
    } catch (e) { /* ignore */ }
  }, [editingId, title, content, visibility, tags, mood, draftKey]);

  // keyboard shortcut to save: Ctrl/Cmd+Enter
  useEffect(() => {
    function onKey(e) {
      const isSave = (e.key === 'Enter' && (e.ctrlKey || e.metaKey));
      if (isSave) {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, visibility, tags, mood, editingId, date]);

  function clearEditor() {
    setEditingId(null);
    setTitle('');
    setContent('');
    setVisibility('private');
    setTags([]);
    setMood('neutral');
    try { localStorage.removeItem(draftKey); } catch (e) {}
  }

  async function handleSave(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!userId) return alert('Please login');

    if (!title.trim() && !content.trim()) {
      return alert('Please enter a title or content.');
    }

    savingRef.current = true;
    const payload = {
      user_id: userId,
      date,
      title: title.trim(),
      content: content.trim(),
      visibility,
      // optional additional metadata: tags,mood (store as jsonb if you have a column)
      // We'll attempt to write tags & mood into metadata if you have a jsonb column 'metadata'
      metadata: { tags, mood },
    };

    try {
      if (editingId) {
        // update existing
        const { data, error } = await supabase
          .from('diary_entries')
          .update(payload)
          .eq('id', editingId)
          .select()
          .single();

        if (error) {
          console.error('update entry err', error);
          alert('Update failed: ' + (error.message || 'unknown'));
        } else {
          clearEditor();
          fetchEntries();
        }
      } else {
        // insert new
        const { data, error } = await supabase.from('diary_entries').insert(payload).select().single();
        if (error) {
          console.error('insert entry err', error);
          alert('Save failed: ' + (error.message || 'unknown'));
        } else {
          clearEditor();
          fetchEntries();
        }
      }
    } catch (err) {
      console.error('saveEntry unexpected', err);
      alert('Unexpected error while saving');
    } finally {
      savingRef.current = false;
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this entry?')) return;
    try {
      const { error } = await supabase.from('diary_entries').delete().eq('id', id);
      if (error) {
        console.error('deleteEntry err', error);
        alert(error.message || 'Delete failed');
      } else {
        if (editingId === id) clearEditor();
        fetchEntries();
      }
    } catch (err) {
      console.error('deleteEntry unexpected', err);
      alert('Unexpected delete error');
    }
  }

  function loadForEdit(entry) {
    setEditingId(entry.id);
    setTitle(entry.title || '');
    setContent(entry.content || '');
    setVisibility(entry.visibility || 'private');
    // metadata may store tags/mood
    try {
      const md = entry.metadata || {};
      setTags(md.tags || []);
      setMood(md.mood || 'neutral');
    } catch (e) {
      setTags([]);
      setMood('neutral');
    }
    // focus moved to editor automatically is left to UI
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const filteredEntries = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    return entries.filter(e => {
      if (onlyPublic && e.visibility !== 'public') return false;
      if (!q) return true;
      return ((e.title || '') + ' ' + (e.content || '') + ' ' + (e.metadata?.tags || []).join(' '))
        .toLowerCase().includes(q);
    });
  }, [entries, query, onlyPublic]);

  const stats = useMemo(() => {
    const wc = content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
    const chars = content.length;
    const readMins = Math.max(1, Math.round(wc / 200));
    return { wc, chars, readMins };
  }, [content]);

  return (
    <div style={{ background: '#fff', padding: 18, borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Personal Diary</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#555' }}>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 6 }} />
          </label>
          <button onClick={() => exportCsv(entries)} style={{ padding: '8px 12px', borderRadius: 8 }}>Export CSV</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, marginTop: 14 }}>
        {/* LEFT: list & filters */}
        <div style={{ borderRight: '1px solid #f1f1f4', paddingRight: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              placeholder="Search entries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #e6e7ee' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#666' }}>
              <input type="checkbox" checked={onlyPublic} onChange={(e) => setOnlyPublic(e.target.checked)} />
              Public
            </label>
          </div>

          <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
            {loading ? 'Loading...' : `${filteredEntries.length} entries for ${date}`}
          </div>

          <div style={{ maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredEntries.length === 0 && !loading ? (
              <div style={{ color: '#999' }}>No entries for this date yet</div>
            ) : (
              filteredEntries.map(e => (
                <div key={e.id} style={{
                  padding: 10,
                  borderRadius: 8,
                  border: editingId === e.id ? '2px solid #4f46e5' : '1px solid #f0f0f3',
                  background: editingId === e.id ? '#fbfbff' : '#fff',
                  cursor: 'pointer'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{e.title || '(no title)'}</div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {String(e.content || '').slice(0, 180)}
                      </div>
                    </div>
                    <div style={{ minWidth: 110, textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: '#666' }}>{dayjs(e.created_at).format('HH:mm')}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{e.visibility}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => loadForEdit(e)} style={{ padding: '6px 10px', borderRadius: 6 }}>Edit</button>
                      <button onClick={() => navigator.clipboard.writeText(e.content || '')} style={{ padding: '6px 10px', borderRadius: 6 }}>Copy</button>
                      <button onClick={() => handleDelete(e.id)} style={{ padding: '6px 10px', borderRadius: 6, background: '#fff1f0' }}>Delete</button>
                    </div>
                    <div style={{ color: '#999', fontSize: 12 }}>{(e.metadata?.tags || []).slice(0,3).join(', ')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT: editor */}
        <div>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <input
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e6e7ee', fontSize: 16 }}
              />
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={{ padding: 10, borderRadius: 8 }}>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <input
                placeholder="Comma-separated tags (e.g. gratitude,ideas)"
                value={tags.join(',')}
                onChange={(e) => setTags(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #e6e7ee' }}
              />
              <select value={mood} onChange={(e) => setMood(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
                <option value="happy">😊 Happy</option>
                <option value="productive">💪 Productive</option>
                <option value="neutral">😐 Neutral</option>
                <option value="sad">😔 Sad</option>
                <option value="anxious">😓 Anxious</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <textarea
                placeholder="Write your diary... (supports **bold**, *italic*, [link](https://...))"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={12}
                style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #e6e7ee', fontSize: 14, resize: 'vertical' }}
              />
              <div style={{ width: 320, border: '1px solid #f3f3f6', borderRadius: 8, padding: 12, background: '#fafafa' }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Preview</div>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                  {title || '(no title)'} &middot; <span>{visibility}</span>
                </div>
                <div style={{ maxHeight: 360, overflowY: 'auto', fontSize: 14, color: '#222' }}
                     dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(content) }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#666' }}>
                <div>Words: <strong>{stats.wc}</strong></div>
                <div>Chars: <strong>{stats.chars}</strong></div>
                <div>Read: <strong>{stats.readMins} min</strong></div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={clearEditor} style={{ padding: '8px 12px', borderRadius: 8 }}>Clear</button>
                <button type="submit" style={{ padding: '8px 12px', borderRadius: 8 }}>{editingId ? 'Update' : 'Save Entry'}</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
