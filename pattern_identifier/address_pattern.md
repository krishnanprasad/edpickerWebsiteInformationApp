# 3. Address Pattern

## Goal
Extract the **official school postal address**, preferably full address including locality, city, state, and PIN code.

## Final 15 Rules

1. **Address Label Anchors**  
   Search for labels such as `Address`, `Location`, `Campus`, `School Address`, `Registered Office`, `Visit us`, `Find us at`.

2. **Contact Page First Priority**  
   Contact/Reach Us pages often contain the cleanest official address. Prefer these over short homepage snippets.

3. **Footer Block Scanning**  
   Many schools repeat the official address in the footer across all pages. Repeated footer addresses should rank highly.

4. **HTML5 `<address>` Tag Extraction**  
   Extract and normalize all text inside `<address>` tags.

5. **Map Embed Proximity**  
   If a Google Map iframe or maps embed exists, extract nearby visible address text from sibling/parent blocks.

6. **Map-Link Anchor Handling**  
   Look for links such as `Locate Us`, `View Map`, or `Google Map`. The adjacent visible text often contains the official written address.

7. **PIN Code Anchor Rule**  
   Address blocks ending in a valid Indian 6-digit PIN code should receive higher confidence.

8. **Line Break Reconstruction**  
   Rebuild addresses split across `<br>` tags, lists, paragraphs, or footer columns into one normalized address.

9. **Locality Keyword Detection**  
   Detect patterns with common Indian location words such as `Road`, `Street`, `Nagar`, `Avenue`, `Layout`, `Main Road`, `Near`, `Opp`, `Behind`, `Post`, `Taluk`, `District`.

10. **City / State Anchoring**  
   Search for location markers such as `Coimbatore`, `Chennai`, `Tamil Nadu`, etc., and extract the surrounding text window.

11. **Header / Top-Bar Snippet Handling**  
   Use short top-strip address snippets as clues, but prefer fuller versions from contact/footer/disclosure areas.

12. **Disclosure Page Cross-Check**  
   Validate address against Mandatory Public Disclosure / CBSE / Appendix IX sections if present.

13. **PDF Address Fallback**  
   Inspect linked PDFs such as prospectus, brochure, disclosure PDF, or school handbook for formal address blocks.

14. **Directions / Reach Us Page Fallback**  
   Follow menu items such as `How to Reach Us`, `Directions`, or `Reach Us` when present.

15. **Negative Filtering**  
   Do not misclassify as official address:
   - city-only text
   - event venue
   - alumni office
   - trustee residence
   - route-only phrases like `Open in Google Maps`

## Recommended Confidence
- **High**: contact/footer/disclosure address with city and PIN code
- **Medium**: map-adjacent address block or structured address without PIN
- **Low**: short snippet with weak context
