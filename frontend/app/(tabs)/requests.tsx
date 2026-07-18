import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ApiClient } from '@/src/utils/api';
import DateTimePicker from '@react-native-community/datetimepicker';

interface ConsultationRequest {
  _id: string;
  student_id: string;
  student_name: string;
  student_program: string;
  topic: string;
  preferred_date: string;
  preferred_time: string;
  status: string;
  created_at: string;
}

export default function RequestsScreen() {
  const [requests, setRequests] = useState<ConsultationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ConsultationRequest | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [rescheduleModalVisible, setRescheduleModalVisible] = useState(false);
  const [declineModalVisible, setDeclineModalVisible] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState(new Date());
  const [rescheduleTime, setRescheduleTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      const data = await ApiClient.get('/consultation-requests?status=pending');
      setRequests(data);
    } catch (error: any) {
      console.error('Error loading requests:', error);
      Alert.alert('Error', 'Failed to load consultation requests');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, []);

  const openActionModal = (request: ConsultationRequest) => {
    setSelectedRequest(request);
    setActionModalVisible(true);
  };

  const closeActionModal = () => {
    setActionModalVisible(false);
    setSelectedRequest(null);
  };

  const handleAccept = async () => {
    if (!selectedRequest) return;

    setActionLoading(true);
    try {
      await ApiClient.post(`/consultation-requests/${selectedRequest._id}/action`, {
        action: 'accept',
      });

      Alert.alert('Success', 'Consultation request accepted');
      closeActionModal();
      loadRequests();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to accept request');
    } finally {
      setActionLoading(false);
    }
  };

  const openDeclineModal = () => {
    setActionModalVisible(false);
    setDeclineModalVisible(true);
  };

  const handleDecline = async () => {
    if (!selectedRequest) return;

    setActionLoading(true);
    try {
      await ApiClient.post(`/consultation-requests/${selectedRequest._id}/action`, {
        action: 'decline',
        reason: declineReason || 'Not available',
      });

      Alert.alert('Success', 'Consultation request declined');
      setDeclineModalVisible(false);
      setDeclineReason('');
      setSelectedRequest(null);
      loadRequests();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to decline request');
    } finally {
      setActionLoading(false);
    }
  };

  const openRescheduleModal = () => {
    setActionModalVisible(false);
    setRescheduleModalVisible(true);
  };

  const handleReschedule = async () => {
    if (!selectedRequest) return;

    const dateStr = rescheduleDate.toISOString().split('T')[0];
    const timeStr = rescheduleTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    setActionLoading(true);
    try {
      await ApiClient.post(`/consultation-requests/${selectedRequest._id}/action`, {
        action: 'reschedule',
        reschedule_date: dateStr,
        reschedule_time: timeStr,
      });

      Alert.alert('Success', 'Consultation request rescheduled');
      setRescheduleModalVisible(false);
      setSelectedRequest(null);
      loadRequests();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to reschedule request');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#FF9800';
      case 'accepted':
        return '#4CAF50';
      case 'declined':
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
        <Text style={styles.headerTitle}>Consultation Requests</Text>
        <Text style={styles.headerSubtitle}>
          {requests.length} pending {requests.length === 1 ? 'request' : 'requests'}
        </Text>
      </View>

      {/* Requests List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2196F3']} />
        }
      >
        {requests.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="mail-open-outline" size={64} color="#BDBDBD" />
            <Text style={styles.emptyTitle}>No Pending Requests</Text>
            <Text style={styles.emptyText}>
              You&apos;re all caught up! New consultation requests will appear here.
            </Text>
          </View>
        ) : (
          requests.map((request) => (
            <TouchableOpacity
              key={request._id}
              style={styles.requestCard}
              onPress={() => openActionModal(request)}
            >
              <View style={styles.requestHeader}>
                <View style={styles.studentInfo}>
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarText}>
                      {request.student_name.charAt(0)}
                    </Text>
                  </View>
                  <View style={styles.studentDetails}>
                    <Text style={styles.studentName}>{request.student_name}</Text>
                    <Text style={styles.studentProgram}>{request.student_program}</Text>
                    <Text style={styles.studentId}>{request.student_id}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.requestBody}>
                <View style={styles.topicContainer}>
                  <Ionicons name="chatbubble-outline" size={16} color="#666666" />
                  <Text style={styles.topicText}>{request.topic}</Text>
                </View>

                <View style={styles.scheduleContainer}>
                  <View style={styles.scheduleItem}>
                    <Ionicons name="calendar-outline" size={16} color="#2196F3" />
                    <Text style={styles.scheduleText}>{request.preferred_date}</Text>
                  </View>
                  <View style={styles.scheduleItem}>
                    <Ionicons name="time-outline" size={16} color="#2196F3" />
                    <Text style={styles.scheduleText}>{request.preferred_time}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.requestFooter}>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(request.status) }]}>
                  <Text style={styles.statusText}>{request.status.toUpperCase()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#BDBDBD" />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Action Modal */}
      <Modal
        visible={actionModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeActionModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Actions</Text>
              <TouchableOpacity onPress={closeActionModal}>
                <Ionicons name="close" size={24} color="#666666" />
              </TouchableOpacity>
            </View>

            {selectedRequest && (
              <View style={styles.modalBody}>
                <Text style={styles.modalStudentName}>{selectedRequest.student_name}</Text>
                <Text style={styles.modalTopic}>{selectedRequest.topic}</Text>
                <Text style={styles.modalSchedule}>
                  {selectedRequest.preferred_date} at {selectedRequest.preferred_time}
                </Text>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.acceptButton]}
                    onPress={handleAccept}
                    disabled={actionLoading}
                  >
                    <Ionicons name="checkmark-circle" size={24} color="#FFFFFF" />
                    <Text style={styles.modalButtonText}>Accept</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalButton, styles.rescheduleButton]}
                    onPress={openRescheduleModal}
                    disabled={actionLoading}
                  >
                    <Ionicons name="calendar" size={24} color="#FFFFFF" />
                    <Text style={styles.modalButtonText}>Reschedule</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalButton, styles.declineButton]}
                    onPress={openDeclineModal}
                    disabled={actionLoading}
                  >
                    <Ionicons name="close-circle" size={24} color="#FFFFFF" />
                    <Text style={styles.modalButtonText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Reschedule Modal */}
      <Modal
        visible={rescheduleModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRescheduleModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reschedule Consultation</Text>
              <TouchableOpacity onPress={() => setRescheduleModalVisible(false)}>
                <Ionicons name="close" size={24} color="#666666" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <TouchableOpacity
                style={styles.dateTimeButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar-outline" size={20} color="#2196F3" />
                <Text style={styles.dateTimeText}>
                  Date: {rescheduleDate.toLocaleDateString()}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dateTimeButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Ionicons name="time-outline" size={20} color="#2196F3" />
                <Text style={styles.dateTimeText}>
                  Time: {rescheduleTime.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </Text>
              </TouchableOpacity>

              {showDatePicker && (
                <DateTimePicker
                  value={rescheduleDate}
                  mode="date"
                  display="default"
                  onChange={(event, date) => {
                    setShowDatePicker(false);
                    if (date) setRescheduleDate(date);
                  }}
                  minimumDate={new Date()}
                />
              )}

              {showTimePicker && (
                <DateTimePicker
                  value={rescheduleTime}
                  mode="time"
                  display="default"
                  onChange={(event, time) => {
                    setShowTimePicker(false);
                    if (time) setRescheduleTime(time);
                  }}
                />
              )}

              <TouchableOpacity
                style={[styles.submitButton, actionLoading && styles.submitButtonDisabled]}
                onPress={handleReschedule}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>Confirm Reschedule</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Decline Modal */}
      <Modal
        visible={declineModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDeclineModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Decline Request</Text>
              <TouchableOpacity onPress={() => setDeclineModalVisible(false)}>
                <Ionicons name="close" size={24} color="#666666" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Reason (Optional)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Provide a reason for declining..."
                value={declineReason}
                onChangeText={setDeclineReason}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.submitButton, styles.declineSubmitButton, actionLoading && styles.submitButtonDisabled]}
                onPress={handleDecline}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>Confirm Decline</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
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
    paddingHorizontal: 32,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  requestHeader: {
    marginBottom: 12,
  },
  studentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  studentDetails: {
    flex: 1,
    marginLeft: 12,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  studentProgram: {
    fontSize: 13,
    color: '#666666',
    marginTop: 2,
  },
  studentId: {
    fontSize: 12,
    color: '#999999',
    marginTop: 2,
  },
  requestBody: {
    marginBottom: 12,
  },
  topicContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 8,
  },
  topicText: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
    lineHeight: 20,
  },
  scheduleContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduleText: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: '500',
  },
  requestFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
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
    paddingBottom: 32,
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
  modalStudentName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  modalTopic: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 4,
  },
  modalSchedule: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: '500',
    marginBottom: 24,
  },
  modalActions: {
    gap: 12,
  },
  modalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  acceptButton: {
    backgroundColor: '#4CAF50',
  },
  rescheduleButton: {
    backgroundColor: '#FF9800',
  },
  declineButton: {
    backgroundColor: '#F44336',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dateTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    marginBottom: 12,
    gap: 12,
  },
  dateTimeText: {
    fontSize: 16,
    color: '#1A1A1A',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#1A1A1A',
    minHeight: 100,
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#90CAF9',
  },
  declineSubmitButton: {
    backgroundColor: '#F44336',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
