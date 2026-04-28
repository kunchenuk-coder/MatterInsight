
import React, { useState, useRef } from 'react';
import html2canvas from 'html2canvas';
import { GoogleGenAI, Type } from "@google/genai";
import { User, Material, MoodBoard, MoodBoardItem, Category } from '../types';

interface MoodBoardProps {
  user: User;
  points: number;
  materials: Material[];
  savedIds: string[];
  moodboards: MoodBoard[];
  setMoodboards: React.Dispatch<React.SetStateAction<MoodBoard[]>>;
  activeMoodboardId: string;
  setActiveMoodboardId: (id: string) => void;
  onDeductPoints: (amt: number, desc: string) => void;
}

const compressImage = (file: File, maxWidth = 1200, quality = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

const MoodBoardDesigner: React.FC<MoodBoardProps> = ({ 
  user, points, materials, savedIds, moodboards, setMoodboards, 
  activeMoodboardId, setActiveMoodboardId, onDeductPoints 
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [resizingItem, setResizingItem] = useState<{ id: string; startWidth: number; startHeight: number; startX: number; startY: number } | null>(null);
  const [draggingItem, setDraggingItem] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isFinalMode, setIsFinalMode] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewingCapturedImage, setIsPreviewingCapturedImage] = useState(false);
  const [capturedImageData, setCapturedImageData] = useState<string | null>(null);
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isSelectingCrop, setIsSelectingCrop] = useState(false);
  const [resizingCropHandle, setResizingCropHandle] = useState<'tl'|'tr'|'bl'|'br'|null>(null);
  const [isMovingCropBox, setIsMovingCropBox] = useState(false);
  const [movingCropOffset, setMovingCropOffset] = useState<{ x: number; y: number } | null>(null);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [tempPointerPos, setTempPointerPos] = useState<{x: number, y: number} | null>(null);
  const [analysisStep, setAnalysisStep] = useState<1 | 2>(1); // 1: Upload, 2: Review
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiImage, setAiImage] = useState<string | null>(null);
  const [isPreviewingImage, setIsPreviewingImage] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | 'ALL'>('ALL');
  const [matchResults, setMatchResults] = useState<{ material: Material; remark: string; coords: {x: number, y: number}, logic: string }[] | null>(null);
  const [visualAnnotations, setVisualAnnotations] = useState<any[] | null>(null);
  const [aiRecommendations, setAiRecommendations] = useState<Material[]>([]);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const activeBoard = moodboards.find(b => b.id === activeMoodboardId) || moodboards[0];
  const savedMaterials = materials.filter(m => savedIds.includes(m.id));

  // Migration: Ensure all boards have the new higher capacity
  React.useEffect(() => {
    const updatedBoards = moodboards.map(mb => {
      const minCapacity = mb.isPaid ? 60 : 30;
      if (mb.maxMaterials < minCapacity) {
        return { ...mb, maxMaterials: minCapacity };
      }
      return mb;
    });
    
    // Only update if changes were actually made to avoid infinite loops
    const hasChanges = updatedBoards.some((mb, idx) => mb.maxMaterials !== moodboards[idx].maxMaterials);
    if (hasChanges) {
      setMoodboards(updatedBoards);
    }
  }, [moodboards, setMoodboards]);

  const handleCreateBoard = () => {
    const freeBoards = moodboards.filter(b => !b.isPaid).length;
    let newBoard: MoodBoard;

    if (freeBoards < 3) {
      newBoard = { id: `mb_${Date.now()}`, name: `新建情绪板 ${moodboards.length + 1}`, items: [], isPaid: false, maxMaterials: 30 };
    } else {
      if (confirm('免费情绪板已达上限(3个)。是否消耗 50 积分创建一个高级情绪板？(限额60款材料)')) {
        if (points < 50) return alert('积分不足');
        onDeductPoints(50, '创建高级情绪板');
        newBoard = { id: `mb_${Date.now()}`, name: `高级情绪板 ${moodboards.length + 1}`, items: [], isPaid: true, maxMaterials: 60 };
      } else return;
    }
    setMoodboards([...moodboards, newBoard]);
    setActiveMoodboardId(newBoard.id);
  };

  const addItem = (mat: Material) => {
    const materialCount = activeBoard.items.filter(i => i.type === 'material' || i.type === 'sample').length;
    if (materialCount >= activeBoard.maxMaterials) {
      return alert(`当前情绪板材质卡片已达上限 (${activeBoard.maxMaterials}款)`);
    }

    const maxZ = Math.max(...activeBoard.items.map(x => x.zIndex), 0);
    const canvasWidth = canvasRef.current?.clientWidth || 800;
    const canvasHeight = canvasRef.current?.clientHeight || 600;

    const newItem: MoodBoardItem = {
      id: Math.random().toString(36).substr(2, 9),
      materialId: mat.id,
      type: 'material',
      x: canvasWidth / 2 - 100 + (Math.random() - 0.5) * 40,
      y: 150 + (Math.random() * 50),
      width: 200, height: 200,
      zIndex: maxZ + 1,
      remark: `${mat.name}\n${mat.specifications || '标准'}`
    };
    updateBoardItems([...activeBoard.items, newItem]);
  };

  const updateBoardItems = (items: MoodBoardItem[]) => {
    if (!activeBoard) return;
    setMoodboards(prev => prev.map(b => b.id === activeBoard.id ? { ...b, items } : b));
  };

  const handleStartAction = (e: React.MouseEvent | React.TouchEvent, id: string, type: 'move' | 'resize') => {
    if (isFinalMode) return;
    const item = activeBoard.items.find(i => i.id === id);
    if (!item || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    if (type === 'resize') {
      setResizingItem({ id, startWidth: item.width, startHeight: item.height, startX: clientX, startY: clientY });
    } else {
      setDraggingItem({ id, offsetX: clientX - rect.left - item.x, offsetY: clientY - rect.top - item.y });
    }
    // Bring to front, but keep markers/lines logically above
    const maxZ = Math.max(...activeBoard.items.map(x => x.zIndex), 0);
    updateBoardItems(activeBoard.items.map(i => {
      if (i.id === id) {
        // Markers stay at high zIndex, others increment
        return { ...i, zIndex: i.type === 'marker' ? 1000 : maxZ + 1 };
      }
      return i;
    }));
  };

  const handleMoveAction = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    if (isExporting || isPreviewingCapturedImage) return;
    
    if (isFinalMode && isMovingCropBox && cropBox && movingCropOffset && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const curX = clientX - rect.left + canvasRef.current.scrollLeft;
      const curY = clientY - rect.top + canvasRef.current.scrollTop;
      setCropBox({
        ...cropBox,
        x: curX - movingCropOffset.x,
        y: curY - movingCropOffset.y
      });
      return;
    }

    if (isFinalMode && resizingCropHandle && cropBox && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const curX = clientX - rect.left + canvasRef.current.scrollLeft;
      const curY = clientY - rect.top + canvasRef.current.scrollTop;
      
      let newBox = { ...cropBox };
      if (resizingCropHandle === 'tl') {
        const deltaX = curX - cropBox.x;
        const deltaY = curY - cropBox.y;
        newBox.x = curX;
        newBox.y = curY;
        newBox.w = Math.max(50, cropBox.w - deltaX);
        newBox.h = Math.max(50, cropBox.h - deltaY);
      } else if (resizingCropHandle === 'tr') {
        newBox.w = Math.max(50, curX - cropBox.x);
        const deltaY = curY - cropBox.y;
        newBox.y = curY;
        newBox.h = Math.max(50, cropBox.h - deltaY);
      } else if (resizingCropHandle === 'bl') {
        const deltaX = curX - cropBox.x;
        newBox.x = curX;
        newBox.w = Math.max(50, cropBox.w - deltaX);
        newBox.h = Math.max(50, curY - cropBox.y);
      } else if (resizingCropHandle === 'br') {
        newBox.w = Math.max(50, curX - cropBox.x);
        newBox.h = Math.max(50, curY - cropBox.y);
      }
      
      setCropBox(newBox);
      return;
    }

    if (isFinalMode && isSelectingCrop && cropStart && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const curX = clientX - rect.left + canvasRef.current.scrollLeft;
      const curY = clientY - rect.top + canvasRef.current.scrollTop;
      setCropBox({
        x: Math.min(cropStart.x, curX),
        y: Math.min(cropStart.y, curY),
        w: Math.abs(curX - cropStart.x),
        h: Math.abs(curY - cropStart.y)
      });
      return;
    }

    if (connectingFromId && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setTempPointerPos({
        x: clientX - rect.left,
        y: clientY - rect.top
      });
      return;
    }

    if (resizingItem) {
      const deltaX = clientX - resizingItem.startX;
      const scale = (resizingItem.startWidth + deltaX) / resizingItem.startWidth;
      const newWidth = Math.max(50, resizingItem.startWidth + deltaX);
      const newHeight = Math.max(50, resizingItem.startHeight * scale);
      
      const resizedItem = activeBoard.items.find(i => i.id === resizingItem.id);

      updateBoardItems(activeBoard.items.map(i => {
        if (i.id === resizingItem.id) {
          return { ...i, width: newWidth, height: newHeight };
        }
        
        // If resizing a parent drawing, move child markers
        if (resizedItem?.type === 'drawing' && i.parentId === resizedItem.id && i.type === 'marker') {
          return {
            ...i,
            x: resizedItem.x + ((i.relX ?? 0) * newWidth / 100),
            y: resizedItem.y + ((i.relY ?? 0) * newHeight / 100)
          };
        }
        
        return i;
      }));
    } else if (draggingItem && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const newX = clientX - rect.left - draggingItem.offsetX;
      const newY = clientY - rect.top - draggingItem.offsetY;
      
      const draggedItem = activeBoard.items.find(i => i.id === draggingItem.id);
      
      updateBoardItems(activeBoard.items.map(i => {
        if (i.id === draggingItem.id) {
          // If dragging a marker, update its relative positions if over parent
          if (i.type === 'marker' && i.parentId) {
            const parent = activeBoard.items.find(p => p.id === i.parentId);
            if (parent) {
              const relX = ((newX - parent.x) / parent.width) * 100;
              const relY = ((newY - parent.y) / parent.height) * 100;
              return { ...i, x: newX, y: newY, relX, relY };
            }
          }
          return { ...i, x: newX, y: newY };
        }
        
        // If dragging a parent drawing, move markers accordingly
        if (draggedItem?.type === 'drawing' && i.parentId === draggedItem.id && i.type === 'marker') {
          const relX = i.relX ?? 0;
          const relY = i.relY ?? 0;
          return { 
            ...i, 
            x: newX + (relX * draggedItem.width / 100),
            y: newY + (relY * draggedItem.height / 100)
          };
        }
        
        return i;
      }));
    }
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (isFinalMode && (isSelectingCrop || resizingCropHandle || isMovingCropBox)) {
      setIsSelectingCrop(false);
      setResizingCropHandle(null);
      setIsMovingCropBox(false);
      setMovingCropOffset(null);
      setCropStart(null);
      return;
    }

    if (connectingFromId && tempPointerPos) {
      const markers = activeBoard.items.filter(i => i.type === 'marker');
      const targetMarker = markers.find(m => {
        const dist = Math.sqrt(Math.pow(m.x + m.width/2 - tempPointerPos.x, 2) + Math.pow(m.y + m.height/2 - tempPointerPos.y, 2));
        return dist < 30; // Snapping radius
      });

      if (targetMarker) {
        updateBoardItems(activeBoard.items.map(i => {
          if (i.id === targetMarker.id) {
            return { ...i, targetId: connectingFromId };
          }
          return i;
        }));
      } else {
        // Create a new marker if no existing marker is close
        const drawing = activeBoard.items.find(i => i.type === 'drawing');
        const item = activeBoard.items.find(i => i.id === connectingFromId);
        if (drawing && item) {
          const markerId = `marker_auto_${Date.now()}`;
          const relX = ((tempPointerPos.x - drawing.x) / drawing.width) * 100;
          const relY = ((tempPointerPos.y - drawing.y) / drawing.height) * 100;
          
          const newMarker: MoodBoardItem = {
            id: markerId,
            type: 'marker',
            parentId: drawing.id,
            targetId: connectingFromId,
            relX, relY,
            x: tempPointerPos.x - 8,
            y: tempPointerPos.y - 8,
            width: 16, height: 16,
            zIndex: 1000,
            remark: item.remark || '标注点'
          };
          updateBoardItems([...activeBoard.items, newMarker]);
        }
      }
    }
    setResizingItem(null);
    setDraggingItem(null);
    setConnectingFromId(null);
    setTempPointerPos(null);
  };

  const handleExport = () => {
    // Real CSV Generation
    const headers = ['材料名称', '品牌', '规格', '分类', '价格区间'];
    const rows = activeBoard.items.map(item => {
      const mat = materials.find(m => m.id === item.materialId);
      return [
        mat?.name || '',
        mat?.brand || '',
        mat?.specifications || '',
        mat?.category || '',
        mat?.priceRange || ''
      ];
    });
    
    const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeBoard.name}_材料清单.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    onDeductPoints(20, `生成材料表: ${activeBoard.name}`);
    alert('已生成 Excel 材料清单，正在开始下载...');
  };

  const handleGenerateImage = () => {
    setIsFinalMode(true);
    setCropBox(null);
    
    // Auto-set crop box for mobile
    if (window.innerWidth < 768) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        setCropBox({
          x: canvasRef.current!.scrollLeft + rect.width * 0.1,
          y: canvasRef.current!.scrollTop + rect.height * 0.2,
          w: rect.width * 0.8,
          h: rect.height * 0.5
        });
      }
    }
  };

  const handleExportToImage = async () => {
    if (!cropBox || !canvasRef.current || isExporting) return;
    
    setIsExporting(true);
    
    // Hide selection UI and ensure clarity
    const overlay = document.querySelector('.selection-overlay-root') as HTMLElement;
    if (overlay) overlay.style.display = 'none';

    try {
      // Ensure the container is fully opaque during capture to avoid grey/faded look
      const originalOpacity = canvasRef.current.style.opacity;
      canvasRef.current.style.opacity = '1';
      
      // Calculate coordinates relative to the MOODBOARD CONTAINER
      // Note: cropBox.x/y already calculated relative to the content (includes scroll)
      const { x, y, w, h } = cropBox;
      
      const canvas = await html2canvas(canvasRef.current, {
        x,
        y,
        width: w,
        height: h,
        useCORS: true,
        scale: 3, 
        backgroundColor: null, 
        logging: false,
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
        windowWidth: canvasRef.current.scrollWidth,
        windowHeight: canvasRef.current.scrollHeight
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      setCapturedImageData(dataUrl);
      setIsPreviewingCapturedImage(true);
      
      // Cleanup
      canvasRef.current.style.opacity = originalOpacity;
      if (overlay) overlay.style.display = 'block';
    } catch (error) {
      console.error('Export error:', error);
      alert('生成预览失败，请尝试刷新页面。');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFinalSave = () => {
    if (!capturedImageData) return;
    onDeductPoints(10, `导出成品导图: ${activeBoard.name}`); // Reduced points for saving
    
    const link = document.createElement('a');
    link.href = capturedImageData;
    link.download = `${activeBoard.name}_成品导图_${new Date().toLocaleTimeString()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // EXIT ALL MODES AFTER SAVE
    setIsPreviewingCapturedImage(false);
    setIsFinalMode(false);
    setCropBox(null);
    setCapturedImageData(null);
  };

  const changeOrder = (id: string, dir: 'up' | 'down') => {
    const items = [...activeBoard.items].sort((a, b) => a.zIndex - b.zIndex);
    const idx = items.findIndex(i => i.id === id);
    if (dir === 'up' && idx < items.length - 1) {
      const temp = items[idx].zIndex;
      items[idx].zIndex = items[idx+1].zIndex;
      items[idx+1].zIndex = temp;
    } else if (dir === 'down' && idx > 0) {
      const temp = items[idx].zIndex;
      items[idx].zIndex = items[idx-1].zIndex;
      items[idx-1].zIndex = temp;
    }
    updateBoardItems(items);
  };
  
  const handleDownloadHD = async () => {
    const element = document.getElementById('moodboard-export-container');
    if (!element) return;
    
    try {
      const canvas = await html2canvas(element, {
        useCORS: true,
        scale: 3, // High definition
        backgroundColor: '#ffffff'
      });
      
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `${activeBoard.name}_高清情绪板.png`;
      link.href = dataUrl;
      link.click();
      
      onDeductPoints(30, `下载高清情绪板: ${activeBoard.name}`);
      setIsPreviewingImage(false);
    } catch (err) {
      console.error('Export failed:', err);
      alert('导出失败，请重试。');
    }
  };

  const handleAIAnalysis = async () => {
    if (!aiImage) return;
    setIsAnalyzing(true);
    setVisualAnnotations(null);
    setMatchResults(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const base64Data = aiImage.split(',')[1];
      
      const materialLibraryStr = materials.map(m => `ID: ${m.id}, Name: ${m.name}, Category: ${m.category}, Description: ${m.description || ''}`).join('\n');

      const prompt = `你现在是室内设计视觉专家，负责分析空间效果图。
      
      第一步：识别图中的主要材质和家具（如：黑色大理石、灰色水泥、皮沙发等）。
      第二步：为每个识别点提供其在图中相对于左上角的百分比坐标(x, y)。
      第三步：描述其核心参数和搭配逻辑。
      第四步：从以下材质库中寻找最匹配的材料 ID。
      
      材质库：
      ${materialLibraryStr}

      请返回 JSON 格式。`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: "image/jpeg" } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              annotations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    main_name: { type: Type.STRING },
                    parameter: { type: Type.STRING },
                    logic: { type: Type.STRING },
                    matched_material_id: { type: Type.STRING }
                  },
                  required: ["x", "y", "main_name", "parameter", "logic"]
                }
              }
            },
            required: ["annotations"]
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      const annotations = result.annotations || [];
      setVisualAnnotations(annotations);
      setAnalysisStep(2); // Analysis finished, go to review step
      
      // Update sidebar recommendations
      const matchedIds = annotations.map((a: any) => a.matched_material_id).filter(Boolean);
      setAiRecommendations(materials.filter(m => matchedIds.includes(m.id)));

      // Prepare match results for list grid in modal
      const matched: { material: Material; remark: string; coords: {x: number, y: number}, logic: string }[] = [];
      annotations.forEach((item: any) => {
        const mat = materials.find(m => m.id === item.matched_material_id);
        if (mat) {
          matched.push({
            material: mat,
            remark: `${item.main_name}: ${item.parameter}`,
            coords: { x: item.x, y: item.y },
            logic: item.logic
          });
        }
      });

      setMatchResults(matched);
      setIsAnalyzing(false);
    } catch (err) {
      console.error('AI Analysis failed:', err);
      alert('AI 识别失败，请重试。');
      setIsAnalyzing(false);
      setAnalysisStep(1);
    }
  };

  const confirmAIMatch = () => {
    if (!aiImage || !visualAnnotations) return;
    
    // Calculate center relative to current scroll position and container size
    const container = canvasRef.current;
    if (!container) return;

    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;

    const baseWidth = 600;
    const baseHeight = 400;

    const canvasCenterX = scrollLeft + (viewportWidth - baseWidth) / 2;
    const canvasCenterY = scrollTop + (viewportHeight - baseHeight) / 2;

    // 1. Add the main effect drawing
    const drawingId = `drawing_${Date.now()}`;
    const mainDrawing: MoodBoardItem = {
      id: drawingId,
      imageUrl: aiImage,
      type: 'drawing',
      x: canvasCenterX, 
      y: canvasCenterY, 
      width: baseWidth, 
      height: baseHeight,
      zIndex: activeBoard.items.length + 1,
      remark: 'AI 识别基准方案'
    };

    const newItems: MoodBoardItem[] = [mainDrawing];

    // 2. Add markers and samples with relational locking
    visualAnnotations.forEach((anno, idx) => {
      const markerId = `marker_${idx}_${Date.now()}`;
      const sampleId = `sample_${idx}_${Date.now()}`;
      
      // Add Marker (Locked to drawing)
      newItems.push({
        id: markerId,
        type: 'marker',
        parentId: drawingId,
        targetId: sampleId, // Link to sample
        relX: anno.x,
        relY: anno.y,
        x: canvasCenterX + (anno.x * baseWidth / 100), 
        y: canvasCenterY + (anno.y * baseHeight / 100),
        width: 16, height: 16,
        zIndex: activeBoard.items.length + 100 + idx,
        remark: anno.main_name
      });

      // Add Sample Block
      if (anno.matched_material_id) {
        const mat = materials.find(m => m.id === anno.matched_material_id);
        if (mat) {
          const isLeft = anno.x < 50;
          newItems.push({
            id: sampleId,
            materialId: mat.id,
            type: 'sample',
            parentId: drawingId,
            x: isLeft ? canvasCenterX - 250 : canvasCenterX + baseWidth + 50, 
            y: canvasCenterY + (idx % 4 * 180),
            width: 180, height: 180,
            zIndex: activeBoard.items.length + 50 + idx,
            remark: `${mat.name}\n${mat.specifications || '标准'}`
          });
        }
      }
    });

    updateBoardItems([...activeBoard.items, ...newItems]);
    setVisualAnnotations(null);
    setMatchResults(null);
    setAnalysisStep(1);
    setIsAIModalOpen(false);
    setAiImage(null);
  };

  const addPointerToItem = (item: MoodBoardItem) => {
    const drawing = activeBoard.items.find(i => i.type === 'drawing');
    if (!drawing) return alert('请先添加一张空间效果图方案。');

    const markerId = `marker_manual_${Date.now()}`;
    const newMarker: MoodBoardItem = {
      id: markerId,
      type: 'marker',
      parentId: drawing.id,
      targetId: item.id,
      relX: 20 + Math.random() * 60,
      relY: 20 + Math.random() * 60,
      x: drawing.x + 100,
      y: drawing.y + 100,
      width: 16, height: 16,
      zIndex: 1000,
      remark: item.remark || '标注点'
    };

    updateBoardItems([...activeBoard.items, newMarker]);
  };

  return (
    <div 
      className="flex h-[calc(100vh-120px)] bg-gray-50 rounded-3xl overflow-hidden border border-gray-200 relative" 
      onMouseMove={handleMoveAction} 
      onTouchMove={handleMoveAction}
      onMouseUp={() => { setDraggingItem(null); setResizingItem(null); }}
      onTouchEnd={() => { setDraggingItem(null); setResizingItem(null); }}
    >
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'w-1/2 md:w-80' : 'w-0'} bg-white border-r transition-all duration-300 flex flex-col overflow-hidden`}>
        <div className="p-6 border-b shrink-0">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold">我的情绪板</h3>
            <button onClick={handleCreateBoard} className="text-black bg-gray-100 p-2 rounded-lg hover:bg-black hover:text-white transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
            {moodboards.map(mb => (
              <button 
                key={mb.id} 
                onClick={() => setActiveMoodboardId(mb.id)}
                className={`w-full text-left p-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${activeMoodboardId === mb.id ? 'bg-black text-white' : 'hover:bg-gray-50 text-gray-400'}`}
              >
                <span className="truncate mr-2">{mb.name}</span>
                <span className="opacity-50 text-[9px] shrink-0">
                  {mb.items.filter(i => i.type === 'material' || i.type === 'sample').length}/{mb.maxMaterials}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* AI Recommendations Section */}
          {aiRecommendations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-[10px] font-black uppercase text-blue-500 tracking-widest flex items-center gap-1">
                  <span className="text-xs">✨</span> AI 推荐列表
                </h3>
                <button 
                  onClick={() => setAiRecommendations([])}
                  className="text-[9px] font-bold text-gray-400 hover:text-gray-600"
                >
                  清除
                </button>
              </div>
              <div className="space-y-2">
                {aiRecommendations.map(mat => (
                  <div key={`rec_${mat.id}`} onClick={() => addItem(mat)} className="flex items-center gap-4 p-2 rounded-xl bg-blue-50/50 border border-blue-100/50 hover:bg-blue-50 cursor-pointer group transition-all">
                    <img src={mat.image} className="w-12 h-12 rounded-lg object-cover shadow-sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{mat.name}</p>
                      <p className="text-[9px] text-gray-400 font-bold">{mat.brand}</p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-lg">➕</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">从收藏库添加</h3>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer bg-gray-100 p-1.5 rounded-lg hover:bg-black hover:text-white transition-all shadow-sm" title="添加网络图片/自定义图片">
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const compressed = await compressImage(file, 800, 0.7);
                        const newItem: MoodBoardItem = {
                          id: `custom_${Date.now()}`,
                          type: 'material',
                          imageUrl: compressed,
                          x: 200, y: 200, width: 200, height: 200,
                          zIndex: activeBoard.items.length + 1,
                          remark: '自定义材质'
                        };
                        updateBoardItems([...activeBoard.items, newItem]);
                      }
                    }}
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </label>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-1 px-2 mb-2">
              <button
                onClick={() => setSelectedCategory('ALL')}
                className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${selectedCategory === 'ALL' ? 'bg-black text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
              >
                全部
              </button>
              {Array.from(new Set(savedMaterials.map(m => m.category))).map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat as Category)}
                  className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${selectedCategory === cat ? 'bg-black text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                >
                  {cat.split(' ')[1] || cat}
                </button>
              ))}
            </div>

                {/* Check if already in moodboard */}
                {(() => {
                  const itemsWithThisCategory = savedMaterials.filter(m => selectedCategory === 'ALL' || m.category === selectedCategory);
                  // Use a Set to avoid duplicate categories in UI filtering logic if any
                  const uniqueCategories = Array.from(new Set(savedMaterials.map(m => m.category)));
                  
                  return (
                    <div className="space-y-4">
                      {itemsWithThisCategory.length === 0 ? (
                        <div className="p-8 text-center">
                          <p className="text-[10px] text-gray-400 font-bold">暂无匹配材料</p>
                          <p className="text-[9px] text-gray-300 mt-1">在探索库点击收藏后即可在此使用</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {itemsWithThisCategory.map(mat => (
                            <div 
                              key={mat.id} 
                              onClick={() => addItem(mat)} 
                              className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 border border-gray-100/50 cursor-pointer group transition-all active:scale-95"
                            >
                              <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-gray-100">
                                <img src={mat.image} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-black truncate text-black">{mat.name}</p>
                                <p className="text-[9px] text-gray-400 font-bold tracking-tight uppercase">{mat.brand}</p>
                              </div>
                              <div className="bg-black text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                                </svg>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

      {/* Canvas */}
      <div className="flex-1 relative flex flex-col overflow-hidden touch-none">
        <div className="h-16 bg-white border-b flex items-center justify-between px-4 md:px-8 z-20 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
              className="p-3 bg-gray-100 hover:bg-black hover:text-white rounded-xl transition-all shadow-sm"
              title={isSidebarOpen ? "隐藏材料库" : "显示材料库"}
            >
              {isSidebarOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              )}
            </button>
            
            {isEditingName ? (
              <input 
                autoFocus
                value={activeBoard.name} 
                onBlur={() => setIsEditingName(false)}
                onKeyDown={e => e.key === 'Enter' && setIsEditingName(false)}
                onChange={e => setMoodboards(prev => prev.map(b => b.id === activeMoodboardId ? { ...b, name: e.target.value } : b))}
                className="text-sm md:text-lg font-black outline-none border-b-2 border-black bg-transparent w-32 md:w-auto"
              />
            ) : (
              <h2 
                onClick={() => setIsEditingName(true)}
                className="text-sm md:text-lg font-black cursor-pointer hover:text-gray-600 transition-colors"
                title="点击编辑名称"
              >
                {activeBoard.name}
              </h2>
            )}
            {activeBoard.isPaid && <span className="bg-yellow-400 text-black text-[9px] font-black px-2 py-0.5 rounded-full hidden sm:inline">PRO</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="bg-gray-100 text-black px-3 md:px-6 py-2 rounded-full text-[10px] md:text-xs font-bold hover:bg-black hover:text-white transition-all">生成材料表</button>
            <button onClick={handleGenerateImage} className="bg-black text-white px-3 md:px-6 py-2 rounded-full text-[10px] md:text-xs font-bold shadow-lg">生成大图</button>
          </div>
        </div>

        <div 
          className={`flex-1 relative moodboard-canvas overflow-x-auto overflow-y-auto p-40 transition-all duration-500 bg-[#fafafa] flex items-center justify-center min-h-[1400px] min-w-[2000px] scroll-smooth ${isFinalMode ? 'cursor-crosshair' : ''} ${isExporting ? 'pointer-events-none' : ''}`} 
          ref={canvasRef}
          onMouseDown={(e) => {
            if (isExporting || isPreviewingCapturedImage || isPreviewingImage || isAIModalOpen || connectingFromId) return;
            if (isFinalMode) {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (rect && canvasRef.current) {
                const x = e.clientX - rect.left + canvasRef.current.scrollLeft;
                const y = e.clientY - rect.top + canvasRef.current.scrollTop;
                
                // 1. Check for resize handles FIRST
                if (cropBox) {
                  const threshold = 35;
                  const hX = cropBox.x + cropBox.w;
                  const hY = cropBox.y + cropBox.h;
                  
                  if (Math.abs(x - cropBox.x) < threshold && Math.abs(y - cropBox.y) < threshold) {
                    setResizingCropHandle('tl'); return;
                  }
                  if (Math.abs(x - hX) < threshold && Math.abs(y - cropBox.y) < threshold) {
                    setResizingCropHandle('tr'); return;
                  }
                  if (Math.abs(x - cropBox.x) < threshold && Math.abs(y - hY) < threshold) {
                    setResizingCropHandle('bl'); return;
                  }
                  if (Math.abs(x - hX) < threshold && Math.abs(y - hY) < threshold) {
                    setResizingCropHandle('br'); return;
                  }

                  // 2. Check for move (click inside)
                  if (x >= cropBox.x && x <= cropBox.x + cropBox.w && y >= cropBox.y && y <= cropBox.y + cropBox.h) {
                    setIsMovingCropBox(true);
                    setMovingCropOffset({ x: x - cropBox.x, y: y - cropBox.y });
                    return;
                  }
                }
                
                // 3. Only if clicking outside/new area, start selection
                setCropStart({ x, y });
                setIsSelectingCrop(true);
                setCropBox(null);
                setIsMovingCropBox(false);
                setResizingCropHandle(null);
              }
            }
          }}
          onMouseMove={handleMoveAction}
          onMouseUp={handlePointerUp}
          onTouchMove={handleMoveAction}
          onTouchEnd={handlePointerUp}
        >
          <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-50" />
          
          {activeBoard.items.sort((a, b) => a.zIndex - b.zIndex).map(item => {
            const mat = item.materialId ? materials.find(m => m.id === item.materialId) : null;
            const isDrawing = item.type === 'drawing';
            const isMarker = item.type === 'marker';
            const isSample = item.type === 'sample' || item.type === 'material';
            
            return (
              <div 
                key={item.id} 
                className={`absolute group ${isMarker ? 'hover:scale-125' : ''} ${(isAIModalOpen || (isMarker && editingLabelId)) ? 'hidden' : ''}`}
                style={{ 
                  left: item.x, 
                  top: item.y, 
                  width: item.width, 
                  zIndex: isMarker ? 3000 : item.zIndex,
                  pointerEvents: 'auto',
                  cursor: isFinalMode ? 'default' : (isMarker ? 'move' : 'move')
                }}
              >
                <div 
                  onMouseDown={(e) => handleStartAction(e, item.id, 'move')}
                  onTouchStart={(e) => handleStartAction(e, item.id, 'move')}
                  className="relative"
                >
                  {isMarker ? (
                    <div className="w-5 h-5 bg-black border-2 border-white rounded-full shadow-2xl flex items-center justify-center cursor-move transition-transform active:scale-90 ring-4 ring-white/20">
                      <div className="w-1.5 h-1.5 bg-white rounded-full" />
                    </div>
                  ) : (
                    <>
                      <img 
                        src={isDrawing ? item.imageUrl : (mat?.image || item.imageUrl)} 
                        className={`w-full h-auto rounded-2xl shadow-xl cursor-move pointer-events-none select-none transition-all ${isSample ? 'border-4 border-white ring-1 ring-black/5' : ''}`} 
                      />
                      
                      {/* Vertical Side Label for Specs - Repositioned to Right */}
                      {isSample && mat && (
                        <div className="absolute left-[calc(100%+8px)] top-0 flex flex-col items-start min-w-[120px] pointer-events-none">
                          <div className="bg-white/90 backdrop-blur-sm border-l-2 border-black pl-3 py-2 shadow-sm rounded-r-lg">
                            <p className="text-[11px] font-black text-black leading-tight mb-1">
                              {mat.name}
                            </p>
                            <p className="text-[9px] font-bold text-gray-500 leading-tight opacity-80">
                              规格: {mat.specifications || '标准'}
                            </p>
                            <p className="text-[8px] font-bold text-gray-400 mt-1 uppercase tracking-tighter">
                              REF: {mat.id.slice(-6).toUpperCase()}
                            </p>
                          </div>
                        </div>
                      )}

                      <div 
                        className={`absolute -bottom-14 left-1/2 -translate-x-1/2 w-full z-[100]`}
                      >
                        <div 
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!isFinalMode) setEditingLabelId(item.id);
                          }}
                          className={`bg-white/95 backdrop-blur-md border rounded-2xl px-5 py-4 shadow-2xl flex flex-col items-center gap-1.5 group/label transition-all ${editingLabelId === item.id ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-100 hover:border-black'}`}
                        >
                          {editingLabelId === item.id ? (
                            <input 
                              type="text"
                              autoFocus
                              value={item.remark || ''}
                              onBlur={() => setEditingLabelId(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') setEditingLabelId(null);
                              }}
                              onChange={(e) => {
                                updateBoardItems(activeBoard.items.map(i => i.id === item.id ? { ...i, remark: e.target.value } : i));
                              }}
                              className={`w-full bg-transparent text-center outline-none transition-all ${isDrawing ? 'text-[10px] font-black text-gray-400 uppercase tracking-widest' : 'text-[13px] font-black text-black'}`}
                            />
                          ) : (
                            <div className={`w-full text-center select-none cursor-text uppercase whitespace-pre-wrap ${isDrawing ? 'text-[10px] font-black text-gray-400 tracking-widest' : 'text-[13px] font-black text-black tracking-tight'}`}>
                              {item.remark}
                            </div>
                          )}
                          
                          {/* Connection Handle - ONLY MOVE LOGIC HERE */}
                          {!isFinalMode && editingLabelId !== item.id && (
                            <div 
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                const rect = canvasRef.current?.getBoundingClientRect();
                                if (rect) {
                                  setConnectingFromId(item.id);
                                  const clientX = 'touches' in e ? (e as any).touches[0].clientX : (e as any).clientX;
                                  const clientY = 'touches' in e ? (e as any).touches[0].clientY : (e as any).clientY;
                                  setTempPointerPos({
                                    x: clientX - rect.left,
                                    y: clientY - rect.top
                                  });
                                }
                              }}
                              className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-black rounded-full border-2 border-white shadow-lg scale-0 group-hover/label:scale-100 transition-all cursor-crosshair z-[110]" 
                              title="按住并拖动以连接标注点"
                            />
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                
                {/* Controls */}
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur shadow-xl rounded-full px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                  <button onClick={() => changeOrder(item.id, 'up')} className="p-1.5 hover:bg-gray-100 rounded-full text-black">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button onClick={() => changeOrder(item.id, 'down')} className="p-1.5 hover:bg-gray-100 rounded-full text-black">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="w-px h-3 bg-gray-200 mx-1" />
                  {(item.type === 'material' || item.type === 'sample') && (
                    <button 
                      onClick={() => addPointerToItem(item)} 
                      className="p-1.5 hover:bg-black hover:text-white rounded-full text-black transition-all"
                      title="添加空间指向点"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  )}
                  <button 
                    onClick={() => updateBoardItems(activeBoard.items.filter(i => i.id !== item.id))}
                    className="p-1.5 hover:bg-red-50 text-red-500 rounded-full"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {!isMarker && (
                  <div 
                    onMouseDown={(e) => handleStartAction(e, item.id, 'resize')}
                    onTouchStart={(e) => handleStartAction(e, item.id, 'resize')}
                    className="absolute bottom-0 right-0 w-8 h-8 bg-black text-white rounded-tl-2xl rounded-br-lg flex items-center justify-center cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity z-50"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
                  </div>
                )}
              </div>
            );
          })}

          {/* SVG Overlay for Lines (Placed AFTER items) */}
          {!isAIModalOpen && !isPreviewingCapturedImage && !editingLabelId && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-[5000] overflow-visible text-black">
              {activeBoard.items.filter(i => i.type === 'marker' && i.targetId).map(marker => {
                const sample = activeBoard.items.find(s => s.id === marker.targetId);
                if (!sample) return null;
                
                // Precise coordinate calculation for professional lines
                const startX = marker.x + marker.width / 2;
                const startY = marker.y + marker.height / 2;
                
                // End at the label block area (roughly bottom of item + offset)
                const endX = sample.x + sample.width / 2;
                const endY = sample.y + sample.height + 28; // Lower connection to the center of label

                return (
                  <g key={`line-svg-${marker.id}`}>
                    <path 
                      d={`M ${startX} ${startY} C ${startX} ${startY + (endY - startY)/2}, ${endX} ${startY + (endY - startY)/2}, ${endX} ${endY}`}
                      fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" className="opacity-30"
                    />
                    <path 
                      d={`M ${startX} ${startY} C ${startX} ${startY + (endY - startY)/2}, ${endX} ${startY + (endY - startY)/2}, ${endX} ${endY}`}
                      fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="opacity-90"
                    />
                    <circle cx={startX} cy={startY} r="3" fill="currentColor" />
                  </g>
                );
              })}
              {connectingFromId && tempPointerPos && (() => {
                const source = activeBoard.items.find(i => i.id === connectingFromId);
                if (!source) return null;
                const startX = source.x + source.width / 2;
                const startY = source.y + source.height + 25;
                return (
                  <path d={`M ${startX} ${startY} L ${tempPointerPos.x} ${tempPointerPos.y}`} stroke="black" strokeWidth="1.5" strokeDasharray="5 5" fill="none" />
                );
              })()}
            </svg>
          )}

          {/* Export Header Overlay (Baked into the JPG) */}
          {isFinalMode && cropBox && (
            <div 
              className="absolute pointer-events-none z-[6000]"
              style={{
                left: cropBox.x + 35,
                top: cropBox.y + 35
              }}
            >
              <div className="flex flex-col items-start gap-4">
                <div className="bg-black text-white px-8 py-3 tracking-tighter flex items-center justify-center shadow-2xl">
                  <span className="text-[20px] md:text-[28px] font-black whitespace-nowrap">物见 <span className="text-gray-400 font-light mx-2">|</span> MATTER INSIGHT</span>
                </div>
                <div className="bg-white/95 backdrop-blur-sm px-5 py-2 border-l-8 border-black shadow-xl">
                  <p className="text-[14px] md:text-[20px] font-black text-black uppercase tracking-[0.2em]">{activeBoard.name}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CRYSTAL CLEAR SELECTION OVERLAY (OUTSIDE CANVAS) */}
      {isFinalMode && !isPreviewingCapturedImage && (
        <div className="selection-overlay-root fixed inset-0 z-[8000] pointer-events-none overflow-hidden" data-html2canvas-ignore>
          {cropBox && (
            <>
              {/* Blur Screen with Hole */}
              <div 
                className="absolute inset-0 backdrop-blur-md transition-all duration-75 z-[8001]"
                style={{
                  clipPath: (() => {
                    const rect = canvasRef.current!.getBoundingClientRect();
                    const x = cropBox.x - canvasRef.current!.scrollLeft + rect.left;
                    const y = cropBox.y - canvasRef.current!.scrollTop + rect.top;
                    return `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${x}px ${y}px, ${x}px ${y + cropBox.h}px, ${x + cropBox.w}px ${y + cropBox.h}px, ${x + cropBox.w}px ${y}px, ${x}px ${y}px)`;
                  })()
                }}
              />
              {/* Darkness Mask */}
              <div 
                className="absolute transition-all duration-75 z-[8002]"
                style={{
                  left: cropBox.x - canvasRef.current!.scrollLeft + canvasRef.current!.getBoundingClientRect().left,
                  top: cropBox.y - canvasRef.current!.scrollTop + canvasRef.current!.getBoundingClientRect().top,
                  width: cropBox.w,
                  height: cropBox.h,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                }}
              />
            </>
          )}

          {!cropBox && <div className="absolute inset-0 bg-black/50 backdrop-blur-md z-[8001]" />}

          {cropBox && !isPreviewingCapturedImage && (
              <div 
                className={`absolute border-2 border-blue-500 z-[8003] pointer-events-auto overflow-hidden bg-transparent ${isMovingCropBox ? 'cursor-move' : 'cursor-default'}`}
                style={{
                  left: cropBox.x - canvasRef.current!.scrollLeft + canvasRef.current!.getBoundingClientRect().left,
                  top: cropBox.y - canvasRef.current!.scrollTop + canvasRef.current!.getBoundingClientRect().top,
                  width: cropBox.w,
                  height: cropBox.h,
                  boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.2), inset 0 0 0 1px rgba(255,255,255,0.5)',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  // For better UX, a single click confirms if it hasn't just been moved/resized
                  if (!isMovingCropBox && !resizingCropHandle) {
                     handleExportToImage();
                  }
                }}
              >
              {/* Resizing handles - Only show Top-Left or similar if needed? 
                  User said: "Designing cannot pul other corners to adjust area" 
                  So we only provide ONE handle or just let them draw and click.
              */}
              <div className="absolute -bottom-3 -right-3 w-6 h-6 bg-white border-2 border-blue-500 rounded-full shadow-xl cursor-nwse-resize z-10 flex items-center justify-center" onMouseDown={(e) => { e.stopPropagation(); setResizingCropHandle('br'); }}>
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
              </div>
              <div className="absolute -top-12 left-0 bg-blue-600 text-white text-[10px] font-black px-4 py-1.5 rounded-lg flex items-center gap-2 shadow-lg">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                选区已就绪
              </div>
            </div>
          )}

          {!cropBox && !isSelectingCrop && (
            <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[8010]">
              <div className="bg-black/80 text-white px-10 py-6 rounded-3xl backdrop-blur-xl border border-white/10 flex flex-col items-center gap-2">
                <p className="text-lg font-black uppercase tracking-widest font-sans">请划出导出区域</p>
                <p className="text-xs text-gray-400 font-bold opacity-60">拖拽选定一个清晰的视窗</p>
              </div>
            </div>
          )}

          <div className="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/95 backdrop-blur-2xl border border-gray-100 p-2 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.2)] pointer-events-auto z-[9000]">
            <button 
              onClick={() => { setIsFinalMode(false); setCropBox(null); setIsSelectingCrop(false); setCropStart(null); }} 
              className="px-8 py-3 rounded-full text-xs font-bold hover:bg-gray-100 transition-all text-gray-500 hover:text-black" 
              disabled={isExporting}
            >
              放弃导出
            </button>
            <button 
              onClick={handleExportToImage} 
              disabled={!cropBox || isExporting} 
              className={`px-12 py-3 rounded-full text-xs font-black shadow-xl transition-all flex items-center gap-2 active:scale-95 ${!cropBox ? 'bg-gray-100 text-gray-300' : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 hover:shadow-blue-500/40'}`}
            >
              {isExporting && <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
              <span>{isExporting ? '开始生成...' : '预览成图'}</span>
            </button>
          </div>
        </div>
      )}

      {/* AI Floating Button */}
      <button 
        onClick={() => setIsAIModalOpen(true)}
        className="absolute bottom-8 right-8 h-14 bg-black text-white rounded-full shadow-2xl flex items-center gap-3 px-6 group hover:scale-105 transition-all z-[60] border border-white/20"
      >
        <span className="text-xl group-hover:rotate-12 transition-transform">✨</span>
        <span className="text-sm font-black tracking-widest">智能匹配</span>
      </button>

      {/* AI Analysis Modal */}
      {isAIModalOpen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[5000] flex items-center justify-center p-3 md:p-6 overflow-y-auto">
          <div className="bg-white w-full max-w-4xl rounded-[30px] md:rounded-[40px] shadow-2xl relative overflow-hidden flex flex-col md:flex-row min-h-[500px] max-h-[95vh] md:h-[600px]">
            {/* Left Info Panel - Hidden on mobile if analyzing to save space */}
            <div className={`w-full md:w-1/3 bg-gray-50 p-6 md:p-10 flex flex-col justify-between border-r ${analysisStep === 2 ? 'hidden md:flex' : 'flex'}`}>
              <div>
                <div className="text-xs font-black bg-black text-white inline-block px-3 py-1 mb-4 md:mb-6 tracking-tighter">
                  AI INSIGHT
                </div>
                <h3 className="text-2xl md:text-3xl font-black leading-tight mb-4 text-black">
                  智能材质<br className="hidden md:block"/>识别系统
                </h3>
                <p className="text-xs md:text-sm text-gray-400 font-bold leading-relaxed opacity-80 uppercase tracking-tight">
                  上传您的空间效果图，我们的 AI 将深度分析图像中的材质构成，并从您的收藏库中自动匹配最接近的实物材料。
                </p>
              </div>
              
              <div className="space-y-3 mt-6">
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${analysisStep === 1 ? 'bg-black text-white' : 'bg-gray-100 text-gray-400'}`}>1</div>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${analysisStep === 1 ? 'text-black' : 'text-gray-400'}`}>选择效果图</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${analysisStep === 2 ? 'bg-black text-white' : 'bg-gray-100 text-gray-400'}`}>2</div>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${analysisStep === 2 ? 'text-black' : 'text-gray-400'}`}>AI 智能识别</p>
                </div>
              </div>
            </div>

            <div className="flex-1 p-6 md:p-10 flex flex-col relative bg-white">
              <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                 {/* Back button */}
                 <button 
                  onClick={() => {
                    if (analysisStep === 2) setAnalysisStep(1);
                    else setIsAIModalOpen(false);
                  }}
                  className="text-gray-400 hover:text-black transition-colors flex items-center gap-1 font-black text-[10px] uppercase tracking-widest"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  <span>返回</span>
                </button>
                <button 
                  onClick={() => !isAnalyzing && setIsAIModalOpen(false)} 
                  className="text-gray-200 hover:text-red-500 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 flex flex-col justify-center mt-4">
                {visualAnnotations && analysisStep === 2 ? (
                  <div className="flex-1 flex flex-col">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">库内匹配结果</h4>
                    <div className="grid grid-cols-2 gap-3 flex-1 overflow-y-auto px-1 custom-scrollbar pb-4">
                      {visualAnnotations.map((anno, idx) => {
                        const mat = materials.find(m => m.id === anno.matched_material_id);
                        return (
                          <div key={idx} className="p-3 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col gap-2 group hover:border-black transition-all">
                             <div className="w-full aspect-square rounded-xl overflow-hidden bg-white border border-gray-100">
                                {mat ? <img src={mat.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[100px] text-gray-100 font-black">?</div>}
                             </div>
                             <div className="px-1 flex items-center justify-between gap-2 overflow-hidden">
                                <div className="flex-1 min-w-0">
                                   <p className="text-[10px] font-black uppercase truncate text-black">{anno.main_name}</p>
                                   <p className="text-[9px] text-gray-400 font-bold line-clamp-1">{mat?.name || '库外匹配无结果'}</p>
                                </div>
                                {mat && (
                                   <div className="shrink-0 w-4 h-4 bg-black rounded-full flex items-center justify-center text-white">
                                     <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                       <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                     </svg>
                                   </div>
                                )}
                             </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div 
                    className={`relative aspect-square md:aspect-auto md:flex-1 rounded-3xl border-2 border-dashed transition-all flex flex-col items-center justify-center overflow-hidden ${aiImage ? 'border-black' : 'border-gray-200 hover:border-gray-400 bg-gray-50'}`}
                  >
                    {aiImage ? (
                      <>
                        <img src={aiImage} className="w-full h-full object-cover opacity-90 transition-opacity" alt="AI Upload" />
                        {isAnalyzing && (
                          <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center text-white p-8 text-center ring-1 ring-inset ring-white/20">
                            <div className="w-12 h-12 md:w-16 md:h-16 border-4 border-white/20 border-t-white rounded-full animate-spin mb-6 shadow-2xl"></div>
                            <h4 className="text-base md:text-xl font-black mb-2 tracking-tight">AI 正在深度解码空间</h4>
                            <p className="text-[9px] text-gray-400 font-black tracking-[0.3em] uppercase max-w-[200px]">正在重构材质基因与软装逻辑</p>
                          </div>
                        )}
                        {!isAnalyzing && (
                           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] opacity-100 transition-opacity p-6">
                              <button 
                                onClick={handleAIAnalysis}
                                className="bg-white text-black px-10 py-4 rounded-full text-sm font-black shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3"
                              >
                                <span>🚀</span>
                                <span>开始识别材料</span>
                              </button>
                               <button 
                                onClick={() => setAiImage(null)}
                                className="mt-4 text-white/60 hover:text-white text-[10px] font-black uppercase tracking-widest border-b border-white/20 hover:border-white transition-all"
                              >
                                重新选择图片
                              </button>
                           </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 md:w-20 md:h-20 bg-white shadow-xl rounded-full flex items-center justify-center text-3xl mb-4 border border-gray-100 group-hover:scale-110 transition-transform">🖼️</div>
                        <p className="text-sm md:text-base font-black text-black tracking-tight">点击或拖拽上传空间方案</p>
                        <p className="text-[10px] text-gray-400 mt-2 font-black tracking-[0.2em] uppercase opacity-60">SUPPORT JPG, PNG, WEBP</p>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="absolute inset-0 opacity-0 cursor-pointer" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const compressed = await compressImage(file, 1500, 0.8);
                                setAiImage(compressed);
                                setAnalysisStep(1);
                              } catch (err) {
                                console.error('AI image compression error:', err);
                                alert('图片解析故障');
                              }
                            }
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-8 shrink-0">
                {visualAnnotations && analysisStep === 2 ? (
                  <button 
                    onClick={confirmAIMatch}
                    className="w-full py-5 rounded-2xl font-black text-xs md:text-sm uppercase tracking-[0.2em] transition-all bg-black text-white hover:bg-gray-900 shadow-2xl shadow-black/30 active:scale-95"
                  >
                    确认匹配并应用到情绪板
                  </button>
                ) : (
                  <div className="flex gap-4">
                    {aiImage && !isAnalyzing && (
                      <button 
                         onClick={() => setAiImage(null)}
                         className="px-6 py-5 rounded-2xl font-black text-xs md:text-sm uppercase tracking-widest text-red-500 bg-red-50 hover:bg-red-100 transition-all"
                      >
                         取消
                      </button>
                    )}
                    <button 
                      onClick={handleAIAnalysis}
                      disabled={!aiImage || isAnalyzing}
                      className={`flex-1 py-5 rounded-2xl font-black text-xs md:text-sm uppercase tracking-[0.2em] transition-all ${!aiImage || isAnalyzing ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-black text-white hover:bg-gray-900 shadow-2xl shadow-black/30 active:scale-95'}`}
                    >
                      {isAnalyzing ? 'DECODING...' : '开始 AI 专家匹配'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Large Image Preview Modal */}
      {isPreviewingImage && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[300] flex flex-col items-center justify-center p-4 md:p-10">
          <div className="absolute top-8 right-8 flex items-center gap-4">
            <button 
              onClick={handleDownloadHD}
              className="bg-white text-black px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest hover:scale-105 transition-all shadow-2xl"
            >
              下载高清图
            </button>
            <button 
              onClick={() => setIsPreviewingImage(false)}
              className="w-12 h-12 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div 
            id="moodboard-export-container"
            className="w-full max-w-5xl aspect-[297/210] bg-white rounded-sm shadow-2xl relative overflow-hidden p-10 mt-10 md:mt-0"
          >
            <div className="absolute top-6 left-6 md:top-14 md:left-14 flex flex-col items-start gap-4">
              <div className="bg-black text-white px-6 py-2 md:px-10 md:py-3 tracking-tighter flex items-center justify-center">
                <span className="text-sm md:text-2xl font-black whitespace-nowrap">物见 <span className="text-gray-400 font-light mx-2">|</span> MATTER INSIGHT</span>
              </div>
              <div className="bg-white/90 backdrop-blur-sm px-4 py-1 border-l-4 border-black">
                <p className="text-[10px] md:text-base font-black text-black uppercase tracking-[0.2em]">{activeBoard.name}</p>
              </div>
            </div>

            <div className="w-full h-full relative mt-10 md:mt-0">
              {/* Export SVG Lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible text-black">
                {activeBoard.items.filter(i => i.type === 'marker' && i.targetId).map(marker => {
                  const sample = activeBoard.items.find(s => s.id === marker.targetId);
                  if (!sample) return null;
                  
                  const startX = (marker.x + marker.width / 2) / (canvasRef.current?.clientWidth || 1000) * 100;
                  const startY = (marker.y + marker.height / 2) / (canvasRef.current?.clientHeight || 1000) * 100;
                  const endX = (sample.x + sample.width / 2) / (canvasRef.current?.clientWidth || 1000) * 100;
                  const endY = ((sample.y + sample.height + 28) / (canvasRef.current?.clientHeight || 1000)) * 100; 

                  return (
                    <g key={`export-line-${marker.id}`}>
                      <path 
                        d={`M ${startX}% ${startY}% C ${startX}% ${startY + (endY - startY)/2}%, ${endX}% ${startY + (endY - startY)/2}%, ${endX}% ${endY}%`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        style={{ opacity: 0.9 }}
                      />
                    </g>
                  );
                })}
              </svg>

              {activeBoard.items.map(item => {
                const mat = item.materialId ? materials.find(m => m.id === item.materialId) : null;
                const isDrawing = item.type === 'drawing';
                const isMarker = item.type === 'marker';
                const isSample = item.type === 'sample';
                
                return (
                  <div 
                    key={item.id} 
                    className="absolute"
                    style={{ 
                      left: canvasRef.current ? `${(item.x / canvasRef.current.clientWidth) * 100}%` : `${item.x}px`, 
                      top: canvasRef.current ? `${(item.y / canvasRef.current.clientHeight) * 100}%` : `${item.y}px`, 
                      width: canvasRef.current ? `${(item.width / canvasRef.current.clientWidth) * 100}%` : `${item.width}px`,
                      zIndex: item.zIndex 
                    }}
                  >
                    {isMarker ? (
                      <div className="w-1 h-1 bg-black border-[0.5px] border-white rounded-full flex items-center justify-center relative translate-y-[-50%] translate-x-[-50%]">
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 bg-black text-white text-[1.5px] px-0.2 py-0.1 rounded whitespace-nowrap opacity-80">
                          {item.remark}
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <img src={isDrawing ? item.imageUrl : mat?.image} className={`w-full h-auto rounded-lg shadow-2xl ${isSample ? 'border-2 border-white' : ''}`} />
                        {/* Final Export Label */}
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white/90 px-2 py-0.5 rounded text-[3px] font-black text-black shadow-sm uppercase tracking-tighter whitespace-nowrap">
                          {item.remark}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="absolute bottom-6 right-6 md:bottom-10 md:right-10 text-right">
              <p className="text-[6px] md:text-[8px] font-bold text-gray-300 uppercase tracking-[0.2em]">
                material matters / 以材质之名赋予生命<br/>
                material matters not / 以设计之名定义重生
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Result Preview Modal */}
      {isPreviewingCapturedImage && capturedImageData && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4 md:p-12">
          <div className="bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col max-w-7xl w-full max-h-full">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-sm tracking-tight flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                画面预览
              </h3>
              <button 
                onClick={() => setIsPreviewingCapturedImage(false)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4 md:p-8 bg-[#f5f5f7] flex items-center justify-center">
              <img 
                src={capturedImageData} 
                className="max-w-full max-h-[70vh] shadow-[0_30px_60px_rgba(0,0,0,0.1)] border border-white rounded-sm"
                alt="Captured Moodboard"
              />
            </div>
            
            <div className="p-6 border-t bg-white flex items-center justify-center gap-4">
              <button 
                onClick={() => setIsPreviewingCapturedImage(false)}
                className="px-10 py-3 rounded-full text-sm font-bold border border-gray-200 hover:bg-gray-50 transition-all text-gray-500"
              >
                返回调整
              </button>
              <button 
                onClick={handleFinalSave}
                className="px-14 py-3 rounded-full bg-black text-white text-sm font-black shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                确认并保存 JPG
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MoodBoardDesigner;
