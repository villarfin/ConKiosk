import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setKioskDraft } from '@/src/utils/kiosk-draft';

export default function GuestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ faculty_school_id: string; faculty_name: string; faculty_office: string }>();
  const [fullName, setFullName] = useState('');
  const [purpose, setPurpose] = useState('');
  const continueRequest = () => {
    if (!fullName.trim() || !purpose.trim()) { Alert.alert('Missing information', 'Please enter your name and reason for visiting.'); return; }
    setKioskDraft([], { full_name: fullName.trim(), purpose: purpose.trim() });
    router.push({ pathname: '/kiosk/request', params: { ...params, consultation_type: 'guest' } });
  };
  return <SafeAreaView style={styles.container}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}><TouchableOpacity onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={24} color="#1A1A1A" /></TouchableOpacity><View><Text style={styles.title}>Guest / Visitor</Text><Text style={styles.subtitle}>Consulting: {params.faculty_name}</Text></View></View>
    <View style={styles.content}><View style={styles.notice}><Ionicons name="information-circle-outline" size={22} color="#1D4ED8" /><Text style={styles.noticeText}>For non-students visiting the IT Chair, such as for document signatures.</Text></View>
      <Text style={styles.label}>Full Name</Text><TextInput testID="guest-full-name" style={styles.input} placeholder="Enter your full name" value={fullName} onChangeText={setFullName} autoFocus />
      <Text style={styles.label}>Reason for Visiting</Text><TextInput testID="guest-purpose" style={[styles.input, styles.textarea]} placeholder="e.g., Document signature" value={purpose} onChangeText={setPurpose} multiline textAlignVertical="top" maxLength={300} />
    </View>
    <View style={styles.footer}><TouchableOpacity testID="guest-continue-btn" style={styles.button} onPress={continueRequest}><Text style={styles.buttonText}>Continue</Text><Ionicons name="arrow-forward" size={20} color="#FFF" /></TouchableOpacity></View>
  </KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ container:{ flex:1, backgroundColor:'#F5F7FA' }, flex:{ flex:1 }, header:{ flexDirection:'row', alignItems:'center', gap:12, padding:16, backgroundColor:'#FFF', borderBottomWidth:1, borderBottomColor:'#E0E0E0' }, back:{ padding:8 }, title:{ fontSize:24, fontWeight:'700', color:'#1A1A1A' }, subtitle:{ fontSize:15, color:'#666', marginTop:2 }, content:{ padding:16 }, notice:{ flexDirection:'row', gap:10, backgroundColor:'#DBEAFE', borderRadius:12, padding:14, marginBottom:24 }, noticeText:{ flex:1, color:'#1E3A8A', fontSize:14, lineHeight:20 }, label:{ fontSize:17, fontWeight:'600', color:'#1A1A1A', marginBottom:7, marginTop:16 }, input:{ backgroundColor:'#FFF', borderWidth:1, borderColor:'#CBD5E1', borderRadius:10, padding:13, fontSize:18 }, textarea:{ minHeight:120 }, footer:{ marginTop:'auto', padding:16, backgroundColor:'#FFF', borderTopWidth:1, borderTopColor:'#E0E0E0' }, button:{ flexDirection:'row', justifyContent:'center', alignItems:'center', gap:8, backgroundColor:'#1D4ED8', padding:16, borderRadius:12 }, buttonText:{ color:'#FFF', fontSize:18, fontWeight:'700' } });
