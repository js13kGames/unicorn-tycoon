// Only private game properties may be renamed. DOM, Canvas and Wavedash API
// names and boolean argument types must survive minification unchanged.
const fs = require('fs');
const { minify } = require('terser');
const options = {
  compress: { passes: 3, unsafe: true, toplevel: true },
  mangle: { toplevel: true, properties: {
    regex: /^(wear|bonus|task|idle|build|sat|acc|mood|need|shop|calm|tgt|wait|use|hat|income|happy|angry|brokeN|broke|uses|vis|miss|low|cap)$/
  } }
};
module.exports = options;
if (require.main === module) {
  minify(fs.readFileSync(process.argv[2], 'utf8'), options)
    .then(r => fs.writeFileSync(process.argv[3], r.code))
    .catch(e => { console.error(e); process.exitCode = 1; });
}
