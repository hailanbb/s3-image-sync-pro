import { App, Modal, Setting } from "obsidian";
import type S3ImageSyncPlugin from "./plugin";

export class DryRunModal extends Modal {
  plugin: S3ImageSyncPlugin;
  localCount: number;
  remoteCount: number;
  samples: string[];

  constructor(app: App, plugin: S3ImageSyncPlugin, localCount: number, remoteCount: number, samples: string[]) {
    super(app);
    this.plugin = plugin;
    this.localCount = localCount;
    this.remoteCount = remoteCount;
    this.samples = samples;
  }

  onOpen(): void {
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName(t("vaultScanTitle")).setHeading();
    contentEl.createEl("p", { text: t("vaultScanFound", { count: this.localCount + this.remoteCount }) });
    contentEl.createEl("p", {
      text: `本地候选: ${this.localCount}  |  远程候选: ${this.remoteCount}`,
      cls: "attachment-imagebed-manager-meta",
    });
    if (this.samples.length) {
      contentEl.createEl("pre", {
        text: this.samples.join("\n"),
        cls: "attachment-imagebed-manager-log",
      });
    }
  }
}
