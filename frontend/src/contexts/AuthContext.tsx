import React, { createContext, useContext, useState, useEffect } from 'react';
import { storage } from '@/src/utils/storage';
import io, { Socket } from 'socket.io-client';

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
  socket: Socket | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [faculty, setFaculty] = useState<Faculty | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Initialize auth state from storage
  useEffect(() => {
    initializeAuth();
  }, []);

  // Setup Socket.IO when authenticated
  useEffect(() => {
    if (isAuthenticated && faculty && !socket) {
      const newSocket = io(BACKEND_URL, {
        transports: ['websocket', 'polling'],
      });

      newSocket.on('connect', () => {
        console.log('Socket connected');
        newSocket.emit('join_faculty_room', { school_id: faculty.school_id });
      });

      newSocket.on('disconnect', () => {
        console.log('Socket disconnected');
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [isAuthenticated, faculty]);

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

      if (socket) {
        socket.disconnect();
        setSocket(null);
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
        socket,
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
