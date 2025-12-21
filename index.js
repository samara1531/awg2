const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetch(url) {
  const { data } = await axios.get(url, { timeout: 30000 });
  return data;
}

async function fetchHTML(url) {
  const data = await fetch(url);
  return cheerio.load(data);
}

async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h && h.endsWith('/'))
    .map(h => h.slice(0, -1));
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h && h.endsWith('/'))
    .map(h => h.slice(0, -1));
}

/**
 * 🔥 Основная логика определения архитектуры
 */
async function getPkgArch(target, subtarget) {
  const profilesUrl = `${baseUrl}${target}/${subtarget}/profiles.json`;

  // 1️⃣ Новый способ — profiles.json (apk, 25.12+)
  try {
    const profiles = await fetch(profilesUrl);
    const json = JSON.parse(profiles);

    if (json.arch_packages) {
      return json.arch_packages;
    }
  } catch (e) {
    // profiles.json может отсутствовать — это нормально
  }

  // 2️⃣ Fallback — старые релизы (ipk)
  try {
    const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
    const $ = await fetchHTML(packagesUrl);

    let arch = '';

    $('a').each((_, el) => {
      const name = $(el).attr('href');
      if (name && name.endsWith('.ipk') && !name.startsWith('kernel_')) {
        const m = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
        if (m) {
          arch = m[1];
          return false;
        }
      }
    });

    if (!arch) {
      $('a').each((_, el) => {
        const name = $(el).attr('href');
        if (name && name.startsWith('kernel_')) {
          const m = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
          if (m) {
            arch = m[1];
            return false;
          }
        }
      });
    }

    return arch || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main() {
  const matrix = [];
  const targets = await getTargets();

  for (const target of targets) {
    const subtargets = await getSubtargets(target);
    for (const subtarget of subtargets) {
      const pkgarch = await getPkgArch(target, subtarget);
      matrix.push({ target, subtarget, pkgarch });
    }
  }

  console.log(JSON.stringify({ include: matrix }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
