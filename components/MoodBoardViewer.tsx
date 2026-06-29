import React, { useMemo, useState } from 'react';
import type { Material, MoodBoard } from '../types';
import {
  getMoodboardFeedMaterials,
  getMoodboardMainRenderImage,
  type MoodboardFeedMaterial,
} from '../utils/moodboardFeedUtils';
import DesignerAuthorLink from './DesignerAuthorLink';

interface MoodBoardViewerProps {
  board: MoodBoard;
  materials: Material[];
  onBack: () => void;
  onSelectMaterial: (material: Material) => void;
  onFindSimilar: (item: MoodboardFeedMaterial) => void;
}

const MoodBoardViewer: React.FC<MoodBoardViewerProps> = ({
  board,
  materials,
  onBack,
  onSelectMaterial,
  onFindSimilar,
}) => {
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

  const mainImage = useMemo(() => getMoodboardMainRenderImage(board), [board]);
  const feedMaterials = useMemo(
    () => getMoodboardFeedMaterials(board, materials),
    [board, materials]
  );

  const ownerLabel = board.ownerName ?? '设计师';

  const handleItemClick = (item: MoodboardFeedMaterial) => {
    setHighlightedItemId(item.itemId);
    if (item.isCustom) return;
    if (!item.materialId) return;
    const mat = materials.find((m) => m.id === item.materialId);
    if (mat) onSelectMaterial(mat);
  };

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm font-bold text-gray-500 hover:text-black transition-colors"
      >
        ← 返回探索库
      </button>

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
        <div className="flex-1 min-w-0">
          <div className="rounded-[28px] overflow-hidden bg-gray-100 border border-gray-100 shadow-sm aspect-[4/3] lg:aspect-auto lg:min-h-[32rem] relative">
            {mainImage ? (
              <img
                src={mainImage}
                alt={board.name}
                className="w-full h-full object-contain bg-white"
              />
            ) : (
              <div className="w-full h-full min-h-[16rem] flex items-center justify-center text-gray-300 text-5xl">
                🎨
              </div>
            )}
            {highlightedItemId && (
              <div className="absolute inset-0 ring-4 ring-inset ring-blue-500/40 pointer-events-none rounded-[28px]" />
            )}
          </div>
        </div>

        <div className="w-full lg:w-96 shrink-0">
          <div className="mb-6">
            <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              Published
            </span>
            <h1 className="text-2xl md:text-3xl font-black mt-3 tracking-tight">{board.name}</h1>
            {board.ownerId ? (
              <div className="mt-2">
                <DesignerAuthorLink
                  designerId={board.ownerId}
                  displayName={ownerLabel}
                  avatarUrl={board.ownerAvatar}
                />
              </div>
            ) : (
              <p className="text-xs text-gray-400 font-bold mt-2">{ownerLabel}</p>
            )}
            <p className="text-[10px] text-gray-300 font-bold mt-1 uppercase tracking-wider">
              {feedMaterials.length} 款材料
            </p>
          </div>

          <ul className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {feedMaterials.map((mat) => (
              <li key={mat.itemId}>
                <div
                  className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${
                    highlightedItemId === mat.itemId
                      ? 'bg-black text-white ring-2 ring-black shadow-lg'
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleItemClick(mat)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    {mat.imageUrl ? (
                      <img
                        src={mat.imageUrl}
                        alt=""
                        className={`w-14 h-14 rounded-xl object-cover shrink-0 ${
                          highlightedItemId === mat.itemId ? 'ring-2 ring-white/30' : ''
                        }`}
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-gray-200 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{mat.name}</p>
                      {!mat.isCustom && mat.code && (
                        <p
                          className={`text-[10px] font-bold truncate ${
                            highlightedItemId === mat.itemId ? 'text-white/70' : 'text-gray-400'
                          }`}
                        >
                          {mat.code}
                        </p>
                      )}
                    </div>
                  </button>
                  {mat.isCustom && (
                    <button
                      type="button"
                      onClick={() => onFindSimilar(mat)}
                      className={`shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                        highlightedItemId === mat.itemId
                          ? 'bg-white text-black'
                          : 'bg-white text-gray-700 border border-gray-200 hover:border-black'
                      }`}
                    >
                      寻找类似
                    </button>
                  )}
                </div>
              </li>
            ))}
            {feedMaterials.length === 0 && (
              <li className="text-center text-gray-300 text-sm py-12">暂无材料条目</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MoodBoardViewer;
