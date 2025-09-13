// src/App.jsx
import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import LoginPage from './pages/LoginPage';
import PreferencesPage from './pages/PreferencesPage';
import ChecklistPage from './pages/ChecklistPage';
import SearchPage from './pages/SearchPage';
import Navbar from './components/Navbar';
import MyFinesPage from './pages/MyFinesPage';
import TaskRegistryPage from './pages/TaskRegistryPage.jsx';
import DayProfilePage from './pages/DayProfilePage.jsx';
import TodayOthersPage from './pages/TodayOthersPage.jsx';
import DiaryPage from './pages/DiaryPage';
import CalendarPage from './pages/CalendarPage';
import ChatPage from './pages/ChatPage';
import Pomodoro from './components/Pomodoro';
import UnreadMessagesPopup from './components/UnreadMessagesPopup';
import ConsistencyPage from './pages/ConsistencyPage';

export default function App() {
  const [session, setSession] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) navigate('/preferences');
      else navigate('/login');
    });

    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, []);

  // handler passed into ChatPage so it can notify App about unread total
  const handleUnreadChange = (totalUnread) => {
    setUnreadCount(Number(totalUnread || 0));
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <Navbar session={session} unreadCount={unreadCount} />
      {session && <UnreadMessagesPopup session={session} />}
      <main style={{ padding: 20 }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/checklist" element={<ChecklistPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/fines" element={<MyFinesPage/>}/>
          <Route path="/day-profile" element={<DayProfilePage />} />
          <Route path="/tasks" element={<TaskRegistryPage />} />
          <Route path="/diary" element={<DiaryPage session={session} />} />
          <Route path="/calendar" element={<CalendarPage session={session} />} />
          {/* pass the prop to ChatPage so it can call onUnreadChange(totalUnread) */}
          <Route path="/chat" element={<ChatPage session={session} onUnreadChange={handleUnreadChange} />} />
          <Route path="/pomodoro" element={<Pomodoro />} />
          <Route path="consistency" element={<ConsistencyPage/>}/>
          <Route path="/" element={<LoginPage />} />
        </Routes>
      </main>
    </div>
  );
}
