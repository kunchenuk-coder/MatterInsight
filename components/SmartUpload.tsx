import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Trash2, Check, Scissors, Wand2, Plus, Minus, Move, QrCode as QrIcon } from 'lucide-react';
import { detectSwatches, SwatchDetection } from '../services/geminiService';
import { Material, CategoryKey } from '../types';
import imageCompression from 'browser-image-compression';
import { QRCodeSVG } from 'qrcode.react';
import { saveMaterial } from '../services/db';
import BackgroundRemover from './BackgroundRemover';

interface SmartUploadProps {
  onComplete: () => void;
}

const SmartUpload: React.FC<SmartUploadProps> = ({ onComplete }) => {
  const [boardImage, setBoardImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detections, setDetections] = useState<SwatchDetection[]>([]);
  const [croppedImages, setCroppedImages] = useState<{ id: string; url: string; code: string; libraryCode: string; location: string }[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [materialInfo, setMaterialInfo] = useState({
    name: '',
    brand: '',
    category: 'ST' as CategoryKey,
    priceRange: 'MID',
    specs: '',
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const compressedFile = await imageCompression(file, { maxSizeMB: 2, maxWidthOrHeight: 2048 });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        setBoardImage(base64);
        const results = await detectSwatches(base64);
        setDetections(results);
        await performAutoCrop(base64, results);
        setIsProcessing(false);
      };
      reader.readAsDataURL(compressedFile);
    } catch (error) {
      console.error(error);
      setIsProcessing(false);
    }
  };

  const performAutoCrop = async (boardUrl: string, swatches: SwatchDetection[]) => {
    const img = new Image();
    img.src = boardUrl;
    await img.decode();

    const crops = swatches.map((s, idx) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      const [ymin, xmin, ymax, xmax] = s.box_2d;
      const width = (xmax - xmin) * img.width / 1000;
      const height = (ymax - ymin) * img.height / 1000;
      const x = xmin * img.width / 1000;
      const y = ymin * img.height / 1000;

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

      const libCode = `${materialInfo.category}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const loc = `${materialInfo.category}-R${Math.floor(idx / 6) + 1}-C${(idx % 6) + 1}`;

      return {
        id: `swatch-${idx}-${Date.now()}`,
        url: canvas.toDataURL('image/png'),
        code: s.manufacturer_code,
        libraryCode: libCode,
        location: loc
      };
    });

    setCroppedImages(crops);
  };

  const handleSaveAll = async () => {
    for (const crop of croppedImages) {
      const newMaterial: Material = {
        id: crypto.randomUUID(),
        name: materialInfo.name,
        brand: materialInfo.brand,
        category: materialInfo.category,
        priceRange: materialInfo.priceRange,
        specs: materialInfo.specs,
        colors: [crop.code],
        mainImage: crop.url,
        projectPhotos: [],
        likes: 0,
        collections: 0,
        manufacturerCode: crop.code,
        libraryCode: crop.libraryCode,
        warehouseLocation: {
          category: materialInfo.category,
          row: parseInt(crop.location.split('-R')[1].split('-C')[0]),
          col: parseInt(crop.location.split('-C')[1]),
        }
      };
      await saveMaterial(newMaterial);
    }
    alert('批量保存成功！ / Batch saved successfully!');
    onComplete();
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-6 bg-zinc-900 border border-zinc-800 rounded-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black italic uppercase tracking-tight">Smart Batch Upload</h2>
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-full font-bold hover:scale-105 transition-transform"
        >
          <Upload size={18} />
          {boardImage ? "Change Board" : "Upload Board"}
        </button>
        <input type="file" ref={fileInputRef} onChange={handleUpload} className="hidden" accept="image/*" />
      </div>

      {!boardImage ? (
        <div className="aspect-video border-2 border-dashed border-zinc-800 rounded-3xl flex flex-col items-center justify-center text-zinc-500 gap-4">
          <Camera size={48} />
          <p>Upload a material sample board to start AI detection</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
                <div className="space-y-4">
                  <input 
                    placeholder="Material Name" 
                    className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl focus:border-white transition-colors"
                    value={materialInfo.name}
                    onChange={(e) => setMaterialInfo({...materialInfo, name: e.target.value})}
                  />
                  <input 
                    placeholder="Brand" 
                    className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl focus:border-white transition-colors" 
                    value={materialInfo.brand}
                    onChange={(e) => setMaterialInfo({...materialInfo, brand: e.target.value})}
                  />
                </div>
                <div className="space-y-4">
                  <select 
                    className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl focus:border-white transition-colors"
                    value={materialInfo.category}
                    onChange={(e) => setMaterialInfo({...materialInfo, category: e.target.value as CategoryKey})}
                  >
                    <option value="ST">Stone (ST)</option>
                    <option value="WD">Wood (WD)</option>
                    <option value="MT">Metal (MT)</option>
                  </select>
                  <textarea 
                    placeholder="Specifications & Notes" 
                    className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl h-24 focus:border-white transition-colors"
                    value={materialInfo.specs}
                    onChange={(e) => setMaterialInfo({...materialInfo, specs: e.target.value})}
                  />
                </div>
             </div>

             <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {isProcessing ? (
                  Array(8).fill(0).map((_, i) => (
                    <div key={i} className="aspect-square bg-zinc-800/50 animate-pulse rounded-xl" />
                  ))
                ) : (
                  croppedImages.map((crop, idx) => (
                    <div key={crop.id} className="group relative bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-500 transition-all">
                      <img src={crop.url} className="w-full aspect-square object-cover" />
                      
                      <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => setEditingIndex(idx)}
                          className="p-1.5 bg-indigo-600 text-white rounded-full hover:scale-110 transition-transform"
                        >
                          <Wand2 size={12} />
                        </button>
                        <button 
                          onClick={() => setCroppedImages(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 bg-red-500 text-white rounded-full hover:scale-110 transition-transform"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div className="p-3 bg-black/60 backdrop-blur-md absolute bottom-0 inset-x-0">
                        <div className="flex flex-col gap-1 mb-2">
                          <span className="text-[10px] font-bold text-zinc-400">MFG CODE</span>
                          <input 
                            value={crop.code} 
                            onChange={(e) => {
                              const newCrops = [...croppedImages];
                              newCrops[idx].code = e.target.value;
                              setCroppedImages(newCrops);
                            }}
                            className="bg-transparent border-none p-0 text-sm font-black focus:ring-0 text-white"
                          />
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-white/10 text-[9px] font-mono text-zinc-500">
                           <span>{crop.libraryCode}</span>
                           <span className="bg-white/10 px-1 rounded">{crop.location}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
             </div>
          </div>

          {editingIndex !== null && (
            <BackgroundRemover 
              imageUrl={croppedImages[editingIndex].url}
              onCancel={() => setEditingIndex(null)}
              onSave={(newUrl) => {
                const newCrops = [...croppedImages];
                newCrops[editingIndex].url = newUrl;
                setCroppedImages(newCrops);
                setEditingIndex(null);
              }}
            />
          )}

          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6 h-fit sticky top-24">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Check size={18} className="text-green-500" />
              Confirmation
            </h3>
            <div className="space-y-4 text-sm text-zinc-400">
               <div className="flex justify-between">
                 <span>Detected Swatches:</span>
                 <span className="text-white font-bold">{croppedImages.length}</span>
               </div>
               <div className="pt-4 border-t border-zinc-800">
                  <div className="bg-white p-2 rounded-lg w-24 h-24 mx-auto mb-2">
                    <QRCodeSVG value="Sample" size={80} />
                  </div>
                  <p className="text-center font-mono text-[10px]">QR Code + Logo (Auto)</p>
               </div>
            </div>
            
            <button 
              disabled={croppedImages.length === 0 || !materialInfo.name}
              onClick={handleSaveAll}
              className="w-full mt-6 bg-zinc-100 text-black py-4 rounded-2xl font-black uppercase tracking-tighter hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm & Save {croppedImages.length} Items
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartUpload;
