const LOCAL_SAM_MODEL_ID = 'Xenova/slimsam-77-uniform';

type SamModule = typeof import('@xenova/transformers');

interface SamResources {
  model: Awaited<ReturnType<SamModule['SamModel']['from_pretrained']>>;
  processor: Awaited<ReturnType<SamModule['AutoProcessor']['from_pretrained']>>;
  RawImage: SamModule['RawImage'];
}

export interface LocalSamMaskResult {
  maskDataUrl: string;
  overlayDataUrl: string;
  width: number;
  height: number;
  areaRatio: number;
  bbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

let samResourcesPromise: Promise<SamResources> | null = null;

async function getSamResources(): Promise<SamResources> {
  if (!samResourcesPromise) {
    samResourcesPromise = (async () => {
      const mod = await import('@xenova/transformers');
      // Never persist model weights in LocalStorage (blobs are far too large and
      // trigger QuotaExceededError). Transformers.js stores weights in the Cache
      // Storage API when available, otherwise it falls back to the browser's
      // native HTTP cache — both are safe, high-capacity, and non-blocking.
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = typeof caches !== 'undefined';
      const [model, processor] = await Promise.all([
        mod.SamModel.from_pretrained(LOCAL_SAM_MODEL_ID),
        mod.AutoProcessor.from_pretrained(LOCAL_SAM_MODEL_ID),
      ]);
      return {
        model,
        processor,
        RawImage: mod.RawImage,
      };
    })();
  }
  return samResourcesPromise;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function extractBestMask(
  tensor: { dims: number[]; data: ArrayLike<number> },
  scoreTensor: { data?: ArrayLike<number> | null }
): { mask: Uint8Array; width: number; height: number } {
  const dims = tensor.dims;
  const width = dims[dims.length - 1] ?? 0;
  const height = dims[dims.length - 2] ?? 0;
  const candidateCount = Math.max(
    1,
    dims.slice(0, -2).reduce((product, dim) => product * dim, 1)
  );
  const scores = Array.from(scoreTensor.data ?? []);
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < candidateCount; index += 1) {
    const nextScore = typeof scores[index] === 'number' ? scores[index] : Number.NEGATIVE_INFINITY;
    if (nextScore > bestScore) {
      bestScore = nextScore;
      bestIndex = index;
    }
  }

  const planeSize = width * height;
  const offset = bestIndex * planeSize;
  const mask = new Uint8Array(planeSize);
  for (let i = 0; i < planeSize; i += 1) {
    const value = Number(tensor.data[offset + i] ?? 0);
    mask[i] = value > 0 ? 1 : 0;
  }

  return { mask, width, height };
}

function buildMaskAssets(mask: Uint8Array, width: number, height: number): LocalSamMaskResult {
  const maskCanvas = createCanvas(width, height);
  const overlayCanvas = createCanvas(width, height);
  const maskCtx = maskCanvas.getContext('2d');
  const overlayCtx = overlayCanvas.getContext('2d');
  if (!maskCtx || !overlayCtx) {
    throw new Error('Canvas 2D is unavailable for mask rendering.');
  }

  const maskImageData = maskCtx.createImageData(width, height);
  const overlayImageData = overlayCtx.createImageData(width, height);
  let filled = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  const isBoundaryPixel = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
        if (!mask[ny * width + nx]) return true;
      }
    }
    return false;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const alphaIndex = i * 4;
      if (!mask[i]) continue;

      filled += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      maskImageData.data[alphaIndex] = 255;
      maskImageData.data[alphaIndex + 1] = 255;
      maskImageData.data[alphaIndex + 2] = 255;
      maskImageData.data[alphaIndex + 3] = 255;

      const boundary = isBoundaryPixel(x, y);
      overlayImageData.data[alphaIndex] = boundary ? 255 : 239;
      overlayImageData.data[alphaIndex + 1] = boundary ? 255 : 68;
      overlayImageData.data[alphaIndex + 2] = boundary ? 255 : 68;
      overlayImageData.data[alphaIndex + 3] = boundary ? 255 : 122;
    }
  }

  if (!filled) {
    throw new Error('No selectable surface was detected at that point.');
  }

  maskCtx.putImageData(maskImageData, 0, 0);
  overlayCtx.putImageData(overlayImageData, 0, 0);

  return {
    maskDataUrl: maskCanvas.toDataURL('image/png'),
    overlayDataUrl: overlayCanvas.toDataURL('image/png'),
    width,
    height,
    areaRatio: filled / (width * height),
    bbox: {
      minX,
      minY,
      maxX,
      maxY,
    },
  };
}

// ---------------------------------------------------------------------------
// Mask Refinement pipeline (pure browser CV — no OpenCV, no extra models).
// SAM stays responsible for "finding the region"; this layer only cleans up the
// boundary before the mask is handed to Flux/Replicate inpainting:
//   SAM Mask -> A. Box Constraint -> B. Largest Connected Component
//            -> C. Edge Refinement (morphological open/close) -> Final Mask
// ---------------------------------------------------------------------------

// Small tolerance so a roughly-drawn selection box does not hard-clip the
// object edges that extend a few pixels past the drawn rectangle.
const BOX_PADDING_RATIO = 0.04;

interface RefineDebug {
  originalMaskArea: number;
  refinedMaskArea: number;
  removedPixels: number;
  boxConstraintApplied: boolean;
}

function countArea(mask: Uint8Array): number {
  let area = 0;
  for (let i = 0; i < mask.length; i += 1) area += mask[i] ? 1 : 0;
  return area;
}

// A. Keep only mask pixels that fall inside the user's selection box (+ small pad).
function applyBoxConstraint(
  mask: Uint8Array,
  width: number,
  height: number,
  box: [number, number, number, number]
): Uint8Array {
  const padX = Math.round((box[2] - box[0]) * BOX_PADDING_RATIO);
  const padY = Math.round((box[3] - box[1]) * BOX_PADDING_RATIO);
  const x1 = clamp(box[0] - padX, 0, width - 1);
  const y1 = clamp(box[1] - padY, 0, height - 1);
  const x2 = clamp(box[2] + padX, 0, width - 1);
  const y2 = clamp(box[3] + padY, 0, height - 1);
  const out = new Uint8Array(mask.length);
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const i = y * width + x;
      out[i] = mask[i];
    }
  }
  return out;
}

// B. Keep the connected region(s) most associated with the user's selection:
//    - Any positive seed (initial point + user "Add Area" points): keep every
//      component that contains a positive seed (so manual Add Area survives).
//    - Box Prompt with no positive seed: keep the component with the largest
//      overlap with the box. Falls back to the largest component otherwise.
function selectComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  options: { box: [number, number, number, number] | null; seeds: { x: number; y: number }[] }
): Uint8Array {
  const labels = new Int32Array(mask.length);
  const components: { label: number; size: number; overlap: number; hasSeed: boolean }[] = [];
  const stack: number[] = [];
  let current = 0;

  const seedIndices = new Set<number>();
  for (const seed of options.seeds) {
    if (seed.x >= 0 && seed.x < width && seed.y >= 0 && seed.y < height) {
      seedIndices.add(seed.y * width + seed.x);
    }
  }

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    current += 1;
    let size = 0;
    let overlap = 0;
    let hasSeed = false;
    stack.length = 0;
    stack.push(start);
    labels[start] = current;

    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % width;
      const y = (idx - x) / width;
      size += 1;

      if (seedIndices.has(idx)) hasSeed = true;
      if (
        options.box &&
        x >= options.box[0] &&
        x <= options.box[2] &&
        y >= options.box[1] &&
        y <= options.box[3]
      ) {
        overlap += 1;
      }

      if (x > 0 && mask[idx - 1] && !labels[idx - 1]) {
        labels[idx - 1] = current;
        stack.push(idx - 1);
      }
      if (x < width - 1 && mask[idx + 1] && !labels[idx + 1]) {
        labels[idx + 1] = current;
        stack.push(idx + 1);
      }
      if (y > 0 && mask[idx - width] && !labels[idx - width]) {
        labels[idx - width] = current;
        stack.push(idx - width);
      }
      if (y < height - 1 && mask[idx + width] && !labels[idx + width]) {
        labels[idx + width] = current;
        stack.push(idx + width);
      }
    }

    components.push({ label: current, size, overlap, hasSeed });
  }

  if (!components.length) return new Uint8Array(mask.length);

  const out = new Uint8Array(mask.length);
  const keep = new Set<number>();

  // Keep every component touched by a positive seed (initial point + Add Area).
  for (const component of components) {
    if (component.hasSeed) keep.add(component.label);
  }

  // In Box mode also keep the component that overlaps the box the most, so the
  // originally selected region survives even when the user only adds elsewhere.
  if (options.box) {
    let best: (typeof components)[number] | null = null;
    for (const component of components) {
      if (component.overlap <= 0) continue;
      if (!best || component.overlap > best.overlap) best = component;
    }
    if (best) keep.add(best.label);
  }

  if (keep.size) {
    for (let i = 0; i < mask.length; i += 1) {
      if (keep.has(labels[i])) out[i] = 1;
    }
    return out;
  }

  // Fallback: keep the single largest component (by size, then box overlap).
  let fallback = components[0];
  for (const component of components) {
    if (
      component.size > fallback.size ||
      (component.size === fallback.size && component.overlap > fallback.overlap)
    ) {
      fallback = component;
    }
  }
  for (let i = 0; i < mask.length; i += 1) {
    if (labels[i] === fallback.label) out[i] = 1;
  }
  return out;
}

// C. Lightweight morphology (3x3 / 8-neighbourhood) used for edge cleanup.
function erodeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let keep = true;
      for (let dy = -1; dy <= 1 && keep; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {
            keep = false;
            break;
          }
        }
      }
      out[i] = keep ? 1 : 0;
    }
  }
  return out;
}

function dilateMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (mask[i]) {
        out[i] = 1;
        continue;
      }
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask[ny * width + nx]) {
            hit = true;
            break;
          }
        }
      }
      out[i] = hit ? 1 : 0;
    }
  }
  return out;
}

// Opening removes small noise/specks; closing fills small holes & smooths edges.
function edgeRefine(mask: Uint8Array, width: number, height: number): Uint8Array {
  const opened = dilateMask(erodeMask(mask, width, height), width, height);
  return erodeMask(dilateMask(opened, width, height), width, height);
}

function refineMask(
  mask: Uint8Array,
  width: number,
  height: number,
  options: { box: [number, number, number, number] | null; seeds: { x: number; y: number }[] }
): { mask: Uint8Array; debug: RefineDebug } {
  const originalMaskArea = countArea(mask);
  let working = mask;
  const boxConstraintApplied = !!options.box;

  // A. Box Constraint — only keep it if the box actually overlaps the mask.
  if (options.box) {
    const constrained = applyBoxConstraint(working, width, height, options.box);
    if (countArea(constrained) > 0) working = constrained;
  }

  // B. Connected-component selection (anchored to the user's selection / Add points).
  const lcc = selectComponents(working, width, height, options);
  if (countArea(lcc) > 0) working = lcc;

  // C. Edge Refinement — keep only if it does not wipe out the region.
  const refinedEdges = edgeRefine(working, width, height);
  if (countArea(refinedEdges) > 0) working = refinedEdges;

  const refinedMaskArea = countArea(working);
  return {
    mask: working,
    debug: {
      originalMaskArea,
      refinedMaskArea,
      removedPixels: originalMaskArea - refinedMaskArea,
      boxConstraintApplied,
    },
  };
}

export async function warmupLocalSam(): Promise<void> {
  await getSamResources();
}

export interface LocalSamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Manual mask-editing prompt (PowerPoint-style Add / Remove Area).
//   label 1 => positive point (Add Area / keep)
//   label 0 => negative point (Remove Area)
export interface LocalSamPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

export async function generateLocalSamMask(params: {
  imageUrl: string;
  /** Point prompt (fallback). Ignored when `box` is provided. */
  clickX?: number;
  clickY?: number;
  /** Box prompt (natural pixel coords). Takes priority over the point prompt. */
  box?: LocalSamBox;
  /** Additional Add/Remove points appended to the base prompt for mask editing. */
  points?: LocalSamPoint[];
}): Promise<LocalSamMaskResult> {
  const { model, processor, RawImage } = await getSamResources();
  const rawImage = await RawImage.read(params.imageUrl);

  // IMPORTANT: @xenova/transformers@2.17.x `SamProcessor` takes POSITIONAL args:
  //   processor(image, input_points, input_labels)
  // and its ONNX prompt-encoder session has NO `input_boxes` input. Passing an
  // options object (e.g. { input_points } / { input_boxes }) put the object into
  // the `input_points` slot, which failed calculateDimensions and threw
  // "The input_points must be a 4D tensor...". We therefore always pass points
  // positionally, and encode a Box Prompt using SAM's canonical box corners:
  // two points labelled 2 (top-left) and 3 (bottom-right).
  //   input_points: 3D [point_batch_size, nb_points_per_image, 2] (auto-upshaped to 4D)
  //   input_labels: 2D [point_batch_size, nb_points_per_image]  (auto-upshaped to 3D)
  let inputPoints: number[][][];
  let inputLabels: number[][];
  let boxXYXY: [number, number, number, number] | null = null;
  // Anchor used by the refinement layer to pick the right connected component.
  let seedPoint: { x: number; y: number } | null = null;

  // Box Prompt takes priority over Point Prompt when a selection box exists.
  if (params.box) {
    const x1 = clamp(Math.round(Math.min(params.box.x1, params.box.x2)), 0, rawImage.width - 1);
    const y1 = clamp(Math.round(Math.min(params.box.y1, params.box.y2)), 0, rawImage.height - 1);
    const x2 = clamp(Math.round(Math.max(params.box.x1, params.box.x2)), 0, rawImage.width - 1);
    const y2 = clamp(Math.round(Math.max(params.box.y1, params.box.y2)), 0, rawImage.height - 1);
    boxXYXY = [x1, y1, x2, y2];
    inputPoints = [[[x1, y1], [x2, y2]]];
    inputLabels = [[2, 3]];
  } else {
    const clickX = clamp(Math.round(params.clickX ?? 0), 0, rawImage.width - 1);
    const clickY = clamp(Math.round(params.clickY ?? 0), 0, rawImage.height - 1);
    inputPoints = [[[clickX, clickY]]];
    inputLabels = [[1]];
    seedPoint = { x: clickX, y: clickY };
  }

  // Append manual Add/Remove points (label 1 positive, label 0 negative) so the
  // user can correct SAM's initial selection. Positive points also become
  // component seeds for the refinement layer.
  const positiveSeeds: { x: number; y: number }[] = [];
  if (seedPoint) positiveSeeds.push(seedPoint);
  if (params.points && params.points.length) {
    for (const point of params.points) {
      const px = clamp(Math.round(point.x), 0, rawImage.width - 1);
      const py = clamp(Math.round(point.y), 0, rawImage.height - 1);
      inputPoints[0].push([px, py]);
      inputLabels[0].push(point.label);
      if (point.label === 1) positiveSeeds.push({ x: px, y: py });
    }
  }

  // Final payload printed right before processor(...) is called.
  console.log('[localSam] SAM processor payload =>', {
    mode: params.box ? 'box' : 'point',
    input_points: JSON.stringify(inputPoints),
    input_boxes: boxXYXY ? JSON.stringify([[boxXYXY]]) : null, // [x1,y1,x2,y2]; encoded as corner points for this runtime
    input_labels: JSON.stringify(inputLabels),
    refinePoints: params.points?.length ?? 0,
    selectionBox: params.box ? { x1: params.box.x1, y1: params.box.y1, x2: params.box.x2, y2: params.box.y2 } : null,
  });

  // Positional call (the real fix): image, input_points, input_labels.
  const inputs = await processor(rawImage, inputPoints, inputLabels);
  const outputs = await model(inputs);
  // Must be invoked ON `processor` (not detached) so `this` stays bound —
  // SamProcessor.post_process_masks reads `this.feature_extractor` internally,
  // and calling a detached reference makes `this` undefined.
  const samProcessor = processor as unknown as {
    post_process_masks: (
      predMasks: unknown,
      originalSizes: unknown,
      reshapedInputSizes: unknown
    ) => Promise<unknown>;
  };
  const masks = await samProcessor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes
  );
  const maskTensor = Array.isArray(masks) ? masks[0] : masks;
  const { mask, width, height } = extractBestMask(maskTensor, outputs.iou_scores);

  // Refinement layer: clean up the raw SAM mask before it is turned into
  // overlay/inpaint assets. SAM finds the region; this fixes the boundary.
  const { mask: refinedMask, debug } = refineMask(mask, width, height, {
    box: boxXYXY,
    seeds: positiveSeeds,
  });
  console.log('[localSam] mask refinement =>', debug);

  const result = buildMaskAssets(refinedMask, width, height);
  console.log('[localSam] mask generated:', {
    width: result.width,
    height: result.height,
    areaRatio: Number(result.areaRatio.toFixed(4)),
    bbox: result.bbox,
  });
  return result;
}
