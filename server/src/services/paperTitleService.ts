const KNOWN_FILE_EXTENSIONS = ['.docx', '.doc', '.pdf', '.txt'];

function normalizeWhitespace(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function stripKnownFileExtensions(value: string | null | undefined) {
  let current = normalizeWhitespace(value);

  while (current) {
    current = current
      .replace(/\s*\(\.(docx|doc|pdf|txt)\)\(\d+\)\s*$/i, '')
      .replace(/\s*\(\.(docx|doc|pdf|txt)\)\s*$/i, '')
      .trim();

    const lower = current.toLowerCase();
    const matchedExtension = KNOWN_FILE_EXTENSIONS.find((extension) => lower.endsWith(extension));
    if (!matchedExtension) {
      break;
    }

    current = current.slice(0, current.length - matchedExtension.length).trim();
  }

  return current;
}

export function sanitizeFilenameBase(value: string | null | undefined, fallback: string) {
  const trimmed = normalizeWhitespace(value);
  const safe = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return safe || fallback;
}

export function deriveTaskTitle(
  explicitTitle: string | null | undefined,
  uploadedFileName: string | null | undefined,
  fallback = '未命名任务',
) {
  const manualTitle = normalizeWhitespace(explicitTitle);
  if (manualTitle) {
    return manualTitle;
  }

  const filenameTitle = stripKnownFileExtensions(uploadedFileName);
  return filenameTitle || fallback;
}

export function normalizeDeliveryPaperTitle(rawTitle: string | null | undefined, fallback = 'Academic Essay') {
  const normalized = stripKnownFileExtensions(rawTitle);
  return normalized || fallback;
}

export function buildDocxFileName(rawTitle: string | null | undefined, fallback = 'Academic Essay') {
  const displayTitle = normalizeDeliveryPaperTitle(rawTitle, fallback);
  return `${sanitizeFilenameBase(displayTitle, fallback)}.docx`;
}
