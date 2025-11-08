const axios = require('axios');
const cheerio = require('cheerio');
const zlib = require('zlib').promises; // Node >= 12+
const version = process.argv[2];
const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

/**
 * Попытка получить текст из Packages.gz или Packages
 * возвращает null если обоих нет/недоступны
 */
async function fetchPackagesText(packagesDirUrl) {
  // try Packages.gz
  try {
    const gzUrl = `${packagesDirUrl}Packages.gz`;
    const resp = await axios.get(gzUrl, { responseType: 'arraybuffer', timeout: 15000 });
    if (resp && resp.data) {
      const buf = Buffer.from(resp.data);
      const unzipped = await zlib.gunzip(buf);
      return unzipped.toString('utf8');
    }
  } catch (e) {
    // silent fallback to Packages
  }

  // try plain Packages
  try {
    const url = `${packagesDirUrl}Packages`;
    const resp = await axios.get(url, { timeout: 15000 });
    if (resp && resp.data) return resp.data.toString();
  } catch (e) {
    // no Packages available
  }

  return null;
}

/**
 * Более надёжный getPkgarch: парсит Packages(.gz) и ищет первое поле Architecture
 * fallback: последний сегмент из имени .ipk (как раньше)
 */
async function getPkgarch(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  // 1) Попытка получить Packages(.gz)
  const pkgsText = await fetchPackagesText(packagesUrl);

  if (pkgsText) {
    // Записи разделены пустой строкой
    const entries = pkgsText.split(/\r?\n\r?\n/);
    for (const entry of entries) {
      // skip empty
      if (!entry || !entry.trim()) continue;
      // ищем Architecture: поле
      const m = entry.match(/^Architecture:\s*(.+)$/m);
      if (m && m[1]) {
        const arch = m[1].trim();
        if (arch && arch.toLowerCase() !== 'all') {
          return arch;
        }
        // если architecture = all, продолжаем искать следующую запись
      }
    }
    // если ничего осмысленного не найдено — не ломаемся, идём в fallback
  }

  // fallback: старый метод — взять последний сегмент перед .ipk
  try {
    const $ = await fetchHTML(packagesUrl);
    if ($) {
      // сначала обычные пакеты (не kernel_)
      for (const el of $('a').toArray()) {
        const name = $(el).attr('href');
        if (name && name.endsWith('.ipk') && !name.startsWith('kernel_')) {
          const m = name.match(/_([^_]+)\.ipk$/);
          if (m) return m[1];
        }
      }
      // затем kernel_*
      for (const el of $('a').toArray()) {
        const name = $(el).attr('href');
        if (name && name.startsWith('kernel_')) {
          const m = name.match(/_([^_]+)\.ipk$/);
          if (m) return m[1];
        }
      }
    }
  } catch (e) {
    // ignore
  }

  return 'unknown';
}
