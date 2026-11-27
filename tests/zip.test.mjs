import test from "node:test";
import assert from "node:assert/strict";
import { crc32, zipStored } from "../src/zip.mjs";
import { readZip } from "./support/read-zip.mjs";

const encode = (text) => new TextEncoder().encode(text);
const when = new Date(2026, 10, 27, 13, 45, 10);

test("crc32 of \"123456789\" is 0xCBF43926", () => {
  assert.equal(crc32(encode("123456789")), 0xcbf43926);
});

test("round-trips names, order and contents", () => {
  const input = [
    { name: "README.txt", text: "hi\r\n" },
    { name: "cases.csv", text: "\uFEFFa,b\r\n" },
  ];
  const files = readZip(zipStored(input, when));
  assert.deepEqual(files.map((f) => f.name), ["README.txt", "cases.csv"]);
  files.forEach((f, i) => {
    assert.equal(f.method, 0);
    assert.equal(f.crc, crc32(f.data));
    assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(f.data), input[i].text);
  });
});

test("UTF-8 names set flag bit 11", () => {
  const [file] = readZip(zipStored([{ name: "李小明.csv", text: "x" }], when));
  assert.equal(file.name, "李小明.csv");
  assert.notEqual(file.flags & 0x0800, 0);
});

test("an empty file", () => {
  const [file] = readZip(zipStored([{ name: "x.csv", text: "" }], when));
  assert.equal(file.data.length, 0);
  assert.equal(file.crc, 0);
});

test("starts with PK\x03\x04 and ends with the end record", () => {
  const bytes = zipStored([{ name: "a.csv", text: "a" }], when);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...bytes.subarray(bytes.length - 22, bytes.length - 18)], [0x50, 0x4b, 0x05, 0x06]);
});
