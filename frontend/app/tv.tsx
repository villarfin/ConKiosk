import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeClient } from '@/src/utils/realtime';
import { apiUrl, photoUrl } from '@/src/config/api';

let announcementAudioContext: AudioContext | null = null;

interface NowServing { queue_number: string; student_names: string[]; topic: string; }
interface FacultyStatus {
  school_id: string; full_name: string; office_location: string; availability_status: string;
  profile_image?: string;
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
  const previousServing = useRef<Map<string, string> | null>(null);
  const loadingStatus = useRef(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [facultySpace, setFacultySpace] = useState({ width: 0, height: 0 });
  const { width, height } = useWindowDimensions();

  const load = useCallback(async () => {
    if (loadingStatus.current) return;
    loadingStatus.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(apiUrl('/tv-display/status'), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`TV status request failed: ${response.status}`);
      const result: FacultyStatus[] = await response.json();
      const current = new Map(result.filter(person => person.now_serving).map(person => [person.school_id, (person.now_serving as NowServing & { queue_id?: string }).queue_id || person.now_serving!.queue_number]));
      if (previousServing.current && [...current].some(([id, number]) => previousServing.current!.get(id) !== number)) {
        try { if (await enableSound()) { setSoundOn(true); playTone(); } } catch { setSoundOn(false); }
      }
      previousServing.current = current;
      setFaculty(result);
      setLastUpdated(Date.now());
      setConnectionFailed(false);
    } catch (error) {
      setConnectionFailed(true);
      console.error('Unable to load TV queue:', error);
    } finally {
      clearTimeout(timeout);
      loadingStatus.current = false;
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
    enableSound().then(setSoundOn).catch(() => setSoundOn(false));
    const timer = setInterval(() => setPage(value => value + 1), 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!announcement) return;
    playTone();
    const timeout = setTimeout(() => setAnnouncement(null), 10000);
    return () => clearTimeout(timeout);
  }, [announcement]);

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#FFFFFF" /></View>;

  const compact = width < 1000 || height < 700;
  // Measure the area beside the queue panel, then choose the grid that keeps
  // the existing card design largest while fitting every faculty at once.
  const count = Math.max(1, faculty.length);
  let facultyColumns = 1;
  let cardScale = 0;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const scale = Math.min(1, facultySpace.width / columns / 342, facultySpace.height / rows / 152);
    if (scale > cardScale) { cardScale = scale; facultyColumns = columns; }
  }
  const facultyRows = Math.ceil(count / facultyColumns);
  const slotWidth = facultySpace.width / facultyColumns;
  const slotHeight = facultySpace.height / facultyRows;
  const serving = faculty.filter((person) => person.now_serving);
  const queueFaculty = faculty.filter(person => person.now_serving || person.waiting_count > 0);
  const rowsPerPage = Math.max(1, Math.floor((height - (compact ? 210 : 240)) / 175));
  const pageCount = Math.max(1, Math.ceil(queueFaculty.length / rowsPerPage));
  const currentPage = page % pageCount;
  const visibleQueue = queueFaculty.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage);
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
        <View style={styles.facultyArea}>
          <View style={styles.facultySectionHeader}><View><Text style={styles.sectionEyebrow}>MEET YOUR INSTRUCTORS</Text><Text style={styles.sectionTitle}>Faculty availability</Text></View><View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View></View>
          <View style={[styles.facultyGrid, { flex: 1, minHeight: 0, gap: 0 }]} onLayout={({ nativeEvent: { layout } }) => setFacultySpace(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height })}>{faculty.map(person => {
            const color = person.availability_status === 'available' ? '#15803D' : person.availability_status === 'busy' ? '#B8860B' : '#B91C1C';
            return <View key={person.school_id} style={{ width: slotWidth, height: slotHeight, alignItems: 'center', justifyContent: 'center' }}><View style={[styles.facultyTile, { width: 330, height: 140, flexShrink: 0, borderLeftColor: color, transform: [{ scale: cardScale }] }]}>
              <View style={[styles.profileCircle, { borderColor: color }]}>{person.profile_image ? <Image source={{ uri: photoUrl(person.profile_image) }} accessibilityLabel={`${person.full_name} profile photo`} style={styles.profilePhoto} /> : <Ionicons name="person" size={26} color="#C8A348" />}</View>
              <View style={styles.facultyDetails}><Text style={styles.facultyCardName} numberOfLines={2}>{person.full_name}</Text><View style={styles.facultyOfficeRow}><Ionicons name="location-outline" size={12} color="#64748B" /><Text style={styles.facultyCardOffice} numberOfLines={1}>{person.office_location || 'Office not specified'}</Text></View><View style={styles.facultyStatusRow}><View style={[styles.availabilityDot, { backgroundColor: color }]} /><Text style={[styles.facultyStatusText, { color }]}>{person.availability_status.toUpperCase()}</Text></View></View>
            </View></View>;
          })}</View>
        </View>
        <View style={[styles.queueCard, { width: Math.min(520, width * 0.36) }]}>
          <Text style={styles.queueTitle}>CONSULTATION QUEUE</Text>
          <View style={styles.queueEntries}>{visibleQueue.map(person => <View key={person.school_id} style={styles.queueEntry}>
            <Text style={styles.queueInstructor} numberOfLines={2}>{person.full_name}</Text>
            <Text style={styles.waitingOffice} numberOfLines={1}>{person.office_location}</Text>
            <Text style={styles.queueNumberLabel}>NOW SERVING</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.largeQueueNumber}>{person.now_serving?.queue_number || '—'}</Text>
            <Text style={styles.nextQueueLine} numberOfLines={1}>NEXT: {person.next_queue_numbers.slice(0, 3).join(' · ') || '—'}</Text>
          </View>)}{!queueFaculty.length && <View style={styles.emptyWaiting}><Text style={styles.emptyWaitingText}>No one is currently waiting</Text></View>}</View>
          <Text style={styles.queueCardFooter}>{faculty.reduce((total, person) => total + person.waiting_count, 0)} waiting{pageCount > 1 ? ` · Page ${currentPage + 1} / ${pageCount} · Rotates every 8s` : ' · Please wait for your number'}</Text>
        </View>
      </View>

      <View style={styles.footer}><Text style={[styles.footerText, (connectionFailed || !lastUpdated || now.getTime() - lastUpdated > 10000) && { color: '#FDE047' }]}>{connectionFailed || !lastUpdated || now.getTime() - lastUpdated > 10000 ? 'SERVER UNREACHABLE · Displaying last received queue' : 'LIVE QUEUE BOARD · Updates automatically'}</Text><Text style={styles.footerText}>{faculty.length} faculty · {serving.length} being served</Text></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  facultySectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#34415A' },
  sectionEyebrow: { color: '#D6B45F', fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#536047', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#86C99A' },
  liveText: { color: '#C7D9CB', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  profileCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, backgroundColor: '#172747', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  profilePhoto: { width: '100%', height: '100%', resizeMode: 'cover' },
  facultyDetails: { flex: 1, minWidth: 0 },
  facultyCardName: { color: '#172747', fontSize: 17, fontWeight: '800' },
  facultyOfficeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  facultyCardOffice: { color: '#64748B', fontSize: 12, flexShrink: 1 },
  facultyStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9 },
  facultyStatusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  queueEntries: { flex: 1, minHeight: 0, gap: 12 },
  queueEntry: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E7DFC8', overflow: 'hidden' },
  queueInstructor: { color: '#0F172A', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  queueNumberLabel: { color: '#8A681F', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 8 },
  largeQueueNumber: { color: '#172747', fontSize: 72, lineHeight: 80, fontWeight: '900', textAlign: 'center', width: '100%', fontVariant: ['tabular-nums'] },
  nextQueueLine: { color: '#334155', fontSize: 16, fontWeight: '700', marginTop: 4 },
  facultyArea: { flex: 1, padding: 20, overflow: 'hidden' }, facultyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 }, facultyTile: { width: '47%', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 12, borderLeftWidth: 6, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, availabilityDot: { width: 7, height: 7, borderRadius: 4 },
  queueCard: { alignSelf: 'stretch', margin: 12, flexShrink: 0, backgroundColor: '#F4F1E9', borderRadius: 16, overflow: 'hidden', padding: 14, borderWidth: 2, borderColor: '#C8A348' }, queueTitle: { fontSize: 18, fontWeight: '900', color: '#172747', marginBottom: 10 }, queueTableHeading: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: '#CBD5E1', paddingBottom: 8 }, queueHeadingText: { fontSize: 9, fontWeight: '800', color: '#475569' }, queueTableRow: { height: 72, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }, tableQueueNumber: { color: '#172747', fontSize: 29, fontWeight: '900' }, tableNext: { color: '#475569', fontSize: 10, maxWidth: 155 }, queueCardFooter: { color: '#475569', fontSize: 10, paddingTop: 8 },
  container: { flex: 1, backgroundColor: '#101D35', overflow: 'hidden' }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#101D35' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 92, paddingHorizontal: 28, backgroundColor: '#101D35', borderBottomWidth: 3, borderBottomColor: '#C8A348' }, headerCompact: { minHeight: 66, paddingHorizontal: 14 }, brand: { color: '#FFFFFF', fontSize: 29, fontWeight: '900' }, brandCompact: { fontSize: 20 }, subtitle: { color: '#CBD5E1', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, headerCenter: { flex: 1, alignItems: 'center' }, headerMessage: { color: '#E0BD65', fontSize: 17, fontWeight: '800' }, headerMessageCompact: { fontSize: 12 },
  clock: { alignItems: 'flex-end' }, soundButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 3, borderRadius: 12, backgroundColor: '#64748B' }, soundButtonOn: { backgroundColor: '#16A34A' }, soundText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' }, time: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] }, timeCompact: { fontSize: 18 }, date: { color: '#CBD5E1', fontSize: 10 },
  board: { flex: 1, flexDirection: 'row', overflow: 'hidden' }, boardSection: { flex: 1, padding: 18, overflow: 'hidden' }, nowServingSection: { backgroundColor: '#075985', borderRightWidth: 4, borderRightColor: '#FDE047' }, nextSection: { backgroundColor: '#F4F1E9' }, sectionHeading: { flexDirection: 'row', alignItems: 'center', minHeight: 38, gap: 9, marginBottom: 10 }, sectionTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', letterSpacing: 1 }, sectionTitleDark: { color: '#0F172A', fontSize: 23, fontWeight: '900', letterSpacing: 1 }, sectionTitleCompact: { fontSize: 16 }, waitingTotal: { marginLeft: 'auto', color: '#0F172A', fontSize: 13, fontWeight: '800', backgroundColor: '#E2E8F0', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  servingGrid: { flex: 1, display: 'grid' as any, gap: 12 }, servingCard: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0C4A6E', borderRadius: 16, borderWidth: 2, borderColor: '#C8A348', padding: 12, overflow: 'hidden' }, servingQueue: { color: '#FFFFFF', fontSize: 58, lineHeight: 66, fontWeight: '900' }, servingFaculty: { color: '#E0BD65', fontSize: 17, fontWeight: '900', textAlign: 'center' }, servingOffice: { color: '#E0F2FE', fontSize: 12, marginTop: 3, textAlign: 'center' }, servingStudent: { color: '#BAE6FD', fontSize: 11, marginTop: 6, textAlign: 'center' }, emptyNowServing: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }, emptyNowServingText: { color: '#E0F2FE', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  waitingGrid: { flex: 1, display: 'grid' as any, gap: 12 }, waitingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1', padding: 12, gap: 12, overflow: 'hidden' }, waitingQueue: { color: '#172747', fontSize: 32, fontWeight: '900' }, waitingInfo: { flex: 1, minWidth: 0 }, waitingFaculty: { color: '#0F172A', fontSize: 14, fontWeight: '800' }, waitingOffice: { color: '#475569', fontSize: 11, marginTop: 3 }, emptyWaiting: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }, emptyWaitingText: { color: '#475569', fontSize: 18, fontWeight: '700' },
  footer: { minHeight: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, backgroundColor: '#101D35', borderTopWidth: 1, borderTopColor: '#334155' }, footerText: { color: '#CBD5E1', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  announcementOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(15, 23, 42, 0.96)' }, announcementCard: { width: '86%', maxWidth: 700, alignItems: 'center', backgroundColor: '#FFFFFF', padding: 38, borderRadius: 24, borderWidth: 4, borderColor: '#C8A348' }, announcementTitle: { marginTop: 12, color: '#172747', fontSize: 22, fontWeight: '900', letterSpacing: 0.8 }, announcementStudent: { marginTop: 18, color: '#0F172A', fontSize: 35, fontWeight: '900', textAlign: 'center' }, announcementInfo: { marginTop: 12, color: '#334155', fontSize: 22, fontWeight: '700' }, announcementHint: { marginTop: 22, color: '#64748B', fontSize: 13 },
});
