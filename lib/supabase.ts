import { createBrowserClient } from '@supabase/ssr';

export const createClient = () => {
  if (typeof window === 'undefined') {
    throw new Error('Supabase client can only be used in browser environment');
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
};

let supabaseInstance: ReturnType<typeof createClient> | null = null;
export const getSupabase = () => {
  if (!supabaseInstance) {
    supabaseInstance = createClient();
  }
  return supabaseInstance;
};