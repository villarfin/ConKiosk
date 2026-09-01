import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ApiClient } from '@/src/utils/api';
import { useAuth } from '@/src/contexts/AuthContext';

export default function AdminAccount() {
  const { faculty, updateFaculty } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(faculty?.full_name || '');
  const [email, setEmail] = useState(faculty?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const saveProfile = async () => {
    try { const updated = await ApiClient.patch('/faculty/profile', { full_name: name, email }); updateFaculty(updated); Alert.alert('Saved', 'Administrator profile updated.'); }
    catch (error: any) { Alert.alert('Unable to save', error.message || 'Please try again.'); }
  };
  const changePassword = async () => {
    if (!currentPassword || !newPassword) return Alert.alert('Missing details', 'Enter the current and new password.');
    if (newPassword.length < 8) return Alert.alert('Password too short', 'Use at least 8 characters.');
    try { await ApiClient.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword }); setCurrentPassword(''); setNewPassword(''); Alert.alert('Password changed', 'Share the new credentials securely with the incoming IT Chair.'); }
    catch (error: any) { Alert.alert('Unable to change password', error.message || 'Check the current password.'); }
  };
  return <SafeAreaView style={styles.container}><ScrollView contentContainerStyle={styles.content}><TouchableOpacity onPress={() => router.replace('/admin')} style={styles.back}><Ionicons name="arrow-back" size={20} color="#1D4ED8" /><Text style={styles.backText}>Administrator dashboard</Text></TouchableOpacity><View style={styles.icon}><Ionicons name="shield-checkmark" size={38} color="#1D4ED8" /></View><Text style={styles.title}>Administrator Account</Text><Text style={styles.subtitle}>This is the permanent system-administrator account. Keep its credentials restricted to authorized administrators.</Text><Text style={styles.id}>Account ID: {faculty?.school_id}</Text><Section title="Profile"><Field label="Display name" value={name} onChangeText={setName} /><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" /><Button label="Save profile" onPress={saveProfile} /></Section><Section title="Transfer / change password"><Text style={styles.help}>When transferring administrator responsibility, change the password and give the account credentials only to the authorized replacement.</Text><Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry /><Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry /><Button label="Change password" onPress={changePassword} /></Section></ScrollView></SafeAreaView>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }
function Field({ label, ...props }: any) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} autoCapitalize="none" {...props} /></View>; }
function Button({ label, onPress }: { label: string; onPress: () => void }) { return <TouchableOpacity style={styles.button} onPress={onPress}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>; }
const styles = StyleSheet.create({ container:{flex:1,backgroundColor:'#F8FAFC'},content:{padding:22,paddingBottom:44},back:{flexDirection:'row',alignItems:'center',gap:6,marginBottom:24},backText:{color:'#1D4ED8',fontWeight:'700'},icon:{width:76,height:76,borderRadius:38,backgroundColor:'#DBEAFE',alignItems:'center',justifyContent:'center',alignSelf:'center'},title:{fontSize:26,fontWeight:'800',color:'#0F172A',textAlign:'center',marginTop:12},subtitle:{fontSize:14,color:'#64748B',textAlign:'center',lineHeight:20,marginTop:8},id:{fontSize:13,color:'#475569',textAlign:'center',marginTop:12},section:{backgroundColor:'#FFF',borderRadius:16,padding:16,marginTop:20},sectionTitle:{fontSize:17,fontWeight:'800',color:'#0F172A',marginBottom:12},help:{fontSize:13,color:'#475569',lineHeight:19,marginBottom:12},field:{marginBottom:13},label:{fontSize:12,fontWeight:'700',color:'#475569',marginBottom:5},input:{borderWidth:1,borderColor:'#CBD5E1',borderRadius:10,padding:12,fontSize:15,color:'#0F172A'},button:{backgroundColor:'#1D4ED8',borderRadius:10,padding:14,alignItems:'center',marginTop:2},buttonText:{color:'#FFF',fontWeight:'800'} });
