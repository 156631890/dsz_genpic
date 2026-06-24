# 澳洲独立站上品自动化 SOP

> 版本：v1.0 | 日期：2026-03-19 | 适用平台：Dropshipzone / 澳洲独立站
> 核心目标：图片 → 标题 + HTML 描述 → 可直接粘贴上架

---

## 第一阶段：输入标准化

### 支持的输入方式
- **产品链接**（任意平台：Amazon / 1688 / 速卖通 / eBay / Temu / 淘宝 / 京东等）
- 产品图片（JPG/PNG/WebP，单张或批量）
- 可选附带：产品类目 / 保留关键词 / 品牌禁词表

### 链接输入格式规范
```
✨ 给我产品链接：

https://www.amazon.com.au/...
https://www.aliexpress.com/...
https://detail.temu.com/...
等任意平台链接
```

### 图片输入格式规范
```
【产品图片】
[粘贴图片]

【产品类目】（可选）
例：Kitchen / Electronics / Beauty / Toys

【保留关键词】（可选）
例：BPA-free, stainless steel, 3L

【品牌禁词】（可选）
例：不要出现 "premium", "luxury", "guaranteed"
```

---

## 第二阶段：AI 生成标准

### 标题生成规则
- 纯英文，电商风格，有吸引力
- 包含核心产品特征（材质 + 尺寸 + 颜色 + 核心功能）
- 不夸大，不乱造品牌/参数/材质
- 不超过 200 字符
- 格式示例：
  ```
  [Product Name] - [Material] [Size/Capacity] - [Color/Type], [Key Feature], [Use Case]
  ```

### HTML 描述结构（Amazon 风格）
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

### 固定页脚（必须拼接在描述最后）

**ACL + Delivery Timeframe 页脚：**
```html
<p><strong>Australia Wide Delivery</strong></p>
<p>Standard delivery: 5-10 business days. Remote areas may require additional time.</p>
<p><strong>Returns Policy</strong></p>
<p>This item is eligible for return within 30 days of delivery if unused and in original packaging. Please contact our customer service team to initiate a return. Proof of purchase is required.</p>
```

### 风险类别自动追加

**锂电池/带电池产品 — 追加：**
```html
<p><strong>Battery Safety Notes</strong></p>
<p>• Keep away from heat, moisture, and direct sunlight.</p>
<p>• Do not puncture, crush, or disassemble the battery.</p>
<p>• Keep out of reach of children and pets.</p>
<p>• Do not aim at eyes or face. Dispose of responsibly per local regulations.</p>
```

**玩具产品 — 追加：**
```html
<p><strong>Child Safety Information</strong></p>
<p>• Suitable for children aged [X] and above.</p>
<p>• Not suitable for children under [X] years due to small parts/choking hazard.</p>
<p>• Adult supervision recommended during use.</p>
<p>• Please ensure the toy meets Australian safety standards (AS/NZS ISO 8124) before use.</p>
<p>• This product is not a toy for children under 3 years old.</p>
```

---

## 第三阶段：批量上品流程

### 货源链路（核心新增）
```
产品链接（任意平台）
    ↓
抓取标题/图片/参数
    ↓
1688 找同款/相似货源
    ↓
输出：1688链接 + 价格 + MOQ + 供应商
    ↓
后续：生成标题 + HTML 描述 + 上架
```

### 批量输出格式
| product_image | title | html_description | category | risk_flag | notes |
|---|---|---|---|---|---|
| img001.jpg | ... | ... | Kitchen | none | ... |
| img002.jpg | ... | ... | Electronics | battery | ... |

---

## 第四阶段：质检规则

### 格式检查清单
- [ ] 无中文标点（，。：；？！）
- [ ] 无特殊符号（★ ☆ ※ ◆ ◇）
- [ ] 无第三方链接（http:// / https://）
- [ ] 无未授权品牌词
- [ ] HTML 标签闭合完整
- [ ] 标题 ≤ 200 字符
- [ ] 页脚已拼接
- [ ] 锂电池/玩具风险标注已追加

### 触发人工复核的条件
- 图片识别置信度 < 80%
- 产品涉及认证要求（TGA / therapeutic claims）
- 含有儿童相关描述但未明确年龄段
- 自动生成内容包含绝对化用词（"best", "only", "never"）

---

## 第五阶段：执行命令模板

### 单品执行
```
给我生成以下产品的标题和描述：

【产品图片】
[粘贴图片]

【产品类目】（可选）
例：Home & Kitchen
```

### 批量执行
```
批量处理以下文件夹的所有图片：
[文件夹路径]

类目统一为：[X]
输出格式：CSV
```

### 每小时产能目标
- 单品：< 5 分钟 / 个（含 AI 生成 + 格式检查）
- 批量：50 个产品 / 小时
- 最低日产能：100 个 SKU

---

## 附：常用风险品类清单

| 品类 | 必须追加 | 备注 |
|------|----------|------|
| 电子产品（带电池） | 电池安全声明 | 锂电池/纽扣电池分类处理 |
| 儿童玩具 (< 14岁) | 年龄建议 + 澳洲安全标准 | AS/NZS 8124 |
| 护肤/化妆品 | 成分安全声明 | 避免医疗功效声明 |
| 食品相关 | 使用说明 + 储存建议 | 不做保健功效声明 |
| 家居装饰 | 材质说明 + 使用注意 | 防火/承重等 |
| 运动户外 | 使用场景 + 安全注意 | 不做医疗功效声明 |

---

*本 SOP 由猫大力自动生成 | 2026-03-19*
