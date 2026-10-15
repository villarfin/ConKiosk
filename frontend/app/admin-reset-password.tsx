import React, { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiClient } from '@/src/utils/api';
import { ActionDialog } from '@/src/components/ActionDialog';
import { useAuth } from '@/src/contexts/AuthContext';

export default function ResetFacultyPassword() {
  const { faculty } = useAuth();
  const { school_id } = useLocalSearchParams<{ school_id: string }>();
  const router = useRouter();
  const [adminPassword, setAdminPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (faculty?.role !== 'admin') return <Text>Administrator access required.</Text>;
  const reset = async () => {
    setBusy(true); setError('');
    try { await ApiClient.post(`/admin/faculty/${school_id}/reset-password`, { admin_password: adminPassword, new_password: password }); setVisible(false); setAdminPassword(''); setPassword(''); setConfirm(''); Alert.alert('Password reset', 'All existing sessions for this faculty have ended. Give the new password to the faculty securely.'); router.back(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const input = { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 14, marginTop: 10 };
  return <SafeAreaView style={{ flex: 1, padding: 24, backgroundColor: '#FFFFFF' }}><View style={{ width: '100%', maxWidth: 500, alignSelf: 'center', gap: 10 }}><TouchableOpacity onPress={() => router.back()}><Text>Back</Text></TouchableOpacity><Text style={{ fontSize: 24, fontWeight: '800' }}>Reset faculty password</Text><Text>{school_id}</Text><TextInput accessibilityLabel="Administrator password" placeholder="Your administrator password" secureTextEntry autoCapitalize="none" value={adminPassword} onChangeText={setAdminPassword} style={input} /><TextInput accessibilityLabel="New faculty password" placeholder="New faculty password (at least 8 characters)" secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} style={input} /><TextInput accessibilityLabel="Confirm new faculty password" placeholder="Confirm new password" secureTextEntry autoCapitalize="none" value={confirm} onChangeText={setConfirm} style={input} /><TouchableOpacity disabled={!adminPassword || password.length < 8 || password !== confirm} onPress={() => setVisible(true)} style={{ padding: 16, backgroundColor: '#172747', borderRadius: 8 }}><Text style={{ color: '#FFFFFF', textAlign: 'center' }}>Reset password</Text></TouchableOpacity></View><ActionDialog visible={visible} title="Reset faculty password?" message="The password will change immediately and all of this faculty's sessions will end." confirmLabel="Reset password" destructive busy={busy} error={error} onConfirm={reset} onCancel={() => { if (!busy) setVisible(false); }} /></SafeAreaView>;
}
