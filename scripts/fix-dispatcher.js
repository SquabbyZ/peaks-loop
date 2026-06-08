const fs = require('fs');
const p = process.argv[2];
const find = process.argv[3];
const replace = process.argv[4];
let s = fs.readFileSync(p, 'utf8');
const idx = s.indexOf(find);
if (idx <0) { console.error('not found'); process.exit(1); }
s = s.replace(find, replace,1);
fs.writeFileSync(p, s);
console.log('OK');
