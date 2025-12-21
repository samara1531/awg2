const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetch(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return data;
}

async function fetchHTML(url) {
  const html = await fetch(url);
  return cheerio.load(html);
}

async function fetchJSON(url) {
  try {
    return JSON.parse(await fetch(url));
  } catch {
    return null;
  }
}

/* ---------- TARGETS ---------- */

async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h && h.endsWith('/'))
    .map(h => h.slice(0, -1));
}

/* ---------- SUBTARGETS ---------- */

async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h && h.endsWith('/'))
    .map(h => h.slice(0, -1));
}

/* ---------- ARCH DETECTION ---------- */

async function getPkgArch(target, subtarget) {
  // 1️⃣ subtarget profiles.json
  let json = await fetchJSON(
    `${baseUrl}${target}/${subtarget}/profiles.json`
  );
  if (json?.arch_packages) return json.arch_packages;

  // 2️⃣ target-level profiles.json (ВАЖНО для apm821xx и legacy)
  json = await fetchJSON(
    `${baseUrl}${target}/profiles.json`
  );
  if (json?.arch_packages) return json.arch_packages;

  // 3️⃣ packages directory (ipk / apk)
  try {
    const $ = await fetchHTML(
      `${baseUrl}${target}/${subtarget}/packages/`
    );

    let arch = null;
    $('a').each((_, el) => {
      const name = $(el).attr('href');
      if (!name) return;

      // ipk / apk
      if (name.endsWith('.ipk') || name.endsWith('.apk')) {
        const m = name.match(/_([a-zA-Z0-9_-]+)\.(ipk|apk)$/);
        if (m) {
          arch = m[1];
          return false; // break
        }
      }
    });

    if (arch) return arch;
  } catch {}

  // 4️⃣ fail
  return 'unknown';
}

/* ---------- MAIN ---------- */

async function main() {
  try {
    const targets = await getTargets();
    const matrix = [];

    for (const target of targets) {
      const subtargets = await getSubtargets(target);

      for (const subtarget of subtargets) {
        const pkgarch = await getPkgArch(target, subtarget);

        // ❗ unknown — НЕ собираем
        if (pkgarch === 'unknown') {
          console.warn(`Skipping ${target}/${subtarget} (unknown arch)`);
          continue;
        }

        matrix.push({
          target,
          subtarget,
          pkgarch
        });
      }
    }

    // GitHub Actions matrix output
    console.log(JSON.stringify({ include: matrix }));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
