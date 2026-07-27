const rowsEl = document.getElementById('rows');
const messageEl = document.getElementById('message');
const form = document.getElementById('create-form');

function setMessage(text, kind) {
  messageEl.textContent = text;
  messageEl.className = kind || '';
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

async function loadUrls() {
  const res = await fetch('/api/urls?limit=50&includeInactive=true');
  const data = await res.json();
  rowsEl.innerHTML = '';
  for (const item of data.items) {
    const tr = document.createElement('tr');
    if (!item.isActive) tr.classList.add('inactive');
    tr.innerHTML = `
      <td><a href="${item.shortUrl}" target="_blank" rel="noopener">${item.code}</a></td>
      <td title="${item.longUrl}">${item.longUrl.length > 50 ? item.longUrl.slice(0, 50) + '…' : item.longUrl}</td>
      <td>${fmtDate(item.createdAt)}</td>
      <td>${fmtDate(item.expiresAt)}</td>
      <td class="actions">
        <button class="secondary" data-action="stats" data-code="${item.code}">Stats</button>
        <button class="danger" data-action="delete" data-code="${item.code}" ${item.isActive ? '' : 'disabled'}>Delete</button>
      </td>`;
    rowsEl.appendChild(tr);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const body = { url: fd.get('url') };
  if (fd.get('customAlias')) body.customAlias = fd.get('customAlias');
  if (fd.get('expiresAt')) body.expiresAt = new Date(fd.get('expiresAt')).toISOString();

  const res = await fetch('/api/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (res.ok) {
    setMessage(`Created ${data.shortUrl}`, 'ok');
    form.reset();
    await loadUrls();
  } else {
    setMessage(data.error?.message || `Request failed (${res.status})`, 'error');
  }
});

rowsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const code = btn.dataset.code;

  if (btn.dataset.action === 'delete') {
    const res = await fetch(`/api/urls/${code}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      setMessage(`Deleted ${code}`, 'ok');
      await loadUrls();
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error?.message || `Delete failed (${res.status})`, 'error');
    }
    return;
  }

  if (btn.dataset.action === 'stats') {
    const existing = btn.closest('td').querySelector('.stats-box');
    if (existing) { existing.remove(); return; }
    const res = await fetch(`/api/urls/${code}/stats`);
    const data = await res.json();
    const box = document.createElement('div');
    box.className = 'stats-box';
    box.textContent = res.ok
      ? `Total clicks: ${data.totalClicks}\nRecent: ${JSON.stringify(data.recentEvents, null, 2)}`
      : (data.error?.message || `Failed (${res.status})`);
    btn.closest('td').appendChild(box);
  }
});

loadUrls().catch((err) => setMessage(String(err), 'error'));
