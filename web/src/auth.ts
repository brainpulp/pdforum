// Invite-only authentication abstraction (magic-link).
//
// SupabaseAuth uses passwordless email OTP (magic link). MockAuth simulates a
// signed-in session immediately so rendering can be verified without a backend.

import { supabase } from "./client.ts";

export interface Session {
  email: string;
}

export interface SignInResult {
  ok: boolean;
  message: string;
}

export interface Auth {
  getSession(): Promise<Session | null>;
  signIn(email: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  onChange(cb: () => void): void;
}

const MOCK_KEY = "pdforum.mock.session";

class MockAuth implements Auth {
  private listeners: (() => void)[] = [];

  async getSession(): Promise<Session | null> {
    const raw = localStorage.getItem(MOCK_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  async signIn(email: string): Promise<SignInResult> {
    // In mock mode we skip the email round-trip and sign in directly.
    localStorage.setItem(MOCK_KEY, JSON.stringify({ email }));
    this.listeners.forEach((cb) => cb());
    return { ok: true, message: "Signed in (mock mode)." };
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(MOCK_KEY);
    this.listeners.forEach((cb) => cb());
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }
}

class SupabaseAuth implements Auth {
  async getSession(): Promise<Session | null> {
    const { data } = await supabase!.auth.getSession();
    const email = data.session?.user?.email;
    return email ? { email } : null;
  }

  async signIn(email: string): Promise<SignInResult> {
    const { error } = await supabase!.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }, // invite-only: no self sign-up
    });
    if (error) return { ok: false, message: error.message };
    return {
      ok: true,
      message: "Check your email for a sign-in link.",
    };
  }

  async signOut(): Promise<void> {
    await supabase!.auth.signOut();
  }

  onChange(cb: () => void): void {
    supabase!.auth.onAuthStateChange(() => cb());
  }
}

export const auth: Auth = supabase ? new SupabaseAuth() : new MockAuth();
