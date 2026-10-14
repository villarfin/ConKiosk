import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type ActionDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
};

/** A consistent, accessible confirmation surface for actions that change data. */
export function ActionDialog({ visible, title, message, confirmLabel, destructive, busy, confirmDisabled, error, onConfirm, onCancel, children }: ActionDialogProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.overlay} accessibilityViewIsModal accessibilityLabel={title}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {children}
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel" disabled={busy} style={styles.cancel} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              disabled={busy || confirmDisabled}
              style={[styles.confirm, destructive && styles.destructive, (busy || confirmDisabled) && styles.disabled]}
              onPress={onConfirm}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15, 23, 42, 0.58)', padding: 20 },
  dialog: { width: '100%', maxWidth: 460, borderRadius: 16, backgroundColor: '#FFFFFF', padding: 20, shadowColor: '#0F172A', shadowOpacity: 0.25, shadowRadius: 18, elevation: 8 },
  title: { color: '#0F172A', fontSize: 19, fontWeight: '800', marginBottom: 8 },
  message: { color: '#475569', fontSize: 14, lineHeight: 20 },
  error: { color: '#B91C1C', fontSize: 13, fontWeight: '600', lineHeight: 18, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancel: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#E2E8F0' },
  cancelText: { color: '#334155', fontWeight: '700' },
  confirm: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#1D4ED8' },
  destructive: { backgroundColor: '#B91C1C' },
  disabled: { opacity: 0.5 },
  confirmText: { color: '#FFFFFF', fontWeight: '800' },
});
