import { createContext, useContext, useEffect, useState } from 'react';
import { db, ensureSeed } from './db';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await ensureSeed();
      const saved = localStorage.getItem('kerp_user');
      if (saved) {
        const u = await db.users.get(Number(saved));
        if (u) setUser(u);
      }
      setReady(true);
    })();
  }, []);

  const login = async (userId, pin) => {
    const u = await db.users.get(userId);
    if (!u || u.pin !== pin) return false;
    setUser(u);
    localStorage.setItem('kerp_user', String(u.id));
    return true;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('kerp_user');
  };

  return <AuthCtx.Provider value={{ user, ready, login, logout }}>{children}</AuthCtx.Provider>;
}
