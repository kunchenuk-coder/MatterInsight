import React, { useState } from "react";
import { Category, MaterialVariant } from "../types";
import { CATEGORIES } from "../constants";
import MaterialVoiceFillButton from "./MaterialVoiceFillButton";

type PublishFormState = {
  name: string;
  category: Category;
  brand: string;
  specifications: string;
  priceRange: string;
  stock: boolean;
  leadTime: string;
  fireRating: string;
  supplierNotes: string;
  image: string;
  variants: MaterialVariant[];
  projectPhotos: string[];
};

interface PublishMaterialMobilePanelProps {
  formData: PublishFormState;
  setFormData: React.Dispatch<React.SetStateAction<PublishFormState>>;
  isProcessing: boolean;
  uploadProgress: number;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onFileChange: (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "image" | "projectPhotos" | "variants"
  ) => void;
}

const fieldCls =
  "w-full p-3 bg-gray-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-black text-sm";
const labelCls =
  "block text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1";

const PublishMaterialMobilePanel: React.FC<PublishMaterialMobilePanelProps> = ({
  formData,
  setFormData,
  isProcessing,
  uploadProgress,
  onClose,
  onSubmit,
  onFileChange,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white overflow-hidden touch-none">
      <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 shrink-0 border-b border-gray-100">
        <h2 className="text-lg font-black tracking-tight">发布新材料</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-black text-xl p-2 -mr-2"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {isProcessing && (
        <div className="mx-4 mt-2 shrink-0 bg-black/5 px-3 py-2 rounded-xl">
          <span className="text-[9px] font-black uppercase">处理中 {uploadProgress}%</span>
          <div className="w-full bg-gray-200 h-0.5 rounded-full mt-1 overflow-hidden">
            <div
              className="bg-black h-full transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        autoComplete="off"
        className="flex flex-1 flex-col min-h-0 px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-hidden">
          <div>
            <label className={labelCls}>材料名称</label>
            <input
              required
              autoComplete="new-password"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              type="text"
              className={fieldCls}
              placeholder="例如: 意式极简大理石"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>材料分类</label>
              <select
                autoComplete="off"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value as Category })
                }
                className={fieldCls}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>价格区间</label>
              <input
                required
                autoComplete="new-password"
                value={formData.priceRange}
                onChange={(e) => setFormData({ ...formData, priceRange: e.target.value })}
                type="text"
                className={fieldCls}
                placeholder="¥500-800/㎡"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>规格尺寸</label>
            <input
              required
              autoComplete="new-password"
              value={formData.specifications}
              onChange={(e) =>
                setFormData({ ...formData, specifications: e.target.value })
              }
              type="text"
              className={fieldCls}
              placeholder="600×1200×12mm"
            />
          </div>

          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex items-center justify-between py-2 text-[10px] font-black uppercase tracking-widest text-gray-500"
          >
            <span>更多参数（防火 / 周期 / 备注）</span>
            <span>{moreOpen ? "▲" : "▼"}</span>
          </button>
          {moreOpen && (
            <div className="space-y-2 shrink-0">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>防火等级</label>
                  <select
                    autoComplete="off"
                    value={formData.fireRating}
                    onChange={(e) =>
                      setFormData({ ...formData, fireRating: e.target.value })
                    }
                    className={fieldCls}
                  >
                    <option value="Class A">Class A (不燃)</option>
                    <option value="Class B1">Class B1 (难燃)</option>
                    <option value="Class B2">Class B2 (可燃)</option>
                    <option value="Class B3">Class B3 (易燃)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>生产周期</label>
                  <input
                    required
                    autoComplete="off"
                    value={formData.leadTime}
                    onChange={(e) => setFormData({ ...formData, leadTime: e.target.value })}
                    type="text"
                    className={fieldCls}
                    placeholder="15天"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>材料商备注</label>
                <textarea
                  autoComplete="new-password"
                  value={formData.supplierNotes}
                  onChange={(e) =>
                    setFormData({ ...formData, supplierNotes: e.target.value })
                  }
                  className={`${fieldCls} h-16 resize-none`}
                  placeholder="天然石材，纹理唯一…"
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMediaOpen((v) => !v)}
            className="flex items-center justify-between py-2 text-[10px] font-black uppercase tracking-widest text-gray-500"
          >
            <span>
              图片上传
              {(formData.image || formData.variants.length > 0 || formData.projectPhotos.length > 0) &&
                " · 已选"}
            </span>
            <span>{mediaOpen ? "▲" : "▼"}</span>
          </button>
          {mediaOpen && (
            <div className="space-y-2 shrink-0 max-h-[28vh] overflow-y-auto">
              <div>
                <label className={labelCls}>主图 (小样图)</label>
                <div className="relative aspect-[2/1] max-h-24 bg-gray-50 rounded-xl border border-dashed border-gray-200 overflow-hidden">
                  {formData.image ? (
                    <img src={formData.image} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-400 font-bold">
                      点击上传主图
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => onFileChange(e, "image")}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    disabled={isProcessing}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>花色 ({formData.variants.length})</label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {formData.variants.map((v, i) => (
                    <div
                      key={v.id}
                      className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-gray-100"
                    >
                      <img src={v.imageUrl} className="w-full h-full object-cover" alt="" />
                      <button
                        type="button"
                        onClick={() =>
                          setFormData((p) => ({
                            ...p,
                            variants: p.variants.filter((_, idx) => idx !== i),
                          }))
                        }
                        className="absolute top-0.5 right-0.5 bg-black/60 text-white w-4 h-4 rounded-full text-[8px]"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <label className="relative w-14 h-14 shrink-0 rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-lg cursor-pointer">
                    +
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={(e) => onFileChange(e, "variants")}
                      className="absolute inset-0 opacity-0"
                      disabled={isProcessing}
                    />
                  </label>
                </div>
              </div>
              <div>
                <label className={labelCls}>案例图 ({formData.projectPhotos.length}/6)</label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {formData.projectPhotos.map((url, i) => (
                    <div
                      key={i}
                      className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-gray-100"
                    >
                      <img src={url} className="w-full h-full object-cover" alt="" />
                      <button
                        type="button"
                        onClick={() =>
                          setFormData((p) => ({
                            ...p,
                            projectPhotos: p.projectPhotos.filter((_, idx) => idx !== i),
                          }))
                        }
                        className="absolute top-0.5 right-0.5 bg-black/60 text-white w-4 h-4 rounded-full text-[8px]"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {formData.projectPhotos.length < 6 && (
                    <label className="relative w-14 h-14 shrink-0 rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-lg cursor-pointer">
                      +
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={(e) => onFileChange(e, "projectPhotos")}
                        className="absolute inset-0 opacity-0"
                        disabled={isProcessing}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isProcessing}
          className="mt-2 w-full shrink-0 bg-black text-white py-3.5 rounded-2xl font-black text-sm shadow-lg disabled:opacity-50"
        >
          提交并进入审核
        </button>
      </form>

      <MaterialVoiceFillButton
        setFormData={setFormData}
        disabled={isProcessing}
        variant="fab"
      />
    </div>
  );
};

export default PublishMaterialMobilePanel;
