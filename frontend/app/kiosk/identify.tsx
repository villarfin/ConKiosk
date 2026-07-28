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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// USTP–CDO programs recognized from QR content. The text shown to the student
// is the standardized value on the right; the values on the left are QR forms.
const QR_PROGRAMS: Array<[string, string]> = [
  ['SHS STEM', 'SHS STEM'], ['STEM', 'SHS STEM'],
  ['BS INFORMATION TECHNOLOGY', 'BS Information Technology'], ['BSIT', 'BS Information Technology'],
  ['BS COMPUTER SCIENCE', 'BS Computer Science'], ['BSCS', 'BS Computer Science'],
  ['BS DATA SCIENCE', 'BS Data Science'],
  ['BS COMPUTER ENGINEERING', 'BS Computer Engineering'], ['BSCPE', 'BS Computer Engineering'],
  ['BS CIVIL ENGINEERING', 'BS Civil Engineering'], ['BSCE', 'BS Civil Engineering'],
  ['BS ELECTRICAL ENGINEERING', 'BS Electrical Engineering'], ['BSEE', 'BS Electrical Engineering'],
  ['BS ELECTRONICS ENGINEERING', 'BS Electronics Engineering'], ['BSECE', 'BS Electronics Engineering'],
  ['BS MECHANICAL ENGINEERING', 'BS Mechanical Engineering'], ['BSME', 'BS Mechanical Engineering'],
  ['BS ARCHITECTURE', 'BS Architecture'], ['BS APPLIED MATHEMATICS', 'BS Applied Mathematics'],
  ['BS APPLIED PHYSICS', 'BS Applied Physics'], ['BS CHEMISTRY', 'BS Chemistry'],
  ['BS ENVIRONMENTAL SCIENCE', 'BS Environmental Science'], ['BS FOOD TECHNOLOGY', 'BS Food Technology'],
  ['BS GEODETIC ENGINEERING', 'BS Geodetic Engineering'],
  ['BS TECHNOLOGY COMMUNICATION MANAGEMENT', 'BS Technology Communication Management'],
  ['BS AUTOTRONICS', 'BS Autotronics'], ['BS ELECTRONICS TECHNOLOGY', 'BS Electronics Technology'],
  ['BS ENERGY SYSTEMS AND MANAGEMENT', 'BS Energy Systems and Management'],
  ['BS ELECTRO-MECHANICAL TECHNOLOGY', 'BS Electro-Mechanical Technology'],
  ['BS MANUFACTURING ENGINEERING TECHNOLOGY', 'BS Manufacturing Engineering Technology'],
  ['BSED SCIENCE', 'BSEd Science'], ['BSED MATHEMATICS', 'BSEd Mathematics'],
  ['BTLE', 'BTLE'], ['BTVTE', 'BTVTE'],
];
const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'];

const detectProgram = (qrContent: string) => {
  const normalizedContent = qrContent.toUpperCase();
  return QR_PROGRAMS.find(([qrValue]) => normalizedContent.includes(qrValue))?.[1] || '';
};

interface Student {
  student_id: string;
  full_name: string;
  program: string;
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
    program: '',
    year_level: '',
    section: '',
  });
  const [scanInput, setScanInput] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const scanInputRef = useRef<TextInput>(null);
  const scanBufferRef = useRef('');
  const isScanInputFocusedRef = useRef(false);
  const hasMissingRequiredInfo = !currentStudent.student_id.trim()
    || !currentStudent.full_name.trim()
    || !currentStudent.program.trim()
    || !currentStudent.year_level.trim()
    || !currentStudent.section.trim();

  // Keep QR scanner input focused (USB QR scanner acts like keyboard)
  useEffect(() => {
    const t = setTimeout(() => scanInputRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, []);

  const handleScannedId = async (scanValue: string) => {
    const normalizedScan = scanValue.replace(/\s+/g, ' ').trim();
    if (!normalizedScan) return;

    // School ID QR codes can contain several values, e.g.
    // "STUDENT NAME STU2024101 BSIT" or "STUDENT NAME 2021304481 BSIT".
    // Support both the school's STU-prefixed IDs and numeric IDs.
    const idMatch = normalizedScan.match(/\b(?:(?:STU)[- ]?|[A-Za-z]{2,5}(?=\d))?\d{7,12}\b/i);
    const studentId = idMatch?.[0] || normalizedScan;
    const scannedName = idMatch
      ? normalizedScan.slice(0, idMatch.index).trim()
      : '';
    const scannedProgram = detectProgram(normalizedScan);

    setLookingUp(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/kiosk/students/${studentId}`);
      if (response.ok) {
        const student: Student = await response.json();
        // Scanning only verifies identity. These are required for the current request.
        setCurrentStudent({
          ...student,
          // Supports existing student records created before Program was added.
          program: student.program || scannedProgram || student.section?.split('-')[0] || '',
          year_level: '',
          section: '',
        });
      } else {
        // Not found - retain every useful value from a school-ID QR and let
        // the student complete any remaining required fields manually.
        setCurrentStudent({
          student_id: studentId,
          full_name: scannedName,
          program: scannedProgram,
          year_level: '',
          section: '',
        });
        Alert.alert(
          'Student Not Found',
          'Your ID and available QR details were filled in. Please complete the remaining information manually.'
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to lookup student');
    } finally {
      setLookingUp(false);
      setScanInput('');
      scanBufferRef.current = '';
      // Refocus for next scan
      setTimeout(() => scanInputRef.current?.focus(), 100);
    }
  };

  const handleScanSubmit = () => {
    handleScannedId(scanInput);
  };

  // USB QR scanners behave as keyboards. Some school IDs contain Tab
  // separators; on the web, those would normally move focus through the form.
  // Capture the full stream while the QR field is focused, then process it
  // when the scanner sends Enter.
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleScannerKey = (event: KeyboardEvent) => {
      if (!isScanInputFocusedRef.current || event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        const value = scanBufferRef.current;
        if (value.trim()) handleScannedId(value);
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        scanBufferRef.current += ' ';
        setScanInput(scanBufferRef.current);
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        scanBufferRef.current = scanBufferRef.current.slice(0, -1);
        setScanInput(scanBufferRef.current);
        return;
      }

      if (event.key.length === 1) {
        event.preventDefault();
        scanBufferRef.current += event.key;
        setScanInput(scanBufferRef.current);
      }
    };

    window.addEventListener('keydown', handleScannerKey, true);
    return () => window.removeEventListener('keydown', handleScannerKey, true);
  });

  const addStudent = async () => {
    if (!currentStudent.student_id || !currentStudent.full_name || !currentStudent.program || !currentStudent.year_level || !currentStudent.section) {
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
    } catch {
      // Non-critical - continue anyway
    }

    setStudents([...students, currentStudent]);
    setCurrentStudent({ student_id: '', full_name: '', program: '', year_level: '', section: '' });
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const removeStudent = (index: number) => {
    setStudents(students.filter((_, i) => i !== index));
  };

  const handleContinue = () => {
    let allStudents = [...students];

    const hasCurrentStudentData = Object.values(currentStudent).some((value) => value.trim());
    const currentStudentComplete = Object.values(currentStudent).every((value) => value.trim());

    if (hasCurrentStudentData && !currentStudentComplete) {
      Alert.alert('Missing Info', 'Please fill in Program, Year Level, and Section before continuing.');
      return;
    }

    // If current form is complete but not added yet, add it.
    if (currentStudentComplete) {
      allStudents.push(currentStudent);
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
                Scan your university ID QR code, or fill in the fields below.
              </Text>
              <TextInput
                ref={scanInputRef}
                testID="qr-scan-input"
                style={styles.scanInput}
                placeholder="Scan student QR or type Student ID and press Enter"
                value={scanInput}
                onChangeText={(value) => {
                  scanBufferRef.current = value;
                  setScanInput(value);
                }}
                onSubmitEditing={handleScanSubmit}
                onFocus={() => {
                  isScanInputFocusedRef.current = true;
                  scanBufferRef.current = scanInput;
                }}
                onBlur={() => { isScanInputFocusedRef.current = false; }}
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
                style={[styles.input, !currentStudent.student_id.trim() && styles.inputError]}
                placeholder="e.g., STU2024101"
                value={currentStudent.student_id}
                onChangeText={(v) => setCurrentStudent({ ...currentStudent, student_id: v })}
                autoCapitalize="characters"
              />
              {!currentStudent.student_id.trim() && <Text style={styles.fieldRequiredText}>Student ID Number is required.</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                testID="input-full-name"
                style={[styles.input, !currentStudent.full_name.trim() && styles.inputError]}
                placeholder="e.g., John Dela Cruz"
                value={currentStudent.full_name}
                onChangeText={(v) => setCurrentStudent({ ...currentStudent, full_name: v })}
              />
              {!currentStudent.full_name.trim() && <Text style={styles.fieldRequiredText}>Full Name is required.</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Program</Text>
              <TextInput
                testID="input-program"
                style={[styles.input, !currentStudent.program.trim() && styles.inputError]}
                placeholder="e.g., BSCS"
                value={currentStudent.program}
                onChangeText={(v) => setCurrentStudent({ ...currentStudent, program: v })}
                autoCapitalize="characters"
              />
              {!currentStudent.program.trim() && <Text style={styles.fieldRequiredText}>Program is required.</Text>}
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Year Level</Text>
                <TouchableOpacity
                  testID="input-year-level"
                  style={[styles.input, styles.selectInput, !currentStudent.year_level.trim() && styles.inputError]}
                  onPress={() => setYearPickerVisible(true)}
                >
                  <Text style={currentStudent.year_level ? styles.selectValue : styles.selectPlaceholder}>
                    {currentStudent.year_level || 'Select year'}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color="#666" />
                </TouchableOpacity>
                {!currentStudent.year_level.trim() && <Text style={styles.fieldRequiredText}>Year Level is required.</Text>}
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Section</Text>
                <TextInput
                  testID="input-section"
                  style={[styles.input, !currentStudent.section.trim() && styles.inputError]}
                  placeholder="e.g., BSCS-3A"
                  value={currentStudent.section}
                  onChangeText={(v) => setCurrentStudent({ ...currentStudent, section: v })}
                  autoCapitalize="characters"
                />
                {!currentStudent.section.trim() && <Text style={styles.fieldRequiredText}>Section is required.</Text>}
              </View>
            </View>

            {hasMissingRequiredInfo && (
              <View style={styles.requiredWarning}>
                <Ionicons name="alert-circle-outline" size={16} color="#C62828" />
                <Text style={styles.requiredWarningText}>
                  Complete all fields before continuing. Year Level and Section are required after scanning.
                </Text>
              </View>
            )}

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
                    <Text style={styles.chipDetails}>{s.student_id} • {s.program} • {s.year_level} - {s.section}</Text>
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

      <Modal transparent visible={yearPickerVisible} animationType="fade" onRequestClose={() => setYearPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.yearPickerModal}>
            <Text style={styles.yearPickerTitle}>Select Year Level</Text>
            {YEAR_LEVELS.map((year) => (
              <TouchableOpacity
                key={year}
                style={[styles.yearOption, currentStudent.year_level === year && styles.yearOptionSelected]}
                onPress={() => {
                  setCurrentStudent({ ...currentStudent, year_level: year });
                  setYearPickerVisible(false);
                }}
              >
                <Text style={[styles.yearOptionText, currentStudent.year_level === year && styles.yearOptionTextSelected]}>{year}</Text>
                {currentStudent.year_level === year && <Ionicons name="checkmark" size={20} color="#2196F3" />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.yearPickerCancel} onPress={() => setYearPickerVisible(false)}>
              <Text style={styles.yearPickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  inputError: { borderColor: '#C62828', borderWidth: 1.5 },
  selectInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  selectValue: { color: '#1A1A1A', fontSize: 14 },
  selectPlaceholder: { color: '#999', fontSize: 14 },
  fieldRequiredText: { color: '#C62828', fontSize: 11, marginTop: 4 },
  requiredWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFEBEE', borderRadius: 8, padding: 10, marginTop: -2, marginBottom: 12,
  },
  requiredWarningText: { flex: 1, color: '#C62828', fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', gap: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  yearPickerModal: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16 },
  yearPickerTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  yearOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 10, borderRadius: 8 },
  yearOptionSelected: { backgroundColor: '#E3F2FD' },
  yearOptionText: { color: '#1A1A1A', fontSize: 16 },
  yearOptionTextSelected: { color: '#2196F3', fontWeight: '700' },
  yearPickerCancel: { alignItems: 'center', paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: '#E0E0E0' },
  yearPickerCancelText: { color: '#666', fontWeight: '600', fontSize: 15 },
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
