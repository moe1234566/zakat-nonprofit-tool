"""
Zakat & Sadaqah Nonprofit Ranking Tool
MGSC 300 — Decision-Support Web App
Free API used: ProPublica Nonprofit Explorer API (https://projects.propublica.org/nonprofits/api)

This Flask app proxies requests to ProPublica server-side (avoids browser CORS
issues), computes derived metrics from raw IRS Form 990 data, and returns a
ranked list of nonprofits to the frontend.
"""

import os
import re

import requests
from flask import Flask, jsonify, render_template, request


app = Flask(__name__)

PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2"
SEARCH_RESULT_LIMIT = 12
CANDIDATE_LIMIT = 24
TOP_N = 8

# ProPublica does not publish structured fields for religious identity or
# whether a nonprofit accepts/distributes Zakat. These conservative terms are
# used only as a first-pass screen on the organization's public name.
ISLAMIC_IDENTITY_TERMS = (
    "islamic",
    "muslim",
    "masjid",
    "mosque",
    "quran",
    "zakat",
    "sadaqah",
    "sadaqa",
)
ZAKAT_PROGRAM_TERMS = (
    "zakat",
    "sadaqah",
    "sadaqa",
    "relief",
    "aid",
    "charity",
    "humanitarian",
    "welfare",
    "poverty",
    "orphan",
    "refugee",
    "food",
    "hunger",
    "emergency",
    "disaster",
)


def fetch_search_results(query, state=None):
    """Call ProPublica's /search.json endpoint."""
    params = {"q": query}
    if state:
        params["state[id]"] = state
    response = requests.get(
        f"{PROPUBLICA_BASE}/search.json", params=params, timeout=10
    )
    # ProPublica returns 404 rather than an empty 200 response for some
    # searches with no matches.
    if response.status_code == 404:
        return []
    response.raise_for_status()
    return response.json().get("organizations", [])[:SEARCH_RESULT_LIMIT]


def fetch_scoped_search_results(query, state=None):
    """Search the user's term and Islamic/Zakat-qualified variants."""
    search_queries = [query]
    query_lower = query.casefold()
    for qualifier in ("islamic", "muslim", "zakat"):
        if qualifier not in query_lower:
            search_queries.append(f"{query} {qualifier}")

    organizations = []
    seen_eins = set()
    for search_query in search_queries:
        for organization in fetch_search_results(search_query, state):
            ein = str(organization.get("ein", "")).strip()
            if not ein or ein in seen_eins:
                continue
            seen_eins.add(ein)
            organizations.append(organization)
            if len(organizations) >= CANDIDATE_LIMIT:
                return organizations
    return organizations


def scope_signals(organization):
    """Return conservative Islamic identity and Zakat-program name signals."""
    searchable_name = " ".join(
        str(organization.get(field) or "")
        for field in ("name", "sub_name")
    ).casefold()
    identity_matches = [
        term
        for term in ISLAMIC_IDENTITY_TERMS
        if re.search(rf"\b{re.escape(term)}\b", searchable_name)
    ]
    program_matches = [
        term
        for term in ZAKAT_PROGRAM_TERMS
        if re.search(rf"\b{re.escape(term)}\b", searchable_name)
    ]
    return identity_matches, program_matches


def is_zakat_distributor_candidate(organization):
    """Require both an Islamic identity signal and a charitable program signal."""
    identity_matches, program_matches = scope_signals(organization)
    return bool(identity_matches and program_matches)


def fetch_org_detail(ein):
    """Call ProPublica's /organizations/:ein.json endpoint for filing data."""
    response = requests.get(
        f"{PROPUBLICA_BASE}/organizations/{ein}.json", timeout=10
    )
    response.raise_for_status()
    return response.json()


def latest_usable_filing(filings):
    """Pick the most recent filing that has revenue and expense data."""
    usable = [
        filing
        for filing in filings
        if filing.get("totrevenue") not in (None, 0)
        and filing.get("totfuncexpns") not in (None, 0)
    ]
    if not usable:
        return None
    usable.sort(key=lambda filing: filing.get("tax_prd_yr", 0), reverse=True)
    return usable[0]


def compute_metrics(org_summary, filing, donation_amount):
    """Compute ranking metrics from an organization's latest filing."""
    pct_comp = filing.get("pct_compnsatncurrofcr")
    total_assets = filing.get("totassetsend") or 0
    total_expenses = filing.get("totfuncexpns") or 0
    total_revenue = filing.get("totrevenue") or 0
    program_revenue = filing.get("totprgmrevnue") or 0
    professional_fundraising_fees = filing.get("profndraising") or 0

    if pct_comp is None:
        efficiency_score = None
    else:
        efficiency_score = round((1 - float(pct_comp)) * 100, 1)
        efficiency_score = max(0, min(100, efficiency_score))

    reserve_months = None
    if total_expenses > 0:
        reserve_months = round((total_assets / total_expenses) * 12, 1)

    program_revenue_ratio = None
    if total_revenue > 0:
        program_revenue_ratio = round((program_revenue / total_revenue) * 100, 1)

    fundraising_fee_ratio = None
    if total_expenses > 0:
        fundraising_fee_ratio = round(
            (professional_fundraising_fees / total_expenses) * 100, 1
        )

    combined_score = None
    if (
        efficiency_score is not None
        and program_revenue_ratio is not None
        and fundraising_fee_ratio is not None
    ):
        combined_score = round(
            (efficiency_score * 0.4)
            + (program_revenue_ratio * 0.4)
            + ((100 - fundraising_fee_ratio) * 0.2),
            1,
        )

    estimated_impact = None
    if efficiency_score is not None and donation_amount:
        estimated_impact = round(donation_amount * (efficiency_score / 100), 2)

    return {
        "ein": org_summary.get("ein"),
        "name": org_summary.get("name"),
        "city": org_summary.get("city"),
        "state": org_summary.get("state"),
        "guidestar_url": org_summary.get("guidestar_url"),
        "ntee_code": org_summary.get("ntee_code"),
        "tax_year": filing.get("tax_prd_yr"),
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "total_assets": total_assets,
        "efficiency_score": efficiency_score,
        "program_revenue_ratio": program_revenue_ratio,
        "fundraising_fee_ratio": fundraising_fee_ratio,
        "combined_score": combined_score,
        "reserve_months": reserve_months,
        "estimated_impact": estimated_impact,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search")
def api_search():
    query = request.args.get("cause", "").strip()
    state = request.args.get("state", "").strip().upper() or None
    min_efficiency = request.args.get("min_efficiency", type=float, default=0)
    donation_amount = request.args.get("donation", type=float, default=0)

    if not query:
        return jsonify({"error": "Please enter a cause or keyword to search."}), 400

    try:
        summaries = fetch_scoped_search_results(query, state)
    except requests.RequestException as error:
        return jsonify({"error": f"Could not reach the ProPublica API: {error}"}), 502

    if not summaries:
        return jsonify({"results": [], "message": "No organizations found for that search."})

    results = []
    skipped = 0
    filtered_out = 0
    for organization in summaries:
        ein = organization.get("ein")
        if not ein:
            continue
        if not is_zakat_distributor_candidate(organization):
            filtered_out += 1
            continue
        try:
            detail = fetch_org_detail(ein)
        except requests.RequestException:
            skipped += 1
            continue

        filing = latest_usable_filing(detail.get("filings_with_data", []))
        if not filing:
            skipped += 1
            continue

        metrics = compute_metrics(organization, filing, donation_amount)
        if metrics["efficiency_score"] is None:
            skipped += 1
            continue
        if metrics["combined_score"] is None:
            skipped += 1
            continue
        if metrics["efficiency_score"] < min_efficiency:
            continue

        results.append(metrics)

    results.sort(key=lambda result: result["combined_score"], reverse=True)
    results = results[:TOP_N]

    return jsonify(
        {
            "results": results,
            "skipped": skipped,
            "filtered_out": filtered_out,
            "query": query,
            "donation_amount": donation_amount,
            "scope": {
                "religious_identity": "Islamic/Muslim",
                "program": "Distributes or accepts Zakat",
                "screening": (
                    "Results must have both an Islamic identity signal and "
                    "a Zakat/charitable distribution signal in the public name. "
                    "Confirm the organization's current Zakat policy before donating."
                ),
            },
            "data_source": "ProPublica Nonprofit Explorer API — IRS Form 990 filings",
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
