import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ApiClient } from '@/src/utils/api';
import { useAuth } from '@/src/contexts/AuthContext';

type Summary = { faculty_count: number; student_count: number; pending_requests: number; today_consultations: number; active_queue_entries: number; admin_name: string };
type Faculty = { school_id: string; full_name: string; department: string; office_location: string; email: string; office_hours?: string; availability_status: string; total_consultations?: number; role?: string; is_approved?: boolean };
type Student = { student_id: string; full_name: string; program: string; year_level: string; section: string };
type Consultation = { _id: string; student_name: string; topic: string; date: string; time: string; status: string };

export default function AdminScreen() {
  const { faculty: account, logout } = useAuth();
  const router = useRouter();
  const isAdmin = account?.role === 'admin';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Faculty | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordView, setRecordView] = useState<'faculty' | 'students' | 'today' | 'facultyConsultations' | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [recordTitle, setRecordTitle] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextFaculty] = await Promise.all([ApiClient.get('/admin/summary'), ApiClient.get('/admin/faculty')]);
      setSummary(nextSummary); setFaculty(nextFaculty);
    } catch (error: any) {
      Alert.alert('Admin access unavailable', error.message || 'Please sign in with the administrator account.');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { if (account?.role === 'admin' || account?.role === 'it_chair') load(); else if (account) router.replace('/(tabs)/dashboard'); }, [account?.role, load]);
  const setAvailability = async (person: Faculty, status: string) => {
    try { await ApiClient.patch(`/admin/faculty/${person.school_id}`, { availability_status: status }); await load(); }
    catch (error: any) { Alert.alert('Update failed', error.message || 'Unable to change faculty availability.'); }
  };
  const saveProfile = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await ApiClient.patch(`/admin/faculty/${editing.school_id}`, editing);
      setEditing(null); await load();
    } catch (error: any) { Alert.alert('Update failed', error.message || 'Unable to update this faculty profile.'); }
    finally { setSaving(false); }
  };
  const openRecords = async (view: 'faculty' | 'students' | 'today') => {
    try {
      if (view === 'students') { setStudents(await ApiClient.get('/admin/students')); setRecordTitle('Student Records'); }
      if (view === 'today') { setConsultations(await ApiClient.get('/admin/consultations/today')); setRecordTitle("Today's Consultations"); }
      if (view === 'faculty') setRecordTitle('Faculty Records');
      setRecordView(view);
    } catch (error: any) { Alert.alert('Unable to load records', error.message || 'Please try again.'); }
  };
  const openFacultyConsultations = async (person: Faculty) => {
    try { setConsultations(await ApiClient.get(`/admin/faculty/${person.school_id}/consultations`)); setRecordTitle(`${person.full_name}'s Consultations`); setRecordView('facultyConsultations'); }
    catch (error: any) { Alert.alert('Unable to load records', error.message || 'Please try again.'); }
  };
  const confirmAction = (message: string, action: () => void) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') { if (window.confirm(message)) action(); return; }
    Alert.alert('Confirm action', message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', style: 'destructive', onPress: action }]);
  };
  const nominateITChair = async (person: Faculty) => {
    try { await ApiClient.post(`/admin/it-chair/${person.school_id}`); Alert.alert('IT Chair assigned', `${person.full_name} now has read-only IT Chair access.`); await load(); }
    catch (error: any) { Alert.alert('Assignment failed', error.message || 'Please try again.'); }
  };
  const deleteFaculty = async (person: Faculty) => {
    try { await ApiClient.delete(`/admin/faculty/${person.school_id}`); Alert.alert('Faculty account deleted', 'The account and live queue data were removed. Completed consultation records were retained.'); await load(); }
    catch (error: any) { Alert.alert('Deletion failed', error.message || 'Please try again.'); }
  };
  const removeITChair = async (person: Faculty) => {
    try { await ApiClient.delete('/admin/it-chair'); Alert.alert('IT Chair removed', `${person.full_name} now has normal faculty access.`); await load(); }
    catch (error: any) { Alert.alert('Unable to remove IT Chair', error.message || 'Please try again.'); }
  };
  const approveFaculty = async (person: Faculty) => {
    try { await ApiClient.post(`/admin/faculty/${person.school_id}/approve`); Alert.alert('Faculty approved', `${person.full_name} can now sign in.`); await load(); }
    catch (error: any) { Alert.alert('Approval failed', error.message || 'Please try again.'); }
  };
  const signOut = async () => {
    await logout();
    router.replace('/login');
  };
  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#2563EB" /></View>;
  return <SafeAreaView style={styles.container}><ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />} contentContainerStyle={styles.content}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>CONKIOSK CONTROL CENTER</Text><Text style={styles.title}>{isAdmin ? 'Administrator' : 'IT Chair'}</Text><Text style={styles.subtitle}>{isAdmin ? (summary?.admin_name || account?.full_name) : account?.full_name}</Text></View><TouchableOpacity onPress={signOut} style={styles.logout}><Ionicons name="log-out-outline" size={20} color="#B91C1C" /></TouchableOpacity></View>
    <Text style={styles.sectionTitle}>System overview</Text><View style={styles.grid}>
      <Stat label="Faculty" value={summary?.faculty_count ?? 0} icon="people-outline" color="#2563EB" onPress={() => openRecords('faculty')} />
      <Stat label="Students" value={summary?.student_count ?? 0} icon="school-outline" color="#7C3AED" onPress={() => openRecords('students')} />
      <Stat label="Pending" value={summary?.pending_requests ?? 0} icon="mail-unread-outline" color="#D97706" />
      <Stat label="Active queue" value={summary?.active_queue_entries ?? 0} icon="list-outline" color="#059669" />
      <Stat label="Today" value={summary?.today_consultations ?? 0} icon="calendar-outline" color="#0891B2" onPress={() => openRecords('today')} />
    </View>
    <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={20} color="#1D4ED8" /><Text style={styles.noticeText}>{isAdmin ? 'This account has system-wide access. Keep its credentials restricted to authorized administrators and change the password whenever administrator responsibility is transferred.' : 'Read-only access: faculty information, consultation records, and student records.'}</Text></View>
    {isAdmin && <TouchableOpacity style={styles.credentials} onPress={() => router.push('/admin-account')}><Ionicons name="key-outline" size={18} color="#FFFFFF" /><Text style={styles.credentialsText}>Manage administrator credentials</Text></TouchableOpacity>}
    {!isAdmin && <TouchableOpacity style={styles.credentials} onPress={() => router.replace('/(tabs)/dashboard')}><Ionicons name="home-outline" size={18} color="#FFFFFF" /><Text style={styles.credentialsText}>Return to Faculty Dashboard</Text></TouchableOpacity>}
    <Text style={styles.sectionTitle}>Faculty management</Text>
    {isAdmin && faculty.filter(person => !person.is_approved).map(person => <View key={`pending-${person.school_id}`} style={{ backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 10 }}><Text style={{ fontWeight: '800', color: '#92400E' }}>Pending faculty registration</Text><Text style={{ color: '#78350F', marginTop: 3 }}>{person.full_name} · {person.school_id}</Text><TouchableOpacity onPress={() => confirmAction(`Approve ${person.full_name}'s faculty registration?`, () => approveFaculty(person))} style={{ backgroundColor: '#D97706', padding: 10, borderRadius: 8, marginTop: 10, alignItems: 'center' }}><Text style={{ color: '#FFF', fontWeight: '700' }}>Approve registration</Text></TouchableOpacity></View>)}
    {faculty.map(person => <View key={person.school_id} style={styles.card}><View style={styles.person}><View style={styles.avatar}><Text style={styles.avatarText}>{person.full_name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.personInfo}><Text style={styles.personName}>{person.full_name}</Text>{person.role === 'it_chair' && <Text style={[styles.personMeta, { color: '#1D4ED8', fontWeight: '700' }]}>IT CHAIR</Text>}<Text style={styles.personMeta}>{person.school_id} · {person.department}</Text><Text style={styles.personMeta}>{person.office_location || 'Office not set'}</Text></View>{isAdmin && <TouchableOpacity onPress={() => setEditing({ ...person })} style={styles.editButton}><Ionicons name="create-outline" size={18} color="#1D4ED8" /></TouchableOpacity>}</View>{isAdmin && <><View style={styles.actions}>{['available', 'busy', 'unavailable'].map(status => <TouchableOpacity key={status} onPress={() => setAvailability(person, status)} style={[styles.pill, person.availability_status === status && (status === 'available' ? styles.pill_available : status === 'busy' ? styles.pill_busy : styles.pill_unavailable)]}><Text style={styles.pillText}>{status}</Text></TouchableOpacity>)}</View><View style={styles.adminActions}><TouchableOpacity onPress={() => confirmAction(person.role === 'it_chair' ? `Remove ${person.full_name} as IT Chair? Their faculty access remains.` : `Assign ${person.full_name} as the IT Chair? The current IT Chair will return to faculty access.`, () => person.role === 'it_chair' ? removeITChair(person) : nominateITChair(person))} style={styles.chairButton}><Text style={styles.chairButtonText}>{person.role === 'it_chair' ? 'Remove IT Chair' : 'Assign IT Chair'}</Text></TouchableOpacity><TouchableOpacity onPress={() => confirmAction(`Delete ${person.full_name}'s faculty account? Live queue data will be removed; completed consultations stay in the records.`, () => deleteFaculty(person))} style={styles.deleteButton}><Text style={styles.deleteButtonText}>Delete account</Text></TouchableOpacity></View></>}</View>)}
  </ScrollView><Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => setEditing(null)}><View style={styles.modalOverlay}><View style={styles.modal}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Edit Faculty Profile</Text><TouchableOpacity onPress={() => setEditing(null)}><Ionicons name="close" size={22} color="#475569" /></TouchableOpacity></View>{editing && <ScrollView><Text style={styles.schoolId}>{editing.school_id}</Text><Field label="Full name" value={editing.full_name} onChangeText={value => setEditing({ ...editing, full_name: value })} /><Field label="Department" value={editing.department} onChangeText={value => setEditing({ ...editing, department: value })} /><Field label="Office location" value={editing.office_location} onChangeText={value => setEditing({ ...editing, office_location: value })} /><Field label="Email" value={editing.email} onChangeText={value => setEditing({ ...editing, email: value })} keyboardType="email-address" /><Field label="Office hours" value={editing.office_hours || ''} onChangeText={value => setEditing({ ...editing, office_hours: value })} /><TouchableOpacity disabled={saving} style={styles.saveButton} onPress={saveProfile}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveButtonText}>Save profile</Text>}</TouchableOpacity></ScrollView>}</View></View></Modal><Modal visible={Boolean(recordView)} transparent animationType="slide" onRequestClose={() => setRecordView(null)}><View style={styles.modalOverlay}><View style={styles.modal}><View style={styles.modalHeader}><Text style={styles.modalTitle}>{recordTitle}</Text><TouchableOpacity onPress={() => setRecordView(null)}><Ionicons name="close" size={22} color="#475569" /></TouchableOpacity></View><ScrollView>{recordView === 'faculty' && faculty.map(person => <TouchableOpacity key={person.school_id} style={styles.recordRow} onPress={() => openFacultyConsultations(person)}><View><Text style={styles.recordName}>{person.full_name}</Text><Text style={styles.recordMeta}>{person.department} · {person.school_id}</Text></View><Text style={styles.total}>{person.total_consultations || 0} consults</Text></TouchableOpacity>)}{recordView === 'students' && students.map(student => <View key={student.student_id} style={styles.recordRow}><View><Text style={styles.recordName}>{student.full_name}</Text><Text style={styles.recordMeta}>{student.student_id} · {student.program || 'Program not set'}</Text></View><Text style={styles.recordMeta}>{student.year_level} {student.section}</Text></View>)}{(recordView === 'today' || recordView === 'facultyConsultations') && consultations.map(item => <View key={item._id} style={styles.recordRow}><View style={styles.recordText}><Text style={styles.recordName}>{item.student_name}</Text><Text style={styles.recordMeta}>{item.topic}</Text><Text style={styles.recordMeta}>{item.date} · {item.time}</Text></View><Text style={styles.total}>{item.status}</Text></View>)}{((recordView === 'students' && !students.length) || ((recordView === 'today' || recordView === 'facultyConsultations') && !consultations.length)) && <Text style={styles.empty}>No records found.</Text>}</ScrollView></View></View></Modal></SafeAreaView>;
}
function Stat({ label, value, icon, color, onPress }: { label: string; value: number; icon: any; color: string; onPress?: () => void }) { const content = <><Ionicons name={icon} size={22} color={color} /><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text>{onPress && <Text style={styles.tapHint}>Tap for records</Text>}</>; return onPress ? <TouchableOpacity style={styles.stat} onPress={onPress}>{content}</TouchableOpacity> : <View style={styles.stat}>{content}</View>; }
function Field({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: any }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} /></View>; }
const styles = StyleSheet.create({ container:{flex:1,backgroundColor:'#F8FAFC'}, content:{padding:20,paddingBottom:40}, loading:{flex:1,alignItems:'center',justifyContent:'center'}, header:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}, eyebrow:{fontSize:11,fontWeight:'700',letterSpacing:1.2,color:'#2563EB'}, title:{fontSize:30,fontWeight:'800',color:'#0F172A',marginTop:3}, subtitle:{fontSize:15,color:'#475569',marginTop:3}, logout:{padding:10,borderRadius:10,backgroundColor:'#FEE2E2'}, sectionTitle:{fontSize:17,fontWeight:'700',color:'#1E293B',marginBottom:12,marginTop:8}, grid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginBottom:18}, stat:{width:'31%',minWidth:100,backgroundColor:'#FFF',borderRadius:14,padding:14,elevation:1,shadowColor:'#64748B',shadowOpacity:.12,shadowRadius:5}, statValue:{fontSize:25,fontWeight:'800',color:'#0F172A',marginTop:8}, statLabel:{fontSize:12,color:'#64748B',marginTop:2}, tapHint:{fontSize:9,color:'#2563EB',fontWeight:'700',marginTop:5}, notice:{flexDirection:'row',gap:10,backgroundColor:'#DBEAFE',borderRadius:12,padding:14,marginBottom:10}, noticeText:{flex:1,fontSize:12,color:'#1E3A8A',lineHeight:18}, credentials:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#1D4ED8',borderRadius:10,padding:12,marginBottom:20}, credentialsText:{color:'#FFFFFF',fontWeight:'700',fontSize:13}, card:{backgroundColor:'#FFF',borderRadius:14,padding:14,marginBottom:10,elevation:1,shadowColor:'#64748B',shadowOpacity:.1,shadowRadius:4}, person:{flexDirection:'row'}, avatar:{width:42,height:42,borderRadius:21,backgroundColor:'#DBEAFE',alignItems:'center',justifyContent:'center',marginRight:11}, avatarText:{fontSize:18,fontWeight:'700',color:'#1D4ED8'}, personInfo:{flex:1}, personName:{fontSize:16,fontWeight:'700',color:'#0F172A'}, personMeta:{fontSize:12,color:'#64748B',marginTop:2}, editButton:{padding:8,backgroundColor:'#DBEAFE',borderRadius:8}, actions:{flexDirection:'row',gap:7,marginTop:12}, adminActions:{flexDirection:'row',gap:8,marginTop:10}, chairButton:{flex:1,backgroundColor:'#DBEAFE',padding:9,borderRadius:8,alignItems:'center'}, chairButtonText:{color:'#1D4ED8',fontSize:11,fontWeight:'700'}, deleteButton:{flex:1,backgroundColor:'#FEE2E2',padding:9,borderRadius:8,alignItems:'center'}, deleteButtonText:{color:'#B91C1C',fontSize:11,fontWeight:'700'}, pill:{paddingVertical:6,paddingHorizontal:9,borderRadius:999,backgroundColor:'#E2E8F0'}, pill_available:{backgroundColor:'#DCFCE7'}, pill_busy:{backgroundColor:'#FEF3C7'}, pill_unavailable:{backgroundColor:'#FEE2E2'}, pillText:{fontSize:11,fontWeight:'600',color:'#334155'}, modalOverlay:{flex:1,backgroundColor:'rgba(15,23,42,.55)',justifyContent:'center',padding:20}, modal:{backgroundColor:'#FFF',borderRadius:16,padding:20,maxHeight:'88%'}, modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}, modalTitle:{fontSize:19,fontWeight:'800',color:'#0F172A'}, schoolId:{fontSize:13,color:'#64748B',marginBottom:10}, field:{marginBottom:12}, fieldLabel:{fontSize:12,fontWeight:'700',color:'#475569',marginBottom:5}, input:{borderWidth:1,borderColor:'#CBD5E1',borderRadius:9,padding:11,fontSize:15,color:'#0F172A'}, saveButton:{backgroundColor:'#1D4ED8',borderRadius:10,padding:14,alignItems:'center',marginTop:5,marginBottom:5}, saveButtonText:{color:'#FFF',fontWeight:'700'}, recordRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#E2E8F0'}, recordText:{flex:1,paddingRight:10}, recordName:{fontSize:15,fontWeight:'700',color:'#0F172A'}, recordMeta:{fontSize:12,color:'#64748B',marginTop:3}, total:{fontSize:12,color:'#1D4ED8',fontWeight:'700'}, empty:{textAlign:'center',color:'#64748B',padding:22} });
