// Logo personnalisable : l'utilisateur peut uploader sa propre image de logo.
// Le logo est stocké en base64 dans le localStorage du navigateur (clé unique
// pour tout le site), donc il est partagé entre toutes les pages de l'app
// une fois défini depuis n'importe quel écran "éditable".
// ⚠️ Limite : le logo est stocké localement dans CE navigateur uniquement.
// Si vous ouvrez l'app depuis un autre ordinateur/navigateur, il faudra le
// re-uploader une fois. Pour un logo partagé entre tous les utilisateurs,
// il faudrait l'héberger côté serveur (ex: Supabase Storage).

const LOGO_KEY = 'onsport_logo_dataurl';

function getStoredLogo() {
  try { return localStorage.getItem(LOGO_KEY); } catch { return null; }
}

function setStoredLogo(dataUrl) {
  try { localStorage.setItem(LOGO_KEY, dataUrl); } catch { /* ignore */ }
}

function clearStoredLogo() {
  try { localStorage.removeItem(LOGO_KEY); } catch { /* ignore */ }
}

// Reproduit visuellement le logo sur tous les emplacements de la page
// (utile si plusieurs slots sont affichés en même temps, ex: sidebar + mobile).
function broadcastLogoUpdate() {
  document.querySelectorAll('[data-logo-slot="true"]').forEach(el => {
    const size = Number(el.dataset.logoSize) || 34;
    const editable = el.dataset.logoEditable === 'true';
    paintLogo(el, size, editable);
  });
}

function triggerUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setStoredLogo(reader.result);
      broadcastLogoUpdate();
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

function paintLogo(el, size, editable) {
  const stored = getStoredLogo();
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'kg-logo';

  if (stored) {
    const img = document.createElement('img');
    img.src = stored;
    img.alt = 'Logo';
    img.style.height = size + 'px';
    img.style.maxWidth = (size * 5) + 'px';
    img.style.width = 'auto';
    img.style.objectFit = 'contain';
    wrap.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'kg-logo-placeholder';
    placeholder.style.width = size + 'px';
    placeholder.style.height = size + 'px';
    placeholder.textContent = 'Logo';
    wrap.appendChild(placeholder);
  }

  if (editable) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kg-logo-edit-btn';
    btn.textContent = stored ? 'Changer le logo' : '+ Ajouter un logo';
    btn.addEventListener('click', (e) => { e.preventDefault(); triggerUpload(); });
    wrap.appendChild(btn);

    if (stored) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'kg-logo-remove-btn';
      removeBtn.textContent = '×';
      removeBtn.title = 'Retirer le logo';
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        clearStoredLogo();
        broadcastLogoUpdate();
      });
      wrap.appendChild(removeBtn);
    }
  }

  el.appendChild(wrap);
}

// options.editable = true affiche un bouton d'upload (à activer seulement
// sur les écrans où l'admin doit pouvoir changer le logo).
export function renderLogo(el, { size = 34, editable = false } = {}) {
  el.dataset.logoSlot = 'true';
  el.dataset.logoSize = String(size);
  el.dataset.logoEditable = editable ? 'true' : 'false';
  paintLogo(el, size, editable);
}
