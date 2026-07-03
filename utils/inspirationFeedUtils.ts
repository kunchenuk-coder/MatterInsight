import type { Material } from '../types';
import type { InspirationStory } from '../types/materialDetail';
import { toMaterialDetail } from '../data/materialDetailMock';

export type InspirationFeedItem = {
  story: InspirationStory;
  material: Material;
};

/** Approved inspiration stories embedded in published materials (`materials.data.humanDna`). */
export function collectApprovedInspirationStories(
  materials: Material[]
): InspirationFeedItem[] {
  const items: InspirationFeedItem[] = [];

  for (const material of materials) {
    const { inspiration_stories } = toMaterialDetail(material);
    for (const story of inspiration_stories) {
      if (story.status === 'approved') {
        items.push({ story, material });
      }
    }
  }

  return items.sort((a, b) => b.story.id.localeCompare(a.story.id));
}
