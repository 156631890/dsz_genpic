import type {
  AmazonMarketAnalysis,
  DszProductFields,
  ProductImageRole,
  ProductResearchEvidence
} from "../shared/product";

export type Status = "idle" | "loading" | "success" | "error" | "stale";
export type EditorTab = "details" | "price" | "shipping" | "images";

export interface TaskState {
  status: Status;
  error: string;
}

export interface ImageRoleState extends TaskState {
  imageUrl: string;
}

export interface OptionalInputs {
  categoryHint: string;
  purchasePriceCny: string;
}

export interface ProductJobDefinition {
  id: string;
  number: number;
  name?: string;
}

export interface ProductStudioState {
  version: 1;
  jobs: ProductJobDefinition[];
  activeJobId: string;
  nextJobNumber: number;
}

export interface ProductWorkspaceSnapshot {
  version: 1;
  jobId: string;
  updatedAt: string;
  sourceFileCount: number;
  sourceFileNames: string[];
  sellingPoints: string;
  optionalInputs: OptionalInputs;
  fields: DszProductFields;
  copyTask: TaskState;
  uploadSourceTask: TaskState;
  imageRoles: Record<ProductImageRole, ImageRoleState>;
  uploadStatus: Status;
  message: string;
  uploadResult: unknown;
  activeTab: EditorTab;
  researchEvidence: ProductResearchEvidence | null;
  researchIssues: string[];
  marketTask?: TaskState;
  marketAnalysis?: AmazonMarketAnalysis | null;
  manualFields: Array<keyof DszProductFields>;
  fieldEditVersions: Record<keyof DszProductFields, number>;
}

export interface UploadHistoryEntry {
  id: string;
  jobId: string;
  productName: string;
  sku: string;
  eanCode: string;
  uploadedAt: string;
  result: unknown;
}

const STUDIO_STATE_KEY = "dsz_product_studio_state_v1";
const WORKSPACE_KEY_PREFIX = "dsz_product_workspace_v1:";
const UPLOAD_HISTORY_KEY = "dsz_product_upload_history_v1";
const DATABASE_NAME = "dsz-product-studio";
const SOURCE_FILE_STORE = "source-files";
const DATABASE_VERSION = 1;
const HISTORY_LIMIT = 100;
export const REFRESH_INTERRUPTED_ERROR = "页面刷新中断了任务，请重试";

export function loadProductStudioState(): ProductStudioState | null {
  const value = readJson(STUDIO_STATE_KEY);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.jobs)) return null;

  const jobs = value.jobs.filter(isProductJobDefinition);
  if (jobs.length === 0) return null;
  const activeJobId = typeof value.activeJobId === "string" &&
    jobs.some((job) => job.id === value.activeJobId)
    ? value.activeJobId
    : jobs[0].id;
  const highestNumber = Math.max(...jobs.map((job) => job.number));
  const nextJobNumber = typeof value.nextJobNumber === "number" &&
    Number.isInteger(value.nextJobNumber) && value.nextJobNumber > highestNumber
    ? value.nextJobNumber
    : highestNumber + 1;

  return { version: 1, jobs, activeJobId, nextJobNumber };
}

export function saveProductStudioState(state: ProductStudioState): void {
  writeJson(STUDIO_STATE_KEY, state);
}

export function loadProductWorkspace(jobId: string): ProductWorkspaceSnapshot | null {
  const value = readJson(workspaceKey(jobId));
  if (!isWorkspaceSnapshot(value, jobId)) return null;
  return recoverInterruptedTasks(value);
}

export function saveProductWorkspace(snapshot: ProductWorkspaceSnapshot): void {
  writeJson(workspaceKey(snapshot.jobId), snapshot);
}

export async function deleteProductWorkspace(jobId: string): Promise<void> {
  safeLocalStorage()?.removeItem(workspaceKey(jobId));
  const database = await openDatabase();
  if (!database) return;
  await runTransaction(database, "readwrite", (store) => store.delete(jobId));
  database.close();
}

export async function loadProductSourceFiles(jobId: string): Promise<File[]> {
  const database = await openDatabase();
  if (!database) return [];
  const result = await runTransaction<SourceFileRecord | undefined>(
    database,
    "readonly",
    (store) => store.get(jobId)
  );
  database.close();
  return Array.isArray(result?.files)
    ? result.files.filter(isStoredSourceFile).map((file) => new File(
        [file.blob],
        file.name,
        { type: file.type, lastModified: file.lastModified }
      ))
    : [];
}

export async function saveProductSourceFiles(jobId: string, files: File[]): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  const record: SourceFileRecord = {
    jobId,
    files: files.map((file) => ({
      blob: file.slice(0, file.size, file.type),
      name: file.name,
      type: file.type,
      lastModified: file.lastModified
    })),
    savedAt: new Date().toISOString()
  };
  await runTransaction(database, "readwrite", (store) => store.put(record));
  database.close();
}

export function loadUploadHistory(): UploadHistoryEntry[] {
  const value = readJson(UPLOAD_HISTORY_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isUploadHistoryEntry).slice(0, HISTORY_LIMIT);
}

export function saveUploadHistory(entries: UploadHistoryEntry[]): void {
  writeJson(UPLOAD_HISTORY_KEY, entries.slice(0, HISTORY_LIMIT));
}

export function findDuplicateUpload(
  entries: UploadHistoryEntry[],
  sku: string,
  eanCode: string
): UploadHistoryEntry | undefined {
  const normalizedSku = sku.trim().toLowerCase();
  const normalizedEan = eanCode.trim();
  return entries.find((entry) =>
    (normalizedSku && entry.sku.trim().toLowerCase() === normalizedSku) ||
    (normalizedEan && entry.eanCode.trim() === normalizedEan)
  );
}

function recoverInterruptedTasks(snapshot: ProductWorkspaceSnapshot): ProductWorkspaceSnapshot {
  return {
    ...snapshot,
    copyTask: recoverTask(snapshot.copyTask),
    marketTask: recoverTask(snapshot.marketTask || { status: "idle", error: "" }),
    uploadSourceTask: recoverTask(snapshot.uploadSourceTask),
    imageRoles: Object.fromEntries(Object.entries(snapshot.imageRoles).map(([role, state]) => [
      role,
      state.status === "loading"
        ? { ...state, status: "error", error: REFRESH_INTERRUPTED_ERROR }
        : state
    ])) as Record<ProductImageRole, ImageRoleState>,
    uploadStatus: snapshot.uploadStatus === "loading" ? "error" : snapshot.uploadStatus,
    message: snapshot.uploadStatus === "loading" ? REFRESH_INTERRUPTED_ERROR : snapshot.message
  };
}

function recoverTask(task: TaskState): TaskState {
  return task.status === "loading"
    ? { status: "error", error: REFRESH_INTERRUPTED_ERROR }
    : task;
}

function isWorkspaceSnapshot(value: unknown, jobId: string): value is ProductWorkspaceSnapshot {
  if (!isRecord(value) || value.version !== 1 || value.jobId !== jobId) return false;
  return typeof value.sellingPoints === "string" &&
    isRecord(value.optionalInputs) &&
    isRecord(value.fields) &&
    isTaskState(value.copyTask) &&
    (value.marketTask === undefined || isTaskState(value.marketTask)) &&
    (value.marketAnalysis === undefined || value.marketAnalysis === null ||
      isRecord(value.marketAnalysis)) &&
    isTaskState(value.uploadSourceTask) &&
    isRecord(value.imageRoles) &&
    typeof value.message === "string" &&
    typeof value.sourceFileCount === "number" &&
    Array.isArray(value.sourceFileNames) &&
    Array.isArray(value.researchIssues) &&
    Array.isArray(value.manualFields) &&
    isRecord(value.fieldEditVersions);
}

function isTaskState(value: unknown): value is TaskState {
  return isRecord(value) && isStatus(value.status) && typeof value.error === "string";
}

function isStatus(value: unknown): value is Status {
  return ["idle", "loading", "success", "error", "stale"].includes(String(value));
}

function isProductJobDefinition(value: unknown): value is ProductJobDefinition {
  return isRecord(value) && typeof value.id === "string" &&
    typeof value.number === "number" && Number.isInteger(value.number) && value.number > 0 &&
    (value.name === undefined || typeof value.name === "string");
}

function isUploadHistoryEntry(value: unknown): value is UploadHistoryEntry {
  return isRecord(value) && typeof value.id === "string" &&
    typeof value.jobId === "string" && typeof value.productName === "string" &&
    typeof value.sku === "string" && typeof value.eanCode === "string" &&
    typeof value.uploadedAt === "string";
}

function workspaceKey(jobId: string): string {
  return `${WORKSPACE_KEY_PREFIX}${jobId}`;
}

function readJson(key: string): unknown {
  const storage = safeLocalStorage();
  if (!storage) return null;
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // The live workspace remains usable when browser storage is unavailable.
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

interface SourceFileRecord {
  jobId: string;
  files: StoredSourceFile[];
  savedAt: string;
}

interface StoredSourceFile {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}

function isStoredSourceFile(value: unknown): value is StoredSourceFile {
  return isRecord(value) && typeof value.blob === "object" && value.blob !== null &&
    typeof value.name === "string" && typeof value.type === "string" &&
    typeof value.lastModified === "number";
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SOURCE_FILE_STORE)) {
        database.createObjectStore(SOURCE_FILE_STORE, { keyPath: "jobId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function runTransaction<T = unknown>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_FILE_STORE, mode);
    const request = operation(transaction.objectStore(SOURCE_FILE_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
