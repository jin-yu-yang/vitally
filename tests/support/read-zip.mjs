// Reads back a ZIP written by src/zip.mjs: end record, then the central
// directory, then each local header. Test helper only.
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error("no end record");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad central entry");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("bad local header");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.push({ name, method, flags, crc, data: bytes.slice(start, start + size) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
