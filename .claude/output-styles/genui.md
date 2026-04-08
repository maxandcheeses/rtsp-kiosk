---
name: GenUI
description: Generative UI with embedded modern styling
---

After every request generate complete, self-contained HTML documents with embedded modern styling and then open it in a browser:

## Workflow

1. After you complete the user's request do the following:
2. Understand the user's request and what HTML content is needed
3. Create a complete HTML document with all necessary tags and embedded CSS styles
4. Save the HTML file to `/tmp/` with a descriptive name and `.html` extension (see `## File Output Convention` below)
5. IMPORTANT: Open the file in the default web browser using the `open` command

## HTML Document Requirements
- Generate COMPLETE HTML5 documents with `<!DOCTYPE html>`, `<html>`, `<head>`, and `<body>` tags
- Include UTF-8 charset and responsive viewport meta tags
- Embed all CSS directly in a `<style>` tag within `<head>`
- Create self-contained pages that work without external dependencies
- Use semantic HTML5 elements for proper document structure
- IMPORTANT: If links to external resources referenced, ensure they are accessible and relevant (footer)
- IMPORTANT: If files are referenced, created a dedicated section for them (footer)

## Visual Theme and Styling
Apply this consistent modern theme to all generated HTML:

**Color Palette:**
- Primary: #3498db (blue)
- Dark: #2c3e50 (dark blue)
- Medium: #34495e (medium gray)
- Light: #f5f5f5 (light gray)
- Info: #3498db / #ebf5fb
- Success: #27ae60 / #eafaf1
- Warning: #f39c12 / #fef9e7
- Error: #e74c3c / #fdedec

**Typography:**
- Body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif
- Code: 'Monaco', 'Courier New', monospace
- Base size: 16px, line-height: 1.6

**Layout:**
- Max width: 900px, centered with auto margins
- Body padding: 20px
- Container: white background, subtle box-shadow, 8px border-radius
- Code blocks: 4px border-radius

**Components:**
- Headers: bottom border accent
- Code blocks: light gray background (#f8f9fa), left accent border (#007acc)
- Inline code: light background, monospace font
- Info/success/warning/error sections: colored left border + tinted background
- Tables: clean borders, alternating row colors
- Lists: proper spacing

## File Output Convention

Save files to `/tmp/` with descriptive names:
```
cc_genui_<concise-description>_YYYYMMDD_HHMMSS.html
```

Example: `cc_genui_stream-status-dashboard_20240115_143022.html`

## Response Format

After generating and opening the file:
1. Briefly describe what HTML was generated
2. State the file path
3. Confirm it was opened in the browser
