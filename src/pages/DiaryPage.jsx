// src/pages/DiaryPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

/**
 * DiaryPage — choose whose diary to view (uses `profiles` table)
 *
 * Table assumptions:
 * - profiles: { id, full_name, public_profile (bool), created_at }
 * - diary_entries: { id, user_id, date, title, content, visibility, metadata, created_at, updated_at }
 *
 * Behavior:
 * - Dropdown of available profiles (public profiles + you).
 * - Selecting a profile loads that user's diary for the selected date.
 * - If the selected profile is not you, only public entries are shown (read-only).
 * - If the selected profile is you, full editor is enabled.
 */

function simpleMarkdownToHtml(md) {
  if (!md) return '';
  let html = String(md)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const paragraphs = html.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br/>'));
  return paragraphs.map(p => `<p style="margin:0 0 .75rem">${p}</p>`).join('');
}

function exportCsv(entries) {
  if (!entries || entries.length === 0) return;
  const hdr = ['id', 'user_id', 'date', 'title', 'content', 'visibility', 'created_at', 'updated_at'];
  const rows = entries.map(e => hdr.map(h => {
    const v = (e[h] ?? '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const csv = [hdr.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const nameDate = entries[0]?.date || dayjs().format('YYYY-MM-DD');
  a.download = `diary-${nameDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DiaryPage({ session }) {
  const currentUserId = session?.user?.id ?? null;
  const today = dayjs().format('YYYY-MM-DD');

  // Query param init (user, date)
  const [queryUser, setQueryUser] = useState(() => {
    try {
      if (typeof window === 'undefined') return null;
      return new URLSearchParams(window.location.search).get('user') || null;
    } catch (e) { return null; }
  });
  const [targetDate, setTargetDate] = useState(() => {
    try {
      if (typeof window === 'undefined') return today;
      return new URLSearchParams(window.location.search).get('date') || today;
    } catch (e) { return today; }
  });

  // Profiles list and selected profile
  const [profiles, setProfiles] = useState([]); // loaded profiles (public + you)
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState(null); // resolved id of profile we're viewing
  const [selectedProfileLabel, setSelectedProfileLabel] = useState(null);

  // diary entries
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // editor state (only when viewing your own profile)
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [metadata, setMetadata] = useState({ tags: [], mood: 'neutral' });

  // UI states
  const [searchProfilesText, setSearchProfilesText] = useState('');
  const [manualUserInput, setManualUserInput] = useState(queryUser || '');
  const [previewEntry, setPreviewEntry] = useState(null);
  const draftKey = `diary.draft.${currentUserId}.${targetDate}`;

  // whether the selected profile is someone else
  const isViewingOtherUser = Boolean(selectedProfileId && currentUserId && selectedProfileId !== currentUserId);

  // fetch profiles (public_profile = true) and include current user
  useEffect(() => {
    let mounted = true;
    async function loadProfiles() {
      setProfilesLoading(true);
      try {
        // get public profiles OR current user (so you can select yourself)
        // use supabase .or to combine conditions
        const orCond = currentUserId ? `public_profile.eq.true,id.eq.${currentUserId}` : 'public_profile.eq.true';
        const { data, error } = await supabase
          .from('profiles')
          .select('id,full_name,public_profile')
          .or(orCond)
          .order('full_name', { ascending: true });

        if (error) throw error;
        if (!mounted) return;

        const list = (data || []).map(p => ({
          id: p.id,
          label: p.full_name || p.id,
          public_profile: p.public_profile
        }));
        setProfiles(list);
      } catch (err) {
        console.error('loadProfiles', err);
        setProfiles([]);
      } finally {
        if (mounted) setProfilesLoading(false);
      }
    }
    loadProfiles();
    return () => { mounted = false; };
  }, [currentUserId]);

  // resolve initial profile selection:
  // priority:
  // 1) queryUser (if provided and matches a profile label or id)
  // 2) default to currentUserId
  useEffect(() => {
    // once profiles load, pick profile
    if (profiles.length === 0) {
      // if manual query present, attempt to set manual later
      if (manualUserInput) {
        setSelectedProfileId(null);
        setSelectedProfileLabel(manualUserInput);
      } else if (currentUserId) {
        setSelectedProfileId(currentUserId);
        setSelectedProfileLabel('You');
      }
      return;
    }

    const q = (manualUserInput || queryUser || '').trim();
    if (q) {
      // try to match by id or label
      const byId = profiles.find(p => p.id === q);
      if (byId) {
        setSelectedProfileId(byId.id);
        setSelectedProfileLabel(byId.label);
        return;
      }
      const byLabel = profiles.find(p => String(p.label).toLowerCase() === q.toLowerCase());
      if (byLabel) {
        setSelectedProfileId(byLabel.id);
        setSelectedProfileLabel(byLabel.label);
        return;
      }
      // not found: treat as manual unresolved (user typed an external id/username)
      setSelectedProfileId(null);
      setSelectedProfileLabel(q);
      return;
    }

    // no query: default to current user if present else first public profile
    if (currentUserId) {
      setSelectedProfileId(currentUserId);
      setSelectedProfileLabel('You');
      return;
    }
    if (profiles.length > 0) {
      setSelectedProfileId(profiles[0].id);
      setSelectedProfileLabel(profiles[0].label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, manualUserInput, queryUser, currentUserId]);

  // whenever selectedProfileId or selectedProfileLabel or targetDate changes => fetch entries
  useEffect(() => {
    fetchEntries();
    // when viewing your own profile, attempt to load draft
    if (selectedProfileId === currentUserId) {
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const d = JSON.parse(raw);
          setEditingId(d.editingId ?? null);
          setTitle(d.title ?? '');
          setContent(d.content ?? '');
          setVisibility(d.visibility ?? 'private');
          setMetadata(d.metadata ?? { tags: [], mood: 'neutral' });
        } else {
          setEditingId(null);
          setTitle('');
          setContent('');
          setVisibility('private');
          setMetadata({ tags: [], mood: 'neutral' });
        }
      } catch (err) { /* ignore */ }
    } else {
      // clear editor when viewing someone else
      setEditingId(null);
      setTitle('');
      setContent('');
      setVisibility('private');
      setMetadata({ tags: [], mood: 'neutral' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId, selectedProfileLabel, targetDate, currentUserId]);

  async function fetchEntries() {
    if (!selectedProfileId && !selectedProfileLabel) {
      setEntries([]);
      return;
    }
    setLoadingEntries(true);
    try {
      // If selectedProfileId is null but we have a label (manual), we still try to query using label as username
      let q = supabase
        .from('diary_entries')
        .select('id,user_id,date,title,content,visibility,metadata,created_at,updated_at')
        .eq('date', targetDate)
        .order('created_at', { ascending: false });

      if (selectedProfileId) q = q.eq('user_id', selectedProfileId);
      else {
        // If user entered a string, attempt match by profiles.username or by user id string
        // Try to fetch profile by username first:
        const maybe = selectedProfileLabel;
        const { data: found, error } = await supabase.from('profiles').select('id').ilike('full_name', maybe).limit(1);
        if (found && found.length > 0) q = q.eq('user_id', found[0].id);
        else q = q.eq('user_id', maybe); // fallback (maybe they pasted id)
      }

      // If viewing other user: only public entries
      const viewingOther = Boolean(selectedProfileId && currentUserId && selectedProfileId !== currentUserId);
      if (viewingOther) q = q.eq('visibility', 'public');
      // If selectedProfileId not set (manual), we conservatively only show public rows unless it's you
      if (!selectedProfileId && selectedProfileLabel && selectedProfileLabel !== currentUserId) q = q.eq('visibility', 'public');

      const { data, error } = await q;
      if (error) throw error;
      setEntries(data || []);
    } catch (err) {
      console.error('fetchEntries', err);
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }

  // autosave draft per-date if editing own profile
  useEffect(() => {
    if (!currentUserId) return;
    if (selectedProfileId !== currentUserId) return;
    const payload = { editingId, title, content, visibility, metadata };
    try {
      localStorage.setItem(draftKey, JSON.stringify(payload));
    } catch (e) { /* ignore */ }
  }, [editingId, title, content, visibility, metadata, draftKey, selectedProfileId, currentUserId]);

  // basic CRUD for owner (create/update/delete)
  async function handleSave(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!currentUserId) return alert('Please login to save entries.');
    if (selectedProfileId !== currentUserId) return alert('Switch to your profile to save entries.');

    if (!title.trim() && !content.trim()) return alert('Please enter a title or content.');

    const payload = {
      user_id: currentUserId,
      date: targetDate,
      title: title.trim(),
      content: content.trim(),
      visibility: visibility || 'private',
      metadata: metadata || {}
    };

    try {
      if (editingId) {
        const { error } = await supabase.from('diary_entries').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('diary_entries').insert(payload);
        if (error) throw error;
      }
      // clear draft and reload
      localStorage.removeItem(draftKey);
      setEditingId(null);
      setTitle('');
      setContent('');
      setVisibility('private');
      setMetadata({ tags: [], mood: 'neutral' });
      fetchEntries();
    } catch (err) {
      console.error('save', err);
      alert('Save failed: ' + (err.message || String(err)));
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this entry?')) return;
    try {
      const entry = entries.find(x => x.id === id);
      if (!entry) return;
      if (entry.user_id !== currentUserId) return alert('Cannot delete another user\'s entry.');
      const { error } = await supabase.from('diary_entries').delete().eq('id', id);
      if (error) throw error;
      fetchEntries();
    } catch (err) {
      console.error('delete', err);
      alert('Delete failed: ' + (err.message || String(err)));
    }
  }

  function loadForEdit(entry) {
    if (entry.user_id !== currentUserId) return alert('Cannot edit another user\'s entry.');
    setEditingId(entry.id);
    setTitle(entry.title || '');
    setContent(entry.content || '');
    setVisibility(entry.visibility || 'private');
    setMetadata(entry.metadata || { tags: [], mood: 'neutral' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Toggle visibility (owner only)
  async function toggleVisibility(entry) {
    if (!entry || entry.user_id !== currentUserId) return;
    const next = entry.visibility === 'public' ? 'private' : 'public';
    try {
      const { error } = await supabase.from('diary_entries').update({ visibility: next }).eq('id', entry.id);
      if (error) throw error;
      fetchEntries();
    } catch (err) {
      console.error('toggleVisibility', err);
      alert('Could not toggle visibility: ' + (err.message || String(err)));
    }
  }

  // UI handlers
  function handleSelectProfileChange(val) {
    if (!val) {
      setSelectedProfileId(null);
      setSelectedProfileLabel(null);
      return;
    }
    const found = profiles.find(p => p.id === val);
    if (found) {
      setSelectedProfileId(found.id);
      setSelectedProfileLabel(found.label);
      setManualUserInput('');
      // update URL param
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('user', found.id);
        window.history.replaceState({}, '', u.toString());
      } catch (e) { /* ignore */ }
    } else {
      // shouldn't happen but fallback
      setSelectedProfileId(val);
      setSelectedProfileLabel(val);
    }
  }

  function handleManualUserApply() {
    const raw = (manualUserInput || '').trim();
    if (!raw) return;
    setQueryUser(raw);
    setSelectedProfileId(null); // we'll resolve later (fetchEntries attempts to resolve by name)
    setSelectedProfileLabel(raw);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('user', raw);
      window.history.replaceState({}, '', u.toString());
    } catch (e) {}
  }

  // small helper: public link for selected profile/date
  function publicDateLink() {
    if (!selectedProfileId && !selectedProfileLabel) return '';
    const base = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : `/diary`;
    const u = new URL(base);
    u.searchParams.set('date', targetDate);
    if (selectedProfileId) u.searchParams.set('user', selectedProfileId);
    else u.searchParams.set('user', selectedProfileLabel);
    return u.toString();
  }

  // filtered profiles for dropdown by search text
  const visibleProfiles = useMemo(() => {
    const q = (searchProfilesText || '').trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p => (p.label || '').toLowerCase().includes(q));
  }, [profiles, searchProfilesText]);

  return (
    <div style={{ background: '#fff', padding: 18, borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Diary</h2>

          <div style={{ fontSize: 13, color: '#666' }}>
            Date
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={{ marginLeft: 8, padding: 6, borderRadius: 6, border: '1px solid #e6e7ee' }} />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: '#666' }}>View profile</div>

            {/* Profiles dropdown */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="Search profiles..."
                value={searchProfilesText}
                onChange={(e) => setSearchProfilesText(e.target.value)}
                style={{ padding: 6, borderRadius: 6, border: '1px solid #e6e7ee' }}
              />

              <select
                value={selectedProfileId || ''}
                onChange={(e) => handleSelectProfileChange(e.target.value || null)}
                style={{ padding: 8, borderRadius: 6 }}
              >
                <option value="">{profilesLoading ? 'Loading profiles…' : (profiles.length === 0 ? 'No public profiles found' : 'Select profile')}</option>
                {/* show "You" first if available */}
                {profiles.find(p => p.id === currentUserId) && (
                  <option value={currentUserId}>You (me)</option>
                )}
                {visibleProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.label}{p.public_profile ? '' : ' (private)'}</option>
                ))}
              </select>

              {/* manual input for advanced users (paste id or username) */}
              <input
                placeholder="or paste user id / name"
                value={manualUserInput}
                onChange={(e) => setManualUserInput(e.target.value)}
                style={{ padding: 6, borderRadius: 6, border: '1px solid #e6e7ee' }}
              />
              <button onClick={handleManualUserApply} style={{ padding: '6px 10px', borderRadius: 6 }}>Apply</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Search entries..." value={''} readOnly style={{ padding: 8, borderRadius: 8, border: '1px solid #e6e7ee', width: 220 }} />
          <button onClick={() => exportCsv(entries)} style={{ padding: '8px 12px', borderRadius: 8 }}>Export CSV</button>
          <button onClick={() => { navigator.clipboard.writeText(publicDateLink()); alert('Copied public link'); }} style={{ padding: '8px 12px', borderRadius: 8 }}>Copy link</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, marginTop: 14 }}>
        {/* Left: entries list */}
        <div style={{ borderRight: '1px solid #f1f1f4', paddingRight: 12 }}>
          <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
            {loadingEntries ? 'Loading...' : `${entries.length} entries for ${targetDate}`}{isViewingOtherUser && ' (public only)'}
          </div>

          <div style={{ maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {entries.length === 0 && !loadingEntries ? (
              <div style={{ color: '#999' }}>No entries for this date.</div>
            ) : entries.map(e => (
              <div key={e.id} style={{
                padding: 10, borderRadius: 8, border: editingId === e.id ? '2px solid #4f46e5' : '1px solid #f0f0f3',
                background: editingId === e.id ? '#fbfbff' : '#fff', display: 'flex', flexDirection: 'column', gap: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{e.title || '(no title)'}</div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(e.content || '').slice(0, 180)}</div>
                  </div>
                  <div style={{ minWidth: 110, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: '#666' }}>{dayjs(e.created_at).format('HH:mm')}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{e.visibility}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { setPreviewEntry(e); }} style={{ padding: '6px 10px', borderRadius: 6 }}>View</button>
                    {e.user_id === currentUserId && <button onClick={() => loadForEdit(e)} style={{ padding: '6px 10px', borderRadius: 6 }}>Edit</button>}
                    <button onClick={() => { navigator.clipboard.writeText(e.content || ''); alert('Copied'); }} style={{ padding: '6px 10px', borderRadius: 6 }}>Copy</button>
                    {e.user_id === currentUserId && <button onClick={() => handleDelete(e.id)} style={{ padding: '6px 10px', borderRadius: 6, background: '#fff1f0' }}>Delete</button>}
                    {e.user_id === currentUserId && <button onClick={() => toggleVisibility(e)} style={{ padding: '6px 10px', borderRadius: 6 }}>{e.visibility === 'public' ? 'Make private' : 'Make public'}</button>}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>{(e.metadata?.tags || []).slice(0,3).join(', ')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: editor (owner) or public preview */}
        <div>
          {isViewingOtherUser ? (
            <div style={{ padding: 12, borderRadius: 8, border: '1px solid #f3f3f6', background: '#fafafa' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Viewing public diary — {selectedProfileLabel || 'Unknown'}</div>
              <div style={{ color: '#666', marginBottom: 8 }}>You can read public entries. Login as the user to edit.</div>

              <div style={{ maxHeight: 520, overflowY: 'auto', padding: 8 }}>
                {entries.length === 0 ? <div style={{ color: '#999' }}>No public entries for this date.</div> :
                  entries.map(e => (
                    <div key={e.id} style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: '#fff', border: '1px solid #eee' }}>
                      <div style={{ fontWeight: 800 }}>{e.title || '(no title)'}</div>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{dayjs(e.created_at).format('YYYY-MM-DD HH:mm')}</div>
                      <div dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(e.content || '') }} />
                    </div>
                  ))
                }
              </div>
            </div>
          ) : (
            // owner editor
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e6e7ee', fontSize: 16 }} />
                <select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={{ padding: 10, borderRadius: 8 }}>
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <input placeholder="Comma-separated tags" value={(metadata.tags || []).join(',')} onChange={(e) => setMetadata(md => ({ ...md, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #e6e7ee' }} />
                <select value={metadata.mood || 'neutral'} onChange={(e) => setMetadata(md => ({ ...md, mood: e.target.value }))} style={{ padding: 8, borderRadius: 8 }}>
                  <option value="happy">😊 Happy</option>
                  <option value="productive">💪 Productive</option>
                  <option value="neutral">😐 Neutral</option>
                  <option value="sad">😔 Sad</option>
                  <option value="anxious">😓 Anxious</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <textarea placeholder="Write your diary..." value={content} onChange={(e) => setContent(e.target.value)} rows={12} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #e6e7ee', fontSize: 14 }} />
                <div style={{ width: 320, border: '1px solid #f3f3f6', borderRadius: 8, padding: 12, background: '#fafafa' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Preview</div>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>{title || '(no title)'} · {visibility}</div>
                  <div style={{ maxHeight: 360, overflowY: 'auto', fontSize: 14, color: '#222' }} dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(content) }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: '#666' }}>Words: <strong>{content.trim() === '' ? 0 : content.trim().split(/\s+/).length}</strong> · Chars: <strong>{content.length}</strong></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => { setEditingId(null); setTitle(''); setContent(''); setVisibility('private'); setMetadata({ tags: [], mood: 'neutral' }); localStorage.removeItem(draftKey); }} style={{ padding: '8px 12px', borderRadius: 8 }}>Clear</button>
                  <button type="submit" style={{ padding: '8px 12px', borderRadius: 8 }}>{editingId ? 'Update' : 'Save Entry'}</button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Preview modal */}
      {previewEntry && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', zIndex: 9999 }}>
          <div style={{ width: 720, maxHeight: '80vh', overflowY: 'auto', background: '#fff', borderRadius: 10, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{previewEntry.title || '(no title)'}</h3>
              <div>
                {previewEntry.user_id === currentUserId && <button onClick={() => loadForEdit(previewEntry)} style={{ marginRight: 8 }}>Edit</button>}
                <button onClick={() => { navigator.clipboard.writeText(previewEntry.content || ''); alert('Copied'); }} style={{ marginRight: 8 }}>Copy</button>
                <button onClick={() => setPreviewEntry(null)}>Close</button>
              </div>
            </div>

            <div style={{ color: '#666', fontSize: 13, marginTop: 8 }}>{dayjs(previewEntry.created_at).format('YYYY-MM-DD HH:mm')} · {previewEntry.visibility}</div>

            <div style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(previewEntry.content || '') }} />
          </div>
        </div>
      )}
    </div>
  );
}
