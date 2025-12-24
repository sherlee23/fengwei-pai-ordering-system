export interface Product {
  id: number;
  name: string;
  price: number;
  cost_price: number | null; // 订货价/成本价
  shipping_cost: number | null; // 运输成本
  category: string | null;
  emoji: string | null;
  stock_quantity: number | null;
  min_stock_threshold: number | null;
  is_unlimited: boolean;
  is_published: boolean;
  image_url: string | null;
  barcode: string | null;
  description: string | null;
  packs_per_unit: number | null; // 每份包含的小包装数量（例如：3袋/份）
  master_barcode: string | null; // 大包装条形码（扫描1次=完成1份，例如：1大盒=10小盒）
  created_at: string;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface OrderItem {
  product: string;
  price: number;
  quantity: number;
  emoji: string | null;
  is_unlimited: boolean;
  product_id: number;
  cost_price_snapshot: number | null; // 下单时的订货价快照
  shipping_cost_snapshot: number | null; // 下单时的运输成本快照
}

export interface Order {
  id: number;
  order_id: string;
  name: string;
  phone: string;
  delivery_method: 'self-pickup' | 'lalamove';
  address: string | null;
  total_amount: number;
  remarks: string | null;
  payment_method: string;
  payment_proof_url: string | null;
  shipping_payment_proof_url?: string | null;
  status: 'pending' | 'ready for pick up' | 'delivered' | 'completed' | 'cancelled';
  order_items: OrderItem[];
  created_at: string;
  member_id: number | null;
}

export interface Member {
  id: number;
  name: string;
  phone: string;
  member_no: string;
  points: number;
  total_spent: number;
  created_at: string;
}

export interface FeatureFlags {
  members_enabled: boolean;
  points_enabled: boolean;
  spending_tracking_enabled: boolean;
}

export interface ToastState {
  id: number;
  message: string;
  type: 'success' | 'danger' | 'warning';
}

export interface StockTransaction {
  id: number;
  product_id: number;
  transaction_type: 'stock_in' | 'stock_out' | 'order' | 'manual_order' | 'partial_delivery' | 'manual_adjustment' | 'manual_in' | 'manual_out' | 'stock_adjustment' | 'stock_adjustment_reversal' | 'reversal' | 'tasting'; // 入库 | 出库 | 订单出库 | 手动扣库存 | 部分发货 | 手动调整 | 手动入库 | 手动出库 | 库存调整 | 调整回滚 | 撤销操作 | 内部试吃
  quantity: number; // 变动数量（正数=增加，负数=减少）
  previous_stock: number | null; // 操作前库存
  new_stock: number | null; // 操作后库存
  reason: string | null; // 原因说明
  cost_price: number | null; // 入库成本价
  operator: string | null; // 操作人员
  order_id: string | null; // 关联订单号
  notes: string | null; // 备注
  reversal_of: string | null; // 回滚的原交易ID（用于追踪回滚关系）
  created_at: string;
}

// ======================================
// 🔹 采购订单相关接口
// ======================================

// 采购订单主表
export interface PurchaseOrder {
  id: number;
  purchase_order_id: string; // 采购单号，例如：PO-20250117-001
  supplier_name: string; // 供应商名称
  supplier_contact: string | null; // 供应商联系方式
  order_date: string; // 下单日期
  expected_delivery_date: string | null; // 预计到货日期
  actual_delivery_date: string | null; // 实际到货日期
  status: 'pending' | 'partial' | 'completed' | 'cancelled'; // 待收货 | 部分收货 | 已完成 | 已取消
  total_amount: number; // 订单总金额
  notes: string | null; // 备注
  created_by: string | null; // 创建人
  created_at: string;
  updated_at: string;
}

// 采购订单明细表
export interface PurchaseOrderItem {
  id: number;
  purchase_order_id: number; // 关联采购订单ID
  product_id: number; // 关联产品ID
  product_name: string; // 产品名称（快照）
  ordered_quantity: number; // 订购数量
  received_quantity: number; // 已收货数量
  unit_cost: number; // 单价（成本价）
  subtotal: number; // 小计 = ordered_quantity × unit_cost
  is_gift?: boolean; // 是否为供应商赠品（赠品成本为0）
  notes: string | null; // 备注
  created_at: string;
}