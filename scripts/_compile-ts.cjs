// Compile TypeScript modules from lib/ and hand back a `require`-able path.
//
// The unit suites here test real modules (lib/scoring.ts, lib/adif.ts,
// lib/cabrillo.ts) that are TypeScript, while every test script in this repo
// is plain `node` with no test runner and no build step. This bridges the two:
// compile the entry point and whatever it imports into a temp directory with
// the project's own tsc, then require the output.
//
// It lives in one place because the alternative is each suite carrying its own
// copy of the same twenty lines — which is how the section list ended up in
// four places and one of them went stale.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

/**
 * @param {string[]} entries  paths relative to the repo root, e.g. ['lib/adif.ts']
 * @returns {{ load: (name: string) => unknown, cleanup: () => void }}
 *          `load` takes a module name without extension, e.g. 'adif'.
 */
function compile(entries) {
  const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
  if (!fs.existsSync(tsc)) {
    console.error(`No TypeScript compiler at ${tsc} — run \`npm ci\` first.`);
    process.exit(1);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezfd-ts-'));

  try {
    execFileSync(
      tsc,
      [...entries, '--outDir', outDir, '--module', 'commonjs',
       '--target', 'es2022', '--skipLibCheck'],
      { cwd: root, stdio: 'pipe' },
    );
  } catch (err) {
    console.error(`Could not compile ${entries.join(', ')}:\n` + (err.stdout || err.message));
    process.exit(1);
  }

  // The output lands outside the repo, so a compiled module that imports a
  // real dependency — `marked`, in lib/docs.ts — cannot resolve it from there.
  // A link rather than a copy: node resolves `require('marked')` by walking up
  // from the requiring file, and this puts the project's own modules on that
  // walk without duplicating them. Best effort; a suite whose modules have no
  // dependencies never needs it.
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(outDir, 'node_modules'), 'dir');
  } catch {
    // Already there, or the platform refuses. The require below reports it.
  }

  return {
    load: name => require(path.join(outDir, `${name}.js`)),
    cleanup: () => fs.rmSync(outDir, { recursive: true, force: true }),
  };
}

module.exports = { compile };
