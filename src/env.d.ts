// src/env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    // add other VITE_ variables here if you create more
    readonly NODE_ENV?: 'development' | 'production' | 'test';
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  