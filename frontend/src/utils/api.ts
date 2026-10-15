import { storage } from '@/src/utils/storage';
import { timedFetch } from '@/src/utils/network';
import { apiUrl } from '@/src/config/api';

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
    const response = await timedFetch(apiUrl(endpoint), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || `API Error: ${response.statusText}`);
    }

    return response.json();
  }

  static async post(endpoint: string, data?: any) {
    const headers = await this.getHeaders();
    const response = await timedFetch(apiUrl(endpoint), {
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
    const response = await timedFetch(apiUrl(endpoint), {
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

  static async delete(endpoint: string, data?: any) {
    const headers = await this.getHeaders();
    const response = await timedFetch(apiUrl(endpoint), {
      method: 'DELETE',
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || `API Error: ${response.statusText}`);
    }

    return response.json();
  }
}
