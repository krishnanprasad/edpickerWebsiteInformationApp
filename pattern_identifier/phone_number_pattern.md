# 1. Contact / Phone Number Pattern

## Goal
Extract **all usable official school contact numbers**, prioritizing school office/admissions numbers over incidental mobile numbers.

## Final 15 Rules

1. **Direct Label Anchors**  
   Look for labels such as `Phone`, `Ph`, `Tel`, `Telephone`, `Contact`, `Mobile`, `Mob`, `Call`, `Office`, `Reception`, `Front Office`, `Admissions`, `Helpdesk`.

2. **`tel:` Protocol Matching (Highest Confidence)**  
   Extract any number from anchor tags whose `href` starts with `tel:`. Mark these as high-confidence results.

3. **Header / Top-Bar Priority**  
   Scan the top section of the page for phrases such as `Call us`, `Admissions Open`, `For admission contact`, `Enquiry`, `Reach us`.

4. **Footer Repetition Check**  
   Numbers repeated in the footer across multiple pages should be given higher confidence because they are often official institutional contact numbers.

5. **Contact Page Block Priority**  
   On `Contact Us`, `Reach Us`, or `Get in Touch` pages, extract phone values from blocks near headings such as `Contact Info`, `Reach Us`, `Office Address`, `Get in touch`.

6. **Protocol + Label Fusion**  
   If a number appears in a `tel:` link and also next to a visible label such as `Office` or `Admissions`, preserve both the number and its role label.

7. **WhatsApp Integration Handling**  
   Extract from `wa.me/...`, `api.whatsapp.com/...`, or visible WhatsApp contact blocks, but mark these as `WhatsApp contact`, not automatically the primary office number.

8. **Indian Landline Recognition**  
   Detect landline formats such as `0422-xxxxxxx`, `044-xxxxxxx`, `080-xxxxxxx`. These often indicate official school office numbers and should be ranked highly.

9. **Indian Mobile Recognition**  
   Capture mobile patterns such as `+91 98xxxxxxxx`, `+91-9xxxxxxxxx`, `98xxx xxxxx`, or `9xxxxxxxxx`. Normalize internally.

10. **Split / Decorated Format Tolerance**  
   Handle numbers broken by spaces, dots, slashes, brackets, or separators such as `0422 245 xxxx`, `0422.245.xxxx`, `(0422)245xxxx`, `+91 / 98xxxxxxx`.

11. **Icon Proximity Extraction**  
   Extract text immediately following phone/communication icons, including FontAwesome icons, inline SVGs, or adjacent text nodes.

12. **Multi-Number Container Parsing**  
   Parse strings like `Office: 0422-xxxxxxx | Mobile: 98xxxxxxxx | Admissions: 97xxxxxxxx` into separate structured values.

13. **Contact Role Classification**  
   If multiple numbers appear, classify by role where possible: `Office`, `Admissions`, `Transport`, `Hostel`, `Principal Office`, `WhatsApp`, `General Enquiry`.

14. **PDF Fallback Extraction**  
   If website contact data is weak or missing, inspect linked PDFs such as prospectus, brochure, handbook, disclosure PDF, or Appendix IX-related documents.

15. **Negative Filtering**  
   Ignore values that are actually:
   - PIN codes
   - affiliation numbers
   - admission IDs
   - student counts
   - fee amounts
   - years
   - visitor counters

## Recommended Confidence
- **High**: `tel:` link, or clearly labelled number on contact page/footer
- **Medium**: regex match near contact anchor or icon
- **Low**: standalone number with weak context
