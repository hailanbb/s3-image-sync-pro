import { App, Modal, Setting } from "obsidian";
import type S3ImageSyncPlugin from "./plugin";

export class DryRunModal extends Modal {
  plugin: S3ImageSyncPlugin;
  count: number;
  samples: string[];

  constructor(app: App, plugin: S3ImageSyncPlugin, count: number, samples: string[]) {
    super(app);
    this.plugin = plugin;
    this.count = count;
    this.samples = samples;
  }

  onOpen(): void {
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName(t("vaultScanTitle")).setHeading();
    contentEl.createEl("p", { text: t("vaultScanFound", { count: this.count }) });
    if (this.samples.length) {
      contentEl.createEl("pre", {
        text: this.samples.join("\n"),
        cls: "attachment-imagebed-manager-log",
      });
    }
  }
}
