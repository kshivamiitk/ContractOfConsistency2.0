import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import LoginPage from './pages/LoginPage';
import PreferencesPage from './pages/PreferencesPage';
import ChecklistPage from './pages/ChecklistPage';
import SearchPage from './pages/SearchPage';
import Navbar from './components/Navbar';
import MyFinesPage from './pages/MyFinesPage';
export default function App() {
  const [session, setSession] = useState(null);
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

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <Navbar session={session} />
      <main style={{ padding: 20 }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/checklist" element={<ChecklistPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/fines" element={<MyFinesPage/>}/>
          <Route path="/" element={<LoginPage />} />
        </Routes>
      </main>
    </div>
  );
}
