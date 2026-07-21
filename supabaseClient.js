// =====================================================================
// ON'SPORT — Client Supabase
// =====================================================================
// ⚠️ Remplacez les deux valeurs ci-dessous par celles de votre projet
// Supabase : Dashboard > Project Settings > API.
// L'anon key est publique par design (elle est protégée par les
// politiques RLS côté base de données) — elle peut être commitée
// dans un dépôt GitHub Pages public.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://icgtxvwpjpmtfoqumizy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ3R4dndwanBtdGZvcXVtaXp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NDkzNDEsImV4cCI6MjA5OTAyNTM0MX0.NPXcKDmO4UzkfKkieuNPTqG9As2hI5KAxOcirGvTxBc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Client "jetable" : utilisé uniquement pour créer un compte (auth.signUp)
// depuis l'interface admin (ex. création directe d'un compte coach) sans
// écraser la session actuellement connectée (persistSession: false =>
// n'écrit rien dans le localStorage partagé par le client principal).
export function createAuxClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
