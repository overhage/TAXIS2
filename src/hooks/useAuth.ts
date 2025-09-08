// src/hooks/useAuth.ts
import { useEffect, useState } from 'react';
import axios from 'axios';

export interface User {
  id: string;
  email: string;
  name?: string;
  isAdmin: boolean;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await axios.get('/api/session', { withCredentials: true });
        if (res.data && res.data.user) {
          const u = res.data.user;
          setUser({
            id: u.sub,
            email: u.email,
            name: u.name,
            isAdmin: Array.isArray(u.roles) && u.roles.includes('admin'),
          });
        } else {
          setUser(null);
        }
      } catch (err) {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSession();
  }, []);

  return { user, isLoading };
};
