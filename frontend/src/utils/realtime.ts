export type RealtimeEvent = {
  type: string;
  data?: Record<string, unknown>;
};

type Listener = (event: RealtimeEvent) => void;

import { API_ORIGIN } from '@/src/config/api';

export function websocketUrl(facultyId?: string, token?: string) {
  const base = API_ORIGIN.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const params = new URLSearchParams();
  if (facultyId) params.set('faculty_id', facultyId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return `${base}/ws${query}`;
}

/** Small native-WebSocket client shared by web and React Native clients. */
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByClient = false;

  constructor(private readonly facultyId?: string, private readonly token?: string) {}

  connect() {
    if (this.socket || this.reconnectTimer) return;
    this.closedByClient = false;
    const socket = new WebSocket(websocketUrl(this.facultyId, this.token));
    socket.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.facultyId && this.token) socket.send(JSON.stringify({ token: this.token }));
    };
    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data) as RealtimeEvent;
        this.listeners.forEach((listener) => listener(event));
      } catch (error) {
        console.warn('Ignoring invalid real-time event', error);
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.closedByClient) this.scheduleReconnect();
    };
    socket.onerror = () => { socket.close(); };
    this.socket = socket;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    // Retry quickly after a brief Wi-Fi interruption, then back off to 30 seconds.
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  disconnect() {
    this.closedByClient = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
  }
}
