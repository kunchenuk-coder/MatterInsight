
import React, { useState } from 'react';
import { Material, MoodBoard } from '../types';

interface PinterestFeedProps {
  materials: Material[];
  onSelect: (material: Material) => void;
  onSave: (id: string, moodboardId?: string, newMoodboardName?: string) => void;
  savedIds: string[];
  moodboards?: MoodBoard[];
}

const PinterestFeed: React.FC<PinterestFeedProps> = ({ materials, onSelect, onSave, savedIds, moodboards = [] }) => {
  const [showSaveMenu, setShowSaveMenu] = useState<string | null>(null);
  const [isCreatingNewFromFeed, setIsCreatingNewFromFeed] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [hoveredMaterial, setHoveredMaterial] = useState<string | null>(null);
  const [activeVariantMap, setActiveVariantMap] = useState<Record<string, string>>({});

  const toggleLike = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setLikedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const getDisplayImage = (mat: Material) => {
    const activeVariantId = activeVariantMap[mat.id];
    if (activeVariantId && mat.variants) {
      const variant = mat.variants.find(v => v.id === activeVariantId);
      if (variant) return variant.imageUrl;
    }
    return mat.image;
  };

  return (
    <div className="columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6 pb-20">
      {materials.map((mat) => {
        const isCollected = savedIds.includes(mat.id);
        return (
        <div 
          key={mat.id}
          onClick={() => onSelect(mat)}
          onMouseEnter={() => setHoveredMaterial(mat.id)}
          onMouseLeave={() => setHoveredMaterial(null)}
          className="break-inside-avoid relative group cursor-pointer overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300"
        >
          <img 
            src={getDisplayImage(mat)} 
            alt={mat.name} 
            className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-500" 
          />
          
          {mat.variants && mat.variants.length > 0 && (
            <div className="absolute top-3 left-3 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              {mat.variants.slice(0, 4).map(v => (
                <button
                  key={v.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveVariantMap(prev => ({ ...prev, [mat.id]: v.id }));
                  }}
                  className={`w-4 h-4 rounded-full border border-white shadow-sm transition-transform hover:scale-125 ${activeVariantMap[mat.id] === v.id ? 'ring-2 ring-black scale-110' : ''}`}
                  style={{ backgroundColor: v.colorCode }}
                />
              ))}
            </div>
          )}
          
          <div className="p-4">
            <div className="flex justify-between items-start mb-1">
              <h3 className="font-bold text-gray-900 line-clamp-1">{mat.name}</h3>
              <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-bold uppercase">{mat.category.slice(0,2)}</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">{mat.brand}</p>
            
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                 <button 
                   onClick={(e) => toggleLike(e, mat.id)}
                   className="flex items-center gap-1 text-[10px] text-gray-400 font-bold hover:text-red-500 transition-colors"
                 >
                    <span className={likedIds.includes(mat.id) ? "text-red-500" : ""}>
                      {likedIds.includes(mat.id) ? '❤️' : '🤍'}
                    </span> 
                    {Math.floor(mat.clicks / 10) + mat.saves + (likedIds.includes(mat.id) ? 1 : 0)}
                 </button>
                 <div className="flex items-center gap-1 text-[10px] text-gray-400 font-bold">
                    <span className={mat.clicks > 0 ? "text-gray-900" : ""}>👀</span> {mat.clicks}
                 </div>
                 <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const shareUrl = `${window.location.origin}${window.location.pathname}#/share/${mat.id}`;
                      navigator.clipboard.writeText(shareUrl).then(() => alert('分享链接已复制'));
                    }}
                    className="flex items-center gap-1 text-[10px] text-gray-400 font-bold hover:text-blue-500 transition-colors ml-1"
                    title="分享"
                 >
                   📢
                 </button>
              </div>
              <div className="relative flex items-center gap-1">
                <button
                  type="button"
                  title={isCollected ? '已收藏，点击取消' : '加入收藏'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSave(mat.id);
                  }}
                  className={`p-2 rounded-full shadow-md transition-colors ${
                    isCollected
                      ? 'bg-red-500 text-white ring-2 ring-red-400/90'
                      : 'bg-white text-gray-400 hover:text-red-500'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill={isCollected ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  title="存入情绪板"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSaveMenu(showSaveMenu === mat.id ? null : mat.id);
                  }}
                  className={`p-2 rounded-full shadow-md transition-colors bg-white text-gray-500 hover:text-black ${
                    showSaveMenu === mat.id ? 'ring-2 ring-gray-300' : ''
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showSaveMenu === mat.id && (
                  <div className="absolute bottom-full right-0 mb-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                    <div className="p-3 border-b bg-gray-50">
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">存入情绪板</p>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {moodboards.map(mb => (
                        <button
                          key={mb.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSave(mat.id, mb.id);
                            setShowSaveMenu(null);
                          }}
                          className="w-full text-left px-4 py-3 text-xs font-bold hover:bg-gray-50 flex items-center justify-between group"
                        >
                          <span className="truncate">{mb.name}</span>
                          <span className="opacity-0 group-hover:opacity-100 text-black">+</span>
                        </button>
                      ))}
                    </div>
                    {isCreatingNewFromFeed === mat.id ? (
                      <div className="p-3 border-t bg-gray-50 flex gap-2">
                        <input 
                          autoFocus
                          type="text"
                          placeholder="新情绪板名称"
                          className="flex-1 text-[10px] bg-white border rounded px-2 py-1 outline-none font-bold"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              const name = (e.target as HTMLInputElement).value;
                              if (name) {
                                onSave(mat.id, undefined, name);
                                setIsCreatingNewFromFeed(null);
                                setShowSaveMenu(null);
                              }
                            }
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                         <button 
                          onClick={(e) => { e.stopPropagation(); setIsCreatingNewFromFeed(null); }}
                          className="text-gray-400 text-[10px] font-bold"
                        >取消</button>
                      </div>
                    ) : (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsCreatingNewFromFeed(mat.id); }}
                        className="w-full text-left px-4 py-3 text-[10px] font-black text-gray-800 border-t hover:bg-gray-50 uppercase tracking-widest flex items-center justify-between"
                      >
                        <span>+ 新建情绪板</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
};

export default PinterestFeed;
