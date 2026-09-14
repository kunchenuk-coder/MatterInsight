import React from 'react';
import { getSupplierPublicPath, navigateTo } from '../router';
import { defaultDesignerAvatarUrl } from '../utils/profileDisplayName';

interface SupplierAuthorLinkProps {
  supplierId: string;
  displayName: string;
  avatarUrl?: string | null;
  className?: string;
}

const SupplierAuthorLink: React.FC<SupplierAuthorLinkProps> = ({
  supplierId,
  displayName,
  avatarUrl,
  className = '',
}) => {
  const avatarSrc = avatarUrl?.trim() || defaultDesignerAvatarUrl(supplierId);

  return (
    <button
      type="button"
      onClick={() => navigateTo(getSupplierPublicPath(supplierId))}
      className={`inline-flex items-center gap-2 text-left group/supplier ${className}`}
    >
      <img
        src={avatarSrc}
        alt=""
        className="w-7 h-7 rounded-full object-cover border border-gray-100 shrink-0 group-hover/supplier:ring-2 group-hover/supplier:ring-black/10 transition-all"
      />
      {displayName.trim() && (
        <span className="text-xs font-bold text-gray-600 group-hover/supplier:text-black transition-colors truncate">
          {displayName}
        </span>
      )}
    </button>
  );
};

export default SupplierAuthorLink;
