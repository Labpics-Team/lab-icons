/**
 * scripts/build-truth-index.mjs — compares shipped svg/** with owner's hand files
 *
 * Walks:
 *   - svg/Filled and svg/Outline (shipped, built)
 *   - C:/Users/Daniel/Desktop/Lab Icons/Filled and Outline (hand, owner's truth)
 *
 * Outputs:
 *   - preview/truth-index.json (comparison results)
 *   - preview/truth.html (side-by-side viewer with filters)
 *   - Copies shipped SVGs to preview/shipped/
 *   - Copies normalized hand SVGs to preview/hand/
 */

import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const HAND_ROOT = 'C:/Users/Daniel/Desktop/Lab Icons';
const SHIPPED_ROOT = join(root, 'svg');
const PREVIEW_ROOT = join(root, 'preview');

const VARIANTS = ['Filled', 'Outline'];

function normalizeSVG(content) {
  // Basic normalization: strip whitespace, normalize line endings
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPathData(svg) {
  // Extract all d attributes from path elements
  const matches = svg.match(/d="([^"]+)"/g);
  if (!matches) return [];
  return matches.map(m => m.match(/d="([^"]+)"/)[1]);
}

function compareFiles(shipped, hand) {
  const shippedNorm = normalizeSVG(shipped);
  const handNorm = normalizeSVG(hand);

  const shippedPaths = extractPathData(shippedNorm);
  const handPaths = extractPathData(handNorm);

  const identical = shippedNorm === handNorm;
  const pathCountMatch = shippedPaths.length === handPaths.length;
  const pathsIdentical = JSON.stringify(shippedPaths) === JSON.stringify(handPaths);

  return {
    identical,
    pathCountMatch,
    pathsIdentical,
    shippedPathCount: shippedPaths.length,
    handPathCount: handPaths.length,
  };
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

console.log('Building truth index...');

const index = {
  version: 1,
  generated: new Date().toISOString(),
  totalFiles: 0,
  identical: 0,
  different: 0,
  missing: 0,
  files: {},
};

// Process each variant
for (const variant of VARIANTS) {
  const shippedDir = join(SHIPPED_ROOT, variant);
  const handDir = join(HAND_ROOT, variant);

  const shippedFiles = readdirSync(shippedDir).filter(f => f.endsWith('.svg'));
  const handFiles = readdirSync(handDir).filter(f => f.endsWith('.svg'));

  console.log(`${variant}: ${shippedFiles.length} shipped, ${handFiles.length} hand`);

  // Create preview directories
  const previewShippedDir = join(PREVIEW_ROOT, 'shipped', variant);
  const previewHandDir = join(PREVIEW_ROOT, 'hand', variant);
  ensureDir(previewShippedDir);
  ensureDir(previewHandDir);

  for (const file of shippedFiles) {
    const shippedPath = join(shippedDir, file);
    const handPath = join(handDir, file);
    const previewShippedPath = join(previewShippedDir, file);
    const previewHandPath = join(previewHandDir, file);

    const key = `${variant}/${file}`;
    index.totalFiles++;

    // Copy shipped to preview
    copyFileSync(shippedPath, previewShippedPath);

    const shippedContent = readFileSync(shippedPath, 'utf8');

    if (!handFiles.includes(file)) {
      // Missing in hand
      index.files[key] = {
        status: 'missing-hand',
        shipped: true,
        hand: false,
      };
      index.missing++;
      console.log(`  ${key}: MISSING in hand`);
      continue;
    }

    // Copy hand to preview
    copyFileSync(handPath, previewHandPath);

    const handContent = readFileSync(handPath, 'utf8');
    const comparison = compareFiles(shippedContent, handContent);

    index.files[key] = {
      status: comparison.identical ? 'identical' : 'different',
      shipped: true,
      hand: true,
      ...comparison,
    };

    if (comparison.identical) {
      index.identical++;
    } else {
      index.different++;
    }
  }

  // Check for hand files not in shipped
  for (const file of handFiles) {
    if (!shippedFiles.includes(file)) {
      const key = `${variant}/${file}`;
      console.log(`  ${key}: MISSING in shipped`);
      index.files[key] = {
        status: 'missing-shipped',
        shipped: false,
        hand: true,
      };
      index.missing++;
    }
  }
}

console.log(`\nResults:`);
console.log(`  Total: ${index.totalFiles}`);
console.log(`  Identical: ${index.identical}`);
console.log(`  Different: ${index.different}`);
console.log(`  Missing: ${index.missing}`);

// Write truth-index.json
const jsonPath = join(PREVIEW_ROOT, 'truth-index.json');
writeFileSync(jsonPath, JSON.stringify(index, null, 2));
console.log(`\nWrote ${jsonPath}`);

// Generate truth.html
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Truth Index - Shipped vs Hand</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      padding: 20px;
    }
    h1 { margin-bottom: 20px; }
    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      padding: 15px;
      background: #2a2a2a;
      border-radius: 8px;
    }
    .stat {
      display: flex;
      flex-direction: column;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
    }
    .stat-label {
      font-size: 12px;
      color: #888;
    }
    .filters {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .filter-btn {
      padding: 8px 16px;
      background: #2a2a2a;
      border: 1px solid #444;
      color: #e0e0e0;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-btn:hover { background: #3a3a3a; }
    .filter-btn.active {
      background: #0066cc;
      border-color: #0066cc;
    }
    .search {
      width: 300px;
      padding: 8px 16px;
      background: #2a2a2a;
      border: 1px solid #444;
      color: #e0e0e0;
      border-radius: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 20px;
    }
    .card {
      background: #2a2a2a;
      border-radius: 8px;
      padding: 15px;
      border: 1px solid #444;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 10px;
      color: #fff;
    }
    .card-meta {
      font-size: 11px;
      color: #888;
      margin-bottom: 10px;
    }
    .comparison {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .svg-container {
      background: #fff;
      border-radius: 4px;
      padding: 10px;
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .svg-container img {
      max-width: 100%;
      max-height: 100%;
    }
    .svg-label {
      text-align: center;
      font-size: 11px;
      color: #888;
      margin-top: 5px;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .status-identical { background: #2d5016; color: #90ee90; }
    .status-different { background: #5c3d00; color: #ffcc00; }
    .status-missing-hand { background: #5c0000; color: #ff9999; }
    .status-missing-shipped { background: #5c0000; color: #ff9999; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>Truth Index - Shipped vs Hand</h1>

  <div class="stats">
    <div class="stat">
      <span class="stat-value">${index.totalFiles}</span>
      <span class="stat-label">Total Files</span>
    </div>
    <div class="stat">
      <span class="stat-value">${index.identical}</span>
      <span class="stat-label">Identical</span>
    </div>
    <div class="stat">
      <span class="stat-value">${index.different}</span>
      <span class="stat-label">Different</span>
    </div>
    <div class="stat">
      <span class="stat-value">${index.missing}</span>
      <span class="stat-label">Missing</span>
    </div>
  </div>

  <div class="filters">
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn" data-filter="identical">Identical</button>
    <button class="filter-btn" data-filter="different">Different</button>
    <button class="filter-btn" data-filter="missing">Missing</button>
    <input type="text" class="search" placeholder="Search files..." />
  </div>

  <div class="grid" id="grid"></div>

  <script>
    const index = ${JSON.stringify(index, null, 2)};

    const grid = document.getElementById('grid');
    const filterBtns = document.querySelectorAll('.filter-btn');
    const searchInput = document.querySelector('.search');

    let currentFilter = 'all';
    let currentSearch = '';

    function renderCards() {
      grid.innerHTML = '';

      Object.entries(index.files).forEach(([key, data]) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.status = data.status;

        const matchesFilter =
          currentFilter === 'all' ||
          (currentFilter === 'identical' && data.status === 'identical') ||
          (currentFilter === 'different' && data.status === 'different') ||
          (currentFilter === 'missing' && data.status.startsWith('missing'));

        const matchesSearch = key.toLowerCase().includes(currentSearch.toLowerCase());

        if (!matchesFilter || !matchesSearch) {
          card.classList.add('hidden');
        }

        const statusClass = 'status-' + data.status.replace('-', '-');

        card.innerHTML = \`
          <div class="card-title">\${key}</div>
          <span class="status-badge \${statusClass}">\${data.status}</span>
          \${data.pathCountMatch !== undefined ? \`
            <div class="card-meta">
              Paths: shipped=\${data.shippedPathCount}, hand=\${data.handPathCount}
              \${!data.pathCountMatch ? ' ⚠️ Mismatch' : ''}
            </div>
          \` : ''}
          <div class="comparison">
            <div>
              \${data.shipped ? \`
                <div class="svg-container">
                  <img src="shipped/\${key}" alt="shipped" />
                </div>
                <div class="svg-label">Shipped</div>
              \` : '<div class="svg-label">Missing</div>'}
            </div>
            <div>
              \${data.hand ? \`
                <div class="svg-container">
                  <img src="hand/\${key}" alt="hand" />
                </div>
                <div class="svg-label">Hand</div>
              \` : '<div class="svg-label">Missing</div>'}
            </div>
          </div>
        \`;

        grid.appendChild(card);
      });
    }

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderCards();
      });
    });

    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value;
      renderCards();
    });

    renderCards();
  </script>
</body>
</html>`;

const htmlPath = join(PREVIEW_ROOT, 'truth.html');
writeFileSync(htmlPath, html);
console.log(`Wrote ${htmlPath}`);

console.log('\nDone!');