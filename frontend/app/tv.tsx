import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeClient } from '@/src/utils/realtime';
import { apiUrl } from '@/src/config/api';

let announcementAudioContext: AudioContext | null = null;

interface NowServing { queue_number: string; student_names: string[]; topic: string; }
interface FacultyStatus {
  school_id: string; full_name: string; office_location: string; availability_status: string;
  now_serving: NowServing | null; waiting_count: number; next_queue_numbers: string[];
}
interface RescheduleAnnouncement { student_name: string; date: string; time: string; }

const enableSound = async () => {
  if (typeof window === 'undefined') return false;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return false;
  announcementAudioContext ??= new AudioContextClass();
  await announcementAudioContext.resume?.();
  return announcementAudioContext.state === 'running';
};

const playTone = () => {
  const context = announcementAudioContext;
  if (!context || context.state !== 'running') return;
  [0, 0.24].forEach((offset) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = offset ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.2);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(context.currentTime + offset); oscillator.stop(context.currentTime + offset + 0.21);
  });
};

export default function TVDisplay() {
  const [faculty, setFaculty] = useState<FacultyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [soundOn, setSoundOn] = useState(false);
  const [announcement, setAnnouncement] = useState<RescheduleAnnouncement | null>(null);
  const { width, height } = useWindowDimensions();

  const load = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/tv-display/status'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`TV status request failed: ${response.status}`);
      setFaculty(await response.json());
    } catch (error) {
      console.error('Unable to load TV queue:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 1000);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const realtime = new RealtimeClient();
    realtime.connect();
    const unsubscribe = realtime.subscribe(({ type, data }) => {
      if (['availability_changed', 'queue_updated', 'consultation_started', 'consultation_completed', 'new_consultation_request'].includes(type)) load();
      if (type === 'consultation_rescheduled' && data?.student_name && data?.date && data?.time) {
        setAnnouncement({ student_name: String(data.student_name), date: String(data.date), time: String(data.time) });
      }
    });
    return () => { unsubscribe(); realtime.disconnect(); };
  }, [load]);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!announcement) return;
    playTone();
    const timeout = setTimeout(() => setAnnouncement(null), 10000);
    return () => clearTimeout(timeout);
  }, [announcement]);

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#FFFFFF" /></View>;

  const compact = width < 1000 || height < 700;
  const serving = faculty.filter((person) => person.now_serving);
  const waiting = faculty.flatMap((person) => person.next_queue_numbers.map((queueNumber, index) => ({
    id: `${person.school_id}-${queueNumber}`, queueNumber, facultyName: person.full_name,
    office: person.office_location, order: index + 1,
  })));
  const servingColumns = serving.length > 4 ? 3 : serving.length > 1 ? 2 : 1;
  const waitingColumns = waiting.length > 8 ? 3 : waiting.length > 1 ? 2 : 1;
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.container}>
      {announcement && <View style={styles.announcementOverlay}><View style={styles.announcementCard}><Ionicons name="calendar" size={compact ? 40 : 58} color="#075985" /><Text style={styles.announcementTitle}>CONSULTATION RESCHEDULED</Text><Text style={styles.announcementStudent}>{announcement.student_name}</Text><Text style={styles.announcementInfo}>{announcement.date} · {announcement.time}</Text><Text style={styles.announcementHint}>Returning to the queue board shortly</Text></View></View>}

      <View style={[styles.header, compact && styles.headerCompact]}>
        <View><Text style={[styles.brand, compact && styles.brandCompact]}>ConKiosk</Text><Text style={styles.subtitle}>FACULTY CONSULTATION QUEUE</Text></View>
        <View style={styles.headerCenter}><Text style={[styles.headerMessage, compact && styles.headerMessageCompact]}>Please wait for your queue number</Text></View>
        <View style={styles.clock}><TouchableOpacity accessibilityLabel="Enable announcement sound" onPress={async () => { const enabled = await enableSound(); setSoundOn(enabled); if (enabled) playTone(); }} style={[styles.soundButton, soundOn && styles.soundButtonOn]}><Ionicons name={soundOn ? 'volume-high' : 'volume-mute'} size={14} color="#FFFFFF" /><Text style={styles.soundText}>{soundOn ? 'SOUND ON' : 'SOUND'}</Text></TouchableOpacity><Text style={[styles.time, compact && styles.timeCompact]}>{time}</Text><Text style={styles.date}>{date}</Text></View>
      </View>

      <View style={styles.board}>
        <View style={[styles.boardSection, styles.nowServingSection]}>
          <View style={styles.sectionHeading}><Ionicons name="megaphone" size={compact ? 20 : 28} color="#FDE047" /><Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>NOW SERVING</Text></View>
          {serving.length ? <View style={[styles.servingGrid, { gridTemplateColumns: `repeat(${servingColumns}, minmax(0, 1fr))` } as any]}>{serving.map((person) => <View key={person.school_id} style={styles.servingCard}><Text style={styles.servingQueue}>{person.now_serving?.queue_number}</Text><Text style={styles.servingFaculty} numberOfLines={1}>{person.full_name}</Text><Text style={styles.servingOffice} numberOfLines={1}>{person.office_location}</Text><Text style={styles.servingStudent} numberOfLines={1}>{person.now_serving?.student_names.join(', ')}</Text></View>)}</View> : <View style={styles.emptyNowServing}><Ionicons name="time-outline" size={compact ? 46 : 72} color="#BAE6FD" /><Text style={styles.emptyNowServingText}>No consultation is being served</Text></View>}
        </View>

        <View style={[styles.boardSection, styles.nextSection]}>
          <View style={styles.sectionHeading}><Ionicons name="list" size={compact ? 20 : 28} color="#0F172A" /><Text style={[styles.sectionTitleDark, compact && styles.sectionTitleCompact]}>NEXT IN LINE</Text><Text style={styles.waitingTotal}>{waiting.length} waiting</Text></View>
          {waiting.length ? <View style={[styles.waitingGrid, { gridTemplateColumns: `repeat(${waitingColumns}, minmax(0, 1fr))` } as any]}>{waiting.map((entry) => <View key={entry.id} style={styles.waitingCard}><Text style={styles.waitingQueue}>{entry.queueNumber}</Text><View style={styles.waitingInfo}><Text style={styles.waitingFaculty} numberOfLines={1}>{entry.facultyName}</Text><Text style={styles.waitingOffice} numberOfLines={1}>{entry.office}</Text></View></View>)}</View> : <View style={styles.emptyWaiting}><Ionicons name="checkmark-circle-outline" size={compact ? 36 : 54} color="#16A34A" /><Text style={styles.emptyWaitingText}>No one is currently waiting</Text></View>}
        </View>
      </View>

      <View style={styles.footer}><Text style={styles.footerText}>LIVE QUEUE BOARD · Updates automatically</Text><Text style={styles.footerText}>{faculty.length} faculty · {serving.length} being served</Text></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', overflow: 'hidden' }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 92, paddingHorizontal: 28, backgroundColor: '#0F172A', borderBottomWidth: 3, borderBottomColor: '#FDE047' }, headerCompact: { minHeight: 66, paddingHorizontal: 14 }, brand: { color: '#FFFFFF', fontSize: 29, fontWeight: '900' }, brandCompact: { fontSize: 20 }, subtitle: { color: '#CBD5E1', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, headerCenter: { flex: 1, alignItems: 'center' }, headerMessage: { color: '#FDE047', fontSize: 17, fontWeight: '800' }, headerMessageCompact: { fontSize: 12 },
  clock: { alignItems: 'flex-end' }, soundButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 3, borderRadius: 12, backgroundColor: '#64748B' }, soundButtonOn: { backgroundColor: '#16A34A' }, soundText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' }, time: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] }, timeCompact: { fontSize: 18 }, date: { color: '#CBD5E1', fontSize: 10 },
  board: { flex: 1, flexDirection: 'row', overflow: 'hidden' }, boardSection: { flex: 1, padding: 18, overflow: 'hidden' }, nowServingSection: { backgroundColor: '#075985', borderRightWidth: 4, borderRightColor: '#FDE047' }, nextSection: { backgroundColor: '#F8FAFC' }, sectionHeading: { flexDirection: 'row', alignItems: 'center', minHeight: 38, gap: 9, marginBottom: 10 }, sectionTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', letterSpacing: 1 }, sectionTitleDark: { color: '#0F172A', fontSize: 23, fontWeight: '900', letterSpacing: 1 }, sectionTitleCompact: { fontSize: 16 }, waitingTotal: { marginLeft: 'auto', color: '#0F172A', fontSize: 13, fontWeight: '800', backgroundColor: '#E2E8F0', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  servingGrid: { flex: 1, display: 'grid' as any, gap: 12 }, servingCard: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0C4A6E', borderRadius: 16, borderWidth: 2, borderColor: '#38BDF8', padding: 12, overflow: 'hidden' }, servingQueue: { color: '#FFFFFF', fontSize: 58, lineHeight: 66, fontWeight: '900' }, servingFaculty: { color: '#FDE047', fontSize: 17, fontWeight: '900', textAlign: 'center' }, servingOffice: { color: '#E0F2FE', fontSize: 12, marginTop: 3, textAlign: 'center' }, servingStudent: { color: '#BAE6FD', fontSize: 11, marginTop: 6, textAlign: 'center' }, emptyNowServing: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }, emptyNowServingText: { color: '#E0F2FE', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  waitingGrid: { flex: 1, display: 'grid' as any, gap: 12 }, waitingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1', padding: 12, gap: 12, overflow: 'hidden' }, waitingQueue: { color: '#075985', fontSize: 32, fontWeight: '900' }, waitingInfo: { flex: 1, minWidth: 0 }, waitingFaculty: { color: '#0F172A', fontSize: 14, fontWeight: '800' }, waitingOffice: { color: '#475569', fontSize: 11, marginTop: 3 }, emptyWaiting: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }, emptyWaitingText: { color: '#475569', fontSize: 18, fontWeight: '700' },
  footer: { minHeight: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, backgroundColor: '#0F172A', borderTopWidth: 1, borderTopColor: '#334155' }, footerText: { color: '#CBD5E1', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  announcementOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(15, 23, 42, 0.96)' }, announcementCard: { width: '86%', maxWidth: 700, alignItems: 'center', backgroundColor: '#FFFFFF', padding: 38, borderRadius: 24, borderWidth: 4, borderColor: '#38BDF8' }, announcementTitle: { marginTop: 12, color: '#075985', fontSize: 22, fontWeight: '900', letterSpacing: 0.8 }, announcementStudent: { marginTop: 18, color: '#0F172A', fontSize: 35, fontWeight: '900', textAlign: 'center' }, announcementInfo: { marginTop: 12, color: '#334155', fontSize: 22, fontWeight: '700' }, announcementHint: { marginTop: 22, color: '#64748B', fontSize: 13 },
});
