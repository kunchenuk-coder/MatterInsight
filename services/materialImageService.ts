import type { Material, PendingMaterial } from '../types';
import { parseOssObjectKey } from '../utils/parseOssObjectKey';
import {
  collectResolvableOssKeys,
  fetchReadUrlsForObjectKeys,
  resolveUrlFromMap,
} from './assetReadUrlService';

function materialImageSources(m: Material | PendingMaterial): {
  urls: string[];
  keys: string[];
} {
  const urls = [
    m.image,
    ...(m.variants ?? []).map((v) => v.imageUrl),
    ...(m.projectPhotos ?? []),
  ];
  const keys = [m.ossObjectKey ?? null];
  return { urls, keys };
}

function applyUrlMapToMaterial<T extends Material | PendingMaterial>(
  material: T,
  urlMap: Map<string, string>
): T {
  const key =
    parseOssObjectKey(material.ossObjectKey) ??
    parseOssObjectKey(material.image);

  return {
    ...material,
    image: resolveUrlFromMap(material.image, key, urlMap),
    variants: (material.variants ?? []).map((v) => ({
      ...v,
      imageUrl: resolveUrlFromMap(
        v.imageUrl,
        parseOssObjectKey(v.imageUrl),
        urlMap
      ),
    })),
    projectPhotos: (material.projectPhotos ?? []).map((p) =>
      resolveUrlFromMap(p, parseOssObjectKey(p), urlMap)
    ),
  };
}

/** 为库材料批量刷新 OSS 预签名图片 URL */
export async function enrichMaterialsWithFreshImages<T extends Material | PendingMaterial>(
  materials: T[]
): Promise<T[]> {
  if (materials.length === 0) return materials;

  const allUrls: string[] = [];
  const allKeys: string[] = [];
  for (const m of materials) {
    const { urls, keys } = materialImageSources(m);
    allUrls.push(...urls);
    allKeys.push(...keys);
  }

  const objectKeys = collectResolvableOssKeys(allUrls, allKeys);
  if (objectKeys.length === 0) return materials;

  const urlMap = await fetchReadUrlsForObjectKeys(objectKeys);
  if (urlMap.size === 0) return materials;

  return materials.map((m) => applyUrlMapToMaterial(m, urlMap));
}

export { parseOssObjectKey };
