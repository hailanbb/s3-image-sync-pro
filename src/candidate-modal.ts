import { App, Modal, Notice, TFile } from "obsidian";
import type S3ImageSyncPlugin from "./plugin";
import { Candidate, ProgressState, LocalFileRecord } from "./types";
import { formatBytes, isPreviewableImage } from "./utils";

export class CandidateModal extends Modal {
  plugin: S3ImageSyncPlugin;
  noteFile: TFile;
  candidates: Candidate[];
  selected: Set<string>;
  
  // UI Elements for efficient updates
  private selectAllCb: HTMLInputElement | null = null;
  private cardMap: Map<string, HTMLElement> = new Map();
  private progressFill: HTMLElement | null = null;
  progressText: HTMLElement | null = null;

  constructor(app: App, plugin: S3ImageSyncPlugin, noteFile: TFile, candidates: Candidate[]) {
    super(app);
    this.plugin = plugin;
    this.noteFile = noteFile;
    this.candidates = candidates;
    this.selected = new Set(candidates.map((c) => c.file.path));
  }

  onOpen(): void {
    this.modalEl.addClass("attachment-imagebed-manager-modal");
    this.renderGalleryView();
  }

  private renderGalleryView(): void {
    const { contentEl } = this;
    contentEl.empty();
    
    // Create modern modal wrapper structure
    const container = contentEl.createDiv({ cls: "attachment-imagebed-manager-modal-content" });
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);

    // 1. Header
    const header = container.createDiv({ cls: "attachment-imagebed-manager-header" });
    header.createEl("h2", { text: t("replaceTitle") });
    header.createEl("p", {
      text: t("candidateSummary", { path: this.noteFile.path, count: this.candidates.length }),
      cls: "attachment-imagebed-manager-summary",
    });

    // 2. Gallery Container
    const galleryContainer = container.createDiv({ cls: "attachment-imagebed-manager-gallery-container" });
    const gallery = galleryContainer.createDiv({ cls: "attachment-imagebed-manager-gallery" });
    
    this.cardMap.clear();

    for (const candidate of this.candidates) {
      const path = candidate.file.path;
      const card = gallery.createDiv({ cls: "attachment-imagebed-manager-gallery-card" });
      if (this.selected.has(path)) {
        card.addClass("is-selected");
      }
      this.cardMap.set(path, card);

      // Card Preview Area
      const previewArea = card.createDiv({ cls: "attachment-imagebed-manager-gallery-preview" });
      
      // Custom Checkbox Indicator overlay on top-left of image preview
      const checkIcon = previewArea.createDiv({ cls: "attachment-imagebed-manager-gallery-check" });
      const svg = activeDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      const svgPath = activeDocument.createElementNS("http://www.w3.org/2000/svg", "path");
      svgPath.setAttribute("d", "M20 6L9 17l-5-5");
      svg.appendChild(svgPath);
      checkIcon.appendChild(svg);

      if (isPreviewableImage(candidate.file.extension)) {
        const image = previewArea.createEl("img");
        image.src = this.app.vault.getResourcePath(candidate.file);
        image.alt = candidate.file.name;
        image.loading = "lazy";
      } else {
        const badge = previewArea.createDiv({ cls: "attachment-imagebed-manager-gallery-badge" });
        badge.textContent = candidate.file.extension.toUpperCase();
      }

      // Card Info Section
      const info = card.createDiv({ cls: "attachment-imagebed-manager-gallery-info" });
      info.createDiv({ 
        text: candidate.file.name, 
        cls: "attachment-imagebed-manager-gallery-name", 
        title: candidate.file.name 
      });
      info.createDiv({ 
        text: formatBytes(candidate.sizeBytes), 
        cls: "attachment-imagebed-manager-gallery-size" 
      });

      // Click event to toggle selection cleanly without page re-render
      card.addEventListener("click", () => {
        this.toggleSelection(path);
      });
    }

    // 3. Bottom Bar
    const bottomBar = container.createDiv({ cls: "attachment-imagebed-manager-bottom-bar" });
    
    const selectAllLabel = bottomBar.createEl("label", { cls: "attachment-imagebed-manager-select-all" });
    this.selectAllCb = selectAllLabel.createEl("input", { type: "checkbox" });
    this.updateSelectAllCheckbox();
    
    this.selectAllCb.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) {
        for (const c of this.candidates) this.selected.add(c.file.path);
      } else {
        this.selected.clear();
      }
      this.updateAllCards();
    });
    selectAllLabel.createSpan({ text: t("selectAll") });

    const actions = bottomBar.createDiv({ cls: "attachment-imagebed-manager-actions" });
    
    const cancelBtn = actions.createEl("button", { text: t("cancel") });
    cancelBtn.addEventListener("click", () => this.close());
    
    const uploadBtn = actions.createEl("button", {
      text: t("uploadReplace"),
      cls: "mod-cta"
    });
    uploadBtn.addEventListener("click", () => {
      void this.replaceSelected();
    });
  }

  private toggleSelection(path: string): void {
    if (this.selected.has(path)) {
      this.selected.delete(path);
    } else {
      this.selected.add(path);
    }
    this.updateCard(path);
    this.updateSelectAllCheckbox();
  }

  private updateCard(path: string): void {
    const card = this.cardMap.get(path);
    if (!card) return;
    if (this.selected.has(path)) {
      card.addClass("is-selected");
    } else {
      card.removeClass("is-selected");
    }
  }

  private updateAllCards(): void {
    for (const path of this.cardMap.keys()) {
      this.updateCard(path);
    }
  }

  private updateSelectAllCheckbox(): void {
    if (!this.selectAllCb) return;
    this.selectAllCb.checked = this.candidates.length > 0 && this.selected.size === this.candidates.length;
    this.selectAllCb.indeterminate = this.selected.size > 0 && this.selected.size < this.candidates.length;
  }

  async replaceSelected(): Promise<void> {
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);
    const chosen = this.candidates.filter((c) => this.selected.has(c.file.path));
    if (!chosen.length) {
      new Notice(t("noSelected"));
      return;
    }
    this.renderProgress(chosen.length);
    try {
      const result = await this.plugin.replaceCandidates(this.noteFile, chosen, (state) => {
        this.updateProgress(state);
      });
      new Notice(t("replacedNotice", { count: result.replaced }));
      this.renderDeleteConfirmation(result.localFiles || []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Attachment replacement failed", error);
      new Notice(t("replaceFailed", { error: message }), 10000);
      this.renderError(error instanceof Error ? error : new Error(message));
    }
  }

  renderProgress(total: number): void {
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();
    
    const container = contentEl.createDiv({ cls: "attachment-imagebed-manager-modal-content" });
    const view = container.createDiv({ cls: "attachment-imagebed-manager-progress-view" });
    
    view.createEl("h2", { text: t("uploadingTitle") });
    view.createEl("p", {
      text: t("preparing", { count: total }),
      cls: "attachment-imagebed-manager-summary",
    });

    const barContainer = view.createDiv({ cls: "attachment-imagebed-manager-progress-bar-container" });
    this.progressFill = barContainer.createDiv({ cls: "attachment-imagebed-manager-progress-fill" });
    this.progressFill.setCssStyles({ width: "0%" });

    this.progressText = view.createDiv({
      text: t("starting"),
      cls: "attachment-imagebed-manager-progress-text",
    });
  }

  updateProgress(state: ProgressState): void {
    if (!this.progressFill || !this.progressText) return;
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);
    const total = Math.max(1, state.total || 1);
    const value = Math.min(100, Math.round(((state.current || 0) / total) * 100));
    
    this.progressFill.setCssStyles({ width: `${value}%` });
    
    const phaseMap: Record<string, string> = {
      uploading: t("phaseUploading"),
      uploaded: t("phaseUploaded"),
      rewriting: t("phaseRewriting"),
      trashing: t("phaseTrashing"),
      scheduling: t("phaseScheduling"),
      done: t("phaseDone"),
    };
    const phaseText = phaseMap[state.phase] || state.phase;
    this.progressText.setText(`${phaseText}: ${state.label || ""} (${state.current || 0}/${total})`);
  }

  renderDeleteConfirmation(localFiles: LocalFileRecord[]): void {
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();

    const container = contentEl.createDiv({ cls: "attachment-imagebed-manager-modal-content" });
    const view = container.createDiv({ cls: "attachment-imagebed-manager-delete-view" });
    
    view.createEl("h2", { text: t("linksReplacedTitle") });
    view.createEl("p", {
      text: t("linksReplacedDesc"),
      cls: "attachment-imagebed-manager-summary",
    });

    if (localFiles.length) {
      const list = view.createDiv({ cls: "attachment-imagebed-manager-delete-list" });
      for (const fileRecord of localFiles) {
        const item = list.createDiv({ cls: "attachment-imagebed-manager-delete-item" });
        item.createDiv({ text: fileRecord.name });
        item.createDiv({ text: fileRecord.path, cls: "attachment-imagebed-manager-delete-item-path" });
      }
    }

    const actions = view.createDiv({ cls: "attachment-imagebed-manager-delete-actions" });
    
    const keepBtn = actions.createEl("button", { text: t("keepLocal") });
    keepBtn.addEventListener("click", () => this.close());

    const deleteBtn = actions.createEl("button", {
      text: t("deleteLocal"),
      cls: "mod-warning"
    });
    deleteBtn.addEventListener("click", () => {
      void (async () => {
        try {
          await this.plugin.deleteLocalFileRecords(this.noteFile, localFiles, "manual-delete");
          new Notice(t("movedToTrash", { count: localFiles.length }));
          this.close();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Attachment local delete failed", error);
          new Notice(t("localDeleteFailed", { error: message }), 10000);
          this.renderError(error instanceof Error ? error : new Error(message));
        }
      })();
    });
  }

  renderError(error: Error): void {
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();

    const container = contentEl.createDiv({ cls: "attachment-imagebed-manager-modal-content" });
    const view = container.createDiv({ cls: "attachment-imagebed-manager-delete-view" });
    
    view.createEl("h2", { text: "Error" });
    view.createEl("p", {
      text: error.message || String(error),
      cls: "attachment-imagebed-manager-summary",
    });

    const actions = view.createDiv({ cls: "attachment-imagebed-manager-delete-actions" });
    const closeBtn = actions.createEl("button", { text: t("close") });
    closeBtn.addEventListener("click", () => this.close());
  }
}
