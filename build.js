// Inlines src/ into one self-contained HTML file: dist/graphical-verilog.html
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const order = ['expr.js', 'model.js', 'sim.js', 'verilog.js', 'examples.js', 'app.js', 'ui-circuit.js', 'ui-fsm.js', 'ui-wave.js'];
const js = order.map((f) => `// ---- ${f} ----\n${src(f)}`).join('\n').replace(/<\/script/gi, '<\\/script');
const html = src('index.html').replace('/*@CSS@*/', () => src('style.css')).replace('/*@JS@*/', () => js);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'graphical-verilog.html'), html);
// Variant for publishing as a claude.ai Artifact: the host supplies the document skeleton.
const frag = html.replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '').replace(/<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<\/head>\s*<body>\s*/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '');
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), frag);
console.log('Built dist/graphical-verilog.html', (html.length / 1024).toFixed(0) + ' KB');
