import React, { useState } from 'react';
import { Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function SignupScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ school_id: '', full_name: '', department: '', office_location: '', email: '', office_hours: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });

  const register = async () => {
    const { confirmPassword, ...payload } = form;
    if (Object.values(payload).some((value) => !value.trim())) return Alert.alert('Missing information', 'Please complete all fields.');
    if (payload.password.length < 8) return Alert.alert('Password too short', 'Use at least 8 characters.');
    if (payload.password !== confirmPassword) return Alert.alert('Passwords do not match', 'Please enter the same password twice.');
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Could not create the account.');
      await login(payload.school_id, payload.password);
      router.replace('/(tabs)/dashboard');
    } catch (error: any) {
      Alert.alert('Registration failed', error.message || 'Please try again.');
    } finally { setLoading(false); }
  };

  const field = (label: string, key: keyof typeof form, props: any = {}) => <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={form[key]} onChangeText={(value) => set(key, value)} editable={!loading} placeholder={props.placeholder} autoCapitalize={props.autoCapitalize || 'words'} secureTextEntry={props.secureTextEntry} keyboardType={props.keyboardType} /></View>;

  return <SafeAreaView style={styles.container}><KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={22} color="#2196F3" /><Text style={styles.backText}>Back to sign in</Text></TouchableOpacity><Text style={styles.title}>Faculty registration</Text><Text style={styles.subtitle}>Set up your faculty consultation account.</Text>{field('School ID', 'school_id', { placeholder: 'e.g., FAC2024007', autoCapitalize: 'characters' })}{field('Full name', 'full_name', { placeholder: 'e.g., Dr. Jane Cruz' })}{field('Department', 'department', { placeholder: 'e.g., Computer Science' })}{field('Office location', 'office_location', { placeholder: 'e.g., Room 301' })}{field('Email address', 'email', { placeholder: 'name@school.edu', autoCapitalize: 'none', keyboardType: 'email-address' })}{field('Office hours', 'office_hours', { placeholder: 'e.g., Mon-Fri 9:00 AM - 5:00 PM' })}{field('Password', 'password', { placeholder: 'At least 8 characters', autoCapitalize: 'none', secureTextEntry: true })}{field('Confirm password', 'confirmPassword', { placeholder: 'Re-enter password', autoCapitalize: 'none', secureTextEntry: true })}<TouchableOpacity style={[styles.button, loading && styles.disabled]} onPress={register} disabled={loading}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create faculty account</Text>}</TouchableOpacity></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#fff' }, content: { padding: 24, paddingBottom: 40 }, back: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 28 }, backText: { color: '#2196F3', fontWeight: '600' }, title: { fontSize: 28, fontWeight: '700', color: '#1A1A1A' }, subtitle: { color: '#666', marginTop: 6, marginBottom: 24 }, field: { marginBottom: 15 }, label: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 7 }, input: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, paddingHorizontal: 13, height: 48, color: '#1A1A1A' }, button: { height: 52, borderRadius: 12, backgroundColor: '#2196F3', alignItems: 'center', justifyContent: 'center', marginTop: 10 }, disabled: { backgroundColor: '#90CAF9' }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 } });
