import { useFonts } from 'expo-font';

// Bundle the font with Metro/web exports. No CDN or internet is needed.
export const useIconFonts = () => useFonts({
  ionicons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'),
});
