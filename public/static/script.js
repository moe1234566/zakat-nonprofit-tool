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
    ? `Your wealth meets the built-in nisab threshold ($${NISAB_THRESHOLD.toFixed(2)}). Estimated Zakat owed: <strong>$${calculatedZakat.toLocaleString()}</strong> (2.5% of $${wealth.toLocaleString()}).`
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

  summary.textContent = `Showing ${data.results.length} Islamic Zakat distributor candidate(s) matching "${data.query}", ranked by Overall Score, assuming a donation of $${donationAmount.toLocaleString()}. (${data.skipped || 0} skipped due to incomplete filing data; ${data.filtered_out || 0} excluded by the Islamic/Zakat scope screen.)`;

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
        <div class="org-loc">${escapeHtml(organization.city || '')}${organization.city && organization.state ? ', ' : ''}${escapeHtml(organization.state || '')} · EIN ${organization.ein} · Filing year ${organization.tax_year}</div>
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
