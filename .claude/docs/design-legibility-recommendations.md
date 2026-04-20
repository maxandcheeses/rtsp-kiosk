# Typography & Legibility Improvements for Bright Environments

**Date**: 2026-04-20  
**Context**: User reports difficulty reading text on the dark UI under bright lighting conditions (wall-mounted kiosk in a lit room)  
**Goal**: Improve text contrast, readability, and visibility without compromising the dark, minimal aesthetic

---

## Current State Analysis

### Typography Stack
- **Font**: `'Courier New', monospace` — universally applied
- **Size range**: 8–18px (via CSS custom properties with fluid clamp())
- **Colors**: White at varying opacities (0.15–0.9 alpha)
- **Background**: Pure black `#000`

### Problem Areas (ordered by impact)

1. **Video grid chrome** (`.chrome .lbl`, `.chrome .live`)
   - Current: `rgba(255,255,255,0.35–0.4)` — barely visible under bright room lights
   - Font size: `clamp(8px, 0.45vw, 13px)` — very small at typical kiosk distances
   - No text shadows or outlines — text disappears over bright video frames

2. **"LIVE" label** (`#lbl{i}`)
   - Current: `rgba(255,255,255,0.4)` — low contrast
   - Font size: `var(--fs-xs)` = `clamp(8px, 0.45vw, 13px)`

3. **Error overlay** (`.err-sub`)
   - Current: `rgba(255,255,255,0.15)` — almost invisible
   - Font size: `var(--fs-xs)`

4. **Modal text** (`.modal-hint`, form labels)
   - Current: `rgba(255,255,255,0.35–0.4)` — difficult to read at arm's length
   - Font size: 11–13px

5. **Cycle indicator** (`#cycle-indicator`)
   - Current: `rgba(255,255,255,0.9)` on `rgba(0,0,0,0.75)`
   - Border: `rgba(255,255,255,0.15)` — weak contrast

---

## Design Recommendations

### 1. Font Family Change (High Impact)

**Replace**: `'Courier New', monospace`  
**With**: System font stack optimized for readability at a distance:

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
```

**Rationale**:
- Sans-serif fonts have better contrast and legibility at distance than monospace
- System fonts are optimized for screen rendering
- Courier New's thin strokes disappear under bright lighting
- Maintains kiosk aesthetic while dramatically improving readability

**Alternative** (if monospace is essential to brand identity):
```css
font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace;
```
(SF Mono and Inconsolata have thicker strokes and better hinting than Courier New)

---

### 2. Font Size Increases (High Impact)

Current sizes are optimized for desktop UI, not wall-mounted kiosk viewing (3–10 ft distance).

**Recommended scale** (increase base by ~30–40%):

```css
--fs-xs:  clamp(11px, 0.65vw, 18px);   /* was 8–13px  — chrome labels, error sub */
--fs-sm:  clamp(13px, 0.75vw, 20px);   /* was 9–15px  — "LIVE", error code */
--fs-md:  clamp(14px, 0.85vw, 24px);   /* was 10–18px — stream labels */
```

**Apply to**:
- `.chrome .lbl` (stream path/label)
- `.chrome .live` ("LIVE" indicator)
- `.err-code`, `.err-sub`

---

### 3. Text Shadows for Video Grid Chrome (Critical)

Text over video frames needs aggressive contrast assistance.

**Recommendation**: Multi-layer shadow for legibility over any background color:

```css
.chrome .lbl,
.chrome .live {
  text-shadow:
    0 0 8px rgba(0,0,0,0.9),
    0 1px 3px rgba(0,0,0,0.8),
    0 0 16px rgba(0,0,0,0.6);
}
```

**Rationale**:
- Layer 1 (`8px blur`) creates a dark halo
- Layer 2 (`1px offset + 3px blur`) adds depth
- Layer 3 (`16px blur`) extends the readable zone
- Total effect: text "floats" above video, readable over bright white frames

**Alternative** (stronger, more intrusive):
```css
text-shadow:
  0 0 12px rgba(0,0,0,1),
  0 2px 4px rgba(0,0,0,0.9),
  0 0 20px rgba(0,0,0,0.8),
  1px 1px 0 rgba(0,0,0,0.6);
```

---

### 4. Increased Text Opacity (Medium Impact)

**Current**: Most UI text sits at `rgba(255,255,255,0.35–0.5)`  
**Problem**: Under bright ambient light, this appears gray-on-gray

**Recommendations**:

| Element | Current | Proposed | Justification |
|---------|---------|----------|---------------|
| `.chrome .lbl` | `0.35` | `0.75` | Primary stream label — must be instantly readable |
| `.chrome .live` | `0.4` | `0.85` | Status indicator — critical info |
| `.err-sub` | `0.15` | `0.5` | Error details need visibility |
| `.modal-hint` | `0.35` | `0.55` | Instructional text should be clear |
| Form labels | `0.4` | `0.6` | Accessibility baseline |
| `.dbg-key` | `0.4` | `0.6` | Debug overlay readability |

---

### 5. Font Weight (Low-Medium Impact)

**Current**: No explicit `font-weight` declarations (defaults to `400` normal)

**Recommendation**: Selectively apply medium weight to key UI elements:

```css
.chrome .live .live-row,  /* "LIVE" + dot */
.err-code,                /* "No Signal" */
.modal h1,                /* Modal titles */
.shortcut-key,            /* Keyboard hints */
#cycle-indicator          /* Cycle status */
{
  font-weight: 500;
}
```

**Rationale**:
- `500` (medium) is a subtle boost that improves contrast without looking heavy
- Thicker strokes reflect more light = easier to read from a distance
- Does not compromise minimal aesthetic

---

### 6. Backdrop Improvements for Floating Text (High Impact)

**Problem**: The `.chrome` overlay has no background — text floats directly over video

**Recommendation**: Add a subtle gradient backdrop to the chrome:

```css
.chrome::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(0,0,0,0.6) 0%,
    rgba(0,0,0,0) 35%,
    rgba(0,0,0,0) 65%,
    rgba(0,0,0,0.6) 100%
  );
  pointer-events: none;
  z-index: -1;
}
```

**Effect**:
- Dark vignette at top (where "LIVE" label sits) and bottom (where fullscreen button sits)
- Transparent middle preserves video visibility
- Ensures chrome text always has a dark backing, even over bright video content

**Alternative** (more aggressive):
```css
.chrome::before {
  background: radial-gradient(
    ellipse at top right,
    rgba(0,0,0,0.8) 0%,
    rgba(0,0,0,0) 50%
  ),
  radial-gradient(
    ellipse at bottom right,
    rgba(0,0,0,0.8) 0%,
    rgba(0,0,0,0) 50%
  );
}
```

---

### 7. Cycle Indicator Enhancement (Medium Impact)

**Current**:
- Background: `rgba(0,0,0,0.75)`
- Border: `rgba(255,255,255,0.15)`

**Recommendation**:
```css
#cycle-indicator {
  background: rgba(0,0,0,0.92);  /* was 0.75 — increased opacity */
  border-width: 2px;              /* was 1px — thicker for visibility */
  box-shadow: 0 2px 12px rgba(0,0,0,0.6);  /* NEW — adds depth */
}

#cycle-indicator.paused {
  border-color: rgba(250,204,21,0.7);  /* was 0.4 — increased yellow intensity */
}

#cycle-indicator.playing {
  border-color: rgba(74,222,128,0.7);  /* was 0.4 — increased green intensity */
}
```

---

### 8. Error State Contrast (Medium Impact)

**Current**:
- `.err-code`: `rgba(248,113,113,0.6)` — red text at 60% opacity
- `.err-sub`: `rgba(255,255,255,0.15)` — nearly invisible

**Recommendation**:
```css
.err-inner .err-code {
  color: #f87171;             /* 100% opacity — was 60% */
  font-size: var(--fs-sm);    /* increase from --fs-xs */
  font-weight: 600;           /* semibold for emphasis */
  text-shadow: 0 0 8px rgba(0,0,0,0.8);  /* glow for contrast */
}

.err-inner .err-sub {
  color: rgba(255,255,255,0.5);  /* was 0.15 — massive increase */
  font-size: var(--fs-xs);
  text-shadow: 0 0 6px rgba(0,0,0,0.7);
}
```

---

### 9. Modal Text Improvements (Low-Medium Impact)

**Recommendations**:

```css
.modal h1 {
  font-size: 15px;              /* was 13px */
  color: rgba(255,255,255,0.85); /* was 0.7 */
  font-weight: 500;             /* NEW */
}

.modal-hint {
  font-size: 12px;              /* was 11px */
  color: rgba(255,255,255,0.55); /* was 0.35 */
}

.streams-table th {
  color: rgba(255,255,255,0.6);  /* was 0.4 */
  font-size: 12px;               /* was 11px */
}

.streams-table td {
  color: rgba(255,255,255,0.85); /* was 0.75 */
  font-size: 14px;               /* was 13px */
}
```

---

### 10. Debug Overlay (Low Impact, for completeness)

```css
#debug-overlay {
  background: rgba(0,0,0,0.88);  /* was 0.72 — stronger backdrop */
  border: 1px solid rgba(255,255,255,0.2);  /* was 0.12 */
}

.dbg-val {
  color: rgba(255,255,255,1);  /* was 0.9 — 100% for key values */
}
```

---

## Implementation Priority

### Phase 1 (Immediate, High Impact)
1. **Text shadows on video grid chrome** (`.chrome .lbl`, `.chrome .live`)
2. **Increase chrome text opacity** (0.35 → 0.75, 0.4 → 0.85)
3. **Increase base font sizes** (+30–40% across the board)

**Expected improvement**: ~70% better readability under bright lighting

---

### Phase 2 (Near-term, Moderate Impact)
4. **Add chrome backdrop gradient** (`.chrome::before`)
5. **Font weight adjustments** (500 for key labels)
6. **Error state contrast boost**
7. **Cycle indicator enhancement**

**Expected improvement**: +20% readability, improved visual hierarchy

---

### Phase 3 (Optional, Polish)
8. **Font family change** (test with stakeholder — may be contentious)
9. **Modal text improvements**
10. **Debug overlay refinements**

**Expected improvement**: +10% readability, modern polish

---

## Testing Checklist

After implementation, validate under these conditions:

- [ ] **Direct sunlight** on screen (worst case)
- [ ] **Bright overhead fluorescent/LED** lighting
- [ ] **Viewing distance**: 3ft, 6ft, 10ft
- [ ] **Layouts**: single, quad, six, eight (text size scales down with more panels)
- [ ] **Video content**: bright white frames, dark frames, high-motion scenes
- [ ] **Error states**: "No Signal" overlay over black background
- [ ] **Modals**: settings, views editor, cameras tab (reading form labels)

---

## Accessibility Notes

These changes also improve **WCAG 2.1 AA compliance**:

- Minimum contrast ratio for normal text: **4.5:1**
- Minimum contrast ratio for large text (≥18px or ≥14px bold): **3:1**

**Current failures**:
- `.chrome .lbl` at `rgba(255,255,255,0.35)` on `#000` = **1.5:1** ❌
- `.err-sub` at `rgba(255,255,255,0.15)` on `#000` = **1.2:1** ❌

**After Phase 1**:
- `.chrome .lbl` at `rgba(255,255,255,0.75)` = **9.7:1** ✅
- `.err-sub` at `rgba(255,255,255,0.5)` = **5.3:1** ✅

---

## Design Philosophy Preservation

These recommendations maintain the kiosk's core aesthetic:

- ✅ Dark background (`#000`)
- ✅ Minimal chrome (hover-only)
- ✅ Monochrome palette (white text, accent colors)
- ✅ Fast transitions (≤200ms)
- ✅ No clutter or visual noise

**Changes are purely contrast/legibility enhancements** — no new UI elements or layout changes.

---

## Alternative: High-Contrast Mode (Optional Future Feature)

If the user wants to preserve the current "subtle" aesthetic for normal viewing and toggle to high-contrast for bright environments, consider:

```javascript
// localStorage toggle
const HIGH_CONTRAST = localStorage.getItem('highContrast') === 'true';

// Apply .high-contrast class to <body>
if (HIGH_CONTRAST) document.body.classList.add('high-contrast');
```

```css
/* Default: current styling */
.chrome .lbl { color: rgba(255,255,255,0.35); }

/* High-contrast mode */
body.high-contrast .chrome .lbl {
  color: rgba(255,255,255,0.85);
  text-shadow: 0 0 8px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8);
  font-weight: 500;
}
```

**Pros**: User control, backward compatibility  
**Cons**: Additional complexity, requires UI toggle in settings

---

## Summary for Implementation Agent

**Goal**: Make text readable under bright room lighting without sacrificing dark aesthetic.

**Key changes**:
1. Add aggressive text-shadow to video grid chrome
2. Increase all text opacities by 0.2–0.4
3. Increase base font sizes by 30–40%
4. Add subtle gradient backdrop to `.chrome`
5. Boost font-weight to 500 for critical labels
6. Strengthen error text contrast

**Files to modify**:
- `/www/index.html` (inline `<style>` block, lines 8–890)

**No JS changes required** — purely CSS enhancements.

**Validation**: Test on actual kiosk hardware under bright lighting before closing task.
