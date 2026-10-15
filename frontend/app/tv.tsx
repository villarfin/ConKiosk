import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeClient } from '@/src/utils/realtime';
import { apiUrl } from '@/src/config/api';

let announcementAudioContext: AudioContext | null = null;

const enableAnnouncementSound = async () => {
  if (typeof window === 'undefined') return false;
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

interface NowServing { queue_number: string; student_names: string[]; topic: string; }
interface FacultyStatus {
  school_id: string; full_name: string; department: string; office_location: string;
  availability_status: string; profile_image?: string; now_serving: NowServing | null;
  waiting_count: number; next_queue_numbers: string[];
}
interface RescheduleAnnouncement { student_name: string; date: string; time: string; }

const statusColor = (status: string) => ({ available: '#22C55E', busy: '#F59E0B', unavailable: '#EF4444' }[status] || '#94A3B8');
const statusLabel = (status: string) => ({ available: 'AVAILABLE', busy: 'BUSY', unavailable: 'UNAVAILABLE' }[status] || 'UNKNOWN');
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

export default function TVDisplay() {
  const [data, setData] = useState<FacultyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [soundReady, setSoundReady] = useState(false);
  const [rescheduleAnnouncement, setRescheduleAnnouncement] = useState<RescheduleAnnouncement | null>(null);
  const { width, height } = useWindowDimensions();

  const loadData = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/tv-display/status'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`TV status request failed: ${response.status}`);
      setData(await response.json());
    } catch (error) {
      console.error('Error loading TV display data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const poll = setInterval(loadData, 1000);
    return () => clearInterval(poll);
  }, [loadData]);

  useEffect(() => {
    const realtime = new RealtimeClient();
    realtime.connect();
    const unsubscribe = realtime.subscribe(({ type, data: eventData }) => {
      if (['availability_changed', 'queue_updated', 'consultation_started', 'consultation_completed', 'new_consultation_request'].includes(type)) loadData();
      if (type === 'consultation_rescheduled' && eventData?.student_name && eventData?.date && eventData?.time) {
        setRescheduleAnnouncement({ student_name: String(eventData.student_name), date: String(eventData.date), time: String(eventData.time) });
      }
    });
    return () => { unsubscribe(); realtime.disconnect(); };
  }, [loadData]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!rescheduleAnnouncement) return;
    playAnnouncementTone();
    const timer = setTimeout(() => setRescheduleAnnouncement(null), 10000);
    return () => clearTimeout(timer);
  }, [rescheduleAnnouncement]);

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#38BDF8" /></View>;

  const compact = width < 900 || height < 650;
  const columns = width >= 1600 ? 4 : width >= 1050 ? 3 : width >= 650 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(Math.max(data.length, 1) / columns));
  const pagePadding = compact ? 10 : 18;
  const gap = compact ? 8 : 14;
  const cardWidth = Math.max(1, (width - (pagePadding * 2) - (gap * (columns - 1))) / columns);
  const cardHeight = Math.max(compact ? 105 : 130, (height - (compact ? 128 : 158) - (gap * (rows - 1))) / rows);
  const availableCount = data.filter((faculty) => faculty.availability_status === 'available').length;
  const busyCount = data.filter((faculty) => faculty.availability_status === 'busy').length;
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <SafeAreaView style={styles.container}>
      {rescheduleAnnouncement && <View style={styles.announcementOverlay}><View style={styles.announcementCard}><Ionicons name="calendar" size={compact ? 38 : 56} color="#0284C7" /><Text style={styles.announcementTitle}>CONSULTATION RESCHEDULED</Text><Text style={styles.announcementStudent}>{rescheduleAnnouncement.student_name}</Text><Text style={styles.announcementDate}>{rescheduleAnnouncement.date} · {rescheduleAnnouncement.time}</Text><Text style={styles.announcementHint}>Returning to the queue display shortly</Text></View></View>}

      <View style={[styles.header, compact && styles.headerCompact]}>
        <View><Text style={[styles.brand, compact && styles.brandCompact]}>ConKiosk</Text><Text style={styles.brandSubtitle}>Faculty Consultation Queue</Text></View>
        <View style={styles.summaryRow}><Text style={styles.summaryAvailable}>{availableCount} available</Text><Text style={styles.summaryBusy}>{busyCount} busy</Text></View>
        <View style={styles.clock}><TouchableOpacity accessibilityLabel="Enable queue announcement sound" onPress={async () => { const enabled = await enableAnnouncementSound(); setSoundReady(enabled); if (enabled) playAnnouncementTone(); }} style={[styles.soundButton, soundReady && styles.soundButtonOn]}><Ionicons name={soundReady ? 'volume-high' : 'volume-mute'} size={14} color="#FFFFFF" /><Text style={styles.soundText}>{soundReady ? 'Sound on' : 'Sound'}</Text></TouchableOpacity><Text style={[styles.time, compact && styles.timeCompact]}>{time}</Text><Text style={styles.date}>{date}</Text></View>
      </View>

      <View style={[styles.grid, { padding: pagePadding, gap }]}>
        {data.map((faculty) => {
          const color = statusColor(faculty.availability_status);
          const nextNumbers = faculty.next_queue_numbers.slice(0, 4);
          return <View key={faculty.school_id} testID={`tv-faculty-${faculty.school_id}`} style={[styles.card, { width: cardWidth, height: cardHeight, borderLeftColor: color }]}>
            <View style={styles.cardTop}>
              <View style={[styles.avatar, { borderColor: color }]}>{faculty.profile_image ? <Image source={{ uri: faculty.profile_image }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{initials(faculty.full_name)}</Text>}</View>
              <View style={styles.nameBlock}><Text style={[styles.facultyName, compact && styles.facultyNameCompact]} numberOfLines={1}>{faculty.full_name}</Text><Text style={[styles.status, { color }]}>{statusLabel(faculty.availability_status)}</Text></View>
              <Text style={styles.office} numberOfLines={1}>{faculty.office_location}</Text>
            </View>

            <View style={[styles.queuePanel, faculty.now_serving ? styles.queuePanelActive : styles.queuePanelIdle]}>
              {faculty.now_serving ? <><Text style={styles.queueCaption}>NOW SERVING</Text><Text style={[styles.servingNumber, compact && styles.servingNumberCompact]}>{faculty.now_serving.queue_number}</Text><Text style={styles.servingStudent} numberOfLines={1}>{faculty.now_serving.student_names.join(', ')}</Text></> : <><Text style={styles.queueCaption}>QUEUE STATUS</Text><Text style={styles.queueEmpty}>{faculty.availability_status === 'unavailable' ? 'OFFICE CLOSED' : faculty.waiting_count ? 'WAITING TO BE CALLED' : 'NO ONE WAITING'}</Text></>}
            </View>

            <View style={styles.nextRow}><Text style={styles.nextLabel}>NEXT</Text>{nextNumbers.length ? nextNumbers.map((number) => <Text key={number} style={styles.nextNumber}>{number}</Text>) : <Text style={styles.nextEmpty}>—</Text>}<Text style={styles.waitingCount}>{faculty.waiting_count} waiting</Text></View>
          </View>;
        })}
        {!data.length && <View style={styles.emptyState}><Ionicons name="people-outline" size={42} color="#64748B" /><Text style={styles.emptyText}>No faculty are available to display.</Text></View>}
      </View>

      <View style={styles.footer}><Text style={styles.footerText}>LIVE QUEUE · Updates automatically</Text><Text style={styles.footerText}>{data.length} faculty shown</Text></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', overflow: 'hidden' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 11, backgroundColor: '#172554', borderBottomWidth: 2, borderBottomColor: '#38BDF8' },
  headerCompact: { paddingHorizontal: 12, paddingVertical: 7 },
  brand: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', letterSpacing: 0.5 }, brandCompact: { fontSize: 19 }, brandSubtitle: { color: '#BFDBFE', fontSize: 11, marginTop: 1 },
  summaryRow: { flexDirection: 'row', gap: 8 }, summaryAvailable: { color: '#BBF7D0', backgroundColor: '#166534', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, fontSize: 11, fontWeight: '800' }, summaryBusy: { color: '#FDE68A', backgroundColor: '#92400E', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, fontSize: 11, fontWeight: '800' },
  clock: { alignItems: 'flex-end' }, soundButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#64748B', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 3 }, soundButtonOn: { backgroundColor: '#16A34A' }, soundText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' }, time: { color: '#FFFFFF', fontSize: 23, fontWeight: '800', fontVariant: ['tabular-nums'] }, timeCompact: { fontSize: 17 }, date: { color: '#BFDBFE', fontSize: 10 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', overflow: 'hidden' }, card: { backgroundColor: '#1E293B', borderRadius: 14, borderLeftWidth: 6, padding: 11, justifyContent: 'space-between', overflow: 'hidden' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, avatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, avatarImage: { width: '100%', height: '100%' }, avatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, nameBlock: { flex: 1, minWidth: 0 }, facultyName: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' }, facultyNameCompact: { fontSize: 13 }, status: { marginTop: 1, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 }, office: { maxWidth: '28%', color: '#94A3B8', fontSize: 9, textAlign: 'right' },
  queuePanel: { minHeight: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, marginVertical: 5 }, queuePanelActive: { backgroundColor: '#082F49', borderWidth: 1, borderColor: '#0EA5E9' }, queuePanelIdle: { backgroundColor: '#273449' }, queueCaption: { color: '#BAE6FD', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, servingNumber: { color: '#FFFFFF', fontSize: 30, lineHeight: 33, fontWeight: '900' }, servingNumberCompact: { fontSize: 23, lineHeight: 27 }, servingStudent: { color: '#E0F2FE', fontSize: 10, fontWeight: '600', maxWidth: '100%' }, queueEmpty: { color: '#CBD5E1', fontSize: 13, fontWeight: '800', marginTop: 4 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 18 }, nextLabel: { color: '#94A3B8', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, nextNumber: { color: '#E2E8F0', fontSize: 12, fontWeight: '800', backgroundColor: '#334155', paddingHorizontal: 5, borderRadius: 5 }, nextEmpty: { color: '#64748B', fontSize: 13 }, waitingCount: { marginLeft: 'auto', color: '#94A3B8', fontSize: 10, fontWeight: '700' },
  footer: { minHeight: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, backgroundColor: '#172554', borderTopWidth: 1, borderTopColor: '#334155' }, footerText: { color: '#93C5FD', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }, emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: '100%', gap: 12 }, emptyText: { color: '#CBD5E1', fontSize: 16, fontWeight: '600' },
  announcementOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, backgroundColor: 'rgba(15, 23, 42, 0.95)', alignItems: 'center', justifyContent: 'center', padding: 24 }, announcementCard: { width: '88%', maxWidth: 700, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 34, borderWidth: 4, borderColor: '#38BDF8' }, announcementTitle: { marginTop: 12, color: '#0284C7', fontSize: 21, fontWeight: '900', letterSpacing: 0.8 }, announcementStudent: { marginTop: 18, color: '#0F172A', fontSize: 34, fontWeight: '900', textAlign: 'center' }, announcementDate: { marginTop: 12, color: '#334155', fontSize: 22, fontWeight: '700' }, announcementHint: { marginTop: 22, color: '#64748B', fontSize: 13 },
});
