const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetchHTML(url) {
  const { data } = await axios.get(url);
  return cheerio.load(data);
}

async function fetchJSON(url) {
  const { data } = await axios.get(url);
  return data;
}

async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getPkgarch(target, subtarget) {

  // --- MANUAL MALTA ARCHS (all known variants) ---
  if (target === 'malta') {
    const maltaMap = {
      'be': ['mipsel_24kc', 'mips_24kc'],
      'le': ['mipsel_24kc'],
      'be64': ['mips64el_octeonplus', 'mips64_mips64r2'],
      'le64': ['mips64el_octeonplus', 'mips64_mips64r2']
    };
    if (maltaMap[subtarget]) return maltaMap[subtarget];
  }

  // --- Try profiles.json first (for 25.x+) ---
  const profilesUrl = `${baseUrl}${target}/${subtarget}/profiles.json`;
  try {
    const json = await fetchJSON(profilesUrl);
    if (json && json.arch_packages) {
      return Array.isArray(json.arch_packages)
        ? json.arch_packages
        : [json.arch_packages];
    }
  } catch {
    // profiles.json not found, fallback
  }

  // --- Fallback: parse .ipk packages (old method) ---
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  try {
    const $ = await fetchHTML(packagesUrl);
    const arches = new Set();

    // ищем все уникальные arch из .ipk
    $('a').each((i, el) => {
      const name = $(el).attr('href');
      if (!name || !name.endsWith('.ipk')) return;

      const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
      if (match) arches.add(match[1]);
    });

    return [...arches].length ? [...arches] : ['unknown'];
  } catch {
    return ['unknown'];
  }
}

async function main() {
  try {
    const targets = await getTargets();
    const matrix = [];

    for (const target of targets) {
      const subtargets = await getSubtargets(target);
      for (const subtarget of subtargets) {
        const pkgarches = await getPkgarch(target, subtarget);
        for (const pkgarch of pkgarches) {
          matrix.push({ target, subtarget, pkgarch });
        }
      }
    }

    // Одна строка для GitHub Actions
    console.log(JSON.stringify({ include: matrix }));

  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
