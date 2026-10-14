import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';

export default function LoginScreen() {
  const [schoolId, setSchoolId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const { login } = useAuth();
  const router = useRouter();
  const { registration } = useLocalSearchParams<{ registration?: string }>();

  const handleLogin = async () => {
    if (!schoolId || !password) {
      setLoginError('Enter both your School ID and password.');
      return;
    }

    setLoginError('');
    setLoading(true);
    try {
      const role = await login(schoolId, password);
      router.replace(role === 'admin' ? '/admin' : '/(tabs)/dashboard');
    } catch (error: any) {
      const message = error.message || 'Unable to sign in. Please try again.';
      setLoginError(message);
      Alert.alert('Login Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo/Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="school" size={64} color="#2196F3" />
            </View>
            <Text style={styles.title}>ConKiosk</Text>
            <Text style={styles.subtitle}>Faculty Consultation Portal</Text>
          </View>

          {/* Login Form */}
          <View style={styles.form}>
            {registration === 'submitted' ? <View accessibilityLiveRegion="polite" style={styles.registrationNotice}><Ionicons name="checkmark-circle-outline" size={19} color="#15803D" /><Text style={styles.registrationNoticeText}>Registration submitted. Your account is awaiting Administrator approval before you can sign in.</Text></View> : null}
            <Text style={styles.welcomeText}>Welcome Back!</Text>
            <Text style={styles.instructionText}>
              Sign in to manage your consultations
            </Text>

            {/* School ID Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>School ID Number</Text>
              <View style={[styles.inputWrapper, !schoolId.trim() && styles.inputWrapperError]}>
                <Ionicons name="person-outline" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your School ID"
                  value={schoolId}
                  onChangeText={value => { setSchoolId(value); setLoginError(''); }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>
              {!schoolId.trim() && <Text style={styles.fieldRequiredText}>School ID Number is required.</Text>}
            </View>

            {/* Password Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <View style={[styles.inputWrapper, !password.trim() && styles.inputWrapperError]}>
                <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={value => { setPassword(value); setLoginError(''); }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                >
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
              {!password.trim() && <Text style={styles.fieldRequiredText}>Password is required.</Text>}
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={[styles.loginButton, loading && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.loginButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            {loginError ? <View accessibilityLiveRegion="assertive" style={styles.loginError}><Ionicons name="alert-circle-outline" size={18} color="#B91C1C" /><Text style={styles.loginErrorText}>{loginError}</Text></View> : null}

            <TouchableOpacity style={styles.signupLink} onPress={() => router.push('/signup')}>
              <Text style={styles.signupLinkText}>New faculty? Create an account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
  },
  form: {
    width: '100%',
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    paddingHorizontal: 12,
  },
  inputWrapperError: { borderColor: '#C62828', borderWidth: 1.5 },
  fieldRequiredText: { color: '#C62828', fontSize: 11, marginTop: 4 },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: '#1A1A1A',
  },
  loginError: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEE2E2', borderRadius: 10, padding: 12, marginTop: 14 },
  loginErrorText: { flex: 1, color: '#991B1B', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  registrationNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#DCFCE7', borderRadius: 10, padding: 12, marginBottom: 16 },
  registrationNoticeText: { flex: 1, color: '#166534', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  eyeIcon: {
    padding: 8,
  },
  loginButton: {
    backgroundColor: '#2196F3',
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonDisabled: {
    backgroundColor: '#90CAF9',
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  signupLink: {
    marginTop: 24,
    alignItems: 'center',
  },
  signupLinkText: { fontSize: 14, color: '#2196F3', fontWeight: '600' },
});
