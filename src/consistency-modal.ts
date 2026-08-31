import { App, Modal } from "obsidian";
import type S3ImageSyncPlugin from "./plugin";
import type { ConsistencyAuditReport, ConsistencyIssueType } from "./consistency-audit";

const DISPLAY_ORDER: readonly ConsistencyIssueType[] = [
  "path-mismatch",
  "missing-cloud",
  "missing-local",
  "size-mismatch",
  "hash-mismatch",
  "local-orphan",
  "cloud-orphan",
  "protected",
  "unverified",
  "ok",
];

export class ConsistencyAuditModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: S3ImageSyncPlugin,
    private readonly report: ConsistencyAuditReport,
    private readonly deep: boolean
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("s3-image-sync-audit-modal");
    contentEl.createEl("h2", { text: this.plugin.t(this.deep ? "deepAuditTitle" : "quickAuditTitle") });

    const summary = this.report.summary;
    contentEl.createEl("p", {
      text: this.plugin.t("auditSummary", {
        refs: summary.referencedKeyCount,
        local: summary.localObjectCount,
        cloud: summary.cloudObjectCount,
        issues: summary.issueCount,
      }),
    });
    contentEl.createEl("p", {
      text: this.plugin.t(this.deep ? "deepAuditExplanation" : "quickAuditExplanation"),
      cls: "setting-item-description",
    });

    const counts = contentEl.createDiv({ cls: "s3-image-sync-audit-counts" });
    for (const type of DISPLAY_ORDER) {
      const count = summary.counts[type];
      if (count > 0) {
        counts.createSpan({ text: `${this.plugin.t(`auditType_${type}`)}: ${count}` });
      }
    }

    const actionable = this.report.issues.filter((issue) => issue.type !== "ok");
    if (actionable.length === 0) {
      contentEl.createEl("p", { text: this.plugin.t("auditNoIssues") });
    } else {
      const list = contentEl.createDiv({ cls: "s3-image-sync-audit-list" });
      for (const issue of actionable.slice(0, 500)) {
        const row = list.createDiv({ cls: "s3-image-sync-audit-row" });
        row.createEl("strong", { text: this.plugin.t(`auditType_${issue.type}`) });
        row.createEl("code", { text: issue.key });
        if (issue.expectedKey) {
          row.createDiv({
            text: this.plugin.t("auditExpectedPath", { path: issue.expectedKey }),
            cls: "setting-item-description",
          });
        }
        if (issue.notePaths.length > 0) {
          row.createDiv({
            text: issue.notePaths.join("、"),
            cls: "setting-item-description",
          });
        }
        if (issue.protectedPrefix) {
          row.createDiv({
            text: this.plugin.t("auditProtectedBy", { prefix: issue.protectedPrefix }),
            cls: "setting-item-description",
          });
        }
      }
      if (actionable.length > 500) {
        contentEl.createEl("p", { text: this.plugin.t("auditTruncated", { count: actionable.length - 500 }) });
      }
    }

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const closeButton = actions.createEl("button", { text: this.plugin.t("close") });
    closeButton.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
