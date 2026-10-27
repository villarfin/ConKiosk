import React, { createContext, useContext, useState, useEffect } from 'react';
import { timedFetch } from '@/src/utils/network';
import { storage } from '@/src/utils/storage';
import { RealtimeClient } from '@/src/utils/realtime';
import { apiUrl } from '@/src/config/api';
import { router } from 'expo-router';

interface Faculty {
  _id: string;
  school_id: string;
  full_name: string;
  department: string;
  office_location: string;
  email: string;
  profile_image?: string;
  availability_status: string;
  accepting_consultations: boolean;
  office_hours?: string;
  class_schedules?: { day: string; start: string; end: string }[];
  role: 'faculty' | 'admin' | 'it_chair';
}

interface AuthContextType {
  isAuthenticated: boolean;
  initializing: boolean;
  faculty: Faculty | null;
  token: string | null;
  login: (schoolId: string, password: string) => Promise<'faculty' | 'admin' | 'it_chair'>;
  logout: () => Promise<void>;
  updateFaculty: (updatedFaculty: Faculty) => void;
  realtime: RealtimeClient | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [faculty, setFaculty] = useState<Faculty | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeClient | null>(null);

  // Initialize auth state from storage
  useEffect(() => {
    initializeAuth();
  }, []);

  // Faculty-specific notifications use the native WebSocket endpoint.
  useEffect(() => {
    if (isAuthenticated && faculty && token && !realtime) {
      const client = new RealtimeClient(faculty.school_id, token);
      client.connect();
      setRealtime(client);

      return () => {
        client.disconnect();
      };
    }
  }, [isAuthenticated, faculty?.school_id, token]);

  // An administrator can delete a faculty account while its app is open.
  // The server notifies that specific WebSocket, so revoke local access at once.
  useEffect(() => {
    if (!realtime) return;
    return realtime.subscribe((event) => {
      if (event.type === 'account_deleted') {
        void clearLocalSession().finally(() => router.replace('/login'));
      }
      if (event.type === 'role_changed' && token) {
        void timedFetch(apiUrl('/faculty/profile'), { headers: { Authorization: `Bearer ${token}` } }).then(async response => { if (response.ok) updateFaculty(await response.json()); }).catch(() => {});
      }
    });
  }, [realtime]);

  // If the real-time connection is temporarily unavailable, do not leave a
  // deleted account usable from locally cached credentials.
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const validateSession = async () => {
      try {
        const response = await timedFetch(apiUrl('/faculty/profile'), { headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 401) { await clearLocalSession(); router.replace('/login'); }
        else if (response.ok) updateFaculty(await response.json());
      } catch { /* Keep the local session during a short LAN interruption. */ }
    };
    const timer = setInterval(validateSession, 30_000);
    return () => clearInterval(timer);
  }, [isAuthenticated, token]);

  // The server uses this authenticated heartbeat to distinguish a signed-in
  // faculty device from an unknown device on the LAN. It is deliberately not
  // a replacement for internet push or router client telemetry.
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const heartbeat = () => { void timedFetch(apiUrl('/faculty/presence'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, timeoutMs: 6000 }).catch(() => {}); };
    heartbeat();
    const timer = setInterval(heartbeat, 30_000);
    return () => clearInterval(timer);
  }, [isAuthenticated, token]);

  const initializeAuth = async () => {
    try {
      const storedToken = await storage.secureGet('auth_token', null);
      const storedFaculty = await storage.getItem('faculty_data', null);

      if (storedToken && storedFaculty) {
        const response = await timedFetch(apiUrl('/faculty/profile'), { headers: { Authorization: `Bearer ${storedToken}` }, timeoutMs: 8000 });
        if (response.ok) {
          setToken(storedToken);
          setFaculty(await response.json());
          setIsAuthenticated(true);
        } else if (response.status === 401) await clearLocalSession();
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
    } finally { setInitializing(false); }
  };

  const login = async (schoolId: string, password: string): Promise<'faculty' | 'admin' | 'it_chair'> => {
    try {
      const response = await timedFetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          school_id: schoolId,
          password: password,
        }),
        timeoutMs: 15000,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Login failed');
      }

      const data = await response.json();

      // Store credentials
      if (!await storage.secureSet('auth_token', data.access_token) || !await storage.setItem('faculty_data', data.faculty)) {
        await clearLocalSession();
        throw new Error('Unable to save your session. Please check browser/device storage.');
      }

      setToken(data.access_token);
      setFaculty(data.faculty);
      setIsAuthenticated(true);
      return data.faculty.role === 'admin' || data.faculty.role === 'it_chair' ? data.faculty.role : 'faculty';
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const clearLocalSession = async () => {
    await storage.secureRemove('auth_token');
    await storage.removeItem('faculty_data');
    realtime?.disconnect();
    setRealtime(null);
    setToken(null);
    setFaculty(null);
    setIsAuthenticated(false);
  };

  const logout = async () => {
    try {
      // Tell the server first so the kiosk and TV stop offering this faculty immediately.
      if (token) {
        await timedFetch(apiUrl('/auth/logout'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, timeoutMs: 4000 });
      }
    } catch (error) {
      // Local sign-out must still succeed if Wi-Fi drops during the server request.
      console.warn('Server logout request failed:', error);
    } finally {
      await storage.secureRemove('auth_token');
      await storage.removeItem('faculty_data');

      if (realtime) {
        realtime.disconnect();
        setRealtime(null);
      }

      setToken(null);
      setFaculty(null);
      setIsAuthenticated(false);
    }
  };

  const updateFaculty = (updatedFaculty: Faculty) => {
    setFaculty(updatedFaculty);
    storage.setItem('faculty_data', updatedFaculty);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        initializing,
        faculty,
        token,
        login,
        logout,
        updateFaculty,
        realtime,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
