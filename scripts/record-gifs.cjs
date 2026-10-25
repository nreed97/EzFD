#!/usr/bin/env node
// Records the animated screenshots on the GitHub Pages site and in the guides:
// docs/images/{sign-in,logging,live-update}.gif.
//
//   node scripts/seed-demo.mjs http://127.0.0.1:3000    # prints a join code
//   node scripts/record-gifs.cjs http://127.0.0.1:3000 <join code>
//
// Same rule as the still screenshots: against a built server, with the
// fixture from scripts/seed-demo.mjs, so the log behind the action looks like
// a weekend rather than an empty table. Each run logs a few real contacts into
// that event, so seed a fresh one before re-recording.
//
// Needs Playwright with Chromium (`require('playwright')`) and ffmpeg. Each
// clip is recorded as video by the browser and converted with a palette built
// from the clip itself, which keeps the dark interface free of dithering noise
// and each file to a few hundred kilobytes.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const CODE = process.argv[3];
if (!CODE) {
  console.error('usage: node scripts/record-gifs.cjs <base url> <join code>');
  process.exit(1);
}
const OUT = path.join(__dirname, '..', 'docs', 'images');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ezfd-gif-'));
const TYPE = { delay: 110 };   // typing speed a viewer can follow

/** One recorded page; `close()` resolves to the video file. */
async function recordedPage(browser, size) {
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: TMP, size },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  return {
    page,
    started: Date.now(),
    async close() {
      const video = page.video();
      await context.close();
      return video.path();
    },
  };
}

/** Sign in as `call` and land on the logger, on 80m phone — a band nobody in
 *  the fixture is on, so no conflict banner appears that a real operator
 *  picking a free band would never see. */
async function signIn(page, call, { slow = false } = {}) {
  await page.goto(`${BASE}/event/${CODE}`);
  const field = page.getByPlaceholder('N0CALL');
  await field.waitFor();
  if (slow) { await page.waitForTimeout(800); await field.pressSequentially(call, TYPE); await page.waitForTimeout(500); }
  else await field.fill(call);
  await page.getByRole('button', { name: 'Enter Logger' }).click();
  await page.getByText('Where are you operating?').waitFor();
  if (slow) await page.waitForTimeout(1500);
  // The first 80m button is the phone row.
  await page.locator('button', { hasText: /^80m$/ }).first().click();
  if (slow) await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Start without claiming' }).click();
  await page.getByRole('button', { name: /Log QSO/ }).first().waitFor();
}

/** Type one contact into the logger the way an operator does: Enter to move on. */
async function logContact(page, call, cls, sec) {
  const callField = page.getByPlaceholder('N0CALL');
  await callField.click();
  await callField.pressSequentially(call, TYPE);
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.keyboard.type(cls, TYPE);
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.keyboard.type(sec, TYPE);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
}

/** Video to GIF. `trim` is seconds dropped from the start of each input — the
 *  page load — one per input, since two pages never start recording at the
 *  same instant. */
function toGif(inputs, out, { trim = [0], width = 960, fps = 8 } = {}) {
  const args = ['-y', '-loglevel', 'error'];
  inputs.forEach((input, n) => args.push('-ss', (trim[n] ?? 0).toFixed(2), '-i', input));
  const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  const stack = inputs.length > 1 ? `${inputs.map((_, n) => `[${n}:v]`).join('')}hstack=inputs=${inputs.length},` : '';
  args.push('-filter_complex',
    `${stack}${scale},split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=none`,
    path.join(OUT, out));
  execFileSync('ffmpeg', args);
  const kb = Math.round(fs.statSync(path.join(OUT, out)).size / 1024);
  console.log(`ok    ${out}  ${kb} KB`);
}

(async () => {
  const browser = await chromium.launch();

  // 1. Signing in: a callsign, a band and mode, and the logger.
  {
    const rec = await recordedPage(browser, { width: 1280, height: 800 });
    await signIn(rec.page, 'N0CALL', { slow: true });
    await rec.page.waitForTimeout(2500);
    toGif([await rec.close()], 'sign-in.gif', { trim: [0.5] });
  }

  // 2. Logging: a contact goes in with the keyboard alone, then typing the
  //    same call again is flagged as a dupe before anything is logged.
  {
    const rec = await recordedPage(browser, { width: 1280, height: 800 });
    await signIn(rec.page, 'N0CALL');
    const loadedAt = (Date.now() - rec.started) / 1000;
    await rec.page.waitForTimeout(1200);
    await logContact(rec.page, 'K0XYZ', '2A', 'WI');
    await rec.page.waitForTimeout(2200);
    await rec.page.getByPlaceholder('N0CALL').pressSequentially('K0XYZ', TYPE);
    await rec.page.waitForTimeout(3000);
    await rec.page.getByPlaceholder('N0CALL').fill('');
    await rec.page.waitForTimeout(800);
    toGif([await rec.close()], 'logging.gif', { trim: [loadedAt] });
  }

  // 3. Live update: one operator logs a new section, and the dashboard on
  //    another screen shows the contact, the score and the section count move
  //    without anyone touching it. PE is not in the fixture's worked list.
  {
    const size = { width: 960, height: 720 };
    const left = await recordedPage(browser, size);
    const right = await recordedPage(browser, size);
    await Promise.all([
      signIn(left.page, 'N0CALL'),
      right.page.goto(`${BASE}/event/${CODE}/dashboard`),
    ]);
    await right.page.getByText('Sections worked', { exact: false }).first().waitFor();
    await right.page.waitForTimeout(1500);
    const now = Date.now();
    const trim = [(now - left.started) / 1000, (now - right.started) / 1000];
    await left.page.waitForTimeout(1000);
    await logContact(left.page, 'VY2ABC', '1A', 'PE');
    await left.page.waitForTimeout(3500);
    const [l, r] = [await left.close(), await right.close()];
    toGif([l, r], 'live-update.gif', { trim, width: 1280 });
  }

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
})().catch(err => { console.error(err); process.exit(1); });
