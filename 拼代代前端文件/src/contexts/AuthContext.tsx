import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import type { User, Session } from '@supabase/supabase-js';
import { LOGIN_COOLDOWN_MINUTES, sharedLoginAttemptGuard } from '../lib/authProtection';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  authBusy: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    try {
      setAuthBusy(true);
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error('注册失败，请稍后重试。');

      // Initialize user profile + wallet on backend
      try {
        await api.initUser();
      } catch {
        // If init fails, sign out to prevent half-initialized user from entering
        await supabase.auth.signOut();
        throw new Error('账号初始化失败，请稍后重试。');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setAuthBusy(true);
      if (!sharedLoginAttemptGuard.canAttempt()) {
        throw new Error(`输错次数过多，请 ${LOGIN_COOLDOWN_MINUTES} 分钟后再试。`);
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          sharedLoginAttemptGuard.recordFailure();
          throw new Error('邮箱或密码错误，请重新输入。');
        }
        throw new Error(error.message);
      }
      sharedLoginAttemptGuard.reset();
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    try {
      setAuthBusy(true);
      await supabase.auth.signOut();
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, authBusy, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
