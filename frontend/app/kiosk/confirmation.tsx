import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function ConfirmationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    queue_number: string;
    faculty_name: string;
    faculty_office: string;
    topic: string;
  }>();

  // Auto-return to home after 15 seconds
  useEffect(() => {
    const t = setTimeout(() => {
      router.replace('/kiosk');
    }, 15000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Success Icon */}
        <View style={styles.successIconWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={64} color="#FFFFFF" />
          </View>
        </View>

        <Text style={styles.title}>Request Submitted!</Text>
        <Text style={styles.subtitle}>Your consultation has been queued</Text>

        {/* Queue Number */}
        <View style={styles.queueCard}>
          <Text style={styles.queueLabel}>YOUR QUEUE NUMBER</Text>
          <Text testID="queue-number" style={styles.queueNumber}>#{params.queue_number}</Text>
          <View style={styles.queueDivider} />
          <Text style={styles.facultyName}>{params.faculty_name}</Text>
          <View style={styles.officeRow}>
            <Ionicons name="location" size={16} color="#666" />
            <Text style={styles.officeText}>{params.faculty_office}</Text>
          </View>
        </View>

        {/* Instructions */}
        <View style={styles.instructions}>
          <View style={styles.instructionRow}>
            <View style={styles.instructionIcon}>
              <Ionicons name="tv" size={20} color="#2196F3" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.instructionTitle}>Check the TV Display</Text>
              <Text style={styles.instructionText}>Watch for your queue number outside the office</Text>
            </View>
          </View>

          <View style={styles.instructionRow}>
            <View style={styles.instructionIcon}>
              <Ionicons name="time" size={20} color="#2196F3" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.instructionTitle}>Wait Your Turn</Text>
              <Text style={styles.instructionText}>Faculty will call you when it&apos;s your turn</Text>
            </View>
          </View>

          <View style={styles.instructionRow}>
            <View style={styles.instructionIcon}>
              <Ionicons name="chatbubbles" size={20} color="#2196F3" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.instructionTitle}>Your Topic</Text>
              <Text style={styles.instructionText} numberOfLines={2}>{params.topic}</Text>
            </View>
          </View>
        </View>

        {/* Done Button */}
        <TouchableOpacity
          testID="done-btn"
          style={styles.doneBtn}
          onPress={() => router.replace('/kiosk')}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>

        <Text style={styles.autoReturnHint}>Returning to home in 15 seconds...</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { flex: 1, alignItems: 'center', padding: 24, justifyContent: 'center' },
  successIconWrap: { marginBottom: 20 },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1A1A1A' },
  subtitle: { fontSize: 15, color: '#666', marginTop: 6, marginBottom: 24 },
  queueCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  queueLabel: { fontSize: 12, letterSpacing: 2, color: '#666', fontWeight: '600' },
  queueNumber: { fontSize: 72, fontWeight: '800', color: '#2196F3', marginVertical: 8 },
  queueDivider: { width: '60%', height: 1, backgroundColor: '#E0E0E0', marginVertical: 12 },
  facultyName: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  officeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  officeText: { fontSize: 13, color: '#666' },
  instructions: { width: '100%', marginBottom: 24, gap: 12 },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 12,
  },
  instructionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  instructionText: { fontSize: 12, color: '#666', marginTop: 2 },
  doneBtn: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 12,
  },
  doneBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  autoReturnHint: { marginTop: 16, fontSize: 12, color: '#999' },
});
