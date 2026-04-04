// ═══════════════════════════════════════════════════════
// LAYOUTS
// Each layout defines:
//   streams  — how many streams to show
//   css      — grid-template-columns + grid-template-rows
//   spans    — optional per-cell {col, row} span overrides
// ═══════════════════════════════════════════════════════
const LAYOUTS = {
  'single':         { streams: 1, css: { cols: '1fr',           rows: '1fr' } },
  'two-col':        { streams: 2, css: { cols: '1fr 1fr',       rows: '1fr' } },
  'two-row':        { streams: 2, css: { cols: '1fr',           rows: '1fr 1fr' } },
  // primary-right: 0=large-left, 1=top-right, 2=bottom-right
  'primary-right':  { streams: 3, css: { cols: '2fr 1fr',       rows: '1fr 1fr' },
                      spans: [{ col: '1', row: '1 / 3' }] },
  // primary-left:  0=top-left, 1=bottom-left, 2=large-right
  'primary-left':   { streams: 3, css: { cols: '1fr 2fr',       rows: '1fr 1fr' },
                      spans: [null, null, { col: '2 / 3', row: '1 / 3' }] },
  // primary-bottom: 0=large-top, 1=bottom-left, 2=bottom-right
  'primary-bottom': { streams: 3, css: { cols: '1fr 1fr',       rows: '2fr 1fr' },
                      spans: [{ col: '1 / 3', row: '1 / 2' }] },
  // primary-top:   0=top-left, 1=top-right, 2=large-bottom
  'primary-top':    { streams: 3, css: { cols: '1fr 1fr',       rows: '1fr 2fr' },
                      spans: [null, null, { col: '1 / 3', row: '2 / 3' }] },
  'quad':           { streams: 4, css: { cols: '1fr 1fr',       rows: '1fr 1fr' } },
  'six':            { streams: 6, css: { cols: '1fr 1fr 1fr',   rows: '1fr 1fr' } },
  'eight':          { streams: 8, css: { cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr' } },
};

// ═══════════════════════════════════════════════════════
// Best layout — picks the most suitable layout for N streams
// 1→single, 2→two-col, 3→primary-right, 4→quad,
// 5-6→six, 7-8→eight
// ═══════════════════════════════════════════════════════
function bestLayout(count) {
  if (count <= 1) return 'single';
  if (count === 2) return 'two-col';
  if (count === 3) return 'primary-right';
  if (count === 4) return 'quad';
  if (count <= 6) return 'six';
  return 'eight';
}

// ═══════════════════════════════════════════════════════
// Active peer connections — tracked so we can close them
// ═══════════════════════════════════════════════════════
let activePCs = [];

function stopAll() {
  activePCs.forEach(pc => { try { pc.close(); } catch(e){} });
  activePCs = [];
}

// ═══════════════════════════════════════════════════════
// Build the wall DOM for a given layout
// ═══════════════════════════════════════════════════════
function applyLayout(name) {
  const layout = LAYOUTS[name];
  if (!layout) return;

  // Only close connections for streams NOT in the incoming layout.
  // Streams that remain get their PC reused via attachExistingPC().
  const incomingPaths = STREAMS.slice(0, layout.streams).map(s => s.path);
  activePCs = activePCs.filter(pc => {
    const path = Object.keys(streamPCs).find(p => streamPCs[p] === pc);
    if (path && incomingPaths.includes(path)) return true; // keep
    try { pc.close(); } catch(e) {}
    if (path) streamPCs[path] = null; // mark as not active, keep key
    return false;
  });

  const wall = document.getElementById('wall');
  wall.style.gridTemplateColumns = layout.css.cols;
  wall.style.gridTemplateRows    = layout.css.rows;
  wall.innerHTML = '';

  const maxStr = PERF.maxStreams > 0 ? PERF.maxStreams : Infinity;
  const count = Math.min(layout.streams, STREAMS.length, maxStr);

  for (let i = 0; i < count; i++) {
    const stream = STREAMS[i];
    const span   = layout.spans?.[i];
    const num    = String(i + 1).padStart(2, '0');

    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.id = `cell${i}`;

    if (span) {
      if (span.col) cell.style.gridColumn = span.col;
      if (span.row) cell.style.gridRow    = span.row;
    }

    // Note: aspectRatio is handled by object-fit on the video element.
    // Setting it on the cell fights with grid sizing and causes cut-off.

    // objectFit applied inline on the video element
    const objectFit = stream.objectFit || 'contain';

    cell.innerHTML = `
      <div class="loading" id="load${i}"><div class="ring"></div></div>
      <div class="err-overlay" id="err${i}">
        <div class="err-inner">
          <div class="err-code">No Signal</div>
          <div class="err-sub">${stream.path}</div>
        </div>
      </div>
      <video id="v${i}" autoplay muted playsinline style="object-fit:${objectFit}"></video>
      <div class="chrome">
        <div class="live">
          <div class="live-row"><span id="lbl${i}">LIVE</span><span class="dot" id="dot${i}"></span></div>
          <div class="lbl">${stream.path}</div>
        </div>
        <button class="btn-fs" onclick="toggleFS(${i})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M16 21h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
          </svg>
        </button>
      </div>`;

    wall.appendChild(cell);

    // Inject action indicator if this slot has an action group
    const _activeViewObj = typeof getView === 'function' && activeView ? getView(activeView) : null;
    const _slotGroups = _activeViewObj && _activeViewObj.slotGroups;
    if (_slotGroups && _slotGroups[i]) {
      const indicator = document.createElement('button');
      indicator.className = 'action-indicator';
      indicator.textContent = '⚡';
      indicator.title = 'Actions';
      indicator.addEventListener('click', (e) => { e.stopPropagation(); openActionsModal(i); });
      cell.appendChild(indicator);
      // Clicking anywhere on the cell also opens the modal
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openActionsModal(i);
      });
    }
  }

  // Hide picker, start streams
  document.getElementById('picker').classList.remove('open');
  for (let i = 0; i < count; i++) startWhep(i);

  // Save choice
  try { localStorage.setItem('layout', name); } catch(e) {}
  updateDebugOverlay();
}

// ═══════════════════════════════════════════════════════
// Layout SVG icons — same as layout picker, scaled down
// ═══════════════════════════════════════════════════════
// LAYOUT_RECTS + LAYOUT_CELLS indexed by stream index (0=first stream).
// Index 0 is always the primary/large cell (span applied at i=0 in applyLayout).
// Remaining indices fill left→right, top→bottom in the grid.
//
//  single:         0=full
//  two-col:        0=left       1=right
//  two-row:        0=top        1=bottom
//  primary-right:  0=large-left 1=top-right  2=bottom-right
//  primary-left:   0=large-right 1=top-left  2=bottom-left
//  primary-bottom: 0=large-top  1=bot-left   2=bot-right
//  primary-top:    0=large-bot  1=top-left   2=top-right
//  quad:           0=TL  1=TR  2=BL  3=BR
//  six:            0=R0C0 1=R0C1 2=R0C2 3=R1C0 4=R1C1 5=R1C2
//  eight:          0..3=top row L→R, 4..7=bottom row L→R
const LAYOUT_RECTS = {
  'single':        [
    {x:2, y:2,  w:76,h:46,r:2,p:0.18}],
  'two-col':       [
    {x:2, y:2,  w:36,h:46,r:2,p:0.12},  // 0=left
    {x:42,y:2,  w:36,h:46,r:2,p:0.12}], // 1=right
  'two-row':       [
    {x:2, y:2,  w:76,h:21,r:2,p:0.12},  // 0=top
    {x:2, y:27, w:76,h:21,r:2,p:0.12}], // 1=bottom
  'primary-right': [
    {x:2, y:2,  w:46,h:46,r:2,p:0.18},  // 0=large left
    {x:52,y:2,  w:26,h:21,r:2,p:0.12},  // 1=top right
    {x:52,y:27, w:26,h:21,r:2,p:0.12}], // 2=bottom right
  'primary-left':  [
    {x:2, y:2,  w:26,h:21,r:2,p:0.12},  // 0=top left
    {x:2, y:27, w:26,h:21,r:2,p:0.12},  // 1=bottom left
    {x:32,y:2,  w:46,h:46,r:2,p:0.18}], // 2=large right
  'primary-bottom':[
    {x:2, y:2,  w:76,h:28,r:2,p:0.18},  // 0=large top
    {x:2, y:34, w:36,h:14,r:2,p:0.12},  // 1=bottom left
    {x:42,y:34, w:36,h:14,r:2,p:0.12}], // 2=bottom right
  'primary-top':   [
    {x:2, y:2,  w:36,h:14,r:2,p:0.12},  // 0=top left
    {x:42,y:2,  w:36,h:14,r:2,p:0.12},  // 1=top right
    {x:2, y:20, w:76,h:28,r:2,p:0.18}], // 2=large bottom
  'quad':          [
    {x:2, y:2,  w:36,h:21,r:2,p:0.12},  // 0=TL
    {x:42,y:2,  w:36,h:21,r:2,p:0.12},  // 1=TR
    {x:2, y:27, w:36,h:21,r:2,p:0.12},  // 2=BL
    {x:42,y:27, w:36,h:21,r:2,p:0.12}], // 3=BR
  'six':           [
    {x:2, y:2,  w:22,h:21,r:1,p:0.12},{x:29,y:2,  w:22,h:21,r:1,p:0.12},{x:56,y:2,  w:22,h:21,r:1,p:0.12},
    {x:2, y:27, w:22,h:21,r:1,p:0.12},{x:29,y:27, w:22,h:21,r:1,p:0.12},{x:56,y:27, w:22,h:21,r:1,p:0.12}],
  'eight':         [
    {x:2, y:2,  w:16,h:21,r:1,p:0.12},{x:22,y:2,  w:16,h:21,r:1,p:0.12},{x:42,y:2,  w:16,h:21,r:1,p:0.12},{x:62,y:2,  w:16,h:21,r:1,p:0.12},
    {x:2, y:27, w:16,h:21,r:1,p:0.12},{x:22,y:27, w:16,h:21,r:1,p:0.12},{x:42,y:27, w:16,h:21,r:1,p:0.12},{x:62,y:27, w:16,h:21,r:1,p:0.12}],
};

// Centre points derived from rects (cx = x + w/2, cy = y + h/2)
const LAYOUT_CELLS = Object.fromEntries(
  Object.entries(LAYOUT_RECTS).map(([k,rects]) => [
    k, rects.map(r => [Math.round(r.x + r.w/2), Math.round(r.y + r.h/2)])
  ])
);

// Generate layout SVG with stream names inside each cell
// Uses unique clip IDs per SVG to avoid conflicts when multiple rows shown
let _svgUid = 0;
function layoutSvgWithNumbers(layoutName, streams) {
  const rects = LAYOUT_RECTS[layoutName];
  const cells = LAYOUT_CELLS[layoutName];
  if (!rects) return layoutName;

  const uid = _svgUid++;
  const clipDefs = rects.map((r, i) =>
    `<clipPath id="lc${uid}_${i}"><rect x="${r.x+1}" y="${r.y+1}" width="${r.w-2}" height="${r.h-2}"/></clipPath>`
  ).join('');

  const rectsSvg = rects.map((r, i) => {
    const fill   = `rgba(255,255,255,${r.p})`;
    const stroke = r.p > 0.15 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)';
    return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.r}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
  }).join('');

  // Show stream index (0,1,2...) in each cell, L→R T→B order
  const labelsSvg = (cells || []).map((c, i) => {
    if (i >= (streams?.length || 0)) return '';
    const cellW = rects[i]?.w || 20;
    const fs    = cellW >= 46 ? 10 : cellW >= 26 ? 8 : 7;
    return `<text x="${c[0]}" y="${c[1]}" text-anchor="middle" dominant-baseline="middle" font-family="monospace" font-size="${fs}" font-weight="bold" fill="rgba(255,255,255,0.7)" clip-path="url(#lc${uid}_${i})">${i}</text>`;
  }).join('');

  return `<svg width="64" height="40" viewBox="0 0 80 50"><defs>${clipDefs}</defs>${rectsSvg}${labelsSvg}</svg>`;
}
