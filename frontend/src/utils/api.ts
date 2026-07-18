import { storage } from '@/src/utils/storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export class ApiClient {
  private static async getHeaders(): Promise<HeadersInit> {
    const token = await storage.secureGet('auth_token', null);
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  static async get(endpoint: string) {
    const headers = await this.getHeaders();
    const response = await fetch(`${BACKEND_URL}/api${endpoint}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  static async post(endpoint: string, data?: any) {
    const headers = await this.getHeaders();
    const response = await fetch(`${BACKEND_URL}/api${endpoint}`, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Request failed');
    }

    return response.json();
  }

  static async patch(endpoint: string, data?: any) {
    const headers = await this.getHeaders();
    const response = await fetch(`${BACKEND_URL}/api${endpoint}`, {
      method: 'PATCH',
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Request failed');
    }

    return response.json();
  }

  static async delete(endpoint: string) {
    const headers = await this.getHeaders();
    const response = await fetch(`${BACKEND_URL}/api${endpoint}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }
}
