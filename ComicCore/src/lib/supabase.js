import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const SUPABASE_URL = 'https://mmycqeejhguzhtzkyjaj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1teWNxZWVqaGd1emh0emt5amFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NDczMTEsImV4cCI6MjA4NjUyMzMxMX0.w7sXdrVWcsE_sV-dOP2EIGNK89iPkT72LV2LwNjK8yM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInEnv: false,
  },
});