/**
 * One LAN API configuration for every Expo client.
 *
 * Set EXPO_PUBLIC_API_URL to the Pi's API prefix, for example:
 * EXPO_PUBLIC_API_URL=http://192.168.50.2:8001/api
 *
 * EXPO_PUBLIC_BACKEND_URL is retained only as a backwards-compatible fallback
 * for existing local deployments. Neither value may be localhost on a phone.
 */
const configuredUrl = (process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_BACKEND_URL || '').trim();

export const API_URL = configuredUrl.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
export const API_ORIGIN = API_URL.replace(/\/api$/, '');

export function apiUrl(path: string) {
  return `${API_URL}/${path.replace(/^\/+/, '')}`;
}

export function serverHealthUrl() {
  return apiUrl('/health');
}
