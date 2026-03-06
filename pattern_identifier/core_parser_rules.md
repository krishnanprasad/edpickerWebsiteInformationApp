# Comprehensive School Website Crawling Patterns
## Heuristic, Anchor-Based, DOM-Aware Extraction Rules for 50-School Audit

## Core Parser Instruction
Do **not** rely on CSS class names or IDs as the primary signal.  
Use a layered extraction approach based on:

1. URL/page priority
2. Navigation anchor text
3. Heading matching
4. Sibling and adjacent DOM blocks
5. Protocol links such as `tel:` and `mailto:`
6. Footer/header/global repeated zones
7. Regex extraction
8. Negative filtering
9. Confidence scoring
10. Cross-page validation

## Recommended Page Scan Order
For every school website, scan in this order:

1. Home page
2. Contact Us / Reach Us / Get in Touch
3. About / About Us
4. Principal?s Message / From the Principal?s Desk / Headmaster / Headmistress page
5. Mandatory Public Disclosure / Disclosure / CBSE / Appendix IX / SARAS
6. Footer on all pages
7. Admission page
8. Linked PDF documents from disclosure/contact/about sections

---

# Cross-Field Validation Rules

## Rule 1: Do Not Finalize on a Single Weak Hit
A field should not be finalized from only one weak heuristic match.

## Rule 2: Finalization Logic
Finalize automatically when:
- one **high-confidence** hit exists, or
- two **medium-confidence** hits agree

## Rule 3: Conflict Handling
If multiple conflicting values exist:
- keep all candidates internally
- store source URLs
- mark field as `Needs Review`

## Rule 4: Missing Handling
If no high-confidence or medium-confidence value is found:
- mark as `Missing`
- do not guess

---

# Recommended Output Schema

For each school, store:

| Field | Description |
|---|---|
| School Name | Canonical school name |
| Website | Root website URL |
| Principal | Final extracted principal |
| Principal Source URL | Source page where principal was found |
| Principal Pattern Hit | Rule number(s) matched |
| Principal Confidence | High / Medium / Low |
| Phone Number(s) | Final extracted phone numbers |
| Phone Source URL | Source page where phone was found |
| Phone Pattern Hit | Rule number(s) matched |
| Phone Confidence | High / Medium / Low |
| Address | Final extracted address |
| Address Source URL | Source page where address was found |
| Address Pattern Hit | Rule number(s) matched |
| Address Confidence | High / Medium / Low |
| Mission | Final extracted mission |
| Mission Source URL | Source page where mission was found |
| Mission Pattern Hit | Rule number(s) matched |
| Mission Confidence | High / Medium / Low |
| Vision | Final extracted vision |
| Vision Source URL | Source page where vision was found |
| Vision Pattern Hit | Rule number(s) matched |
| Vision Confidence | High / Medium / Low |
| Notes | mismatch / duplicate / missing / needs review |

---

# Final Practical Rule
For every extracted field, always preserve:

1. **Value**
2. **Source URL**
3. **Pattern matched**
4. **Confidence**
