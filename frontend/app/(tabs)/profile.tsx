import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';
import { ApiClient } from '@/src/utils/api';

export default function ProfileScreen() {
  const { faculty, logout, updateFaculty } = useAuth();
  const router = useRouter();
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit profile state
  const [editName, setEditName] = useState(faculty?.full_name || '');
  const [editEmail, setEditEmail] = useState(faculty?.email || '');
  const [editDepartment, setEditDepartment] = useState(faculty?.department || '');
  const [editOffice, setEditOffice] = useState(faculty?.office_location || '');
  const [editOfficeHours, setEditOfficeHours] = useState(faculty?.office_hours || '');

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const isProfileIncomplete = !editName.trim() || !editEmail.trim() || !editDepartment.trim()
    || !editOffice.trim() || !editOfficeHours.trim();
  const isPasswordIncomplete = !currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim();

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Please grant photo library access to change your profile picture',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => ImagePicker.requestMediaLibraryPermissionsAsync() },
        ]
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert('Image unavailable', 'The selected image could not be read. Please try a JPG or PNG image.');
      return;
    }

    const mimeType = asset.mimeType || 'image/jpeg';
    const base64Image = `data:${mimeType};base64,${asset.base64}`;
    await updateProfileImage(base64Image);
  };

  const updateProfileImage = async (base64Image: string) => {
    setSaving(true);
    try {
      const updated = await ApiClient.patch('/faculty/profile', {
        profile_image: base64Image,
      });

      updateFaculty(updated);
      Alert.alert('Success', 'Profile picture updated');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile picture');
    } finally {
      setSaving(false);
    }
  };

  const openEditProfile = () => {
    setEditName(faculty?.full_name || '');
    setEditEmail(faculty?.email || '');
    setEditDepartment(faculty?.department || '');
    setEditOffice(faculty?.office_location || '');
    setEditOfficeHours(faculty?.office_hours || '');
    setEditModalVisible(true);
  };

  const saveProfile = async () => {
    if (isProfileIncomplete) {
      Alert.alert('Missing Information', 'Please complete all profile fields.');
      return;
    }
    setSaving(true);
    try {
      const updated = await ApiClient.patch('/faculty/profile', {
        full_name: editName,
        email: editEmail,
        department: editDepartment,
        office_location: editOffice,
        office_hours: editOfficeHours,
      });

      updateFaculty(updated);
      setEditModalVisible(false);
      Alert.alert('Success', 'Profile updated');
    } catch (error: any) {
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (isPasswordIncomplete) {
      Alert.alert('Missing Information', 'Please complete all password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setSaving(true);
    try {
      await ApiClient.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });

      setPasswordModalVisible(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Success', 'Password changed successfully');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <TouchableOpacity onPress={pickImage} style={styles.imageContainer}>
            {faculty?.profile_image ? (
              <Image source={{ uri: faculty.profile_image }} style={styles.profileImage} />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Text style={styles.profileImageText}>
                  {faculty?.full_name?.charAt(0) || 'F'}
                </Text>
              </View>
            )}
            <View style={styles.cameraIcon}>
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="camera" size={16} color="#FFFFFF" />
              )}
            </View>
          </TouchableOpacity>

          <Text style={styles.profileName}>{faculty?.full_name}</Text>
          <Text style={styles.profileDepartment}>{faculty?.department}</Text>
          <Text style={styles.profileSchoolId}>{faculty?.school_id}</Text>
        </View>

        {/* Profile Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>

          <View style={styles.detailItem}>
            <View style={styles.detailIconContainer}>
              <Ionicons name="mail-outline" size={20} color="#2196F3" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Email</Text>
              <Text style={styles.detailValue}>{faculty?.email || 'Not set'}</Text>
            </View>
          </View>

          <View style={styles.detailItem}>
            <View style={styles.detailIconContainer}>
              <Ionicons name="business-outline" size={20} color="#2196F3" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Department</Text>
              <Text style={styles.detailValue}>{faculty?.department || 'Not set'}</Text>
            </View>
          </View>

          <View style={styles.detailItem}>
            <View style={styles.detailIconContainer}>
              <Ionicons name="location-outline" size={20} color="#2196F3" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Office Location</Text>
              <Text style={styles.detailValue}>{faculty?.office_location || 'Not set'}</Text>
            </View>
          </View>

          <View style={styles.detailItem}>
            <View style={styles.detailIconContainer}>
              <Ionicons name="time-outline" size={20} color="#2196F3" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Office Hours</Text>
              <Text style={styles.detailValue}>{faculty?.office_hours || 'Not set'}</Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity style={styles.actionItem} onPress={openEditProfile}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="create-outline" size={20} color="#2196F3" />
            </View>
            <Text style={styles.actionText}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={20} color="#BDBDBD" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={() => setPasswordModalVisible(true)}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#2196F3" />
            </View>
            <Text style={styles.actionText}>Change Password</Text>
            <Ionicons name="chevron-forward" size={20} color="#BDBDBD" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleLogout}>
            <View style={[styles.actionIconContainer, { backgroundColor: '#FFEBEE' }]}>
              <Ionicons name="log-out-outline" size={20} color="#F44336" />
            </View>
            <Text style={[styles.actionText, { color: '#F44336' }]}>Logout</Text>
            <Ionicons name="chevron-forward" size={20} color="#BDBDBD" />
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>ConKiosk Faculty App</Text>
          <Text style={styles.footerVersion}>Version 1.0.0</Text>
        </View>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Ionicons name="close" size={24} color="#666666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={[styles.input, !editName.trim() && styles.inputError]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Enter your full name"
                />
                {!editName.trim() && <Text style={styles.fieldRequiredText}>Full Name is required.</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={[styles.input, !editEmail.trim() && styles.inputError]}
                  value={editEmail}
                  onChangeText={setEditEmail}
                  placeholder="Enter your email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                {!editEmail.trim() && <Text style={styles.fieldRequiredText}>Email is required.</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Department</Text>
                <TextInput
                  style={[styles.input, !editDepartment.trim() && styles.inputError]}
                  value={editDepartment}
                  onChangeText={setEditDepartment}
                  placeholder="Enter your department"
                />
                {!editDepartment.trim() && <Text style={styles.fieldRequiredText}>Department is required.</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Office Location</Text>
                <TextInput
                  style={[styles.input, !editOffice.trim() && styles.inputError]}
                  value={editOffice}
                  onChangeText={setEditOffice}
                  placeholder="e.g., Room 301, Science Building"
                />
                {!editOffice.trim() && <Text style={styles.fieldRequiredText}>Office Location is required.</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Office Hours</Text>
                <TextInput
                  style={[styles.input, !editOfficeHours.trim() && styles.inputError]}
                  value={editOfficeHours}
                  onChangeText={setEditOfficeHours}
                  placeholder="e.g., Mon-Fri 9:00 AM - 5:00 PM"
                />
                {!editOfficeHours.trim() && <Text style={styles.fieldRequiredText}>Office Hours is required.</Text>}
              </View>

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={saveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        visible={passwordModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPasswordModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setPasswordModalVisible(false)}>
                <Ionicons name="close" size={24} color="#666666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Current Password</Text>
                <TextInput
                  style={[styles.input, !currentPassword.trim() && styles.inputError]}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Enter current password"
                  secureTextEntry
                />
                {!currentPassword.trim() && <Text style={styles.fieldRequiredText}>Current Password is required.</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>New Password</Text>
                <TextInput
                  style={[styles.input, !newPassword.trim() && styles.inputError]}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Enter new password"
                  secureTextEntry
                />
                {!newPassword.trim() && <Text style={styles.fieldRequiredText}>New Password is required.</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Confirm New Password</Text>
                <TextInput
                  style={[styles.input, !confirmPassword.trim() && styles.inputError]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  secureTextEntry
                />
                {!confirmPassword.trim() && <Text style={styles.fieldRequiredText}>Confirm New Password is required.</Text>}
              </View>

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={changePassword}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Change Password</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  header: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  imageContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  profileImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileImageText: {
    fontSize: 48,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  profileName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  profileDepartment: {
    fontSize: 14,
    color: '#666666',
  },
  profileSchoolId: {
    fontSize: 12,
    color: '#999999',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  detailIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  actionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    flex: 1,
    fontSize: 15,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  footer: {
    alignItems: 'center',
    padding: 24,
  },
  footerText: {
    fontSize: 12,
    color: '#999999',
  },
  footerVersion: {
    fontSize: 11,
    color: '#BDBDBD',
    marginTop: 4,
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
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  inputError: { borderColor: '#C62828', borderWidth: 1.5 },
  fieldRequiredText: { color: '#C62828', fontSize: 11, marginTop: 4 },
  saveButton: {
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
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
});
