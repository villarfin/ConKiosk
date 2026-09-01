import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { RealtimeClient } from '@/src/utils/realtime';
import { apiUrl } from '@/src/config/api';

interface Faculty {
  school_id: string;
  full_name: string;
  department: string;
  office_location: string;
  availability_status: string;
  accepting_consultations: boolean;
  office_hours?: string;
  profile_image?: string;
}

export default function KioskHome() {
  const router = useRouter();
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFaculty = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/kiosk/faculty'));
      const data = await response.json();
      setFaculty(data);
    } catch (e) {
      console.error('Error loading faculty:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFaculty();
  }, [loadFaculty]);

  // Real-time updates via the native WebSocket endpoint.
  useEffect(() => {
    const realtime = new RealtimeClient();
    realtime.connect();
    const unsubscribe = realtime.subscribe(({ type }) => {
      if (type === 'availability_changed' || type === 'queue_updated') loadFaculty();
    });
    return () => { unsubscribe(); realtime.disconnect(); };
  }, [loadFaculty]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFaculty();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return '#4CAF50';
      case 'busy': return '#FF9800';
      case 'unavailable': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  const getConsultationLabel = (person: Faculty) => {
    if (person.availability_status === 'busy') {
      return person.accepting_consultations ? 'Busy — still accepting consultations' : 'Busy — not accepting consultations';
    }
    return person.availability_status === 'available' ? 'Available — accepting consultations' : 'Unavailable';
  };

  const canRequest = (person: Faculty) => person.availability_status === 'available' || (person.availability_status === 'busy' && person.accepting_consultations);

  const handleSelectFaculty = (f: Faculty) => {
    if (!canRequest(f)) return;
    router.push({
      pathname: '/kiosk/identify',
      params: {
        faculty_school_id: f.school_id,
        faculty_name: f.full_name,
        faculty_dept: f.department,
        faculty_office: f.office_location,
      },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>ConKiosk</Text>
          <Text style={styles.subtitle}>Faculty Consultation System</Text>
        </View>
      </View>

      <View style={styles.subHeader}>
        <Text style={styles.subHeaderTitle}>Select a Faculty Member</Text>
        <Text style={styles.subHeaderText}>Choose a faculty member marked as accepting consultations</Text>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#4CAF50' }]} />
          <Text style={styles.legendText}>Available — accepting</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#FF9800' }]} />
          <Text style={styles.legendText}>Busy — may still accept</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#F44336' }]} />
          <Text style={styles.legendText}>Unavailable</Text>
        </View>
      </View>

      {/* Faculty Grid */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.grid}>
          {faculty.map((f) => (
            <TouchableOpacity
              key={f.school_id}
              testID={`faculty-card-${f.school_id}`}
              style={[
                styles.card,
                !canRequest(f) && styles.cardDisabled,
              ]}
              onPress={() => handleSelectFaculty(f)}
              disabled={!canRequest(f)}
              activeOpacity={0.85}
            >
              <View style={styles.cardHeader}>
                <View style={styles.avatarContainer}>
                  {f.profile_image ? (
                    <Image source={{ uri: f.profile_image }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>
                        {f.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.statusDot, { backgroundColor: getStatusColor(f.availability_status) }]} />
                </View>
              </View>

              <Text style={styles.cardName} numberOfLines={1}>{f.full_name}</Text>
              <Text style={styles.cardDept} numberOfLines={1}>{f.department}</Text>

              <View style={styles.cardOffice}>
                <Ionicons name="location-outline" size={12} color="#666" />
                <Text style={styles.cardOfficeText} numberOfLines={1}>{f.office_location}</Text>
              </View>

              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(f.availability_status) }]}>
                <Text style={styles.statusBadgeText}>{getConsultationLabel(f)}</Text>
              </View>

              {canRequest(f) && (
                <View style={styles.selectHint}>
                  <Text style={styles.selectHintText}>{f.availability_status === 'busy' ? 'Tap to request a consultation' : 'Tap to consult'}</Text>
                  <Ionicons name="arrow-forward" size={14} color="#2196F3" />
                </View>
              )}
              {f.availability_status === 'busy' && !f.accepting_consultations && <Text style={styles.unavailableHint}>This faculty member is currently busy.</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1A1A1A' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 2 },
  subHeader: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  subHeaderTitle: { fontSize: 22, fontWeight: '700', color: '#1A1A1A' },
  subHeaderText: { fontSize: 14, color: '#666', marginTop: 4 },
  legend: {
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: 24,
    paddingBottom: 16,
    flexWrap: 'wrap',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: '#666' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-start' },
  card: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    minHeight: 200,
  },
  cardDisabled: { opacity: 0.55 },
  cardHeader: { alignItems: 'center', marginBottom: 12 },
  avatarContainer: { position: 'relative' },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  cardName: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', textAlign: 'center' },
  cardDept: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 2 },
  cardOffice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    justifyContent: 'center',
  },
  cardOfficeText: { fontSize: 11, color: '#666', flex: 1, textAlign: 'center' },
  statusBadge: {
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'center',
  },
  statusBadgeText: { fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  selectHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
  },
  selectHintText: { color: '#2196F3', fontSize: 12, fontWeight: '500' },
  unavailableHint: { color: '#8A4B00', fontSize: 11, textAlign: 'center', marginTop: 10 },
});
