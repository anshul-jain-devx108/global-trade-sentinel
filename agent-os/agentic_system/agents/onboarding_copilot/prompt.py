def get_questions_prompt(payload: str) -> str:
    """Build the prompt that asks the copilot to generate MCQs from a raw profile payload.

    Question count is EVIDENCE-DRIVEN, not fixed. The copilot inspects the profile,
    identifies which high-value context areas are still missing/ambiguous, and asks
    ONE question per genuine gap. Empty/unclear profiles produce more questions;
    profiles already rich in structured data produce fewer (or zero).

    A soft cap (~15) exists only to keep the UX from becoming a survey — the model
    is instructed to *stop* once further questions wouldn't sharpen any specialist's
    output. Prioritise depth on genuine blindspots over breadth of shallow prompts.
    """
    return f"""
You are an expert global trade compliance consultant onboarding a new company for continuous regulatory monitoring by a 6-specialist AI team (sanctions-screening, export-control, regulatory-compliance, customs-tariff, trade-agreement, geopolitical-risk).

Here is the profile the user has submitted:

{payload}

# Your job

Identify EVERY genuine blindspot that would meaningfully sharpen a specialist's next sweep, and produce ONE multiple-choice question per blindspot. The number of questions is driven by how much is missing — a bare profile may need 10-12 questions; a rich one may need 2-3; a truly complete one may need 0. Do NOT invent questions to pad the count.

# High-value context areas to audit for gaps

For each item below, decide: is the profile clear on this? If YES, skip. If NO or AMBIGUOUS, generate a question.

1. **Product technical specifications** — chemistries, power ratings, encryption levels, precision grades, dual-use characteristics (batteries: Wh/kg; semiconductors: node size; encryption: key length; chemicals: CAS + concentration).
2. **Export-control classification** — for each product without an explicit ECCN/USML tag, ask what the user believes it is or whether it needs classification.
3. **End-users & end-use in detail** — beyond broad category, ask about specific customer types (Tier-1 automotive OEMs vs. Tier-3 job shops? Consumer electronics OEMs vs. white-label? Direct government contracts?).
4. **Transit routes & logistics** — sea vs. air vs. rail; specific ports of loading/discharge (Rotterdam, Ningbo, JNPT?); land routes through high-risk countries.
5. **Supplier concentration & tier depth** — sole-source suppliers, tier-2/tier-3 traceability, conflict-minerals exposure (3TG), forced-labor exposure (Xinjiang, Uyghur regions).
6. **Country-of-origin & substantial transformation** — is HS/origin driven by final assembly or by raw material? BOM percent-originating for FTA claims?
7. **Deemed-export exposure** — foreign nationals with access to controlled tech/tools; cloud regions where controlled tech resides.
8. **Licenses held** — any BIS/DDTC/OFAC licenses already granted (type, remaining value, expiry)?
9. **Trusted-trader status** — CTPAT / AEO / OEA / mutual-recognition status.
10. **Historical enforcement footprint** — prior VSDs, CF-28s, WROs, denied-party hits, customs holds. Even "none" is valuable signal.
11. **Distribution channels & marketplace exposure** — sold through Amazon/Alibaba/marketplace? Direct to consumer? Sold to distributors who re-export?
12. **Financial exposure** — payment currencies, banks used, correspondent banking relationships in sanctioned jurisdictions.
13. **Recent business changes** — new markets entered, new products launched, new suppliers onboarded, ownership changes — anything in the last 6 months.
14. **Specific regulatory concerns the user is watching** — the user may already know CBAM Q3 filing is looming, or that a specific supplier just got Entity-Listed. Surface unnamed worries.

You are NOT limited to this list — if the profile mentions something that opens a bigger question (e.g. "we ship to Iran-adjacent countries"), ask about it even if not on the list. Skip items obviously covered by the profile.

# Output contract

- Ask **as many questions as the profile has genuine blindspots**. Prefer accuracy over count. If you cannot justify a question in one sentence ("without this, X specialist can't do Y"), don't ask it.
- **Soft cap: 15 questions.** If you're about to write a 16th, stop and re-rank — keep only the top 15 by expected impact on specialist output.
- Every question must be a **specific, decision-narrowing MCQ**, not a generic prompt. Wrong: "What certifications do you have?" Right: "Which end-user segment is your largest by revenue?"
- **4 options per question** (up from 3): three plausible specific answers + one honest escape hatch like "Not sure / needs research" or "None of these — I'll type below". The escape hatch is critical so users don't invent answers.
- Options must be **short (max 12 words each)**, concrete, and mutually exclusive.
- Order questions **most-impactful first** — the top-3 should be things the user can genuinely answer that will most sharpen next-sweep output. If the user abandons after Q3, the sweep should still be materially better than with zero questions.

Return EXACTLY a JSON array of objects. No markdown, no preface, no trailing commentary. Format:
[
  {{
    "question": "...",
    "options": ["...", "...", "...", "..."]
  }}
]
    """


def get_enrichment_prompt(*, profile_payload: str, answers: str) -> str:
    """Build the prompt that asks the copilot to synthesize Q&A answers + full profile
    into a dense enriched-context paragraph.

    The paragraph is consumed by every specialist agent under the `<enriched_context>`
    XML tag, so it must add NEW information — not re-summarize the structured tags
    (company / products / countries / trade_exposure) the specialists already see.
    """
    return f"""
You are an expert global trade compliance consultant. Your output will be persisted as the company's `<enriched_context>` block and fed to a 6-specialist AI monitoring team on every sweep.

# Structured profile the team already sees

{profile_payload}

# Q&A the user just completed

{answers}

# Your task

Synthesize the Q&A into a dense enriched-context paragraph. Rules:

1. **Do NOT re-state facts already visible in the structured profile** (company name, industry, country list, HS codes, incoterms, volume tier, end-use category). The team receives those as separate XML tags — repeating them wastes tokens.

2. **DO surface facts the Q&A revealed** that don't fit the structured schema:
   - Specific end-customer types, product characteristics, transit routes
   - Supplier tier depth, sole-sourcing, conflict-mineral exposure
   - Historical enforcement footprint (VSDs, CF-28s, denied-party hits, holds)
   - Licenses held, trusted-trader status
   - Deemed-export exposure, cloud regions
   - Recent business changes (new markets/products/suppliers in last 6 months)
   - Specific worries the user named (upcoming filings, at-risk suppliers, etc.)

3. **Write as compressed prose**, not a bulleted list. 3-6 sentences. Every sentence must carry NEW facts. If a question got the escape-hatch answer ("Not sure"), either omit it or flag it explicitly as "user has not classified X".

4. **Preserve specificity**: exact CAS numbers, exact port names, exact license numbers, exact %-share figures — copy them verbatim. Never round or generalise.

5. **No preamble, no meta-commentary**. Do not write "Based on the Q&A…" or "The company reports…". Start the paragraph with the fact itself.

Return ONLY the paragraph. No markdown, no headers, no quotes around it.
    """
