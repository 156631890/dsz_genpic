import {
  CheckCircle2,
  FileText,
  Loader2,
  Send,
  Sparkles,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  uploadProductFields,
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
  const operationIdRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
  const aiFieldEditVersionRef = useRef(0);
  const uploadAttemptRef = useRef(0);
  const uploadControllerRef = useRef<AbortController | null>(null);

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
  const hasTaskError = copyTask.status === "error" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status === "error"
  );
  const taskSummary = useMemo(() => {
    if (workflowLoading) return `生成中：图片 ${completedImageCount}/5`;
    if (hasTaskError) return `生成已结束，部分任务失败：图片 ${completedImageCount}/5`;
    if (copyTask.status === "success" && completedImageCount === 5) return "AI 生成任务成功";
    return `等待生成：图片 ${completedImageCount}/5`;
  }, [completedImageCount, copyTask.status, hasTaskError, workflowLoading]);
  const isReadyToSubmit = copyTask.status === "success" && !workflowLoading && !hasTaskError &&
    PRODUCT_IMAGE_ROLES.every((role) => imageRoles[role].status === "success" &&
      isHttpsUrl(imageRoles[role].imageUrl)) &&
    generatedImages.length === 5 && hasRequiredDszFields(fields);
  const hasTaskActivity = copyTask.status !== "idle" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status !== "idle"
  );
  const pageSummary = uploadStatus !== "idle"
    ? message
    : hasTaskActivity ? taskSummary : message;

  useEffect(() => () => {
    operationIdRef.current += 1;
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    uploadControllerRef.current?.abort();
  }, []);

  function clearUploadResult() {
    uploadAttemptRef.current += 1;
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    setUploadResult(null);
    setUploadStatus("idle");
  }

  function invalidateOperation(clearGenerated = false) {
    operationIdRef.current += 1;
    controllersRef.current.forEach((controller) => controller.abort());
    const hadActiveTasks = controllersRef.current.size > 0;
    controllersRef.current.clear();
    if (hadActiveTasks || clearGenerated) {
      setCopyTask(idleTask);
      setUploadSourceTask(idleTask);
      setImageRoles(initialRoleStates());
    }
  }

  function beginTask(operationId: number): AbortController | null {
    if (operationId !== operationIdRef.current) return null;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }

  function endTask(controller: AbortController) {
    controllersRef.current.delete(controller);
  }

  function isCurrent(operationId: number): boolean {
    return operationId === operationIdRef.current;
  }

  function updateOptionalInput(field: keyof OptionalInputs, value: string) {
    invalidateOperation();
    setOptionalInputs((current) => ({ ...current, [field]: value }));
    clearUploadResult();
  }

  function updateField(field: keyof DszProductFields, value: string | number | boolean) {
    if (field === "product_name" || field === "description") {
      aiFieldEditVersionRef.current += 1;
    } else {
      invalidateOperation();
    }
    clearUploadResult();
    setFields((current) => {
      const next = { ...current, [field]: value };
      if (field === "categories") {
        const category = Number(value);
        next.category = Number.isFinite(category) && category > 0 ? category : 0;
        next.categoryName = "";
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

  function productInput(imageUrls: string[], fieldSnapshot: DszProductFields): ProductInput {
    return {
      sellingPoints: sellingPoints.trim(),
      categoryHint: optionalInputs.categoryHint.trim() || undefined,
      images: sourceFiles.map((file) => file.name),
      imageUrls,
      purchasePriceCny: optionalNumber(optionalInputs.purchasePriceCny),
      packageWeightKg: fieldSnapshot.weight || undefined,
      lengthCm: fieldSnapshot.length || undefined,
      widthCm: fieldSnapshot.width || undefined,
      heightCm: fieldSnapshot.height || undefined
    };
  }

  async function runCopyTask(operationId = operationIdRef.current) {
    const controller = beginTask(operationId);
    if (!controller) return;
    const filesSnapshot = [...sourceFiles];
    const fieldSnapshot = { ...fields };
    const editVersion = aiFieldEditVersionRef.current;
    setCopyTask({ status: "loading", error: "" });
    setUploadSourceTask({ status: "loading", error: "" });
    try {
      const imageUrls = await uploadSourceImages(filesSnapshot, controller.signal);
      if (!isCurrent(operationId)) return;
      setUploadSourceTask({ status: "success", error: "" });
      const copy = await requestProductCopy(productInput(imageUrls, fieldSnapshot), controller.signal);
      if (!isCurrent(operationId)) return;
      if (aiFieldEditVersionRef.current === editVersion) {
        setFields((current) => ({
          ...current,
          product_name: copy.title,
          description: copy.description
        }));
        clearUploadResult();
      }
      setCopyTask({ status: "success", error: "" });
    } catch (error) {
      if (!isCurrent(operationId) || controller.signal.aborted) return;
      const text = errorMessage(error, "商品文案生成失败");
      setUploadSourceTask((current) => current.status === "loading"
        ? { status: "error", error: text }
        : current);
      setCopyTask({ status: "error", error: text });
    } finally {
      endTask(controller);
    }
  }

  async function runImageRole(role: ProductImageRole, operationId = operationIdRef.current) {
    const controller = beginTask(operationId);
    if (!controller) return;
    const filesSnapshot = [...sourceFiles];
    const sellingPointsSnapshot = sellingPoints.trim();
    const productTypeSnapshot = optionalInputs.categoryHint.trim() || sellingPointsSnapshot || "Product";
    setImageRoles((current) => ({
      ...current,
      [role]: { status: "loading", error: "", imageUrl: current[role].imageUrl }
    }));
    try {
      const result = await requestProductImageRole({
        role,
        files: filesSnapshot,
        productType: productTypeSnapshot,
        sellingPoints: sellingPointsSnapshot
      }, controller.signal);
      if (!isCurrent(operationId)) return;
      setImageRoles((current) => ({
        ...current,
        [role]: { status: "success", error: "", imageUrl: result.imageUrl }
      }));
      clearUploadResult();
    } catch (error) {
      if (!isCurrent(operationId) || controller.signal.aborted) return;
      setImageRoles((current) => ({
        ...current,
        [role]: {
          status: "error",
          error: errorMessage(error, "商品图片生成失败"),
          imageUrl: current[role].imageUrl
        }
      }));
    } finally {
      endTask(controller);
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

    invalidateOperation(true);
    const operationId = operationIdRef.current;
    clearUploadResult();
    await Promise.allSettled([
      runCopyTask(operationId),
      ...PRODUCT_IMAGE_ROLES.map((role) => runImageRole(role, operationId))
    ]);
  }

  async function uploadProduct() {
    const fieldsForUpload = { ...fields, images: generatedImages };
    const uploadAttempt = uploadAttemptRef.current + 1;
    uploadAttemptRef.current = uploadAttempt;
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setUploadStatus("loading");
    setMessage("正在提交到 Dropshipzone 后台");
    try {
      const data = await uploadProductFields(fieldsForUpload, controller.signal);
      if (uploadAttempt !== uploadAttemptRef.current) return;
      setUploadResult({ fields: fieldsForUpload, result: data });
      setUploadStatus("success");
      setMessage(isRecord(data) && data.mode === "mock" ? "已生成后台 payload" : "后台上传成功");
    } catch (error) {
      if (uploadAttempt !== uploadAttemptRef.current || controller.signal.aborted) return;
      setUploadStatus("error");
      setMessage(errorMessage(error, "上传失败"));
    } finally {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>商品上传工作台</h1>
          <p>上传原始图和卖点，AI 文案与五张角色图片独立生成，人工校对后提交后台。</p>
        </div>
        <div
          className={`status status-${statusTone(copyTask.status, uploadStatus)}`}
          role="status"
          aria-live="polite"
        >
          {pageSummary}
        </div>
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
              onChange={(event) => {
                invalidateOperation(true);
                setSourceFiles(Array.from(event.target.files || []));
                clearUploadResult();
              }}
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
              onChange={(event) => {
                invalidateOperation(true);
                setSellingPoints(event.target.value);
                clearUploadResult();
              }}
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
          <button onClick={startGeneration}>
            {workflowLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            开始 AI 生成
          </button>
          <div data-testid="copy-task-status">
            文案：{copyTask.status}
            {uploadSourceTask.status === "loading" && "（正在上传源图）"}
            {copyTask.error && <span role="alert">{copyTask.error}</span>}
            {copyTask.status === "error" && (
              <button onClick={() => runCopyTask()} aria-label="重试标题与描述">重试</button>
            )}
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
                  {state.error && <span role="alert">{state.error}</span>}
                  {state.status === "error" && (
                    <button onClick={() => runImageRole(role)} aria-label={`重试图片 ${role}`}>重试</button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="primary-submit"
            onClick={uploadProduct}
            disabled={!isReadyToSubmit || uploadStatus === "loading"}
          >
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hasRequiredDszFields(fields: DszProductFields): boolean {
  return Boolean(
    fields.product_name.trim() &&
    fields.sku.trim() &&
    fields.categories.trim() &&
    fields.ean_code.trim() &&
    fields.brand_name.trim() &&
    fields.description.trim() &&
    fields.status > 0 &&
    fields.stock >= 0 &&
    fields.weight > 0 &&
    fields.length > 0 &&
    fields.width > 0 &&
    fields.height > 0 &&
    fields.cbm > 0 &&
    fields.vendor_price > 0 &&
    fields.rrp > 0
  );
}
