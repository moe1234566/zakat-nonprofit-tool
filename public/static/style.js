// Fixed built-in estimate based on the silver nisab reference of 595g at
// approximately $0.85 per gram.
const NISAB_THRESHOLD = 505.75;

let calculatedZakat = 0;

document.getElementById('custom-amount-toggle').addEventListener('change', (event) => {
  document.getElementById('custom-amount-row').style.display = event.target.checked ? 'flex' : 'none';
});

document.getElementById('min-efficiency').addEventListener('input', (event) => {
  document.getElementById('min-efficiency-val').textContent = event.target.value;
});

document.querySelectorAll('.search-suggestion').forEach((button) => {
  button.addEventListener('click', () => {
    const causeInput = document.getElementById('cause');
    causeInput.value = button.dataset.searchTerm;
    causeInput.focus();
  });
});

document.getElementById('calc-zakat-btn').addEventListener('click', () => {
  const wealth = parseFloat(document.getElementById('wealth').value);

  if (isNaN(wealth) || wealth < 0) {
    showZakatResult('Please enter a valid wealth amount.', true);
    return;
  }

  const meetsNisab = wealth >= NISAB_THRESHOLD;
  calculatedZakat = meetsNisab ? +(wealth * 0.025).toFixed(2) : 0;

  const message = meetsNisab
    ? `Your wealth meets the built-in nisab threshold (
NISABTHRESHOLD.toFixed(2)).EstimatedZakatowed:<strong>
{calculatedZakat.toLocaleString()}</strong> (2.5% of $${wealth.toLocaleString()}).`
    : `Your wealth is below the built-in nisab threshold ($${NISAB_THRESHOLD.toFixed(2)}), so you are not in nisab. No Zakat is due this year.`;

  showZakatResult(message, false);
});

function showZakatResult(html, isError) {
  const box = document.getElementById('zakat-result');
  box.style.display = 'block';
  box.innerHTML = html;
  box.style.background = isError ? '#FCEBEB' : '#EBF3FB';
  box.style.color = isError ? '#A32D2D' : '#0C447C';
}

document.getElementById('search-btn').addEventListener('click', async () => {
  const cause = document.getElementById('cause').value.trim();
  const state = document.getElementById('state').value.trim();
  const minEfficiency = document.getElementById('min-efficiency').value;
  const useCustom = document.getElementById('custom-amount-toggle').checked;
  const customAmount = parseFloat(document.getElementById('custom-amount').value);
  const eligibilityAcknowledged = document.getElementById('zakat-eligibility-acknowledgement').checked;

  const donationAmount = useCustom && !isNaN(customAmount) ? customAmount : calculatedZakat;

  if (!eligibilityAcknowledged) {
    alert('Please confirm that you will verify Zakat eligibility before choosing a nonprofit.');
    return;
  }
  if (!cause) {
    alert('Please enter a cause or keyword to search.');
    return;
  }
  if (!donationAmount || donationAmount <= 0) {
    alert('Please calculate your Zakat first (Step 1), or enter a custom donation amount.');
    return;
  }

  const statusElement = document.getElementById('status-msg');
  const resultsCard = document.getElementById('results-card');
  resultsCard.style.display = 'none';
  statusElement.style.display = 'block';
  statusElement.textContent = 'Searching Islamic Zakat distributors and pulling IRS filing data… this can take a few seconds.';

  const params = new URLSearchParams({
    cause,
    min_efficiency: minEfficiency,
    donation: donationAmount,
  });
  if (state) params.set('state', state);

  try {
    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();

    statusElement.style.display = 'none';

    if (!response.ok) {
      statusElement.style.display = 'block';
      statusElement.textContent = data.error || 'Something went wrong.';
      return;
    }

    renderResults(data, donationAmount);
  } catch (error) {
    statusElement.style.display = 'block';
    statusElement.textContent = 'Network error — could not reach the server. Please try again.';
  }
});

function renderResults(data, donationAmount) {
  const resultsCard = document.getElementById('results-card');
  const list = document.getElementById('results-list');
  const summary = document.getElementById('results-summary');

  list.innerHTML = '';

  if (!data.results || data.results.length === 0) {
    summary.textContent = data.message || 'No nonprofits matched your search and efficiency threshold. Try lowering the minimum efficiency score.';
    resultsCard.style.display = 'block';
    return;
  }

  summary.textContent = `Showing data.results.lengthIslamicZakatdistributorcandidate(s)matching"{data.query}", ranked by Overall Score, assuming a donation of $donationAmount.toLocaleString().({data.skipped || 0} skipped due to incomplete filing data; ${data.filtered_out || 0} excluded by the Islamic/Zakat scope screen.)`;

  data.results.forEach((organization, index) => {
    const efficiencyClass = organization.efficiency_score >= 75
      ? 'eff-high'
      : organization.efficiency_score >= 50
        ? 'eff-mid'
        : 'eff-low';
    const propublicaUrl = `https://projects.propublica.org/nonprofits/organizations/${encodeURIComponent(organization.ein)}`;
    const officialWebsiteQuery = [
      organization.name,
      organization.city,
      organization.state,
      'official website',
    ].filter(Boolean).join(' ');
    const officialWebsiteUrl = `https://www.google.com/search?q=${encodeURIComponent(officialWebsiteQuery)}`;
    const verificationLinks = [
      `<a href="${propublicaUrl}" target="_blank" rel="noopener noreferrer">View on ProPublica</a>`,
      `<a href="${officialWebsiteUrl}" target="_blank" rel="noopener noreferrer">Search for official website</a>`,
    ];
    const guidestarUrl = getSafeExternalUrl(organization.guidestar_url);
    if (guidestarUrl) {
      verificationLinks.push(
        `<a href="${escapeHtml(guidestarUrl)}" target="_blank" rel="noopener noreferrer">View on GuideStar</a>`,
      );
    }
    const card = document.createElement('div');
    card.className = 'org-card';
    card.innerHTML = `
      <div class="org-rank">${index + 1}</div>
      <div class="org-info">
        <div class="org-name">${escapeHtml(organization.name)}</div>
        <div class="org-loc">escapeHtml(organization.city||''){organization.city && organization.state ? ', ' : ''}${escapeHtml(organization.state || '')} · EIN ${organization.ein} · Filing year ${organization.tax_year}</div>
        <div class="org-metrics">
          <span>Overall Score: ${organization.combined_score}%</span>
          <span>Efficiency Score: ${organization.efficiency_score}%</span>
          <span>Program revenue ratio: ${organization.program_revenue_ratio != null ? `${organization.program_revenue_ratio}%` : 'N/A'}</span>
          <span>Fundraising fee ratio: ${organization.fundraising_fee_ratio != null ? `${organization.fundraising_fee_ratio}%` : 'N/A'}</span>
          <span>Total revenue: $${Number(organization.total_revenue).toLocaleString()}</span>
          <span>Total expenses: $${Number(organization.total_expenses).toLocaleString()}</span>
          <span>Estimated reserve: ${organization.reserve_months ?? 'N/A'} months of operating expenses</span>
          <span>Estimated impact of your donation: $${organization.estimated_impact != null ? organization.estimated_impact.toLocaleString() : 'N/A'}</span>
        </div>
        <span class="efficiency-badge ${efficiencyClass}">Overall Score: ${organization.combined_score}%</span>
        <div class="org-sources">
          <span class="org-sources-label">External verification:</span>
          ${verificationLinks.join('<span class="org-sources-separator" aria-hidden="true">·</span>')}
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  resultsCard.style.display = 'block';
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function getSafeExternalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

static/style.css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  background: #F7F5F0;
  color: #1A1A1A;
  line-height: 1.5;
}

header {
  background: #185FA5;
  color: white;
  padding: 32px 24px;
  text-align: center;
}

header h1 { font-size: 26px; font-weight: 600; }
.subtitle { margin-top: 6px; font-size: 14px; opacity: 0.9; }

main {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 60px;
}

.card {
  background: white;
  border: 1px solid #E0DACE;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
}

.card h2 {
  font-size: 18px;
  margin-bottom: 16px;
  color: #185FA5;
}

.input-row {
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-row label {
  font-size: 13px;
  font-weight: 500;
  color: #444;
}

.nisab-note {
  margin: -4px 0 16px;
  font-size: 12px;
  color: #777;
}

.input-row input[type="text"],
.input-row input[type="number"],
.input-row select {
  padding: 10px 12px;
  border: 1px solid #CCC;
  border-radius: 8px;
  font-size: 14px;
}

.input-row input[type="checkbox"] { margin-right: 6px; }
.input-row input[type="range"] { width: 100%; }

.search-suggestions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.suggestions-label {
  width: 100%;
  color: #777;
  font-size: 12px;
}

.search-suggestion {
  width: auto;
  padding: 6px 10px;
  border: 1px solid #B9D3EB;
  border-radius: 999px;
  background: #F2F7FC;
  color: #185FA5;
  font-size: 12px;
  font-weight: 600;
}

.search-suggestion:hover,
.search-suggestion:focus-visible {
  background: #E2EFFA;
  opacity: 1;
}

button {
  background: #185FA5;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}

button:hover { opacity: 0.9; }

.result-box {
  margin-top: 14px;
  padding: 14px;
  background: #EBF3FB;
  border-radius: 8px;
  font-size: 14px;
  color: #0C447C;
}

.status-msg {
  text-align: center;
  padding: 20px;
  font-size: 14px;
  color: #666;
}

.results-summary {
  font-size: 13px;
  color: #666;
  margin-bottom: 16px;
}

.zakat-guidance {
  background: #FFFCF3;
  border-color: #E8D9A0;
  border: 1px solid #E8D9A0;
  border-radius: 10px;
  padding: 18px;
  margin: 20px 0;
}

.zakat-guidance blockquote {
  margin: 0 0 16px;
  padding: 14px 16px;
  border-left: 4px solid #D19A2A;
  background: #FFF7DF;
  color: #4C3A1A;
  font-size: 14px;
  line-height: 1.65;
}

.zakat-guidance cite {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  color: #765B24;
}

.zakat-guidance p,
.zakat-guidance li {
  font-size: 13px;
  color: #555;
}

.zakat-guidance ul {
  margin: 8px 0 14px;
  padding-left: 20px;
}

.zakat-guidance li { margin-bottom: 6px; }

.guidance-note {
  margin-bottom: 16px;
}

.acknowledgement {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #3F3A2E;
  cursor: pointer;
}

.acknowledgement input {
  margin-top: 3px;
  flex-shrink: 0;
}

.org-card {
  border: 1px solid #E0DACE;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.org-info { flex: 1; }
.org-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.org-loc { font-size: 12px; color: #888; margin-bottom: 8px; }
.org-metrics { font-size: 13px; color: #444; display: flex; flex-direction: column; gap: 3px; }

.org-rank {
  background: #185FA5;
  color: white;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.efficiency-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  margin-top: 4px;
}

.eff-high { background: #EDF5E0; color: #3B6D11; }
.eff-mid  { background: #FBF1E2; color: #854F0B; }
.eff-low  { background: #FCEBEB; color: #A32D2D; }

.org-sources {
  margin-top: 10px;
  font-size: 12px;
  color: #888;
}

.org-sources-label {
  margin-right: 6px;
  color: #777;
}

.org-sources a {
  color: #666;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.org-sources a:hover,
.org-sources a:focus-visible {
  color: #185FA5;
}

.org-sources-separator {
  margin: 0 7px;
  color: #B8B1A6;
}

.transparency-box {
  background: #FFFBEF;
  border-color: #E8D9A0;
}

.transparency-box ul {
  padding-left: 20px;
  font-size: 13px;
  color: #555;
}

.transparency-box li { margin-bottom: 8px; }

footer {
  text-align: center;
  padding: 20px;
  font-size: 12px;
  color: #999;
}
