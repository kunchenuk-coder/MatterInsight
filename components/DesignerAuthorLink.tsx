import React from 'react';
import { getDesignerPublicPath, navigateTo } from '../router';
import { defaultDesignerAvatarUrl } from '../utils/profileDisplayName';

interface DesignerAuthorLinkProps {
  designerId: string;
  displayName: string;
  avatarUrl?: string | null;
  className?: string;
}

const DesignerAuthorLink: React.FC<DesignerAuthorLinkProps> = ({
  designerId,
  displayName,
  avatarUrl,
  className = '',
}) => {
  const avatarSrc = avatarUrl?.trim() || defaultDesignerAvatarUrl(designerId);

  return (
    <button
      type="button"
      onClick={() => navigateTo(getDesignerPublicPath(designerId))}
      className={`inline-flex items-center gap-2 text-left group/designer ${className}`}
    >
      <img
        src={avatarSrc}
        alt=""
        className="w-7 h-7 rounded-full object-cover border border-gray-100 shrink-0 group-hover/designer:ring-2 group-hover/designer:ring-black/10 transition-all"
      />
      <span className="text-xs font-bold text-gray-600 group-hover/designer:text-black transition-colors truncate">
        {displayName}
      </span>
    </button>
  );
};

export default DesignerAuthorLink;
