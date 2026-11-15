// Local folder backend: File System Access API. No OAuth, no Google Cloud.
// Choose the folder Google Drive for Desktop syncs; the browser writes JSON there
// and Drive carries it to the Mac.
import { stamp } from "./drive.js";

export function folderSupported() {
  return typeof window.showDirectoryPicker === "function";
}

export async function pickFolder() {
  if (!folderSupported()) throw new Error("This browser cannot open a folder. Use Chrome or Edge.");
  return window.showDirectoryPicker({ id: "tubeshelf-backups", mode: "readwrite" });
}

export async function folderPermission(handle) {
  if (!handle?.queryPermission) return "granted";
  return handle.queryPermission({ mode: "readwrite" });
}

export async function requestFolderPermission(handle) {
  if (!handle?.requestPermission) return "granted";
  return handle.requestPermission({ mode: "readwrite" });
}

export async function listBackups(handle) {
  const files = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || !/\.json$/i.test(entry.name)) continue;
    const file = await entry.getFile();
    files.push({
      name: entry.name,
      entry,
      lastModified: file.lastModified,
      size: file.size,
    });
  }
  return files.sort((a, b) => b.lastModified - a.lastModified);
}

export async function readText(entry) {
  return (await entry.getFile()).text();
}

export async function writeText(handle, name, text) {
  const entry = await handle.getFileHandle(name, { create: true });
  const writable = await entry.createWritable();
  await writable.write(text);
  await writable.close();
  return entry;
}

export async function deleteFile(handle, name) {
  await handle.removeEntry(name);
}

export function folderAutosaveName(date = new Date()) {
  return `TubeShelf Autosave (Local Sync) ${stamp(date)}.json`;
}

export function isFolderAutosave(name) {
  return /^TubeShelf Autosave \(Local Sync\) .*\.json$/.test(String(name || ""));
}

export function folderRetentionVictims(files, keep = 24) {
  return files
    .filter((file) => isFolderAutosave(file.name))
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(keep);
}

export function latestBackup(files) {
  return files[0] || null;
}
