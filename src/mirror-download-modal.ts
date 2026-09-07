import { App, Modal, Notice } from "obsidian";
import { MirrorEntry, MirrorTaskStopped } from "./mirror-download";

type Translate = (key: string, params?: Record<string, unknown>) => string;
export class MirrorDownloadModal extends Modal {
  private entries: MirrorEntry[] = [];
  private stopped = false;
  private closed = false;
  private busy = false;
  private ready = false;
  private page = 0;
  private message = "";
  private lastRender = 0;

  private renderProgress(): void {
    if (!this.closed && Date.now() - this.lastRender >= 200) this.render();
  }

  constructor(
    app: App,
    private readonly t: Translate,
    private readonly prepare: (check: () => void, progress: (count: number) => void) => Promise<MirrorEntry[]>,
    private readonly restore: (entry: MirrorEntry, check: () => void) => Promise<void>,
    private readonly release: () => void
  ) { super(app); }

  private check = (): void => {
    if (this.stopped) throw new MirrorTaskStopped();
  };

  onOpen(): void { void this.run(true); }

  private async run(preview: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.message = this.t(preview ? "mirrorPreviewWorking" : "migrationWorking");
    this.render();
    try {
      if (preview) {
        this.entries = await this.prepare(this.check, (count) => {
          this.message = this.t("mirrorPreviewProgress", { count });
          this.renderProgress();
        });
        this.ready = true;
      } else {
        for (const entry of this.entries) {
          this.check();
          await this.restore(entry, this.check);
          this.renderProgress();
        }
        this.check();
        this.ready = false;
      }
      this.message = this.t(preview ? "mirrorPreviewReady" : "mirrorFinished");
    } catch (error) {
      this.ready = false;
      this.message = this.t(error instanceof MirrorTaskStopped ? "mirrorStopped" : "mirrorFailed");
    } finally {
      this.busy = false;
      if (this.closed) this.release();
      else this.render();
    }
  }

  private render(): void {
    this.lastRender = Date.now();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("s3-image-sync-audit-modal");
    contentEl.createEl("h2", { text: this.t("mirrorPreviewTitle") });
    contentEl.createEl("p", { text: this.t("mirrorPreviewExplanation") });
    contentEl.createEl("p", { text: this.message, attr: { "aria-live": "polite" } });
    const counts = new Map<string, number>();
    for (const entry of this.entries) counts.set(entry.status, (counts.get(entry.status) || 0) + 1);
    const summary = contentEl.createDiv({ cls: "s3-image-sync-audit-counts" });
    for (const [status, count] of counts) summary.createSpan({ text: `${this.t(`mirrorStatus_${status}`)}: ${count}` });
    const list = contentEl.createDiv({ cls: "s3-image-sync-audit-list" });
    for (const entry of this.entries.slice(this.page * 50, (this.page + 1) * 50)) {
      const row = list.createDiv({ cls: "s3-image-sync-audit-row" });
      row.createEl("strong", { text: this.t(`mirrorStatus_${entry.status}`) });
      if (entry.failure) row.createDiv({ text: this.t(`mirrorFailure_${entry.failure}`) });
      row.createEl("code", { text: entry.localPath || entry.key });
      row.createDiv({ text: entry.notePaths.join("、"), cls: "setting-item-description" });
    }
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    if (this.entries.length > 50) {
      const previous = actions.createEl("button", { text: this.t("mirrorPrevious") });
      previous.disabled = this.page === 0;
      previous.addEventListener("click", () => { this.page--; this.render(); });
      actions.createSpan({ text: `${this.page + 1}/${Math.ceil(this.entries.length / 50)}` });
      const next = actions.createEl("button", { text: this.t("mirrorNext") });
      next.disabled = (this.page + 1) * 50 >= this.entries.length;
      next.addEventListener("click", () => { this.page++; this.render(); });
    }
    if (this.ready && !this.busy && !this.stopped) {
      const start = actions.createEl("button", { text: this.t("mirrorRestoreMissing"), cls: "mod-cta" });
      start.disabled = !this.entries.some((entry) => entry.status === "missing");
      start.addEventListener("click", () => { void this.run(false); });
    }
    if (!this.busy && this.entries.length > 0) {
      const copy = actions.createEl("button", { text: this.t("mirrorCopyReport") });
      copy.addEventListener("click", () => {
        const report = JSON.stringify({ format: 1, operation: "restore-missing-mirror", message: this.message, entries: this.entries }, null, 2);
        void this.copyReport(report);
      });
    }
    if (this.busy) {
      const cancel = actions.createEl("button", { text: this.t("cancel") });
      cancel.disabled = this.stopped;
      cancel.addEventListener("click", () => { this.stopped = true; this.message = this.t("mirrorStopping"); this.render(); });
    }
    const close = actions.createEl("button", { text: this.t("close") });
    close.addEventListener("click", () => this.close());
  }

  private async copyReport(report: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(report);
      new Notice(this.t("mirrorCopied"));
    } catch {
      new Notice(this.t("mirrorCopyFailed"));
    }
  }

  onClose(): void {
    this.closed = true;
    this.stopped = true;
    this.contentEl.empty();
    if (!this.busy) this.release();
  }
}
