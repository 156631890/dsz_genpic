import {
  CheckCircle2,
  FileText,
  Loader2,
  Send,
  Sparkles,
  Upload
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  PRODUCT_IMAGE_ROLES,
  type DszProductFields,
  type ProductImageRole,
  type ProductInput
} from "../shared/product";
import { buildShippingZoneRates, calculatePackageCbm } from "../shared/shipping";
import {
  requestProductCopy,
  requestProductImageRole,
  uploadSourceImages
} from "./productWorkflow";

type Status = "idle" | "loading" | "success" | "error";

interface TaskState {
  status: Status;
  error: string;
}

interface ImageRoleState extends TaskState {
  imageUrl: string;
}

interface OptionalInputs {
  categoryHint: string;
  purchasePriceCny: string;
  packageWeightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

const idleTask: TaskState = { status: "idle", error: "" };
const emptyOptionalInputs: OptionalInputs = {
  categoryHint: "",
  purchasePriceCny: "",
  packageWeightKg: "",
  lengthCm: "",
  widthCm: "",
  heightCm: ""
};

const initialFields: DszProductFields = {
  category: 0,
  categories: "",
  categoryName: "",
  product_name: "",
  sku: "",
  status: 1,
  ean_code: "",
  stock: 1000,
  weight: 0,
  length: 0,
  width: 0,
  height: 0,
  cbm: 0,
  brand_name: "Elosung",
  colour: "",
  enabled: true,
  description: "",
  vendor_price: 0,
  rrp: 0,
  zone_rates: buildShippingZoneRates({
    actualWeightKg: 0,
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0
  }),
  images: [],
  risk_flags: [],
  review_notes: []
};

const editableTextFields: Array<{ key: keyof DszProductFields; label: string }> = [
  { key: "product_name", label: "标题" },
  { key: "sku", label: "SKU" },
  { key: "categories", label: "Categories" },
  { key: "ean_code", label: "EAN Code" },
  { key: "brand_name", label: "Brand" },
  { key: "colour", label: "Colour" }
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

function initialRoleStates(): Record<ProductImageRole, ImageRoleState> {
  return Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [
    role,
    { status: "idle", error: "", imageUrl: "" }
  ])) as Record<ProductImageRole, ImageRoleState>;
}

export default function App() {
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sellingPoints, setSellingPoints] = useState("");
  const [optionalInputs, setOptionalInputs] = useState(emptyOptionalInputs);
  const [fields, setFields] = useState<DszProductFields>(initialFields);
  const [copyTask, setCopyTask] = useState<TaskState>(idleTask);
  const [uploadSourceTask, setUploadSourceTask] = useState<TaskState>(idleTask);
  const [imageRoles, setImageRoles] = useState(initialRoleStates);
  const [uploadStatus, setUploadStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("等待上传原始产品图片");
  const [uploadResult, setUploadResult] = useState<unknown>(null);

  const generatedImages = useMemo(
    () => PRODUCT_IMAGE_ROLES
      .map((role) => imageRoles[role].imageUrl)
      .filter(Boolean),
    [imageRoles]
  );
  const completedImageCount = PRODUCT_IMAGE_ROLES.filter((role) =>
    imageRoles[role].status === "success" || imageRoles[role].status === "error"
  ).length;
  const workflowLoading = copyTask.status === "loading" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status === "loading"
  );

  function updateOptionalInput(field: keyof OptionalInputs, value: string) {
    setOptionalInputs((current) => ({ ...current, [field]: value }));
  }

  function updateField(field: keyof DszProductFields, value: string | number | boolean) {
    setFields((current) => {
      const next = { ...current, [field]: value };
      if (field === "categories") {
        const category = Number(value);
        next.category = Number.isFinite(category) && category > 0 ? category : current.category;
      }
      if (["weight", "length", "width", "height"].includes(String(field))) {
        next.cbm = calculatePackageCbm(next.length, next.width, next.height);
        next.zone_rates = buildShippingZoneRates({
          actualWeightKg: next.weight,
          lengthCm: next.length,
          widthCm: next.width,
          heightCm: next.height
        });
      }
      return next;
    });
  }

  function productInput(imageUrls: string[]): ProductInput {
    return {
      sellingPoints: sellingPoints.trim(),
      categoryHint: optionalInputs.categoryHint.trim() || undefined,
      images: sourceFiles.map((file) => file.name),
      imageUrls,
      purchasePriceCny: optionalNumber(optionalInputs.purchasePriceCny),
      packageWeightKg: optionalNumber(optionalInputs.packageWeightKg),
      lengthCm: optionalNumber(optionalInputs.lengthCm),
      widthCm: optionalNumber(optionalInputs.widthCm),
      heightCm: optionalNumber(optionalInputs.heightCm)
    };
  }

  async function runCopyTask() {
    setCopyTask({ status: "loading", error: "" });
    setUploadSourceTask({ status: "loading", error: "" });
    try {
      const imageUrls = await uploadSourceImages(sourceFiles);
      setUploadSourceTask({ status: "success", error: "" });
      const copy = await requestProductCopy(productInput(imageUrls));
      setFields((current) => ({
        ...current,
        product_name: copy.title,
        description: copy.description
      }));
      setCopyTask({ status: "success", error: "" });
    } catch (error) {
      const text = errorMessage(error, "商品文案生成失败");
      setUploadSourceTask((current) => current.status === "loading"
        ? { status: "error", error: text }
        : current);
      setCopyTask({ status: "error", error: text });
    }
  }

  async function runImageRole(role: ProductImageRole) {
    setImageRoles((current) => ({
      ...current,
      [role]: { status: "loading", error: "", imageUrl: current[role].imageUrl }
    }));
    try {
      const result = await requestProductImageRole({
        role,
        files: sourceFiles,
        productType: optionalInputs.categoryHint.trim() || sellingPoints.trim() || "Product",
        sellingPoints: sellingPoints.trim()
      });
      setImageRoles((current) => ({
        ...current,
        [role]: { status: "success", error: "", imageUrl: result.imageUrl }
      }));
    } catch (error) {
      setImageRoles((current) => ({
        ...current,
        [role]: {
          status: "error",
          error: errorMessage(error, "商品图片生成失败"),
          imageUrl: current[role].imageUrl
        }
      }));
    }
  }

  async function startGeneration() {
    if (sourceFiles.length === 0) {
      setMessage("请先上传至少一张原始产品图片");
      return;
    }
    if (!sellingPoints.trim()) {
      setMessage("请填写卖点");
      return;
    }

    setMessage("AI 文案和五张角色图片正在独立生成");
    setUploadResult(null);
    await Promise.allSettled([
      runCopyTask(),
      ...PRODUCT_IMAGE_ROLES.map((role) => runImageRole(role))
    ]);
    setMessage("AI 生成任务已完成，请检查各项结果");
  }

  async function uploadProduct() {
    const fieldsForUpload = { ...fields, images: generatedImages };
    setUploadStatus("loading");
    setMessage("正在提交到 Dropshipzone 后台");
    try {
      const response = await fetch("/api/upload-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fieldsForUpload })
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
      setMessage(errorMessage(error, "上传失败"));
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>商品上传工作台</h1>
          <p>上传原始图和卖点，AI 文案与五张角色图片独立生成，人工校对后提交后台。</p>
        </div>
        <div className={`status status-${statusTone(copyTask.status, uploadStatus)}`}>{message}</div>
      </header>

      <section className="workspace" aria-label="商品上传工作区">
        <section className="panel input-panel">
          <div className="panel-heading"><Upload size={18} /><h2>原始信息</h2></div>
          <label className="file-picker">
            <span>原始产品图片</span>
            <input
              aria-label="原始产品图片"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => setSourceFiles(Array.from(event.target.files || []))}
            />
            <strong>{sourceFiles.length ? `已选择 ${sourceFiles.length} 张` : "选择 JPG / PNG / WebP"}</strong>
          </label>
          <div className="selected-files" aria-label="已选图片">
            {sourceFiles.length
              ? sourceFiles.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)
              : <span>未选择图片</span>}
          </div>
          <label>
            卖点
            <textarea
              value={sellingPoints}
              onChange={(event) => setSellingPoints(event.target.value)}
              rows={8}
              placeholder="例如：亲肤柔软，高弹不勒，多尺码多配色..."
            />
          </label>
          <div className="optional-block">
            <h3>可选校准字段</h3>
            <label>
              类目提示
              <input value={optionalInputs.categoryHint} onChange={(event) =>
                updateOptionalInput("categoryHint", event.target.value)} />
            </label>
            <div className="field-grid">
              <label>采购价 CNY<input inputMode="decimal" value={optionalInputs.purchasePriceCny}
                onChange={(event) => updateOptionalInput("purchasePriceCny", event.target.value)} /></label>
              <label>包裹重量 kg<input inputMode="decimal" value={optionalInputs.packageWeightKg}
                onChange={(event) => updateOptionalInput("packageWeightKg", event.target.value)} /></label>
            </div>
            <div className="field-grid three">
              <label>长 cm<input inputMode="decimal" value={optionalInputs.lengthCm}
                onChange={(event) => updateOptionalInput("lengthCm", event.target.value)} /></label>
              <label>宽 cm<input inputMode="decimal" value={optionalInputs.widthCm}
                onChange={(event) => updateOptionalInput("widthCm", event.target.value)} /></label>
              <label>高 cm<input inputMode="decimal" value={optionalInputs.heightCm}
                onChange={(event) => updateOptionalInput("heightCm", event.target.value)} /></label>
            </div>
          </div>
          <button onClick={startGeneration} disabled={workflowLoading}>
            {workflowLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            开始 AI 生成
          </button>
          <div data-testid="copy-task-status">
            文案：{copyTask.status}
            {uploadSourceTask.status === "loading" && "（正在上传源图）"}
            {copyTask.error && <span>{copyTask.error}</span>}
            {copyTask.status === "error" && <button onClick={runCopyTask}>重试</button>}
          </div>
          <div>图片进度 {completedImageCount}/5</div>
        </section>

        <section className="panel fields-panel">
          <div className="panel-heading"><FileText size={18} /><h2>DSZ 生成字段</h2></div>
          <div className="field-grid">
            {editableTextFields.map((item) => (
              <label key={String(item.key)}>{item.label}
                <input value={String(fields[item.key] ?? "")}
                  onChange={(event) => updateField(item.key, event.target.value)} />
              </label>
            ))}
          </div>
          <div className="field-grid">
            {editableNumberFields.map((item) => (
              <label key={String(item.key)}>{item.label}
                <input inputMode="decimal" value={String(fields[item.key] ?? "")}
                  onChange={(event) => updateField(item.key, Number(event.target.value) || 0)} />
              </label>
            ))}
          </div>
          <label>Enabled <input type="checkbox" checked={fields.enabled}
            onChange={(event) => updateField("enabled", event.target.checked)} /></label>
          <label>
            HTML Description
            <textarea value={fields.description}
              onChange={(event) => updateField("description", event.target.value)} rows={9} />
          </label>
        </section>

        <section className="panel preview-panel">
          <div className="panel-heading"><CheckCircle2 size={18} /><h2>上传预览</h2></div>
          <dl className="readiness">
            <div><dt>图片</dt><dd>{generatedImages.length} 张</dd></div>
            <div><dt>SKU</dt><dd>{fields.sku || "待填写"}</dd></div>
            <div><dt>类目</dt><dd>{fields.categories || "待填写"}</dd></div>
            <div><dt>RRP</dt><dd>{fields.rrp || "待填写"}</dd></div>
          </dl>
          <div className="url-list" aria-label="生成图片">
            {PRODUCT_IMAGE_ROLES.map((role) => {
              const state = imageRoles[role];
              return (
                <div key={role} data-testid={`image-role-${role}`}>
                  <strong>{role}</strong>
                  {state.imageUrl && <img src={state.imageUrl} alt={`生成图片 ${role}`} />}
                  {state.status === "loading" && <span>生成中</span>}
                  {state.error && <span>{state.error}</span>}
                  {state.status === "error" && <button onClick={() => runImageRole(role)}>重试</button>}
                </div>
              );
            })}
          </div>
          <button className="primary-submit" onClick={uploadProduct} disabled={uploadStatus === "loading"}>
            {uploadStatus === "loading" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
            上传到后台
          </button>
          <h2 className="preview-title">Payload</h2>
          <pre className="preview-json">{JSON.stringify(uploadResult || {
            fields: { ...fields, images: generatedImages }
          }, null, 2)}</pre>
        </section>
      </section>
    </main>
  );
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() ? parsed : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function statusTone(...statuses: Status[]): Status {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("loading")) return "loading";
  if (statuses.includes("success")) return "success";
  return "idle";
}
