// src/pages/TaskRegistryPage.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import TaskForm from '../components/TaskForm';
import TaskList from '../components/TaskList';
import TaskCalendar from '../components/TaskCalendar';
import dayjs from 'dayjs';

/*
TaskRegistryPage (updated)
- By default shows only the current user's tasks (as requested).
- Optionally toggle "Show all users" to inspect others.
- Keeps realtime subscription and reload behavior.
*/

export default function TaskRegistryPage() {
  const [user, setUser] = useState(null); // current logged-in user
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState(null);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [availableCreators, setAvailableCreators] = useState([]); // optional inspect list
  const [selectedCreator, setSelectedCreator] = useState('all'); // when showAllUsers true, pick a creator

  // load current session user
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const current = data?.session?.user ?? null;
      setUser(current);
    })();
    return () => { mounted = false; };
  }, []);

  // loader function - loads tasks according to filter (user / all / specific creator)
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('tasks').select('*').order('created_at', { ascending: false });

      if (!showAllUsers) {
        // show only my tasks
        if (!user) {
          // no user available yet - show nothing
          setTasks([]);
          setLoading(false);
          return;
        }
        query = query.eq('created_by', user.id);
      } else {
        // show all users or a specific creator if selected
        if (selectedCreator && selectedCreator !== 'all') {
          query = query.eq('created_by', selectedCreator);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      // normalize remaining_seconds fallback
      const normalized = (data || []).map(t => ({
        ...t,
        remaining_seconds: t.remaining_seconds ?? (t.duration_minutes ? t.duration_minutes * 60 : null),
      }));

      setTasks(normalized);

      // update available creators when showing all
      if (showAllUsers) {
        const creators = Array.from(new Set((normalized || []).map(t => t.created_by).filter(Boolean)));
        setAvailableCreators(creators);
      } else {
        setAvailableCreators([]);
      }
    } catch (err) {
      console.error('loadTasks error', err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [user, showAllUsers, selectedCreator]);

  // initial load when user is known or when filters change
  useEffect(() => {
    if (!user && !showAllUsers) {
      // wait until user resolved
      return;
    }
    loadTasks();
  }, [user, showAllUsers, selectedCreator, loadTasks]);

  // realtime subscription to tasks table: reload on any change
  useEffect(() => {
    const channel = supabase
      .channel('public:tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        loadTasks();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [loadTasks]);

  const onSaved = () => {
    setEditingTask(null);
    loadTasks();
  };

  // Small guard: if not logged in, tell user to log in
  if (!user) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
        <h2>Task Registry</h2>
        <div style={{ padding: 20, border: '1px solid #eee', borderRadius: 8 }}>
          <p>You must be logged in to see your tasks. Please sign in.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
      <h2 style={{ marginBottom: 10 }}>Task Registry — <span style={{ color: '#444', fontWeight: 500 }}>{user.email || user.id}</span></h2>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{
          width: 420, border: '1px solid #e6e9ee', padding: 16, borderRadius: 10, background: '#fff'
        }}>
          <h3 style={{ marginTop: 0 }}>{editingTask ? 'Edit task' : 'Create new task'}</h3>
          <TaskForm user={user} task={editingTask} onSaved={onSaved} onCancel={() => setEditingTask(null)} />
          <div style={{ marginTop: 12, fontSize: 13, color: '#666' }}>
            Notes: by default you only see your tasks. Toggle "Show all users" to inspect others.
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={loadTasks} style={actionBtn}>Refresh</button>
              <div style={{ color: '#555' }}>{loading ? 'Loading...' : `${tasks.length} tasks`}</div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 13, color: '#555' }}>
                <input
                  type="checkbox"
                  checked={showAllUsers}
                  onChange={(e) => {
                    setShowAllUsers(e.target.checked);
                    // reset creator filter when toggling
                    setSelectedCreator('all');
                  }}
                />{' '}
                Show all users
              </label>

              {showAllUsers && (
                <select value={selectedCreator} onChange={(e) => setSelectedCreator(e.target.value)} style={selectStyle}>
                  <option value="all">All users</option>
                  {availableCreators.map(uid => <option key={uid} value={uid}>{uid}</option>)}
                </select>
              )}
            </div>
          </div>

          <TaskList tasks={tasks} currentUser={user} onEdit={(t) => setEditingTask(t)} onChange={loadTasks} />
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <h3 style={{ marginBottom: 8 }}>Task Calendar (completed tasks)</h3>
        <TaskCalendar userId={user.id} />

      </div>
    </div>
  );
}

const actionBtn = { padding: '8px 10px', borderRadius: 8, cursor: 'pointer' };
const selectStyle = { padding: 8, borderRadius: 6 };
