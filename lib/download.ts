// Hands bytes to the browser as a file. Browser only. The bytes come from lib/export.ts
// and are written exactly as given.

import type { FileDownload } from "./export";

export function saveFile({ filename, mime, bytes }: FileDownload): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
