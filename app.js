// ═══════════════════════════════════════════════════════════
// HEXAGONE ÉLEVAGES CRM — app.js
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_KEY = CONFIG.SUPABASE_KEY;
const MAPBOX_TOKEN = CONFIG.MAPBOX_TOKEN;
const PAGE_SIZE = 50;

// ── STATE ──
let allElevages = [];
let crmCache = {};        // {id: {status, notes, actions, assigned_to, ...}}
let filteredList = [];
let renderedCount = 0;
let currentView = 'list';
let filterMyLeads = false;
let currentUser = 'JB';   // Simple pour l'instant
let mapInstance = null;
let mapMarkers = [];
let openDetailId = null;

const STATUTS = {
  nouveau:   { label: 'Nouveau',         color: '#ccc',    badge: 'badge-nouveau' },
  email:     { label: '📧 Email envoyé', color: '#60a5fa', badge: 'badge-email' },
  appel:     { label: '📞 Appelé',       color: '#ab47bc', badge: 'badge-appel' },
  repondu:   { label: '💬 Répondu',      color: '#26a69a', badge: 'badge-repondu' },
  interesse: { label: '⭐ Intéressé',    color: '#66bb6a', badge: 'badge-interesse' },
  rdv:       { label: '📅 RDV pris',     color: '#ffa726', badge: 'badge-rdv' },
  refuse:    { label: '❌ Refus',        color: '#ef5350', badge: 'badge-refuse' },
  gagne:     { label: '✅ Gagné',        color: '#4caf50', badge: 'badge-gagne' }
};

const NAF_LABELS = {
  '01.41Z': '🐄 Vaches laitières',
  '01.42Z': '🐄 Autres bovins',
  '01.43Z': '🐴 Équidés',
  '01.45Z': '🐑 Ovins/caprins',
  '01.46Z': '🐷 Porcins',
  '01.47Z': '🐔 Volailles',
  '01.49Z': '🐴 Autres animaux',
  '01.50Z': '🌾 Culture & élevage',
};

// ═══════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...opts.headers
  };
  const resp = await fetch(url, { ...opts, headers });
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`);
  return opts.method === 'PATCH' || opts.method === 'DELETE' ? null : resp.json();
}

// ═══════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════

async function loadAllData() {
  const fill = document.getElementById('loadingFill');
  const text = document.getElementById('loadingText');

  // 1. Charger les élevages (paginé)
  text.textContent = 'Chargement des élevages...';
  fill.style.width = '10%';
  
  let offset = 0;
  const limit = 1000;
  allElevages = [];
  
  while (true) {
    const batch = await sbFetch(`elevages?select=*&order=id&offset=${offset}&limit=${limit}`);
    if (!batch.length) break;
    allElevages.push(...batch);
    offset += limit;
    const pct = Math.min(60, 10 + (allElevages.length / 8200) * 50);
    fill.style.width = pct + '%';
    text.textContent = `${allElevages.length} élevages chargés...`;
  }

  // 2. Charger le CRM
  text.textContent = 'Chargement des données CRM...';
  fill.style.width = '65%';
  
  offset = 0;
  while (true) {
    const batch = await sbFetch(`crm_elevages?select=*&offset=${offset}&limit=${limit}`);
    if (!batch.length) break;
    batch.forEach(c => { crmCache[c.id] = c; });
    offset += limit;
  }

  fill.style.width = '90%';
  text.textContent = 'Initialisation...';

  // 3. Remplir le filtre département
  const depts = [...new Set(allElevages.map(e => e.departement).filter(Boolean))].sort();
  const deptSelect = document.getElementById('deptFilter');
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    deptSelect.appendChild(opt);
  });

  fill.style.width = '100%';
  text.textContent = `${allElevages.length} élevages prêts`;

  setTimeout(() => {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('totalCount').textContent = `${allElevages.length} élevages`;
    applyFilters();
  }, 300);
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════

function applyFilters() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const dept = document.getElementById('deptFilter').value;
  const naf = document.getElementById('nafFilter').value;
  const status = document.getElementById('statusFilter').value;

  filteredList = allElevages.filter(e => {
    if (search) {
      const haystack = [e.nom, e.ville, e.email, e.siret, e.dirigeant, e.adresse].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (dept && e.departement !== dept) return false;
    if (naf && e.naf !== naf) return false;
    if (status) {
      const crm = crmCache[e.id];
      const s = crm ? crm.status : 'nouveau';
      if (s !== status) return false;
    }
    if (filterMyLeads) {
      const crm = crmCache[e.id];
      if (!crm || crm.assigned_to !== currentUser) return false;
    }
    return true;
  });

  document.getElementById('filterCount').textContent = `${filteredList.length} / ${allElevages.length}`;
  updateStatsBar();

  if (currentView === 'list') renderList();
  else if (currentView === 'kanban') renderKanban();
  else if (currentView === 'map') renderMap();
}

function toggleMyLeads() {
  filterMyLeads = !filterMyLeads;
  document.getElementById('btnMyLeads').classList.toggle('active', filterMyLeads);
  applyFilters();
}

// ═══════════════════════════════════════════════════════════
// STATS BAR
// ═══════════════════════════════════════════════════════════

function updateStatsBar() {
  const bar = document.getElementById('statsBar');
  const counts = {};
  filteredList.forEach(e => {
    const crm = crmCache[e.id];
    const s = crm ? crm.status : 'nouveau';
    counts[s] = (counts[s] || 0) + 1;
  });

  bar.innerHTML = Object.entries(STATUTS).map(([key, {label}]) => {
    const c = counts[key] || 0;
    return `<div class="stat-pill" style="cursor:pointer" onclick="document.getElementById('statusFilter').value='${key}';applyFilters()">
      <span class="num">${c}</span> ${label}
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════════════════════

function switchView(view) {
  currentView = view;
  ['list', 'kanban', 'map'].forEach(v => {
    document.getElementById(v + 'View').style.display = v === view ? '' : 'none';
    document.getElementById('btn' + v.charAt(0).toUpperCase() + v.slice(1)).classList.toggle('active', v === view);
  });
  applyFilters();
}

// ═══════════════════════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════════════════════

function renderList() {
  const container = document.getElementById('cardsContainer');
  renderedCount = 0;
  container.innerHTML = '';
  renderMoreCards();
}

function renderMoreCards() {
  const container = document.getElementById('cardsContainer');
  const end = Math.min(renderedCount + PAGE_SIZE, filteredList.length);

  for (let i = renderedCount; i < end; i++) {
    const e = filteredList[i];
    const crm = crmCache[e.id] || {};
    const status = crm.status || 'nouveau';
    const statut = STATUTS[status] || STATUTS.nouveau;
    const nafLabel = NAF_LABELS[e.naf] || e.naf || '';

    const card = document.createElement('div');
    card.className = 'card';
    card.onclick = () => openDetail(e.id);
    card.innerHTML = `
      <div>
        <div class="card-name">${e.nom}</div>
        <div class="card-meta">${e.ville || ''} ${e.departement ? '(' + e.departement + ')' : ''}</div>
        <div class="card-meta">${e.dirigeant ? '👤 ' + e.dirigeant : ''}</div>
      </div>
      <div>
        <div class="card-meta">${e.email ? '<a href="mailto:' + e.email + '" onclick="event.stopPropagation()">' + e.email + '</a>' : ''}</div>
        <div class="card-meta">${e.telephone ? '<a href="tel:' + e.telephone + '" onclick="event.stopPropagation()">📞 ' + e.telephone + '</a>' : ''}</div>
        <div style="margin-top:4px">${nafLabel ? '<span class="naf-badge">' + nafLabel + '</span>' : ''}</div>
      </div>
      <div class="card-right">
        <span class="badge ${statut.badge}">${statut.label}</span>
        ${crm.assigned_to ? '<span style="font-size:11px;color:var(--text-3)">👤 ' + crm.assigned_to + '</span>' : ''}
      </div>
    `;
    container.appendChild(card);
  }
  renderedCount = end;

  // Bouton "charger plus"
  const existing = document.getElementById('loadMoreBtn');
  if (existing) existing.remove();
  if (renderedCount < filteredList.length) {
    const btn = document.createElement('button');
    btn.id = 'loadMoreBtn';
    btn.className = 'topbar-btn';
    btn.style.cssText = 'margin: 16px auto; display: block;';
    btn.textContent = `Charger plus (${filteredList.length - renderedCount} restants)`;
    btn.onclick = renderMoreCards;
    container.appendChild(btn);
  }
}

// ═══════════════════════════════════════════════════════════
// KANBAN VIEW
// ═══════════════════════════════════════════════════════════

function renderKanban() {
  const container = document.getElementById('kanbanContainer');
  const byStatus = {};
  Object.keys(STATUTS).forEach(s => { byStatus[s] = []; });

  filteredList.forEach(e => {
    const crm = crmCache[e.id] || {};
    const s = crm.status || 'nouveau';
    if (byStatus[s]) byStatus[s].push(e);
  });

  container.innerHTML = Object.entries(STATUTS).map(([key, {label, color}]) => {
    const items = byStatus[key] || [];
    const cards = items.slice(0, 50).map(e => `
      <div class="kanban-card" onclick="openDetail(${e.id})">
        <div class="kanban-card-name">${e.nom}</div>
        <div class="kanban-card-meta">${e.ville || ''} ${e.departement ? '(' + e.departement + ')' : ''}</div>
        <div class="kanban-card-meta">${e.email || ''}</div>
      </div>
    `).join('');

    return `<div class="kanban-col">
      <div class="kanban-col-header" style="border-color: ${color}">
        ${label} <span class="kanban-col-count">${items.length}</span>
      </div>
      <div class="kanban-col-body">${cards}${items.length > 50 ? '<div style="text-align:center;font-size:11px;color:var(--text-3);padding:8px">+' + (items.length - 50) + ' de plus</div>' : ''}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// MAP VIEW
// ═══════════════════════════════════════════════════════════

function renderMap() {
  if (!mapInstance) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    mapInstance = new mapboxgl.Map({
      container: 'mapContainer',
      style: 'mapbox://styles/mapbox/light-v11',
      center: [2.5, 46.5],
      zoom: 5.5
    });
    mapInstance.addControl(new mapboxgl.NavigationControl());
  }

  // Supprimer les anciens marqueurs
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  // Ajouter des marqueurs pour les élevages avec coordonnées
  // On utilise le géocodage par CP pour les élevages sans coordonnées (limité aux premiers 500)
  const withCoords = filteredList.filter(e => e.latitude && e.longitude).slice(0, 2000);
  
  // Si peu de résultats avec coords, on affiche un message
  if (withCoords.length === 0) {
    // Pas de coords — on pourrait géocoder par CP mais c'est lourd
    return;
  }

  const bounds = new mapboxgl.LngLatBounds();
  
  withCoords.forEach(e => {
    const crm = crmCache[e.id] || {};
    const status = crm.status || 'nouveau';
    const color = STATUTS[status]?.color || '#ccc';

    const el = document.createElement('div');
    el.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;`;

    const marker = new mapboxgl.Marker(el)
      .setLngLat([e.longitude, e.latitude])
      .setPopup(new mapboxgl.Popup({ offset: 10 }).setHTML(
        `<b>${e.nom}</b><br>${e.ville}<br>${e.email || ''}<br><a href="#" onclick="openDetail(${e.id});return false;">Ouvrir</a>`
      ))
      .addTo(mapInstance);

    mapMarkers.push(marker);
    bounds.extend([e.longitude, e.latitude]);
  });

  if (withCoords.length > 1) {
    mapInstance.fitBounds(bounds, { padding: 60 });
  }
}

// ═══════════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════════

function openDetail(id) {
  openDetailId = id;
  const e = allElevages.find(x => x.id === id);
  if (!e) return;
  
  const crm = crmCache[e.id] || {};
  const panel = document.getElementById('detailPanel');
  
  document.getElementById('detailName').textContent = e.nom;
  document.getElementById('detailLocation').textContent = `${e.ville || ''} ${e.departement ? '(' + e.departement + ')' : ''}`;

  const nafLabel = NAF_LABELS[e.naf] || e.naf || 'Non renseigné';
  const statusOptions = Object.entries(STATUTS).map(([k, v]) =>
    `<option value="${k}" ${(crm.status || 'nouveau') === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');

  document.getElementById('detailBody').innerHTML = `
    <div class="detail-section">
      <h3>Coordonnées</h3>
      <div class="detail-field"><label>Email</label>${e.email ? '<a href="mailto:' + e.email + '">' + e.email + '</a>' : '—'}</div>
      <div class="detail-field"><label>Téléphone</label>${e.telephone ? '<a href="tel:' + e.telephone + '">' + e.telephone + '</a>' : '—'}</div>
      <div class="detail-field"><label>Adresse</label>${e.adresse || '—'}, ${e.code_postal || ''} ${e.ville || ''}</div>
      <div class="detail-field"><label>Dirigeant</label>${e.dirigeant || '—'}</div>
    </div>
    <div class="detail-section">
      <h3>Entreprise</h3>
      <div class="detail-field"><label>SIRET</label>${e.siret || '—'}</div>
      <div class="detail-field"><label>NAF / Activité</label>${nafLabel}</div>
      <div class="detail-field"><label>Forme juridique</label>${e.forme_juridique || '—'}</div>
      <div class="detail-field"><label>CA</label>${e.ca || '—'}</div>
      <div class="detail-field"><label>Effectif</label>${e.effectif_min && e.effectif_max ? e.effectif_min + ' — ' + e.effectif_max : (e.effectif || '—')}</div>
    </div>
    <div class="detail-section">
      <h3>CRM</h3>
      <div class="detail-actions">
        <div style="width:100%">
          <label style="font-size:11px;font-weight:600;color:var(--text-2)">Statut</label>
          <select id="detailStatus">${statusOptions}</select>
        </div>
        <div style="width:100%">
          <label style="font-size:11px;font-weight:600;color:var(--text-2)">Assigné à</label>
          <input type="text" id="detailAssigned" value="${crm.assigned_to || ''}" placeholder="Nom du commercial">
        </div>
        <div style="width:100%">
          <label style="font-size:11px;font-weight:600;color:var(--text-2)">Notes</label>
          <textarea id="detailNotes" placeholder="Ajouter des notes...">${crm.notes || ''}</textarea>
        </div>
        <button class="btn-save" onclick="saveDetail(${e.id})">💾 Sauvegarder</button>
        <button class="btn-export" onclick="exportOneVCF(${e.id})">📇 VCF</button>
      </div>
    </div>
    ${crm.actions && crm.actions.length ? `
    <div class="detail-section">
      <h3>Historique</h3>
      ${crm.actions.map(a => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border-light)">
        <span style="color:var(--text-3)">${a.date || ''}</span> ${a.text || ''}
      </div>`).join('')}
    </div>` : ''}
  `;

  panel.classList.add('open');
}

function closeDetail() {
  document.getElementById('detailPanel').classList.remove('open');
  openDetailId = null;
}

async function saveDetail(id) {
  const status = document.getElementById('detailStatus').value;
  const assigned_to = document.getElementById('detailAssigned').value.trim() || null;
  const notes = document.getElementById('detailNotes').value;

  const existing = crmCache[id] || {};
  const actions = existing.actions || [];
  
  // Ajouter une action si le statut a changé
  if (existing.status && existing.status !== status) {
    actions.push({
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      text: `Statut: ${STATUTS[existing.status]?.label || existing.status} → ${STATUTS[status]?.label || status}`
    });
  }

  const payload = { id, status, notes, assigned_to, actions: JSON.stringify(actions) };

  try {
    // Upsert dans crm_elevages
    await fetch(`${SUPABASE_URL}/rest/v1/crm_elevages`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    // Mettre à jour le cache
    crmCache[id] = { ...existing, status, notes, assigned_to, actions };
    
    // Rafraîchir l'UI
    applyFilters();
    openDetail(id); // Réouvrir pour voir les changements
    
  } catch (err) {
    alert('Erreur sauvegarde: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

function exportCSV() {
  const headers = ['Nom', 'Adresse', 'CP', 'Ville', 'Dept', 'Telephone', 'Email', 'Dirigeant', 'NAF', 'SIRET', 'Statut', 'Assigné', 'Notes'];
  const rows = filteredList.map(e => {
    const crm = crmCache[e.id] || {};
    return [
      e.nom, e.adresse, e.code_postal, e.ville, e.departement,
      e.telephone, e.email, e.dirigeant, e.naf, e.siret,
      crm.status || 'nouveau', crm.assigned_to || '', (crm.notes || '').replace(/\n/g, ' ')
    ].map(v => '"' + (v || '').replace(/"/g, '""') + '"').join(';');
  });

  const csv = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');
  downloadFile(csv, `elevages_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8');
}

function exportVCF() {
  const vcards = filteredList.map(e => {
    const parts = (e.dirigeant || e.nom).split(' ');
    const lastName = parts.pop() || '';
    const firstName = parts.join(' ') || '';
    return `BEGIN:VCARD\nVERSION:3.0\nN:${lastName};${firstName};;;\nFN:${e.dirigeant || e.nom}\nORG:${e.nom}\nEMAIL:${e.email || ''}\nTEL:${e.telephone || ''}\nADR:;;${e.adresse || ''};${e.ville || ''};;${e.code_postal || ''};France\nNOTE:NAF ${e.naf || ''} | SIRET ${e.siret || ''}\nEND:VCARD`;
  });
  downloadFile(vcards.join('\n'), `elevages_${new Date().toISOString().slice(0,10)}.vcf`, 'text/vcard');
}

function exportOneVCF(id) {
  const e = allElevages.find(x => x.id === id);
  if (!e) return;
  const parts = (e.dirigeant || e.nom).split(' ');
  const lastName = parts.pop() || '';
  const firstName = parts.join(' ') || '';
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nN:${lastName};${firstName};;;\nFN:${e.dirigeant || e.nom}\nORG:${e.nom}\nEMAIL:${e.email || ''}\nTEL:${e.telephone || ''}\nADR:;;${e.adresse || ''};${e.ville || ''};;${e.code_postal || ''};France\nNOTE:NAF ${e.naf || ''} | SIRET ${e.siret || ''}\nEND:VCARD`;
  downloadFile(vcard, `${(e.nom || 'contact').replace(/[^a-zA-Z0-9]/g, '_')}.vcf`, 'text/vcard');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
// KEYBOARD & SCROLL
// ═══════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDetail();
});

window.addEventListener('scroll', () => {
  if (currentView !== 'list') return;
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
    if (renderedCount < filteredList.length) renderMoreCards();
  }
});

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', loadAllData);
