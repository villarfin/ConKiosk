import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ApiClient } from '@/src/utils/api';
import { Pagination } from '@/src/components/Pagination';
import { useAuth } from '@/src/contexts/AuthContext';

type Entry = { _id: string; actor_id: string; action: string; target: string; created_at: string };
export default function AuditScreen() {
  const { faculty } = useAuth();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Entry[]>([]);
  useEffect(() => { if (faculty?.role === 'admin') ApiClient.get(`/admin/audit?limit=100&offset=${page * 100}`).then(setItems).catch(error => Alert.alert('Unable to load audit', error.message)); }, [page, faculty?.role]);
  if (faculty?.role !== 'admin') return <Text>Administrator access required.</Text>;
  return <SafeAreaView style={{ flex: 1, padding: 20, backgroundColor: '#F8FAFC' }}><TouchableOpacity onPress={() => router.back()}><Text>Back</Text></TouchableOpacity><Text style={{ fontSize: 25, fontWeight: '800', marginVertical: 16 }}>Administrative audit log</Text><ScrollView>{items.map(entry => <View key={entry._id} style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 8, marginBottom: 8 }}><Text style={{ fontWeight: '700' }}>{entry.action.replaceAll('_', ' ')}</Text><Text>Target: {entry.target}</Text><Text style={{ fontSize: 11, color: '#64748B' }}>Actor ID: {entry.actor_id}</Text><Text>{new Date(`${entry.created_at}Z`).toLocaleString()}</Text></View>)}</ScrollView><Pagination page={page} count={items.length} onChange={setPage} /></SafeAreaView>;
}
