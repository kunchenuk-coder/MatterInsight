import React, { useRef, useEffect, useState } from 'react';
import { Plus, Minus, Check, X, Wand2 } from 'lucide-react';

interface BackgroundRemoverProps {
  imageUrl: string;
  onSave: (maskedImageUrl: string) => void;
  onCancel: () => void;
}

const BackgroundRemover: React.FC<BackgroundRemoverProps> = ({ imageUrl, onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [brushMode, setBrushMode] = useState<'add' | 'sub'>('add');
  const [brushSize, setBrushSize] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [imgObj, setImgObj] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      setImgObj(img);
      if (canvasRef.current && maskCanvasRef.current) {
        const canv = canvasRef.current;
        const mCanv = maskCanvasRef.current;
        canv.width = img.width;
        canv.height = img.height;
        mCanv.width = img.width;
        mCanv.height = img.height;
        const mctx = mCanv.getContext('2d')!;
        mctx.fillStyle = 'white';
        mctx.fillRect(0, 0, mCanv.width, mCanv.height);
        draw();
      }
    };
  }, [imageUrl]);

  const draw = () => {
    if (!canvasRef.current || !maskCanvasRef.current || !imgObj) return;
    const ctx = canvasRef.current.getContext('2d')!;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(imgObj, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvasRef.current, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canv = canvasRef.current!;
    const rect = canv.getBoundingClientRect();
    const scaleX = canv.width / rect.width;
    const scaleY = canv.height / rect.height;
    if ('touches' in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    } else {
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => { setIsDrawing(true); handleMove(e); };
  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !maskCanvasRef.current) return;
    const { x, y } = getPos(e);
    const mctx = maskCanvasRef.current.getContext('2d')!;
    mctx.beginPath();
    mctx.arc(x, y, brushSize, 0, Math.PI * 2);
    mctx.fillStyle = brushMode === 'add' ? 'white' : 'black';
    mctx.fill();
    draw();
  };
  const handleEnd = () => setIsDrawing(false);

  const handleAutoCutout = () => {
    if (!maskCanvasRef.current || !imgObj) return;
    const mctx = maskCanvasRef.current.getContext('2d')!;
    mctx.fillStyle = 'black';
    mctx.fillRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
    mctx.fillStyle = 'white';
    mctx.fillRect(imgObj.width * 0.1, imgObj.height * 0.1, imgObj.width * 0.8, imgObj.height * 0.8);
    draw();
  };

  const handleSave = () => { if (canvasRef.current) onSave(canvasRef.current.toDataURL('image/png')); };

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-2xl flex flex-col p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-4 items-center">
          <button onClick={onCancel} className="p-2 hover:bg-zinc-800 rounded-full transition-colors"><X size={24} /></button>
          <h2 className="text-xl font-bold tracking-tighter uppercase italic">AI Background Remover</h2>
        </div>
        <div className="flex gap-4">
          <button onClick={handleAutoCutout} className="bg-indigo-600 px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2"><Wand2 size={16} /> AI</button>
          <button onClick={handleSave} className="bg-white text-black px-6 py-2 rounded-full font-bold">Done</button>
        </div>
      </div>
      <div className="flex-1 flex flex-col md:flex-row gap-8 overflow-hidden">
        <div className="flex-1 bg-zinc-900 rounded-3xl border border-zinc-800 relative flex items-center justify-center p-4 overflow-hidden">
          <div className="relative touch-none cursor-crosshair">
            <canvas ref={canvasRef} onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd} onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd} className="max-w-full max-h-[70vh] shadow-2xl rounded-lg" />
            <canvas ref={maskCanvasRef} className="hidden" />
          </div>
        </div>
        <div className="w-full md:w-64 space-y-6">
           <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl space-y-4">
             <div className="flex gap-2">
               <button onClick={() => setBrushMode('add')} className={`flex-1 p-3 rounded-xl border ${brushMode === 'add' ? 'bg-white text-black' : 'text-zinc-500 border-zinc-800'}`}><Plus size={20} className="mx-auto" /></button>
               <button onClick={() => setBrushMode('sub')} className={`flex-1 p-3 rounded-xl border ${brushMode === 'sub' ? 'bg-white text-black' : 'text-zinc-500 border-zinc-800'}`}><Minus size={20} className="mx-auto" /></button>
             </div>
             <input type="range" min="5" max="100" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full accent-white" />
           </div>
        </div>
      </div>
    </div>
  );
};

export default BackgroundRemover;
