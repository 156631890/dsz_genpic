import {
  BarChart3,
  CloudDownload,
  ExternalLink,
  FolderOpen,
  History,
  Loader2,
  RotateCcw,
  Send,
  Square,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRODUCT_IMAGE_ROLES,
  type AmazonMarketAnalysis,
  type AmazonMarketAnalysisInput,
  type DszProductFields,
  type NewtonImportedProduct,
  type ProductImageRole,
  type ProductIdentity,
  type ProductInput,
  type ProductResearchEvidence
} from "../shared/product";
import { buildShippingZoneRates, calculateBillableWeightKg, calculatePackageCbm } from "../shared/shipping";
import { calculateVendorPrice, calculateVendorRrp } from "../shared/pricing";
import {
  downloadNewtonProductImages,
  requestAmazonMarketAnalysis,
  requestNewtonProductImport,
  requestProductFields,
  requestProductImageRole,
  requestServiceHealth,
  type ServiceHealth,
  uploadProductFields
} from "./productWorkflow";
import { reserveEanCode, reserveProductIdentity } from "./productIdentity";
import {
  canOptimizeSourceImages,
  prepareSourceImages
} from "./imageProcessing";
import {
  groupProductFolderFiles,
  MAX_SOURCE_IMAGE_BATCH_BYTES,
  MAX_SOURCE_IMAGES
} from "./batchImport";
import {
  deleteProductWorkspace,
  findDuplicateUpload,
  loadProductSourceFiles,
  loadProductStudioState,
  loadProductWorkspace,
  loadUploadHistory,
  saveProductSourceFiles,
  saveProductStudioState,
  saveProductWorkspace,
  saveUploadHistory,
  type EditorTab,
  type ImageRoleState,
  type OptionalInputs,
  type ProductJobDefinition,
  type ProductWorkspaceSnapshot,
  type Status,
  type TaskState,
  type UploadHistoryEntry
} from "./workspaceStorage";

type GenerationScope = "copy" | "all";

interface ProductJobSummary {
  phase: Status;
  completedImages: number;
  failedImages: number;
  ready: boolean;
  submitted: boolean;
  sku: string;
  eanCode: string;
}

interface ImageTaskScheduler {
  schedule<T>(task: () => Promise<T>): Promise<T>;
}

interface ProductWorkspaceProps {
  jobId: string;
  jobName?: string;
  domIdPrefix: string;
  imageScheduler: ImageTaskScheduler;
  initialSourceFiles?: File[];
  onSummaryChange: (jobId: string, summary: ProductJobSummary) => void;
  onImportConsumed: (jobId: string) => void;
  onUploadSuccess: (entry: UploadHistoryEntry) => void;
  findDuplicate: (jobId: string, sku: string, eanCode: string) => string | null;
}

const idleTask: TaskState = { status: "idle", error: "" };
const IMAGE_ROLE_CONCURRENCY = 3;
const MAX_PRODUCT_JOBS = 10;
const initialJobSummary: ProductJobSummary = {
  phase: "idle",
  completedImages: 0,
  failedImages: 0,
  ready: false,
  submitted: false,
  sku: "",
  eanCode: ""
};
const OPERATOR_PACKAGE_FIELDS = new Set<keyof DszProductFields>([
  "weight",
  "length",
  "width",
  "height"
]);
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
  inputMode = "decimal",
  ariaLabel,
  required = false,
  ariaInvalid = false
}: {
  value: number;
  onCommit: (value: number) => void;
  inputMode?: "decimal" | "numeric";
  ariaLabel?: string;
  required?: boolean;
  ariaInvalid?: boolean;
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

  return <input inputMode={inputMode} value={buffer} aria-label={ariaLabel}
    aria-required={required || undefined}
    aria-invalid={ariaInvalid || undefined}
    onFocus={() => { editingRef.current = true; }}
    onChange={(event) => setBuffer(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    }} />;
}

function ImageRoleCard({ role, index, state, idPrefix, onRetry, onReplace }: {
  role: ProductImageRole;
  index: number;
  state: ImageRoleState;
  idPrefix: string;
  onRetry: (role: ProductImageRole) => void;
  onReplace: (role: ProductImageRole, imageUrl: string) => void;
}) {
  const [replacementUrl, setReplacementUrl] = useState("");
  const [replacementError, setReplacementError] = useState("");
  const replacementDisabled = state.status === "loading";
  const replacementStatusId = `${idPrefix}replacement-${role}-status`;

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

function ImagesPanel({ imageRoles, idPrefix, onRetry, onReplace }: {
  imageRoles: Record<ProductImageRole, ImageRoleState>;
  idPrefix: string;
  onRetry: (role: ProductImageRole) => void;
  onReplace: (role: ProductImageRole, imageUrl: string) => void;
}) {
  return (
    <div className="image-role-grid" aria-label="Generated product images">
      {PRODUCT_IMAGE_ROLES.map((role, index) => (
        <ImageRoleCard key={role} role={role} index={index} state={imageRoles[role]}
          idPrefix={idPrefix} onRetry={onRetry} onReplace={onReplace} />
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
        <div className="task-title"><span>GPT-5.6 SOL</span><strong>Complete product data & copy</strong></div>
        <span className="state-label">{statusLabel(copyTask.status)}</span>
        <span className="sr-only">{copyTask.status}</span>
        {uploadSourceTask.status === "loading" && <small>正在优化源图</small>}
        {copyTask.error && <span className="inline-error" role="alert">{copyTask.error}</span>}
        {copyTask.status === "error" && (
          <button className="text-button" onClick={onRetryCopy}
            aria-label="重试完整商品资料">重试完整商品资料</button>
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

function MarketAnalysisPanel({
  analysis,
  task,
  canAnalyze,
  idPrefix,
  onRetry
}: {
  analysis: AmazonMarketAnalysis | null;
  task: TaskState;
  canAnalyze: boolean;
  idPrefix: string;
  onRetry: () => void;
}) {
  const verdict = analysis ? marketVerdictLabel(analysis.pricePosition) : "等待商品资料";
  return (
    <section className={`market-analysis market-${task.status}`}
      aria-labelledby={`${idPrefix}amazon-market-heading`} data-testid="amazon-market-analysis">
      <div className="market-analysis-head">
        <div>
          <span className="market-source"><BarChart3 size={14} aria-hidden="true" /> ProBoost · Amazon.com.au</span>
          <h3 id={`${idPrefix}amazon-market-heading`}>澳洲市场与价格分析</h3>
        </div>
        <div className="market-actions">
          <span className={`market-verdict verdict-${analysis?.pricePosition || "unavailable"}`}>{verdict}</span>
          <button type="button" className="secondary-action" onClick={onRetry}
            disabled={!canAnalyze || task.status === "loading"}>
            {task.status === "loading" ? <Loader2 className="spin" size={13} /> : <RotateCcw size={13} />}
            {analysis ? "重新分析" : "开始分析"}
          </button>
        </div>
      </div>

      {task.status === "idle" && !analysis && (
        <p className="market-empty">商品资料生成完成后会自动查询 Amazon Australia 竞品。</p>
      )}
      {task.status === "loading" && (
        <p className="market-empty" role="status">正在匹配澳洲竞品并计算价格优势…</p>
      )}
      {task.error && <p className="inline-error" role="alert">{task.error}</p>}
      {task.status === "stale" && analysis && (
        <p className="market-stale">商品名称、类目或价格已修改，请重新分析。</p>
      )}

      {analysis && (
        <>
          <div className="market-context">
            <span>搜索词：<strong>{analysis.query}</strong></span>
            <span>匹配置信度：<strong>{marketConfidenceLabel(analysis.confidence)}</strong></span>
            {analysis.snapshotDate && <span>数据日期：<strong>{analysis.snapshotDate}</strong></span>}
          </div>
          {analysis.competitorCount > 0 ? (
            <>
              <div className="market-metrics">
                <article><span>当前 RRP</span><strong>{formatAud(analysis.currentRrpAud)}</strong></article>
                <article><span>竞品中位价</span><strong>{formatNullableAud(analysis.priceMedianAud)}</strong></article>
                <article><span>价格优势</span><strong>{formatAdvantage(analysis.priceAdvantagePercent)}</strong></article>
                <article><span>建议 RRP</span><strong>{formatAudRange(
                  analysis.suggestedRrpMinimumAud,
                  analysis.suggestedRrpMaximumAud
                )}</strong></article>
                <article><span>竞品价格范围</span><strong>{formatAudRange(
                  analysis.priceMinimumAud,
                  analysis.priceMaximumAud
                )}</strong></article>
                <article><span>样本近 30 天销量</span><strong>{analysis.sampledMonthlySales.toLocaleString("en-AU")}</strong></article>
              </div>

              {analysis.priceBands.length > 0 && (
                <div className="market-price-bands">
                  <h4>类目价格带（按销量占比）</h4>
                  {analysis.priceBands.map((band) => (
                    <div className="price-band-row" key={band.label}>
                      <span>A${band.label}</span>
                      <div><i style={{ width: `${Math.min(100, band.salesShare)}%` }} /></div>
                      <strong>{band.salesShare.toFixed(1)}%</strong>
                    </div>
                  ))}
                </div>
              )}

              <div className="market-competitors">
                <h4>相似竞品 ({analysis.competitorCount})</h4>
                <div className="competitor-table" role="table" aria-label="Amazon Australia competitors">
                  {analysis.competitors.map((competitor) => (
                    <a key={competitor.asin} href={competitor.url} target="_blank" rel="noreferrer"
                      className="competitor-row" role="row">
                      {competitor.imageUrl
                        ? <img src={competitor.imageUrl} alt="" loading="lazy" />
                        : <span className="competitor-image-placeholder" />}
                      <span className="competitor-title">{competitor.title}<small>{competitor.asin}</small></span>
                      <strong>{formatAud(competitor.priceAud)}</strong>
                      <span>{competitor.monthlySales === null ? "—" : `${competitor.monthlySales}/月`}</span>
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="market-empty">没有找到足够相似的 Amazon Australia 商品，当前不判断价格优势。</p>
          )}
          <ul className="market-notes">
            {analysis.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}

function DetailsPanel({ fields, onUpdate }: { fields: DszProductFields; onUpdate: UpdateField }) {
  return (
    <div className="field-grid details-grid">
      <label>Category <span className="field-origin">GPT-assisted</span><input aria-label="Category" value={fields.categories}
        onChange={(event) => onUpdate("categories", event.target.value)} /></label>
      <label data-ai-field="true">Product Name <span className="ai-marker">AI</span>
        <input aria-label="Product Name" value={fields.product_name}
          onChange={(event) => onUpdate("product_name", event.target.value)} /></label>
      <label>SKU <span className="field-origin">Browser-reserved</span><input aria-label="SKU" value={fields.sku}
        onChange={(event) => onUpdate("sku", event.target.value)} />
        <small className="identity-note">Unique in this browser for the current operator.</small>
      </label>
      <label>Status<select value={fields.status}
        onChange={(event) => onUpdate("status", Number(event.target.value))}>
        <option value={1}>Active</option><option value={0}>Inactive</option>
      </select></label>
      <label>EAN Code <span className="field-origin">Browser-reserved</span><input aria-label="EAN Code" value={fields.ean_code}
        onChange={(event) => onUpdate("ean_code", event.target.value)} />
        <small className="identity-note">Local reservation; it is not shared across devices.</small>
      </label>
      <label>Quantity<NumericInput inputMode="numeric" value={fields.stock}
        onCommit={(value) => onUpdate("stock", value)} /></label>
      <label>Package Weight kg <span className="field-origin">User-provided</span><NumericInput ariaLabel="Package Weight kg" value={fields.weight}
        onCommit={(value) => onUpdate("weight", value)} /></label>
      <label>Length cm <span className="field-origin">User-provided</span><NumericInput ariaLabel="Length cm" value={fields.length}
        onCommit={(value) => onUpdate("length", value)} /></label>
      <label>Width cm <span className="field-origin">User-provided</span><NumericInput ariaLabel="Width cm" value={fields.width}
        onCommit={(value) => onUpdate("width", value)} /></label>
      <label>Height cm <span className="field-origin">User-provided</span><NumericInput ariaLabel="Height cm" value={fields.height}
        onCommit={(value) => onUpdate("height", value)} /></label>
      <label>CBM m3 <span className="automatic-marker">Rule-calculated</span>
        <input aria-label="CBM m3" readOnly value={fields.cbm} /></label>
      <label>Brand Name<input value={fields.brand_name}
        onChange={(event) => onUpdate("brand_name", event.target.value)} /></label>
      <label>Colour <span className="field-origin">GPT-assisted</span><input aria-label="Colour" value={fields.colour}
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
      <label>Vendor Price <span className="field-origin">Rule-calculated</span><NumericInput ariaLabel="Vendor Price" value={fields.vendor_price}
        onCommit={(value) => onUpdate("vendor_price", value)} /></label>
      <label>Vendor RRP <span className="field-origin">Rule-calculated</span><NumericInput ariaLabel="Vendor RRP" value={fields.rrp}
        onCommit={(value) => onUpdate("rrp", value)} /></label>
    </div>
  );
}

function ShippingPanel({ billableWeight }: { billableWeight: number }) {
  return <>
    <div className="billable-weight"><span>Current billable weight <span className="field-origin">Rule-calculated</span></span>
      <strong>{billableWeight.toFixed(2)} kg</strong></div>
    <div className="shipping-summary">
      <article><span>Australian zones</span><strong>Free</strong><small>All metro and regional zones</small></article>
      <article><span>New Zealand · 0-1 kg</span><strong>AUD 20</strong><small>Incl. GST</small></article>
      <article><span>New Zealand · Over 1-2 kg</span><strong>AUD 40</strong><small>Incl. GST</small></article>
      <article><span>New Zealand · Over 2 kg</span><strong>AUD 999</strong><small>Incl. GST</small></article>
    </div>
    <p className="formula-note">Billable weight = max(actual, L × W × H / 5000)</p>
  </>;
}

export default function App() {
  const [initialStudio] = useState(loadProductStudioState);
  const [jobs, setJobs] = useState<ProductJobDefinition[]>(
    initialStudio?.jobs || [{ id: "product-1", number: 1 }]
  );
  const [activeJobId, setActiveJobId] = useState(
    initialStudio?.activeJobId || "product-1"
  );
  const [jobSummaries, setJobSummaries] = useState<Record<string, ProductJobSummary>>(
    () => Object.fromEntries(
      (initialStudio?.jobs || [{ id: "product-1", number: 1 }])
        .map((job) => [job.id, initialJobSummary])
    )
  );
  const [pendingImports, setPendingImports] = useState<Record<string, File[]>>({});
  const [batchMessage, setBatchMessage] = useState("");
  const [uploadHistory, setUploadHistory] = useState(loadUploadHistory);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null);
  const [healthStatus, setHealthStatus] = useState<"loading" | "success" | "error">("loading");
  const [imageScheduler] = useState(() =>
    createImageTaskScheduler(IMAGE_ROLE_CONCURRENCY)
  );
  const nextJobNumberRef = useRef(initialStudio?.nextJobNumber || 2);
  const queueAtCapacity = jobs.length >= MAX_PRODUCT_JOBS;

  useEffect(() => {
    saveProductStudioState({
      version: 1,
      jobs,
      activeJobId,
      nextJobNumber: nextJobNumberRef.current
    });
  }, [activeJobId, jobs]);

  useEffect(() => {
    saveUploadHistory(uploadHistory);
  }, [uploadHistory]);

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

  const updateJobSummary = useCallback((jobId: string, summary: ProductJobSummary) => {
    setJobSummaries((current) => {
      const previous = current[jobId];
      return previous && sameJobSummary(previous, summary)
        ? current
        : { ...current, [jobId]: summary };
    });
  }, []);

  function addProductJob() {
    if (queueAtCapacity) {
      setBatchMessage(`队列已满，最多同时处理 ${MAX_PRODUCT_JOBS} 个商品`);
      return;
    }
    const number = nextJobNumberRef.current;
    nextJobNumberRef.current += 1;
    const job = { id: `product-${number}`, number };
    setJobs((current) => [...current, job]);
    setJobSummaries((current) => ({
      ...current,
      [job.id]: initialJobSummary
    }));
    setActiveJobId(job.id);
    setBatchMessage("");
  }

  function deleteProductJob(jobId: string) {
    let remaining = jobs.filter((job) => job.id !== jobId);
    if (remaining.length === 0) {
      const number = nextJobNumberRef.current;
      nextJobNumberRef.current += 1;
      remaining = [{ id: `product-${number}`, number }];
    }
    setJobs(remaining);
    setActiveJobId((current) => current === jobId ? remaining[0].id : current);
    setJobSummaries((current) => {
      const next = { ...current };
      delete next[jobId];
      for (const job of remaining) next[job.id] ||= initialJobSummary;
      return next;
    });
    setPendingImports((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
    void deleteProductWorkspace(jobId);
  }

  function importProductFolders(files: File[]) {
    const result = groupProductFolderFiles(files);
    if (result.products.length === 0) {
      setBatchMessage(result.rejected[0]?.reason || "没有找到可导入的商品图片");
      return;
    }

    const availableSlots = Math.max(0, MAX_PRODUCT_JOBS - jobs.length);
    if (availableSlots === 0) {
      setBatchMessage(`队列已满，最多同时处理 ${MAX_PRODUCT_JOBS} 个商品`);
      return;
    }
    const acceptedProducts = result.products.slice(0, availableSlots);
    const capacitySkipped = result.products.length - acceptedProducts.length;
    const importedJobs: ProductJobDefinition[] = [];
    const importedFiles: Record<string, File[]> = {};
    for (const product of acceptedProducts) {
      const number = nextJobNumberRef.current;
      nextJobNumberRef.current += 1;
      const job = { id: `product-${number}`, number, name: product.name };
      importedJobs.push(job);
      importedFiles[job.id] = product.files;
    }
    setJobs((current) => [...current, ...importedJobs]);
    setJobSummaries((current) => ({
      ...current,
      ...Object.fromEntries(importedJobs.map((job) => [job.id, initialJobSummary]))
    }));
    setPendingImports((current) => ({ ...current, ...importedFiles }));
    setActiveJobId(importedJobs[0].id);
    const messageParts = [`已导入 ${importedJobs.length} 个商品`];
    if (capacitySkipped > 0) {
      messageParts.push(`队列已满，跳过 ${capacitySkipped} 个商品`);
    }
    if (result.rejected.length > 0) {
      messageParts.push(`另有 ${result.rejected.length} 个文件夹不符合要求`);
    }
    setBatchMessage(messageParts.join("，"));
  }

  const consumeImport = useCallback((jobId: string) => {
    setPendingImports((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
  }, []);

  const recordUpload = useCallback((entry: UploadHistoryEntry) => {
    setUploadHistory((current) => [entry, ...current].slice(0, 100));
  }, []);

  const findDuplicate = useCallback((jobId: string, sku: string, eanCode: string) => {
    const uploaded = findDuplicateUpload(uploadHistory, sku, eanCode);
    if (uploaded) {
      return `上传历史中已存在 ${uploaded.sku} / ${uploaded.eanCode}（${formatHistoryDate(uploaded.uploadedAt)}）`;
    }
    const otherJob = Object.entries(jobSummaries).find(([otherJobId, summary]) =>
      otherJobId !== jobId && (
        (sku.trim() && summary.sku.trim().toLowerCase() === sku.trim().toLowerCase()) ||
        (eanCode.trim() && summary.eanCode.trim() === eanCode.trim())
      )
    );
    return otherJob ? "另一个商品任务正在使用相同的 SKU 或 EAN" : null;
  }, [jobSummaries, uploadHistory]);

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

        <section className="product-queue" aria-labelledby="product-queue-heading">
          <div className="product-queue-heading">
            <div>
              <span>PRODUCT QUEUE</span>
              <strong id="product-queue-heading">
                {jobs.length} / {MAX_PRODUCT_JOBS} 个商品 · 全局图片并发 {IMAGE_ROLE_CONCURRENCY}
              </strong>
            </div>
            <div className="queue-actions">
              <label className={`folder-import-button${queueAtCapacity ? " is-disabled" : ""}`}
                aria-disabled={queueAtCapacity}>
                <FolderOpen size={16} aria-hidden="true" /> 批量导入文件夹
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple
                  aria-label="批量导入商品文件夹"
                  disabled={queueAtCapacity}
                  ref={(node) => node?.setAttribute("webkitdirectory", "")}
                  onChange={(event) => {
                    importProductFolders(Array.from(event.target.files || []));
                    event.currentTarget.value = "";
                  }} />
              </label>
              <button type="button" className="new-product-button" onClick={addProductJob}
                disabled={queueAtCapacity}
                title={queueAtCapacity ? `队列最多 ${MAX_PRODUCT_JOBS} 个商品` : undefined}>
                新建商品
              </button>
            </div>
          </div>
          {batchMessage && <p className="batch-import-message" role="status">{batchMessage}</p>}
          <nav className="product-job-tabs" role="tablist" aria-label="Product jobs">
            {jobs.map((job) => {
              const summary = jobSummaries[job.id] || initialJobSummary;
              const jobLabel = job.name || `商品 ${job.number}`;
              return (
                <div className="product-job-tab-item" key={job.id}>
                  <button id={`job-tab-${job.id}`} role="tab"
                    aria-selected={activeJobId === job.id}
                    aria-controls={`job-panel-${job.id}`}
                    tabIndex={activeJobId === job.id ? 0 : -1}
                    onClick={() => setActiveJobId(job.id)}>
                    <strong>{jobLabel}</strong>
                    <span>{productJobSummaryLabel(summary)}</span>
                  </button>
                  <button type="button" className="delete-job-button"
                    aria-label={`删除 ${jobLabel}`} title={`删除 ${jobLabel}`}
                    onClick={() => deleteProductJob(job.id)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </nav>
        </section>

        <details className="upload-history">
          <summary><History size={16} aria-hidden="true" /> 上传历史（{uploadHistory.length}）</summary>
          {uploadHistory.length === 0
            ? <p>还没有成功上传的商品</p>
            : <div className="upload-history-list">
                {uploadHistory.map((entry) => (
                  <article key={entry.id}>
                    <div>
                      <strong>{entry.productName || entry.sku}</strong>
                      <span>{entry.sku} · {entry.eanCode}</span>
                      <small>{formatHistoryDate(entry.uploadedAt)}</small>
                    </div>
                    <button type="button" onClick={() =>
                      setUploadHistory((current) => current.filter((item) => item.id !== entry.id))}
                      aria-label={`移除上传记录 ${entry.sku}`}>移除记录</button>
                  </article>
                ))}
              </div>}
        </details>

        {jobs.map((job, index) => (
          <div key={job.id} id={`job-panel-${job.id}`} role="tabpanel"
            aria-labelledby={`job-tab-${job.id}`}
            data-testid={`product-job-${job.id}`}
            hidden={activeJobId !== job.id}>
            <ProductWorkspace jobId={job.id} jobName={job.name}
              domIdPrefix={index === 0 ? "" : `${job.id}-`}
              imageScheduler={imageScheduler}
              initialSourceFiles={pendingImports[job.id]}
              onSummaryChange={updateJobSummary}
              onImportConsumed={consumeImport}
              onUploadSuccess={recordUpload}
              findDuplicate={findDuplicate} />
          </div>
        ))}
      </main>
    </>
  );
}

function ProductWorkspace({
  jobId,
  jobName,
  domIdPrefix,
  imageScheduler,
  initialSourceFiles,
  onSummaryChange,
  onImportConsumed,
  onUploadSuccess,
  findDuplicate
}: ProductWorkspaceProps) {
  const [restoredSnapshot] = useState(() => loadProductWorkspace(jobId));
  const [newtonSourceUrl, setNewtonSourceUrl] = useState("");
  const [newtonTask, setNewtonTask] = useState<TaskState>(idleTask);
  const [newtonMessage, setNewtonMessage] = useState(
    "粘贴 1688 商品链接，自动读取商品资料"
  );
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourceFilesReady, setSourceFilesReady] = useState(
    !restoredSnapshot?.sourceFileCount
  );
  const [sellingPoints, setSellingPoints] = useState(restoredSnapshot?.sellingPoints || "");
  const [optionalInputs, setOptionalInputs] = useState<OptionalInputs>(
    restoredSnapshot?.optionalInputs || {
      ...emptyOptionalInputs,
      categoryHint: jobName || ""
    }
  );
  const [fields, setFields] = useState<DszProductFields>(
    restoredSnapshot?.fields || { ...initialFields }
  );
  const [copyTask, setCopyTask] = useState<TaskState>(restoredSnapshot?.copyTask || idleTask);
  const [uploadSourceTask, setUploadSourceTask] = useState<TaskState>(
    restoredSnapshot?.uploadSourceTask || idleTask
  );
  const [imageRoles, setImageRoles] = useState(
    restoredSnapshot?.imageRoles || initialRoleStates
  );
  const [uploadStatus, setUploadStatus] = useState<Status>(
    restoredSnapshot?.uploadStatus || "idle"
  );
  const [message, setMessage] = useState(
    restoredSnapshot?.message || "等待上传原始产品图片"
  );
  const [uploadResult, setUploadResult] = useState<unknown>(restoredSnapshot?.uploadResult || null);
  const [activeTab, setActiveTab] = useState<EditorTab>(restoredSnapshot?.activeTab || "details");
  const [researchEvidence, setResearchEvidence] = useState<ProductResearchEvidence | null>(
    restoredSnapshot?.researchEvidence || null
  );
  const [researchIssues, setResearchIssues] = useState<string[]>(
    restoredSnapshot?.researchIssues || []
  );
  const [marketTask, setMarketTask] = useState<TaskState>(
    restoredSnapshot?.marketTask || idleTask
  );
  const [marketAnalysis, setMarketAnalysis] = useState<AmazonMarketAnalysis | null>(
    restoredSnapshot?.marketAnalysis || null
  );
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const [showMeasurementError, setShowMeasurementError] = useState(false);
  const copyOperationIdRef = useRef(0);
  const imageOperationIdRef = useRef(0);
  const copyControllersRef = useRef(new Set<AbortController>());
  const imageControllersRef = useRef(new Set<AbortController>());
  const marketOperationIdRef = useRef(0);
  const marketControllerRef = useRef<AbortController | null>(null);
  const fieldEditVersionsRef = useRef<Record<keyof DszProductFields, number>>(
    restoredSnapshot?.fieldEditVersions || Object.fromEntries(
      Object.keys(initialFields).map((key) => [key, 0])
    ) as Record<keyof DszProductFields, number>
  );
  const manualFieldsRef = useRef(new Set<keyof DszProductFields>(
    restoredSnapshot?.manualFields || []
  ));
  const uploadAttemptRef = useRef(0);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const sourceSelectionIdRef = useRef(0);
  const newtonControllerRef = useRef<AbortController | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialImportAppliedRef = useRef(false);

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
  const hasValidPackageMeasurements = [
    fields.weight,
    fields.length,
    fields.width,
    fields.height
  ]
    .every((value) => Number.isFinite(value) && value > 0);
  const workflowLoading = copyTask.status === "loading" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status === "loading"
  );
  const hasTaskError = copyTask.status === "error" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status === "error"
  );
  const hasRetryableTasks = copyTask.status === "error" || marketTask.status === "error" ||
    PRODUCT_IMAGE_ROLES.some((role) => imageRoles[role].status === "error");
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
  const isReadyToSubmit = !workflowLoading &&
    generatedImages.length > 0 &&
    generatedImages.every(isHttpsUrl) &&
    hasRequiredDszFields(fields);
  const hasTaskActivity = copyTask.status !== "idle" || PRODUCT_IMAGE_ROLES.some(
    (role) => imageRoles[role].status !== "idle"
  );
  const pageSummary = uploadStatus !== "idle"
    ? message
    : hasTaskError && message.startsWith("已取消")
      ? message
      : hasTaskActivity ? taskSummary : message;
  const billableWeight = calculateBillableWeightKg({
    actualWeightKg: fields.weight,
    lengthCm: fields.length,
    widthCm: fields.width,
    heightCm: fields.height
  });
  const submitReason = submissionReason(fields, imageRoles, workflowLoading);
  const jobPhase: Status = uploadSourceTask.status === "loading" || workflowLoading || uploadStatus === "loading"
    ? "loading"
    : uploadStatus === "error"
      ? "error"
      : isReadyToSubmit || uploadStatus === "success"
        ? "success"
        : hasTaskError ? "error" : hasStaleOutput ? "stale" : "idle";

  useEffect(() => {
    onSummaryChange(jobId, {
      phase: jobPhase,
      completedImages: completedImageCount,
      failedImages: failedImageCount,
      ready: isReadyToSubmit,
      submitted: uploadStatus === "success",
      sku: fields.sku,
      eanCode: fields.ean_code
    });
  }, [
    completedImageCount,
    failedImageCount,
    isReadyToSubmit,
    fields.ean_code,
    fields.sku,
    jobId,
    jobPhase,
    onSummaryChange,
    uploadStatus
  ]);

  useEffect(() => () => {
    sourceSelectionIdRef.current += 1;
    copyOperationIdRef.current += 1;
    imageOperationIdRef.current += 1;
    copyControllersRef.current.forEach((controller) => controller.abort());
    imageControllersRef.current.forEach((controller) => controller.abort());
    copyControllersRef.current.clear();
    imageControllersRef.current.clear();
    marketOperationIdRef.current += 1;
    marketControllerRef.current?.abort();
    marketControllerRef.current = null;
    uploadAttemptRef.current += 1;
    uploadControllerRef.current?.abort();
    newtonControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!restoredSnapshot?.sourceFileCount) return;
    let active = true;
    void loadProductSourceFiles(jobId).then((files) => {
      if (!active) return;
      setSourceFiles(files);
      setSourceFilesReady(true);
      if (files.length === 0) {
        setUploadSourceTask({ status: "error", error: "未能恢复原始图片，请重新选择" });
        setMessage("商品资料已恢复，但原始图片需要重新选择");
      }
    }).catch(() => {
      if (!active) return;
      setSourceFilesReady(true);
      setUploadSourceTask({ status: "error", error: "未能恢复原始图片，请重新选择" });
      setMessage("商品资料已恢复，但原始图片需要重新选择");
    });
    return () => { active = false; };
  }, [jobId, restoredSnapshot]);

  useEffect(() => {
    if (!sourceFilesReady) return;
    const snapshot: ProductWorkspaceSnapshot = {
      version: 1,
      jobId,
      updatedAt: new Date().toISOString(),
      sourceFileCount: sourceFiles.length,
      sourceFileNames: sourceFiles.map((file) => file.name),
      sellingPoints,
      optionalInputs,
      fields,
      copyTask,
      uploadSourceTask,
      imageRoles,
      uploadStatus,
      message,
      uploadResult,
      activeTab,
      researchEvidence,
      researchIssues,
      marketTask,
      marketAnalysis,
      manualFields: Array.from(manualFieldsRef.current),
      fieldEditVersions: fieldEditVersionsRef.current
    };
    saveProductWorkspace(snapshot);
  }, [
    activeTab,
    copyTask,
    fields,
    imageRoles,
    jobId,
    marketAnalysis,
    marketTask,
    message,
    optionalInputs,
    researchEvidence,
    researchIssues,
    sellingPoints,
    sourceFiles,
    sourceFilesReady,
    uploadResult,
    uploadSourceTask,
    uploadStatus
  ]);

  useEffect(() => {
    if (hasValidPackageMeasurements) setShowMeasurementError(false);
  }, [hasValidPackageMeasurements]);

  function clearUploadResult() {
    uploadAttemptRef.current += 1;
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    setUploadResult(null);
    setUploadStatus("idle");
  }

  function invalidateMarketAnalysis() {
    marketOperationIdRef.current += 1;
    marketControllerRef.current?.abort();
    marketControllerRef.current = null;
    setMarketTask((current) => marketAnalysis || current.status === "success" || current.status === "stale"
      ? { status: "stale", error: "" }
      : idleTask);
  }

  function invalidateGeneration(scope: GenerationScope) {
    copyOperationIdRef.current += 1;
    copyControllersRef.current.forEach((controller) => controller.abort());
    copyControllersRef.current.clear();
    setCopyTask((current) => current.status === "success" || current.status === "stale"
      ? { status: "stale", error: "" }
      : idleTask);
    setResearchEvidence(null);
    setResearchIssues([]);
    invalidateMarketAnalysis();
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
    if (field === "purchasePriceCny") {
      invalidateGeneration("copy");
      setFields((current) => recalculatePrices(
        current,
        optionalNumber(value),
        manualFieldsRef.current
      ));
    }
    setOptionalInputs((current) => ({ ...current, [field]: value }));
    clearUploadResult();
  }

  async function selectSourceFiles(files: File[]) {
    sourceSelectionIdRef.current += 1;
    const selectionId = sourceSelectionIdRef.current;
    invalidateGeneration("all");
    setSourceFiles(files);
    setSourceFilesReady(true);
    setUploadSourceTask(idleTask);
    clearUploadResult();

    try {
      await saveProductSourceFiles(jobId, files);
    } catch {
      setMessage("图片已选择，但浏览器未能保存，刷新后需要重新选择");
    }

    if (files.length > MAX_SOURCE_IMAGES || !canOptimizeSourceImages(files)) return;
    setUploadSourceTask({ status: "loading", error: "" });
    setMessage("正在优化源图，完成后可直接生成");
    try {
      const optimizedFiles = await prepareSourceImages(files);
      if (selectionId !== sourceSelectionIdRef.current) return;

      const bytesSaved = files.reduce((total, file) => total + file.size, 0) -
        optimizedFiles.reduce((total, file) => total + file.size, 0);
      setSourceFiles(optimizedFiles);
      await saveProductSourceFiles(jobId, optimizedFiles);
      if (selectionId !== sourceSelectionIdRef.current) return;
      setUploadSourceTask({ status: "success", error: "" });
      setMessage(bytesSaved > 0
        ? `源图优化完成，减少 ${formatBytes(bytesSaved)} 上传量`
        : "源图无需压缩，可以开始生成");
    } catch {
      if (selectionId !== sourceSelectionIdRef.current) return;
      setUploadSourceTask({ status: "error", error: "源图优化或保存失败" });
      setMessage("源图优化失败，可以重新选择图片");
    }
  }

  useEffect(() => {
    if (initialImportAppliedRef.current || !initialSourceFiles?.length) return;
    initialImportAppliedRef.current = true;
    const files = initialSourceFiles;
    const selectionId = sourceSelectionIdRef.current + 1;
    sourceSelectionIdRef.current = selectionId;
    setSourceFiles(files);
    setSourceFilesReady(true);
    setUploadSourceTask({ status: "loading", error: "" });
    setMessage("正在导入并优化文件夹图片");
    onImportConsumed(jobId);

    void (async () => {
      try {
        await saveProductSourceFiles(jobId, files);
        const optimizedFiles = canOptimizeSourceImages(files)
          ? await prepareSourceImages(files)
          : files;
        if (selectionId !== sourceSelectionIdRef.current) return;
        setSourceFiles(optimizedFiles);
        await saveProductSourceFiles(jobId, optimizedFiles);
        if (selectionId !== sourceSelectionIdRef.current) return;
        setUploadSourceTask({ status: "success", error: "" });
        setMessage(`已导入 ${files.length} 张文件夹图片`);
      } catch {
        if (selectionId !== sourceSelectionIdRef.current) return;
        setUploadSourceTask({ status: "error", error: "文件夹图片导入失败" });
        setMessage("文件夹图片导入失败，请手动重新选择");
      }
    })();
  }, [initialSourceFiles, jobId, onImportConsumed]);

  function markManualField(
    field: keyof DszProductFields,
    value: string | number | boolean
  ) {
    const requiresPositiveNumber = [
      "categories",
      "weight",
      "length",
      "width",
      "height",
      "vendor_price",
      "rrp"
    ].includes(String(field));
    const cleared = typeof value === "string"
      ? value.trim() === "" || (requiresPositiveNumber && !(Number(value) > 0))
      : typeof value === "number" && requiresPositiveNumber
        ? !(value > 0)
        : false;

    if (cleared) manualFieldsRef.current.delete(field);
    else manualFieldsRef.current.add(field);
    if (field === "categories") {
      if (cleared) manualFieldsRef.current.delete("category");
      else manualFieldsRef.current.add("category");
    }
  }

  function updateField(field: keyof DszProductFields, value: string | number | boolean) {
    markManualField(field, value);
    fieldEditVersionsRef.current[field] += 1;
    if (["categories", "categoryName", "product_name", "rrp"].includes(String(field))) {
      invalidateMarketAnalysis();
    }
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
        return recalculatePrices(
          next,
          optionalNumber(optionalInputs.purchasePriceCny),
          manualFieldsRef.current
        );
      }
      if (field === "vendor_price" && !manualFieldsRef.current.has("rrp")) {
        next.rrp = Number(value) > 0 ? calculateVendorRrp(Number(value)) : 0;
      }
      return next;
    });
  }

  async function importFromNewton() {
    const sourceUrl = newtonSourceUrl.trim();
    if (!sourceUrl) {
      setNewtonTask({ status: "error", error: "请输入 1688 商品链接" });
      setNewtonMessage("请输入 1688 商品链接");
      return;
    }

    newtonControllerRef.current?.abort();
    const controller = new AbortController();
    newtonControllerRef.current = controller;
    setNewtonTask({ status: "loading", error: "" });
    setNewtonMessage("牛顿正在读取 1688 商品详情");

    try {
      const product = await requestNewtonProductImport(sourceUrl, controller.signal);
      setNewtonMessage("商品资料已读取，正在载入原始图片");
      const importedFiles = await downloadNewtonProductImages(
        product,
        controller.signal
      );
      if (controller.signal.aborted) return;

      await applyNewtonProduct(product, importedFiles);
      setNewtonTask({ status: "success", error: "" });
      setNewtonMessage(importedFiles.length > 0
        ? `已导入商品资料和 ${importedFiles.length} 张原图`
        : "商品资料已导入；未取得有效原图，请手动上传");
      setMessage("牛顿商品资料已导入，请复核后开始 AI 生成");
    } catch (error) {
      if (controller.signal.aborted) return;
      const safeMessage = errorMessage(error, "牛顿商品导入失败");
      setNewtonTask({ status: "error", error: safeMessage });
      setNewtonMessage(safeMessage);
    } finally {
      if (newtonControllerRef.current === controller) {
        newtonControllerRef.current = null;
      }
    }
  }

  async function applyNewtonProduct(
    product: NewtonImportedProduct,
    importedFiles: File[]
  ) {
    await selectSourceFiles(importedFiles);
    setCopyTask(idleTask);
    setImageRoles(initialRoleStates());
    setResearchEvidence(null);
    setResearchIssues([]);
    setMarketTask(idleTask);
    setMarketAnalysis(null);
    setSellingPoints(
      `1688 商品标题：${product.title}\n${product.sellingPoints}`.trim()
    );
    setOptionalInputs({
      categoryHint: product.categoryHint,
      purchasePriceCny: product.purchasePriceCny === undefined
        ? ""
        : String(product.purchasePriceCny)
    });

    manualFieldsRef.current.clear();
    const importedFieldValues: Partial<Pick<
      DszProductFields,
      "colour" | "weight" | "length" | "width" | "height"
    >> = {
      ...(product.colour ? { colour: product.colour } : {}),
      ...(product.packageWeightKg ? { weight: product.packageWeightKg } : {}),
      ...(product.lengthCm ? { length: product.lengthCm } : {}),
      ...(product.widthCm ? { width: product.widthCm } : {}),
      ...(product.heightCm ? { height: product.heightCm } : {})
    };
    for (const key of Object.keys(importedFieldValues) as Array<
      keyof typeof importedFieldValues
    >) {
      manualFieldsRef.current.add(key);
      fieldEditVersionsRef.current[key] += 1;
    }

    const weight = product.packageWeightKg || 0;
    const length = product.lengthCm || 0;
    const width = product.widthCm || 0;
    const height = product.heightCm || 0;
    setFields((current) => recalculatePrices({
      ...current,
      category: 0,
      categories: "",
      categoryName: "",
      product_name: "",
      sku: "",
      ean_code: "",
      weight,
      length,
      width,
      height,
      cbm: calculatePackageCbm(length, width, height),
      colour: product.colour || "",
      description: "",
      vendor_price: 0,
      rrp: 0,
      zone_rates: buildShippingZoneRates({
        actualWeightKg: weight,
        lengthCm: length,
        widthCm: width,
        heightCm: height
      }),
      images: [],
      risk_flags: [],
      review_notes: []
    }, product.purchasePriceCny, manualFieldsRef.current));
  }

  function productInput(imageUrls: string[], fieldSnapshot: DszProductFields): ProductInput {
    return {
      sellingPoints: sellingPoints.trim(),
      categoryHint: optionalInputs.categoryHint.trim() || undefined,
      images: sourceFiles.map((file) => file.name),
      imageUrls,
      purchasePriceCny: optionalNumber(optionalInputs.purchasePriceCny),
      categoryId: manualFieldsRef.current.has("categories")
        ? fieldSnapshot.category || undefined
        : undefined,
      categoryName: manualFieldsRef.current.has("categories")
        ? fieldSnapshot.categoryName || undefined
        : undefined,
      colour: manualFieldsRef.current.has("colour")
        ? fieldSnapshot.colour || undefined
        : undefined,
      packageWeightKg: fieldSnapshot.weight || undefined,
      lengthCm: fieldSnapshot.length || undefined,
      widthCm: fieldSnapshot.width || undefined,
      heightCm: fieldSnapshot.height || undefined
    };
  }

  function reserveIdentity(
    fieldSnapshot: DszProductFields,
    refreshGeneratedEan = false
  ): ProductIdentity {
    const currentSku = /^Elosung1\d{4}$/.test(fieldSnapshot.sku)
      ? fieldSnapshot.sku
      : "";
    const currentEan = /^\d{10}$/.test(fieldSnapshot.ean_code)
      ? fieldSnapshot.ean_code
      : "";
    const reserved = currentSku ? null : reserveProductIdentity();
    const keepManualEan =
      currentEan && manualFieldsRef.current.has("ean_code");
    const identity = {
      sku: currentSku || (reserved as ProductIdentity).sku,
      eanCode: keepManualEan || (!refreshGeneratedEan && currentEan)
        ? currentEan
        : reserved?.eanCode || reserveEanCode()
    };

    setFields((current) => ({
      ...current,
      sku: /^Elosung1\d{4}$/.test(current.sku) ? current.sku : identity.sku,
      ean_code: keepManualEan ? current.ean_code : identity.eanCode
    }));
    return identity;
  }

  function applyGeneratedFields(
    generated: DszProductFields,
    versionsAtStart: Record<keyof DszProductFields, number>
  ) {
    setFields((current) => {
      const next = { ...current };
      for (const key of Object.keys(generated) as Array<keyof DszProductFields>) {
        if (OPERATOR_PACKAGE_FIELDS.has(key)) continue;
        if (key === "categoryName" && manualFieldsRef.current.has("categories")) {
          next.categoryName = generated.categories === current.categories
            ? generated.categoryName
            : "";
          continue;
        }
        if (
          !manualFieldsRef.current.has(key) &&
          fieldEditVersionsRef.current[key] === versionsAtStart[key]
        ) {
          Object.assign(next, { [key]: generated[key] });
        }
      }
      next.cbm = calculatePackageCbm(next.length, next.width, next.height);
      next.zone_rates = buildShippingZoneRates({
        actualWeightKg: next.weight,
        lengthCm: next.length,
        widthCm: next.width,
        heightCm: next.height
      });
      return next;
    });
  }

  function marketInputFromFields(fieldSnapshot: DszProductFields): AmazonMarketAnalysisInput | null {
    const productName = fieldSnapshot.product_name.trim();
    if (!productName || !(fieldSnapshot.rrp > 0)) return null;
    return {
      productName,
      categoryName: fieldSnapshot.categoryName,
      categoryHint: optionalInputs.categoryHint.trim(),
      sellingPoints: sellingPoints.trim(),
      currentRrpAud: fieldSnapshot.rrp
    };
  }

  async function runMarketAnalysis(input = marketInputFromFields(fieldsRef.current)) {
    if (!input) {
      setMarketTask({ status: "error", error: "请先生成商品名称和 RRP 后再分析。" });
      return;
    }
    const operationId = marketOperationIdRef.current + 1;
    marketOperationIdRef.current = operationId;
    marketControllerRef.current?.abort();
    const controller = new AbortController();
    marketControllerRef.current = controller;
    setMarketTask({ status: "loading", error: "" });
    try {
      const result = await requestAmazonMarketAnalysis(input, controller.signal);
      if (operationId !== marketOperationIdRef.current || controller.signal.aborted) return;
      setMarketAnalysis(result);
      setMarketTask({ status: "success", error: "" });
    } catch (error) {
      if (operationId !== marketOperationIdRef.current || controller.signal.aborted) return;
      setMarketTask({
        status: "error",
        error: errorMessage(error, "Amazon Australia 市场分析失败")
      });
    } finally {
      if (marketControllerRef.current === controller) marketControllerRef.current = null;
    }
  }

  async function runCopyTask(
    operationId = copyOperationIdRef.current,
    refreshGeneratedEan = false
  ) {
    const controller = beginCopyTask(operationId);
    if (!controller) return;
    const fieldSnapshot = { ...fields };
    const filesSnapshot = [...sourceFiles];
    const versionsAtStart = { ...fieldEditVersionsRef.current };
    setCopyTask({ status: "loading", error: "" });
    setResearchEvidence(null);
    setResearchIssues([]);
    invalidateMarketAnalysis();

    try {
      const identity = reserveIdentity(fieldSnapshot, refreshGeneratedEan);
      const requestFields = {
        ...fieldSnapshot,
        sku: identity.sku,
        ean_code: identity.eanCode
      };
      const result = await requestProductFields({
        input: productInput([], requestFields),
        files: filesSnapshot,
        identity
      }, controller.signal);
      if (operationId !== copyOperationIdRef.current) return;

      applyGeneratedFields({
        ...result.fields,
        sku: identity.sku,
        ean_code: identity.eanCode
      }, versionsAtStart);
      setResearchEvidence(result.evidence || null);
      setResearchIssues(result.issues || []);
      clearUploadResult();
      setCopyTask(result.issues?.length
        ? {
            status: "error",
            error: `${result.issues.length} unresolved issue${result.issues.length === 1 ? "" : "s"}. Review the evidence below.`
          }
        : { status: "success", error: "" });
      const current = fieldsRef.current;
      const marketFields = {
        ...result.fields,
        product_name: manualFieldsRef.current.has("product_name") ||
          fieldEditVersionsRef.current.product_name !== versionsAtStart.product_name
          ? current.product_name
          : result.fields.product_name,
        categoryName: manualFieldsRef.current.has("categories") ||
          fieldEditVersionsRef.current.categoryName !== versionsAtStart.categoryName
          ? current.categoryName
          : result.fields.categoryName,
        rrp: manualFieldsRef.current.has("rrp") ||
          fieldEditVersionsRef.current.rrp !== versionsAtStart.rrp
          ? current.rrp
          : result.fields.rrp
      };
      const marketInput = marketInputFromFields(marketFields);
      if (marketInput) void runMarketAnalysis(marketInput);
    } catch (error) {
      if (operationId !== copyOperationIdRef.current || controller.signal.aborted) return;
      const text = errorMessage(error, "完整商品资料生成失败");
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
      const result = await imageScheduler.schedule(() => {
        if (controller.signal.aborted) throw new Error("Image task cancelled");
        return requestProductImageRole({
          role,
          files: filesSnapshot,
          productType: productTypeSnapshot,
          sellingPoints: sellingPointsSnapshot
        }, controller.signal);
      });
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
    let nextRoleIndex = 0;
    const worker = async () => {
      while (nextRoleIndex < PRODUCT_IMAGE_ROLES.length) {
        const role = PRODUCT_IMAGE_ROLES[nextRoleIndex];
        nextRoleIndex += 1;
        await runImageRole(role, operationId);
      }
    };

    await Promise.allSettled(
      Array.from({ length: IMAGE_ROLE_CONCURRENCY }, () => worker())
    );
  }

  function replaceImageRole(role: ProductImageRole, imageUrl: string) {
    setImageRoles((current) => ({
      ...current,
      [role]: { status: "success", error: "", imageUrl }
    }));
    clearUploadResult();
  }

  function cancelAllTasks() {
    const cancellingImageBatch = PRODUCT_IMAGE_ROLES.some(
      (role) => imageRoles[role].status === "loading"
    );
    sourceSelectionIdRef.current += 1;
    copyOperationIdRef.current += 1;
    imageOperationIdRef.current += 1;
    copyControllersRef.current.forEach((controller) => controller.abort());
    imageControllersRef.current.forEach((controller) => controller.abort());
    copyControllersRef.current.clear();
    imageControllersRef.current.clear();
    marketOperationIdRef.current += 1;
    marketControllerRef.current?.abort();
    marketControllerRef.current = null;
    newtonControllerRef.current?.abort();
    newtonControllerRef.current = null;
    uploadAttemptRef.current += 1;
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    setUploadSourceTask((current) => current.status === "loading"
      ? { status: "error", error: "任务已取消" }
      : current);
    setCopyTask((current) => current.status === "loading"
      ? { status: "error", error: "任务已取消" }
      : current);
    setMarketTask((current) => current.status === "loading"
      ? { status: "error", error: "市场分析已取消" }
      : current);
    setNewtonTask((current) => current.status === "loading"
      ? { status: "error", error: "任务已取消" }
      : current);
    setImageRoles((current) => Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [
      role,
      cancellingImageBatch && current[role].status !== "success"
        ? { ...current[role], status: "error", error: "任务已取消" }
        : current[role]
    ])) as Record<ProductImageRole, ImageRoleState>);
    setUploadStatus((current) => current === "loading" ? "error" : current);
    setMessage("已取消正在运行和排队的任务");
  }

  async function retryAllFailedTasks() {
    const hasGenerationFailure = copyTask.status === "error" || PRODUCT_IMAGE_ROLES.some(
      (role) => imageRoles[role].status === "error"
    );
    if (hasGenerationFailure && (!sourceFilesReady || sourceFiles.length === 0)) {
      setMessage("请重新选择原始产品图片后再重试");
      return;
    }
    if (hasGenerationFailure && !sellingPoints.trim()) {
      setMessage("请填写卖点后再重试");
      return;
    }
    const tasks: Array<Promise<unknown>> = [];
    if (copyTask.status === "error") tasks.push(runCopyTask());
    if (copyTask.status !== "error" && marketTask.status === "error") {
      tasks.push(runMarketAnalysis());
    }
    for (const role of PRODUCT_IMAGE_ROLES) {
      if (imageRoles[role].status === "error") tasks.push(runImageRole(role));
    }
    if (tasks.length === 0) {
      setMessage("没有需要重试的失败任务");
      return;
    }
    clearUploadResult();
    await Promise.allSettled(tasks);
  }

  async function startGeneration() {
    if (sourceFiles.length === 0) {
      setMessage("请先上传至少一张原始产品图片");
      return;
    }
    if (sourceFiles.length > MAX_SOURCE_IMAGES) {
      setMessage("Select at most 4 source images");
      return;
    }
    if (
      sourceFiles.reduce((total, file) => total + file.size, 0) >
      MAX_SOURCE_IMAGE_BATCH_BYTES
    ) {
      setMessage("Source image batch must be 4 MB or smaller");
      return;
    }
    if (!sellingPoints.trim()) {
      setMessage("请填写卖点");
      return;
    }
    if (!hasValidPackageMeasurements) {
      setShowMeasurementError(true);
    }

    invalidateGeneration("all");
    const copyOperationId = copyOperationIdRef.current;
    const imageOperationId = imageOperationIdRef.current;
    clearUploadResult();
    await Promise.allSettled([
      runCopyTask(copyOperationId, true),
      runAllImageRoles(imageOperationId)
    ]);
  }

  async function uploadProduct() {
    const fieldsForUpload = { ...fields, images: generatedImages };
    const duplicate = findDuplicate(jobId, fieldsForUpload.sku, fieldsForUpload.ean_code);
    if (duplicate) {
      setUploadStatus("error");
      setMessage(`已阻止重复上传：${duplicate}`);
      return;
    }
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
      onUploadSuccess({
        id: `${jobId}-${Date.now()}`,
        jobId,
        productName: fieldsForUpload.product_name || jobName || fieldsForUpload.sku,
        sku: fieldsForUpload.sku,
        eanCode: fieldsForUpload.ean_code,
        uploadedAt: new Date().toISOString(),
        result: data
      });
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
      <section className="workspace" aria-label="DSZ product workspace">
        <aside className="source-rail" aria-labelledby={`${domIdPrefix}source-heading`}>
          <div className="section-heading">
            <span className="section-index">01</span>
            <div><h2 id={`${domIdPrefix}source-heading`}>Source</h2><p>生成依据</p></div>
          </div>
          <section
            className="newton-import"
            aria-labelledby={`${domIdPrefix}newton-import-heading`}
          >
            <div className="newton-import-heading">
              <CloudDownload size={16} aria-hidden="true" />
              <h3 id={`${domIdPrefix}newton-import-heading`}>牛顿云端导入</h3>
            </div>
            <label>
              1688 商品链接
              <input
                aria-label="1688 商品链接"
                type="url"
                value={newtonSourceUrl}
                placeholder="https://detail.1688.com/offer/..."
                onChange={(event) => {
                  setNewtonSourceUrl(event.target.value);
                  if (newtonTask.status === "error") {
                    setNewtonTask(idleTask);
                    setNewtonMessage("粘贴 1688 商品链接，自动读取商品资料");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void importFromNewton();
                  }
                }}
              />
            </label>
            <button
              className="newton-import-button"
              type="button"
              onClick={() => void importFromNewton()}
              disabled={newtonTask.status === "loading"}
            >
              {newtonTask.status === "loading"
                ? <Loader2 className="spin" size={15} />
                : <CloudDownload size={15} />}
              {newtonTask.status === "loading" ? "正在导入" : "牛顿导入"}
            </button>
            <p
              className={`newton-import-status status-${newtonTask.status}`}
              role={newtonTask.status === "error"
                ? "alert"
                : newtonTask.status === "idle" ? undefined : "status"}
              aria-live="polite"
            >
              {newtonMessage}
            </p>
          </section>
          <label className="file-picker">
            <span><Upload size={17} aria-hidden="true" /> 原始产品图片</span>
            <input
              aria-label="原始产品图片"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => void selectSourceFiles(
                Array.from(event.target.files || [])
              )}
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
            <fieldset className="package-measurements">
              <legend>Package measurements (required for submission)</legend>
              <div className="package-measurement-grid">
                <label>Weight
                  <NumericInput ariaLabel="Package weight kg" value={fields.weight}
                    required ariaInvalid={showMeasurementError && !(fields.weight > 0)}
                    onCommit={(value) => updateField("weight", value)} />
                  <span>kg</span>
                </label>
                <label>Length
                  <NumericInput ariaLabel="Package length cm" value={fields.length}
                    required ariaInvalid={showMeasurementError && !(fields.length > 0)}
                    onCommit={(value) => updateField("length", value)} />
                  <span>cm</span>
                </label>
                <label>Width
                  <NumericInput ariaLabel="Package width cm" value={fields.width}
                    required ariaInvalid={showMeasurementError && !(fields.width > 0)}
                    onCommit={(value) => updateField("width", value)} />
                  <span>cm</span>
                </label>
                <label>Height
                  <NumericInput ariaLabel="Package height cm" value={fields.height}
                    required ariaInvalid={showMeasurementError && !(fields.height > 0)}
                    onCommit={(value) => updateField("height", value)} />
                  <span>cm</span>
                </label>
              </div>
              {showMeasurementError && !hasValidPackageMeasurements && (
                <p className="inline-error" role="alert">
                  Add package weight, length, width, and height before final submission.
                </p>
              )}
            </fieldset>
          </div>
          <div className="generation-actions">
            <button className="generate-button" onClick={startGeneration}
              disabled={!sourceFilesReady || uploadSourceTask.status === "loading"}>
              {workflowLoading || uploadSourceTask.status === "loading"
                ? <Loader2 className="spin" size={16} />
                : <Sparkles size={16} />}
              {!sourceFilesReady
                ? "正在恢复源图"
                : uploadSourceTask.status === "loading" ? "正在优化源图" : "开始 AI 生成"}
            </button>
            <button type="button" className="secondary-action" onClick={cancelAllTasks}
              disabled={!workflowLoading && marketTask.status !== "loading" &&
                uploadSourceTask.status !== "loading" && uploadStatus !== "loading"}>
              <Square size={14} aria-hidden="true" /> 取消
            </button>
            <button type="button" className="secondary-action" onClick={() => void retryAllFailedTasks()}
              disabled={!hasRetryableTasks || workflowLoading || !sourceFilesReady}>
              <RotateCcw size={14} aria-hidden="true" /> 全部重试
            </button>
          </div>
        </aside>

        <section className="editor" aria-labelledby={`${domIdPrefix}editor-heading`}>
          <div className="editor-intro">
            <div><span className="section-index">02</span><h2 id={`${domIdPrefix}editor-heading`}>Product record</h2></div>
            <div className={`status status-${statusTone(copyTask.status, uploadStatus)}`}
              role="status" aria-label="Workflow status" aria-live="polite">{pageSummary}</div>
          </div>

          <TaskStatusCards copyTask={copyTask} uploadSourceTask={uploadSourceTask}
            imageRoles={imageRoles} completedImageCount={completedImageCount}
            failedImageCount={failedImageCount} hasTaskError={hasTaskError}
            onRetryCopy={() => runCopyTask()} />

          {researchEvidence && (
            <section className="research-evidence" aria-labelledby={`${domIdPrefix}research-evidence-heading`}>
              <div className="research-evidence-head">
                <h3 id={`${domIdPrefix}research-evidence-heading`}>Research evidence</h3>
                <span>{researchEvidence.confidence} confidence</span>
              </div>
              <p>{researchEvidence.matchSummary}</p>
              <ul>
                {researchEvidence.sources
                  .filter((source) => isHttpsUrl(source.url))
                  .map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                      <small>{source.evidence}</small>
                    </li>
                  ))}
              </ul>
              {researchIssues.length > 0 && (
                <ul className="research-issues" aria-label="Unresolved product issues">
                  {researchIssues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              )}
            </section>
          )}

          <MarketAnalysisPanel analysis={marketAnalysis} task={marketTask}
            canAnalyze={Boolean(fields.product_name.trim()) && fields.rrp > 0}
            idPrefix={domIdPrefix} onRetry={() => void runMarketAnalysis()} />

          <nav className="editor-tabs" role="tablist" aria-label="Product editor sections">
            {editorTabs.map((tab, index) => (
              <button key={tab.id} id={`${domIdPrefix}tab-${tab.id}`} role="tab"
                ref={(node) => { tabRefs.current[index] = node; }}
                aria-selected={activeTab === tab.id}
                aria-controls={`${domIdPrefix}panel-${tab.id}`}
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
            <section id={`${domIdPrefix}panel-details`} role="tabpanel" aria-labelledby={`${domIdPrefix}tab-details`}
              hidden={activeTab !== "details"} className="tab-panel">
              <DetailsPanel fields={fields} onUpdate={updateField} />
            </section>

            <section id={`${domIdPrefix}panel-price`} role="tabpanel" aria-labelledby={`${domIdPrefix}tab-price`}
              hidden={activeTab !== "price"} className="tab-panel">
              <PricePanel fields={fields} onUpdate={updateField} />
            </section>

            <section id={`${domIdPrefix}panel-shipping`} role="tabpanel" aria-labelledby={`${domIdPrefix}tab-shipping`}
              hidden={activeTab !== "shipping"} className="tab-panel shipping-panel">
              <ShippingPanel billableWeight={billableWeight} />
            </section>

            <section id={`${domIdPrefix}panel-images`} role="tabpanel" aria-labelledby={`${domIdPrefix}tab-images`}
              hidden={activeTab !== "images"} className="tab-panel">
              <ImagesPanel imageRoles={imageRoles} idPrefix={domIdPrefix}
                onRetry={runImageRole} onReplace={replaceImageRole} />
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
            <span>{isReadyToSubmit ? "Required fields and an uploadable image are ready" : submitReason}</span></p>
        </div>
        <button className="primary-submit" onClick={uploadProduct}
          disabled={!isReadyToSubmit || uploadStatus === "loading"}
          aria-describedby={`${domIdPrefix}submit-reason`}>
          {uploadStatus === "loading" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          验证并提交审核
        </button>
        <span id={`${domIdPrefix}submit-reason`} className="sr-only">{submitReason}</span>
      </footer>
    </>
  );
}

function createImageTaskScheduler(limit: number): ImageTaskScheduler {
  let activeTasks = 0;
  const waitingTasks: Array<() => void> = [];

  function startNext() {
    while (activeTasks < limit && waitingTasks.length > 0) {
      waitingTasks.shift()?.();
    }
  }

  return {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waitingTasks.push(() => {
          activeTasks += 1;
          void Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              activeTasks -= 1;
              startNext();
            });
        });
        startNext();
      });
    }
  };
}

function sameJobSummary(left: ProductJobSummary, right: ProductJobSummary): boolean {
  return left.phase === right.phase &&
    left.completedImages === right.completedImages &&
    left.failedImages === right.failedImages &&
    left.ready === right.ready &&
    left.submitted === right.submitted &&
    left.sku === right.sku &&
    left.eanCode === right.eanCode;
}

function productJobSummaryLabel(summary: ProductJobSummary): string {
  if (summary.submitted) return "已提交";
  if (summary.phase === "loading") return `生成中 ${summary.completedImages}/5`;
  if (summary.phase === "error") return summary.failedImages > 0
    ? `失败 ${summary.failedImages} · 图片 ${summary.completedImages}/5`
    : "需要处理";
  if (summary.phase === "stale") return "内容已过期";
  if (summary.phase === "success") return summary.ready ? "待审核" : "待补资料";
  return `等待中 · 图片 ${summary.completedImages}/5`;
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() ? parsed : undefined;
}

function recalculatePrices(
  fields: DszProductFields,
  purchasePriceCny: number | undefined,
  manualFields: Set<keyof DszProductFields>
): DszProductFields {
  const next = { ...fields };
  const canCalculate =
    purchasePriceCny !== undefined &&
    purchasePriceCny > 0 &&
    next.weight > 0 &&
    next.length > 0 &&
    next.width > 0 &&
    next.height > 0;

  if (!manualFields.has("vendor_price")) {
    next.vendor_price = canCalculate
      ? calculateVendorPrice({
          weightKg: next.weight,
          lengthCm: next.length,
          widthCm: next.width,
          heightCm: next.height,
          purchasePriceCny
        })
      : 0;
  }
  if (!manualFields.has("rrp")) {
    next.rrp = next.vendor_price > 0
      ? calculateVendorRrp(next.vendor_price)
      : 0;
  }

  return next;
}

function marketVerdictLabel(position: AmazonMarketAnalysis["pricePosition"]): string {
  return {
    strong_advantage: "明显价格优势",
    moderate_advantage: "轻度价格优势",
    market_aligned: "接近市场价格",
    above_market: "高于市场价格",
    unavailable: "数据不足"
  }[position];
}

function marketConfidenceLabel(confidence: AmazonMarketAnalysis["confidence"]): string {
  return { high: "高", medium: "中", low: "低" }[confidence];
}

function formatAud(value: number): string {
  return `A$${value.toFixed(2)}`;
}

function formatNullableAud(value: number | null): string {
  return value === null ? "—" : formatAud(value);
}

function formatAudRange(minimum: number | null, maximum: number | null): string {
  return minimum === null || maximum === null
    ? "—"
    : `${formatAud(minimum)}–${formatAud(maximum)}`;
}

function formatAdvantage(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
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
  workflowLoading: boolean
): string {
  if (workflowLoading) return "AI generation is still in progress";
  const uploadableImages = PRODUCT_IMAGE_ROLES.filter((role) =>
    isHttpsUrl(imageRoles[role].imageUrl)
  ).length;
  if (uploadableImages === 0) return "Add at least one HTTPS product image";
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
    fields.colour.trim() &&
    fields.description.trim() &&
    [0, 1].includes(fields.status) &&
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
