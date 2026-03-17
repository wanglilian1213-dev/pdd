export type TaskFileCategory = 'final_doc' | 'citation_report' | 'humanized_doc' | (string & {});

export interface TaskFile {
  id: string;
  category: TaskFileCategory;
  filename: string;
  createdAt: string;
}

export interface DownloadCard {
  category: TaskFileCategory;
  file: TaskFile;
}

interface BuildDownloadCardsOptions {
  includeCategories?: TaskFileCategory[];
}

const CATEGORY_ORDER: TaskFileCategory[] = ['final_doc', 'citation_report', 'humanized_doc'];

export function normalizeTaskFiles(rawFiles: Array<Record<string, unknown>> | undefined): TaskFile[] {
  if (!rawFiles || rawFiles.length === 0) {
    return [];
  }

  return rawFiles
    .filter((file) => file.category !== 'material')
    .filter((file): file is Record<string, unknown> & { category: TaskFileCategory } =>
      typeof file.category === 'string' && file.category.length > 0,
    )
    .map((file) => ({
      id: String(file.id),
      category: file.category,
      filename: String(file.original_name ?? file.filename ?? ''),
      createdAt: String(file.created_at ?? ''),
    }))
    .filter((file) => Boolean(file.id) && Boolean(file.filename));
}

export function buildDownloadCards(
  files: TaskFile[],
  options: BuildDownloadCardsOptions = {},
): DownloadCard[] {
  const includeCategories = options.includeCategories ?? files.map((file) => file.category);
  const latestByCategory = new Map<string, TaskFile>();

  for (const file of files) {
    if (!includeCategories.includes(file.category)) {
      continue;
    }

    const current = latestByCategory.get(file.category);
    if (!current || current.createdAt < file.createdAt) {
      latestByCategory.set(file.category, file);
    }
  }

  const categories = Array.from(latestByCategory.keys()).sort((left, right) => {
    const leftIndex = CATEGORY_ORDER.indexOf(left);
    const rightIndex = CATEGORY_ORDER.indexOf(right);

    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });

  return categories
    .map((category) => {
      const file = latestByCategory.get(category);
      return file ? { category: file.category, file } : null;
    })
    .filter((card): card is DownloadCard => Boolean(card));
}
