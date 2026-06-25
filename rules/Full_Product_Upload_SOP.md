# 澳洲独立站上品全链路 SOP（完整版）

> 版本：v2.0 | 日期：2026-03-19 | 适用：Dropshipzone / 澳洲独立站
> 制定：猫大力 | 状态：已完成全部规则定义

---

## 一、完整链路总览

```
【选品阶段】
Amazon / Mercado Libre / 任意平台链接
    ↓
【货源阶段】
1688 找同款 → 获取采购价/重量/尺寸/MOQ
    ↓
【生成阶段】
AI 生成：标题 + HTML描述 + 图片URL
    ↓
【上品阶段】
Dropshipzone 后台填写 16 个字段
    ↓
【上线阶段】
人工复核 → 提交 → 出单
```

---

## 二、选品标准（输入规则）

### 选品来源
- Amazon Best Sellers / Movers & Shakers
- Mercado Libre 热销榜
- 任意电商平台链接（速卖通/eBay/Temu/淘宝/京东）

### 选品过滤条件
| 指标 | 要求 | 说明 |
|------|------|------|
| 评分 | ≥ 4.0 / 5.0 | 确保质量稳定 |
| 评论数 | ≥ 1000 | 验证市场接受度 |
| 评论数增长 | 持续上升 | 爆款信号 |
| 毛利率 | ≥ 30% | 确保利润空间 |

### 定价毛利计算
```
毛利率 = (售价 - 1688采购价 - 运费 - 平台费) / 售价 × 100%
毛利率 ≥ 30% 才可上品
```

---

## 三、货源链路（1688 找同款）

### 找货流程
1. 从产品链接提取标题和关键参数
2. 在 1688 搜索同款/相似品
3. 对比 2-3 家供应商
4. 选择最优：价格 × 质量 × MOQ × 发货速度

### 1688 数据提取清单
| 数据项 | 用途 | 必须获取 |
|--------|------|---------|
| 1688 商品链接 | 货源记录 | ✅ |
| 单价（RMB） | 定价公式输入 | ✅ |
| MOQ（起订量） | 判断是否支持一件代发 | ✅ |
| 产品重量（kg） | 计算计费重 | ✅（如无AI搜索补充）|
| 包装尺寸 L×W×H（cm） | 计算体积重/CBM | ✅（如无AI搜索补充）|
| 主图 URL | 产品图片 | ✅ |
| 供应商评分 | 供应商质量评估 | 推荐 |

### 图片规则
- **优先使用：** 1688 商品有英文包装的图片
- **次选：** 原链接产品主图
- **兜底：** AI 搜索海外同款英文图 URL

---

## 四、AI 生成标准

### 标题生成规则
- 纯英文，电商风格
- 格式：`[产品名] - [材质/容量] - [颜色], [核心功能], [使用场景]`
- 不超过 200 字符
- 不含未授权品牌词
- 不含特殊符号

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
```html
<p><strong>Australia Wide Delivery</strong></p>
<p>Standard delivery: 5-10 business days. Remote areas may require additional time.</p>
<p><strong>Returns Policy</strong></p>
<p>This item is eligible for return within 30 days of delivery if unused and in original packaging. Please contact our customer service team to initiate a return. Proof of purchase is required.</p>
```

### 风险声明自动追加
| 品类 | 自动追加内容 |
|------|------------|
| 带电池产品 | 电池安全声明 |
| 儿童玩具 | 年龄建议 + AS/NZS 8124 标准 |
| 护肤/化妆品 | 成分安全声明 |
| 食品相关 | 使用说明 + 储存建议 |

---

## 五、Dropshipzone 16 字段上品规则

### F1. Category（类目）
- **规则：** 根据产品关键词匹配 `Category_Mapping.md` 中的完整类目链
- **匹配顺序：** Sub-subcategory > Subcategory > Category > General Goods (ID=1)
- **参考：** `SOP/Category_Mapping.md`

### F2. Product Name（产品名称）
- **来源：** AI 根据链接内容 + 产品特征生成
- **规则：** 见上方"标题生成规则"

### F3. SKU
- **格式：** `Elosung[10000-19999]`
- **起始：** 10000（每次 +1）
- **存储：** `data/sku-counter.txt`（自动更新）

### F4. Status
- **值：** `ALL`

### F5. EAN Code
- **规则：** AI 自动生成 13 位 EAN-13 代码（带校验位）
- **去重：** 已有 EAN 库查重 `data/ean-used.txt`

### F6. Quantity
- **值：** `1000`

### F7. Package Weight (kg)
- **规则：** 链接提取 → 1688详情提取 → AI搜索补充

### F8. Package L×W×H (cm)
- **规则：** 链接提取 → 1688详情提取 → AI搜索补充

### F9. Package CBM (m³)
- **公式：** `CBM = (L × W × H) / 1,000,000`
- **来源：** F8 的三个值

### F10. Brand Name
- **值：** `Elosung`

### F11. Colour
- **规则：** AI 识别产品实际颜色
- **标准词：** Black / White / Red / Blue / Green / Pink / Purple / Orange / Yellow / Grey / Brown / Beige / Navy / Silver / Gold / Multicolor
- **无色品：** `N/A`

### F12. Enable Product
- **值：** `checked`（默认勾选）

### F13. Vendor Product Description
- **生成：** AI 生成 HTML 描述 + 固定页脚 + 风险声明
- **格式：** Amazon 风格结构

### F14. 产品价格

**Step 1 — 体积重：**
```
体积重 = (L × W × H) / 8000
```

**Step 2 — 计费重：**
```
计费重 = MAX(实际重量, 体积重)
```

**Step 3 — Vendor Price（AUD）：**
```
Vendor Price = (计费重 × 40 + 45 + 1688采购价CNY) / 3.05
```

**Step 4 — Vendor RRP：**
```
Vendor RRP = Vendor Price × 2
```

**Step 5 — Shipping (Incl. GST)：**
| 国家 | 填写 |
|------|------|
| AU | 0 |
| NZ | 10 |
| 其他 | 0 |

**定价示例（汇率 3.05）：**

| 1688采购价 | 尺寸(cm) | 实际重量 | 计费重 | Vendor Price | Vendor RRP |
|-----------|---------|---------|-------|------------|-----------|
| ¥15 | 20×15×10 | 0.3kg | 0.375 | AUD 8.6 | AUD 17.2 |
| ¥25 | 30×20×15 | 0.5kg | 1.125 | AUD 14.1 | AUD 28.2 |
| ¥50 | 40×30×20 | 1.0kg | 2.0 | AUD 29.5 | AUD 59.0 |
| ¥100 | 50×40×30 | 2.0kg | 3.75 | AUD 69.3 | AUD 138.6 |

> ⚠️ 如果计算结果与目标值不符，请确认实际输入的计费重和汇率是否为最新。

### F15. Images
- **数量：** 固定 5 张 Shopify 产品图库 URL
- **图片1链接（主图）：** 产品实际颜色主图 URL
- **图片2链接（侧面）：** 产品侧面/角度/轮廓图 URL
- **图片3链接（尺寸/包装/细节）：** 已确认尺寸、包装或产品细节图 URL
- **图片4链接（场景1）：** 真实相关使用场景图 URL
- **图片5链接（场景2）：** 第二个真实相关使用场景图 URL
- **图片来源：** 1688 > 原链接 > Packy 图生图/AI 搜索海外同款英文图

---

## 六、批量上品流程

### 每日产能目标
| 指标 | 目标 |
|------|------|
| 新增 SKU | ≥ 100 个/天 |
| 每品处理时间 | < 5 分钟 |
| 订单转化率 | ≥ 3% |
| 毛利率 | ≥ 25% |

### 批量处理 SOP
```
1. 收集当日选品链接（10-50个）
2. 批量执行 1688 货源搜索
3. 批量 AI 生成字段数据
4. 输出 CSV（可粘贴格式）
5. 人工抽检（每批抽10%）
6. 提交 Dropshipzone 后台
7. 记录到 product-log.csv
```

### 数据文件管理
| 文件 | 用途 |
|------|------|
| `data/sku-counter.txt` | SKU 自增 |
| `data/ean-used.txt` | EAN 去重 |
| `data/product-log.csv` | 上品记录 |
| `data/1688-price-log.txt` | 货源价格记录 |

---

## 七、质检规则

### 格式检查清单
- [ ] 无中文标点
- [ ] 无特殊符号（★ ☆ ※ ◆）
- [ ] 无第三方链接
- [ ] 无未授权品牌词
- [ ] HTML 标签闭合
- [ ] 标题 ≤ 200 字符
- [ ] 页脚已拼接
- [ ] 风险声明已追加（如适用）
- [ ] EAN 校验位正确
- [ ] SKU 未重复

### 人工复核触发条件
- 毛利率 < 25%
- 图片识别置信度 < 80%
- 涉及 TGA/治疗功效声明
- 儿童产品未标注年龄
- 绝对化用词（"best", "only", "never"）

---

## 八、完整执行命令模板

### 单品上品
```
上品：
https://www.amazon.com.au/...（任意链接）
类目：Kitchen（如指定）
```

### 批量上品
```
批量上品：
[粘贴 10-50 个链接，每行一个]

类目统一为：X（如适用）
输出：CSV
```

### 执行后输出格式
```
✅ SKU: Elosung10001
✅ Category: Electronics > Headphones and Earphones (ID: 6025)
✅ Product Name: Wireless TWS Earbuds - Bluetooth 5.3 - Black, Active Noise Cancelling, Gym & Sports
✅ EAN: 5901234567890
✅ Quantity: 1000
✅ Weight: 0.25kg
✅ Dimensions: 10×8×5cm
✅ CBM: 0.000400
✅ Brand: Elosung
✅ Colour: Black
✅ Vendor Price: AUD 12.5
✅ Vendor RRP: AUD 25.0
✅ Images: [URL1] [URL2] [URL3] [URL4]
✅ Description: [HTML]

1688货源：https://detail.1688.com/...
采购价：¥28
MOQ：2件
```

---

## 九、附录

### 常用类目 ID 速查（Top 20）
| 产品 | Category ID |
|------|------------|
| 蓝牙耳机 | 6025 |
| 游戏手柄 | 6024 |
| 手机壳 | 6028 |
| 车载支架 | 6027 |
| 保温杯 | 12018 |
| 厨房收纳 | 12025 |
| 冰块机 | 1020 |
| 美容仪 | 11008 |
| 儿童玩具 | 4006 |
| 筋膜枪 | 11005 |
| 瑜伽垫 | 15003 |
| 宠物喂食器 | 14003 |
| 男士泳装 | 961 |
| 女士泳装 | 956 |

### 快速参考文档
- 完整类目表：`SOP/Category_Mapping.md`
- 字段规则详情：`SOP/Dropshipzone_Field_Rules.md`
- 产品上传模板：`SOP/Product_Upload_AU.md`

---

*本 SOP 由猫大力制定 | 2026-03-19*
*链路已完整，跑通即可批量上品*
