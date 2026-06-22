// Runtime configuration, sourced from build-time env (VITE_*).
//
// When no Supabase URL is configured (or VITE_USE_MOCK=true), the app runs
// against an in-memory mock data layer — used for local development and for
// browser-verifying rendering before a real Supabase project exists.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const forceMock = import.meta.env.VITE_USE_MOCK === "true";

export const config = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  useMock: forceMock || !url || !anonKey,
} as const;
