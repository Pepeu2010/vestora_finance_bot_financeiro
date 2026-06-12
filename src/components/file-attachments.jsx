import { useMemo } from "react";

const FILE_KIND_META = {
  pdf: { icon: "PDF", label: "Documento PDF" },
  doc: { icon: "DOC", label: "Documento" },
  docx: { icon: "DOC", label: "Documento" },
  txt: { icon: "TXT", label: "Texto" },
  xls: { icon: "XLS", label: "Planilha" },
  xlsx: { icon: "XLS", label: "Planilha" },
  csv: { icon: "CSV", label: "CSV" },
  png: { icon: "IMG", label: "Imagem" },
  jpg: { icon: "IMG", label: "Imagem" },
  jpeg: { icon: "IMG", label: "Imagem" },
  webp: { icon: "IMG", label: "Imagem" }
};

export const ACCEPTED_EXTENSIONS = Object.keys(FILE_KIND_META);
export const ACCEPTED_FILE_TYPES = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".xls",
  ".xlsx",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp"
].join(",");

export const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;

export function getFileExtension(name = "") {
  const parts = String(name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

export function getFileKindMeta(name = "") {
  return FILE_KIND_META[getFileExtension(name)] || { icon: "FILE", label: "Arquivo" };
}

export function formatFileSize(size = 0) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function buildAttachmentDescriptor(file, overrides = {}) {
  const meta = getFileKindMeta(file.name);
  return {
    id: overrides.id || crypto.randomUUID(),
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    extension: getFileExtension(file.name),
    category: meta.label,
    status: overrides.status || "ready",
    error: overrides.error || "",
    previewUrl: overrides.previewUrl || null
  };
}

export function FileUploadButton({ disabled = false, onClick, inputId }) {
  return (
    <button
      id="fileUploadButton"
      type="button"
      className="file-upload-button"
      aria-label="Anexar arquivos"
      title="Anexar arquivos"
      disabled={disabled}
      onClick={onClick}
      data-input-id={inputId}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 1 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
      </svg>
    </button>
  );
}

export function FilePreviewItem({ attachment, onRemove, compact = false, disabled = false }) {
  const meta = useMemo(() => getFileKindMeta(attachment.name), [attachment.name]);
  const statusLabel = attachment.status === "uploading"
    ? "Preparando..."
    : attachment.status === "error"
      ? attachment.error || "Falha"
      : attachment.status === "sent"
        ? "Enviado"
        : "Pronto";

  return (
    <div className={`file-preview-item${compact ? " compact" : ""} status-${attachment.status || "ready"}`}>
      <span className="file-preview-icon" aria-hidden="true">{meta.icon}</span>
      <div className="file-preview-meta">
        <strong title={attachment.name}>{attachment.name}</strong>
        <small>{formatFileSize(attachment.size)} • {statusLabel}</small>
      </div>
      {onRemove && (
        <button
          type="button"
          className="file-preview-remove"
          aria-label={`Remover ${attachment.name}`}
          title="Remover arquivo"
          disabled={disabled}
          onClick={() => onRemove(attachment.id)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function FilePreviewList({ attachments, onRemove, disabled = false, compact = false }) {
  if (!attachments?.length) return null;

  return (
    <div className={`file-preview-list${compact ? " compact" : ""}`} aria-label="Arquivos anexados">
      {attachments.map((attachment) => (
        <FilePreviewItem
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemove}
          disabled={disabled}
          compact={compact}
        />
      ))}
    </div>
  );
}

export function DragDropZone({
  isActive = false,
  disabled = false,
  onDrop,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onPaste,
  children
}) {
  return (
    <div
      className={`drag-drop-zone${isActive ? " active" : ""}${disabled ? " disabled" : ""}`}
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onPaste={onPaste}
    >
      {children}
      {isActive && (
        <div className="drag-drop-overlay" aria-hidden="true">
          <div className="drag-drop-copy">
            <strong>Solte seus arquivos aqui</strong>
            <small>PDFs, planilhas, imagens e documentos financeiros</small>
          </div>
        </div>
      )}
    </div>
  );
}
