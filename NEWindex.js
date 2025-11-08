const axios = require('axios');
const cheerio = require('cheerio');
const zlib = require('zlib').promises;

const version = process.argv[2];
if (!version) {
  console.error("Version is required");
  console.log(JSON.stringify({ include: [] }));
  process.exit(0);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetchHTML(url) {
  const { data } = await axios.get(url, { timeout: 20000 });
  return cheerio.load(data);
}

async function fetchPackagesText(packagesDirUrl) {
  try {
    const gzUrl = `${packagesDirUrl}Packages.gz`;
    const resp = await axios.get(gzUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const unzipped = await zlib.gunzip(resp.data);
    return unzipped.toString("utf8");
  } catch {}

  try {
    const url = `${packagesDirUrl}Packages`;
    const resp = await axios.get(url, { timeout: 15000 });
    return resp.data.toString();
  } catch {}

  return null;
}

async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $("table tr td.n a")
    .map((i, el) => $(el).attr("href"))
    .get()
    .filter(href => href.endsWith("/"))
    .map(href => href.slice(0, -1));
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $("table tr td.n a")
    .map((i, el) => $(el).attr("href"))
    .get()
    .filter(href => href.endsWith("/"))
    .map(href => href.slice(0, -1));
}

async function getPkgarch(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;

  const pkgsText = await fetchPackagesText(packagesUrl);
  if (pkgsText) {
    const entries = pkgsText.split(/\r?\n\r?\n/);
    for (const entry of entries) {
      const m = entry.match(/^Architecture:\s*(.+)$/m);
      if (m && m[1] !== "all") return m[1].trim();
    }
  }

  try {
    const $ = await fetchHTML(packagesUrl);

    for (const el of $("a").toArray()) {
      const name = $(el).attr("href");
      if (name && name.endsWith(".ipk") && !name.startsWith("kernel_")) {
        const m = name.match(/_([^_]+)\.ipk$/);
        if (m) return m[1];
      }
    }

    for (const el of $("a").toArray()) {
      const name = $(el).attr("href");
      if (name && name.startsWith("kernel_")) {
        const m = name.match(/_([^_]+)\.ipk$/);
        if (m) return m[1];
      }
    }
  } catch {}

  return "unknown";
}

(async () => {
  try {
    const result = [];

    const targets = await getTargets();
    for (const target of targets) {
      const subtargets = await getSubtargets(target);
      for (const sub of subtargets) {
        const pkgarch = await getPkgarch(target, sub);
        result.push({ target, subtarget: sub, pkgarch });
      }
    }

    console.log(JSON.stringify({ include: result }, null, 2));
  } catch (e) {
    console.error("ERROR:", e);
    // чтобы не ломать GH Actions — выдаём пустой JSON, но НЕ пустую строку
    console.log(JSON.stringify({ include: [] }));
  }
})();
