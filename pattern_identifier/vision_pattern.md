# 5. Vision Pattern

## Goal
Extract the school?s **vision statement**, usually aspirational, future-facing, and often shorter than the mission.

## Final 15 Rules

1. **Exact Heading Match**  
   Search headings matching `Vision`, `Our Vision`, `School Vision`, `Vision Statement`.

2. **Combined Block Handling**  
   Detect combined sections such as `Vision & Mission`, `Mission and Vision`, or `Our Vision and Mission`.

3. **Sibling Extraction Rule**  
   Once a vision heading is found, extract the immediate following paragraph, list, or structured block.

4. **Future-Oriented Wording**  
   Look for wording such as `To be`, `To create`, `To emerge`, `To become`, `To shape`, `To inspire future...`

5. **Aspirational Keyword Density**  
   Give higher confidence to phrases involving `global citizens`, `leaders`, `excellence`, `holistic development`, `lifelong learners`, `future-ready`, `center of excellence`.

6. **Short Statement Bias**  
   Vision statements are often shorter and more concise than mission statements. Prefer shorter aspirational blocks when both are present.

7. **Parallel Structure Check**  
   If mission appears inside a card, panel, tab, or block, inspect adjacent matching structures for vision content.

8. **About / Ethos Page Fallback**  
   If no explicit heading exists, inspect About/Philosophy/Ethos pages for future-facing institutional statements.

9. **Motto Distinction**  
   A motto is not always a vision. If the text is very short or slogan-like, mark it as possible motto/possible vision unless the heading confirms Vision.

10. **Accordion / Tab UI Inspection**  
   Inspect hidden DOM content such as tabs, accordions, or collapsible content; do not rely only on initially visible text.

11. **Hero Banner / Crest Proximity as Weak Fallback**  
   If homepage or about-page hero text strongly matches vision-like future language, treat it only as low-confidence fallback unless clearly labelled.

12. **Founder / Chairman / Principal Message Fallback**  
   Use future-facing closing lines from leadership messages only as supporting evidence, not as primary vision source.

13. **PDF Fallback**  
   Inspect annual report, handbook, school profile, or disclosure-related PDFs when no clear website vision statement exists.

14. **Sentence Reconstruction**  
   Merge fragmented lines, spans, or decorative separators into one normalized vision statement.

15. **Negative Filtering**  
   Ignore:
   - event slogans
   - annual day themes
   - ad copy
   - year-specific goals
   - generic motivational lines  
   unless clearly tied to `Vision`

## Recommended Confidence
- **High**: explicit vision heading + adjacent content
- **Medium**: clear aspirational text on About/Philosophy page
- **Low**: slogan/banner/inferred leadership message
