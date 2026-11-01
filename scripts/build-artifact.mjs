// Packs the Vite build (dist/) into ONE self-contained HTML file: dist-single/fog-clash.html.
// Used to publish a shareable demo link. Run: npm run build:single
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const assets = readdirSync('dist/assets');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n')
  .replaceAll('</script', '<\\/script'); // keep the inline script from closing early

const html = `<title>Fog Clash</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya+SC:wght@700&family=Alegreya+Sans:wght@400;600;800&display=swap">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/fog-clash.html', html);
console.log(`dist-single/fog-clash.html (${(html.length / 1024).toFixed(0)} KB)`);
