import type { LocalTemporaryMaterial } from "../types";

const storageKey = (designerId: string) => `matter_insight_local_materials_${designerId}`;

export const LOCAL_TEMP_DEFAULT_NAME = "自定义材质";
export const LOCAL_TEMP_DEFAULT_SPEC = "标准";

export function loadLocalDesignerMaterials(designerId: string): LocalTemporaryMaterial[] {
  if (!designerId) return [];
  try {
    const raw = localStorage.getItem(storageKey(designerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is Record<string, unknown> =>
          !!x && typeof x === "object" && typeof x.id === "string"
      )
      .map(normalizeLocalTemporaryMaterial)
      .filter((x): x is LocalTemporaryMaterial => !!x.imageUrl);
  } catch {
    return [];
  }
}

function normalizeLocalTemporaryMaterial(
  raw: Record<string, unknown>
): LocalTemporaryMaterial {
  const imageUrl =
    typeof raw.imageUrl === "string"
      ? raw.imageUrl
      : typeof raw.compressedBase64 === "string"
        ? raw.compressedBase64
        : "";
  return {
    id: String(raw.id),
    designerId: String(raw.designerId ?? ""),
    name: typeof raw.name === "string" ? raw.name : LOCAL_TEMP_DEFAULT_NAME,
    spec: typeof raw.spec === "string" ? raw.spec : LOCAL_TEMP_DEFAULT_SPEC,
    imageUrl,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    isLocalStorageMaterial: true,
    isEditedByUser: true,
  };
}

export function saveLocalDesignerMaterials(
  designerId: string,
  items: LocalTemporaryMaterial[]
): void {
  if (!designerId) return;
  localStorage.setItem(storageKey(designerId), JSON.stringify(items));
}

export function createLocalTemporaryMaterial(
  designerId: string,
  imageUrl: string,
  opts?: { name?: string; spec?: string }
): LocalTemporaryMaterial {
  return {
    id: `lmat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    designerId,
    name: opts?.name ?? LOCAL_TEMP_DEFAULT_NAME,
    spec: opts?.spec ?? LOCAL_TEMP_DEFAULT_SPEC,
    imageUrl,
    createdAt: Date.now(),
    isLocalStorageMaterial: true,
    isEditedByUser: true,
  };
}

export function upsertLocalDesignerMaterial(
  _designerId: string,
  items: LocalTemporaryMaterial[],
  patch: LocalTemporaryMaterial
): LocalTemporaryMaterial[] {
  const idx = items.findIndex((x) => x.id === patch.id);
  if (idx < 0) return [...items, patch];
  const next = [...items];
  next[idx] = { ...next[idx], ...patch, isLocalStorageMaterial: true, isEditedByUser: true };
  return next;
}
