import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions, Image, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeClient } from '@/src/utils/realtime';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

let announcementAudioContext: AudioContext | null = null;

const enableAnnouncementSound = async () => {
  if (typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return false;
  announcementAudioContext ??= new AudioContextClass();
  await announcementAudioContext.resume?.();
  return announcementAudioContext.state === 'running';
};

const playAnnouncementTone = () => {
  const context = announcementAudioContext;
  if (!context || context.state !== 'running') return false;
  [0, 0.24].forEach((offset) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = offset ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.2);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(context.currentTime + offset); oscillator.stop(context.currentTime + offset + 0.21);
  });
  return true;
};

interface NowServing {
  queue_number: string;
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
  next_queue_numbers: string[];
}
interface RescheduleAnnouncement { student_name: string; date: string; time: string; }

export default function TVDisplay() {
  const [data, setData] = useState<FacultyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [rescheduleAnnouncement, setRescheduleAnnouncement] = useState<RescheduleAnnouncement | null>(null);
  const [soundReady, setSoundReady] = useState(false);

  const activateSound = async () => {
    const enabled = await enableAnnouncementSound();
    setSoundReady(Boolean(enabled));
    if (enabled) playAnnouncementTone();
  };

  const loadData = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/tv-display/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`TV status request failed: ${response.status}`);
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
    // WebSocket events update immediately; recover within one second if a display
    // browser misses an event while reconnecting to Wi-Fi.
    const poll = setInterval(loadData, 1000);
    return () => clearInterval(poll);
  }, [loadData]);

  useEffect(() => {
    const realtime = new RealtimeClient();
    realtime.connect();
    const unsubscribe = realtime.subscribe(({ type, data }) => {
      if (['availability_changed', 'queue_updated', 'consultation_started',
        'consultation_completed', 'new_consultation_request'].includes(type)) loadData();
      if (type === 'consultation_rescheduled' && data?.student_name && data?.date && data?.time) {
        setRescheduleAnnouncement({ student_name: String(data.student_name), date: String(data.date), time: String(data.time) });
      }
    });
    return () => { unsubscribe(); realtime.disconnect(); };
  }, [loadData]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!rescheduleAnnouncement) return;
    playAnnouncementTone();
    const timer = setTimeout(() => setRescheduleAnnouncement(null), 10000);
    return () => clearTimeout(timer);
  }, [rescheduleAnnouncement]);

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
      {rescheduleAnnouncement && <View style={styles.announcementOverlay}><View style={styles.announcementCard}><Ionicons name="calendar" size={56} color="#2196F3" /><Text style={styles.announcementTitle}>CONSULTATION RESCHEDULED</Text><Text style={styles.announcementStudent}>{rescheduleAnnouncement.student_name}</Text><Text style={styles.announcementDate}>{rescheduleAnnouncement.date}</Text><Text style={styles.announcementTime}>{rescheduleAnnouncement.time}</Text><Text style={styles.announcementHint}>Returning to the queue display shortly</Text></View></View>}
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
          <TouchableOpacity onPress={activateSound} style={[styles.soundButton, soundReady && styles.soundButtonEnabled]}>
            <Ionicons name={soundReady ? 'volume-high' : 'volume-mute'} size={16} color="#FFFFFF" />
            <Text style={styles.soundButtonText}>{soundReady ? 'Sound on' : 'Enable sound'}</Text>
          </TouchableOpacity>
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
                    {f.profile_image ? (
                      <Image source={{ uri: f.profile_image }} style={styles.avatarImage} />
                    ) : (
                      <Text style={styles.avatarText}>{getInitials(f.full_name)}</Text>
                    )}
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
                  <Text style={styles.queueNumber}>{f.now_serving.queue_number}</Text>
                  {f.waiting_count > 0 && (
                    <Text style={styles.queueWaiting}>+{f.waiting_count} waiting</Text>
                  )}
                </View>
              ) : f.waiting_count > 0 ? (
                <View style={styles.queueRow}>
                  <Text style={styles.queueLabel}>NEXT UP</Text>
                  <Text style={styles.queueNumberNext}>{f.next_queue_numbers[0]}</Text>
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
  announcementOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, backgroundColor: 'rgba(15, 23, 42, 0.94)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  announcementCard: { width: '90%', maxWidth: 760, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 42, borderWidth: 4, borderColor: '#2196F3' },
  announcementTitle: { marginTop: 14, color: '#2196F3', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  announcementStudent: { marginTop: 22, color: '#0F172A', fontSize: 36, fontWeight: '800', textAlign: 'center' },
  announcementDate: { marginTop: 18, color: '#1E293B', fontSize: 26, fontWeight: '700' },
  announcementTime: { marginTop: 6, color: '#2196F3', fontSize: 30, fontWeight: '800' },
  announcementHint: { marginTop: 28, color: '#64748B', fontSize: 14 },
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
  soundButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#64748B' },
  soundButtonEnabled: { backgroundColor: '#16A34A' },
  soundButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
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
  avatarImage: { width: '100%', height: '100%', borderRadius: 27 },
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
