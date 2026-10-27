import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiUrl } from '@/src/config/api';
import { getKioskDraft, clearKioskDraft } from '@/src/utils/kiosk-draft';
import { useLocalSearchParams, useRouter } from 'expo-router';


interface Student {
  student_id: string;
  full_name: string;
  program: string;
  year_level: string;
  section: string;
}

const COMMON_TOPICS = ['Grades', 'Capstone', 'PIT', 'Activity', 'Subject'];

export default function RequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    faculty_school_id: string;
    faculty_name: string;
    faculty_office: string;
    consultation_type: string;
    students: string;
  }>();

  const { students, submissionId } = getKioskDraft();
  const [topic, setTopic] = useState('');
  const [customTopic, setCustomTopic] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!students.length) { Alert.alert('Student details needed', 'Please return to the kiosk and identify the student again.'); return; }
    if (!topic.trim()) {
      Alert.alert('Missing Topic', 'Please describe your consultation topic');
      return;
    }
    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(apiUrl('/kiosk/consultation-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          faculty_school_id: params.faculty_school_id,
          topic: topic.trim(),
          consultation_type: params.consultation_type,
          students: students,
          submission_id: submissionId,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to submit request');
      }

      const data = await response.json();
      clearKioskDraft();

      router.replace({
        pathname: '/kiosk/confirmation',
        params: {
          queue_number: String(data.queue_number),
          faculty_name: data.faculty_name,
          faculty_office: data.faculty_office,
          topic: topic.trim(),
        },
      });
    } catch (e: any) {
      const message = e?.name === 'AbortError'
        ? 'The server did not respond. Please check that the ConKiosk server is running, then try again.'
        : (e.message || 'Failed to submit consultation request');
      Alert.alert('Unable to Submit', message);
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Consultation Request</Text>
            <Text style={styles.headerSubtitle}>{params.faculty_name}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Faculty Info */}
          <View style={styles.facultyCard}>
            <View style={styles.facultyIcon}>
              <Ionicons name="school" size={28} color="#2196F3" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.facultyName}>{params.faculty_name}</Text>
              <View style={styles.facultyMeta}>
                <Ionicons name="location-outline" size={14} color="#666" />
                <Text style={styles.facultyMetaText}>{params.faculty_office}</Text>
              </View>
            </View>
          </View>

          {/* Students Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {params.consultation_type === 'group' ? `Group (${students.length} members)` : 'Student'}
            </Text>
            {students.map((s, i) => (
              <View key={i} style={styles.studentRow}>
                <View style={styles.studentAvatar}>
                  <Text style={styles.studentAvatarText}>{s.full_name.charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{s.full_name}</Text>
                  <Text style={styles.studentMeta}>{s.student_id} • {s.program} • {s.year_level} - {s.section}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Topic */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Consultation Topic</Text>
            <Text style={styles.hint}>Choose the topic that best describes your consultation.</Text>
            <View style={styles.topicOptions}>
              {COMMON_TOPICS.map((option) => <TouchableOpacity key={option} testID={`topic-${option.toLowerCase()}`} style={[styles.topicOption, !customTopic && topic === option && styles.topicOptionSelected]} onPress={() => { setTopic(option); setCustomTopic(false); }}><Text style={[styles.topicOptionText, !customTopic && topic === option && styles.topicOptionTextSelected]}>{option}</Text></TouchableOpacity>)}
              <TouchableOpacity testID="topic-other" style={[styles.topicOption, customTopic && styles.topicOptionSelected]} onPress={() => { setTopic(''); setCustomTopic(true); }}><Ionicons name="create-outline" size={16} color={customTopic ? '#FFFFFF' : '#1D4ED8'} /><Text style={[styles.topicOptionText, customTopic && styles.topicOptionTextSelected]}>Other</Text></TouchableOpacity>
            </View>
            {customTopic && <TextInput
              testID="input-topic"
              style={[styles.topicInput, !topic.trim() && styles.topicInputError]}
              placeholder="Type your consultation topic"
              value={topic}
              onChangeText={setTopic}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={300}
              autoFocus
            />}
            {!topic.trim() && <Text style={styles.fieldRequiredText}>Consultation Topic is required.</Text>}
            {customTopic && <Text style={styles.charCount}>{topic.length}/300</Text>}
          </View>
        </ScrollView>

        {/* Submit Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            testID="submit-request-btn"
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
                <Text style={styles.submitBtnText}>Submit Request</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    gap: 12,
  },
  backButton: { padding: 8 },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#1A1A1A' },
  headerSubtitle: { fontSize: 15, color: '#666', marginTop: 2 },
  content: { padding: 16 },
  facultyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  facultyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  facultyName: { fontSize: 19, fontWeight: '700', color: '#1A1A1A' },
  facultyMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  facultyMetaText: { fontSize: 14, color: '#666' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#666', textTransform: 'uppercase', marginBottom: 12 },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
    gap: 12,
  },
  studentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  studentAvatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  studentName: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  studentMeta: { fontSize: 12, color: '#666', marginTop: 2 },
  hint: { fontSize: 12, color: '#666', marginBottom: 8 },
  topicOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topicOption: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  topicOptionSelected: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  topicOptionText: { color: '#1D4ED8', fontSize: 14, fontWeight: '700' },
  topicOptionTextSelected: { color: '#FFFFFF' },
  topicInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginTop: 12,
  },
  topicInputError: { borderColor: '#C62828', borderWidth: 1.5 },
  fieldRequiredText: { color: '#C62828', fontSize: 11, marginTop: 4 },
  charCount: { textAlign: 'right', color: '#999', fontSize: 11, marginTop: 4 },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitBtnDisabled: { backgroundColor: '#90CAF9' },
  submitBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
});
