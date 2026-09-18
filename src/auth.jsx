import { createContext, useContext, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureSeed, DEFAULT_BRANCH_ID } from './db';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [activeBranch, setActive] = useState(DEFAULT_BRANCH_ID);

  const branches = useLiveQuery(
    async () => (await db.branches.toArray()).filter((b) => b.status !== 'deleted'),
    [], []
  );

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

  // Pick the working branch: admins may switch freely (remembered in
  // localStorage); other users are pinned to their assigned branch.
  useEffect(() => {
    if (!user) return;
    if (user.role === 'admin') {
      let saved = Number(localStorage.getItem('kerp_active_branch'));
      if (!Number.isInteger(saved) || saved <= 0) saved = DEFAULT_BRANCH_ID;
      setActive(saved);
    } else {
      setActive(user.branchId || DEFAULT_BRANCH_ID);
    }
  }, [user]);

  const setActiveBranch = (id) => {
    const n = Number(id) || DEFAULT_BRANCH_ID;
    setActive(n);
    try { localStorage.setItem('kerp_active_branch', String(n)); } catch { /* ignore */ }
  };

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

  return (
    <AuthCtx.Provider value={{ user, ready, login, logout, branches, activeBranch, setActiveBranch }}>
      {children}
    </AuthCtx.Provider>
  );
}
