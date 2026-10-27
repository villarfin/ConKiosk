import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { serverHealthUrl } from '@/src/config/api';

const CHECK_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4_000;

export function ServerConnectionStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(serverHealthUrl(), { signal: controller.signal });
        if (active) setConnected(response.ok);
      } catch {
        if (active) setConnected(false);
      } finally {
        clearTimeout(timeout);
      }
    };
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => { active = false; clearInterval(interval); };
  }, []);

  if (connected === null) return null;
  return (
    <View pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.badge, connected ? styles.connected : styles.unreachable]}>
      <View style={styles.dot} />
      <Text style={styles.text}>{connected ? 'Server online' : 'Server offline'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Floating status keeps connection feedback visible without reserving a
  // full-width row above the kiosk and TV interfaces.
  badge: { position: 'absolute', zIndex: 100, top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, elevation: 5 },
  connected: { backgroundColor: '#166534' },
  unreachable: { backgroundColor: '#B91C1C' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  text: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
});
