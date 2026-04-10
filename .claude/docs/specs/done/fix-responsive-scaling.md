# Plan: Fix Responsive Scaling for Different Screen Sizes

## Task Description
The current implementation has no responsive design—font sizes, text scaling, and element positioning remain static across all screen sizes. This results in poor UX on larger screens (everything too small) and can cause issues on smaller screens (potential overflow). The layout uses fixed `fr` grid units that don't adapt to viewport size, and all typography/overlay elements use hardcoded pixel values without any media queries or viewport-relative units.

## Objective
Implement responsive scaling that automatically adjusts font sizes, text scaling, element positioning, and UI component sizes based on screen dimensions, providing optimal UX across 1920px monitors down to mobile devices (360px).

## Problem Statement
**Current State:** No responsive design patterns exist in the codebase. All typography uses fixed `font-size: 14px`, overlay elements use hardcoded `width: 200px`, and grid layouts rely solely on `fr` units without viewport-aware adaptations.

**Impact:**
- Large screens (2560x1440+): UI elements appear too small, hard to read/interact with
- Small screens (<800px): Potential text overflow, cramped controls
- No visual feedback or adaptive layout adjustments based on viewport width

## Relevant Files

### Primary Files to Modify:
- `www/index.html` — CSS styling (typography, overlays, chrome elements)
- `www/js/layouts.js` — Layout definitions and SVG generation with font sizing

### Supporting Files (for reference):
- `www/js/ui.js` — Potential responsive utilities for viewport detection
- `www/js/config.js` — App-wide constants like min/max sizes

## Implementation Phases

### Phase 1: CSS Responsive Foundation (`www/index.html`)
Add responsive scaling to all UI elements using CSS variables and media queries.

### Phase 2: Typography Scaling
Implement fluid typography for all text elements (titles, labels, overlays, status text) using `vw` units with fallbacks.

### Phase 3: Element Size Adjustments
Scale chrome elements (buttons, overlays, loading spinners, error messages) based on viewport width.

### Phase 4: Grid Layout Adaptation
Add responsive grid adjustments for smaller screens to prevent overflow and improve usability.

### Phase 5: SVG Layout Preview Updates
Update the layout picker SVGs to show appropriately-sized preview text.

## Step by Step Tasks

### 1. Define CSS Variables in `www/index.html`
Create a responsive scale system using CSS custom properties:
```css
:root {
  /* Base scale factors based on viewport width */
  --scale-factor: min(1, 1920 / env(--viewport-width));
  
  /* Typography scales */
  --fs-xs: clamp(9px, 12px * var(--scale-factor), 13px);
  --fs-sm: clamp(11px, 14px * var(--scale-factor), 16px);
  --fs-md: clamp(13px, 16px * var(--scale-factor), 20px);
  --fs-lg: clamp(15px, 18px * var(--scale-factor), 24px);
  --fs-xl: clamp(17px, 20px * var(--scale-factor), 32px);
  
  /* Element size scales */
  --size-xs: clamp(24px, 32px * var(--scale-factor), 48px);
  --size-sm: clamp(48px, 64px * var(--scale-factor), 96px);
  --size-md: clamp(64px, 120px * var(--scale-factor), 140px);
  --size-lg: clamp(96px, 160px * var(--scale-factor), 200px);
}

@media (max-width: 1280px) { :root { --scale-factor: min(1, 1280 / env(--viewport-width)); } }
@media (max-width: 900px)  { :root { --scale-factor: min(1,  900  / env(--viewport-width)); } }
```

### 2. Apply Responsive Typography to `.cell .chrome .live .lbl`
Replace the static font size with CSS variable:
```css
.cell .chrome .live .lbl {
  /* Current: font-size: 14px */
  font-size: var(--fs-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### 3. Responsive `.err-overlay` and `.err-inner` Sizes
Scale error overlay from fixed `200px` to responsive:
```css
.err-overlay {
  /* Current: width: 200px */
  min-width: var(--size-md);
  max-width: calc(100% - 16px);
}

.err-inner {
  padding: calc(var(--fs-sm) * 1.5) var(--fs-md);
}

.err-code {
  /* Current: font-size: 14px */
  font-size: var(--fs-md);
}

.err-sub {
  /* Current: font-size: 13px */
  font-size: var(--fs-sm);
}
```

### 4. Responsive `.loading` Spinner
Scale spinner size and animation speed:
```css
.loading {
  width: var(--size-md);
  height: var(--size-md);
}

.loading .ring {
  /* Scale ring thickness based on size */
  width: calc(var(--size-md) * 0.3);
  height: calc(var(--size-md) * 0.3);
}
```

### 5. Responsive `.btn-fs` (Fullscreen Button)
Scale icon and button padding:
```css
.btn-fs svg {
  /* Current: width="13" height="13" */
  width: calc(var(--fs-sm) * 1.5);
  height: calc(var(--fs-sm) * 1.5);
}

.btn-fs {
  padding: var(--fs-sm) calc(var(--fs-md) * 1.2);
}
```

### 6. Grid Layout Media Queries (`www/index.html`)
Add breakpoint-based layout adjustments:
```css
#wall {
  /* Current: uses gridTemplateColumns from JS */
}

@media (max-width: 1920px) {
  #wall.cell-4 { display: none; } /* Hide one stream on large screens if needed */
}

@media (max-width: 1280px) {
  .cell {
    max-height: calc(100vh - 120px); /* Prevent overflow */
  }
}

@media (max-width: 900px) {
  #wall {
    grid-template-rows: repeat(auto-fit, minmax(var(--size-md), auto));
  }
}
```

### 7. Update `www/js/layouts.js` - Font Sizes in SVG Preview
In `layoutSvgWithNumbers()`, make font sizes responsive based on cell width (already partially done, just ensure consistency):
```javascript
const fs = cellW >= 46 ? 10 : cellW >= 26 ? 8 : 7;
// Consider making this scale with CSS instead of hardcoded values
return `<text ... font-size="${fs}" ...>`;
```

## Testing Strategy

### Manual Testing:
1. Open `www/index.html` in browser (local server)
2. Resize viewport from 360px → 1920px → 2560px
3. Verify:
   - Text remains readable at all sizes
   - No text overflow or cutoff
   - Overlays scale proportionally
   - Chrome elements are easy to click

### Validation Checklist:
- [ ] 360px (mobile): All text visible, no horizontal scroll
- [ ] 768px (tablet): Layout adapts gracefully
- [ ] 1920px (standard large): Elements comfortably sized
- [ ] 2560px+ (4K): Text not too small, controls reachable

## Acceptance Criteria
1. Font sizes scale smoothly from 360px to 2560px viewport widths
2. Overlay elements (`err-overlay`, `loading`) resize proportionally
3. Chrome UI elements (buttons, labels) maintain readability
4. No text overflow or cutoff at any breakpoint
5. Click targets remain ≥ 44px at largest screens
6. Grid layout prevents horizontal scroll on smaller screens

## Validation Commands
```bash
# Serve the app and test responsive scaling
cd /Users/maxwell/Documents/development/rtsp-kiosk
docker compose up -d

# Open browser to http://localhost:8080/www/index.html
# Use browser DevTools device mode to test: iPhone SE, iPad, Desktop (2560px)
```

## Notes
- Uses CSS `clamp()` for smooth scaling between min/max values
- Scale factor approach allows proportional resizing of all elements
- Maintains backward compatibility with existing layouts
- No JavaScript changes needed—pure CSS solution is simpler and more performant
- Consider adding a settings option to override default scale in the future
