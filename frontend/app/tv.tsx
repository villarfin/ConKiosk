import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import io, { Socket } from 'socket.io-client';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface NowServing {
  queue_number: number;
  student_names: string[];
  topic: string;
}

interface FacultyStatus {
  school_id: string;
  full_name: string;
  department: string;
  office_location: string;
  availability_status: string;
  now_serving: NowServing | null;
  waiting_count: number;
  next_queue_numbers: number[];
}

export default function TVDisplay() {
  const [data, setData] = useState<FacultyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  const loadData = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/tv-display/status`);
      const result = await response.json();
      setData(result);
    } catch (e) {
      console.error('Error loading TV display data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Poll every 10 seconds as a fallback
    const poll = setInterval(loadData, 10000);
    return () => clearInterval(poll);
  }, [loadData]);

  // Real-time Socket.IO updates
  useEffect(() => {
    const socket: Socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
    });
    socket.on('availability_changed', () => loadData());
    socket.on('queue_updated', () => loadData());
    socket.on('consultation_started', () => loadData());
    socket.on('consultation_completed', () => loadData());
    socket.on('new_consultation_request', () => loadData());
    return () => { socket.disconnect(); };
  }, [loadData]);

  // Clock ticker
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return '#4CAF50';
      case 'busy': return '#FF9800';
      case 'unavailable': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'available': return 'AVAILABLE';
      case 'busy': return 'BUSY';
      case 'unavailable': return 'UNAVAILABLE';
      default: return 'UNKNOWN';
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
      </View>
    );
  }

  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.brand}>ConKiosk</Text>
          <Text style={styles.brandSubtitle}>Faculty Consultation Queue</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.time}>{timeStr}</Text>
          <Text style={styles.date}>{dateStr}</Text>
        </View>
      </View>

      {/* Faculty Grid */}
      <ScrollView contentContainerStyle={styles.grid}>
        {data.map((f) => (
          <View key={f.school_id} testID={`tv-faculty-${f.school_id}`} style={styles.card}>
            {/* Status Strip */}
            <View style={[styles.statusStrip, { backgroundColor: getStatusColor(f.availability_status) }]}>
              <View style={styles.statusStripInner}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>{getStatusLabel(f.availability_status)}</Text>
              </View>
            </View>

            {/* Faculty Info */}
            <View style={styles.cardBody}>
              <Text style={styles.facultyName}>{f.full_name}</Text>
              <Text style={styles.facultyDept}>{f.department}</Text>
              <View style={styles.officeRow}>
                <Ionicons name="location" size={14} color="#666" />
                <Text style={styles.officeText}>{f.office_location}</Text>
              </View>

              {/* Now Serving */}
              {f.now_serving ? (
                <View style={styles.nowServingBox}>
                  <Text style={styles.nowServingLabel}>NOW SERVING</Text>
                  <Text style={styles.nowServingNumber}>#{f.now_serving.queue_number}</Text>
                  <Text style={styles.nowServingName} numberOfLines={1}>
                    {f.now_serving.student_names.join(', ')}
                  </Text>
                </View>
              ) : (
                <View style={[styles.nowServingBox, styles.nowServingEmpty]}>
                  <Text style={styles.nowServingLabelEmpty}>
                    {f.availability_status === 'unavailable' ? 'OFFICE CLOSED' : 'NO ACTIVE CONSULTATION'}
                  </Text>
                </View>
              )}

              {/* Queue */}
              <View style={styles.queueRow}>
                <View style={styles.queueMeta}>
                  <Text style={styles.queueMetaLabel}>Waiting</Text>
                  <Text style={styles.queueMetaValue}>{f.waiting_count}</Text>
                </View>
                <View style={styles.nextQueue}>
                  <Text style={styles.nextQueueLabel}>Next in Queue</Text>
                  {f.next_queue_numbers.length > 0 ? (
                    <View style={styles.nextNumbers}>
                      {f.next_queue_numbers.map((n) => (
                        <View key={n} style={styles.numberChip}>
                          <Text style={styles.numberChipText}>#{n}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.emptyQueueText}>—</Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          <Ionicons name="sync" size={12} color="#666" />  Auto-refreshing • Real-time updates enabled
        </Text>
      </View>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get('window');
const isWide = width > 900;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadingContainer: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#1E293B',
    borderBottomWidth: 2,
    borderBottomColor: '#2196F3',
  },
  headerLeft: {},
  brand: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
  brandSubtitle: { fontSize: 14, color: '#94A3B8', marginTop: 4 },
  headerRight: { alignItems: 'flex-end' },
  time: { fontSize: 32, fontWeight: '700', color: '#2196F3', fontVariant: ['tabular-nums'] },
  date: { fontSize: 14, color: '#94A3B8', marginTop: 4 },
  grid: {
    padding: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'flex-start',
  },
  card: {
    width: isWide ? '32%' : '48%',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
    minWidth: 260,
  },
  statusStrip: { paddingVertical: 8, paddingHorizontal: 16 },
  statusStripInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF' },
  statusText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  cardBody: { padding: 16 },
  facultyName: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  facultyDept: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  officeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  officeText: { fontSize: 12, color: '#94A3B8' },
  nowServingBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  nowServingEmpty: { borderLeftColor: '#334155' },
  nowServingLabel: { color: '#2196F3', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  nowServingLabelEmpty: { color: '#64748B', fontSize: 12, fontWeight: '600', letterSpacing: 1, textAlign: 'center' },
  nowServingNumber: { fontSize: 36, fontWeight: '800', color: '#FFFFFF', marginTop: 4 },
  nowServingName: { fontSize: 14, color: '#94A3B8', marginTop: 2 },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  queueMeta: { alignItems: 'flex-start' },
  queueMetaLabel: { fontSize: 10, color: '#64748B', letterSpacing: 1, fontWeight: '600' },
  queueMetaValue: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', marginTop: 2 },
  nextQueue: { flex: 1, alignItems: 'flex-end' },
  nextQueueLabel: { fontSize: 10, color: '#64748B', letterSpacing: 1, fontWeight: '600' },
  nextNumbers: { flexDirection: 'row', gap: 4, marginTop: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  numberChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  numberChipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  emptyQueueText: { color: '#64748B', fontSize: 16, marginTop: 4 },
  footer: {
    padding: 12,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    alignItems: 'center',
  },
  footerText: { color: '#94A3B8', fontSize: 12 },
});
