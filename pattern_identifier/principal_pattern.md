# 2. Principal Name & Details Pattern

## Goal
Extract the **actual school principal name**, avoiding confusion with chairman, secretary, correspondent, director, or generic uses of the word `principal`.

## Final 15 Rules

1. **Dedicated Page Slug Priority**  
   Prioritize URLs containing `principal`, `principal-message`, `from-the-principal`, `desk-of-principal`, `headmistress`, or `headmaster`.

2. **Navigation Anchor Priority**  
   Follow navigation links such as `Principal?s Message`, `From the Principal?s Desk`, `Message from Principal`, `Headmaster?s Desk`, `Headmistress Desk`.

3. **Heading Exact / Near-Exact Match**  
   Search headings like `From the Principal?s Desk`, `Principal?s Message`, `Message from the Principal`, `Principal`, `Head of School`.

4. **Message Block Extraction**  
   Once a principal heading is found, extract the surrounding main content block and inspect its ending/signature.

5. **Sign-off Capture**  
   Search the final part of long message blocks for patterns such as `Regards`, `Warm Regards`, `Yours sincerely`, followed by a person name and designation.

6. **Designation-Linked Name Extraction**  
   Capture names that occur near words such as `Principal`, `Headmistress`, `Headmaster`, `School Principal`, `Academic Head`.

7. **Image + Caption Heuristic**  
   Inspect image `alt` text, figure captions, adjacent bold text, or profile card captions where the image appears to represent the principal.

8. **Honorific / Qualification Awareness**  
   Support names with prefixes like `Dr.`, `Mrs.`, `Ms.`, `Mr.`, `Fr.`, `Rev.`, `Sr.` and suffixes like `M.A.`, `M.Sc.`, `B.Ed.`, `Ph.D.`

9. **Staff / Profile Card Scanning**  
   On team, staff, leadership, or management pages, extract names where the role/designation explicitly equals `Principal`.

10. **Disclosure Cross-Check**  
   Compare the extracted name against Mandatory Public Disclosure, CBSE disclosure blocks, Appendix IX pages, or academic staff tables.

11. **Contact / Office Bearer Fallback**  
   Some sites list principal under office contacts or school administration blocks. Use these only if designation clearly says `Principal`.

12. **PDF Fallback**  
   Inspect linked disclosure PDFs, staff directories, academic documents, or prospectus PDFs for principal name.

13. **Role Ambiguity Filtering**  
   Do not confuse principal with:
   - Chairman
   - Secretary
   - Correspondent
   - Founder
   - Director
   - Trustee
   - Dean

14. **Generic Word Filtering**  
   Ignore phrase-level usages such as:
   - `principal focus`
   - `principal reason`
   - `principal objective`

15. **Final Validation Rule**  
   Finalize a principal name only when at least one of these holds:
   - found on dedicated principal page
   - found in profile card with designation `Principal`
   - found in disclosure/staff table
   - found as signature + designation pair

## Additional Parser Notes (2026-03)

- Accept designation-in-parentheses patterns such as `Mrs. B Hemamalini (Principal)`.
- Accept uppercase or initial-based names near principal labels (e.g., `B HEMAMALINI`, `R. KALAIVANI`).
- Reject lowercase phrase captures near `principal` (for example: `to provide a full`) unless they pass person-name validation.
- On dedicated principal pages, prioritize the nearest heading/profile name before generic paragraph text.

## Recommended Confidence
- **High**: dedicated principal page + explicit designation
- **Medium**: staff/management section with exact role match
- **Low**: inferred only from message text or indirect mention
