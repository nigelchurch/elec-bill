// Saving files to the phone, and the full CSV backup.
//
// A web page can't write to the file system directly. Instead it creates the
// file in memory (a "Blob"), makes a temporary link to it and clicks that link
// with a download name: Chrome then saves it to the Downloads folder.

import { getAll, setMeta } from './db.js';
import { toBackupCSV } from './csv.js';
import { todayISO } from './format.js';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000); // free the memory once saved
}

// Download the full backup (every reading and bill) and record the date.
// Returns the filename.
export async function downloadBackup() {
  const [readings, bills] = await Promise.all([getAll('readings'), getAll('bills')]);
  const filename = `ElecBackup-${todayISO()}.csv`;
  downloadBlob(new Blob([toBackupCSV(readings, bills)], { type: 'text/csv' }), filename);
  await setMeta('lastBackup', todayISO());
  return filename;
}

// Open the Android share sheet with a file (e.g. to send the PDF via LINE).
// Returns 'shared', 'cancelled', or 'unavailable'.
// Only the file is sent (no title or text): some share targets, e.g. LINE and
// mail on Windows, may ignore a share that carries both.
export async function shareFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) return 'unavailable';
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (err) {
    return err.name === 'AbortError' ? 'cancelled' : 'unavailable';
  }
}
