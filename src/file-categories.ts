import { FileCategory } from "./types";

export const FILE_CATEGORIES: FileCategory[] = [
  {
    id: "image",
    nameKey: "categoryImage",
    replacement: "image",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp", "tiff"],
  },
];

export function getCategoryForExt(ext: string): FileCategory | undefined {
  const normalized = ext.toLowerCase();
  return FILE_CATEGORIES.find((cat) => cat.extensions.includes(normalized));
}

export function getAllKnownExtensions(): string[] {
  return FILE_CATEGORIES.flatMap((cat) => cat.extensions);
}
