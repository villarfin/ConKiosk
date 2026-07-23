export type RealtimeEvent = {
  type: string;
  data?: Record<string, unknown>;
};

type Listener = (event: RealtimeEvent) => void;

const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export function websocketUrl(facultyId?: string, token?: string) {
  const base = backendUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const params = new URLSearchParams();
  if (facultyId) params.set('faculty_id', facultyId);
  if (token) params.set('token', token);
  const query = params.toString() ? `?${params.toString()}` : '';
  return `${base}/ws${query}`;
}

/** Small native-WebSocket client shared by web and React Native clients. */
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();

  constructor(private readonly facultyId?: string, private readonly token?: string) {}

  connect() {
    if (this.socket) return;
    const socket = new WebSocket(websocketUrl(this.facultyId, this.token));
    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data) as RealtimeEvent;
        this.listeners.forEach((listener) => listener(event));
      } catch (error) {
        console.warn('Ignoring invalid real-time event', error);
      }
    };
    socket.onclose = () => { this.socket = null; };
    socket.onerror = () => { socket.close(); };
    this.socket = socket;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
  }
}
