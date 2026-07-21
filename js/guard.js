import { supabase } from './supabaseClient.js';

// Vérifie la session et le rôle requis. Redirige vers index.html sinon.
// Retourne { session, profile } si tout est valide.
export async function requireRole(requiredRoles) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }

  const { data: profile, error } = await supabase
    .from('app_users')
    .select('user_id, first_name, last_name, role, is_active')
    .eq('user_id', session.user.id)
    .single();

  if (error || !profile || !profile.is_active) {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
    return null;
  }

  if (!requiredRoles.includes(profile.role)) {
    // Rôle valide mais mauvaise page : renvoyer vers son propre espace
    window.location.href = profile.role === 'admin' ? 'admin.html' : 'coach.html';
    return null;
  }

  return { session, profile };
}

export async function signOutAndRedirect() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}
