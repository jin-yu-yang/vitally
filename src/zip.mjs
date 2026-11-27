// A stored (uncompressed) ZIP writer for the season export. Browser-safe.
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStored(files, date) {
  const encoder = new TextEncoder();
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  const entries = files.map((file) => {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    return { name, data, crc: crc32(data), offset: 0 };
  });

  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;

  for (const e of entries) {
    e.offset = at;
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 0x0800, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, day, true);
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.data.length, true);
    view.setUint32(at + 22, e.data.length, true);
    view.setUint16(at + 26, e.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(e.name, at + 30);
    out.set(e.data, at + 30 + e.name.length);
    at += 30 + e.name.length + e.data.length;
  }

  const directory = at;
  for (const e of entries) {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, day, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.data.length, true);
    view.setUint32(at + 24, e.data.length, true);
    view.setUint16(at + 28, e.name.length, true);
    view.setUint32(at + 42, e.offset, true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  }

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - directory, true);
  view.setUint32(at + 16, directory, true);
  return out;
}
