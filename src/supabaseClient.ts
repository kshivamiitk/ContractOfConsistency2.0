// src/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // helpful runtime guard — dev server will show this
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment. ' +
    'Create a .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
