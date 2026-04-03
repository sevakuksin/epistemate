import { createContext, useContext, useMemo, useState } from "react";

type User = {
  id: string;
  username: string;
};

type AuthContextValue = {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
};

const KEY = "cv_current_user";
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadUser(): User | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => loadUser());
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      login(next) {
        setUser(next);
        localStorage.setItem(KEY, JSON.stringify(next));
      },
      logout() {
        setUser(null);
        localStorage.removeItem(KEY);
      },
    }),
    [user]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
