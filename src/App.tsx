import {
  CheckCircle2,
  FileText,
  ImagePlus,
  Loader2,
  Send,
  Sparkles,
  Upload,
  Wand2
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DszProductFields, ProductInput } from "../shared/product";

type Status = "idle" | "loading" | "success" | "error";

interface OptionalInputs {
  categoryHint: string;
  purchasePriceCny: string;
  packageWeightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

const emptyOptionalInputs: OptionalInputs = {
  categoryHint: "",
  purchasePriceCny: "",
  packageWeightKg: "",
  lengthCm: "",
  widthCm: "",
  heightCm: ""
};

const editableTextFields: Array<{
  key: keyof DszProductFields;
  label: string;
  multiline?: boolean;
}> = [
  { key: "product_name", label: "标题" },
  { key: "sku", label: "SKU" },
  { key: "categories", label: "Categories" },
  { key: "ean_code", label: "EAN Code" },
  { key: "brand_name", label: "Brand" },
  { key: "colour", label: "Colour" },
  { key: "description", label: "HTML Description", multiline: true }
];

const editableNumberFields: Array<{ key: keyof DszProductFields; label: string }> = [
  { key: "stock", label: "Stock" },
  { key: "weight", label: "Weight kg" },
  { key: "length", label: "Length cm" },
  { key: "width", label: "Width cm" },
  { key: "height", label: "Height cm" },
  { key: "vendor_price", label: "Vendor Price" },
  { key: "rrp", label: "RRP" }
];

const AMAZON_MAIN_IMAGE_COUNT = 6;

export default function App() {
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sellingPoints, setSellingPoints] = useState("");
  const [optionalInputs, setOptionalInputs] =
    useState<OptionalInputs>(emptyOptionalInputs);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [detailImageUrls, setDetailImageUrls] = useState<string[]>([]);
  const [fields, setFields] = useState<DszProductFields | null>(null);
  const [fieldSource, setFieldSource] = useState<"ai" | "fallback" | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [detailStatus, setDetailStatus] = useState<Status>("idle");
  const [uploadStatus, setUploadStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("等待上传原始产品图片");
  const [uploadResult, setUploadResult] = useState<unknown>(null);

  const allImages = useMemo(
    () => uniqueList([...(fields?.images || imageUrls), ...detailImageUrls]),
    [detailImageUrls, fields?.images, imageUrls]
  );

  function updateOptionalInput(field: keyof OptionalInputs, value: string) {
    setOptionalInputs((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateField(field: keyof DszProductFields, value: string | number) {
    setFields((current) => {
      if (!current) return current;

      if (field === "categories") {
        const category = Number(value);

        return {
          ...current,
          categories: String(value),
          category: Number.isFinite(category) && category > 0 ? category : current.category
        };
      }

      return {
        ...current,
        [field]: value
      };
    });
  }

  async function generateFields() {
    if (sourceFiles.length === 0) {
      setStatus("error");
      setMessage("请先上传至少一张原始产品图片");
      return;
    }

    if (!sellingPoints.trim()) {
      setStatus("error");
      setMessage("请填写卖点");
      return;
    }

    setStatus("loading");
    setDetailStatus("idle");
    setUploadStatus("idle");
    setUploadResult(null);
    setDetailImageUrls([]);
    setMessage("正在上传图片并按规则生成 DSZ 字段");

    try {
      const uploadedUrls = await uploadSourceImages(sourceFiles);
      const generated = await requestGeneratedFields(uploadedUrls);
      const baseFields = generated.fields;

      setImageUrls(uploadedUrls);
      setFieldSource(generated.source);
      setDetailStatus("loading");
      setMessage(`正在调用 Packy 图片 API 生成 ${AMAZON_MAIN_IMAGE_COUNT} 张亚马逊主图`);

      try {
        const mainImageUrls = await requestAmazonMainImages(baseFields);
        const fieldsWithMainImages = {
          ...baseFields,
          images: uniqueList([...mainImageUrls, ...baseFields.images])
        };

        setDetailImageUrls(mainImageUrls);
        setFields(fieldsWithMainImages);
        setDetailStatus("success");
        setStatus("success");
        setMessage(
          generated.source === "fallback"
            ? `已生成备用字段和 ${mainImageUrls.length} 张亚马逊主图，请人工校对`
            : `已生成 DSZ 字段和 ${mainImageUrls.length} 张亚马逊主图`
        );
      } catch (imageError) {
        setFields(baseFields);
        setDetailStatus("error");
        setStatus("success");
        setMessage(
          `字段已生成，但亚马逊主图生成失败：${
            imageError instanceof Error ? imageError.message : "Packy 图片接口失败"
          }`
        );
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "字段生成失败");
    }
  }

  async function uploadSourceImages(files: File[]): Promise<string[]> {
    const form = new FormData();
    files.forEach((file) => form.append("images", file));

    const response = await fetch("/api/upload-images", {
      method: "POST",
      body: form
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "图片上传失败");
    }

    return data.imageUrls;
  }

  async function requestGeneratedFields(uploadedUrls: string[]) {
    const input: ProductInput = {
      sellingPoints: sellingPoints.trim(),
      categoryHint: optionalInputs.categoryHint.trim() || undefined,
      images: sourceFiles.map((file) => file.name),
      imageUrls: uploadedUrls,
      purchasePriceCny: optionalNumber(optionalInputs.purchasePriceCny),
      packageWeightKg: optionalNumber(optionalInputs.packageWeightKg),
      lengthCm: optionalNumber(optionalInputs.lengthCm),
      widthCm: optionalNumber(optionalInputs.widthCm),
      heightCm: optionalNumber(optionalInputs.heightCm)
    };

    const response = await fetch("/api/generate-product-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "DSZ 字段生成失败");
    }

    return data.result as { fields: DszProductFields; source: "ai" | "fallback" };
  }

  async function requestAmazonMainImages(productFields: DszProductFields): Promise<string[]> {
    const form = new FormData();

    sourceFiles.forEach((file) => form.append("images", file));
    form.append("productType", productFields.product_name || "Product");
    form.append("sellingPoints", sellingPoints.trim());
    form.append("count", String(AMAZON_MAIN_IMAGE_COUNT));

    const response = await fetch("/api/generate-main-images", {
      method: "POST",
      body: form
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Packy 亚马逊主图生成失败");
    }

    return data.imageUrls;
  }

  async function generateDetailImage() {
    if (!fields) {
      setDetailStatus("error");
      setMessage("请先生成 DSZ 字段");
      return;
    }

    setDetailStatus("loading");
    setMessage(`正在重新生成 ${AMAZON_MAIN_IMAGE_COUNT} 张亚马逊主图`);

    try {
      const mainImageUrls = await requestAmazonMainImages(fields);

      setDetailImageUrls(mainImageUrls);
      setFields({
        ...fields,
        images: uniqueList([...mainImageUrls, ...fields.images])
      });
      setDetailStatus("success");
      setMessage(`${mainImageUrls.length} 张亚马逊主图已生成，并加入上传图片列表`);
    } catch (error) {
      setDetailStatus("error");
      setMessage(error instanceof Error ? error.message : "Packy 亚马逊主图生成失败");
    }
  }

  async function uploadProduct() {
    if (!fields) {
      setUploadStatus("error");
      setMessage("请先生成 DSZ 字段");
      return;
    }

    setUploadStatus("loading");
    setMessage("正在提交到 Dropshipzone 后台");

    try {
      const response = await fetch("/api/upload-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.errors?.join("；") || data.error || "上传失败");
      }

      setUploadResult(data);
      setUploadStatus("success");
      setMessage(data.mode === "mock" ? "已生成后台 payload" : "后台上传成功");
    } catch (error) {
      setUploadStatus("error");
      setMessage(error instanceof Error ? error.message : "上传失败");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>商品上传工作台</h1>
          <p>上传原始图和卖点，其它字段按 DSZ 规则文件生成，人工校对后提交后台。</p>
        </div>
        <div className={`status status-${statusTone(status, detailStatus, uploadStatus)}`}>
          {message}
        </div>
      </header>

      <section className="workspace" aria-label="商品上传工作区">
        <section className="panel input-panel">
          <div className="panel-heading">
            <Upload size={18} />
            <h2>原始信息</h2>
          </div>

          <label className="file-picker">
            <span>原始产品图片</span>
            <input
              aria-label="原始产品图片"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) =>
                setSourceFiles(Array.from(event.target.files || []))
              }
            />
            <strong>
              {sourceFiles.length > 0
                ? `已选择 ${sourceFiles.length} 张`
                : "选择 JPG / PNG / WebP"}
            </strong>
          </label>

          <div className="selected-files" aria-label="已选图片">
            {sourceFiles.length === 0 ? (
              <span>未选择图片</span>
            ) : (
              sourceFiles.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)
            )}
          </div>

          <label>
            卖点
            <textarea
              value={sellingPoints}
              onChange={(event) => setSellingPoints(event.target.value)}
              rows={8}
              placeholder="例如：95% 精梳棉 + 5% 氨纶，亲肤柔软，高弹不勒，适合欧美身形，多尺码多配色..."
            />
          </label>

          <div className="optional-block">
            <h3>可选校准字段</h3>
            <label>
              类目提示
              <input
                value={optionalInputs.categoryHint}
                onChange={(event) =>
                  updateOptionalInput("categoryHint", event.target.value)
                }
                placeholder="例如 Women's Intimates / Underwear"
              />
            </label>
            <div className="field-grid">
              <label>
                采购价 CNY
                <input
                  inputMode="decimal"
                  value={optionalInputs.purchasePriceCny}
                  onChange={(event) =>
                    updateOptionalInput("purchasePriceCny", event.target.value)
                  }
                />
              </label>
              <label>
                包裹重量 kg
                <input
                  inputMode="decimal"
                  value={optionalInputs.packageWeightKg}
                  onChange={(event) =>
                    updateOptionalInput("packageWeightKg", event.target.value)
                  }
                />
              </label>
            </div>
            <div className="field-grid three">
              <label>
                长 cm
                <input
                  inputMode="decimal"
                  value={optionalInputs.lengthCm}
                  onChange={(event) =>
                    updateOptionalInput("lengthCm", event.target.value)
                  }
                />
              </label>
              <label>
                宽 cm
                <input
                  inputMode="decimal"
                  value={optionalInputs.widthCm}
                  onChange={(event) =>
                    updateOptionalInput("widthCm", event.target.value)
                  }
                />
              </label>
              <label>
                高 cm
                <input
                  inputMode="decimal"
                  value={optionalInputs.heightCm}
                  onChange={(event) =>
                    updateOptionalInput("heightCm", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <button onClick={generateFields} disabled={status === "loading"}>
            {status === "loading" ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            上传图片并生成字段
          </button>
        </section>

        <section className="panel fields-panel">
          <div className="panel-heading">
            <FileText size={18} />
            <h2>DSZ 生成字段</h2>
          </div>

          {fields ? (
            <>
              <div className="source-pill">
                生成来源：{fieldSource === "fallback" ? "本地备用规则" : "Packy AI"}
              </div>

              <div className="field-grid">
                {editableTextFields.slice(0, 6).map((item) => (
                  <label key={String(item.key)}>
                    {item.label}
                    <input
                      value={String(fields[item.key] ?? "")}
                      onChange={(event) => updateField(item.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>

              <div className="field-grid">
                {editableNumberFields.map((item) => (
                  <label key={String(item.key)}>
                    {item.label}
                    <input
                      inputMode="decimal"
                      value={String(fields[item.key] ?? "")}
                      onChange={(event) =>
                        updateField(item.key, Number(event.target.value) || 0)
                      }
                    />
                  </label>
                ))}
              </div>

              <label>
                HTML Description
                <textarea
                  value={fields.description}
                  onChange={(event) =>
                    updateField("description", event.target.value)
                  }
                  rows={9}
                />
              </label>

              <div className="button-row">
                <button
                  className="secondary"
                  onClick={generateDetailImage}
                  disabled={detailStatus === "loading"}
                >
                  {detailStatus === "loading" ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Wand2 size={16} />
                  )}
                  Packy 重新生成亚马逊主图
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <ImagePlus size={22} />
              <p>上传原始产品图片并填写卖点后，这里会生成标题、类目、价格、HTML 详情和后台字段。</p>
            </div>
          )}
        </section>

        <section className="panel preview-panel">
          <div className="panel-heading">
            <CheckCircle2 size={18} />
            <h2>上传预览</h2>
          </div>

          <dl className="readiness">
            <div>
              <dt>图片</dt>
              <dd>{allImages.length} 张</dd>
            </div>
            <div>
              <dt>SKU</dt>
              <dd>{fields?.sku || "待生成"}</dd>
            </div>
            <div>
              <dt>类目</dt>
              <dd>{fields?.categories || "待生成"}</dd>
            </div>
            <div>
              <dt>RRP</dt>
              <dd>{fields ? fields.rrp : "待生成"}</dd>
            </div>
          </dl>

          <div className="url-list" aria-label="上传图片 URL">
            {allImages.length === 0 ? (
              <span>暂无图片 URL</span>
            ) : (
              allImages.map((url) => <span key={url}>{url}</span>)
            )}
          </div>

          <button
            className="primary-submit"
            onClick={uploadProduct}
            disabled={!fields || uploadStatus === "loading"}
          >
            {uploadStatus === "loading" ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            上传到后台
          </button>

          <h2 className="preview-title">Payload</h2>
          <pre className="preview-json">
            {JSON.stringify(uploadResult || { fields }, null, 2)}
          </pre>
        </section>
      </section>
    </main>
  );
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() ? parsed : undefined;
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function statusTone(...statuses: Status[]): Status {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("loading")) return "loading";
  if (statuses.includes("success")) return "success";
  return "idle";
}
