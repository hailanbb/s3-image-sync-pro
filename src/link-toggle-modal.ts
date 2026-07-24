import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type S3ImageSyncPlugin from "./plugin";

export class LinkToggleModal extends Modal {
  plugin: S3ImageSyncPlugin;
  toggleScope: "current" | "vault";
  targetMode: "local" | "cloud";

  constructor(app: App, plugin: S3ImageSyncPlugin) {
    super(app);
    this.plugin = plugin;
    this.toggleScope = "current";
    this.targetMode = plugin.settings.linkMode === "local" ? "cloud" : "local";
  }

  onOpen(): void {
    const { contentEl } = this;
    const t = (k: string, p?: Record<string, unknown>) => this.plugin.t(k, p);

    contentEl.createEl("h2", { text: t("toggleLinkTitle") });
    contentEl.createEl("p", { text: t("toggleLinkDesc") });

    const currentMode = this.plugin.settings.linkMode;
    contentEl.createEl("p", {
      text: t("toggleLinkCurrent", { mode: currentMode === "local" ? t("linkModeLocal") : t("linkModeCloud") }),
      cls: "s3-toggle-current-mode",
    });

    new Setting(contentEl)
      .setName(t("toggleLinkTarget"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", t("linkModeLocal"))
          .addOption("cloud", t("linkModeCloud"))
          .setValue(this.targetMode)
          .onChange((v) => { this.targetMode = v as "local" | "cloud"; })
      );

    new Setting(contentEl)
      .setName(t("toggleLinkScope"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("current", t("toggleScopeCurrent"))
          .addOption("vault", t("toggleScopeVault"))
          .setValue(this.toggleScope)
          .onChange((v) => { this.toggleScope = v as "current" | "vault"; })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(t("toggleLinkConfirm"))
          .setCta()
          .onClick(async () => {
            this.close();
            await this.plugin.executeToggleLinks(this.targetMode, this.toggleScope);
          })
      )
      .addButton((btn) =>
        btn.setButtonText(t("toggleLinkCancel")).onClick(() => this.close())
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
