export function isMobilePdfEnvironment(navigatorRef = globalThis.navigator) {
  if (typeof navigatorRef?.userAgentData?.mobile === "boolean") {
    return navigatorRef.userAgentData.mobile;
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigatorRef?.userAgent || ""));
}

export function canSharePdfFile(navigatorRef, file) {
  if (!isMobilePdfEnvironment(navigatorRef) || typeof navigatorRef?.share !== "function") {
    return false;
  }

  return typeof navigatorRef.canShare !== "function" || navigatorRef.canShare({ files: [file] });
}

export function isPdfDeliveryCancellation(error) {
  return error?.name === "AbortError" || error?.name === "NotAllowedError";
}

export async function choosePdfSaveHandle(windowRef, filename) {
  if (typeof windowRef?.showSaveFilePicker !== "function") return null;

  return windowRef.showSaveFilePicker({
    suggestedName: filename,
    types: [{
      description: "Relatório NEXO em PDF",
      accept: { "application/pdf": [".pdf"] },
    }],
  });
}

export async function writePdfToHandle(handle, blob) {
  if (!handle) return false;
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

export function triggerPdfDownload({ documentRef, url, filename }) {
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = filename;
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
}
