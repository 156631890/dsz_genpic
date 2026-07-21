# Dropshipzone 自动化上品规则 v1.0

> 版本：v1.0 | 日期：2026-03-19 | 适用：Dropshipzone 后台批量上品
> 核心逻辑：输入产品链接 → AI 全自动填满 16 个字段 → 可直接提交

---

## 字段自动化规则（按 Dropshipzone 后台顺序）

---

### F1. 类别 (Category)

**规则：**
1. 从产品链接抓取标题和类目关键词
2. 匹配 Dropshipzone 类目查找表（见附录A）
3. 如果链接类目不明确，调用 AI 搜索同款商品确定类目
4. 填写格式：`Category ID` + `Category Name`

**类目匹配逻辑：**
```
关键词提取 → 类目关键词库匹配 → 返回 Category ID + 名称
```

**优先级：**
- 用户指定类目 > AI 识别类目 > 默认 "General Goods"

---

### F2. 产品名称 (Product Name)

**规则：**
- 来源：AI 根据链接图片/标题 + 产品特征生成
- 格式：`[Product Name] - [Material] [Size/Capacity] - [Color], [Key Feature], [Use Case]`
- 纯英文，首字母大写
- 不超过 200 字符
- 不含品牌（除非原链接含授权品牌）
- 不含特殊符号

---

### F3. SKU

**规则：**
- 格式：`Elosung[10000-19999]`
- 起始值：10000（已在前次上品记录中递增）
- 每个新品自动 +1
- 记录到本地 SKU 计数器文件

**本地计数器路径：** `data/sku-counter.txt`

---

### F4. 状态 (Status)

**规则：**
- 默认填写：`ALL`
- 无需处理，自动填充

---

### F5. EAN 代码 (EAN Code)

**规则：**
- 自动生成 13 位数字
- 格式校验：`EAN-13` 结构（第 13 位为校验位）
- 生成后查重（已有 EAN 库），如有重复重新生成
- 本地 EAN 去重库：`data/ean-used.txt`

**生成算法：**
```
前缀（12位随机有效数字）+ 校验位（计算得出）
```

---

### F6. 数量 (Quantity)

**规则：**
- 固定值：`1000`
- 无需查找，自动填充

---

### F7. 包装重量 (PACKAGE WEIGHT(kg))

**规则（三步走）：**
1. **优先：** 从产品链接页面提取 weight（kg）
2. **其次：** 从 1688 同款商品详情提取 weight
3. **兜底：** 调用 AI 搜索同款商品，确定实际重量后回填

**搜索提示词：**
```
Find the exact package weight (in kg) for this product:
[Product Name / Title]
Search 1688 or similar products to confirm the weight.
Return only the weight in kg format.
```

---

### F8. 包装尺寸 (PACKAGE LENGTH/WIDTH/HEIGHT(cm))

**规则（三步走）：**
1. **优先：** 从产品链接页面提取 L×W×H（cm）
2. **其次：** 从 1688 同款商品详情提取尺寸
3. **兜底：** 调用 AI 搜索同款商品，确定实际尺寸后回填

**搜索提示词：**
```
Find the exact package dimensions (L×W×H in cm) for this product:
[Product Name / Title]
Search 1688 or similar products to confirm the dimensions.
Return only "L×W×H cm" format.
```

---

### F9. 包装体积 (Package CBM(m3))

**规则：**
- 自动计算：`CBM = (L × W × H) / 1,000,000`
- 保留 6 位小数
- 输入来源：F8 的三个尺寸值

**示例：**
```
L=30cm, W=20cm, H=15cm
CBM = (30 × 20 × 15) / 1,000,000 = 0.000900
```

---

### F10. 品牌名称 (Brand Name)

**规则：**
- 固定值：`Elosung`
- 无需查找，自动填充

---

### F11. 颜色 (Colour)

**规则：**
1. 从产品链接提取颜色信息（图片/标题/描述）
2. AI 识别产品主图的实际颜色
3. 多色产品填写主色，用 `/` 分隔，最多 3 色
4. 无颜色产品填写：`N/A`

**标准颜色词（英文）：**
```
Black / White / Red / Blue / Green / Pink / Purple / Orange / Yellow / Grey / Brown / Beige / Navy / Silver / Gold / Multicolor
```

---

### F12. 启用产品 (Enable Product)

**规则：**
- 默认：`checked`（开关打开）
- 无需处理，自动勾选

---

### F13. 供应商产品描述 (Vendor Product Description)

**规则：**
- 生成方式：AI 根据链接内容 + 1688 同款描述生成
- 格式：HTML，Amazon 风格

**HTML 结构：**
```html
<p><strong>Product Overview</strong></p>
<p>...</p>
<p><strong>Key Features</strong></p>
<ul>
<li>...</li>
<li>...</li>
<li>...</li>
</ul>
<p><strong>Specifications</strong></p>
<ul>
<li>...</li>
</ul>
<p><strong>Package Includes</strong></p>
<ul>
<li>...</li>
</ul>
<p><strong>Notes</strong></p>
<p>...</p>
```

**固定页脚（必须拼接）：**
```html
<p><strong>Australia Wide Delivery</strong></p>
<p>Standard delivery: 5-10 business days. Remote areas may require additional time.</p>
<p><strong>Returns Policy</strong></p>
<p>This item is eligible for return within 30 days of delivery if unused and in original packaging. Please contact our customer service team to initiate a return. Proof of purchase is required.</p>
```

**风险追加规则：**
- 带电池产品 → 追加电池安全声明
- 玩具产品 → 追加儿童安全信息
- 护肤/化妆品 → 追加成分说明

---

### F14. 产品价格（Vendor Price / Vendor RRP / Shipping）

**定价公式（核心逻辑）：**

**Step 1 — 体积重计算：**
```
体积重 = (L × W × H) / 8000
（单位：kg）
```

**Step 2 — 计费重取值：**
```
计费重 = MAX(实际重量, 体积重)
取两者中的较大值
```

**Step 3 — Vendor Price 计算：**
```
Vendor Price = (计费重 × 40 + 45 + 1688采购价) / 3.05
```

**Step 4 — Vendor RRP 计算：**
```
Vendor RRP = Vendor Price × 2
```

**Step 5 — Shipping (Incl. GST)：**
- Shipping rates are calculated by the server, not AI output.
- All Australian zones: AUD 0.
- Billable weight (kg): `MAX(actual weight, length × width × height / 5000)`.
- New Zealand: AUD 20 for 0-1 kg; AUD 40 for over 1-2 kg; AUD 999 for over 2 kg.

---

### F15. 图片 (Images)

**规则（固定 5 张 Shopify 产品图库）：**

**第1张（主图）：** 产品实际颜色图，URL 必须
**第2张（侧面）：** 产品侧面/角度/轮廓图，URL 必须
**第3张（尺寸/包装/细节）：** 已确认尺寸、包装或产品细节图，URL 必须
**第4张（场景1）：** 真实相关使用场景图，URL 必须
**第5张（场景2）：** 第二个真实相关使用场景图，URL 必须

**图片来源优先级：**
1. 1688 商品图（有英文包装优先）
2. 原链接产品图
3. AI 搜索海外同款保存的英文图 URL

**搜索海外图流程：**
```
1688 图片无英文 → 用 AI 搜索同款英文产品图
→ 找到目标图片 URL → 回填至 Images 字段
```

**图片要求：**
- 固定 5 张
- 必须为 URL 格式（https://...）
- 推荐尺寸：1000×1000px 或 1500×1500px
- 第一张：白底主图（实际颜色）
- 第2张：侧面图
- 第3张：尺寸/包装/细节图
- 第4张：场景图1
- 第5张：场景图2

**URL 格式输出：**
```
Image 1: [URL]
Image 2: [URL]
Image 3: [URL]
Image 4: [URL]
（最多10张）
```

---

## 完整自动化流程图

```
用户输入：产品链接（任意平台）
    ↓
Step 1: 抓取标题/图片/类目/参数
    ↓
Step 2: 1688 搜索同款货源
    ├─ 获取：1688链接 / 单价 / MOQ / 供应商
    └─ 获取：重量 / 尺寸（若链接无数据）
    ↓
Step 3: AI 搜索海外同款图片（如需要）
    ↓
Step 4: 生成所有字段数据
    ├─ F1  Category
    ├─ F2  Product Name（AI生成）
    ├─ F3  SKU（自动+1）
    ├─ F4  Status = ALL
    ├─ F5  EAN（13位生成+校验）
    ├─ F6  Quantity = 1000
    ├─ F7  Weight（提取/AI搜索）
    ├─ F8  L×W×H（提取/AI搜索）
    ├─ F9  CBM（自动计算）
    ├─ F10 Brand = Elosung
    ├─ F11 Colour（AI识别）
    ├─ F12 Enable = checked
    ├─ F13 Description（AI生成+页脚+风险声明）
    ├─ F14 Vendor Price / RRP / Shipping（公式计算）
    └─ F15 Images（URL，固定5张）
    ↓
Step 5: 输出结构化数据
    ↓
Step 6: 人工复核 / 批量确认
    ↓
Step 7: 粘贴至 Dropshipzone 后台
```

---

## 定价公式速查表

| 1688采购价 | 假设尺寸(cm) | 假设重量 | Vendor Price | Vendor RRP |
|-----------|------------|---------|-------------|-----------|
| ¥15 | 20×15×10 / 0.3kg | 体积重0.375 > 0.3 | (0.375×40+45+15)/3.05 = AUD 24.59 | AUD 49.18 |
| ¥25 | 30×20×15 / 0.5kg | 体积重1.125 > 0.5 | (1.125×40+45+25)/3.05 = AUD 37.70 | AUD 75.40 |
| ¥50 | 40×30×20 / 1.0kg | 体积重3.0 > 1.0 | (3.0×40+45+50)/3.05 = AUD 70.49 | AUD 140.98 |
| ¥100 | 50×40×30 / 2.0kg | 体积重7.5 > 2.0 | (7.5×40+45+100)/3.05 = AUD 145.90 | AUD 291.80 |

---

## API 字段格式（经 Swagger 与 /new_categories 验证，2026-06-24）

> ⚠️ 以下为 Dropshipzone Supplier API 的实际验证格式，与后台字段名可能不同！

### API 请求格式
- URL: `POST /products`
- Body: `{"products": [...]}`
- Auth: `Authorization: jwt {token}`

### 关键字段格式（已验证）

| 字段名 | 类型 | 示例 | 注意 |
|--------|------|------|------|
| `name` | string | `'Women Cotton Thong Underwear - Stretch Cotton Blend'` | 必填，上传 API 字段名不是 `product_name` |
| `price` | number | `19.74` | 必填，上传 API 字段名不是 `vendor_price` |
| `categories` | **string** | `'947'` | 必须为单个 sub-subcategory ID 字符串，不是数组；不要上传 `category` |
| `ean_code` | **string** | `'4748549810'` | 10位数字字符串，不是13位EAN-13 |
| `sku` | string | `'Elosung60001'` | 仅字母+数字，无下划线 |
| `brand_name` | string | `'Elosung'` | 非 `brand` |
| `rrp` | number | `19.8` | 非 `vendor_rrp` |
| `cbm` | number | `0.00051` | 长×宽×高/1,000,000 |
| `images` | string[] | `['https://...']` | URL数组 |
| `weight` | number | `1.8` | kg |
| `length/width/height` | number | `35/25/15` | cm |
| `stock` | integer | `1000` | 非 `quantity` |
| `description` | string | `'<p>...</p>'` | HTML字符串 |
| `status` | integer | `1` | 1=上线，0=草稿 |

### Shipping Rates
- Shipping rates are calculated by the server, not AI output.
- All Australian zones: AUD 0.
- Billable weight (kg): `MAX(actual weight, length × width × height / 5000)`.
- New Zealand: AUD 20 for 0-1 kg; AUD 40 for over 1-2 kg; AUD 999 for over 2 kg.

### 类目 ID 重要说明
- 上传产品应优先使用 `GET /new_categories` 返回的 ID
- Fashion 旧本地 7000 段 ID 不可直接上传；例如 Women's Intimates 旧 `7032` 必须转换为 `947`
- 现有产品使用的类目 ID（如 1364）可能不在公开列表中
- **解决方案**：从现有产品获取类目ID，或测试不同类目

### EAN 生成规则
- 格式：**10位数字字符串**（不是13位EAN-13）
- 示例：`'4748549810'`
- 去重库：`data/ean-used.txt`

### 定价公式
```
Vendor Price = (MAX(重量, 体积重) × 40 + 45 + 1688采购价CNY) / 3.05
Vendor RRP = Vendor Price × 2
```

### 完整 Python 上传脚本
见：`scripts/upload_real_product.py`

> 完整版见：`SOP/Category_Mapping.md`
> **核心原则：优先匹配 Sub-subcategory（最精确子类），其次 Subcategory，最后 Category**

| 主类目 | 子类目 | 最细类目路径 | Category ID |
|--------|--------|-------------|-------------|
| Electronics | Headphones and Earphones | Electronics / Headphones and Earphones / Wireless Headphones & Earbuds | 6025 |
| Electronics | Gadgets | Electronics / Gadgets | 6024 |
| Electronics | Mobile Accessories | Electronics / Mobile Accessories / Phone Cases & Screen Protectors | 6028 |
| Electronics | Mobile Accessories | Electronics / Mobile Accessories / Car Mounts | 6027 |
| Appliances | Kitchen Appliances | Appliances / Kitchen Appliances / Ice Makers | 1020 |
| Home & Garden | Kitchenware | Home & Garden / Kitchenware / Drinkware | 12018 |
| Home & Garden | Storage | Home & Garden / Storage / Clothing & Wardrobe Storage | 12025 |
| Health & Beauty | Skincare | Health & Beauty / Skincare | 11008 |
| Health & Beauty | Personal Care | Health & Beauty / Personal Care | 11007 |
| Health & Beauty | Massage & Relaxation | Health & Beauty / Massage & Relaxation | 11005 |
| Baby & Kids | Baby & Kid's Toys | Baby & Kids / Baby & Kid's Toys | 4006 |
| Sports & Fitness | Exercise, Gym & Fitness | Sports & Fitness / Exercise, Gym & Fitness | 15003 |
| Pet Care | Cat Supplies | Pet Care / Cat Supplies | 14003 |
| Fashion | Men's Fashion | Fashion / Men's Fashion / Men's Swimwear | 961 |
| Fashion | Women's Fashion | Fashion / Women's Fashion / Women's Swimwear | 956 |
| Commercial | Packaging | Commercial / Packaging / Packaging Tape | 5010 |
| General Goods | — | — | 1 |

---

## 附录B：本地数据文件

| 文件 | 用途 |
|------|------|
| `data/sku-counter.txt` | SKU 自增计数器 |
| `data/ean-used.txt` | 已使用 EAN 去重库 |
| `data/1688-price-log.txt` | 1688 货源价格记录 |
| `data/product-log.csv` | 上品记录（含链接/SKU/日期） |

---

*本规则由猫大力制定 | 2026-03-19*
*每次上品后自动更新 SKU 和 EAN 计数器*
