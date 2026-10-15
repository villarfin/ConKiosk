import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ApiClient } from '@/src/utils/api';
import { useFocusEffect } from 'expo-router';
import { ActionDialog } from '@/src/components/ActionDialog';
import { Pagination } from '@/src/components/Pagination';
import { consultationStatusLabel } from '@/src/utils/consultation-status';

interface Consultation {
  _id: string;
  student_id: string;
  student_name: string;
  student_program: string;
  topic: string;
  date: string;
  time: string;
  duration?: number;
  status: string;
  notes?: string;
  queue_id?: string;
  remarks?: string;
  students?: { student_id: string; full_name: string }[];
}

const STATUS_FILTERS = ['all', 'scheduled', 'ongoing', 'completed', 'cancelled'];

export default function HistoryScreen() {
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingAction, setPendingAction] = useState<'complete' | 'pause' | 'cancel' | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  useEffect(() => { setPage(0); }, [statusFilter, searchQuery]);

  useFocusEffect(useCallback(() => {
    loadHistory();
    const timer = setInterval(loadHistory, 5000);
    return () => clearInterval(timer);
  }, [statusFilter, searchQuery, page, selectedConsultation?._id]));

  const loadHistory = async () => {
    try {
      let endpoint = '/consultations';
      const params = [];

      if (statusFilter !== 'all') {
        params.push(`status=${statusFilter}`);
      }

      if (searchQuery) {
        params.push(`search=${encodeURIComponent(searchQuery)}`);
      }

      if (params.length > 0) {
        endpoint += '?' + params.join('&');
      }

      endpoint += `${endpoint.includes('?') ? '&' : '?'}limit=100&offset=${page * 100}`;
      const data = await ApiClient.get(endpoint);
      setConsultations(data);
      if (selectedConsultation) {
        const latest = await ApiClient.get(`/consultations/${selectedConsultation._id}`);
        setSelectedConsultation(previous => previous?._id === latest._id ? latest : previous);
        if (['completed', 'cancelled'].includes(latest.status)) setEditNotes(latest.notes || '');
      }
    } catch (error: any) {
      console.error('Error loading history:', error);
      Alert.alert('Error', 'Failed to load consultation history');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  }, [statusFilter, searchQuery, page, selectedConsultation?._id]);

  const handleSearch = () => {
    loadHistory();
  };

  const openDetails = (consultation: Consultation) => {
    setSelectedConsultation(consultation);
    setEditNotes(consultation.notes || '');
    setDetailsModalVisible(true);
  };

  const closeDetails = () => {
    setDetailsModalVisible(false);
    setSelectedConsultation(null);
    setEditNotes('');
  };

  const saveConsultationDetails = async () => {
    if (!selectedConsultation) return;

    setSaving(true);
    try {
      await ApiClient.patch(`/consultations/${selectedConsultation._id}`, {
        notes: editNotes,
      });

      Alert.alert('Success', 'Consultation updated successfully');
      closeDetails();
      loadHistory();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update consultation');
    } finally {
      setSaving(false);
    }
  };

  const startConsultation = async () => {
    if (!selectedConsultation) return;
    setSaving(true);
    try {
      await ApiClient.post(`/consultations/${selectedConsultation._id}/start`);
      Alert.alert('Success', 'Consultation started. Status set to Busy.');
      closeDetails();
      loadHistory();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to start consultation');
    } finally {
      setSaving(false);
    }
  };

  const completeConsultation = async () => {
    if (!selectedConsultation) return;
    setSaving(true);
    try {
      if (pendingAction === 'cancel') {
        await ApiClient.post(`/consultations/${selectedConsultation._id}/cancel`, { reason: cancelReason });
        setPendingAction(null); closeDetails(); loadHistory(); return;
      }
      const result = await ApiClient.post(`/consultations/${selectedConsultation._id}/complete`, { notes: editNotes, advance: pendingAction !== 'pause' });
      setPendingAction(null);
      Alert.alert('Success', result.next_started ? 'Notes saved. Consultation completed and the next student has been called.' : 'Notes saved. Consultation completed.');
      closeDetails();
      loadHistory();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to complete consultation');
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return '#2196F3';
      case 'ongoing':
        return '#FF9800';
      case 'completed':
        return '#4CAF50';
      case 'cancelled':
        return '#F44336';
      default:
        return '#9E9E9E';
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Consultation History</Text>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#666666" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, ID, or topic..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); loadHistory(); }}>
              <Ionicons name="close-circle" size={20} color="#666666" />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContainer}
        >
          {STATUS_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterChip,
                statusFilter === filter && styles.filterChipActive,
              ]}
              onPress={() => setStatusFilter(filter)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === filter && styles.filterChipTextActive,
                ]}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Consultations List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2196F3']} />
        }
      >
        {consultations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={64} color="#BDBDBD" />
            <Text style={styles.emptyTitle}>No Consultations Yet</Text>
            <Text style={styles.emptyText}>
              Your consultation history will appear here
            </Text>
          </View>
        ) : (
          consultations.map((consultation) => (
            <TouchableOpacity
              key={consultation._id}
              style={styles.consultationCard}
              onPress={() => openDetails(consultation)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Text style={styles.studentName}>{consultation.student_name}</Text>
                  <Text style={styles.studentId}>{consultation.student_id}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(consultation.status) }]}>
                  <Text style={styles.statusText}>{consultationStatusLabel(consultation)}</Text>
                </View>
              </View>

              <Text style={styles.topicText}>{consultation.topic}</Text>

              <View style={styles.cardFooter}>
                <View style={styles.footerItem}>
                  <Ionicons name="calendar-outline" size={14} color="#666666" />
                  <Text style={styles.footerText}>{consultation.date}</Text>
                </View>
                <View style={styles.footerItem}>
                  <Ionicons name="time-outline" size={14} color="#666666" />
                  <Text style={styles.footerText}>{consultation.time}</Text>
                </View>
                {consultation.duration && (
                  <View style={styles.footerItem}>
                    <Ionicons name="hourglass-outline" size={14} color="#666666" />
                    <Text style={styles.footerText}>{consultation.duration} min</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Pagination page={page} count={consultations.length} onChange={setPage} />
      {/* Details Modal */}
      <Modal
        visible={detailsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeDetails}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Consultation Details</Text>
              <TouchableOpacity onPress={closeDetails}>
                <Ionicons name="close" size={24} color="#666666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {selectedConsultation && (
                <>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Student</Text>
                    <Text style={styles.detailValue}>{selectedConsultation.students?.length ? selectedConsultation.students.map(student => student.full_name).join(', ') : selectedConsultation.student_name}</Text>
                    <Text style={styles.detailSubValue}>
                      {selectedConsultation.student_id} • {selectedConsultation.student_program}
                    </Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Topic</Text>
                    <Text style={styles.detailValue}>{selectedConsultation.topic}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailSectionHalf}>
                      <Text style={styles.detailLabel}>Date</Text>
                      <Text style={styles.detailValue}>{selectedConsultation.date}</Text>
                    </View>
                    <View style={styles.detailSectionHalf}>
                      <Text style={styles.detailLabel}>Time</Text>
                      <Text style={styles.detailValue}>{selectedConsultation.time}</Text>
                    </View>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <View style={[styles.statusReadOnly, { backgroundColor: getStatusColor(selectedConsultation.status) }]}><Text style={styles.statusText}>{consultationStatusLabel(selectedConsultation)}</Text></View>
                    {selectedConsultation.status === 'scheduled' && selectedConsultation.queue_id && <Text style={styles.detailSubValue}>Waiting in queue order. An earlier student may still need approval or completion.</Text>}
                    {selectedConsultation.remarks && <Text style={styles.detailSubValue}>{selectedConsultation.remarks}</Text>}
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Notes</Text>
                    <TextInput
                      style={[styles.textArea, ['completed', 'cancelled'].includes(selectedConsultation.status) && styles.textAreaLocked]}
                      placeholder={['completed', 'cancelled'].includes(selectedConsultation.status) ? 'This consultation is locked.' : 'Add consultation notes...'}
                      value={editNotes}
                      onChangeText={setEditNotes}
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                      editable={!['completed', 'cancelled'].includes(selectedConsultation.status)}
                    />
                  </View>

                  {selectedConsultation.status === 'scheduled' && (
                    <TouchableOpacity
                      testID="start-consultation-btn"
                      style={[styles.completeButton, { backgroundColor: '#FFF3E0' }]}
                      onPress={startConsultation}
                      disabled={saving}
                    >
                      <Ionicons name="play-circle" size={20} color="#FF9800" />
                      <Text style={[styles.completeButtonText, { color: '#FF9800' }]}>Start Consultation (Auto-set Busy)</Text>
                    </TouchableOpacity>
                  )}

                  {selectedConsultation.status === 'ongoing' && (
                    <TouchableOpacity
                      testID="complete-consultation-btn"
                      style={styles.completeButton}
                      onPress={() => setPendingAction('complete')}
                      disabled={saving}
                    >
                      <Ionicons name="checkmark-done" size={20} color="#4CAF50" />
                      <Text style={styles.completeButtonText}>Complete & Advance Queue</Text>
                    </TouchableOpacity>
                  )}

                  {selectedConsultation.status === 'ongoing' && <TouchableOpacity style={styles.completeButton} disabled={saving} onPress={() => setPendingAction('pause')}><Text style={styles.completeButtonText}>Complete & Pause Queue</Text></TouchableOpacity>}
                  {['scheduled', 'ongoing'].includes(selectedConsultation.status) && <TouchableOpacity style={styles.completeButton} disabled={saving} onPress={() => { setCancelReason(''); setPendingAction('cancel'); }}><Text style={{ color: '#B91C1C', fontWeight: '700' }}>Cancel Consultation</Text></TouchableOpacity>}

                  {['completed', 'cancelled'].includes(selectedConsultation.status) ? <View style={styles.lockedNotice}><Ionicons name="lock-closed-outline" size={18} color="#475569" /><Text style={styles.lockedNoticeText}>Completed and cancelled consultations are read-only.</Text></View> : <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={saveConsultationDetails} disabled={saving}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>Save Notes</Text>}</TouchableOpacity>}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <ActionDialog visible={Boolean(pendingAction)} title={pendingAction === 'cancel' ? 'Cancel consultation?' : 'Complete consultation?'} message={pendingAction === 'cancel' ? 'This action cannot be undone. Enter the cancellation reason.' : pendingAction === 'pause' ? 'Save your notes, complete this session and pause the queue? Your availability will become Unavailable.' : 'Save your notes, complete this session and call the next accepted student?'} confirmLabel="Confirm" destructive={pendingAction === 'cancel'} busy={saving} confirmDisabled={pendingAction === 'cancel' && !cancelReason.trim()} onConfirm={completeConsultation} onCancel={() => { if (!saving) setPendingAction(null); }}>{pendingAction === 'cancel' && <TextInput accessibilityLabel="Cancellation reason" value={cancelReason} onChangeText={setCancelReason} style={styles.textArea} placeholder="Reason for cancellation" maxLength={2000} />}</ActionDialog>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
    height: 32,
  },
  filterContainer: {
    gap: 8,
    paddingRight: 16,
  },
  filterChip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  filterChipActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  filterChipText: {
    fontSize: 13,
    color: '#666666',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#666666',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#999999',
    textAlign: 'center',
    marginTop: 8,
  },
  consultationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  studentId: {
    fontSize: 12,
    color: '#999999',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  topicText: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: '#666666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  modalBody: {
    padding: 20,
  },
  detailSection: {
    marginBottom: 20,
  },
  detailSectionHalf: {
    flex: 1,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 16,
  },
  detailLabel: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 6,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 16,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  detailSubValue: {
    fontSize: 13,
    color: '#666666',
    marginTop: 4,
  },
  statusReadOnly: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  textArea: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#1A1A1A',
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  textAreaLocked: {
    backgroundColor: '#E2E8F0',
    color: '#475569',
  },
  completeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    marginBottom: 12,
    gap: 8,
  },
  completeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
  },
  saveButton: {
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  saveButtonDisabled: {
    backgroundColor: '#90CAF9',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  lockedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    marginBottom: 24,
  },
  lockedNoticeText: {
    flex: 1,
    fontSize: 14,
    color: '#475569',
  },
});
