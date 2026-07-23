import React, { createContext, useContext, useState, useEffect } from 'react';
import { storage } from '@/src/utils/storage';
import { RealtimeClient } from '@/src/utils/realtime';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface Faculty {
  _id: string;
  school_id: string;
  full_name: string;
  department: string;
  office_location: string;
  email: string;
  profile_image?: string;
  availability_status: string;
  office_hours?: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  faculty: Faculty | null;
  token: string | null;
  login: (schoolId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateFaculty: (updatedFaculty: Faculty) => void;
  realtime: RealtimeClient | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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

  const initializeAuth = async () => {
    try {
      const storedToken = await storage.secureGet('auth_token', null);
      const storedFaculty = await storage.getItem('faculty_data', null);

      if (storedToken && storedFaculty) {
        setToken(storedToken);
        setFaculty(storedFaculty);
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
    }
  };

  const login = async (schoolId: string, password: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          school_id: schoolId,
          password: password,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Login failed');
      }

      const data = await response.json();

      // Store credentials
      await storage.secureSet('auth_token', data.access_token);
      await storage.setItem('faculty_data', data.faculty);

      setToken(data.access_token);
      setFaculty(data.faculty);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await storage.secureRemove('auth_token');
      await storage.removeItem('faculty_data');

      if (realtime) {
        realtime.disconnect();
        setRealtime(null);
      }

      setToken(null);
      setFaculty(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Logout error:', error);
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
