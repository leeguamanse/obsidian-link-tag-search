const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const out = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== packageInfo.version) throw new Error('Manifest and package versions must match.');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Use an x.y.z version without a v prefix.');
fs.mkdirSync(out, {recursive:true});
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
const plugin = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const bundle = `// Link Tag Search ${manifest.version} — MIT\n` +
  'const Core = (() => { const module = {exports:{}};\n' + core + '\nreturn module.exports; })();\n' + plugin;
fs.writeFileSync(path.join(out, 'main.js'), bundle);
for (const name of ['manifest.json', 'styles.css']) fs.copyFileSync(path.join(root, name), path.join(out, name));
console.log(`Built ${out}`);
