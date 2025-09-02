import { useEffect, useState } from 'react';
import axios from 'axios';

export interface User {
  id: string;
  email: string;
  name?: string;
  isAdmin: boolean;
}

/**
 * Hook to manage authenticated user state. It queries the backend for the current
 * session and caches the result in memory. If the user logs out, the page
 * should be reloaded to clear cached state.
 */
export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const res = await axios.get('/api/me');
        if (res.data && res.data.id) {
          setUser(res.data as User);
        } else {
          setUser(null);
        }
      } catch (err) {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMe();
  }, []);

  return { user, isLoading };
};