import type { Material, User } from '../types';
import { isSupplierUser } from '../services/inquiryService';

export type MaterialDetailPageMode =
  | 'designer'
  | 'supplier-edit'
  | 'admin-edit'
  | 'viewer'
  | 'public';

export interface MaterialDetailPermissions {
  pageMode: MaterialDetailPageMode;
  /** Supplier/admin managing application cases & LoRA toggles */
  canManageApplicationCases: boolean;
  canUploadApplicationCases: boolean;
  /** Designer +1 bubble tags */
  canInteractMoodTags: boolean;
  canAddCustomMoodTags: boolean;
  /** Supplier official brand tags (max 3) */
  canAddBrandMoodTags: boolean;
  /** Designer draggable evaluation sliders */
  canUseEvaluationSliders: boolean;
  /** Supplier/admin read-only aggregate from designer feedback */
  showAggregateEvaluations: boolean;
  evaluationsReadOnly: boolean;
  canSubmitDesignerStory: boolean;
  canSubmitBrandStory: boolean;
  showManageModeBanner: boolean;
}

export interface ResolveMaterialDetailPermissionsInput {
  user: User | null;
  material: Material;
  isPublicView?: boolean;
  /** URL ?mode=edit or App state */
  editMode?: boolean;
  /** Navigated from supplier dashboard (implies edit for own SKUs) */
  fromSupplierDashboard?: boolean;
}

export function resolveMaterialDetailPermissions(
  input: ResolveMaterialDetailPermissionsInput
): MaterialDetailPermissions {
  const { user, material, isPublicView = false, editMode = false, fromSupplierDashboard = false } =
    input;

  if (isPublicView || !user) {
    return {
      pageMode: isPublicView ? 'public' : 'viewer',
      canManageApplicationCases: false,
      canUploadApplicationCases: false,
      canInteractMoodTags: false,
      canAddCustomMoodTags: false,
      canAddBrandMoodTags: false,
      canUseEvaluationSliders: false,
      showAggregateEvaluations: true,
      evaluationsReadOnly: true,
      canSubmitDesignerStory: false,
      canSubmitBrandStory: false,
      showManageModeBanner: false,
    };
  }

  const isSupplier = isSupplierUser(user);
  const isDesigner = user.role === 'DESIGNER';
  const isAdmin = user.role === 'ADMIN';
  const ownsMaterial = user.id === material.supplierId;

  const supplierManage =
    isSupplier && ownsMaterial && (editMode || fromSupplierDashboard);
  const adminManage = isAdmin && editMode;

  if (supplierManage || adminManage) {
    return {
      pageMode: adminManage && !ownsMaterial ? 'admin-edit' : 'supplier-edit',
      canManageApplicationCases: true,
      canUploadApplicationCases: true,
      canInteractMoodTags: false,
      canAddCustomMoodTags: false,
      canAddBrandMoodTags: isSupplier && ownsMaterial,
      canUseEvaluationSliders: false,
      showAggregateEvaluations: true,
      evaluationsReadOnly: true,
      canSubmitDesignerStory: false,
      canSubmitBrandStory: isSupplier && ownsMaterial,
      showManageModeBanner: true,
    };
  }

  if (isDesigner) {
    return {
      pageMode: 'designer',
      canManageApplicationCases: false,
      canUploadApplicationCases: false,
      canInteractMoodTags: true,
      canAddCustomMoodTags: true,
      canAddBrandMoodTags: false,
      canUseEvaluationSliders: true,
      showAggregateEvaluations: false,
      evaluationsReadOnly: false,
      canSubmitDesignerStory: true,
      canSubmitBrandStory: false,
      showManageModeBanner: false,
    };
  }

  if (isAdmin) {
    return {
      pageMode: 'viewer',
      canManageApplicationCases: false,
      canUploadApplicationCases: false,
      canInteractMoodTags: false,
      canAddCustomMoodTags: false,
      canAddBrandMoodTags: false,
      canUseEvaluationSliders: false,
      showAggregateEvaluations: true,
      evaluationsReadOnly: true,
      canSubmitDesignerStory: false,
      canSubmitBrandStory: false,
      showManageModeBanner: false,
    };
  }

  return {
    pageMode: 'viewer',
    canManageApplicationCases: false,
    canUploadApplicationCases: false,
    canInteractMoodTags: false,
    canAddCustomMoodTags: false,
    canAddBrandMoodTags: false,
    canUseEvaluationSliders: false,
    showAggregateEvaluations: true,
    evaluationsReadOnly: true,
    canSubmitDesignerStory: false,
    canSubmitBrandStory: false,
    showManageModeBanner: false,
  };
}
