import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://edfnhhthztskuuosuasw.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkZm5oaHRoenRza3V1b3N1YXN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk5OTYxMTYsImV4cCI6MjA2NTU3MjExNn0.O3g2gjvsWagmWgmzoeJA8mPampvLYJr-KgqVwXsKoAo';
export const WHATSAPP_NUMBER = '60162327792';
export const ADMIN_PASSWORD = 'fengweipaiadmin';
export const SELF_PICKUP_ADDRESS = `667, Jalan 24, Taman Perindustrian Ehsan Jaya, Kepong, 52100, Kuala Lumpur.`;
export const PRODUCT_IMAGE_BASE_URL = 'https://edfnhhthztskuuosuasw.supabase.co/storage/v1/object/public/product-photos/';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
