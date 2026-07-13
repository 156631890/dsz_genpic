import {
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
import { buildShippingZoneRates, calculateBillableWeightKg, calculatePackageCbm } from "../shared/shipping";
import {
  requestProductCopy,
  requestProductImageRole,
  requestServiceHealth,
  type ServiceHealth,
  uploadProductFields,
  uploadSourceImages
} from "./productWorkflow";

type Status = "idle" | "loading" | "success" | "error" | "stale";

interface TaskState {
  status: Status;
  error: string;
}

interface ImageRoleState extends TaskState {
  imageUrl: string;
}

type GenerationScope = "copy" | "all";
type EditorTab = "details" | "price" | "shipping" | "images";

interface OptionalInputs {
  categoryHint: string;
  purchasePriceCny: string;
}

const idleTask: TaskState = { status: "idle", error: "" };
const emptyOptionalInputs: OptionalInputs = {
  categoryHint: "",
  purchasePriceCny: ""
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

const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "details", label: "Details" },
  { id: "price", label: "Price" },
  { id: "shipping", label: "Shipping (Incl. GST)" },
  { id: "images", label: "Images" }
];

const imageRoleLabels: Record<ProductImageRole, string> = {
  main: "Main product image",
  side: "Side product image",
  detail: "Product detail image",
  lifestyle_1: "Lifestyle image 1",
  lifestyle_2: "Lifestyle image 2"
};

function initialRoleStates(): Record<ProductImageRole, ImageRoleState> {
  return Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [
    role,
    { status: "idle", error: "", imageUrl: "" }
  ])) as Record<ProductImageRole, ImageRoleState>;
}

function NumericInput({
  value,
  onCommit,
  inputMode = "decimal"
}: {
  value: number;
  onCommit: (value: number) => void;
  inputMode?: "decimal" | "numeric";
}) {
  const [buffer, setBuffer] = useState(String(value));
  const editingRef = useRef(false);
  const committedRef = useRef(value);

  useEffect(() => {
    if (!editingRef.current && value !== committedRef.current) setBuffer(String(value));
    committedRef.current = value;
  }, [value]);

  function commit() {
    editingRef.current = false;
    const parsed = buffer.trim() === "" ? 0 : Number(buffer);
    if (!Number.isFinite(parsed)) {
      setBuffer(String(value));
      return;
    }
    committedRef.current = parsed;
    onCommit(parsed);
  }

  return <input inputMode={inputMode} value={buffer}
    onFocus={() => { editingRef.current = true; }}
    onChange={(event) => setBuffer(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    }} />;
}

function ImageRoleCard({ role, index, state, onRetry, onReplace }: {
  role: ProductImageRole;
  index: number;
  state: ImageRoleState;
  onRetry: (role: ProductImageRole) => void;
  onReplace: (role: ProductImageRole, imageUrl: string) => void;
}) {
  const [replacementUrl, setReplacementUrl] = useState("");
  const [replacementError, setReplacementError] = useState("");
  const replacementDisabled = state.status === "loading";
  const replacementStatusId = `replacement-${role}-status`;

  function applyReplacement() {
    if (replacementDisabled) return;
    const nextUrl = replacementUrl.trim();
    if (!isHttpsUrl(nextUrl)) {
      setReplacementError("请输入绝对 HTTPS URL");
      return;
    }
    setReplacementError("");
    setReplacementUrl("");
    onReplace(role, nextUrl);
  }

  return (
    <article data-testid={`image-role-${role}`} data-role={role} data-status={state.status}
      aria-label={imageRoleLabels[role]} className="image-role-card">
      <div className="image-role-head"><span>0{index + 1}</span><strong>{imageRoleLabels[role]}</strong></div>
      <div className="image-preview">
        {state.imageUrl
          ? <img src={state.imageUrl} alt={`${imageRoleLabels[role]} generated preview`} />
          : <span>{state.status === "loading" ? "Generating preview" : "No image generated"}</span>}
      </div>
      <div className="image-role-foot">
        <span className="state-label">{statusLabel(state.status)}</span>
        {state.error && <span className="inline-error" role="alert">{state.error}</span>}
        {state.status === "error" && (
          <button className="text-button" onClick={() => onRetry(role)}
            aria-label={`重试图片 ${role}`}>Retry role</button>
        )}
        <label className="replacement-field">Replacement URL
          <input aria-label={`Replacement URL for ${role}`} inputMode="url" value={replacementUrl}
            disabled={replacementDisabled} aria-describedby={replacementStatusId}
            onChange={(event) => { setReplacementUrl(event.target.value); setReplacementError(""); }} />
        </label>
        <button className="replacement-button" onClick={applyReplacement}
          disabled={replacementDisabled} aria-describedby={replacementStatusId}
          aria-label={`应用替换 ${role}`}>应用替换</button>
        <span id={replacementStatusId} className="replacement-note">
          {replacementDisabled ? "生成完成后可应用替换 URL" : "仅接受绝对 HTTPS URL"}
        </span>
        {replacementError && <span className="inline-error" role="alert">{replacementError}</span>}
      </div>
    </article>
  );
}

function ImagesPanel({ imageRoles, onRetry, onReplace }: {
  imageRoles: Record<ProductImageRole, ImageRoleState>;
  onRetry: (role: ProductImageRole) => void;
  onReplace: (role: ProductImageRole, imageUrl: string) => void;
}) {
  return (
    <div className="image-role-grid" aria-label="Generated product images">
      {PRODUCT_IMAGE_ROLES.map((role, index) => (
        <ImageRoleCard key={role} role={role} index={index} state={imageRoles[role]}
          onRetry={onRetry} onReplace={onReplace} />
      ))}
    </div>
  );
}

type UpdateField = (field: keyof DszProductFields, value: string | number | boolean) => void;

function TaskStatusCards({
  copyTask,
  uploadSourceTask,
  imageRoles,
  completedImageCount,
  failedImageCount,
  hasTaskError,
  onRetryCopy
}: {
  copyTask: TaskState;
  uploadSourceTask: TaskState;
  imageRoles: Record<ProductImageRole, ImageRoleState>;
  completedImageCount: number;
  failedImageCount: number;
  hasTaskError: boolean;
  onRetryCopy: () => void;
}) {
  const imageStatus = statusTone(...PRODUCT_IMAGE_ROLES.map((role) => imageRoles[role].status));
  return (
    <section className="task-strip" aria-label="AI generation status">
      <article className={`task-card task-${copyTask.status}`} data-testid="copy-task-status"
        data-status={copyTask.status}>
        <div className="task-title"><span>GPT-5.6 SOL</span><strong>Title & description</strong></div>
        <span className="state-label">{statusLabel(copyTask.status)}</span>
        <span className="sr-only">{copyTask.status}</span>
        {uploadSourceTask.status === "loading" && <small>正在上传源图</small>}
        {copyTask.error && <span className="inline-error" role="alert">{copyTask.error}</span>}
        {copyTask.status === "error" && (
          <button className="text-button" onClick={onRetryCopy}
            aria-label="重试标题与描述">重试文案</button>
        )}
      </article>
      <article data-testid="image-task-status" data-status={imageStatus}
        className={`task-card task-${imageStatus}`}>
        <div className="task-title"><span>GPT-Image-2</span><strong>5-role image set</strong></div>
        <span className="state-label">{completedImageCount} / 5 已完成</span>
        {failedImageCount > 0 && <span className="failed-count">{failedImageCount} 个失败</span>}
        <small>{hasTaskError ? "失败角色可单独重试" : "各角色独立生成，可单独重试"}</small>
      </article>
    </section>
  );
}

function DetailsPanel({ fields, onUpdate }: { fields: DszProductFields; onUpdate: UpdateField }) {
  return (
    <div className="field-grid details-grid">
      <label>Category<input value={fields.categories}
        onChange={(event) => onUpdate("categories", event.target.value)} /></label>
      <label data-ai-field="true">Product Name <span className="ai-marker">AI</span>
        <input aria-label="Product Name" value={fields.product_name}
          onChange={(event) => onUpdate("product_name", event.target.value)} /></label>
      <label>SKU<input value={fields.sku}
        onChange={(event) => onUpdate("sku", event.target.value)} /></label>
      <label>Status<select value={fields.status}
        onChange={(event) => onUpdate("status", Number(event.target.value))}>
        <option value={1}>Active</option><option value={0}>Inactive</option>
      </select></label>
      <label>EAN Code<input value={fields.ean_code}
        onChange={(event) => onUpdate("ean_code", event.target.value)} /></label>
      <label>Quantity<NumericInput inputMode="numeric" value={fields.stock}
        onCommit={(value) => onUpdate("stock", value)} /></label>
      <label>Package Weight kg<NumericInput value={fields.weight}
        onCommit={(value) => onUpdate("weight", value)} /></label>
      <label>Length cm<NumericInput value={fields.length}
        onCommit={(value) => onUpdate("length", value)} /></label>
      <label>Width cm<NumericInput value={fields.width}
        onCommit={(value) => onUpdate("width", value)} /></label>
      <label>Height cm<NumericInput value={fields.height}
        onCommit={(value) => onUpdate("height", value)} /></label>
      <label>CBM m3 <span className="automatic-marker">Automatic</span>
        <input aria-label="CBM m3" readOnly value={fields.cbm} /></label>
      <label>Brand Name<input value={fields.brand_name}
        onChange={(event) => onUpdate("brand_name", event.target.value)} /></label>
      <label>Colour<input value={fields.colour}
        onChange={(event) => onUpdate("colour", event.target.value)} /></label>
      <label className="toggle-field">Enable Product <input type="checkbox" checked={fields.enabled}
        onChange={(event) => onUpdate("enabled", event.target.checked)} /></label>
      <label className="description-field" data-ai-field="true">
        Vendor Product Description <span className="ai-marker">AI · HTML</span>
        <textarea aria-label="Vendor Product Description" value={fields.description}
          onChange={(event) => onUpdate("description", event.target.value)} rows={9} />
      </label>
    </div>
  );
}

function PricePanel({ fields, onUpdate }: { fields: DszProductFields; onUpdate: UpdateField }) {
  return (
    <div className="field-grid price-grid">
      <label>Vendor Price<NumericInput value={fields.vendor_price}
        onCommit={(value) => onUpdate("vendor_price", value)} /></label>
      <label>Vendor RRP<NumericInput value={fields.rrp}
        onCommit={(value) => onUpdate("rrp", value)} /></label>
    </div>
  );
}

function ShippingPanel({ billableWeight }: { billableWeight: number }) {
  return <>
    <div className="billable-weight"><span>Current billable weight</span>
      <strong>{billableWeight.toFixed(2)} kg</strong></div>
    <div className="shipping-summary">
      <article><span>Australian zones</span><strong>Free</strong><small>All metro and regional zones</small></article>
      <article><span>New Zealand · Below 3 kg</span><strong>AUD 20</strong><small>Incl. GST</small></article>
      <article><span>New Zealand · 3 kg and above</span><strong>AUD 40</strong><small>Incl. GST</small></article>
    </div>
    <p className="formula-note">Billable weight = max(actual, L × W × H / 5000)</p>
  </>;
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
  const [activeTab, setActiveTab] = useState<EditorTab>("details");
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null);
  const [healthStatus, setHealthStatus] = useState<"loading" | "success" | "error">("loading");
  const copyOperationIdRef = useRef(0);
  const imageOperationIdRef = useRef(0);
  const copyControllersRef = useRef(new Set<AbortController>());
  const imageControllersRef = useRef(new Set<AbortController>());
  const titleEditVersionRef = useRef(0);
  const descriptionEditVersionRef = useRef(0);
  const uploadAttemptRef = useRef(0);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const generatedImages = useMemo(
    () => PRODUCT_IMAGE_ROLES
      .map((role) => imageRoles[role].imageUrl)
      .filter(Boolean),
    [imageRoles]
  );
  const completedImageCount = PRODUCT_IMAGE_ROLES.filter((role) =>
    imageRoles[role].status === "success"
  ).length;
  const failedImageCount = PRODUCT_IMAGE_ROLES.filter((role) =>
    imageRoles[role].status === "error"
  ).length;
  const workflowLoading = copyTask.status === "loading" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status === "loading"
  );
  const hasTaskError = copyTask.status === "error" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status === "error"
  );
  const hasStaleOutput = copyTask.status === "stale" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status === "stale"
  );
  const taskSummary = useMemo(() => {
    if (workflowLoading) return `生成中：图片 ${completedImageCount}/5`;
    if (hasTaskError) return `生成已结束：图片 ${completedImageCount}/5，失败 ${failedImageCount}`;
    if (hasStaleOutput) return `生成内容已过期：图片 ${completedImageCount}/5`;
    if (copyTask.status === "success" && completedImageCount === 5) return "AI 生成任务成功";
    return `等待生成：图片 ${completedImageCount}/5`;
  }, [completedImageCount, copyTask.status, failedImageCount, hasStaleOutput, hasTaskError, workflowLoading]);
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
  const billableWeight = calculateBillableWeightKg({
    actualWeightKg: fields.weight,
    lengthCm: fields.length,
    widthCm: fields.width,
    heightCm: fields.height
  });
  const submitReason = submissionReason(fields, imageRoles, copyTask, workflowLoading, hasTaskError);

  useEffect(() => () => {
    copyOperationIdRef.current += 1;
    imageOperationIdRef.current += 1;
    copyControllersRef.current.forEach((controller) => controller.abort());
    imageControllersRef.current.forEach((controller) => controller.abort());
    copyControllersRef.current.clear();
    imageControllersRef.current.clear();
    uploadAttemptRef.current += 1;
    uploadControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requestServiceHealth(controller.signal).then((health) => {
      if (controller.signal.aborted) return;
      setServiceHealth(health);
      setHealthStatus("success");
    }).catch(() => {
      if (controller.signal.aborted) return;
      setHealthStatus("error");
    });
    return () => controller.abort();
  }, []);

  function clearUploadResult() {
    uploadAttemptRef.current += 1;
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    setUploadResult(null);
    setUploadStatus("idle");
  }

  function invalidateGeneration(scope: GenerationScope) {
    copyOperationIdRef.current += 1;
    copyControllersRef.current.forEach((controller) => controller.abort());
    copyControllersRef.current.clear();
    setCopyTask((current) => current.status === "success" || current.status === "stale"
      ? { status: "stale", error: "" }
      : idleTask);
    setUploadSourceTask(idleTask);
    if (scope === "all") {
      imageOperationIdRef.current += 1;
      imageControllersRef.current.forEach((controller) => controller.abort());
      imageControllersRef.current.clear();
      setImageRoles((current) => Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [
        role,
        { ...current[role], status: current[role].imageUrl ? "stale" : "idle", error: "" }
      ])) as Record<ProductImageRole, ImageRoleState>);
    }
  }

  function beginCopyTask(operationId: number): AbortController | null {
    if (operationId !== copyOperationIdRef.current) return null;
    const controller = new AbortController();
    copyControllersRef.current.add(controller);
    return controller;
  }

  function beginImageTask(operationId: number): AbortController | null {
    if (operationId !== imageOperationIdRef.current) return null;
    const controller = new AbortController();
    imageControllersRef.current.add(controller);
    return controller;
  }

  function updateOptionalInput(field: keyof OptionalInputs, value: string) {
    if (field === "categoryHint") invalidateGeneration("all");
    if (field === "purchasePriceCny") invalidateGeneration("copy");
    setOptionalInputs((current) => ({ ...current, [field]: value }));
    clearUploadResult();
  }

  function updateField(field: keyof DszProductFields, value: string | number | boolean) {
    if (field === "product_name") titleEditVersionRef.current += 1;
    if (field === "description") descriptionEditVersionRef.current += 1;
    if (["weight", "length", "width", "height"].includes(String(field))) {
      invalidateGeneration("copy");
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

  async function runCopyTask(operationId = copyOperationIdRef.current) {
    const controller = beginCopyTask(operationId);
    if (!controller) return;
    const filesSnapshot = [...sourceFiles];
    const fieldSnapshot = { ...fields };
    const titleEditVersion = titleEditVersionRef.current;
    const descriptionEditVersion = descriptionEditVersionRef.current;
    setCopyTask({ status: "loading", error: "" });
    setUploadSourceTask({ status: "loading", error: "" });
    try {
      const imageUrls = await uploadSourceImages(filesSnapshot, controller.signal);
      if (operationId !== copyOperationIdRef.current) return;
      setUploadSourceTask({ status: "success", error: "" });
      const copy = await requestProductCopy(productInput(imageUrls, fieldSnapshot), controller.signal);
      if (operationId !== copyOperationIdRef.current) return;
      const applyTitle = titleEditVersionRef.current === titleEditVersion;
      const applyDescription = descriptionEditVersionRef.current === descriptionEditVersion;
      if (applyTitle || applyDescription) {
        setFields((current) => ({
          ...current,
          ...(applyTitle ? { product_name: copy.title } : {}),
          ...(applyDescription ? { description: copy.description } : {})
        }));
        clearUploadResult();
      }
      setCopyTask(applyTitle || applyDescription
        ? { status: "success", error: "" }
        : { status: "error", error: "生成文案未应用：标题和描述已被手工修改" });
    } catch (error) {
      if (operationId !== copyOperationIdRef.current || controller.signal.aborted) return;
      const text = errorMessage(error, "商品文案生成失败");
      setUploadSourceTask((current) => current.status === "loading"
        ? { status: "error", error: text }
        : current);
      setCopyTask({ status: "error", error: text });
    } finally {
      copyControllersRef.current.delete(controller);
    }
  }

  async function runImageRole(role: ProductImageRole, operationId = imageOperationIdRef.current) {
    const controller = beginImageTask(operationId);
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
      if (operationId !== imageOperationIdRef.current) return;
      setImageRoles((current) => ({
        ...current,
        [role]: { status: "success", error: "", imageUrl: result.imageUrl }
      }));
      clearUploadResult();
    } catch (error) {
      if (operationId !== imageOperationIdRef.current || controller.signal.aborted) return;
      setImageRoles((current) => ({
        ...current,
        [role]: {
          status: "error",
          error: errorMessage(error, "商品图片生成失败"),
          imageUrl: current[role].imageUrl
        }
      }));
    } finally {
      imageControllersRef.current.delete(controller);
    }
  }

  async function runAllImageRoles(operationId: number) {
    await Promise.allSettled(PRODUCT_IMAGE_ROLES.map((role) => runImageRole(role, operationId)));
  }

  function replaceImageRole(role: ProductImageRole, imageUrl: string) {
    setImageRoles((current) => ({
      ...current,
      [role]: { status: "success", error: "", imageUrl }
    }));
    clearUploadResult();
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

    invalidateGeneration("all");
    const copyOperationId = copyOperationIdRef.current;
    const imageOperationId = imageOperationIdRef.current;
    clearUploadResult();
    await Promise.allSettled([
      runCopyTask(copyOperationId),
      runAllImageRoles(imageOperationId)
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
      if (uploadAttempt !== uploadAttemptRef.current || controller.signal.aborted) return;
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
    <>
      <a className="skip-link" href="#main-content">Skip to product editor</a>
      <main className="app-shell" id="main-content" tabIndex={-1}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">DSZ</span>
          <div>
            <h1>DSZ Product Studio</h1>
            <p>商品资料生成与提交流程工作台</p>
          </div>
        </div>
        <div className={`service-context health-${healthStatus}`} aria-label="Service health"
          role="status" aria-live="polite">
          {healthStatus === "loading" && <><span>Service health</span><strong>Checking services</strong></>}
          {healthStatus === "error" && <><span>Service health</span><strong>Service status unavailable</strong></>}
          {healthStatus === "success" && serviceHealth && (
            serviceHealth.textConfigured && serviceHealth.imageConfigured
              ? <><span>AI services configured</span><strong>{serviceHealth.textModel} · {serviceHealth.imageModel}</strong></>
              : <><span>Service setup incomplete</span><strong>
                Text {serviceHealth.textConfigured ? "ready" : "missing"} · Image {serviceHealth.imageConfigured ? "ready" : "missing"}
              </strong></>
          )}
        </div>
      </header>

      <section className="workspace" aria-label="DSZ product workspace">
        <aside className="source-rail" aria-labelledby="source-heading">
          <div className="section-heading">
            <span className="section-index">01</span>
            <div><h2 id="source-heading">Source</h2><p>生成依据</p></div>
          </div>
          <label className="file-picker">
            <span><Upload size={17} aria-hidden="true" /> 原始产品图片</span>
            <input
              aria-label="原始产品图片"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => {
                invalidateGeneration("all");
                setSourceFiles(Array.from(event.target.files || []));
                clearUploadResult();
              }}
            />
            <strong>{sourceFiles.length ? `已选择 ${sourceFiles.length} 张` : "选择 JPG / PNG / WebP"}</strong>
            <small>支持多图，AI 将识别产品主体与细节</small>
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
                invalidateGeneration("all");
                setSellingPoints(event.target.value);
                clearUploadResult();
              }}
              rows={8}
              placeholder="例如：亲肤柔软，高弹不勒，多尺码多配色..."
            />
          </label>
          <div className="source-context">
            <h3>生成校准</h3>
            <label>
              类目提示
              <input value={optionalInputs.categoryHint} onChange={(event) =>
                updateOptionalInput("categoryHint", event.target.value)} />
            </label>
            <label>采购价 CNY<input inputMode="decimal" value={optionalInputs.purchasePriceCny}
              onChange={(event) => updateOptionalInput("purchasePriceCny", event.target.value)} /></label>
          </div>
          <button className="generate-button" onClick={startGeneration}>
            {workflowLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            开始 AI 生成
          </button>
        </aside>

        <section className="editor" aria-labelledby="editor-heading">
          <div className="editor-intro">
            <div><span className="section-index">02</span><h2 id="editor-heading">Product record</h2></div>
            <div className={`status status-${statusTone(copyTask.status, uploadStatus)}`}
              role="status" aria-label="Workflow status" aria-live="polite">{pageSummary}</div>
          </div>

          <TaskStatusCards copyTask={copyTask} uploadSourceTask={uploadSourceTask}
            imageRoles={imageRoles} completedImageCount={completedImageCount}
            failedImageCount={failedImageCount} hasTaskError={hasTaskError}
            onRetryCopy={() => runCopyTask()} />

          <nav className="editor-tabs" role="tablist" aria-label="Product editor sections">
            {editorTabs.map((tab, index) => (
              <button key={tab.id} id={`tab-${tab.id}`} role="tab"
                ref={(node) => { tabRefs.current[index] = node; }}
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onKeyDown={(event) => {
                  let nextIndex: number | undefined;
                  if (event.key === "ArrowRight") nextIndex = (index + 1) % editorTabs.length;
                  if (event.key === "ArrowLeft") nextIndex = (index - 1 + editorTabs.length) % editorTabs.length;
                  if (event.key === "Home") nextIndex = 0;
                  if (event.key === "End") nextIndex = editorTabs.length - 1;
                  if (nextIndex === undefined) return;
                  event.preventDefault();
                  setActiveTab(editorTabs[nextIndex].id);
                  tabRefs.current[nextIndex]?.focus();
                }}
                onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
            ))}
          </nav>

          <div className="tab-stage">
            <section id="panel-details" role="tabpanel" aria-labelledby="tab-details"
              hidden={activeTab !== "details"} className="tab-panel">
              <DetailsPanel fields={fields} onUpdate={updateField} />
            </section>

            <section id="panel-price" role="tabpanel" aria-labelledby="tab-price"
              hidden={activeTab !== "price"} className="tab-panel">
              <PricePanel fields={fields} onUpdate={updateField} />
            </section>

            <section id="panel-shipping" role="tabpanel" aria-labelledby="tab-shipping"
              hidden={activeTab !== "shipping"} className="tab-panel shipping-panel">
              <ShippingPanel billableWeight={billableWeight} />
            </section>

            <section id="panel-images" role="tabpanel" aria-labelledby="tab-images"
              hidden={activeTab !== "images"} className="tab-panel">
              <ImagesPanel imageRoles={imageRoles} onRetry={runImageRole} onReplace={replaceImageRole} />
            </section>
          </div>

          <details className="payload-disclosure">
            <summary>Review generated payload</summary>
            <pre>{JSON.stringify(uploadResult || { fields: { ...fields, images: generatedImages } }, null, 2)}</pre>
          </details>
        </section>
      </section>

      <footer className="submit-bar">
        <div>
          <span className={isReadyToSubmit ? "readiness-dot ready" : "readiness-dot"} aria-hidden="true" />
          <p><strong>{isReadyToSubmit ? "Ready for review" : "Not ready for review"}</strong>
            <span>{isReadyToSubmit ? "All required fields and five roles are complete" : submitReason}</span></p>
        </div>
        <button className="primary-submit" onClick={uploadProduct}
          disabled={!isReadyToSubmit || uploadStatus === "loading"}
          aria-describedby="submit-reason">
          {uploadStatus === "loading" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          验证并提交审核
        </button>
        <span id="submit-reason" className="sr-only">{submitReason}</span>
      </footer>
      </main>
    </>
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
  if (statuses.includes("loading")) return "loading";
  if (statuses.includes("error")) return "error";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("success")) return "success";
  return "idle";
}

function statusLabel(status: Status): string {
  return {
    idle: "Waiting",
    loading: "In progress",
    success: "Complete",
    error: "Needs attention",
    stale: "已过期"
  }[status];
}

function submissionReason(
  fields: DszProductFields,
  imageRoles: Record<ProductImageRole, ImageRoleState>,
  copyTask: TaskState,
  workflowLoading: boolean,
  hasTaskError: boolean
): string {
  if (workflowLoading) return "AI generation is still in progress";
  if (hasTaskError) return "Resolve the failed generation task before submitting";
  if (copyTask.status === "stale" || PRODUCT_IMAGE_ROLES.some((role) => imageRoles[role].status === "stale")) {
    return "Regenerate stale AI content before submitting";
  }
  if (copyTask.status !== "success") return "Generate and review the title and description";
  const completeImages = PRODUCT_IMAGE_ROLES.filter((role) =>
    imageRoles[role].status === "success" && isHttpsUrl(imageRoles[role].imageUrl)
  ).length;
  if (completeImages !== 5) return `Complete all five image roles (${completeImages}/5 ready)`;
  if (!hasRequiredDszFields(fields)) return "Complete the required product, package, and price fields";
  return "Ready to validate and submit";
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
