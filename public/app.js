const rowsEl = document.getElementById('rows');
const messageEl = document.getElementById('message');
const form = document.getElementById('create-form');
const emptyEl = document.getElementById('empty');
const loadingEl = document.getElementById('loading');
const toggleInactive = document.getElementById('toggle-inactive');
const statTotal = document.getElementById('stat-total');
const statActive = document.getElementById('stat-active');
const statClicks = document.getElementById('stat-clicks');

// Long URLs are only checked for a valid http(s) scheme server-side, not sanitized --
// and click referrer/user-agent are raw, attacker-controllable request headers. Both are
// rendered into innerHTML below, so they must be escaped here to avoid stored XSS.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setMessage(text, kind) {
  messageEl.textContent = text;
  messageEl.className = 'banner' + (kind ? ` ${kind}` : '');
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function fmtRelative(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function statusOf(item) {
  if (!item.isActive) return { label: 'Deleted', cls: 'deleted' };
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) return { label: 'Expired', cls: 'expired' };
  return { label: 'Active', cls: 'active' };
}

async function fetchStats(code) {
  try {
    const res = await fetch(`/api/urls/${code}/stats`);
    if (!res.ok) return { totalClicks: 0, recentEvents: [] };
    return await res.json();
  } catch {
    return { totalClicks: 0, recentEvents: [] };
  }
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1200);
  } catch {
    setMessage('Could not copy to clipboard', 'error');
  }
}

async function loadUrls() {
  loadingEl.hidden = false;
  emptyEl.hidden = true;
  rowsEl.innerHTML = '';

  const includeInactive = toggleInactive.checked;
  const res = await fetch(`/api/urls?limit=100&includeInactive=${includeInactive}`);
  const data = await res.json();
  const items = data.items || [];

  const statsList = await Promise.all(items.map((item) => fetchStats(item.code)));
  const statsByCode = Object.fromEntries(items.map((item, i) => [item.code, statsList[i]]));

  loadingEl.hidden = true;

  if (items.length === 0) {
    emptyEl.hidden = false;
  }

  let activeCount = 0;
  let totalClicks = 0;

  for (const item of items) {
    const stats = statsByCode[item.code] || { totalClicks: 0, recentEvents: [] };
    const status = statusOf(item);
    if (status.label === 'Active') activeCount += 1;
    totalClicks += stats.totalClicks;

    const code = escapeHtml(item.code);
    const shortUrl = escapeHtml(item.shortUrl);
    const longUrl = escapeHtml(item.longUrl);
    const longUrlDisplay = item.longUrl.length > 45 ? longUrl.slice(0, 45) + '…' : longUrl;

    const tr = document.createElement('tr');
    if (!item.isActive) tr.classList.add('inactive');
    tr.innerHTML = `
      <td><a class="code-link" href="${shortUrl}" target="_blank" rel="noopener">${code}</a></td>
      <td class="long-url" title="${longUrl}">${longUrlDisplay}</td>
      <td><span class="badge ${status.cls}">${status.label}</span></td>
      <td>${stats.totalClicks}</td>
      <td title="${fmtDate(item.createdAt)}">${fmtRelative(item.createdAt)}</td>
      <td class="actions">
        <button class="btn secondary icon" data-action="copy" data-url="${shortUrl}" title="Copy short link">📋</button>
        <button class="btn secondary icon" data-action="details" data-code="${code}" title="View click details">📊</button>
        <button class="btn danger-outline icon" data-action="delete" data-code="${code}" title="Delete" ${item.isActive ? '' : 'disabled'}>🗑️</button>
      </td>`;
    rowsEl.appendChild(tr);
  }

  statTotal.textContent = data.total ?? items.length;
  statActive.textContent = activeCount;
  statClicks.textContent = totalClicks;
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

toggleInactive.addEventListener('change', () => loadUrls());

rowsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  if (btn.dataset.action === 'copy') {
    await copyToClipboard(btn.dataset.url, btn);
    return;
  }

  if (btn.dataset.action === 'delete') {
    const code = btn.dataset.code;
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

  if (btn.dataset.action === 'details') {
    const row = btn.closest('tr');
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains('details-row')) {
      existing.remove();
      return;
    }
    // Close any other open details rows first.
    document.querySelectorAll('.details-row').forEach((el) => el.remove());

    const stats = await fetchStats(btn.dataset.code);
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'details-row';
    const cellCount = row.children.length;
    const events = stats.recentEvents || [];
    detailsRow.innerHTML = `<td colspan="${cellCount}">
      <div class="details-box">
        ${events.length === 0
          ? '<span class="muted">No clicks recorded yet.</span>'
          : events.map((ev) => `
            <div class="event">
              ${fmtDate(ev.occurredAt)}
              <span class="event-meta"> · ${escapeHtml(ev.referrer || 'direct')} · ${escapeHtml(ev.userAgent || 'unknown client')}</span>
            </div>`).join('')}
      </div>
    </td>`;
    row.after(detailsRow);
  }
});

loadUrls().catch((err) => setMessage(String(err), 'error'));
