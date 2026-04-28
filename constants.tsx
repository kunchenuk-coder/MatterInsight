
import { Category, Material, MaterialStatus } from './types';

export const CATEGORIES = Object.values(Category);

export const MOCK_MATERIALS: Material[] = [
  {
    id: 'mat_st_01',
    name: '极简云石纹理',
    description: '具有细腻的灰色斜纹，鱼肚白底色，适合大面积铺贴，展现极简主义美学。',
    category: Category.ST,
    brand: 'MARBLE LUX',
    specifications: '600x1200x12mm',
    priceRange: '¥500-800/sqm',
    stock: true,
    leadTime: '15 days',
    fireRating: 'Class A',
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    variants: [
      { id: 'v1', colorCode: '#FFFFFF', imageUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80', name: '珍珠白' },
      { id: 'v2', colorCode: '#F5F5F5', imageUrl: 'https://images.unsplash.com/photo-1600607687940-4e2a09695d51?auto=format&fit=crop&w=800&q=80', name: '浅灰' }
    ],
    projectPhotos: [
      'https://images.unsplash.com/photo-1600607687940-4e2a09695d51?auto=format&fit=crop&w=800&q=80'
    ],
    supplierId: 'supplier_1',
    status: MaterialStatus.PUBLISHED,
    auditLog: [{ date: new Date().toISOString(), action: 'APPROVE', comment: '初始导入', operatorId: 'system' }],
    ratings: { aesthetic: 4.8, durable: 4.5, service: 4.2, cleanliness: 4.0, recommendation: 4.7 },
    pointsNeeded: { sample: 10, board: 20, export: 20 },
    clicks: 120,
    saves: 45,
    savedBy: []
  },
  {
    id: 'mat_ct_01',
    name: '哑光水泥灰瓷砖',
    description: '工业风首选，深灰色调，质感粗犷而不失细腻，防滑耐磨。',
    category: Category.CT,
    brand: 'CERAMIC PRO',
    specifications: '800x800x10mm',
    priceRange: '¥120-200/sqm',
    stock: true,
    leadTime: '7 days',
    fireRating: 'Class A',
    image: 'https://images.unsplash.com/photo-1516455590571-18256e5bb9ff?auto=format&fit=crop&w=800&q=80',
    variants: [
      { id: 'v3', colorCode: '#808080', imageUrl: 'https://images.unsplash.com/photo-1516455590571-18256e5bb9ff?auto=format&fit=crop&w=800&q=80', name: '水泥灰' }
    ],
    projectPhotos: [
      'https://images.unsplash.com/photo-1523413363574-c3c44b359d57?auto=format&fit=crop&w=800&q=80'
    ],
    supplierId: 'supplier_1',
    status: MaterialStatus.PUBLISHED,
    auditLog: [{ date: new Date().toISOString(), action: 'APPROVE', comment: '初始导入', operatorId: 'system' }],
    ratings: { aesthetic: 4.2, durable: 4.9, service: 4.5, cleanliness: 4.8, recommendation: 4.5 },
    pointsNeeded: { sample: 10, board: 20, export: 20 },
    clicks: 85,
    saves: 22,
    savedBy: []
  },
  {
    id: 'mat_wd_01',
    name: '北美黑胡桃木',
    description: '天然木纹，深褐色调，温润如玉，适合高端定制家具及背景墙。',
    category: Category.WD,
    brand: 'WOOD ART',
    specifications: '1800x150x15mm',
    priceRange: '¥1200-1800/sqm',
    stock: false,
    leadTime: '45 days',
    fireRating: 'Class B1',
    image: 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?auto=format&fit=crop&w=800&q=80',
    variants: [
      { id: 'v4', colorCode: '#4b3621', imageUrl: 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?auto=format&fit=crop&w=800&q=80', name: '黑胡桃' }
    ],
    projectPhotos: [],
    supplierId: 'supplier_1',
    status: MaterialStatus.PUBLISHED,
    auditLog: [{ date: new Date().toISOString(), action: 'APPROVE', comment: '初始导入', operatorId: 'system' }],
    ratings: { aesthetic: 5.0, durable: 4.0, service: 4.8, cleanliness: 3.5, recommendation: 4.9 },
    pointsNeeded: { sample: 10, board: 20, export: 20 },
    clicks: 250,
    saves: 68,
    savedBy: []
  },
  {
    id: 'mat_mt_01',
    name: '拉丝不锈钢板',
    description: '金属质感强烈，表面拉丝处理，耐腐蚀易清洁，适合现代简约风格。',
    category: Category.MT,
    brand: 'METAL CRAFT',
    specifications: '1220x2440x1.5mm',
    priceRange: '¥300-450/sqm',
    stock: true,
    leadTime: '10 days',
    fireRating: 'Class A',
    image: 'https://images.unsplash.com/photo-1558444458-5c455962af70?auto=format&fit=crop&w=800&q=80',
    variants: [
      { id: 'v5', colorCode: '#C0C0C0', imageUrl: 'https://images.unsplash.com/photo-1558444458-5c455962af70?auto=format&fit=crop&w=800&q=80', name: '不锈钢' }
    ],
    projectPhotos: [],
    supplierId: 'supplier_1',
    status: MaterialStatus.PUBLISHED,
    auditLog: [{ date: new Date().toISOString(), action: 'APPROVE', comment: '初始导入', operatorId: 'system' }],
    ratings: { aesthetic: 4.5, durable: 5.0, service: 4.3, cleanliness: 4.7, recommendation: 4.6 },
    pointsNeeded: { sample: 10, board: 20, export: 20 },
    clicks: 142,
    saves: 31,
    savedBy: []
  }
];
