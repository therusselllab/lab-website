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

/* ---- Render a single publication ---- */
function renderPub(pub) {
  const title = pub.title || 'Untitled';
  const authors = formatAuthors(pub.authorString);
  const rawJournal = pub.journalInfo?.journal?.title || pub.journalInfo?.journal?.isoabbreviation || pub.bookOrReportDetails?.publisher || pub.journalTitle || '';
  const journal = rawJournal.replace(/\s*\(.*?\)\s*/g, '').trim();
  const year = pub.pubYear || '';
  const volume = pub.journalVolume ? `${pub.journalVolume}` : '';
  const pages = pub.pageInfo ? `:${pub.pageInfo}` : '';
  const doi = pub.doi;
  const pmid = pub.pmid;

  const titleLink = doi
    ? `<a class="pub-item__title-link" href="https://doi.org/${doi}" target="_blank" rel="noopener">${title}</a>`
    : `<span>${title}</span>`;

  const metaParts = [
    journal ? `<span class="pub-item__journal">${journal}</span>` : '',
    year,
    volume + pages,
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
    return !isExcludedType && !isExcludedTitle;
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
  renderPublications();
});
