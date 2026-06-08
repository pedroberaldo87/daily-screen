(async function init() {
  try {
    const settings = await fetch('/api/settings').then(r => r.json());
    if (typeof initI18n === 'function') await initI18n(settings);
    if (typeof applyTranslations === 'function') applyTranslations();
  } catch (err) {
    console.error('i18n init failed:', err);
  }
  await loadTokens();
})();

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  const locale = (typeof getLocale === 'function' ? getLocale() : null) || 'pt-BR';
  return d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function tt(key, fallback) {
  return (typeof t === 'function') ? t(key, fallback) : fallback;
}

async function loadTokens() {
  const list = document.getElementById('token-list');
  try {
    const res = await fetch('/admin/api/tokens');
    if (!res.ok) throw new Error('Failed to load tokens');
    const tokens = await res.json();
    renderTokens(tokens);
  } catch (err) {
    list.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

function renderTokens(tokens) {
  const list = document.getElementById('token-list');
  if (!tokens.length) {
    list.innerHTML = `<div class="empty-state">${tt('tokens.empty', 'Nenhum token ainda. Crie um para começar.')}</div>`;
    return;
  }

  list.innerHTML = tokens.map(tok => {
    const now = new Date();
    const isRevoked = !!tok.revoked_at;
    const isExpired = tok.expires_at && new Date(tok.expires_at.replace(' ', 'T') + 'Z') <= now;

    let badge;
    if (isRevoked) {
      badge = `<span class="badge badge-revoked">${tt('tokens.revoked', 'Revogado')}</span>`;
    } else if (isExpired) {
      badge = `<span class="badge badge-expired">${tt('tokens.expired', 'Expirado')}</span>`;
    } else {
      badge = `<span class="badge badge-active">${tt('tokens.active', 'Ativo')}</span>`;
    }

    const actions = isRevoked
      ? `<button class="btn btn-danger btn-sm" onclick="deleteToken(${tok.id})">${tt('tokens.delete', 'Deletar')}</button>`
      : `<button class="btn btn-danger btn-sm" onclick="revokeToken(${tok.id})">${tt('tokens.revoke', 'Revogar')}</button>`;

    return `
      <div class="token-row${isRevoked || isExpired ? ' revoked' : ''}">
        <div class="token-info">
          <div class="name">${esc(tok.name)} ${badge}</div>
          <div class="prefix">${esc(tok.token_prefix)}…</div>
          <div class="meta">
            <strong>${tt('tokens.created', 'Criado')}:</strong> ${formatDate(tok.created_at)}
            &nbsp;·&nbsp;
            <strong>${tt('tokens.lastUsed', 'Último uso')}:</strong> ${formatDate(tok.last_used_at)}
            ${tok.expires_at ? `&nbsp;·&nbsp;<strong>${tt('tokens.expires', 'Expira')}:</strong> ${formatDate(tok.expires_at)}` : ''}
          </div>
        </div>
        <div class="token-actions">${actions}</div>
      </div>
    `;
  }).join('');
}

function openCreateModal() {
  document.getElementById('token-name').value = '';
  document.getElementById('token-expires').value = '';
  document.getElementById('create-modal').classList.add('active');
  setTimeout(() => document.getElementById('token-name').focus(), 50);
}

function closeCreateModal() {
  document.getElementById('create-modal').classList.remove('active');
}

async function submitCreate() {
  const name = document.getElementById('token-name').value.trim();
  const expiresInput = document.getElementById('token-expires').value;

  if (!name) {
    toast(tt('tokens.nameRequired', 'Nome é obrigatório'), 'error');
    return;
  }

  const body = { name };
  if (expiresInput) {
    body.expires_at = new Date(expiresInput).toISOString();
  }

  try {
    const res = await fetch('/admin/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Error', 'error');
      return;
    }
    closeCreateModal();
    showPlaintext(data.plaintext);
    await loadTokens();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showPlaintext(plaintext) {
  document.getElementById('plaintext-value').textContent = plaintext;
  document.getElementById('reveal-modal').classList.add('active');
}

function closeRevealModal() {
  document.getElementById('plaintext-value').textContent = '';
  document.getElementById('reveal-modal').classList.remove('active');
}

async function copyToken() {
  const text = document.getElementById('plaintext-value').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast(tt('tokens.copied', 'Copiado!'));
  } catch {
    toast(tt('tokens.copyFailed', 'Falha ao copiar. Selecione e copie manualmente.'), 'error');
  }
}

async function revokeToken(id) {
  if (!confirm(tt('tokens.confirmRevoke', 'Revogar este token? Ele parará de funcionar imediatamente.'))) return;
  try {
    const res = await fetch(`/admin/api/tokens/${id}/revoke`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      toast(data.error || 'Error', 'error');
      return;
    }
    toast(tt('tokens.revokedOk', 'Token revogado'));
    await loadTokens();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteToken(id) {
  if (!confirm(tt('tokens.confirmDelete', 'Deletar permanentemente este token do banco?'))) return;
  try {
    const res = await fetch(`/admin/api/tokens/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      toast(data.error || 'Error', 'error');
      return;
    }
    toast(tt('tokens.deletedOk', 'Token deletado'));
    await loadTokens();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = kind === 'error' ? 'var(--accent-danger)' : 'var(--accent-success)';
  el.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('visible'), 2500);
}

// Close modals on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCreateModal();
  }
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (overlay.id === 'create-modal') closeCreateModal();
    }
    // Reveal modal: require explicit click on "Pronto" to close (prevents accidental dismiss)
  });
});
