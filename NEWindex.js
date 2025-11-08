const axios = require('axios');
const cheerio = require('cheerio');
const zlib = require('zlib').promises;

// ===== ДОБАВЛЕНО =====
const version = process.argv[2];
if (!version) {
  console.error("Version is required");
  process.exit(1);
}
const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

// ===== ДОБАВЛЕНО =====
async function fetchHTML(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return cheerio.load(data);
}
// ======================

async function fetchPackagesText(packagesDirUrl) {
  try {
    const gzUrl = `${packagesDirUrl}Packages.gz`;
    const resp = await axios.get(gzUrl, { responseType: 'arraybuffer', timeout: 15000 });
    if (resp && resp.data) {
      const buf = Buffer.from(resp.data);
      const unzipped = await zlib.gunzip(buf);
      return unzipped.toString('utf8');
    }
  } catch (e) {}

  try {
    const url = `${packagesDirUrl}Packages`;
    const resp = await axios.get(url, { timeout: 15000 });
    if (resp && resp.data) return resp.data.toString();
  } catch (e) {}

  return null;
}

async function getPkgarch(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;

  // 1 — читаем Packages(.gz)
  const pkgsText = await fetchPackagesText(packagesUrl);

  if (pkgsText) {
    const entries = pkgsText.split(/\r?\n\r?\n/);
    for (const entry of entries) {
      const m = entry.match(/^Architecture:\s*(.+)$/m);
      if (m) {
        const arch = m[1].trim();
        if (arch && arch !== "all") return arch;
      }
    }
  }

  // 2 — fallback: извлекаем из .ipk
  try {
    const $ = await fetchHTML(packagesUrl);

    for (const el of $('a').toArray()) {
      const name = $(el).attr('href');
      if (name && name.endsWith('.ipk') && !name.startsWith('kernel_')) {
        const m = name.match(/_([^_]+)\.ipk$/);
        if (m) return m[1];
      }
    }

    for (const el of $('a').toArray()) {
      const name = $(el).attr('href');
      if (name && name.startsWith('kernel_')) {
        const m = name.match(/_([^_]+)\.ipk$/);
        if (m) return m[1];
      }
    }
  } catch (e) {}

  return "unknown";
}
