import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
export function Pagination({ page, count, onChange }: { page: number; count: number; onChange: (page: number) => void }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, gap: 12 }}><TouchableOpacity accessibilityRole="button" disabled={page === 0} onPress={() => onChange(page - 1)}><Text style={{ color: page === 0 ? '#94A3B8' : '#1D4ED8' }}>Previous</Text></TouchableOpacity><Text style={{ color: '#475569' }}>Page {page + 1}</Text><TouchableOpacity accessibilityRole="button" disabled={count < 100} onPress={() => onChange(page + 1)}><Text style={{ color: count < 100 ? '#94A3B8' : '#1D4ED8' }}>Next</Text></TouchableOpacity></View>;
}
