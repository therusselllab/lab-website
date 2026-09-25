/* ============================================================
   Russell Lab — publications.js
   Live publication feed via Europe PMC API.

   CONFIGURATION: Set your ORCID below. If you don't have one,
   set ORCID to null and the author name search will be used.
   Register at https://orcid.org/ — it takes 2 minutes.
   ============================================================ */

const CONFIG = {
  // Your ORCID iD (format: 0000-0000-0000-0000)
  // → Most reliable. Get yours at https://orcid.org
  ORCID: '0000-0001-5411-2807',

  // Fallback: author name + affiliation text search
  AUTHOR_NAME: 'Andrew Russell',
  AFFILIATION: 'MRC LMS',

  // Max results to show
  MAX_RESULTS: 40,

  // Highlight these author names in bold
  HIGHLIGHT_AUTHORS: ['Russell A', 'Russell AR', 'Andrew Russell'],

  // Hand-picked papers shown above the full list, in this order.
  // Details are fetched by DOI; `pdf` overrides the automatic free-PDF link.
  SELECTED: [
    {
      heading: 'Slide-tags technology',
      papers: [
        { doi: '10.1038/s41586-023-06837-4' },
        { doi: '10.1038/s41576-024-00797-9' },
      ],
    },
    {
      heading: 'Applications of Slide-tags',
      papers: [
        { doi: '10.1038/s41591-024-03073-9' },
        { doi: '10.1038/s41588-026-02739-z',
          pdf: 'https://www.biorxiv.org/content/10.1101/2024.10.21.619529.full.pdf', pdfLabel: 'Preprint PDF' },
        { doi: '10.1101/2025.10.08.681007' },
      ],
    },
  ],
};

/* ---- API Query Builder ---- */
function buildQuery() {
  if (CONFIG.ORCID) {
    return `AUTHORID:${CONFIG.ORCID}`;
  }
  return `AUTH:"${CONFIG.AUTHOR_NAME}" AFF:"${CONFIG.AFFILIATION}"`;
}

/* ---- Fetch publications from Europe PMC ---- */
async function fetchPublications() {
  const query = encodeURIComponent(buildQuery());
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&resultType=core&pageSize=${CONFIG.MAX_RESULTS}&sort=P_PDATE_D%20desc`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Europe PMC API error: ${resp.status}`);
  const data = await resp.json();
  return data.resultList?.result || [];
}

/* ---- Format author list, highlighting lab PI ---- */
function formatAuthors(authorsStr) {
  if (!authorsStr) return '';
  return authorsStr
    .split(', ')
    .map(a => {
      const isHighlighted = CONFIG.HIGHLIGHT_AUTHORS.some(h =>
        a.toLowerCase().includes(h.toLowerCase())
      );
      return isHighlighted ? `<strong>${a}</strong>` : a;
    })
    .join(', ');
}

/* ---- Tidy journal names: "Nature reviews. Genetics" -> "Nature Reviews Genetics" ---- */
function formatJournal(name) {
  const small = ['of', 'and', 'the', 'in', 'for', 'on'];
  return name
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\.\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      if (/[A-Z]/.test(w.slice(1))) return w;            // eLife, bioRxiv
      if (i > 0 && small.includes(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/* ---- Free full-text PDF (open access or free to read), if Europe PMC has one ---- */
function freePdfUrl(pub) {
  const urls = (pub.fullTextUrlList?.fullTextUrl || [])
    .filter(u => u.documentStyle === 'pdf' && ['OA', 'F'].includes(u.availabilityCode));
  const best = urls.find(u => u.site === 'Europe_PMC') || urls[0];
  if (best) return best.url;
  // bioRxiv / medRxiv preprints are always free; this address redirects to the latest version
  const server = { biorxiv: 'www.biorxiv.org', medrxiv: 'www.medrxiv.org' }[(pub.journalInfo?.journal?.title || pub.bookOrReportDetails?.publisher || '').toLowerCase()];
  if (server && pub.doi) return `https://${server}/content/${pub.doi}.full.pdf`;
  return null;
}

/* ---- Render a single publication ---- */
function renderPub(pub) {
  const title = pub.title || 'Untitled';
  const authors = formatAuthors(pub.authorString);
  const rawJournal = pub.journalInfo?.journal?.title || pub.journalInfo?.journal?.isoabbreviation || pub.bookOrReportDetails?.publisher || pub.journalTitle || '';
  const journal = formatJournal(rawJournal);
  const year = pub.pubYear || '';
  const volumePages = [pub.journalVolume, pub.pageInfo].filter(Boolean).join(':');
  const doi = pub.doi;
  const pmid = pub.pmid;
  const pdf = freePdfUrl(pub);

  const titleLink = doi
    ? `<a class="pub-item__title-link" href="https://doi.org/${doi}" target="_blank" rel="noopener">${title}</a>`
    : `<span>${title}</span>`;

  const metaParts = [
    journal ? `<span class="pub-item__journal">${journal}</span>` : '',
    year,
    volumePages,
    pdf ? `<a class="pub-item__doi" href="${pdf}" target="_blank" rel="noopener">PDF</a>` : '',
    doi ? `<a class="pub-item__doi" href="https://doi.org/${doi}" target="_blank" rel="noopener">DOI: ${doi}</a>` : '',
    pmid ? `<a class="pub-item__doi" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/" target="_blank" rel="noopener">PubMed</a>` : '',
  ].filter(Boolean);

  return `
    <div class="pub-item reveal">
      <div class="pub-item__title">${titleLink}</div>
      ${authors ? `<div class="pub-item__authors">${authors}</div>` : ''}
      <div class="pub-item__meta">${metaParts.join('<span>·</span>')}</div>
    </div>
  `;
}

/* ---- Filter out corrections, errata, retractions ---- */
function filterPubs(pubs) {
  const excludeTypes = ['correction', 'erratum', 'published erratum', 'retraction'];
  return pubs.filter(p => {
    const types = (p.pubTypeList?.pubType || []).map(t => t.toLowerCase());
    const titleLower = (p.title || '').toLowerCase();
    const isExcludedType = types.some(t => excludeTypes.includes(t));
    const isExcludedTitle = /^(correction|erratum|retraction)\b/.test(titleLower);
    // Preprints whose journal version is already in the list
    const isPublishedPreprint = (p.commentCorrectionList?.commentCorrection || []).some(c => c.type === 'Preprint of');
    return !isExcludedType && !isExcludedTitle && !isPublishedPreprint;
  });
}

/* ---- Group publications by year ---- */
function groupByYear(pubs) {
  const groups = {};
  pubs.forEach(p => {
    const y = p.pubYear || 'Unknown';
    if (!groups[y]) groups[y] = [];
    groups[y].push(p);
  });
  return Object.entries(groups).sort(([a], [b]) => b - a);
}

/* ---- Selected publications ---- */
function shortAuthors(authorsStr) {
  const list = (authorsStr || '').replace(/\.$/, '').split(', ').filter(Boolean);
  if (list.length <= 4) return formatAuthors(list.join(', '));
  const isUs = a => CONFIG.HIGHLIGHT_AUTHORS.some(h => a.toLowerCase().includes(h.toLowerCase()));
  const shown = list.slice(0, 3);
  const us = list.findIndex(isUs);
  if (us >= 3) shown.push('…', list[us]);
  return formatAuthors(shown.join(', ')).replace(', …,', ' … ') + ' et al.';
}

function renderSelectedPub(pub, override) {
  const journal = formatJournal(pub.journalInfo?.journal?.title || pub.bookOrReportDetails?.publisher || pub.journalTitle || '');
  const pdf = override.pdf || freePdfUrl(pub);
  const title = pub.doi
    ? `<a class="pub-item__title-link" href="https://doi.org/${pub.doi}" target="_blank" rel="noopener">${pub.title}</a>`
    : pub.title;
  const links = [
    pdf ? `<a class="pub-link" href="${pdf}" target="_blank" rel="noopener">${override.pdfLabel || 'PDF'}</a>` : '',
    pub.doi ? `<a class="pub-link" href="https://doi.org/${pub.doi}" target="_blank" rel="noopener">Article</a>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="pub-selected">
      <div class="pub-item__title">${title}</div>
      <div class="pub-item__authors">${shortAuthors(pub.authorString)}</div>
      <div class="pub-item__meta"><span class="pub-item__journal">${journal}</span><span>·</span>${pub.pubYear || ''}</div>
      ${links ? `<div class="pub-selected__links">${links}</div>` : ''}
    </div>`;
}

async function renderSelected() {
  const container = document.getElementById('pub-selected');
  if (!container || !CONFIG.SELECTED?.length) return;
  const all = CONFIG.SELECTED.flatMap(g => g.papers);
  const query = encodeURIComponent(all.map(p => `DOI:"${p.doi}"`).join(' OR '));
  try {
    const resp = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&resultType=core&pageSize=${all.length * 2}`);
    if (!resp.ok) throw new Error(resp.status);
    const results = (await resp.json()).resultList?.result || [];
    const byDoi = {};
    results.forEach(p => { if (p.doi && !byDoi[p.doi.toLowerCase()]) byDoi[p.doi.toLowerCase()] = p; });
    container.innerHTML = CONFIG.SELECTED.map(g => `
      <h3 class="pub-selected__heading">${g.heading}</h3>
      <div class="pub-selected__grid">
        ${g.papers.map(p => byDoi[p.doi.toLowerCase()]).map((pub, i) => pub ? renderSelectedPub(pub, g.papers[i]) : '').join('')}
      </div>`).join('');
  } catch (err) {
    console.error(err);
    container.closest('.pub-selected-section')?.remove();
  }
}

/* ---- Main render function ---- */
async function renderPublications() {
  const container = document.getElementById('pub-container');
  const countEl = document.getElementById('pub-count');
  if (!container) return;

  container.innerHTML = `
    <div class="pub-loading">
      <div class="pub-loading__spinner"></div>
      Loading publications…
    </div>`;

  try {
    const pubs = filterPubs(await fetchPublications());

    if (!pubs.length) {
      container.innerHTML = `<p class="text-muted">No publications found. Check your ORCID or name configuration in <code>js/publications.js</code>.</p>`;
      return;
    }

    if (countEl) countEl.textContent = pubs.length;

    const grouped = groupByYear(pubs);
    container.innerHTML = grouped.map(([year, items]) => `
      <div class="pub-year-group">
        <h3 class="pub-year reveal">${year}</h3>
        ${items.map(renderPub).join('')}
      </div>
    `).join('');

    // Re-trigger scroll reveal for dynamically added elements
    const revealEls = container.querySelectorAll('.reveal');
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      }),
      { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
    );
    revealEls.forEach(el => observer.observe(el));

  } catch (err) {
    console.error(err);
    container.innerHTML = `
      <div class="pub-error">
        <strong>Could not load publications.</strong> ${err.message}
        <br>Check the browser console for details, or verify your ORCID / network connection.
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderSelected();
  renderPublications();
});
