export const I18N: Record<string, Record<string, string>> = {
  en: {
    // Ribbon & Commands
    ribbonScan: "Scan current note images",
    commandScanCurrent: "Scan current note images",
    commandScanVault: "Scan vault images without replacing",
    commandProcessDeletes: "Process delayed image deletes",

    // Notices
    disabled: "S3 Image Sync is disabled.",
    openMarkdownFirst: "Open a Markdown note first.",
    noCandidates: "No eligible local images found in this note.",
    autoScanFailed: "Image auto scan failed: {error}",
    delayedDeleteFailed: "S3 Image Sync delayed delete failed",
    autoScanReplaced: "Image auto scan replaced {count} link(s).",
    noteChanged: "Note changed during upload; skipped replacement.",
    originalLinkChanged: "Original link changed before write: {link}",
    missingS3: "Missing S3 settings: {settings}",
    uploadFailed: "S3 upload failed ({status}): {text}",

    // Candidate Modal
    replaceTitle: "Replace note images",
    candidateSummary: "Found {count} local image(s) in this note that can be uploaded.",
    referenceCount: "{count} ref(s)",
    cancel: "Cancel",
    uploadReplace: "Upload & Replace",
    noSelected: "No image selected.",
    replacedNotice: "Replaced {count} link(s) successfully!",
    replaceFailed: "Image replacement failed: {error}",
    uploadingTitle: "Uploading images",
    preparing: "Preparing {count} selected image(s)...",
    starting: "Starting...",
    phaseUploading: "Uploading",
    phaseUploaded: "Uploaded",
    phaseRewriting: "Rewriting note",
    phaseTrashing: "Moving local files to trash",
    phaseScheduling: "Scheduling delayed delete",
    phaseDone: "Done!",
    linksReplacedTitle: "Links replaced successfully!",
    linksReplacedDesc:
      "Local links have been replaced with remote URLs. Do you want to delete the original local files?",
    keepLocal: "Keep local files",
    deleteLocal: "Delete local files",
    movedToTrash: "Moved {count} local file(s) to trash.",
    localDeleteFailed: "Local delete failed: {error}",
    close: "Close",
    viewList: "List",
    viewGallery: "Gallery",
    filterAll: "All",
    filterOther: "Other",
    selectAll: "Select all",

    // Dry Run Modal
    vaultScanTitle: "Vault scan result",
    vaultScanFound: "Found {count} image(s) that would be auto-uploaded.",
    scanningVault: "Scanning vault... ({current}/{total})",

    // Settings - Status
    settingsTitle: "S3 Image Sync",
    setupComplete: "S3 storage is configured and ready to use.",
    setupIncomplete: "S3 storage is not configured yet. Fill in the settings below to get started.",

    // Settings - S3
    s3Storage: "Step 1: Connect your cloud storage",
    s3SetupGuide:
      "Choose a storage provider and fill in the credentials. Your files will be uploaded here and accessed via the public domain.",
    provider: "Storage provider",
    providerDesc: "Cloudflare R2 is recommended — free egress, generous free tier.",
    region: "Region",
    regionDesc: "e.g. us-east-1, ap-southeast-1",
    providerR2: "Cloudflare R2 (recommended)",
    providerS3: "AWS S3",
    providerMinio: "MinIO",
    providerCustom: "Custom S3",
    endpoint: "Endpoint URL",
    endpointDesc: "e.g. https://abc123.r2.cloudflarestorage.com",
    bucketName: "Bucket name",
    bucketNameDesc: "The bucket you created in your storage provider.",
    accessKeyId: "Access Key ID",
    accessKeyIdDesc: "Found in your storage provider's API settings.",
    secretAccessKey: "Secret Access Key",
    publicDomain: "Public access URL",
    publicDomainDesc: "The URL prefix for accessing uploaded files, e.g. https://pub-xxx.r2.dev",
    objectPathTemplate: "Upload path template",
    pathTemplateDesc:
      "Dynamically customize the S3 upload path. Supported variables:\n" +
      "• \\{ext}: File extension (e.g. png, jpg)\n" +
      "• \\{hash}: 64-char full SHA-256 hash\n" +
      "• \\{hash-short}: 32-char short hash\n" +
      "• \\{hash2}: First 2 chars of hash (for partition)\n" +
      "• \\{filename}: Original file name (excluding extension)\n" +
      "• \\{yyyy}: Current year (4 digits)\n" +
      "• \\{MM}: Current month (2 digits)\n" +
      "• \\{dd}: Current day (2 digits)\n" +
      "Default: attachments/\\{ext}/\\{hash2}/\\{hash}.\\{ext}",
    testConnection: "Test connection",
    testConnectionDesc: "Click to verify your credentials are correct.",
    testing: "Testing...",
    testConnectionSuccess: "Connection test passed!",
    testConnectionFailed: "Connection test failed: {error}",

    // Settings - General
    generalSettings: "Step 2: General settings",
    pluginEnabled: "Enable plugin",
    pluginEnabledDesc: "Turn on/off the scanning and replacement features.",
    mobileHint:
      "Note: Scheduled auto-scan and delayed delete are disabled on mobile devices. Manual upload and replacement work normally.",
    attachmentRoot: "Image folder",
    attachmentRootDesc: "Only files under this folder will be processed. Default: 99 Attachments",
    deletePolicy: "After replacing links, delete local files?",
    deletePolicyDesc: "Choose what happens to the original local files after they are replaced with remote URLs.",
    deleteConfirm: "Ask me each time (recommended)",
    deleteImmediate: "Delete immediately after replacement",
    deleteDelayed: "Delete after a delay",
    deleteDelayHours: "Delay before delete (hours)",
    deleteDelayHoursDesc: "Files will be moved to trash after this many hours.",
    automaticScan: "Auto-scan vault periodically",
    automaticScanDesc: "Automatically find and replace eligible images in the background.",
    scanInterval: "Scan interval (minutes)",
    scanIntervalDesc: "How often to scan the vault. Default: 30",
    quietSeconds: "Skip recently modified files (seconds)",
    quietSecondsDesc: "Files modified within this time are skipped by auto-scan. Default: 600 (10 min)",
    autoScanMinSize: "Auto-scan: ignore files smaller than (MiB)",
    autoScanMinSizeDesc: "Only applies to auto-scan. Manual scan is not affected. Set to 0 to upload all files.",

    // Settings - File Types
    fileTypes: "Step 3: Choose file types to upload",
    fileTypesDesc: "Click on a file type to toggle it. Checked types will be uploaded when scanning.",
    extCount: "{enabled}/{total} enabled",
    categoryImage: "Images",
    categoryVideo: "Videos",
    categoryAudio: "Audio",
    categoryDocument: "Documents",
    deselectAll: "Deselect all",
    customExtensions: "Custom file types",
    customExtPlaceholder: "e.g. sketch, fig, psd",
    addExtension: "Add",
    removeExtension: "Remove",
    minSizeSection: "Minimum file size filter (advanced)",
    minSizeSectionDesc: "Only upload files larger than the specified size. Set to 0 to upload all files.",
    minSizeMiB: "Min size (MiB)",
    autoCandidate: "Include in scheduled scan",
    autoScanShort: "Scheduled",
    advancedSettings: "Advanced settings",
    replacementType: "Replacement format",
    markdownLink: "Markdown link",
    imageEmbed: "Image embed",
    audioTag: "Audio tag",
    videoTag: "Video tag",

    // Settings - Log
    recentLog: "Recent activity",
    pendingDeletes: "Pending delayed deletes",
    noLogs: "No activity yet. Scan a note to get started.",
  },
  zh: {
    // Ribbon & Commands
    ribbonScan: "扫描当前文档图片",
    commandScanCurrent: "扫描当前文档图片",
    commandScanVault: "扫描全库图片但不替换",
    commandProcessDeletes: "处理延迟删除图片",

    // Notices
    disabled: "S3 图片同步已停用。",
    openMarkdownFirst: "请先打开一个 Markdown 文档。",
    noCandidates: "当前文档没有可上传替换的本地图片。",
    autoScanFailed: "图片自动扫描失败：{error}",
    delayedDeleteFailed: "S3 图片同步延迟删除失败",
    autoScanReplaced: "图片自动扫描已替换 {count} 个链接。",
    noteChanged: "上传期间文档发生变化，已跳过替换。",
    originalLinkChanged: "原始链接在写入前发生变化：{link}",
    missingS3: "缺少 S3 配置：{settings}",
    uploadFailed: "S3 上传失败（{status}）：{text}",

    // Candidate Modal
    replaceTitle: "替换文档图片",
    candidateSummary: "在当前文档中找到 {count} 个可上传替换的本地图片。",
    referenceCount: "{count} 处引用",
    cancel: "取消",
    uploadReplace: "上传并替换",
    noSelected: "没有选择图片。",
    replacedNotice: "已成功替换 {count} 个链接！",
    replaceFailed: "图片替换失败：{error}",
    uploadingTitle: "正在上传图片",
    preparing: "准备上传 {count} 个已选择图片...",
    starting: "正在开始...",
    phaseUploading: "正在上传",
    phaseUploaded: "已上传",
    phaseRewriting: "正在改写文档",
    phaseTrashing: "正在移动本地文件到回收站",
    phaseScheduling: "正在加入延迟删除队列",
    phaseDone: "完成！",
    linksReplacedTitle: "链接替换成功！",
    linksReplacedDesc: "本地链接已替换为远程 URL。是否删除原本地文件？",
    keepLocal: "保留本地文件",
    deleteLocal: "删除本地文件",
    movedToTrash: "已将 {count} 个本地文件移入回收站。",
    localDeleteFailed: "本地文件删除失败：{error}",
    close: "关闭",
    viewList: "列表",
    viewGallery: "画廊",
    filterAll: "全部",
    filterOther: "其他",
    selectAll: "全选",

    // Dry Run Modal
    vaultScanTitle: "全库扫描结果",
    vaultScanFound: "找到 {count} 个可自动上传的图片。",
    scanningVault: "正在扫描全库...（{current}/{total}）",

    // Settings - Status
    settingsTitle: "S3 图片同步",
    setupComplete: "S3 存储已配置，可以正常使用。",
    setupIncomplete: "S3 存储尚未配置，请先填写下方设置。",

    // Settings - S3
    s3Storage: "第一步：连接云存储",
    s3SetupGuide:
      "选择存储服务商并填写凭据。图片将上传到这里，并通过公开域名访问。",
    provider: "存储服务商",
    providerDesc: "推荐使用 Cloudflare R2 — 免费出站流量，免费额度充足。",
    region: "区域",
    regionDesc: "例如 us-east-1、ap-southeast-1",
    providerR2: "Cloudflare R2（推荐）",
    providerS3: "AWS S3",
    providerMinio: "MinIO",
    providerCustom: "自定义 S3",
    endpoint: "端点 URL",
    endpointDesc: "例如 https://abc123.r2.cloudflarestorage.com",
    bucketName: "存储桶名称",
    bucketNameDesc: "在存储服务商中创建的存储桶。",
    accessKeyId: "Access Key ID",
    accessKeyIdDesc: "在存储服务商的 API 设置中获取。",
    secretAccessKey: "Secret Access Key",
    publicDomain: "公开访问 URL",
    publicDomainDesc: "上传文件的访问前缀，例如 https://pub-xxx.r2.dev",
    objectPathTemplate: "上传路径模板",
    pathTemplateDesc:
      "自定义 S3 上传路径。支持以下变量：\n" +
      "• \\{ext}：文件扩展名/后缀 (如 png、jpg 等)\n" +
      "• \\{hash}：64位完整 SHA-256 文件哈希值\n" +
      "• \\{hash-short}：32位短 SHA-256 文件哈希值\n" +
      "• \\{hash2}：SHA-256 哈希值的前2位字符 (适合海量文件二级分流)\n" +
      "• \\{filename}：原始文件名 (不含扩展名)\n" +
      "• \\{yyyy}：4位当前年份 (如 2026)\n" +
      "• \\{MM}：2位当前月份 (如 06)\n" +
      "• \\{dd}：2位当前日期 (如 17)\n" +
      "默认值：attachments/\\{ext}/\\{hash2}/\\{hash}.\\{ext}",
    testConnection: "测试连接",
    testConnectionDesc: "点击验证凭据是否正确。",
    testing: "测试中...",
    testConnectionSuccess: "连接测试通过！",
    testConnectionFailed: "连接测试失败：{error}",

    // Settings - General
    generalSettings: "第二步：基本设置",
    pluginEnabled: "启用插件",
    pluginEnabledDesc: "开启或关闭扫描和替换功能。",
    mobileHint:
      "提示：移动端不支持定时自动扫描和延迟删除。手动上传和替换功能正常使用。",
    attachmentRoot: "图片文件夹",
    attachmentRootDesc: "只处理此文件夹下的图片。默认：90-笔记系统/92-附件",
    deletePolicy: "替换链接后，是否删除本地文件？",
    deletePolicyDesc: "选择替换为远程链接后，原本地文件的处理方式。",
    deleteConfirm: "每次询问我（推荐）",
    deleteImmediate: "替换后立即删除",
    deleteDelayed: "延迟删除",
    deleteDelayHours: "延迟删除时间（小时）",
    deleteDelayHoursDesc: "文件将在指定小时后移入回收站。",
    automaticScan: "定期自动扫描全库",
    automaticScanDesc: "自动在后台查找并替换符合条件的图片。",
    scanInterval: "扫描间隔（分钟）",
    scanIntervalDesc: "多久扫描一次全库。默认：30",
    quietSeconds: "跳过最近修改的文件（秒）",
    quietSecondsDesc: "在此时间内修改过的文件会被自动扫描跳过。默认：600（10 分钟）",
    autoScanMinSize: "自动扫描忽略小于此大小的图片（MiB）",
    autoScanMinSizeDesc: "仅对自动扫描生效，手动扫描不受影响。设为 0 表示上传所有图片。",

    // Settings - File Types
    fileTypes: "第三步：选择要上传的图片类型",
    fileTypesDesc: "点击图片类型来切换。选中的类型在扫描时会被上传。",
    extCount: "{enabled}/{total} 已启用",
    categoryImage: "图片",
    categoryVideo: "视频",
    categoryAudio: "音频",
    categoryDocument: "文档",
    deselectAll: "取消全选",
    customExtensions: "自定义图片类型",
    customExtPlaceholder: "例如 sketch、fig、psd",
    addExtension: "添加",
    removeExtension: "移除",
    minSizeSection: "最小文件大小过滤（高级）",
    minSizeSectionDesc: "只上传大于指定大小的图片。设为 0 表示上传所有图片。",
    minSizeMiB: "最小大小 (MiB)",
    autoCandidate: "定时扫描包含",
    autoScanShort: "定时",
    advancedSettings: "高级设置",
    replacementType: "替换格式",
    markdownLink: "Markdown 链接",
    imageEmbed: "图片嵌入",
    audioTag: "音频标签",
    videoTag: "视频标签",

    // Settings - Log
    recentLog: "最近活动",
    pendingDeletes: "待延迟删除",
    noLogs: "暂无活动记录。扫描一篇文档即可开始。",
  },
};

export function detectLocaleFromApp(getLanguage: () => string): string {
  const lang = getLanguage();
  return String(lang).toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function t(locale: string, key: string, params: Record<string, unknown> = {}): string {
  const pack = I18N[locale] || I18N.en;
  const template = pack[key] || I18N.en[key] || key;
  return template
    .replace(/\\\{([\w-]+)\}/g, "___ESCAPED_START___$1}")
    .replace(/\{([\w-]+)\}/g, (_: string, name: string) => String(params[name] ?? ""))
    .replace(/___ESCAPED_START___([\w-]+)\}/g, "{$1}");
}
