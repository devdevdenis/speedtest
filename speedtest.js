#!/usr/bin/env node
'use strict';

/**
 * Замер скорости скачивания.
 * Делает N последовательных GET-запросов к указанному адресу,
 * полностью вычитывает тело каждого ответа и считает статистику.
 *
 * Без внешних зависимостей: нужен Node.js 18+ (встроенный fetch).
 */

const { performance } = require('node:perf_hooks');

const DEFAULT_COUNT = 10;

function printUsage() {
  console.log(`Использование:
  node speedtest.js <url> [-n <кол-во запросов>]

Пример:
  node speedtest.js https://proof.ovh.net/files/10Mb.dat
  node speedtest.js https://example.com/big.jpg -n 5`);
}

function parseArgs(argv) {
  const args = { url: null, count: DEFAULT_COUNT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a === '-n' || a === '--count') {
      args.count = Number(argv[++i]);
    } else if (!args.url) {
      args.url = a;
    } else {
      throw new Error(`Неизвестный аргумент: ${a}`);
    }
  }
  if (args.help) return args;
  if (!args.url) throw new Error('Не указан адрес.');
  let parsed;
  try {
    parsed = new URL(args.url);
  } catch {
    throw new Error(`Некорректный адрес: ${args.url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Поддерживаются только http:// и https://');
  }
  if (!Number.isInteger(args.count) || args.count < 1) {
    throw new Error('Количество запросов (-n) должно быть целым числом >= 1.');
  }
  return args;
}

/**
 * Один запрос: время от отправки до получения последнего байта тела.
 * Тело читается потоком и не держится в памяти целиком.
 */
async function measureOnce(url) {
  const start = performance.now();
  const res = await fetch(url, {
    // identity — чтобы считать реально переданные байты, а не распакованные.
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', 'Accept-Encoding': 'identity' },
    redirect: 'follow',
  });
  if (!res.ok) {
    // Дочитываем тело, чтобы освободить соединение.
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  let bytes = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      bytes += chunk.byteLength;
    }
  }
  const ms = performance.now() - start;
  return { bytes, ms };
}

function formatBytes(bytes) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

// Мбит/с — мегабиты (10^6 бит) в секунду, как у провайдеров и speedtest.net.
function mbps(bytes, ms) {
  return ms > 0 ? (bytes * 8) / 1e6 / (ms / 1000) : 0;
}

// МБ/с — мебибайты (2^20 байт) в секунду, как в браузерах и менеджерах загрузок.
function mibps(bytes, ms) {
  return ms > 0 ? bytes / 1048576 / (ms / 1000) : 0;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Ошибка: ${err.message}\n`);
    printUsage();
    process.exit(1);
  }
  if (args.help) {
    printUsage();
    return;
  }

  const { url, count } = args;
  console.log(`Адрес: ${url}`);
  console.log(`Запросов: ${count} (последовательно)\n`);

  const results = [];
  for (let i = 1; i <= count; i++) {
    const label = `#${String(i).padStart(String(count).length)}`;
    try {
      const r = await measureOnce(url);
      results.push(r);
      console.log(
        `${label}  ${(r.ms / 1000).toFixed(3)} с  ${formatBytes(r.bytes).padStart(10)}  ` +
          `${mbps(r.bytes, r.ms).toFixed(2)} Мбит/с`
      );
    } catch (err) {
      const reason = err.cause?.message || err.message;
      console.log(`${label}  ошибка: ${reason}`);
    }
  }

  if (results.length === 0) {
    console.error('\nНи один запрос не завершился успешно.');
    process.exit(2);
  }

  const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  const avgMs = totalMs / results.length;

  console.log('\n— Итог —');
  console.log(`Успешных запросов:       ${results.length} из ${count}`);
  console.log(`Среднее время запроса:   ${(avgMs / 1000).toFixed(3)} с`);
  console.log(`Всего скачано:           ${formatBytes(totalBytes)} (${totalBytes} байт)`);
  console.log(
    `Скорость скачивания:     ${mbps(totalBytes, totalMs).toFixed(2)} Мбит/с ` +
      `(${mibps(totalBytes, totalMs).toFixed(2)} МБ/с)`
  );

  if (results.length < count) process.exit(3);
}

main();
