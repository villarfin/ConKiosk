import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface Student {
  student_id: string;
  full_name: string;
  year_level: string;
  section: string;
}

export default function IdentifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    faculty_school_id: string;
    faculty_name: string;
    faculty_dept: string;
    faculty_office: string;
  }>();

  const [consultationType, setConsultationType] = useState<'individual' | 'group'>('individual');
  const [students, setStudents] = useState<Student[]>([]);
  const [currentStudent, setCurrentStudent] = useState<Student>({
    student_id: '',
    full_name: '',
    year_level: '',
    section: '',
  });
  const [scanInput, setScanInput] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const scanInputRef = useRef<TextInput>(null);

  // Keep QR scanner input focused (USB QR scanner acts like keyboard)
  useEffect(() => {
    const t = setTimeout(() => scanInputRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, []);

  const handleScannedId = async (id: string) => {
    if (!id.trim()) return;
    setLookingUp(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/kiosk/students/${id.trim()}`);
      if (response.ok) {
        const student: Student = await response.json();
        setCurrentStudent(student);
      } else {
        // Not found - just fill the ID and let user complete manually
        setCurrentStudent({ ...currentStudent, student_id: id.trim() });
        Alert.alert('Student Not Found', 'Please enter your information manually');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to lookup student');
    } finally {
      setLookingUp(false);
      setScanInput('');
      // Refocus for next scan
      setTimeout(() => scanInputRef.current?.focus(), 100);
    }
  };

  const handleScanSubmit = () => {
    handleScannedId(scanInput);
  };

  const addStudent = async () => {
    if (!currentStudent.student_id || !currentStudent.full_name || !currentStudent.year_level || !currentStudent.section) {
      Alert.alert('Missing Info', 'Please fill in all student details');
      return;
    }

    // Save student to backend
    try {
      await fetch(`${BACKEND_URL}/api/kiosk/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentStudent),
      });
    } catch (e) {
      // Non-critical - continue anyway
    }

    setStudents([...students, currentStudent]);
    setCurrentStudent({ student_id: '', full_name: '', year_level: '', section: '' });
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const removeStudent = (index: number) => {
    setStudents(students.filter((_, i) => i !== index));
  };

  const handleContinue = () => {
    let allStudents = [...students];

    // If current form is filled but not added yet, add it
    if (currentStudent.student_id && currentStudent.full_name) {
      if (currentStudent.year_level && currentStudent.section) {
        allStudents.push(currentStudent);
      }
    }

    if (allStudents.length === 0) {
      Alert.alert('No Students', 'Please add at least one student');
      return;
    }

    if (consultationType === 'individual' && allStudents.length > 1) {
      Alert.alert('Individual Consultation', 'Only one student allowed for individual consultation. Switch to Group?');
      return;
    }

    router.push({
      pathname: '/kiosk/request',
      params: {
        faculty_school_id: params.faculty_school_id,
        faculty_name: params.faculty_name,
        faculty_office: params.faculty_office,
        consultation_type: consultationType,
        students: JSON.stringify(allStudents),
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Student Identification</Text>
            <Text style={styles.headerSubtitle}>Consulting: {params.faculty_name}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Consultation Type Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Consultation Type</Text>
            <View style={styles.typeSelector}>
              <TouchableOpacity
                testID="type-individual"
                style={[styles.typeButton, consultationType === 'individual' && styles.typeButtonActive]}
                onPress={() => setConsultationType('individual')}
              >
                <Ionicons name="person" size={20} color={consultationType === 'individual' ? '#FFFFFF' : '#2196F3'} />
                <Text style={[styles.typeButtonText, consultationType === 'individual' && styles.typeButtonTextActive]}>Individual</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="type-group"
                style={[styles.typeButton, consultationType === 'group' && styles.typeButtonActive]}
                onPress={() => setConsultationType('group')}
              >
                <Ionicons name="people" size={20} color={consultationType === 'group' ? '#FFFFFF' : '#2196F3'} />
                <Text style={[styles.typeButtonText, consultationType === 'group' && styles.typeButtonTextActive]}>Group</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* QR Scanner Input (hidden but focused - USB scanner sends as keyboard) */}
          <View style={styles.section}>
            <View style={styles.scanCard}>
              <View style={styles.scanHeader}>
                <Ionicons name="qr-code" size={24} color="#2196F3" />
                <Text style={styles.scanTitle}>Scan Your ID or Enter Manually</Text>
              </View>
              <Text style={styles.scanHint}>
                Scan the QR code on your university ID, or fill in the fields below.
              </Text>
              <TextInput
                ref={scanInputRef}
                testID="qr-scan-input"
                style={styles.scanInput}
                placeholder="Scan QR here or type Student ID and press Enter"
                value={scanInput}
                onChangeText={setScanInput}
                onSubmitEditing={handleScanSubmit}
                autoFocus
                blurOnSubmit={false}
              />
              {lookingUp && (
                <View style={styles.lookupIndicator}>
                  <ActivityIndicator size="small" color="#2196F3" />
                  <Text style={styles.lookupText}>Looking up student...</Text>
                </View>
              )}
            </View>
          </View>

          {/* Manual Entry Form */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Student Information</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Student ID Number</Text>
              <TextInput
                testID="input-student-id"
                style={styles.input}
                placeholder="e.g., STU2024101"
                value={currentStudent.student_id}
                onChangeText={(v) => setCurrentStudent({ ...currentStudent, student_id: v })}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                testID="input-full-name"
                style={styles.input}
                placeholder="e.g., John Dela Cruz"
                value={currentStudent.full_name}
                onChangeText={(v) => setCurrentStudent({ ...currentStudent, full_name: v })}
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Year Level</Text>
                <TextInput
                  testID="input-year-level"
                  style={styles.input}
                  placeholder="e.g., 3rd Year"
                  value={currentStudent.year_level}
                  onChangeText={(v) => setCurrentStudent({ ...currentStudent, year_level: v })}
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Section</Text>
                <TextInput
                  testID="input-section"
                  style={styles.input}
                  placeholder="e.g., BSCS-3A"
                  value={currentStudent.section}
                  onChangeText={(v) => setCurrentStudent({ ...currentStudent, section: v })}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            {consultationType === 'group' && (
              <TouchableOpacity testID="add-student-btn" style={styles.addStudentBtn} onPress={addStudent}>
                <Ionicons name="add-circle" size={20} color="#2196F3" />
                <Text style={styles.addStudentText}>Add Another Student</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Added Students List (for group) */}
          {students.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Group Members ({students.length})</Text>
              {students.map((s, i) => (
                <View key={i} style={styles.studentChip}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chipName}>{s.full_name}</Text>
                    <Text style={styles.chipDetails}>{s.student_id} • {s.year_level} - {s.section}</Text>
                  </View>
                  <TouchableOpacity onPress={() => removeStudent(i)}>
                    <Ionicons name="close-circle" size={22} color="#F44336" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Continue Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            testID="continue-btn"
            style={styles.continueButton}
            onPress={handleContinue}
          >
            <Text style={styles.continueButtonText}>Continue</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
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
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A1A' },
  headerSubtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  content: { padding: 16 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#666', textTransform: 'uppercase', marginBottom: 12 },
  typeSelector: { flexDirection: 'row', gap: 8 },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#2196F3',
  },
  typeButtonActive: { backgroundColor: '#2196F3' },
  typeButtonText: { color: '#2196F3', fontWeight: '600', fontSize: 15 },
  typeButtonTextActive: { color: '#FFFFFF' },
  scanCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  scanHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  scanTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  scanHint: { fontSize: 12, color: '#666', marginBottom: 12 },
  scanInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  lookupIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  lookupText: { fontSize: 12, color: '#2196F3' },
  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '500', color: '#1A1A1A', marginBottom: 6 },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  row: { flexDirection: 'row', gap: 12 },
  addStudentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#2196F3',
    borderStyle: 'dashed',
    gap: 6,
    marginTop: 4,
  },
  addStudentText: { color: '#2196F3', fontWeight: '600', fontSize: 14 },
  studentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  chipName: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  chipDetails: { fontSize: 12, color: '#666', marginTop: 2 },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  continueButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
