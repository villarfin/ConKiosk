import { Stack } from 'expo-router';

export default function KioskLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
  );
}
