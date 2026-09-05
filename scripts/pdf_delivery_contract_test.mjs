import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canSharePdfFile,
  isMobilePdfEnvironment,
  isPdfDeliveryCancellation,
  writePdfToHandle,
} from "../lib/ui/pdf_delivery.mjs";

assert.equal(isMobilePdfEnvironment({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile" }), true);
assert.equal(isMobilePdfEnvironment({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" }), false);
assert.equal(isMobilePdfEnvironment({ userAgentData: { mobile: true }, userAgent: "Desktop" }), true);

const fakeFile = { name: "NEXO_BBAS3.pdf" };
assert.equal(canSharePdfFile({ userAgent: "iPhone Mobile", share() {}, canShare: () => true }, fakeFile), true);
assert.equal(canSharePdfFile({ userAgent: "iPhone Mobile", share() {}, canShare: () => false }, fakeFile), false);
assert.equal(canSharePdfFile({ userAgent: "Desktop", share() {}, canShare: () => true }, fakeFile), false);

const writes = [];
const handle = {
  async createWritable() {
    return {
      async write(value) { writes.push(value); },
      async close() { writes.push("closed"); },
    };
  },
};
const blob = { type: "application/pdf" };
assert.equal(await writePdfToHandle(handle, blob), true);
assert.deepEqual(writes, [blob, "closed"]);
assert.equal(await writePdfToHandle(null, blob), false);
assert.equal(isPdfDeliveryCancellation({ name: "AbortError" }), true);
assert.equal(isPdfDeliveryCancellation({ name: "NotAllowedError" }), true);
assert.equal(isPdfDeliveryCancellation(new Error("falha")), false);

const page = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
assert.match(page, /navigator\.share\(\{/);
assert.match(page, /choosePdfSaveHandle\(window, fallbackFilename\)/);
assert.match(page, /previewWindow\.location\.href = url/);
assert.match(page, /triggerPdfDownload/);

console.log("pdf delivery: 16/16 checks passed");
