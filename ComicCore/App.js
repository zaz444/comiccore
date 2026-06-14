import { useEffect, useState, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './src/lib/supabase';
import LoginScreen          from './src/screens/LoginScreen';
import ReaderScreen         from './src/screens/ReaderScreen';
import HomeScreen           from './src/screens/HomeScreen';
import DiscoverScreen       from './src/screens/DiscoverScreen';
import ProfileScreen        from './src/screens/ProfileScreen';
import SettingsScreen       from './src/screens/SettingsScreen';
import MyComicsScreen       from './src/screens/MyComicsScreen';
import ReportsScreen        from './src/screens/ReportsScreen';
import CreateScreen         from './src/screens/CreateScreen';
import ToonScrollScreen     from './src/screens/ToonScrollScreen';
import ForgotPasswordScreen from './src/screens/ForgotpasswordScreen';
import SquadsScreen            from './src/screens/SquadScreen';
import SquadChatScreen         from './src/screens/SquadchatScreen';
import StoryCreateScreen       from './src/screens/StoryCreateScreen';
import FavoritesScreen         from './src/screens/FavoritesScreen';
import BackgroundPickerScreen  from './src/screens/BackgroundPickerScreen';
import SpriteGalleryScreen     from './src/screens/SpriteGalleryScreen';
import EffectPickerScreen      from './src/screens/EffectPickerScreen';
import AudioPickerScreen       from './src/screens/AudioPickerScreen';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const GREEN = '#1DB954';

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#111',
          borderTopColor: '#1a1a1a',
          borderTopWidth: 1,
          paddingBottom: 4,
          height: 56,
        },
        tabBarActiveTintColor:   GREEN,
        tabBarInactiveTintColor: '#444',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Create"
        component={CreateScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="MyProfile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const navRef = useRef(null);

  // ── Deep link handler ─────────────────────────────────────────────────────
  // Supabase recovery link: comiccore://reset-password#type=recovery&access_token=...
  // OAuth callback:         comiccore://auth/callback#access_token=...
  async function handleDeepLink(url) {
    if (!url) return;

    const hash   = url.includes('#') ? url.split('#')[1] : '';
    const query  = url.includes('?') && !url.includes('#') ? url.split('?')[1] : '';
    const params = new URLSearchParams(hash || query);
    const type   = params.get('type');

    if (type === 'recovery') {
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken) {
        const { error } = await supabase.auth.setSession({
          access_token:  accessToken,
          refresh_token: refreshToken || '',
        });
        if (!error) {
          navRef.current?.navigate('ForgotPassword', { resetMode: true });
        }
      }
      return;
    }

    // OAuth callback — access_token without type=recovery
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken) {
      await supabase.auth.setSession({
        access_token:  accessToken,
        refresh_token: refreshToken || '',
      });
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // Handle deep links — both cold start and while-running
    Linking.getInitialURL().then(url => { if (url) handleDeepLink(url); });
    const linkSub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

    return () => {
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  if (session === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <>
            <Stack.Screen name="HomeTabs"       component={HomeTabs} />
            <Stack.Screen name="Reader"         component={ReaderScreen} />
            <Stack.Screen name="Profile"        component={ProfileScreen} />
            <Stack.Screen name="Settings"       component={SettingsScreen} />
            <Stack.Screen name="MyComics"       component={MyComicsScreen} />
            <Stack.Screen name="Reports"        component={ReportsScreen} />
            <Stack.Screen name="ToonScroll"     component={ToonScrollScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="Squads"             component={SquadsScreen} />
            <Stack.Screen name="SquadChat"          component={SquadChatScreen} />
            <Stack.Screen name="StoryCreate"        component={StoryCreateScreen} />
            <Stack.Screen name="Favorites"          component={FavoritesScreen} />
            <Stack.Screen name="BackgroundPicker"   component={BackgroundPickerScreen} />
            <Stack.Screen name="SpriteGallery"      component={SpriteGalleryScreen} />
            <Stack.Screen name="EffectPicker"       component={EffectPickerScreen} />
            <Stack.Screen name="AudioPicker"        component={AudioPickerScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login"          component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}