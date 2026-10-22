import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  visible: boolean;
  onKey: (key: string) => void;
  onClose: () => void;
};

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export default function KioskTouchKeyboard({ visible, onKey, onClose }: Props) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop} pointerEvents="box-none">
      <View style={styles.keyboard} accessibilityViewIsModal accessibilityLabel="On-screen keyboard">
        {ROWS.map((row) => <View key={row} style={styles.row}>{row.split('').map((key) => <TouchableOpacity key={key} style={styles.key} onPress={() => onKey(key)}><Text style={styles.keyText}>{key}</Text></TouchableOpacity>)}</View>)}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.key, styles.actionKey]} onPress={() => onKey('BACKSPACE')}><Text style={styles.keyText}>⌫</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.key, styles.spaceKey]} onPress={() => onKey(' ')}><Text style={styles.keyText}>Space</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.key, styles.actionKey]} onPress={() => onKey('CLEAR')}><Text style={styles.keyText}>Clear</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.key, styles.doneKey]} onPress={onClose}><Text style={styles.doneText}>Done</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,.2)' },
  keyboard: { backgroundColor: '#0F2747', padding: 10, gap: 7, borderTopWidth: 3, borderTopColor: '#D6B45F' },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  key: { minWidth: 35, flex: 1, maxWidth: 72, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: '#FFFFFF' },
  keyText: { fontSize: 17, fontWeight: '800', color: '#0F2747' },
  actionKey: { backgroundColor: '#D6B45F' },
  spaceKey: { flex: 3, maxWidth: 260 },
  doneKey: { backgroundColor: '#16A34A' },
  doneText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
