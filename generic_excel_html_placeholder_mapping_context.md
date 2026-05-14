# Excel ↔ HTML Placeholder Mapping Context

## Purpose

This context document is for an AI agent that receives:

1. An Excel file containing source copy/content
2. An HTML file containing existing static content

The agent must compare the Excel content with the HTML content and replace matching HTML text/content areas with Excel cell placeholder codes such as `{A1}`, `{B12}`, `{AA35}`.

The goal is to create a reusable HTML template where future Excel uploads can automatically replace placeholders with the corresponding Excel cell values.

This document must be used generically. Do not assume any fixed file name, sheet name, column name, row number, page name, component name, or business category unless the user explicitly provides it.

---

## Core Task

The AI agent must perform only this task:

```txt
Compare Excel content with HTML content
→ Find which Excel cell corresponds to each visible/editable HTML text area
→ Replace that HTML text with a cell placeholder such as {B5}
→ Create a JSON metadata file describing the mapped placeholders
→ Report ambiguous or unmapped areas to the user
```

This is not a task for building a web application.

Do not implement upload UI, preview UI, download UI, Vercel deployment, database, authentication, or runtime logic unless the user separately asks for it.

---

## Inputs

The user may provide:

- One Excel file
- One HTML file
- Optional mapping hints
- Optional target sheet name
- Optional target content area name
- Optional list of fields that should or should not be mapped
- Optional rules for handling empty values, repeated values, links, images, alt text, or disclaimers

The agent must inspect the provided files and infer the mapping where possible.

---

## Outputs

The agent should generate these files:

```txt
mapped.html
placeholderMap.config.json
mapping-report.md
```

### mapped.html

The original HTML with matched text/content replaced by Excel cell placeholders.

Example:

```html
<h2>Original headline text</h2>
```

becomes:

```html
<h2>{B6}</h2>
```

### placeholderMap.config.json

A JSON metadata file that lists each placeholder and its meaning.

Example:

```json
{
    "version": "1.0",
    "mappingType": "excel-cell-placeholder",
    "source": {
        "excelFile": "user-provided",
        "htmlFile": "user-provided"
    },
    "sheets": [
        {
            "sheetName": "detected-or-user-confirmed-sheet",
            "sections": [
                {
                    "key": "section-01",
                    "label": "Section 01",
                    "fields": [
                        {
                            "cell": "B6",
                            "placeholder": "{B6}",
                            "label": "Headline",
                            "htmlContext": "h2 text",
                            "inputType": "textarea",
                            "required": true,
                            "multiline": false,
                            "status": "mapped"
                        }
                    ]
                }
            ]
        }
    ]
}
```

### mapping-report.md

A human-readable report explaining:

- Which sheet was used
- Which Excel cells were mapped
- Which HTML areas were replaced
- Which items were ambiguous
- Which HTML text areas were not mapped
- Which Excel cells looked relevant but were not used
- Questions for the user, if needed

---

## Mapping Principle

Use direct content comparison first.

The agent should compare visible text from the HTML against cell values in the Excel file.

Priority order:

1. Exact text match
2. Exact text match after trimming whitespace
3. Match after normalizing line breaks and repeated spaces
4. Match after decoding HTML entities
5. Partial match for long text blocks
6. Semantic/structural match only when exact matching is not possible

Do not over-rely on HTML class names or selectors.

The main source of truth is the textual relationship between:

```txt
Excel cell value ↔ HTML visible content
```

---

## Placeholder Rule

Use Excel cell address placeholders.

Format:

```txt
{A1}
{B12}
{AA35}
```

Rules:

- Use uppercase column letters.
- Use the actual Excel row number.
- Do not add spaces inside the braces.
- Do not invent custom placeholder names if a cell address can be used.
- The same cell may be used in multiple HTML locations if the same content appears in multiple places.
- Do not replace non-content code, CSS, JS, tracking code, or structural attributes unless the content clearly comes from Excel.

Correct:

```html
<h2>{B6}</h2>
<p>{B7}</p>
```

Incorrect:

```html
<h2>{{headline}}</h2>
<p>{ headline }</p>
<p>{row-7-body}</p>
```

---

## What to Replace

Replace user-visible or content-managed text areas, such as:

- Headings
- Eyebrows / labels
- Body copy
- Descriptions
- Disclaimer text
- CTA button text
- Tab labels
- Accordion titles
- Card titles
- Product/service names
- List item titles
- Image `alt` text, if the alt text matches Excel content
- ARIA labels, if they clearly duplicate user-facing content from Excel

Example:

```html
<a>Learn more</a>
```

may become:

```html
<a>{C12}</a>
```

if the Excel cell `C12` contains `Learn more`.

---

## What Not to Replace

Do not replace:

- CSS
- JavaScript
- Class names
- IDs
- Data attributes used for behavior
- Layout wrappers
- Static system text not present in Excel
- Tracking attributes
- Analytics attributes
- Asset URLs
- Image filenames
- Video filenames
- Form behavior attributes
- Accessibility labels that do not clearly match Excel content
- Comment text unless explicitly requested

Do not replace URLs unless the Excel file clearly contains those URLs and the user expects URL mapping.

---

## Link and CTA Mapping

For CTAs, map text first.

Example:

```html
<a href="/some/path"><span>Learn more</span></a>
```

If Excel contains only `Learn more`, replace only the visible text:

```html
<a href="/some/path"><span>{B12}</span></a>
```

Only replace `href` when:

- The Excel file contains the target URL
- The URL clearly corresponds to the HTML link
- The user confirms links should also be mapped

If unsure, ask the user.

---

## Image Alt Mapping

If image alt text matches an Excel value, replace the alt attribute value with the corresponding cell placeholder.

Example:

```html
<img src="/image.jpg" alt="Product Name">
```

becomes:

```html
<img src="/image.jpg" alt="{B18}">
```

Only do this when the alt text directly corresponds to Excel content.

If the same Excel value is already used as visible CTA text and the image alt duplicates that label, using the same placeholder is allowed.

If unsure whether alt text should be mapped, ask the user.

---

## Empty, N/A, and Placeholder Policy

The agent should not assume one universal empty-value policy.

Use these defaults unless the user specifies otherwise:

```json
{
    "ignoreValues": ["", "N/A", "NA", "-", "—"],
    "emptyValuePolicy": "ask-user-if-structural-impact"
}
```

Rules:

- If an empty or ignored Excel value maps to optional text, it may be omitted from JSON or marked as optional.
- If an empty value affects whether an entire HTML block should be removed or hidden, ask the user.
- Do not delete HTML blocks automatically unless the user explicitly asks.
- Do not infer complex conditional rendering rules without confirmation.

---

## JSON Metadata Rules

The JSON file should describe the placeholders for editing and validation.

It should not depend on fragile CSS selectors unless necessary.

Each field should include:

```json
{
    "cell": "B6",
    "placeholder": "{B6}",
    "label": "Human-readable label",
    "htmlContext": "Short description of where this appears in HTML",
    "inputType": "text | textarea",
    "required": true,
    "multiline": false,
    "status": "mapped | ambiguous | skipped"
}
```

Recommended root structure:

```json
{
    "version": "1.0",
    "mappingType": "excel-cell-placeholder",
    "placeholderPattern": "\\{([A-Z]+[0-9]+)\\}",
    "source": {
        "excelFile": "user-provided",
        "htmlFile": "user-provided"
    },
    "sheets": [],
    "fields": [],
    "ambiguousItems": [],
    "unmappedHtmlTexts": [],
    "unusedExcelCells": [],
    "questions": []
}
```

If the source has clear sections, group fields under sections.

If sections are unclear, use a flat `fields` array.

---

## Matching Strategy

### Step 1. Inspect Excel

- Identify workbook sheets.
- Determine which sheet likely contains the source content.
- Detect cells with meaningful text.
- Ignore empty cells and purely structural labels unless they appear in HTML.
- Preserve exact cell addresses.

If there are multiple possible sheets, ask the user which sheet to use.

### Step 2. Inspect HTML

- Extract visible text nodes.
- Extract candidate attribute values such as `alt`, `aria-label`, and CTA text.
- Ignore CSS, JS, comments, and structural code.
- Preserve enough HTML context to identify where each text appears.

### Step 3. Compare Content

- Match Excel cell values to HTML text.
- Normalize whitespace for comparison.
- Decode HTML entities before comparison.
- Preserve original HTML formatting as much as possible.
- Use exact matches before fuzzy or semantic matches.

### Step 4. Replace HTML Content

- Replace only the matched content value with `{CELL}`.
- Do not rewrite unrelated HTML structure.
- Do not reformat the entire HTML file unless necessary.
- Do not change indentation, class names, IDs, CSS, JS, or asset paths.

### Step 5. Create JSON Metadata

- Add one JSON field per mapped cell.
- If the same cell is used multiple times, note multiple HTML contexts.
- Mark required fields only when clearly essential.
- Use `textarea` for long body copy.
- Use `text` for short labels, button text, titles, and tab names.

### Step 6. Validate

Check:

- Every placeholder in HTML exists in JSON.
- Every JSON placeholder exists in HTML, unless marked as intentionally unused.
- No malformed placeholders exist.
- No accidental replacement occurred inside CSS/JS.
- Repeated content is mapped consistently.
- Ambiguous items are reported instead of guessed.

---

## When to Ask the User

The agent must ask the user when any of the following occurs:

### File or Sheet Ambiguity

- Multiple sheets appear relevant.
- No sheet clearly matches the HTML content.
- The Excel file has several content regions and the target region is unclear.
- The user did not specify which sheet or range to use and auto-detection is uncertain.

### Content Ambiguity

- The same text appears in multiple Excel cells.
- The same HTML text could map to multiple Excel cells.
- Excel content is similar but not exactly the same as HTML content.
- The HTML contains text that appears to be edited from the Excel value.
- A text block in HTML combines multiple Excel cells.
- One Excel cell appears to need splitting across multiple HTML nodes.

### Structure Ambiguity

- The HTML order differs from the Excel order.
- Accordion, tab, card, or section order does not match between Excel and HTML.
- A repeated component uses similar content and mapping order is unclear.
- Some HTML sections have no clear Excel counterpart.

### Policy Ambiguity

- It is unclear whether to map image alt text.
- It is unclear whether to map links or URLs.
- It is unclear whether `N/A` should become empty text, hidden block, or remain unchanged.
- It is unclear whether an empty Excel value should remove the corresponding HTML block.
- It is unclear whether repeated text should share one placeholder or use different cells.

### Safety or Data Integrity Ambiguity

- The mapping would require changing structural HTML, scripts, CSS, or behavior attributes.
- The agent would need to delete or rearrange HTML blocks.
- The agent would need to infer missing content that is not present in Excel.
- The agent cannot confidently verify that the generated placeholders match the intended content.

When asking, provide a concise list of unresolved items and continue with all confident mappings.

Do not stop the entire task just because some mappings are ambiguous.

---

## Ambiguity Handling Format

Use this format in `mapping-report.md`:

```md
## Questions for User

1. The HTML text "..." appears to match both Excel cells B12 and C18. Which cell should be used?
2. The Excel value in D20 is "N/A", but the HTML contains a visible card. Should this card remain, become empty, or be removed?
3. The HTML has image alt text "..." but no exact Excel match. Should alt text be mapped or left unchanged?
```

Use this format in JSON:

```json
{
    "ambiguousItems": [
        {
            "htmlText": "Example text",
            "candidateCells": ["B12", "C18"],
            "reason": "Same or similar text appears in multiple cells",
            "question": "Which Excel cell should be used for this HTML text?"
        }
    ]
}
```

---

## Output Quality Rules

The agent must:

- Preserve the original HTML structure.
- Replace only confirmed content text.
- Avoid broad, destructive rewrites.
- Keep placeholders human-readable and directly tied to Excel cell addresses.
- Generate a JSON file that can drive an editing UI later.
- Generate a report explaining what was mapped and what needs confirmation.
- Be explicit about uncertainty.
- Never silently guess ambiguous mappings.

---

## Final Checklist

Before returning the result, verify:

```txt
[ ] mapped.html was created
[ ] placeholderMap.config.json was created
[ ] mapping-report.md was created
[ ] HTML placeholders use {CELL_ADDRESS} format
[ ] All HTML placeholders are listed in JSON
[ ] All JSON mapped placeholders appear in HTML
[ ] No CSS/JS/class/id was accidentally replaced
[ ] Ambiguous mappings are reported
[ ] User questions are listed when needed
[ ] Original HTML structure is preserved as much as possible
```

---

## Final Response Format

When reporting back to the user, include:

```txt
- Created files
- Number of placeholders inserted
- Number of JSON fields created
- Number of ambiguous items
- Number of unmapped HTML text items
- Questions that need user confirmation
```

Do not claim 100% accuracy if any ambiguity remains.
