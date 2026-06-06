import React, { useState, useRef, useEffect, useCallback } from 'react';
import html2canvas from 'html2canvas';
// 检查下面这一行，确保包含 MoodBoardProps 里面用到的所有类型
import { User, Material, MoodBoard, MoodBoardItem, Category, type LocalTemporaryMaterial } from '../types';
import {
  MATERIAL_ANALYSIS_PROMPT,
  analyzeWithVisionFallback,
  getDeepSeekApiKey,
  getDeepSeekVisionModelName,
  getGeminiApiKey,
  getQwenApiKey,
  parseMaterialAnalysisText,
  type VisionSampleAnchor,
} from '../utils/aiMaterialAnalysis';
import {
  compressImage,
  compressFileToDataUrl,
  compressDataUrl,
  dataUrlByteSize,
  measureDataUrlContainedBox,
  reencodeDataUrlSameDimensions,
  reencodeFileToDataUrl,
  LOCAL_CANVAS_MATERIAL_TARGET_MAX_BYTES,
  MOODBOARD_IMAGE_MAX_WIDTH,
  MOODBOARD_IMAGE_QUALITY,
  AI_MODAL_IMAGE_QUALITY,
} from '../utils/imageCompression';
import {
  createLocalTemporaryMaterial,
  loadLocalDesignerMaterials,
  saveLocalDesignerMaterials,
  upsertLocalDesignerMaterial,
  LOCAL_TEMP_DEFAULT_NAME,
  LOCAL_TEMP_DEFAULT_SPEC,
} from '../utils/localDesignerMaterials';
import { isQuotaExceededError } from "../utils/moodboardStorage";

const DRAG_LOCAL_MATERIAL_MIME = "application/x-matter-local-material-id";

type SidebarMaterialFilter = Category | "ALL" | "LOCAL";

const LOCAL_MATERIAL_NAME_PLACEHOLDER = "未命名本地材料";

function isLocalBoardMaterial(item: MoodBoardItem): boolean {
  return !!(item.isLocalStorageMaterial ?? item.isLocalOnly ?? item.localMaterialId);
}

function buildLocalBoardItemFromEntry(
  entry: LocalTemporaryMaterial,
  boardX: number,
  boardY: number,
  zIndex: number
): MoodBoardItem {
  const displayName = entry.name || LOCAL_TEMP_DEFAULT_NAME;
  const displaySpec = entry.spec || LOCAL_TEMP_DEFAULT_SPEC;
  const imageUrl = entry.imageUrl;
  return {
    id: `local_card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: "material",
    localMaterialId: entry.id,
    isLocalStorageMaterial: true,
    isLocalOnly: true,
    imageUrl,
    x: boardX - 90,
    y: boardY - 90,
    width: 200,
    height: 200,
    zIndex,
    remark: syncCardRemark(displayName, displaySpec),
    isEditedByUser: true,
    displayName,
    displaySpec,
    specEditWarningAcked: true,
  };
}

function applyLocalMaterialEntryToCard(
  item: MoodBoardItem,
  entry: LocalTemporaryMaterial
): MoodBoardItem {
  const displayName = entry.name || LOCAL_TEMP_DEFAULT_NAME;
  const displaySpec = entry.spec || LOCAL_TEMP_DEFAULT_SPEC;
  const imageUrl = entry.imageUrl;
  return {
    id: item.id,
    type: item.type,
    parentId: item.parentId,
    targetId: item.targetId,
    x: item.x,
    y: item.y,
    relX: item.relX,
    relY: item.relY,
    width: item.width,
    height: item.height,
    zIndex: item.zIndex,
    localMaterialId: entry.id,
    isLocalStorageMaterial: true,
    isLocalOnly: true,
    imageUrl,
    materialId: undefined,
    libraryRevisionHash: undefined,
    snapshotImageUrl: undefined,
    displayName,
    displaySpec,
    remark: syncCardRemark(displayName, displaySpec),
    isEditedByUser: true,
    specEditWarningAcked: true,
  };
}

type AIAnnotationPayload = {
  matched_material_id?: string;
  main_name?: string;
  parameter?: string;
  x: number;
  y: number;
  logic?: string;
};

const DRAG_MATERIAL_MIME = 'application/x-matter-material-id';

const CARD_SIZE_MIN = 48;
const CARD_SIZE_MAX = 880;

function parseCardRemark(remark?: string): { name: string; spec: string } {
  const raw = (remark || "").trim();
  if (!raw) return { name: "", spec: "" };
  const i = raw.indexOf("\n");
  if (i < 0) return { name: raw, spec: "" };
  return { name: raw.slice(0, i).trim(), spec: raw.slice(i + 1).trim() };
}

function syncCardRemark(name: string, spec: string): string {
  return `${name}\n${spec || "—"}`;
}

/** 材料库条目变更检测（名称/规格/图/库存/状态） */
function materialRevisionFingerprint(m: Material): string {
  return [m.name, m.specifications, m.image, String(m.stock), m.status].join("\u0001");
}

function stampLinkedMaterialFields(mat: Material): Pick<
  MoodBoardItem,
  "materialId" | "remark" | "libraryRevisionHash" | "isEditedByUser"
> {
  return {
    materialId: mat.id,
    remark: syncCardRemark(mat.name, mat.specifications || "标准"),
    libraryRevisionHash: materialRevisionFingerprint(mat),
    isEditedByUser: false,
  };
}

/** 将库材料写回已有卡片并清除用户编辑/本地快照字段（避免 spread undefined 无法删掉旧键） */
function applyLibraryMaterialToCard(item: MoodBoardItem, mat: Material): MoodBoardItem {
  const stamped = stampLinkedMaterialFields(mat);
  const next: MoodBoardItem = {
    id: item.id,
    type: item.type,
    parentId: item.parentId,
    targetId: item.targetId,
    x: item.x,
    y: item.y,
    relX: item.relX,
    relY: item.relY,
    width: item.width,
    height: item.height,
    zIndex: item.zIndex,
    ...stamped,
  };
  return next;
}

function isMaterialCardType(item: MoodBoardItem): boolean {
  return item.type === "sample" || item.type === "material" || (!item.type && !item.parentId);
}

function getCardDisplay(
  item: MoodBoardItem,
  mat: Material | null | undefined,
  localEntry?: LocalTemporaryMaterial | null
): { name: string; spec: string; imageUrl: string | undefined; showUpdateDot: boolean } {
  const parsed = parseCardRemark(item.remark);
  const edited = !!item.isEditedByUser;

  const name = isLocalBoardMaterial(item)
    ? item.displayName ?? parsed.name ?? ""
    : edited
      ? (item.displayName ?? parsed.name) || "未命名"
      : (mat?.name ?? parsed.name ?? item.displayName) || "待匹配材质";

  const spec = edited
    ? (item.displaySpec ?? parsed.spec) || "—"
    : (mat?.specifications ?? parsed.spec) || "标准";

  const imageUrl = isLocalBoardMaterial(item)
    ? item.imageUrl ?? item.snapshotImageUrl ?? localEntry?.imageUrl
    : edited
      ? item.snapshotImageUrl ?? item.imageUrl ?? mat?.image
      : mat?.image ?? item.imageUrl;

  const showUpdateDot =
    !edited &&
    !isLocalBoardMaterial(item) &&
    !!mat &&
    !!item.materialId &&
    !!item.libraryRevisionHash &&
    materialRevisionFingerprint(mat) !== item.libraryRevisionHash;

  return { name, spec, imageUrl, showUpdateDot };
}

/** 画布逻辑坐标系（与内层 scale 配套）；外层滚动尺寸为 base × zoom */
const MOODBOARD_CONTENT_W = 2000;
const MOODBOARD_CONTENT_H = 1400;
const MOODBOARD_ZOOM_MIN = 0.5;
const MOODBOARD_ZOOM_MAX = 3;

/** 将裁切矩形限制在逻辑画布内，避免 html2canvas 截到画布外空白 */
function clampCropRectToBoard(r: { x: number; y: number; w: number; h: number }) {
  const x0 = Math.max(0, Math.min(MOODBOARD_CONTENT_W, r.x));
  const y0 = Math.max(0, Math.min(MOODBOARD_CONTENT_H, r.y));
  const x1 = Math.max(0, Math.min(MOODBOARD_CONTENT_W, r.x + r.w));
  const y1 = Math.max(0, Math.min(MOODBOARD_CONTENT_H, r.y + r.h));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** 同一区域 / 同名过近的 AI 标注合并，避免叠两个标签 */
function dedupeAIAnnotations(items: AIAnnotationPayload[], spaceDist = 7): AIAnnotationPayload[] {
  const out: AIAnnotationPayload[] = [];
  for (const a of items) {
    const dup = out.some((b) => {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const nameA = (a.main_name || '').trim();
      const nameB = (b.main_name || '').trim();
      const sameName = nameA.length > 0 && nameA === nameB;
      return d < spaceDist || (sameName && d < 18);
    });
    if (!dup) out.push(a);
  }
  return out;
}

/** AI 弹窗预览图（object-contain）点击 → 原图百分比坐标，供千问 RGB 前置采样（与画布 canvasZoom 无关，仅相对上传图自然像素） */
function previewImageClickToVisionAnchor(e: React.MouseEvent<HTMLImageElement>): VisionSampleAnchor {
  const el = e.currentTarget;
  const nw = el.naturalWidth;
  const nh = el.naturalHeight;
  if (nw < 1 || nh < 1) {
    return { xPercent: 50, yPercent: 50, source: "user" };
  }
  const cw = el.clientWidth;
  const ch = el.clientHeight;
  const scale = Math.min(cw / nw, ch / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  const rect = el.getBoundingClientRect();
  const ne = e.nativeEvent;
  const lx =
    typeof ne.offsetX === "number" && !Number.isNaN(ne.offsetX)
      ? ne.offsetX
      : e.clientX - rect.left;
  const ly =
    typeof ne.offsetY === "number" && !Number.isNaN(ne.offsetY)
      ? ne.offsetY
      : e.clientY - rect.top;
  let nx = (lx - ox) / scale;
  let ny = (ly - oy) / scale;
  nx = Math.max(0, Math.min(nw - 1, nx));
  ny = Math.max(0, Math.min(nh - 1, ny));
  return { xPercent: (nx / nw) * 100, yPercent: (ny / nh) * 100, source: "user" };
}

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
  /** 与其他页面一致的存入情绪板（探索页收藏菜单同款逻辑） */
  onSaveMaterial?: (matId: string, moodboardId?: string, newMoodboardName?: string) => void;
  /** 取消收藏（仅从收藏列表移除，可配合画布移除卡片自行处理） */
  onUnsaveMaterial?: (matId: string) => void;
}

const MoodBoardDesigner: React.FC<MoodBoardProps> = ({ 
  user, points, materials, savedIds, moodboards, setMoodboards, 
  activeMoodboardId, setActiveMoodboardId, onDeductPoints,
  onSaveMaterial,
  onUnsaveMaterial,
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
  const [analysisStep, setAnalysisStep] = useState<1 | 2 | 3>(1); // 1 上传 2 识别中 3 已写入画布
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiImage, setAiImage] = useState<string | null>(null);
  /** 未点击预览图时为 null，千问 RGB 前置用几何中心；点击后映射到原图百分比 */
  const [aiVisionAnchor, setAiVisionAnchor] = useState<VisionSampleAnchor | null>(null);
  const [isPreviewingImage, setIsPreviewingImage] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<SidebarMaterialFilter>("ALL");
  const [localMaterialsList, setLocalMaterialsList] = useState<LocalTemporaryMaterial[]>(
    () => loadLocalDesignerMaterials(user.id)
  );
  const [matchResults, setMatchResults] = useState<{ material: Material; remark: string; coords: {x: number, y: number}, logic: string }[] | null>(null);
  const [visualAnnotations, setVisualAnnotations] = useState<any[] | null>(null);
  const [aiRecommendations, setAiRecommendations] = useState<Material[]>([]);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);
  const [specEditModalItemId, setSpecEditModalItemId] = useState<string | null>(null);
  const storageQuotaAlertShownRef = useRef(false);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    clientX: number;
    clientY: number;
    boardX: number;
    boardY: number;
  } | null>(null);
  const [aiUploadHint, setAiUploadHint] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasLocalUploadRef = useRef<HTMLInputElement>(null);
  const sidebarLocalUploadRef = useRef<HTMLInputElement>(null);

  const [canvasZoom, setCanvasZoom] = useState(1);
  const canvasZoomRef = useRef(1);
  useEffect(() => {
    canvasZoomRef.current = canvasZoom;
  }, [canvasZoom]);

  const zoomCanvas = useCallback((factor: number) => {
    setCanvasZoom((z) => {
      const n = Math.min(MOODBOARD_ZOOM_MAX, Math.max(MOODBOARD_ZOOM_MIN, z * factor));
      return Math.round(n * 10000) / 10000;
    });
  }, []);

  const spaceDownRef = useRef(false);
  const middleDownRef = useRef(false);
  const [canvasPanArmed, setCanvasPanArmed] = useState(false);
  const [isCanvasPanDragging, setIsCanvasPanDragging] = useState(false);
  const canvasPanSessionRef = useRef<{
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  const panArmed = () => spaceDownRef.current || middleDownRef.current;

  const clientToBoard = useCallback((clientX: number, clientY: number) => {
    const host = canvasRef.current;
    if (!host) return { x: 0, y: 0 };
    const scaleEl = host.querySelector("[data-moodboard-scale]") as HTMLElement | null;
    if (scaleEl) {
      const r = scaleEl.getBoundingClientRect();
      const rw = Math.max(1e-6, r.width);
      const rh = Math.max(1e-6, r.height);
      return {
        x: ((clientX - r.left) / rw) * MOODBOARD_CONTENT_W,
        y: ((clientY - r.top) / rh) * MOODBOARD_CONTENT_H,
      };
    }
    const z = canvasZoomRef.current || 1;
    const rect = host.getBoundingClientRect();
    return {
      x: (clientX - rect.left + host.scrollLeft) / z,
      y: (clientY - rect.top + host.scrollTop) / z,
    };
  }, []);

  /** 逻辑裁切框 → 视口像素（与 clientToBoard 一致，用于导出蒙层与蓝框） */
  const cropBoxToScreenRect = useCallback(
    (cb: { x: number; y: number; w: number; h: number }) => {
      const host = canvasRef.current;
      const scaleEl = host?.querySelector("[data-moodboard-scale]") as HTMLElement | null;
      if (!host || !scaleEl) return null;
      const sr = scaleEl.getBoundingClientRect();
      const sx = sr.width / MOODBOARD_CONTENT_W;
      const sy = sr.height / MOODBOARD_CONTENT_H;
      return {
        left: sr.left + cb.x * sx,
        top: sr.top + cb.y * sy,
        width: cb.w * sx,
        height: cb.h * sy,
      };
    },
    []
  );

  const [exportOverlayTick, setExportOverlayTick] = useState(0);
  useEffect(() => {
    if (!isFinalMode || !canvasRef.current) return;
    const el = canvasRef.current;
    const bump = () => setExportOverlayTick((t) => t + 1);
    el.addEventListener("scroll", bump, { passive: true });
    window.addEventListener("resize", bump);
    bump();
    return () => {
      el.removeEventListener("scroll", bump);
      window.removeEventListener("resize", bump);
    };
  }, [isFinalMode, canvasZoom, cropBox]);

  /** 框选拖出视口时仍用 document 更新 cropBox（逻辑坐标 + 夹紧画布） */
  useEffect(() => {
    if (!isFinalMode || !isSelectingCrop || !cropStart) return;
    const start = cropStart;
    const onMove = (ev: MouseEvent | TouchEvent) => {
      const cx = "touches" in ev ? ev.touches[0]!.clientX : (ev as MouseEvent).clientX;
      const cy = "touches" in ev ? ev.touches[0]!.clientY : (ev as MouseEvent).clientY;
      const p = clientToBoard(cx, cy);
      setCropBox(
        clampCropRectToBoard({
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          w: Math.abs(p.x - start.x),
          h: Math.abs(p.y - start.y),
        })
      );
    };
    const onUp = () => {
      setIsSelectingCrop(false);
      setCropStart(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove as EventListener);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove as EventListener, { passive: false });
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove as EventListener);
      document.removeEventListener("touchend", onUp);
    };
  }, [isFinalMode, isSelectingCrop, cropStart, clientToBoard]);

  useEffect(() => {
    const onBlur = () => {
      spaceDownRef.current = false;
      middleDownRef.current = false;
      setCanvasPanArmed(false);
      if (canvasPanSessionRef.current) {
        canvasPanSessionRef.current = null;
        setIsCanvasPanDragging(false);
      }
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space' || ev.repeat) return;
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (isAIModalOpen || isExporting || isFinalMode) return;
      ev.preventDefault();
      spaceDownRef.current = true;
      setCanvasPanArmed(true);
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return;
      spaceDownRef.current = false;
      setCanvasPanArmed(middleDownRef.current);
      if (canvasPanSessionRef.current) {
        canvasPanSessionRef.current = null;
        setIsCanvasPanDragging(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [isAIModalOpen, isExporting, isFinalMode]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (ev.button !== 1) return;
      if (isAIModalOpen || isExporting) return;
      ev.preventDefault();
      middleDownRef.current = true;
      setCanvasPanArmed(true);
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button !== 1) return;
      middleDownRef.current = false;
      setCanvasPanArmed(spaceDownRef.current);
      if (canvasPanSessionRef.current) {
        canvasPanSessionRef.current = null;
        setIsCanvasPanDragging(false);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
    };
  }, [isAIModalOpen, isExporting]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      if (isFinalMode || isAIModalOpen || isExporting || isPreviewingCapturedImage || isPreviewingImage) return;
      ev.preventDefault();
      const dir = ev.deltaY < 0 ? 1.1 : 0.9;
      zoomCanvas(dir);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isFinalMode, isAIModalOpen, isExporting, isPreviewingCapturedImage, isPreviewingImage, zoomCanvas]);

  const activeBoard = moodboards.find(b => b.id === activeMoodboardId) || moodboards[0];

  /** 为旧数据补全 libraryRevisionHash，避免无基线时误报红点 */
  useEffect(() => {
    setMoodboards((prev) => {
      const board = prev.find((b) => b.id === activeMoodboardId);
      if (!board) return prev;
      let changed = false;
      const nextItems = board.items.map((item) => {
        if (
          item.materialId &&
          !item.isEditedByUser &&
          !isLocalBoardMaterial(item) &&
          !item.libraryRevisionHash
        ) {
          const mat = materials.find((m) => m.id === item.materialId);
          if (mat) {
            changed = true;
            return { ...item, libraryRevisionHash: materialRevisionFingerprint(mat) };
          }
        }
        return item;
      });
      if (!changed) return prev;
      return prev.map((b) => (b.id === board.id ? { ...b, items: nextItems } : b));
    });
  }, [activeMoodboardId, materials, setMoodboards]);

  useEffect(() => {
    if (!canvasContextMenu) return;
    const close = () => setCanvasContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [canvasContextMenu]);

  useEffect(() => {
    setLocalMaterialsList(loadLocalDesignerMaterials(user.id));
  }, [user.id]);

  useEffect(() => {
    if (!user.id) return;
    try {
      saveLocalDesignerMaterials(user.id, localMaterialsList);
    } catch (e) {
      if (isQuotaExceededError(e)) showStorageQuotaAlertOnce();
    }
  }, [localMaterialsList, user.id]);

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
  /** 从收藏库添加材质卡片（与侧栏 + 号、拖入空白处共用） */
  const addMaterialCardToBoard = (
    materialId: string,
    boardPos?: { x: number; y: number }
  ): boolean => {
    const material = materials.find((m) => m.id === materialId);
    if (!material) return false;

    let added = false;
    setMoodboards((prev) => {
      const board = prev.find((b) => b.id === activeMoodboardId) ?? prev[0];
      if (!board) return prev;

      const materialCount = board.items.filter((i) => isMaterialCardType(i)).length;
      if (materialCount >= board.maxMaterials) {
        alert(`当前情绪板材质卡片已达上限 (${board.maxMaterials}款)`);
        return prev;
      }

      if (
        board.items.some((i) => i.materialId === materialId && isMaterialCardType(i))
      ) {
        alert("该材料已在当前情绪板中");
        return prev;
      }

      const maxZ = Math.max(...board.items.map((x) => x.zIndex), 0);
      const defaultX = MOODBOARD_CONTENT_W / 2 - 100 + (Math.random() - 0.5) * 40;
      const defaultY = 150 + Math.random() * 50;
      const newItem: MoodBoardItem = {
        id: Math.random().toString(36).slice(2, 11),
        type: "material",
        x: boardPos ? boardPos.x - 100 : defaultX,
        y: boardPos ? boardPos.y - 100 : defaultY,
        width: 200,
        height: 200,
        zIndex: maxZ + 1,
        ...stampLinkedMaterialFields(material),
      };

      added = true;
      return prev.map((b) =>
        b.id === board.id ? { ...b, items: [...b.items, newItem] } : b
      );
    });
    return added;
  };

  const handleAddItem = (materialId: string) => {
    addMaterialCardToBoard(materialId);
  };

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

  const handleDeleteBoard = (e: React.MouseEvent, mbId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (moodboards.length <= 1) {
      alert("至少保留一个情绪板");
      return;
    }
    if (!confirm("确定删除该情绪板？其中的卡片内容将一并删除，且不可恢复。")) return;

    const next = moodboards.filter(b => b.id !== mbId);
    setMoodboards(next);
    if (activeMoodboardId === mbId) {
      setActiveMoodboardId(next[0]?.id ?? "");
    }
  };

  const addItem = (mat: Material) => {
    const board = moodboards.find(b => b.id === activeMoodboardId) ?? moodboards[0];
    if (!board) return;
    const materialCount = board.items.filter(
      i => i.type === "material" || i.type === "sample"
    ).length;
    if (materialCount >= board.maxMaterials) {
      return alert(`当前情绪板材质卡片已达上限 (${board.maxMaterials}款)`);
    }
    if (
      board.items.some(
        i =>
          i.materialId === mat.id &&
          (i.type === "material" || i.type === "sample" || !i.type)
      )
    ) {
      return alert("该材料已在当前情绪板中");
    }
    handleAddItem(mat.id);
  };

  const updateBoardItems = (items: MoodBoardItem[]) => {
    if (!activeBoard) return;
    setMoodboards(prev => prev.map(b => b.id === activeBoard.id ? { ...b, items } : b));
  };

  const assignMaterialToSample = (sampleId: string, materialId: string) => {
    const mat = materials.find((m) => m.id === materialId);
    if (!mat) return;
    setMoodboards((prev) =>
      prev.map((b) => {
        if (b.id !== activeMoodboardId) return b;
        return {
          ...b,
          items: b.items.map((i) =>
            i.id === sampleId && isMaterialCardType(i)
              ? applyLibraryMaterialToCard(i, mat)
              : i
          ),
        };
      })
    );
  };

  const readDraggedLocalMaterialId = (e: React.DragEvent): string | null => {
    const id = e.dataTransfer.getData(DRAG_LOCAL_MATERIAL_MIME);
    const trimmed = id?.trim();
    return trimmed || null;
  };

  const readDraggedLibraryMaterialId = (e: React.DragEvent): string | null => {
    const id =
      e.dataTransfer.getData(DRAG_MATERIAL_MIME) ||
      e.dataTransfer.getData("text/plain");
    const trimmed = id?.trim();
    if (!trimmed || trimmed.startsWith("lmat_")) return null;
    return trimmed;
  };

  const findMaterialCardIdAtPoint = (clientX: number, clientY: number): string | null => {
    const hits = document.elementsFromPoint(clientX, clientY);
    for (const el of hits) {
      const card = (el as HTMLElement).closest?.("[data-moodboard-card-id]");
      if (card) {
        const id = card.getAttribute("data-moodboard-card-id");
        if (id) return id;
      }
    }
    return null;
  };

  const handleLibraryMaterialDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types || []);
    if (
      !types.includes(DRAG_MATERIAL_MIME) &&
      !types.includes(DRAG_LOCAL_MATERIAL_MIME) &&
      !types.includes("text/plain")
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const applyLocalMaterialToSample = (sampleId: string, localMaterialId: string) => {
    const entry = localMaterialsList.find((x) => x.id === localMaterialId);
    if (!entry) return;
    setMoodboards((prev) =>
      prev.map((b) => {
        if (b.id !== activeMoodboardId) return b;
        return {
          ...b,
          items: b.items.map((i) =>
            i.id === sampleId && isMaterialCardType(i)
              ? applyLocalMaterialEntryToCard(i, entry)
              : i
          ),
        };
      })
    );
  };

  const handleLibraryMaterialDrop = (e: React.DragEvent) => {
    if (isFinalMode || isExporting) return;
    e.preventDefault();
    e.stopPropagation();

    const localId = readDraggedLocalMaterialId(e);
    const libraryId = readDraggedLibraryMaterialId(e);
    const cardId = findMaterialCardIdAtPoint(e.clientX, e.clientY);

    if (localId) {
      if (cardId) {
        const target = activeBoard.items.find((i) => i.id === cardId);
        if (target && isMaterialCardType(target)) {
          applyLocalMaterialToSample(cardId, localId);
          return;
        }
      }
      const p = clientToBoard(e.clientX, e.clientY);
      addLocalMaterialCardFromCatalog(localId, p);
      return;
    }

    if (!libraryId) return;

    if (cardId) {
      const target = activeBoard.items.find((i) => i.id === cardId);
      if (target && isMaterialCardType(target)) {
        assignMaterialToSample(cardId, libraryId);
        return;
      }
    }

    const p = clientToBoard(e.clientX, e.clientY);
    addMaterialCardToBoard(libraryId, p);
  };

  /** 删除标注点（连线由 marker.targetId 绘制，删点即删线） */
  const removeMarkerOnly = (markerId: string) => {
    setMoodboards((prev) =>
      prev.map((b) => {
        if (b.id !== activeMoodboardId) return b;
        return {
          ...b,
          items: b.items.filter((i) => i.id !== markerId),
        };
      })
    );
  };

  /** 删除画布节点并移除指向该节点的引线锚点 */
  const removeBoardItemCascade = (targetId: string) => {
    if (!activeBoard) return;
    const nextItems = activeBoard.items.filter((i) => {
      if (i.id === targetId) return false;
      if (i.type === "marker" && i.targetId === targetId) return false;
      return true;
    });
    updateBoardItems(nextItems);
  };

  const patchBoardItem = (itemId: string, patch: Partial<MoodBoardItem>) => {
    setMoodboards((prev) =>
      prev.map((b) => {
        if (b.id !== activeMoodboardId) return b;
        return {
          ...b,
          items: b.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
        };
      })
    );
  };

  const applyLibraryRefreshToCard = (itemId: string) => {
    setMoodboards((prev) =>
      prev.map((b) => {
        if (b.id !== activeMoodboardId) return b;
        const item = b.items.find((i) => i.id === itemId);
        if (!item?.materialId || item.isEditedByUser) return b;
        const mat = materials.find((m) => m.id === item.materialId);
        if (!mat) return b;
        return {
          ...b,
          items: b.items.map((i) =>
            i.id === itemId ? applyLibraryMaterialToCard(i, mat) : i
          ),
        };
      })
    );
  };

  const showStorageQuotaAlertOnce = () => {
    if (storageQuotaAlertShownRef.current) return;
    storageQuotaAlertShownRef.current = true;
    window.alert(
      "本地存储空间已满，无法保存新图片。请删除部分情绪板或过大的效果图后重试。此提示仅显示一次。"
    );
  };

  const syncLocalCatalogFromCard = (localMaterialId: string, name: string, spec: string) => {
    setLocalMaterialsList((prev) => {
      const existing = prev.find((x) => x.id === localMaterialId);
      if (!existing) return prev;
      const next = upsertLocalDesignerMaterial(user.id, prev, {
        ...existing,
        name: name || LOCAL_TEMP_DEFAULT_NAME,
        spec: spec || LOCAL_TEMP_DEFAULT_SPEC,
      });
      try {
        saveLocalDesignerMaterials(user.id, next);
      } catch (e) {
        if (isQuotaExceededError(e)) showStorageQuotaAlertOnce();
      }
      return next;
    });
  };

  /** 压缩并生成统一的 LocalTemporaryMaterial */
  const buildLocalTemporaryFromFile = async (
    file: File
  ): Promise<LocalTemporaryMaterial | null> => {
    const compressedBase64 = await compressImage(file);
    if (!compressedBase64.startsWith("data:image/jpeg")) {
      throw new Error("INVALID_COMPRESSED_FORMAT");
    }
    if (dataUrlByteSize(compressedBase64) > LOCAL_CANVAS_MATERIAL_TARGET_MAX_BYTES * 1.2) {
      throw new Error("IMAGE_TOO_LARGE_AFTER_COMPRESS");
    }
    return createLocalTemporaryMaterial(user.id, compressedBase64);
  };

  /** 仅写入左侧「本地材料」列表（localStorage + React state） */
  const commitLocalMaterialToCatalog = (entry: LocalTemporaryMaterial): boolean => {
    let saved = false;
    setLocalMaterialsList((prev) => {
      const next = [...prev, entry];
      try {
        saveLocalDesignerMaterials(user.id, next);
        saved = true;
        return next;
      } catch (e) {
        if (isQuotaExceededError(e)) showStorageQuotaAlertOnce();
        return prev;
      }
    });
    return saved;
  };

  const placeLocalMaterialOnBoard = (
    entry: LocalTemporaryMaterial,
    boardX: number,
    boardY: number
  ) => {
    setMoodboards((prev) => {
      const board = prev.find((b) => b.id === activeMoodboardId) ?? prev[0];
      if (!board) return prev;
      const materialCount = board.items.filter((i) => isMaterialCardType(i)).length;
      if (materialCount >= board.maxMaterials) {
        alert(`当前情绪板材质卡片已达上限 (${board.maxMaterials}款)`);
        return prev;
      }
      const maxZ = Math.max(...board.items.map((x) => x.zIndex), 0);
      const newItem = buildLocalBoardItemFromEntry(entry, boardX, boardY, maxZ + 1);
      return prev.map((b) =>
        b.id === board.id ? { ...b, items: [...b.items, newItem] } : b
      );
    });
  };

  /** 左侧上传：只入库，不直接上画布 */
  const registerLocalMaterialFromSidebar = async (file: File) => {
    try {
      const entry = await buildLocalTemporaryFromFile(file);
      if (!entry?.imageUrl) return;
      if (!commitLocalMaterialToCatalog(entry)) return;
      setSelectedCategory("LOCAL");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("QuotaExceeded") || msg.includes("IMAGE_TOO_LARGE")) {
        showStorageQuotaAlertOnce();
      } else {
        alert("图片处理失败，请换一张较小的图片重试。");
      }
    }
  };

  const addLocalMaterialCardFromCatalog = (
    localMaterialId: string,
    boardPos?: { x: number; y: number }
  ) => {
    const entry = localMaterialsList.find((x) => x.id === localMaterialId);
    if (!entry?.imageUrl) return;
    const px = boardPos?.x ?? MOODBOARD_CONTENT_W / 2;
    const py = boardPos?.y ?? 200;
    placeLocalMaterialOnBoard(entry, px, py);
  };

  /** 画布右键：入库 + 在点击位置生成卡片 */
  const insertLocalCanvasMaterial = async (file: File, boardX: number, boardY: number) => {
    try {
      const entry = await buildLocalTemporaryFromFile(file);
      if (!entry?.imageUrl) return;
      if (!commitLocalMaterialToCatalog(entry)) return;
      setSelectedCategory("LOCAL");
      placeLocalMaterialOnBoard(entry, boardX, boardY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("QuotaExceeded") || msg.includes("IMAGE_TOO_LARGE")) {
        showStorageQuotaAlertOnce();
      } else {
        alert("图片处理失败，请换一张较小的图片重试。");
      }
    }
  };

  const handleStartAction = (e: React.MouseEvent | React.TouchEvent, id: string, type: 'move' | 'resize') => {
    if (isFinalMode) return;
    if (panArmed()) return;
    const item = activeBoard.items.find(i => i.id === id);
    if (!item || !canvasRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    if (type === 'resize') {
      setResizingItem({ id, startWidth: item.width, startHeight: item.height, startX: clientX, startY: clientY });
    } else {
      const el = canvasRef.current;
      const pb = clientToBoard(clientX, clientY);
      const contentX = pb.x;
      const contentY = pb.y;
      setDraggingItem({ id, offsetX: contentX - item.x, offsetY: contentY - item.y });
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

    const p = clientToBoard(clientX, clientY);
    const curX = p.x;
    const curY = p.y;

    if (isFinalMode && isMovingCropBox && cropBox && movingCropOffset && canvasRef.current) {
      setCropBox(
        clampCropRectToBoard({
          ...cropBox,
          x: curX - movingCropOffset.x,
          y: curY - movingCropOffset.y,
        })
      );
      return;
    }

    if (isFinalMode && resizingCropHandle && cropBox && canvasRef.current) {
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

      setCropBox(clampCropRectToBoard(newBox));
      return;
    }

    if (connectingFromId && canvasRef.current) {
      setTempPointerPos({
        x: curX,
        y: curY,
      });
      return;
    }

    if (resizingItem) {
      const deltaX = clientX - resizingItem.startX;
      const deltaY = clientY - resizingItem.startY;
      const resizedItem = activeBoard.items.find((i) => i.id === resizingItem.id);
      const isCard =
        resizedItem?.type === "sample" ||
        resizedItem?.type === "material" ||
        (!resizedItem?.type && !resizedItem?.parentId);
      let newWidth = Math.max(
        CARD_SIZE_MIN,
        Math.min(CARD_SIZE_MAX, resizingItem.startWidth + deltaX)
      );
      let newHeight: number;
      if (isCard) {
        newHeight = Math.max(
          CARD_SIZE_MIN,
          Math.min(CARD_SIZE_MAX, resizingItem.startHeight + deltaY)
        );
      } else {
        const scale = newWidth / resizingItem.startWidth;
        newHeight = Math.max(
          CARD_SIZE_MIN,
          Math.min(CARD_SIZE_MAX, resizingItem.startHeight * scale)
        );
      }

      updateBoardItems(activeBoard.items.map((i: any) => {
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
      const contentX = curX;
      const contentY = curY;
      const newX = contentX - draggingItem.offsetX;
      const newY = contentY - draggingItem.offsetY;
      
      const draggedItem = activeBoard.items.find(i => i.id === draggingItem.id);
      
      updateBoardItems(activeBoard.items.map((i: any) => {
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
    if (canvasPanSessionRef.current) {
      canvasPanSessionRef.current = null;
      setIsCanvasPanDragging(false);
    }
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
    const headers = ['材料名称', '品牌', '规格', '分类', '价格区间'];
    const rows = activeBoard.items
      .filter((item) => item.type === 'material' || item.type === 'sample' || (!item.type && !item.parentId))
      .map((item) => {
        const mat = item.materialId ? materials.find((m) => m.id === item.materialId) : undefined;
        const { name, spec } = getCardDisplay(item, mat);
        return [
          name,
          isLocalBoardMaterial(item) ? '—' : mat?.brand || '',
          spec,
          isLocalBoardMaterial(item) ? '本地临时' : mat?.category || '',
          isLocalBoardMaterial(item) ? '—' : mat?.priceRange || '',
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
      if (rect && canvasRef.current) {
        const z = canvasZoomRef.current || 1;
        setCropBox(
          clampCropRectToBoard({
            x: (canvasRef.current.scrollLeft + rect.width * 0.1) / z,
            y: (canvasRef.current.scrollTop + rect.height * 0.2) / z,
            w: (rect.width * 0.8) / z,
            h: (rect.height * 0.5) / z,
          })
        );
      }
    }
  };

  const handleExportToImage = async () => {
    if (!cropBox || !canvasRef.current || isExporting) return;

    const host = canvasRef.current;
    const capturedCrop = { ...cropBox };
    setIsExporting(true);

    const overlay = document.querySelector(".selection-overlay-root") as HTMLElement | null;
    if (overlay) overlay.style.display = "none";

    const originalOpacity = host.style.opacity;

    /** 大图导出：逻辑坐标 + scale(1) 克隆根节点，避免 scroll/zoom 与视口混算导致黑边偏移 */
    const generateLargeImage = async (): Promise<void> => {
      const clamped = clampCropRectToBoard(capturedCrop);
      const scaleRoot = host.querySelector("[data-moodboard-scale]") as HTMLElement | null;

      let canvas: HTMLCanvasElement;

      if (scaleRoot) {
        let clone: HTMLElement | null = null;
        try {
          clone = scaleRoot.cloneNode(true) as HTMLElement;
          clone.style.position = "fixed";
          clone.style.left = "-20000px";
          clone.style.top = "0";
          clone.style.transform = "none";
          clone.style.transformOrigin = "0 0";
          clone.style.width = `${MOODBOARD_CONTENT_W}px`;
          clone.style.height = `${MOODBOARD_CONTENT_H}px`;
          clone.style.margin = "0";
          clone.style.pointerEvents = "none";
          document.body.appendChild(clone);

          await Promise.all(
            Array.from(clone.querySelectorAll("img")).map(
              (img) =>
                new Promise<void>((resolve) => {
                  if (img.complete) resolve();
                  else {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                  }
                })
            )
          );
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r()))
          );

          canvas = await html2canvas(clone, {
            x: clamped.x,
            y: clamped.y,
            width: clamped.w,
            height: clamped.h,
            useCORS: true,
            scale: 3,
            backgroundColor: "#ffffff",
            logging: false,
          });
        } finally {
          if (clone?.parentNode) clone.parentNode.removeChild(clone);
        }
      } else {
        const z = canvasZoomRef.current || 1;
        const sl = host.scrollLeft;
        const st = host.scrollTop;
        canvas = await html2canvas(host, {
          x: clamped.x * z - sl,
          y: clamped.y * z - st,
          width: clamped.w * z,
          height: clamped.h * z,
          useCORS: true,
          scale: 3,
          backgroundColor: "#ffffff",
          logging: false,
          scrollX: 0,
          scrollY: 0,
        });
      }

      const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
      setCapturedImageData(dataUrl);
      setIsPreviewingCapturedImage(true);
    };

    try {
      host.style.opacity = "1";
      await generateLargeImage();
    } catch (error) {
      console.error("Export error:", error);
      alert("生成预览失败，请尝试刷新页面。");
    } finally {
      host.style.opacity = originalOpacity;
      if (overlay) overlay.style.display = "";
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

  const resolveMaterialFromAnnotation = (item: {
    matched_material_id?: string;
    main_name?: string;
    parameter?: string;
  }): Material | undefined => {
    const main = (item.main_name || "").trim();
    const mainLower = main.toLowerCase();
    if (mainLower) {
      for (const m of savedMaterials) {
        const nl = (m.name || "").trim().toLowerCase();
        if (!nl) continue;
        if (nl === mainLower || nl.includes(mainLower) || mainLower.includes(nl)) {
          return m;
        }
      }
    }
    if (item.matched_material_id) {
      const byId = materials.find((m) => m.id === item.matched_material_id);
      if (byId) return byId;
    }
    const q = `${item.main_name || ""} ${item.parameter || ""}`.trim().toLowerCase();
    if (!q) return undefined;
    const pool = savedMaterials.length ? savedMaterials : materials;
    let best: Material | undefined;
    for (const m of pool) {
      const name = m.name.toLowerCase();
      const spec = (m.specifications || "").toLowerCase();
      if (name.includes(q) || q.includes(name) || (spec && q.includes(spec))) {
        best = m;
        break;
      }
      if (item.main_name && name.includes(item.main_name.toLowerCase())) {
        best = m;
      }
    }
    return best;
  };

  const EFFECT_DRAWING_MAX_W = 720;
  const EFFECT_DRAWING_MAX_H = 560;
  const EFFECT_VIEW_PAD = 64;

  /** 当前可见视口中心 → 画布逻辑坐标（与 clientToBoard 一致） */
  const getViewportCenterBoardCoords = () => {
    const host = canvasRef.current;
    if (!host) {
      return { x: MOODBOARD_CONTENT_W / 2, y: MOODBOARD_CONTENT_H / 2 };
    }
    const rect = host.getBoundingClientRect();
    return clientToBoard(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const boundsFromMoodItems = (items: MoodBoardItem[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const it of items) {
      const h = it.height ?? (it.type === "marker" ? 16 : 180);
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.width);
      maxY = Math.max(maxY, it.y + h);
    }
    return { minX, minY, maxX, maxY };
  };

  /** 智能匹配成功后：平滑滚动（必要时单次缩小）使新节点群落在视口正中 */
  const smoothFocusBoardBounds = (bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }) => {
    const host = canvasRef.current;
    if (!host) return;

    const pad = 56;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const bw = Math.max(1, bounds.maxX - bounds.minX + pad * 2);
    const bh = Math.max(1, bounds.maxY - bounds.minY + pad * 2);
    const vw = host.clientWidth;
    const vh = host.clientHeight;

    const runScroll = (z: number) => {
      const wrapperW = MOODBOARD_CONTENT_W * z;
      const wrapperH = MOODBOARD_CONTENT_H * z;
      const sl = Math.max(0, Math.min(Math.max(0, wrapperW - vw), cx * z - vw / 2));
      const st = Math.max(0, Math.min(Math.max(0, wrapperH - vh), cy * z - vh / 2));
      host.scrollTo({ left: sl, top: st, behavior: "smooth" });
    };

    let z = canvasZoomRef.current || 1;
    if (bw * z > vw * 0.92 || bh * z > vh * 0.92) {
      const fitZ = Math.min(
        MOODBOARD_ZOOM_MAX,
        Math.max(MOODBOARD_ZOOM_MIN, Math.min(vw / bw, vh / bh) * 0.88)
      );
      if (fitZ < z - 0.02) {
        setCanvasZoom(Math.round(fitZ * 10000) / 10000);
        z = fitZ;
        window.setTimeout(() => runScroll(z), 90);
        return;
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => runScroll(z)));
  };

  /** 仅中央导入效果图（AI 失败或手动跳过），可缩放、可标点、可引线连材质 */
  const placeEffectImageOnly = (effectImageDataUrl: string, remark = "空间效果图") => {
    void (async () => {
      const img = await reencodeDataUrlSameDimensions(effectImageDataUrl, MOODBOARD_IMAGE_QUALITY);
      const { width: dw, height: dh } = await measureDataUrlContainedBox(img, EFFECT_DRAWING_MAX_W, EFFECT_DRAWING_MAX_H);
      setMoodboards((prev) => {
        const board = prev.find((b) => b.id === activeMoodboardId) ?? prev[0];
        if (!board) return prev;
        const container = canvasRef.current;
        const sl = container?.scrollLeft ?? 0;
        const st = container?.scrollTop ?? 0;
        const z = canvasZoomRef.current || 1;
        const vx = (sl + EFFECT_VIEW_PAD) / z;
        const vy = (st + EFFECT_VIEW_PAD) / z;
        const baseZ = board.items.length;
        const drawingId = `drawing_${Date.now()}`;
        const mainDrawing: MoodBoardItem = {
          id: drawingId,
          imageUrl: img,
          type: "drawing",
          x: vx,
          y: vy,
          width: dw,
          height: dh,
          zIndex: baseZ + 1,
          remark,
        };
        return prev.map((b) =>
          b.id === board.id ? { ...b, items: [...b.items, mainDrawing] } : b
        );
      });
    })();
  };

  /** 将 AI 结果写入当前情绪板：中央效果图 + 小圆点 marker + 材质卡 sample，供 SVG 引线使用 */
  const applyAIAnnotationsToCanvas = (annotations: AIAnnotationPayload[], effectImageDataUrl: string) => {
    if (!annotations.length) return;

    void (async () => {
      const compressedEffect = await reencodeDataUrlSameDimensions(effectImageDataUrl, MOODBOARD_IMAGE_QUALITY);
      const { width: dw, height: dh } = await measureDataUrlContainedBox(
        compressedEffect,
        EFFECT_DRAWING_MAX_W,
        EFFECT_DRAWING_MAX_H
      );
      const currentBoard = moodboards.find((b) => b.id === activeMoodboardId) ?? moodboards[0];
      const baseZ = currentBoard?.items.length ?? 0;
      const { x: centerX, y: centerY } = getViewportCenterBoardCoords();
      const vx = Math.max(0, Math.min(MOODBOARD_CONTENT_W - dw, centerX - dw / 2));
      const vy = Math.max(0, Math.min(MOODBOARD_CONTENT_H - dh, centerY - dh / 2));

      const drawingId = `drawing_${Date.now()}`;
      const mainDrawing: MoodBoardItem = {
        id: drawingId,
        imageUrl: compressedEffect,
        type: "drawing",
        x: vx,
        y: vy,
        width: dw,
        height: dh,
        zIndex: baseZ + 1,
        remark: "AI 识别基准方案",
      };

      const newItems: MoodBoardItem[] = [mainDrawing];

      annotations.forEach((anno, idx) => {
        const markerId = `marker_${idx}_${Date.now()}`;
        const sampleId = `sample_${idx}_${Date.now()}`;
        const mat = resolveMaterialFromAnnotation({
          matched_material_id: anno.matched_material_id,
          main_name: anno.main_name,
          parameter: anno.parameter,
        });
        const isLeft = anno.x < 50;

        newItems.push({
          id: markerId,
          type: "marker",
          parentId: drawingId,
          targetId: sampleId,
          relX: anno.x,
          relY: anno.y,
          x: vx + (anno.x * dw) / 100,
          y: vy + (anno.y * dh) / 100,
          width: 16,
          height: 16,
          zIndex: baseZ + 100 + idx,
          remark: anno.main_name || "标注点",
        });

        if (mat) {
          newItems.push({
            id: sampleId,
            type: "sample",
            parentId: drawingId,
            x: isLeft ? vx - 250 : vx + dw + 50,
            y: vy + (idx % 4) * 180,
            width: 180,
            height: 180,
            zIndex: baseZ + 50 + idx,
            ...stampLinkedMaterialFields(mat),
          });
        } else {
          newItems.push({
            id: sampleId,
            type: "sample",
            parentId: drawingId,
            x: isLeft ? vx - 250 : vx + dw + 50,
            y: vy + (idx % 4) * 180,
            width: 180,
            height: 180,
            zIndex: baseZ + 50 + idx,
            remark: `${anno.main_name || "未匹配材质"}\n${anno.parameter || "—"}`,
          });
        }
      });

      const focusBounds = boundsFromMoodItems(newItems);

      setMoodboards((prev) => {
        const board = prev.find((b) => b.id === activeMoodboardId) ?? prev[0];
        if (!board) return prev;
        return prev.map((b) =>
          b.id === board.id ? { ...b, items: [...b.items, ...newItems] } : b
        );
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => smoothFocusBoardBounds(focusBounds));
      });
    })();
  };

  const handleAIAnalysis = async () => {
    if (isAnalyzing) return;
    if (!aiImage) {
      alert("请先上传空间效果图");
      return;
    }

    const geminiKey = getGeminiApiKey();
    const qwenKey = getQwenApiKey();
    const dsOk = !!(getDeepSeekApiKey() && getDeepSeekVisionModelName());

    if (!geminiKey && !qwenKey && !dsOk) {
      alert("未配置识别服务，请稍后再试。");
      return;
    }

    let imageForApi = aiImage;
    try {
      imageForApi = await reencodeDataUrlSameDimensions(aiImage, AI_MODAL_IMAGE_QUALITY);
    } catch {
      /* 使用原图 */
    }

    const mimeMatch = imageForApi.match(/^data:(image\/[\w+.-]+);base64,/);
    const mimeType = mimeMatch?.[1] || "image/jpeg";
    const base64Part = imageForApi.includes(",") ? imageForApi.split(",")[1] : imageForApi;

    setIsAnalyzing(true);
    setAnalysisStep(2);
    try {
      const modelText = await analyzeWithVisionFallback(
        MATERIAL_ANALYSIS_PROMPT,
        imageForApi,
        base64Part,
        mimeType,
        { sampleAnchor: aiVisionAnchor ?? undefined }
      );

      let annotationsRaw: unknown[];
      try {
        annotationsRaw = parseMaterialAnalysisText(modelText);
      } catch (parseErr) {
        console.warn("[AI] JSON 解析失败，改为仅导入效果图:", parseErr);
        placeEffectImageOnly(imageForApi, "空间效果图（手动标注）");
        setVisualAnnotations(null);
        setMatchResults(null);
        setAnalysisStep(3);
        setIsAIModalOpen(false);
        setAiImage(null);
        setAiVisionAnchor(null);
        return;
      }

      const enriched: AIAnnotationPayload[] = annotationsRaw.map((ann: Record<string, unknown>) => {
        const item = ann as {
          matched_material_id?: string;
          main_name?: string;
          parameter?: string;
          x?: number;
          y?: number;
          logic?: string;
        };
        const mat = resolveMaterialFromAnnotation(item);
        return {
          ...item,
          matched_material_id: mat?.id ?? item.matched_material_id,
          x: typeof item.x === "number" ? item.x : 50,
          y: typeof item.y === "number" ? item.y : 50,
          logic: item.logic || "",
        };
      });

      const unique = dedupeAIAnnotations(enriched);

      if (!unique.length) {
        placeEffectImageOnly(imageForApi, "空间效果图（手动标注）");
        setVisualAnnotations(null);
        setMatchResults(null);
        setAnalysisStep(3);
        setIsAIModalOpen(false);
        setAiImage(null);
        setAiVisionAnchor(null);
        return;
      }

      applyAIAnnotationsToCanvas(unique, imageForApi);

      const matched: {
        material: Material;
        remark: string;
        coords: { x: number; y: number };
        logic: string;
      }[] = [];
      unique.forEach((item) => {
        const mat = item.matched_material_id
          ? materials.find((m) => m.id === item.matched_material_id)
          : undefined;
        if (mat) {
          matched.push({
            material: mat,
            remark: `${item.main_name || ""}: ${item.parameter || ""}`,
            coords: { x: item.x, y: item.y },
            logic: item.logic || "",
          });
        }
      });

      setMatchResults(matched.length ? matched : null);
      setVisualAnnotations(null);
      setAnalysisStep(3);
      setIsAIModalOpen(false);
      setAiImage(null);
      setAiVisionAnchor(null);
    } catch (err) {
      console.error("AI Analysis failed:", err);
      if (aiImage) {
        placeEffectImageOnly(aiImage, "空间效果图（手动标注）");
        setVisualAnnotations(null);
        setMatchResults(null);
        setAnalysisStep(3);
        setIsAIModalOpen(false);
        setAiImage(null);
        setAiVisionAnchor(null);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const skipAIToManualPlacement = () => {
    setIsAnalyzing(false);
    if (!aiImage) {
      alert("请先上传效果图");
      return;
    }
    placeEffectImageOnly(aiImage, "空间效果图（手动标注）");
    setVisualAnnotations(null);
    setMatchResults(null);
    setAnalysisStep(3);
    setIsAIModalOpen(false);
    setAiImage(null);
    setAiVisionAnchor(null);
  };
  /** 手动再次应用（若仍保留预览数据时使用） */
  const confirmAIMatch = () => {
    if (!aiImage || !visualAnnotations?.length) return;
    applyAIAnnotationsToCanvas(visualAnnotations as AIAnnotationPayload[], aiImage);
    setVisualAnnotations(null);
    setMatchResults(null);
    setAnalysisStep(3);
    setIsAIModalOpen(false);
    setAiImage(null);
    setAiVisionAnchor(null);
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
              <div
                key={mb.id}
                className={`flex items-center gap-1 rounded-xl transition-all ${activeMoodboardId === mb.id ? "bg-black text-white" : "bg-transparent hover:bg-gray-50 text-gray-400"}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveMoodboardId(mb.id)}
                  className="flex-1 min-w-0 text-left p-3 rounded-xl text-xs font-bold flex items-center justify-between"
                >
                  <span className="truncate mr-2">{mb.name}</span>
                  <span className="opacity-50 text-[9px] shrink-0">
                    {mb.items.filter(i => i.type === "material" || i.type === "sample").length}/{mb.maxMaterials}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteBoard(e, mb.id)}
                  className={`shrink-0 p-2 rounded-lg mr-1 transition-colors ${
                    activeMoodboardId === mb.id
                      ? "text-white/70 hover:text-white hover:bg-white/10"
                      : "text-gray-300 hover:text-red-500 hover:bg-red-50"
                  }`}
                  title="删除情绪板"
                  aria-label={`删除 ${mb.name}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
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
                  <div 
                    key={`rec_${mat.id}`} 
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MATERIAL_MIME, mat.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => addItem(mat)} 
                    className="flex items-center gap-4 p-2 rounded-xl bg-blue-50/50 border border-blue-100/50 hover:bg-blue-50 cursor-pointer group transition-all"
                  >
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
                <label
                  className="cursor-pointer bg-gray-100 p-1.5 rounded-lg hover:bg-black hover:text-white transition-all shadow-sm"
                  title="上传本地材料（仅加入左侧「本地材料」列表）"
                >
                  <input
                    ref={sidebarLocalUploadRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      await registerLocalMaterialFromSidebar(file);
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
              <button
                type="button"
                onClick={() => setSelectedCategory("LOCAL")}
                className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${selectedCategory === "LOCAL" ? 'bg-black text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
              >
                本地材料
              </button>
            </div>

                {selectedCategory === "LOCAL" ? (
                  <div className="space-y-4">
                    {localMaterialsList.length === 0 ? (
                      <div className="p-8 text-center">
                        <p className="text-[10px] text-gray-400 font-bold">暂无本地材料</p>
                        <p className="text-[9px] text-gray-300 mt-1">点击右上角上传或画布右键「上传本地材料」</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2">
                        {localMaterialsList.map((loc) => (
                          <div
                            key={loc.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(DRAG_LOCAL_MATERIAL_MIME, loc.id);
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            onClick={() => addLocalMaterialCardFromCatalog(loc.id)}
                            className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 border border-amber-100/80 bg-amber-50/30 cursor-pointer group transition-all active:scale-95"
                          >
                            <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-gray-100 ring-1 ring-black/5">
                              <img src={loc.imageUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-black truncate text-black">
                                {loc.name || LOCAL_MATERIAL_NAME_PLACEHOLDER}
                              </p>
                              <p className="text-[9px] text-amber-700/80 font-bold">
                                规格: {loc.spec || LOCAL_TEMP_DEFAULT_SPEC}
                              </p>
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
                ) : (
                (() => {
                  const itemsWithThisCategory = savedMaterials.filter(
                    (m) => selectedCategory === "ALL" || m.category === selectedCategory
                  );
                  
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
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData(DRAG_MATERIAL_MIME, mat.id);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
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
                })()
                )}
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
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button onClick={handleExport} className="bg-gray-100 text-black px-3 md:px-6 py-2 rounded-full text-[10px] md:text-xs font-bold hover:bg-black hover:text-white transition-all">生成材料表</button>
            <button onClick={handleGenerateImage} className="bg-black text-white px-3 md:px-6 py-2 rounded-full text-[10px] md:text-xs font-bold shadow-lg">生成大图</button>
          </div>
        </div>

        <div className="absolute bottom-6 right-6 z-[70] flex flex-col gap-1.5 pointer-events-auto" style={{ display: isFinalMode ? "none" : undefined }}>
          <button
            type="button"
            title="放大（Ctrl+滚轮上）"
            onClick={() => zoomCanvas(1.1)}
            disabled={isFinalMode || canvasZoom >= MOODBOARD_ZOOM_MAX - 0.001}
            className="w-10 h-10 rounded-xl bg-white border border-gray-200 shadow-md text-lg font-black text-black hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            +
          </button>
          <button
            type="button"
            title="缩小（Ctrl+滚轮下）"
            onClick={() => zoomCanvas(1 / 1.1)}
            disabled={isFinalMode || canvasZoom <= MOODBOARD_ZOOM_MIN + 0.001}
            className="w-10 h-10 rounded-xl bg-white border border-gray-200 shadow-md text-lg font-black text-black hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            −
          </button>
        </div>

        <div 
          className={`flex-1 relative moodboard-canvas overflow-x-auto overflow-y-auto p-40 transition-all duration-500 bg-[#fafafa] flex items-center justify-center scroll-smooth select-none ${
            isFinalMode ? 'cursor-crosshair' : isCanvasPanDragging ? 'cursor-grabbing' : canvasPanArmed ? 'cursor-grab' : ''
          } ${isExporting ? 'pointer-events-none' : ''}`} 
          ref={canvasRef}
          onMouseDown={(e) => {
            if (isExporting || isPreviewingCapturedImage || isPreviewingImage || isAIModalOpen || connectingFromId) return;
            if (!isFinalMode && e.button === 0 && panArmed()) {
              const host = canvasRef.current;
              if (host) {
                e.preventDefault();
                canvasPanSessionRef.current = {
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  startScrollLeft: host.scrollLeft,
                  startScrollTop: host.scrollTop,
                };
                setIsCanvasPanDragging(true);
                const onMove = (ev: MouseEvent) => {
                  const s = canvasPanSessionRef.current;
                  const h = canvasRef.current;
                  if (!s || !h) return;
                  const dx = ev.clientX - s.startClientX;
                  const dy = ev.clientY - s.startClientY;
                  h.scrollLeft = s.startScrollLeft - dx;
                  h.scrollTop = s.startScrollTop - dy;
                };
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                  canvasPanSessionRef.current = null;
                  setIsCanvasPanDragging(false);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }
              return;
            }
            if (isFinalMode) {
              const host = canvasRef.current;
              const rect = host?.getBoundingClientRect();
              if (rect && host) {
                const b = clientToBoard(e.clientX, e.clientY);
                const x = b.x;
                const y = b.y;
                
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
          onContextMenu={(e) => {
            if (isFinalMode || isExporting || isAIModalOpen) return;
            const t = e.target as HTMLElement;
            if (t.closest("[data-moodboard-card]")) return;
            e.preventDefault();
            const p = clientToBoard(e.clientX, e.clientY);
            setCanvasContextMenu({
              clientX: e.clientX,
              clientY: e.clientY,
              boardX: p.x,
              boardY: p.y,
            });
          }}
          onMouseMove={handleMoveAction}
          onMouseUp={handlePointerUp}
          onTouchMove={handleMoveAction}
          onTouchEnd={handlePointerUp}
        >
          <input
            ref={canvasLocalUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              const menu = canvasContextMenu;
              e.target.value = "";
              setCanvasContextMenu(null);
              if (!file || !menu) return;
              await insertLocalCanvasMaterial(file, menu.boardX, menu.boardY);
            }}
          />
          {canvasContextMenu && (
            <div
              className="fixed z-[300] min-w-[168px] rounded-xl border border-gray-100 bg-white py-1 shadow-2xl"
              style={{ left: canvasContextMenu.clientX, top: canvasContextMenu.clientY }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-bold text-black hover:bg-gray-50"
                onClick={() => canvasLocalUploadRef.current?.click()}
              >
                <span className="text-base leading-none">+</span>
                上传本地材料
              </button>
            </div>
          )}
          <div
            className="relative shrink-0"
            style={{
              width: MOODBOARD_CONTENT_W * canvasZoom,
              height: MOODBOARD_CONTENT_H * canvasZoom,
            }}
          >
            <div
              data-moodboard-scale
              className="absolute left-0 top-0 origin-top-left will-change-transform"
              style={{
                width: MOODBOARD_CONTENT_W,
                height: MOODBOARD_CONTENT_H,
                transform: `scale(${canvasZoom})`,
                transformOrigin: '0 0',
              }}
              onDragOver={!isFinalMode ? handleLibraryMaterialDragOver : undefined}
              onDrop={!isFinalMode ? handleLibraryMaterialDrop : undefined}
            >
          <div
            data-moodboard-bg-hit
            className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-50 pointer-events-none"
          />
          
          {activeBoard.items.sort((a, b) => a.zIndex - b.zIndex).map(item => {
            const mat = item.materialId ? materials.find(m => m.id === item.materialId) : null;
            const isDrawing = item.type === 'drawing';
            const isMarker = item.type === 'marker';
            const isSample = item.type === 'sample' || item.type === 'material';
            const localCatalogEntry = item.localMaterialId
              ? localMaterialsList.find((l) => l.id === item.localMaterialId)
              : null;
            const display = isSample ? getCardDisplay(item, mat, localCatalogEntry) : null;
            
            return (
              <div 
                key={item.id}
                data-moodboard-card={isSample || isDrawing ? true : undefined}
                data-moodboard-card-id={isSample ? item.id : undefined}
                className={`absolute group ${isMarker ? 'hover:scale-125' : ''} ${(isAIModalOpen || (isMarker && editingTitleId)) ? 'hidden' : ''}`}
                style={{ 
                  left: item.x, 
                  top: item.y, 
                  width: item.width,
                  height: isMarker ? undefined : item.height,
                  zIndex: isMarker ? 3000 : item.zIndex,
                  pointerEvents: isFinalMode ? "none" : "auto",
                  cursor: isFinalMode
                    ? 'default'
                    : isCanvasPanDragging
                      ? 'grabbing'
                      : canvasPanArmed
                        ? 'grab'
                        : isMarker
                          ? 'move'
                          : 'move',
                }}
                onDragOver={isSample && !isFinalMode ? handleLibraryMaterialDragOver : undefined}
                onDrop={
                  isSample && !isFinalMode
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const localId = readDraggedLocalMaterialId(e);
                        if (localId) {
                          applyLocalMaterialToSample(item.id, localId);
                          return;
                        }
                        const libraryId = readDraggedLibraryMaterialId(e);
                        if (libraryId) assignMaterialToSample(item.id, libraryId);
                      }
                    : undefined
                }
              >
                <div 
                  onMouseDown={(e) => {
                    if (isFinalMode) return;
                    if (isDrawing && !panArmed()) e.stopPropagation();
                    handleStartAction(e, item.id, "move");
                  }}
                  onTouchStart={(e) => {
                    if (isFinalMode) return;
                    if (isDrawing && !panArmed()) e.stopPropagation();
                    handleStartAction(e, item.id, "move");
                  }}
                  className={`relative ${isDrawing ? "cursor-move" : ""}`}
                >
                  {isMarker ? (
                    <div className="relative group/marker flex items-center justify-center">
                      <div className="w-5 h-5 bg-black border-2 border-white rounded-full shadow-2xl flex items-center justify-center cursor-move transition-transform active:scale-90 ring-4 ring-white/20">
                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                      </div>
                      {!isFinalMode && (
                        <button
                          type="button"
                          title="删除标注点及连线"
                          className="absolute -top-2 -right-2 z-[80] w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-black leading-none shadow-md opacity-0 group-hover/marker:opacity-100 hover:bg-red-600 transition-opacity flex items-center justify-center"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeMarkerOnly(item.id);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {isDrawing ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-full h-auto rounded-2xl shadow-xl cursor-move pointer-events-auto select-none transition-all"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (isFinalMode || !canvasRef.current) return;
                            if (panArmed()) return;
                            const { x: cx, y: cy } = clientToBoard(e.clientX, e.clientY);
                            const dw = item.width;
                            const dh = item.height;
                            if (
                              cx < item.x ||
                              cx > item.x + dw ||
                              cy < item.y ||
                              cy > item.y + dh
                            ) {
                              return;
                            }
                            const relX = ((cx - item.x) / dw) * 100;
                            const relY = ((cy - item.y) / dh) * 100;
                            const markerId = `marker_click_${Date.now()}`;
                            const maxZ = Math.max(...activeBoard.items.map((x) => x.zIndex), 0);
                            updateBoardItems([
                              ...activeBoard.items,
                              {
                                id: markerId,
                                type: "marker",
                                parentId: item.id,
                                relX,
                                relY,
                                x: cx - 8,
                                y: cy - 8,
                                width: 16,
                                height: 16,
                                zIndex: maxZ + 500,
                                remark: "标注点",
                              },
                            ]);
                          }}
                        />
                      ) : (display?.imageUrl ?? item.imageUrl ?? localCatalogEntry?.imageUrl ?? mat?.image) ? (
                        <div className="relative w-full overflow-hidden rounded-2xl" style={{ height: isSample ? item.height : undefined }}>
                          <img
                            src={
                              display?.imageUrl ??
                              item.imageUrl ??
                              localCatalogEntry?.imageUrl ??
                              mat?.image
                            }
                            alt=""
                            className={`w-full h-full object-cover rounded-2xl shadow-xl cursor-move pointer-events-none select-none transition-all ${isSample ? "border-4 border-white ring-1 ring-black/5" : ""}`}
                          />
                          {isSample && display?.showUpdateDot && !isExporting && (
                            <button
                              type="button"
                              title="材料信息已变更，是否更新？"
                              onClick={(e) => {
                                e.stopPropagation();
                                applyLibraryRefreshToCard(item.id);
                              }}
                              className="absolute top-2 right-2 z-[60] w-3 h-3 rounded-full bg-red-500 ring-2 ring-white shadow-md hover:scale-110 transition-transform moodboard-update-dot"
                              aria-label="材料信息已变更，点击更新"
                            />
                          )}
                          {item.type === "sample" && !isFinalMode && (
                            <div
                              className="pointer-events-none absolute inset-[4px] rounded-xl border-2 border-dashed border-black/25 z-[5]"
                              aria-hidden
                            />
                          )}
                        </div>
                      ) : (
                        <div
                          className={`w-full min-h-[140px] bg-gradient-to-br from-gray-50 to-gray-200 rounded-2xl shadow-inner flex items-center justify-center p-4 text-center text-[11px] font-black text-gray-600 whitespace-pre-wrap pointer-events-none ${isSample ? "border-4 border-dashed border-gray-300" : ""}`}
                        >
                          {item.remark || "待匹配材质"}
                        </div>
                      )}
                      
                      {/* 右侧规格条（可双击编辑，与全局库解耦） */}
                      {isSample && display && (
                        <div className="absolute left-[calc(100%+8px)] top-0 flex flex-col items-start min-w-[120px] max-w-[min(220px,70vw)] [writing-mode:horizontal-tb] z-[40]">
                          <div
                            className={`bg-white/55 backdrop-blur-md border-l-2 pl-3 py-2 shadow-sm rounded-r-lg pointer-events-auto ${
                              editingSpecId === item.id ? "border-blue-500 ring-1 ring-blue-400/30" : "border-black/70"
                            }`}
                          >
                            <p className="text-[11px] font-black text-black leading-tight mb-1 break-words pointer-events-none">
                              {display.name}
                            </p>
                            {editingSpecId === item.id ? (
                              <input
                                type="text"
                                autoFocus
                                className="w-full text-[9px] font-bold text-gray-700 bg-white/80 rounded px-1 py-0.5 outline-none border border-blue-400"
                                defaultValue={display.spec}
                                onBlur={(e) => {
                                  const spec =
                                    e.target.value.trim() ||
                                    (isLocalBoardMaterial(item)
                                      ? LOCAL_TEMP_DEFAULT_SPEC
                                      : "—");
                                  let titleName = item.displayName;
                                  if (titleName == null || titleName === "") {
                                    titleName =
                                      display.name ||
                                      (isLocalBoardMaterial(item) ? "" : "未命名");
                                  }
                                  patchBoardItem(item.id, {
                                    isEditedByUser: true,
                                    displaySpec: spec,
                                    displayName: titleName,
                                    remark: syncCardRemark(
                                      titleName || LOCAL_MATERIAL_NAME_PLACEHOLDER,
                                      spec
                                    ),
                                    snapshotImageUrl: isLocalBoardMaterial(item)
                                      ? item.imageUrl
                                      : item.snapshotImageUrl ?? item.imageUrl ?? mat?.image,
                                  });
                                  if (item.localMaterialId) {
                                    syncLocalCatalogFromCard(item.localMaterialId, titleName, spec);
                                  }
                                  setEditingSpecId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  if (e.key === "Escape") setEditingSpecId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <p
                                className="text-[9px] font-bold text-gray-600 leading-tight cursor-text hover:text-black"
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  if (isFinalMode) return;
                                  if (
                                    !isLocalBoardMaterial(item) &&
                                    !item.specEditWarningAcked &&
                                    !item.isEditedByUser
                                  ) {
                                    setSpecEditModalItemId(item.id);
                                    return;
                                  }
                                  setEditingSpecId(item.id);
                                }}
                              >
                                规格: {display.spec}
                              </p>
                            )}
                            {mat && !isLocalBoardMaterial(item) && (
                              <p className="text-[8px] font-bold text-gray-400 mt-1 uppercase tracking-tighter pointer-events-none">
                                REF: {mat.id.slice(-6).toUpperCase()}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      <div 
                        className={`absolute -bottom-10 left-1/2 -translate-x-1/2 w-[92%] max-w-[240px] z-[100]`}
                      >
                        <div 
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!isFinalMode && isSample) setEditingTitleId(item.id);
                            if (!isFinalMode && isDrawing) setEditingTitleId(item.id);
                          }}
                          className={`bg-white/45 backdrop-blur-md border rounded-xl px-3 py-2 shadow-lg flex flex-col items-center gap-1 group/label transition-all ${editingTitleId === item.id ? 'border-blue-500/80 ring-1 ring-blue-500/25' : 'border-white/60 hover:border-black/20'}`}
                        >
                          {editingTitleId === item.id ? (
                            <input 
                              type="text"
                              autoFocus
                              defaultValue={
                                isSample && display
                                  ? display.name || (isLocalBoardMaterial(item) ? "" : display.name)
                                  : (item.remark || "").split("\n")[0]
                              }
                              placeholder={isLocalBoardMaterial(item) ? LOCAL_MATERIAL_NAME_PLACEHOLDER : undefined}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                if (isSample && display) {
                                  const spec =
                                    item.displaySpec ??
                                    display.spec ??
                                    LOCAL_TEMP_DEFAULT_SPEC;
                                  const name = isLocalBoardMaterial(item)
                                    ? raw
                                    : raw || "未命名";
                                  patchBoardItem(item.id, {
                                    isEditedByUser: true,
                                    displayName: name,
                                    displaySpec: spec,
                                    remark: syncCardRemark(
                                      name || LOCAL_MATERIAL_NAME_PLACEHOLDER,
                                      spec
                                    ),
                                    snapshotImageUrl: isLocalBoardMaterial(item)
                                      ? item.imageUrl
                                      : item.snapshotImageUrl ??
                                        item.imageUrl ??
                                        mat?.image,
                                  });
                                  if (item.localMaterialId) {
                                    syncLocalCatalogFromCard(item.localMaterialId, name, spec);
                                  }
                                } else {
                                  patchBoardItem(item.id, { remark: raw || "未命名" });
                                }
                                setEditingTitleId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') setEditingTitleId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              className={`w-full bg-transparent text-center outline-none transition-all ${isDrawing ? 'text-[10px] font-black text-gray-500 uppercase tracking-widest' : 'text-[12px] font-black text-black'}`}
                            />
                          ) : (
                            <div className={`w-full text-center select-none cursor-text whitespace-pre-wrap ${isDrawing ? 'text-[10px] font-black text-gray-500 tracking-widest' : 'text-[12px] font-black tracking-tight'}`}>
                              {isSample && display ? (
                                display.name ? (
                                  <span className="text-black">{display.name}</span>
                                ) : isLocalBoardMaterial(item) ? (
                                  <span className="text-gray-400/85 italic font-medium">{LOCAL_MATERIAL_NAME_PLACEHOLDER}</span>
                                ) : (
                                  <span className="text-black">{display.name}</span>
                                )
                              ) : (
                                item.remark
                              )}
                            </div>
                          )}
                          
                          {/* Connection Handle - ONLY MOVE LOGIC HERE */}
                          {!isFinalMode && editingTitleId !== item.id && (
                            <div 
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                if (panArmed()) return;
                                const el = canvasRef.current;
                                if (!el) return;
                                setConnectingFromId(item.id);
                                const p = clientToBoard(e.clientX, e.clientY);
                                setTempPointerPos({ x: p.x, y: p.y });
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
                
                {/* 悬停控制：层级 ↑↓ + 删除 */}
                {!isMarker && (
                <div className="absolute -top-9 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-white/90 backdrop-blur shadow-lg rounded-full px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                  <button type="button" onClick={() => changeOrder(item.id, 'up')} className="p-1 hover:bg-gray-100 rounded-full text-black" title="上移一层">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button type="button" onClick={() => changeOrder(item.id, 'down')} className="p-1 hover:bg-gray-100 rounded-full text-black" title="下移一层">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="w-px h-2.5 bg-gray-200 mx-0.5" />
                  <button 
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      removeBoardItemCascade(item.id);
                    }}
                    className="p-1 hover:bg-red-50 text-red-500 rounded-full"
                    title="从画布移除"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                )}

                {!isMarker && (
                  <div 
                    onMouseDown={(e) => { e.stopPropagation(); handleStartAction(e, item.id, 'resize'); }}
                    onTouchStart={(e) => { e.stopPropagation(); handleStartAction(e, item.id, 'resize'); }}
                    className="absolute bottom-1 right-1 w-4 h-4 rounded-md bg-white/90 border border-black/15 shadow-sm flex items-end justify-end cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity z-50"
                    title="拖拽缩放"
                  >
                    <svg className="w-2.5 h-2.5 text-black/45" viewBox="0 0 10 10" aria-hidden>
                      <path d="M9 1v8H1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <path d="M9 5v4H5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}

          {/* SVG Overlay for Lines (Placed AFTER items) */}
          {!isAIModalOpen && !isPreviewingCapturedImage && !editingTitleId && !editingSpecId && (
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

          {/* Export Header Overlay（随克隆导出；名称左上放大，Logo 缩小置角，少挡材质） */}
          {isFinalMode && cropBox && (
            <div
              className="absolute pointer-events-none z-[6000]"
              style={{
                left: cropBox.x,
                top: cropBox.y,
                width: cropBox.w,
                height: cropBox.h,
              }}
            >
              {/* 纯色衬底，禁止渐变/阴影，避免 html2canvas 把半透明带渲成顶部灰条 */}
              <div className="absolute left-3 top-3 max-w-[85%] pointer-events-none bg-white pt-1 pr-2 pb-2">
                <p className="text-[26px] sm:text-[34px] font-black text-black tracking-tight leading-tight break-words">
                  {activeBoard.name}
                </p>
              </div>
              <div className="absolute bottom-3 right-3 pointer-events-none">
                <div className="bg-black text-white px-3.5 py-2 border border-white/10">
                  <span className="text-[11px] font-black tracking-tight leading-snug whitespace-nowrap">
                    物见 <span className="text-gray-500 font-light mx-1">|</span> MATTER INSIGHT
                  </span>
                </div>
              </div>
            </div>
          )}
            </div>
          </div>
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
                    void exportOverlayTick;
                    const scr = cropBoxToScreenRect(cropBox);
                    if (!scr) return "none";
                    const { left: x, top: y, width: cw, height: ch } = scr;
                    return `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${x}px ${y}px, ${x}px ${y + ch}px, ${x + cw}px ${y + ch}px, ${x + cw}px ${y}px, ${x}px ${y}px)`;
                  })(),
                }}
              />
              {/* Darkness Mask */}
              <div 
                className="absolute transition-all duration-75 z-[8002]"
                style={{
                  left: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.left ?? 0;
                  })(),
                  top: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.top ?? 0;
                  })(),
                  width: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.width ?? 0;
                  })(),
                  height: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.height ?? 0;
                  })(),
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                }}
              />
            </>
          )}

          {!cropBox && <div className="absolute inset-0 bg-black/50 backdrop-blur-md z-[8001]" />}

          {cropBox && !isPreviewingCapturedImage && (
              <div 
                className={`absolute border-2 border-blue-500 z-[8003] pointer-events-auto overflow-hidden bg-transparent ${isMovingCropBox ? 'cursor-move' : 'cursor-default'}`}
                style={{
                  left: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.left ?? 0;
                  })(),
                  top: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.top ?? 0;
                  })(),
                  width: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.width ?? 0;
                  })(),
                  height: (() => {
                    void exportOverlayTick;
                    return cropBoxToScreenRect(cropBox)?.height ?? 0;
                  })(),
                  boxShadow:
                    '0 0 0 4px rgba(59, 130, 246, 0.2), inset 0 0 0 1px rgba(255,255,255,0.5)',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  // For better UX, a single click confirms if it hasn't just been moved/resized
                  if (!isMovingCropBox && !resizingCropHandle) {
                     void handleExportToImage();
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
              type="button"
              onClick={() => void handleExportToImage()} 
              disabled={!cropBox || isExporting} 
              className={`px-12 py-3 rounded-full text-xs font-black shadow-xl transition-all flex items-center gap-2 active:scale-95 ${!cropBox ? 'bg-gray-100 text-gray-300' : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 hover:shadow-blue-500/40'}`}
            >
              {isExporting && <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
              <span>{isExporting ? '开始生成...' : '预览成图'}</span>
            </button>
          </div>
        </div>
      )}

      {/* AI Floating Button — 导出模式下隐藏，避免误触 */}
      <div style={{ display: isFinalMode ? "none" : undefined }}>
<button 
  onClick={() => {
    setIsAIModalOpen(true);
    setAnalysisStep(1);
    setVisualAnnotations(null);
    setMatchResults(null);
  }}
  className="absolute bottom-8 right-8 h-14 bg-black text-white rounded-full shadow-2xl flex items-center gap-3 px-6 group hover:scale-105 transition-all z-[60] border border-white/20"
>
  <span className="text-xl group-hover:rotate-12 transition-transform">✨</span>
  <span className="text-sm font-black tracking-widest">智能匹配</span>
</button>
      </div>

   

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
                className="max-w-full max-h-[70vh] rounded-sm bg-white shadow-none ring-0"
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

      {/* 规格编辑二次确认 */}
      {specEditModalItemId && (
        <div
          className="fixed inset-0 z-[8500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setSpecEditModalItemId(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-black text-amber-600 mb-2">⚠️ 提示</p>
            <p className="text-sm text-gray-700 leading-relaxed mb-6">
              一旦修改参数，材料库规格/库存更新时就无法自动更新了。是否确认修改？
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-5 py-2 rounded-full text-xs font-bold border border-gray-200 hover:bg-gray-50"
                onClick={() => setSpecEditModalItemId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-5 py-2 rounded-full text-xs font-bold bg-black text-white hover:bg-gray-800"
                onClick={() => {
                  const id = specEditModalItemId;
                  patchBoardItem(id, { specEditWarningAcked: true });
                  setSpecEditModalItemId(null);
                  setEditingSpecId(id);
                }}
              >
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 智能匹配弹窗 */}
      {isAIModalOpen && (
        <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
          <div className="bg-white rounded-[40px] shadow-2xl flex flex-col md:flex-row max-w-4xl w-full overflow-hidden min-h-[500px]">
            <div className="w-full md:w-1/2 p-12 flex flex-col justify-between border-b md:border-b-0 md:border-r border-gray-100">
              <div>
                <div className="bg-black text-white text-[10px] font-black px-3 py-1 rounded inline-block mb-6 tracking-tighter">AI INSIGHT</div>
                <h2 className="text-4xl font-black text-black leading-tight mb-6">智能材质<br/>识别系统</h2>
                <p className="text-gray-400 text-sm leading-relaxed font-medium">
                  上传您的空间效果图，我们的 AI 将深度分析图像中的材质构成，并从您的收藏库及平台库中自动匹配最接近的实物材料。
                </p>
              </div>

              <div className="space-y-4 mt-8">
                {[
                  { step: 1, label: "上传效果图", active: analysisStep === 1 && !isAnalyzing },
                  { step: 2, label: "AI 深度识别", active: isAnalyzing },
                  { step: 3, label: "生成情绪板", active: analysisStep === 3 },
                ].map(s => (
                  <div key={s.step} className={`flex items-center gap-4 transition-opacity ${s.active ? "opacity-100" : "opacity-30"}`}>
                    <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-xs font-bold">{s.step}</div>
                    <span className="text-xs font-bold tracking-widest uppercase">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <form
              autoComplete="off"
              onSubmit={(e) => e.preventDefault()}
              className="w-full md:w-1/2 p-12 bg-gray-50 flex flex-col items-center justify-center relative"
            >
              <button
                type="button"
                onClick={() => {
                  setIsAIModalOpen(false);
                  setAiImage(null);
                  setAiVisionAnchor(null);
                  setAnalysisStep(1);
                  setVisualAnnotations(null);
                  setMatchResults(null);
                }}
                className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>

              <div className="w-full max-w-[300px] aspect-square rounded-3xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden bg-white shadow-inner relative group">
                {aiImage ? (
                  <>
                    <img
                      src={aiImage}
                      alt=""
                      title="点击图片可指定颜色采样参考点（千问前置 RGB）；未点击则用画面中心"
                      className="w-full h-full object-contain"
                      onClick={(ev) => {
                        if (isAnalyzing) return;
                        setAiVisionAnchor(previewImageClickToVisionAnchor(ev));
                      }}
                    />
                    {isAnalyzing && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 text-center">
                        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                        <p className="text-sm font-bold">正在解析空间...</p>
                        <p className="text-[10px] opacity-60">正在匹配库中对应材质</p>
                      </div>
                    )}
                  </>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center">
                    <input type="file" className="hidden" autoComplete="off" accept="image/*" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void (async () => {
                        try {
                          const url = await reencodeFileToDataUrl(file, AI_MODAL_IMAGE_QUALITY);
                          setAiVisionAnchor(null);
                          setAiImage(url);
                        } catch {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            setAiVisionAnchor(null);
                            setAiImage(event.target?.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      })();
                    }} />
                    <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                    </div>
                    <p className="text-xs font-bold text-gray-400">点击上传空间图</p>
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  console.log('AI识别按钮已点击');
                  e.preventDefault();
                  e.stopPropagation();
                  void handleAIAnalysis();
                }}
                disabled={!aiImage || isAnalyzing}
                className={`mt-10 w-full max-w-[300px] py-4 rounded-2xl font-black text-xs tracking-[0.2em] transition-all ${
                  aiImage && !isAnalyzing
                    ? "bg-black text-white shadow-xl hover:scale-105 active:scale-95"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                {isAnalyzing ? "ANALYZING..." : "START AI ANALYSIS"}
              </button>

              <button
                type="button"
                disabled={!aiImage || isAnalyzing}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  skipAIToManualPlacement();
                }}
                className={`mt-3 w-full max-w-[300px] py-3 rounded-2xl font-bold text-[10px] tracking-widest transition-all border ${
                  aiImage && !isAnalyzing
                    ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    : "border-gray-100 bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                跳过 AI
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MoodBoardDesigner;
