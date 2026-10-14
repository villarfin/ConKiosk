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
      <Text style={styles.text}>ConKiosk Server {connected ? 'Connected' : 'Unreachable'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 12, paddingVertical: 7 },
  connected: { backgroundColor: '#166534' },
  unreachable: { backgroundColor: '#B91C1C' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },
  text: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});
