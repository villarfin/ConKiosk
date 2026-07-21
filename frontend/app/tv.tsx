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
  profile_image?: string;
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
    const poll = setInterval(loadData, 10000);
    return () => clearInterval(poll);
  }, [loadData]);

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

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
      </View>
    );
  }

  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Summary stats
  const availableCount = data.filter(f => f.availability_status === 'available').length;
  const busyCount = data.filter(f => f.availability_status === 'busy').length;
  const unavailableCount = data.filter(f => f.availability_status === 'unavailable').length;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.brand}>ConKiosk</Text>
          <Text style={styles.brandSubtitle}>Faculty Consultation Queue</Text>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryChip, { borderColor: '#4CAF50' }]}>
            <View style={[styles.summaryDot, { backgroundColor: '#4CAF50' }]} />
            <Text style={styles.summaryChipText}>{availableCount} Available</Text>
          </View>
          <View style={[styles.summaryChip, { borderColor: '#FF9800' }]}>
            <View style={[styles.summaryDot, { backgroundColor: '#FF9800' }]} />
            <Text style={styles.summaryChipText}>{busyCount} Busy</Text>
          </View>
          <View style={[styles.summaryChip, { borderColor: '#F44336' }]}>
            <View style={[styles.summaryDot, { backgroundColor: '#F44336' }]} />
            <Text style={styles.summaryChipText}>{unavailableCount} Off</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.time}>{timeStr}</Text>
          <Text style={styles.date}>{dateStr}</Text>
        </View>
      </View>

      {/* Compact Faculty Grid */}
      <ScrollView contentContainerStyle={styles.grid}>
        {data.map((f) => (
          <View key={f.school_id} testID={`tv-faculty-${f.school_id}`} style={styles.card}>
            {/* Left: Avatar with status ring */}
            <View style={styles.avatarWrap}>
              <View style={[styles.avatarRing, { borderColor: getStatusColor(f.availability_status) }]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(f.full_name)}</Text>
                </View>
              </View>
              <View style={[styles.statusDot, { backgroundColor: getStatusColor(f.availability_status) }]} />
            </View>

            {/* Right: Info */}
            <View style={styles.cardBody}>
              <Text style={styles.facultyName} numberOfLines={1}>{f.full_name}</Text>

              <View style={styles.statusRow}>
                <View style={[styles.statusPill, { backgroundColor: getStatusColor(f.availability_status) }]}>
                  <Text style={styles.statusPillText}>{getStatusLabel(f.availability_status)}</Text>
                </View>
              </View>

              {/* Queue info */}
              {f.now_serving ? (
                <View style={styles.queueRow}>
                  <Text style={styles.queueLabel}>NOW SERVING</Text>
                  <Text style={styles.queueNumber}>#{f.now_serving.queue_number}</Text>
                  {f.waiting_count > 0 && (
                    <Text style={styles.queueWaiting}>+{f.waiting_count} waiting</Text>
                  )}
                </View>
              ) : f.waiting_count > 0 ? (
                <View style={styles.queueRow}>
                  <Text style={styles.queueLabel}>NEXT UP</Text>
                  <Text style={styles.queueNumberNext}>#{f.next_queue_numbers[0]}</Text>
                  {f.waiting_count > 1 && (
                    <Text style={styles.queueWaiting}>+{f.waiting_count - 1} more</Text>
                  )}
                </View>
              ) : (
                <View style={styles.queueRow}>
                  <Text style={styles.queueEmpty}>
                    {f.availability_status === 'unavailable' ? 'Office closed' : 'No queue'}
                  </Text>
                </View>
              )}

              <Text style={styles.officeText} numberOfLines={1}>
                <Ionicons name="location" size={10} color="#64748B" /> {f.office_location}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          <Ionicons name="sync" size={12} color="#94A3B8" />  Auto-refreshing • Real-time updates
        </Text>
        <Text style={styles.footerText}>Showing {data.length} faculty</Text>
      </View>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get('window');

// Responsive column count: fit as many compact cards as possible per row
let columnCount = 2;
if (width >= 1600) columnCount = 4;
else if (width >= 1200) columnCount = 3;
else if (width >= 800) columnCount = 2;
else columnCount = 1;

// Card width accounting for gap (12px)
const gap = 12;
const cardWidth = `${(100 / columnCount) - (gap * (columnCount - 1) / (columnCount * width / 100)) / columnCount}%`;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadingContainer: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#1E293B',
    borderBottomWidth: 2,
    borderBottomColor: '#2196F3',
    flexWrap: 'wrap',
    gap: 12,
  },
  headerLeft: {},
  brand: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
  brandSubtitle: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    backgroundColor: '#0F172A',
  },
  summaryDot: { width: 8, height: 8, borderRadius: 4 },
  summaryChipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  headerRight: { alignItems: 'flex-end' },
  time: { fontSize: 24, fontWeight: '700', color: '#2196F3', fontVariant: ['tabular-nums'] },
  date: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  grid: {
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: cardWidth as any,
    minWidth: 300,
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
    alignItems: 'center',
  },
  avatarWrap: { position: 'relative' },
  avatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#1E293B',
  },
  cardBody: { flex: 1, gap: 4 },
  facultyName: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  queueLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '600', letterSpacing: 0.8 },
  queueNumber: { fontSize: 20, color: '#2196F3', fontWeight: '800' },
  queueNumberNext: { fontSize: 18, color: '#94A3B8', fontWeight: '700' },
  queueWaiting: { fontSize: 10, color: '#64748B', fontWeight: '500' },
  queueEmpty: { fontSize: 11, color: '#64748B', fontStyle: 'italic' },
  officeText: { fontSize: 10, color: '#64748B', marginTop: 2 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  footerText: { color: '#94A3B8', fontSize: 11 },
});
