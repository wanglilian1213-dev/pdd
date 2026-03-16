import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { api } from '../lib/api';

interface BalanceContextValue {
  balance: number | null;
  refreshBalance: () => Promise<void>;
}

const BalanceContext = createContext<BalanceContextValue>({
  balance: null,
  refreshBalance: async () => {},
});

export function BalanceProvider({ children }: { children: ReactNode }) {
  const [balance, setBalance] = useState<number | null>(null);

  const refreshBalance = useCallback(async () => {
    try {
      const data = await api.getProfile();
      setBalance(data.balance ?? null);
    } catch {
      // non-critical
    }
  }, []);

  return (
    <BalanceContext.Provider value={{ balance, refreshBalance }}>
      {children}
    </BalanceContext.Provider>
  );
}

export function useBalance() {
  return useContext(BalanceContext);
}
