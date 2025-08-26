import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';
import DailyChecklist from '../components/DailyChecklist';

export default function ChecklistPage() {
  const [user, setUser] = useState(null);
  const [prefs, setPrefs] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return;
      setUser(s.session.user);
      const userId = s.session.user.id;

      // get preferences
      const { data: pref } = await supabase.from('preferences').select('*').eq('user_id', userId).single().maybeSingle();
      setPrefs(pref || { platforms: [], classes: [], sports: [], template: 'custom' });
    };
    load();
  }, []);

  if (!user) return <div>Please login first.</div>;
  if (!prefs) return <div>Loading your preferences...</div>;

  return (
    <div>
      <h2>Daily Checklist</h2>
      <DailyChecklist user={user} prefs={prefs} />
    </div>
  );
}
