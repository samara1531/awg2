const axios = require('axios');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node index.js <openwrt_version>');
  process.exit(1);
}

const BASE_URL = `https://downloads.openwrt.org/releases/${version}/targets/`;
const MATRIX = [];

async function fetchJSON(url) {
  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    return data;
  } catch {
    return null;
  }
}

async function fetchTargets() {
  const { data } = await axios.get(BASE_URL);
  // Получаем только папки targets (на конце /)
  return Array.from(data.matchAll(/href="([^"]+)\/"/g)).map(m => m[1]);
}

async function fetchSubtargets(target) {
  const url = `${BASE_URL}${target}/`;
  const { data } = await axios.get(url);
  return Array.from(data.matchAll(/href="([^"]+)\/"/g)).map(m => m[1]);
}

async function fetchArch(target, subtarget) {
  const url = `${BASE_URL}${target}/${subtarget}/profiles.json`;
  const json = await fetchJSON(url);
  return json?.arch_packages || null;
}

async function main() {
  try {
    const targets = await fetchTargets();

    for (const target of targets) {
      const subtargets = await fetchSubtargets(target);
      for (const subtarget of subtargets) {
        const arch = await fetchArch(target, subtarget);
        if (arch) {
          MATRIX.push({ target, subtarget, pkgarch: arch });
        } else {
          console.warn(`❌ ${target}/${subtarget}: arch not found`);
        }
      }
    }

    console.log(JSON.stringify({ include: MATRIX }));

  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
