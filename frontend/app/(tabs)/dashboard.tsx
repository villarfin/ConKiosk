import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { ApiClient } from '@/src/utils/api';
import { useRouter } from 'expo-router';

interface DashboardStats {
  today_count: number;
  pending_requests: number;
  monthly_count: number;
  availability_status: string;
  upcoming_consultations: any[];
  recent_activity: any[];
}

export default function DashboardScreen() {
  const { faculty, updateFaculty } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const data = await ApiClient.get('/dashboard/stats');
      setStats(data);
    } catch (error: any) {
      console.error('Error loading dashboard:', error);
      Alert.alert('Error', 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  }, []);

  const updateAvailability = async (status: string) => {
    try {
      await ApiClient.patch('/faculty/availability', { status });
      
      if (faculty) {
        updateFaculty({ ...faculty, availability_status: status });
      }

      if (stats) {
        setStats({ ...stats, availability_status: status });
      }

      Alert.alert('Success', `Status changed to ${status}`);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to update availability');
    }
  };

  const getAvailabilityColor = (status: string) => {
    switch (status) {
      case 'available':
        return '#4CAF50';
      case 'busy':
        return '#FF9800';
      case 'unavailable':
        return '#F44336';
      default:
        return '#9E9E9E';
    }
  };

  const getAvailabilityIcon = (status: string) => {
    switch (status) {
      case 'available':
        return 'checkmark-circle';
      case 'busy':
        return 'time';
      case 'unavailable':
        return 'close-circle';
      default:
        return 'help-circle';
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
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2196F3']} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>Good day,</Text>
            <Text style={styles.name}>{faculty?.full_name}</Text>
            <Text style={styles.department}>{faculty?.department}</Text>
          </View>
          <View style={styles.profileImageContainer}>
            {faculty?.profile_image ? (
              <Image
                source={{ uri: faculty.profile_image }}
                style={styles.profileImage}
              />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Text style={styles.profileImageText}>
                  {faculty?.full_name?.charAt(0) || 'F'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Availability Status Card */}
        <View style={styles.availabilityCard}>
          <View style={styles.availabilityHeader}>
            <Text style={styles.availabilityTitle}>Current Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: getAvailabilityColor(stats?.availability_status || 'unavailable') }]}>
              <Ionicons
                name={getAvailabilityIcon(stats?.availability_status || 'unavailable') as any}
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.statusBadgeText}>
                {(stats?.availability_status || 'unavailable').toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={styles.availabilityButtons}>
            <TouchableOpacity
              style={[
                styles.availabilityButton,
                stats?.availability_status === 'available' && styles.availabilityButtonActive,
              ]}
              onPress={() => updateAvailability('available')}
            >
              <Ionicons name="checkmark-circle" size={20} color={stats?.availability_status === 'available' ? '#FFFFFF' : '#4CAF50'} />
              <Text style={[
                styles.availabilityButtonText,
                stats?.availability_status === 'available' && styles.availabilityButtonTextActive,
              ]}>Available</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.availabilityButton,
                stats?.availability_status === 'busy' && styles.availabilityButtonActive,
              ]}
              onPress={() => updateAvailability('busy')}
            >
              <Ionicons name="time" size={20} color={stats?.availability_status === 'busy' ? '#FFFFFF' : '#FF9800'} />
              <Text style={[
                styles.availabilityButtonText,
                stats?.availability_status === 'busy' && styles.availabilityButtonTextActive,
              ]}>Busy</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.availabilityButton,
                stats?.availability_status === 'unavailable' && styles.availabilityButtonActive,
              ]}
              onPress={() => updateAvailability('unavailable')}
            >
              <Ionicons name="close-circle" size={20} color={stats?.availability_status === 'unavailable' ? '#FFFFFF' : '#F44336'} />
              <Text style={[
                styles.availabilityButtonText,
                stats?.availability_status === 'unavailable' && styles.availabilityButtonTextActive,
              ]}>Unavailable</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: '#E3F2FD' }]}>
            <Ionicons name="calendar-outline" size={32} color="#2196F3" />
            <Text style={styles.statValue}>{stats?.today_count || 0}</Text>
            <Text style={styles.statLabel}>Todays Consultations</Text>
          </View>

          <View style={[styles.statCard, { backgroundColor: '#FFF3E0' }]}>
            <Ionicons name="mail-outline" size={32} color="#FF9800" />
            <Text style={styles.statValue}>{stats?.pending_requests || 0}</Text>
            <Text style={styles.statLabel}>Pending Requests</Text>
          </View>

          <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
            <Ionicons name="checkmark-done-outline" size={32} color="#4CAF50" />
            <Text style={styles.statValue}>{stats?.monthly_count || 0}</Text>
            <Text style={styles.statLabel}>This Month</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/(tabs)/requests')}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#E3F2FD' }]}>
                <Ionicons name="mail" size={24} color="#2196F3" />
              </View>
              <Text style={styles.actionText}>View Requests</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/(tabs)/history')}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#F3E5F5' }]}>
                <Ionicons name="time" size={24} color="#9C27B0" />
              </View>
              <Text style={styles.actionText}>History</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/(tabs)/notifications')}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#FFF3E0' }]}>
                <Ionicons name="notifications" size={24} color="#FF9800" />
              </View>
              <Text style={styles.actionText}>Notifications</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/(tabs)/profile')}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="person" size={24} color="#4CAF50" />
              </View>
              <Text style={styles.actionText}>Profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Upcoming Consultations */}
        {stats?.upcoming_consultations && stats.upcoming_consultations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upcoming Consultations</Text>
            {stats.upcoming_consultations.map((consultation, index) => (
              <View key={index} style={styles.consultationCard}>
                <View style={styles.consultationHeader}>
                  <Text style={styles.consultationStudent}>{consultation.student_name}</Text>
                  <Text style={styles.consultationTime}>{consultation.time}</Text>
                </View>
                <Text style={styles.consultationTopic}>{consultation.topic}</Text>
                <Text style={styles.consultationDate}>{consultation.date}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 16,
    color: '#666666',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginTop: 4,
  },
  department: {
    fontSize: 14,
    color: '#666666',
    marginTop: 2,
  },
  profileImageContainer: {
    marginLeft: 16,
  },
  profileImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  profileImagePlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileImageText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  availabilityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  availabilityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  availabilityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  availabilityButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  availabilityButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    gap: 6,
  },
  availabilityButtonActive: {
    backgroundColor: '#2196F3',
  },
  availabilityButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  availabilityButtonTextActive: {
    color: '#FFFFFF',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
  },
  actionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionText: {
    fontSize: 12,
    color: '#1A1A1A',
    textAlign: 'center',
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
  consultationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  consultationStudent: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  consultationTime: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2196F3',
  },
  consultationTopic: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 4,
  },
  consultationDate: {
    fontSize: 12,
    color: '#999999',
  },
});
