// Run:  node tools/make-hash.js "YourNewPassword"
// Then in Netlify > Site configuration > Environment variables add ADMIN_PASSWORD_HASH with the printed value.
const c = require('crypto'), pw = process.argv[2];
if (!pw) { console.log('Usage: node tools/make-hash.js "password"'); process.exit(1); }
const s = c.randomBytes(16);
console.log(s.toString('hex') + ':' + c.scryptSync(pw, s, 32, { N: 16384, r: 8, p: 1 }).toString('hex'));
