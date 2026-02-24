const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

// --- HTTP helpers ---
async function fetchHTML(url) {
  const { data } = await axios.get(url);
  return cheerio.load(data);
}

async function fetchJSON(url) {
  const { data } = await axios.get(url);
  return data;
}

// --- Get target folders ---
async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

// --- Get subtarget folders ---
async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

// --- Get pkgarch using index.json → profiles.json → fallback ---
async function getPkgarch(target, subtarget) {
  const baseTargetUrl = `${baseUrl}${target}/${subtarget}/`;

  // 1) Try index.json (primary source)
  const indexUrl = `${baseTargetUrl}packages/index.json`;
  try {
    const json = await fetchJSON(indexUrl);
    if (json && typeof json.architecture === 'string') {
      return [json.architecture];
    }
  } catch {
    // index.json not found, continue
  }

  // 2) Try profiles.json (secondary source)
  const profilesUrl = `${baseTargetUrl}profiles.json`;
  try {
    const json = await fetchJSON(profilesUrl);
    if (json && typeof json.arch_packages !== 'undefined') {
      return Array.isArray(json.arch_packages) ? json.arch_packages : [json.arch_packages];
    }
  } catch {
    // profiles.json not found, continue
  }

  // 3) Fallback: parse .ipk packages
  return [await getPkgarchFallback(target, subtarget)];
}

// --- Fallback function parsing .ipk files ---
async function getPkgarchFallback(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  let pkgarch = 'unknown';
  try {
    const $ = await fetchHTML(packagesUrl);

    // look for first non-kernel .ipk
    $('a').each((i, el) => {
      const name = $(el).attr('href');
      if (name && name.endsWith('.ipk') && !name.startsWith('kernel_') && !name.includes('kmod-')) {
        const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
        if (match) {
          pkgarch = match[1];
          return false; // break
        }
      }
    });

    // fallback: if nothing found, try kernel_*
    if (pkgarch === 'unknown') {
      $('a').each((i, el) => {
        const name = $(el).attr('href');
        if (name && name.startsWith('kernel_')) {
          const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
          if (match) {
            pkgarch = match[1];
            return false;
          }
        }
      });
    }
  } catch {}
  return pkgarch;
}

// --- Main ---
async function main() {
  try {
    const targets = await getTargets();
    const matrix = [];
    const seen = new Set();

    for (const target of targets) {
      const subtargets = await getSubtargets(target);
      for (const subtarget of subtargets) {
        const archs = await getPkgarch(target, subtarget);
        for (const pkgarch of archs) {
          const key = `${target}|${subtarget}|${pkgarch}`;
          if (!seen.has(key)) {
            seen.add(key);
            matrix.push({ target, subtarget, pkgarch });
          }
        }
      }
    }

    // Output for GitHub Actions
    console.log(JSON.stringify({ include: matrix }));
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
