import React, { useId, useRef, useState } from 'react';
import {
  AVATAR_MAX_RAW_BYTES,
  avatarBlobToFile,
  isAcceptedAvatarFile,
  processAvatarImage,
} from '../utils/avatarImageProcessing';
import { uploadImage } from '../services/uploadService';

const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

interface AvatarUploadProps {
  avatarUrl: string | null;
  onAvatarChange: (url: string) => void;
  onToast: (message: string) => void;
  disabled?: boolean;
}

const AvatarUpload: React.FC<AvatarUploadProps> = ({
  avatarUrl,
  onAvatarChange,
  onToast,
  disabled = false,
}) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const displayUrl = previewUrl || avatarUrl;

  const handleFile = async (file: File | undefined) => {
    if (!file || disabled || uploading) return;

    if (!isAcceptedAvatarFile(file)) {
      onToast('仅支持 JPG、PNG、WebP 格式');
      return;
    }
    if (file.size > AVATAR_MAX_RAW_BYTES) {
      onToast('图片文件过大，请上传 5MB 以内的图片');
      return;
    }

    setUploading(true);
    try {
      const blob = await processAvatarImage(file);
      const localPreview = URL.createObjectURL(blob);
      setPreviewUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return localPreview;
      });

      const uploadFile = avatarBlobToFile(blob);
      const { url } = await uploadImage(uploadFile, 'avatars');
      onAvatarChange(url);
      onToast('头像已更新');
    } catch (err) {
      console.error('[AvatarUpload]', err);
      onToast('头像上传失败，请稍后重试');
      setPreviewUrl(null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start gap-4">
      <div className="relative shrink-0">
        <div className="w-24 h-24 md:w-28 md:h-28 rounded-full overflow-hidden border border-gray-100 shadow-sm bg-gray-100">
          {displayUrl ? (
            <img src={displayUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl text-gray-300">
              👤
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-black/45 flex items-center justify-center rounded-full">
              <div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </div>
        {!disabled && !uploading && (
          <label
            htmlFor={inputId}
            className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 hover:bg-black/40 text-transparent hover:text-white text-[10px] font-bold cursor-pointer transition-all"
          >
            更换
          </label>
        )}
      </div>

      <div className="flex-1 min-w-0 pt-1">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="px-4 py-2 rounded-xl bg-gray-100 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {uploading ? '处理中…' : displayUrl ? '更改头像' : '上传头像'}
        </button>
      </div>
    </div>
  );
};

export default AvatarUpload;
