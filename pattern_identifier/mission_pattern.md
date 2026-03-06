# 4. Mission Pattern

## Goal
Extract the school?s **mission statement**, whether explicitly labelled or embedded in About/Philosophy/Ethos content.

## Final 15 Rules

1. **Exact Heading Match**  
   Search headings matching `Mission`, `Our Mission`, `School Mission`, `Mission Statement`.

2. **Combined Heading Handling**  
   Detect sections like `Vision & Mission`, `Mission / Vision`, or `Our Vision and Mission`.

3. **Sibling Extraction Rule**  
   Once a mission heading is found, extract the immediate following paragraph, block, list, or container.

4. **About Page Action-Verbs Heuristic**  
   On About/Philosophy/Ethos pages, look for paragraphs starting with phrases like `To nurture`, `To empower`, `To provide`, `To foster`, `We strive to`, `We aim to`.

5. **Action-Oriented Language Filter**  
   Mission statements often describe what the school actively does in the present or ongoing sense.

6. **Bullet-List Support**  
   If a mission heading is followed by bullet points, capture the bullet block as the mission content.

7. **Emphasis / Callout Scan**  
   Inspect `<strong>`, `<em>`, `<blockquote>`, or visually highlighted content blocks on about/philosophy pages.

8. **Core Values / Philosophy Proximity**  
   If the site contains headings like `Core Values`, `Philosophy`, `Our Ethos`, `Beliefs`, inspect nearby content for mission text.

9. **Text-Length Heuristic**  
   Mission statements are often between 15 and 120 words. Very short text may be a label; very long text may be school history.

10. **Verb-Density Heuristic**  
   Give higher confidence when verbs like `nurture`, `educate`, `develop`, `foster`, `enable`, `prepare`, `instill`, `provide` appear.

11. **About Page Intro Block Fallback**  
   The first substantial paragraph under `About Us` can be mission-like when it uses action-oriented educational language.

12. **Philosophy / Ethos Page Fallback**  
   Follow menu items labelled `Philosophy`, `Ethos`, `Our Philosophy`, or `School Philosophy`.

13. **PDF Fallback**  
   Inspect handbook, quality policy, school profile, or prospectus PDFs when no clear mission is present on the website.

14. **Principal Message as Weak Support Only**  
   If the principal?s message restates mission-like goals, use it as low-confidence supporting evidence, not as the primary source.

15. **Negative Filtering**  
   Ignore promotional text such as:
   - `Admissions Open`
   - `Best CBSE School`
   - short slogans
   - ad-style lines  
   unless explicitly labelled as mission

## Recommended Confidence
- **High**: explicit mission heading + adjacent content
- **Medium**: About/Philosophy text with strong action-oriented language
- **Low**: inferred from generic page intro or principal message
