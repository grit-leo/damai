(function initPurchaseAssistant() {
  if (window.__purchaseAssistantLoaded) return;
  window.__purchaseAssistantLoaded = true;

  const analyzer = window.PurchaseAssistantAnalyzer;
  const state = {
    extracted: null,
    result: null,
    lastOfficialPrice: null,
    lastRpaResult: null,
    rpa: {
      status: "idle",
      platform: "all",
      taskId: "",
      mock: null,
      attempt: 0,
      price: null,
      images: 0,
      phaseText: "等待触发真实手机 RPA",
      nextPollMs: 1200,
      sourceStatus: {
        web: "waiting",
        douyin: "waiting",
        taobao: "waiting"
      }
    },
    detailImages: [],
    rpaEvidenceImages: {
      web: [],
      douyin: [],
      taobao: []
    }
  };
  const OFFICIAL_PRICE_PATH = "/api/official-price";
  const DETAIL_IMAGE_PATH = "/api/detail-images";
  const RPA_PRICE_START_PATH = "/api/rpa/price/start";
  const RPA_PRICE_RESULT_PATH = "/api/rpa/price/result";
  const AI_REVIEW_PATH = "/api/ai/review-draft";
  const PICKUP_FIELDS = [
    ["productName", "商品名"],
    ["skuId", "商品编码"],
    ["purchasePrice", "采购价"],
    ["jdPrice", "京东价"]
  ];
  const EVIDENCE_SOURCES = ["web", "douyin", "taobao"];
  const SOURCE_LABELS = {
    web: "网页官旗",
    douyin: "抖音 RPA",
    taobao: "淘宝 RPA"
  };

  function formatMoney(value) {
    return analyzer.formatMoney(value);
  }

  function formatPercent(value) {
    return analyzer.formatPercent(value);
  }

  function fieldHtml(name, label, type = "text", wide = false, placeholder = "") {
    const className = wide ? "pa-field pa-wide" : "pa-field";
    const input =
      type === "textarea"
        ? `<textarea data-pa-field="${name}" placeholder="${placeholder}"></textarea>`
        : `<input data-pa-field="${name}" type="${type}" placeholder="${placeholder}">`;
    return `<div class="${className}"><label>${label}</label>${input}</div>`;
  }

  function selectHtml(name, label, options, wide = false) {
    const className = wide ? "pa-field pa-wide" : "pa-field";
    const optionHtml = options
      .map((item) => `<option value="${item.value}">${item.label}</option>`)
      .join("");
    return `<div class="${className}"><label>${label}</label><select data-pa-field="${name}">${optionHtml}</select></div>`;
  }

  function extensionAsset(path) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL(path);
    }
    return `/extension/${path}`;
  }

  function createRoot() {
    let root = document.getElementById("purchase-assistant-root");
    if (root) return root;

    root = document.createElement("div");
    root.id = "purchase-assistant-root";
    root.className = "pa-hidden";
    const assistantAvatarUrl = extensionAsset("assets/damai-corgi-avatar.png");
    root.innerHTML = `
      <aside class="pa-panel" role="dialog" aria-label="新品审核智能助理">
        <header class="pa-header">
          <div class="pa-assistant-head">
            <div class="pa-avatar-wrap">
              <img class="pa-avatar" src="${assistantAvatarUrl}" alt="">
            </div>
            <div>
              <p class="pa-kicker">麦总 AI 审核助理</p>
              <h2 class="pa-title">新品价格 AI 风控</h2>
              <p class="pa-subtitle">读单、取证、算运费、出意见，一键完成。</p>
            </div>
          </div>
          <button class="pa-close" data-pa-action="close" title="关闭">×</button>
        </header>
        <main class="pa-content">
          <section class="pa-assistant-hero">
            <div class="pa-hero-top">
              <div class="pa-hero-avatar">
                <img src="${assistantAvatarUrl}" alt="">
              </div>
              <div class="pa-hero-copy">
                <div class="pa-status-row">
                  <h3 class="pa-hero-title">AI 正在审核这张新品单</h3>
                  <span class="pa-pill" data-pa-completeness>未识别</span>
                </div>
                <p class="pa-hero-summary" data-pa-assistant-summary>我会先读单，再补价格证据，最后给出可复制的定价依据。</p>
                <p class="pa-muted" data-pa-page-url>当前审批页已连接</p>
              </div>
            </div>
            <div class="pa-pickup-card" data-pa-pickup-card>
              <div class="pa-pickup-head">
                <span class="pa-scan-core"></span>
                <div>
                  <strong>正在拾取新品信息</strong>
                  <small data-pa-pickup-count>等待读取审批页</small>
                </div>
              </div>
              <div class="pa-pickup-list">
                <div data-pa-pickup-item="productName">
                  <span>商品名</span>
                  <strong data-pa-pickup-value>待识别</strong>
                </div>
                <div data-pa-pickup-item="skuId">
                  <span>商品编码</span>
                  <strong data-pa-pickup-value>待识别</strong>
                </div>
                <div data-pa-pickup-item="purchasePrice">
                  <span>采购价</span>
                  <strong data-pa-pickup-value>待识别</strong>
                </div>
                <div data-pa-pickup-item="jdPrice">
                  <span>京东价</span>
                  <strong data-pa-pickup-value>待识别</strong>
                </div>
              </div>
            </div>
            <div class="pa-agent-status">
              <span class="pa-live-dot"></span>
              <span data-pa-agent-status>已接管当前审批单，等待补齐价格证据。</span>
            </div>
            <div class="pa-hero-metrics">
              <div>
                <span>采购价</span>
                <strong data-pa-brief-purchase>--</strong>
              </div>
              <div>
                <span>京东价</span>
                <strong data-pa-brief-jd>--</strong>
              </div>
              <div>
                <span>官旗价</span>
                <strong data-pa-brief-official>待补</strong>
              </div>
            </div>
            <div class="pa-agent-plan">
              <div class="pa-plan-step is-done">
                <span>01</span>
                <strong>读单完成</strong>
                <small data-pa-read-state>已识别基础字段</small>
              </div>
              <div class="pa-plan-step is-active">
                <span>02</span>
                <strong>补证据</strong>
                <small data-pa-evidence-state>等待官旗价和低价</small>
              </div>
              <div class="pa-plan-step">
                <span>03</span>
                <strong>出意见</strong>
                <small data-pa-result-state>待生成审核结论</small>
              </div>
            </div>
            <div class="pa-rpa-console" data-pa-rpa-console data-rpa-status="idle">
              <div class="pa-rpa-head">
                <div>
                <span>跨平台证据采集</span>
                  <strong data-pa-rpa-title>全站价盘：网页官旗 / 手机抖音 / 手机淘宝自动取证</strong>
                </div>
                <span class="pa-rpa-badge" data-pa-rpa-mode>自动</span>
              </div>
              <div class="pa-rpa-sources">
                <div class="pa-rpa-source" data-pa-source="web">
                  <strong>网页官旗</strong>
                  <span data-pa-source-status="web">待命</span>
                </div>
                <div class="pa-rpa-source" data-pa-source="douyin">
                  <strong>抖音 RPA</strong>
                  <span data-pa-source-status="douyin">待命</span>
                </div>
                <div class="pa-rpa-source" data-pa-source="taobao">
                  <strong>淘宝 RPA</strong>
                  <span data-pa-source-status="taobao">待命</span>
                </div>
              </div>
              <div class="pa-rpa-flow">
                <div class="pa-rpa-step" data-pa-rpa-step="start">
                  <span>创建任务</span>
                  <strong data-pa-rpa-start>待命</strong>
                </div>
                <div class="pa-rpa-step" data-pa-rpa-step="poll">
                  <span>手机执行</span>
                  <strong data-pa-rpa-poll>未开始</strong>
                </div>
                <div class="pa-rpa-step" data-pa-rpa-step="settle">
                  <span>截图识价</span>
                  <strong data-pa-rpa-settle>待入账</strong>
                </div>
              </div>
              <div class="pa-rpa-stage-note">
                <span class="pa-live-dot"></span>
                <strong data-pa-rpa-phase>等待触发真实手机 RPA</strong>
              </div>
              <div class="pa-rpa-proof-grid">
                <div>
                  <span>入账平台</span>
                  <strong data-pa-rpa-task>--</strong>
                </div>
                <div>
                  <span>最佳采集价</span>
                  <strong data-pa-rpa-price>--</strong>
                </div>
                <div>
                  <span>截图/详情图</span>
                  <strong data-pa-rpa-images>--</strong>
                </div>
              </div>
              <div class="pa-rpa-evidence" data-pa-rpa-evidence>
                <div class="pa-rpa-evidence-head">
                  <span>平台图片证据包</span>
                  <strong data-pa-rpa-evidence-count>等待图片回传</strong>
                </div>
                <div class="pa-rpa-evidence-list" data-pa-rpa-evidence-list>
                  <div class="pa-rpa-evidence-empty">抖音/淘宝 RPA 图片会按平台归档在这里。</div>
                </div>
              </div>
            </div>
            <div class="pa-command-grid">
              <button class="pa-primary" data-pa-action="analyze">全平台取证并生成意见</button>
              <button data-pa-action="rpa-demo">全平台取证审核</button>
              <button data-pa-action="crawl-official-price">查询官旗价</button>
              <button data-pa-action="crawl-detail-images">采集详情图</button>
              <button data-pa-action="refresh">重新读单</button>
            </div>
            <div class="pa-command-box">
              <div class="pa-command-input-row">
                <input data-pa-command-input type="text" placeholder="对麦总说：帮我完整审核这单">
                <button class="pa-command-send" data-pa-action="run-command">执行</button>
              </div>
              <div class="pa-command-chips">
                <button data-pa-action="quick-command" data-pa-command="帮我完整审核这单">完整审核</button>
                <button data-pa-action="quick-command" data-pa-command="先查官旗价">查官旗价</button>
                <button data-pa-action="quick-command" data-pa-command="采集详情图证据">采详情图</button>
                <button data-pa-action="rpa-demo">全平台取证</button>
              </div>
              <p class="pa-command-log" data-pa-command-log>麦总等待指令。</p>
            </div>
            <div class="pa-decision-summary" data-pa-decision-summary hidden>
              <div class="pa-decision-head">
                <div>
                  <span>麦总结论</span>
                  <strong data-pa-decision-title>待生成</strong>
                </div>
                <button data-pa-action="copy-decision" title="复制审核意见">复制</button>
              </div>
              <div class="pa-decision-kpis">
                <div>
                  <span>风险</span>
                  <strong data-pa-decision-risk>--</strong>
                </div>
                <div>
                  <span>建议采购价</span>
                  <strong data-pa-decision-price>--</strong>
                </div>
                <div>
                  <span>风险分</span>
                  <strong data-pa-decision-score>--</strong>
                </div>
              </div>
            </div>
          </section>

          <nav class="pa-tabs" aria-label="审核工作区">
            <button data-pa-action="switch-panel" data-pa-panel-target="decision">AI结论</button>
            <button class="is-active" data-pa-action="switch-panel" data-pa-panel-target="evidence">证据</button>
            <button data-pa-action="switch-panel" data-pa-panel-target="calculator">计算器</button>
            <button data-pa-action="switch-panel" data-pa-panel-target="details">明细</button>
          </nav>

          <div class="pa-chat">
            <section class="pa-turn pa-turn-assistant" data-pa-panel="evidence">
              <div class="pa-message-avatar">
                <img src="${assistantAvatarUrl}" alt="">
              </div>
              <div class="pa-message-bubble">
                <h3 class="pa-section-title">下一步我需要关键证据</h3>
                <p class="pa-muted" data-pa-crawl-status>优先补官旗到手价、全网低价和 BOM 区间。证据越完整，我给出的降采建议越可靠。</p>
              </div>
            </section>

            <section class="pa-work-card pa-focus-card" data-pa-panel="evidence">
              <div class="pa-card-head">
                <h3 class="pa-section-title">证据槽</h3>
                <span class="pa-section-hint">先补这里</span>
              </div>
              <div class="pa-slot-grid">
                ${fieldHtml("officialUrl", "官旗商品链接", "text", true, "可粘贴天猫/抖音/京东官旗商品页链接")}
                ${fieldHtml("officialPrice", "官旗真实到手价", "number", false, "填写或由麦总获取")}
                ${fieldHtml("lowPrice", "全网低价", "number", false, "填写低价证据")}
                ${fieldHtml("bomLow", "BOM 成本下沿", "number", false, "填写成本下沿")}
                ${fieldHtml("bomHigh", "BOM 成本上沿", "number", false, "填写成本上沿")}
              </div>
              <div class="pa-mini-status-grid">
                <div><span>全站价盘</span><strong data-pa-price-state>待获取</strong></div>
                <div><span>详情图</span><strong data-pa-image-state>待采集</strong></div>
                <div><span>BOM</span><strong data-pa-bom-state>待补充</strong></div>
                <div><span>运费</span><strong data-pa-logistics-state>待接入</strong></div>
              </div>
            </section>

            <section class="pa-turn pa-turn-assistant" data-pa-panel="calculator">
              <div class="pa-message-avatar">
                <img src="${assistantAvatarUrl}" alt="">
              </div>
              <div class="pa-message-bubble">
                <h3 class="pa-section-title">我会按这套口径测算</h3>
                <p class="pa-muted">默认采用可控费率 12%、不可控费率 2.5%、目标贡利率 12%，运费按实重和体积重取大后套首重/续重模板。你可以按运费系统口径覆盖。</p>
              </div>
            </section>

            <section class="pa-work-card" data-pa-panel="calculator">
              <div class="pa-card-head">
                <h3 class="pa-section-title">测算口径</h3>
                <span class="pa-section-hint">费用率和促销场景</span>
              </div>
              <div class="pa-grid">
                ${fieldHtml("controllableRate", "可控费率 %", "number")}
                ${fieldHtml("uncontrollableRate", "不可控费率 %", "number")}
                ${fieldHtml("adRate", "自投广告 %", "number")}
                ${fieldHtml("targetProfitRate", "目标贡利率 %", "number")}
                ${fieldHtml("packageWeightKg", "包裹实重 kg", "number")}
                ${fieldHtml("packageLengthCm", "长 cm", "number")}
                ${fieldHtml("packageWidthCm", "宽 cm", "number")}
                ${fieldHtml("packageHeightCm", "高 cm", "number")}
                ${fieldHtml("volumeDivisor", "泡重系数", "number")}
                ${fieldHtml("firstWeightKg", "首重 kg", "number")}
                ${fieldHtml("firstFreightFee", "首重运费", "number")}
                ${fieldHtml("continuedWeightKg", "续重单位 kg", "number")}
                ${fieldHtml("continuedFreightFee", "续重运费", "number")}
                ${fieldHtml("packagingCost", "包材/附加费", "number")}
                ${fieldHtml("freightSurcharge", "偏远/冷链加收", "number")}
                ${fieldHtml("shippingSubsidy", "运费补贴/件", "number")}
                ${fieldHtml("dailyPrice", "日销件单价", "number")}
                ${fieldHtml("promoPrice", "大促件单价", "number")}
                ${fieldHtml("lowestDealPrice", "最低凑单价", "number", true)}
              </div>
            </section>

            <section class="pa-turn pa-turn-assistant" data-pa-result-section data-pa-panel="decision">
              <div class="pa-message-avatar">
                <img src="${assistantAvatarUrl}" alt="">
              </div>
              <div class="pa-message-bubble pa-result-section">
                <div class="pa-status-row">
                  <h3 class="pa-section-title">麦总的审核意见</h3>
                  <span class="pa-pill" data-pa-risk>待分析</span>
                </div>
                <div data-pa-result>
                  <div class="pa-empty-result">
                    <div class="pa-empty-dot"></div>
                    <p>点击“全平台取证并生成意见”后，我会用公式、AI 分析和证据链说明为什么建议通过、降采或驳回。</p>
                  </div>
                </div>
              </div>
            </section>

            <section class="pa-work-card pa-detail-card" data-pa-panel="details">
              <div class="pa-card-head">
                <h3 class="pa-section-title">数据明细</h3>
                <span class="pa-section-hint">必要时再改</span>
              </div>
              <div class="pa-grid">
                ${fieldHtml("productName", "商品名称", "textarea", true)}
                ${fieldHtml("skuId", "商品编码 / 审批单 ID")}
                ${fieldHtml("brand", "品牌")}
                ${fieldHtml("category", "类目")}
                ${fieldHtml("spec", "规格")}
                ${fieldHtml("supplier", "供应商", "text", true)}
                ${fieldHtml("purchasePrice", "采购价", "number", false, "从审批页读取")}
                ${fieldHtml("jdPrice", "京东价", "number", false, "从审批页读取")}
              </div>
              <input data-pa-field="crawlerEndpoint" type="hidden">
              <input data-pa-field="detailImageEndpoint" type="hidden">
              <input data-pa-field="evidenceImageCount" type="hidden">
              <input data-pa-field="platform" type="hidden" value="auto">
              <div data-pa-image-list></div>
            </section>
          </div>
        </main>
      </aside>
    `;
    document.body.appendChild(root);
    setActivePanel(root, "evidence");
    bindEvents(root);
    return root;
  }

  function getField(root, name) {
    return root.querySelector(`[data-pa-field="${name}"]`);
  }

  function setField(root, name, value) {
    const field = getField(root, name);
    if (!field) return;
    field.value = value === null || value === undefined ? "" : String(value);
  }

  function setText(root, selector, value) {
    const node = root.querySelector(selector);
    if (node) node.textContent = value;
  }

  function setActivePanel(root, panel) {
    const nextPanel = panel || "evidence";
    root.dataset.activePanel = nextPanel;
    root.querySelectorAll("[data-pa-panel-target]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.paPanelTarget === nextPanel);
    });
  }

  function setResultMode(root, enabled) {
    root.classList.toggle("pa-has-result", Boolean(enabled));
  }

  function agentStatus(root, message) {
    setText(root, "[data-pa-agent-status]", message);
    setText(root, "[data-pa-command-log]", message);
  }

  function truncateValue(value, maxLength = 34) {
    const text = value === null || value === undefined ? "" : String(value).trim();
    if (!text) return "待识别";
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function defaultServiceEndpoint(path) {
    const { protocol, hostname } = window.location;
    if (!/^(localhost|127\.0\.0\.1)$/.test(hostname)) return "";
    return `${protocol}//${hostname}:8787${path}`;
  }

  function serviceOrigin(form) {
    const endpoint = form.crawlerEndpoint || defaultServiceEndpoint(OFFICIAL_PRICE_PATH);
    if (!endpoint) return "";
    try {
      return new URL(endpoint).origin;
    } catch {
      return "";
    }
  }

  function rpaEndpoint(form, path) {
    const origin = serviceOrigin(form);
    return origin ? `${origin}${path}` : "";
  }

  function aiEndpoint(form) {
    const origin = serviceOrigin(form);
    return origin ? `${origin}${AI_REVIEW_PATH}` : "";
  }

  function shouldUseRpa(form) {
    const platform = String(form.platform || "").toLowerCase();
    const url = String(form.officialUrl || "").toLowerCase();
    return platform === "douyin" || platform === "taobao" || /^rpa:\/\//.test(url) || /douyin|jinritemai|taobao|tmall/.test(url);
  }

  function platformLabel(platform) {
    if (platform === "all") return "全平台";
    if (platform === "douyin") return "抖音 RPA";
    if (platform === "taobao") return "淘宝 RPA";
    return "网页官旗";
  }

  function sourceLabel(sourceKey) {
    return SOURCE_LABELS[sourceKey] || platformLabel(sourceKey);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function emptyEvidenceImages() {
    return { web: [], douyin: [], taobao: [] };
  }

  function sourceFromValue(value, fallback = "web") {
    const text = String(value || "").toLowerCase();
    if (/douyin|抖音/.test(text)) return "douyin";
    if (/taobao|tmall|淘宝|天猫/.test(text)) return "taobao";
    if (/web|official|官旗|网页/.test(text)) return "web";
    return fallback;
  }

  function imageSourceKey(image, fallback = "web") {
    return sourceFromValue(image?.sourceKey || image?.source || image?.platformCode || image?.platform, fallback);
  }

  function decorateImages(images, fallbackSource) {
    return (images || [])
      .map((image, index) => {
        const value = typeof image === "string" ? { url: image } : image || {};
        const sourceKey = imageSourceKey(value, fallbackSource);
        return {
          ...value,
          url: value.url || value.src || value.href || "",
          type: value.type || "screenshot",
          sourceKey,
          sourceLabel: value.sourceLabel || sourceLabel(sourceKey),
          evidence: value.evidence || `${sourceLabel(sourceKey)} 图片证据 ${index + 1}`
        };
      })
      .filter((image) => image.url);
  }

  function decorateEvidencePayload(payload, fallbackSource) {
    const sourceKey = sourceFromValue(payload?.sourceKey || payload?.platform, fallbackSource);
    return {
      ...payload,
      sourceKey,
      candidates: (payload?.candidates || []).map((candidate) => ({
        ...candidate,
        sourceKey: candidate.sourceKey || sourceKey,
        sourceLabel: candidate.sourceLabel || sourceLabel(sourceKey)
      })),
      images: decorateImages(payload?.images || [], sourceKey)
    };
  }

  function groupImagesBySource(images, fallbackSource = "web") {
    const grouped = emptyEvidenceImages();
    decorateImages(images, fallbackSource).forEach((image) => {
      const sourceKey = imageSourceKey(image, fallbackSource);
      if (!grouped[sourceKey]) grouped[sourceKey] = [];
      grouped[sourceKey].push(image);
    });
    return grouped;
  }

  function evidenceImagesFromPayload(payload) {
    const grouped = emptyEvidenceImages();
    if (payload?.imagesBySource) {
      EVIDENCE_SOURCES.forEach((sourceKey) => {
        grouped[sourceKey] = decorateImages(payload.imagesBySource[sourceKey] || [], sourceKey);
      });
      return grouped;
    }
    const inferred = groupImagesBySource(payload?.images || [], payload?.sourceKey || "web");
    EVIDENCE_SOURCES.forEach((sourceKey) => {
      grouped[sourceKey] = inferred[sourceKey] || [];
    });
    return grouped;
  }

  function flattenEvidenceImages(groups) {
    return EVIDENCE_SOURCES.flatMap((sourceKey) => groups[sourceKey] || []);
  }

  function renderRpaEvidence(root) {
    const list = root.querySelector("[data-pa-rpa-evidence-list]");
    if (!list) return;
    const groups = state.rpaEvidenceImages || emptyEvidenceImages();
    const total = flattenEvidenceImages(groups).length;
    setText(root, "[data-pa-rpa-evidence-count]", total ? `${total} 张图片已归档` : "等待图片回传");
    if (!total) {
      list.innerHTML = `<div class="pa-rpa-evidence-empty">抖音/淘宝 RPA 图片会按平台归档在这里。</div>`;
      return;
    }

    list.innerHTML = EVIDENCE_SOURCES.map((sourceKey) => {
      const images = groups[sourceKey] || [];
      const imageLinks = images.length
        ? images
            .slice(0, 4)
            .map((image, index) => {
              const label = image.type === "detail" ? `详情图${index + 1}` : `截图${index + 1}`;
              return `<a href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(image.evidence || image.alt || "")}">${label}</a>`;
            })
            .join("")
        : `<span class="pa-rpa-evidence-waiting">待回传</span>`;
      const extra = images.length > 4 ? `<em>+${images.length - 4}</em>` : "";
      return `
        <div class="pa-rpa-evidence-source" data-evidence-source="${sourceKey}">
          <div>
            <strong>${sourceLabel(sourceKey)}</strong>
            <span>${images.length ? `${images.length} 张` : "暂无图片"}</span>
          </div>
          <div class="pa-rpa-evidence-links">${imageLinks}${extra}</div>
        </div>
      `;
    }).join("");
  }

  function shortTaskId(taskId) {
    if (!taskId) return "--";
    return String(taskId).slice(0, 8);
  }

  function setRpaStep(root, name, stateName) {
    const step = root.querySelector(`[data-pa-rpa-step="${name}"]`);
    if (!step) return;
    step.classList.remove("is-active", "is-done", "is-waiting");
    step.classList.add(`is-${stateName}`);
  }

  function sourceStatusLabel(status) {
    return {
      waiting: "待命",
      running: "采集中",
      succeeded: "已获取",
      failed: "未获取"
    }[status] || "待命";
  }

  function renderSourceStates(root) {
    const sourceStatus = state.rpa.sourceStatus || {};
    root.querySelectorAll("[data-pa-source]").forEach((node) => {
      const key = node.dataset.paSource;
      const status = sourceStatus[key] || "waiting";
      node.dataset.sourceStatus = status;
      setText(node, `[data-pa-source-status="${key}"]`, sourceStatusLabel(status));
    });
  }

  function updateRpaConsole(root, patch = {}) {
    state.rpa = {
      ...state.rpa,
      ...patch,
      sourceStatus: {
        ...(state.rpa.sourceStatus || {}),
        ...(patch.sourceStatus || {})
      }
    };
    const rpa = state.rpa;
    const consoleNode = root.querySelector("[data-pa-rpa-console]");
    if (consoleNode) consoleNode.dataset.rpaStatus = rpa.status;

    const statusText = {
      idle: "未触发",
      selected: "待触发",
      starting: "创建任务",
      polling: "手机执行中",
      succeeded: rpa.mock ? "兜底入账" : "真实入账",
      failed: "失败"
    }[rpa.status] || "待命";

    setText(root, "[data-pa-rpa-mode]", statusText);
    setText(root, "[data-pa-rpa-title]", `${platformLabel(rpa.platform)} ${rpa.status === "idle" ? "自动取证待命" : "手机取证链路"}`);
    setText(root, "[data-pa-rpa-task]", shortTaskId(rpa.taskId));
    setText(root, "[data-pa-rpa-price]", rpa.price ? formatMoney(rpa.price) : "--");
    setText(root, "[data-pa-rpa-images]", rpa.images ? `${rpa.images} 张` : "--");
    setText(root, "[data-pa-rpa-phase]", rpa.phaseText || "等待触发真实手机 RPA");

    const started = Boolean(rpa.taskId);
    setText(root, "[data-pa-rpa-start]", started ? "已创建" : "待命");
    setText(root, "[data-pa-rpa-poll]", rpa.attempt ? `${rpa.attempt}/30` : "未开始");
    setText(
      root,
      "[data-pa-rpa-settle]",
      rpa.status === "succeeded" ? (rpa.mock ? "兜底已入账" : "真实已入账") : "待入账"
    );

    setRpaStep(root, "start", started ? "done" : rpa.status === "starting" ? "active" : "waiting");
    setRpaStep(root, "poll", rpa.status === "polling" ? "active" : rpa.status === "succeeded" ? "done" : "waiting");
    setRpaStep(root, "settle", rpa.status === "succeeded" ? "done" : rpa.status === "failed" ? "active" : "waiting");
    renderSourceStates(root);
    renderRpaEvidence(root);
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function absoluteServiceUrl(form, value) {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    const origin = serviceOrigin(form);
    return origin ? `${origin}${value}` : value;
  }

  function demoOfficialUrl() {
    const { protocol, hostname, port } = window.location;
    if (!/^(localhost|127\.0\.0\.1)$/.test(hostname)) return "";
    return `${protocol}//${hostname}${port ? `:${port}` : ""}/demo/official-store-page.html`;
  }

  function officialUrlForWeb(form) {
    return form.officialUrl || demoOfficialUrl();
  }

  function uniqueImages(images) {
    const seen = new Set();
    return images.filter((image) => {
      if (!image.url) return false;
      const key = `${image.sourceKey || ""}:${image.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeEvidencePayloads(payloads) {
    const decoratedPayloads = payloads.map((payload) => decorateEvidencePayload(payload, payload.sourceKey || "web"));
    const candidates = decoratedPayloads.flatMap((payload) => payload.candidates || []);
    const imagesBySource = emptyEvidenceImages();
    decoratedPayloads.forEach((payload) => {
      const grouped = groupImagesBySource(payload.images || [], payload.sourceKey);
      EVIDENCE_SOURCES.forEach((sourceKey) => {
        imagesBySource[sourceKey].push(...(grouped[sourceKey] || []));
        imagesBySource[sourceKey] = uniqueImages(imagesBySource[sourceKey]);
      });
    });
    const images = flattenEvidenceImages(imagesBySource);
    candidates.sort((a, b) => b.confidence - a.confidence || (a.finalPrice || Infinity) - (b.finalPrice || Infinity));
    return {
      ok: candidates.length > 0,
      candidates,
      images,
      imagesBySource,
      taskId: `${payloads.filter((payload) => payload.candidates?.length).length}/${payloads.length}`,
      mock: payloads.some((payload) => payload.mock),
      capturedAt: new Date().toISOString()
    };
  }

  function renderPickup(root, data) {
    const card = root.querySelector("[data-pa-pickup-card]");
    if (!card) return;

    let picked = 0;
    PICKUP_FIELDS.forEach(([key]) => {
      const item = root.querySelector(`[data-pa-pickup-item="${key}"]`);
      if (!item) return;
      const value = data[key];
      const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
      item.classList.toggle("is-picked", hasValue);
      const displayValue = typeof value === "number" ? formatMoney(value) : truncateValue(value);
      setText(item, "[data-pa-pickup-value]", displayValue);
      if (hasValue) picked += 1;
    });

    setText(root, "[data-pa-pickup-count]", `已拾取 ${picked}/${PICKUP_FIELDS.length} 个关键字段`);
    card.classList.remove("is-complete");
    card.classList.add("is-scanning");
    window.setTimeout(() => {
      if (!card.isConnected) return;
      card.classList.remove("is-scanning");
      card.classList.add("is-complete");
    }, 700);
  }

  function currentPanelWidth(root) {
    if (window.innerWidth <= 520) return window.innerWidth;
    return Math.min(468, Math.max(0, window.innerWidth - 16));
  }

  function setPageShift(root, enabled) {
    const doc = document.documentElement;
    if (enabled && window.innerWidth >= 700) {
      const panelWidth = currentPanelWidth(root);
      doc.style.setProperty("--pa-panel-width", `${panelWidth}px`);
      doc.classList.add("pa-layout-shift");
    } else {
      doc.classList.remove("pa-layout-shift");
      doc.style.removeProperty("--pa-panel-width");
    }
  }

  function readForm(root) {
    const fields = Array.from(root.querySelectorAll("[data-pa-field]"));
    return fields.reduce((data, field) => {
      data[field.dataset.paField] = field.value.trim();
      return data;
    }, {});
  }

  function fillFromPage(root) {
    const wasHidden = root.classList.contains("pa-hidden");
    root.classList.add("pa-hidden");
    state.extracted = analyzer.extractPageData(document);
    if (!wasHidden) root.classList.remove("pa-hidden");

    const data = state.extracted;
    [
      "productName",
      "skuId",
      "brand",
      "category",
      "spec",
      "supplier",
      "purchasePrice",
      "jdPrice"
    ].forEach((name) => setField(root, name, data[name] || ""));

    setField(root, "controllableRate", "12");
    setField(root, "uncontrollableRate", "2.5");
    setField(root, "adRate", "0");
    setField(root, "targetProfitRate", "12");
    setField(root, "packageWeightKg", "1.1");
    setField(root, "packageLengthCm", "24");
    setField(root, "packageWidthCm", "18");
    setField(root, "packageHeightCm", "10");
    setField(root, "volumeDivisor", "8000");
    setField(root, "firstWeightKg", "1");
    setField(root, "firstFreightFee", "3.2");
    setField(root, "continuedWeightKg", "0.5");
    setField(root, "continuedFreightFee", "0.45");
    setField(root, "packagingCost", "0");
    setField(root, "freightSurcharge", "0");
    setField(root, "shippingSubsidy", "0");
    setField(root, "evidenceImageCount", String(state.detailImages.length));
    if (!getField(root, "platform").value) setField(root, "platform", "auto");
    if (!getField(root, "crawlerEndpoint").value) {
      setField(root, "crawlerEndpoint", defaultServiceEndpoint(OFFICIAL_PRICE_PATH));
    }
    if (!getField(root, "detailImageEndpoint").value) {
      setField(root, "detailImageEndpoint", defaultServiceEndpoint(DETAIL_IMAGE_PATH));
    }

    root.querySelector("[data-pa-completeness]").textContent = `识别完整度 ${data.completeness}%`;
    root.querySelector("[data-pa-page-url]").textContent = "当前审批页已连接";
    setText(root, "[data-pa-brief-purchase]", formatMoney(data.purchasePrice));
    setText(root, "[data-pa-brief-jd]", formatMoney(data.jdPrice));
    setText(root, "[data-pa-assistant-summary]", `已识别 ${data.productName || "当前商品"}，我会重点检查采购价、全站价盘、运费和促销贡利风险。`);
    agentStatus(root, "读单完成，下一步补价格证据。");
    setText(root, "[data-pa-read-state]", `完整度 ${data.completeness}%`);
    renderPickup(root, data);
    updateRpaConsole(root, { status: "idle", platform: "all", phaseText: "等待触发真实手机 RPA" });
  }

  function riskClass(level) {
    if (level === "高") return "pa-pill pa-risk-high";
    if (level === "中") return "pa-pill pa-risk-mid";
    return "pa-pill pa-risk-low";
  }

  function toneClass(tone) {
    if (tone === "danger") return "is-danger";
    if (tone === "warn") return "is-warn";
    return "is-good";
  }

  function renderResult(root, result) {
    setResultMode(root, true);
    setActivePanel(root, "decision");
    const risk = root.querySelector("[data-pa-risk]");
    risk.className = riskClass(result.riskLevel);
    risk.textContent = `${result.riskLevel}风险`;
    setText(root, "[data-pa-assistant-summary]", `审核完成：${result.riskLevel}风险，含运费建议采购价 ${formatMoney(result.suggestedPurchasePrice)}。`);
    agentStatus(root, `审核完成，结论为${result.riskLevel}风险。`);
    setText(root, "[data-pa-result-state]", `${result.riskLevel}风险 / ${formatMoney(result.suggestedPurchasePrice)}`);
    const decisionSummary = root.querySelector("[data-pa-decision-summary]");
    if (decisionSummary) decisionSummary.hidden = false;
    setText(root, "[data-pa-decision-title]", result.recommendation);
    setText(root, "[data-pa-decision-risk]", `${result.riskLevel}风险`);
    setText(root, "[data-pa-decision-price]", formatMoney(result.suggestedPurchasePrice));
    setText(root, "[data-pa-decision-score]", String(result.riskScore));

    const priceAdvice = result.priceAdvice || {};
    const purchaseRange = `${formatMoney(priceAdvice.purchaseLower)}-${formatMoney(priceAdvice.purchaseUpper)}`;
    const dealRange = `${formatMoney(priceAdvice.dealRangeLow)}-${formatMoney(priceAdvice.dealRangeHigh)}`;
    const scenarios = result.scenarios || [];
    const dailyScenario = scenarios.find((item) => item.name === "日销场景") || scenarios[0] || {};
    const promoScenario = scenarios.find((item) => item.name === "大促场景") || scenarios[1] || {};
    const lowestScenario = scenarios.find((item) => item.name === "最低凑单场景") || scenarios[2] || {};
    const anchorDealPrice = result.input?.officialPrice || dailyScenario.price || result.input?.jdPrice;
    const feeAmount = anchorDealPrice === null || anchorDealPrice === undefined ? null : anchorDealPrice * (result.feeRate || 0);
    const formulaRate = dailyScenario.contributionRate === null || dailyScenario.contributionRate === undefined ? null : dailyScenario.contributionRate * 100;
    const formulaTone = formulaRate === null ? "" : formulaRate < 0 ? "is-danger" : formulaRate < (result.targetRate || 0) * 100 ? "is-warn" : "is-good";
    const priceAnalysis =
      result.reasons?.[0] ||
      `当前采购价 ${formatMoney(result.input?.purchasePrice)}，含运费建议采购价上限 ${formatMoney(result.suggestedPurchasePrice)}。`;
    const profitAnalysis =
      result.reasons?.find((reason) => reason.includes("运费") || reason.includes("最低凑单")) ||
      `最低凑单场景为${lowestScenario.status || "待测算"}，需结合促销资源确认最终利润。`;
    const chainItems = (result.evidenceChain || [])
      .map(
        (item) => `
          <div class="pa-chain-item ${toneClass(item.tone)}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.verdict)}</strong>
            <small>${escapeHtml(item.suggestion)}</small>
          </div>
        `
      )
      .join("");
    const strengths = (result.strengths || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    const actionItems = (result.actionItems || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    const scenarioRows = scenarios
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${formatMoney(item.price)}</td>
            <td>${formatPercent(item.contributionRate === null ? null : item.contributionRate * 100)}</td>
            <td>${formatMoney(item.contributionAmount)}</td>
            <td><span class="pa-status-chip ${toneClass(item.status === "亏损" ? "danger" : item.status === "低于目标" ? "warn" : "good")}">${escapeHtml(item.status)}</span></td>
          </tr>
        `
      )
      .join("");

    root.querySelector("[data-pa-result]").innerHTML = `
      <div class="pa-ai-verdict ${toneClass(result.riskLevel === "高" ? "danger" : result.riskLevel === "中" ? "warn" : "good")}">
        <div>
          <p class="pa-answer-label">AI 判断</p>
          <p class="pa-result-title">${escapeHtml(result.recommendation)}</p>
        </div>
        <span>${escapeHtml(result.riskLevel)}风险</span>
      </div>
      <div class="pa-formula-card ${formulaTone}">
        <div class="pa-formula-head">
          <span>定价分析</span>
          <strong>利润计算器</strong>
        </div>
        <div class="pa-formula-main">
          <div class="pa-formula-result">
            <span>预估前台贡利率</span>
            <strong>${formatPercent(formulaRate)}</strong>
          </div>
          <div class="pa-formula-equation">
            <div><span>到手价</span><strong>${formatMoney(anchorDealPrice)}</strong></div>
            <em>-</em>
            <div><span>采购价</span><strong>${formatMoney(result.input?.purchasePrice)}</strong></div>
            <em>-</em>
            <div><span>平台费用</span><strong>${formatMoney(feeAmount)}</strong></div>
            <em>-</em>
            <div><span>计费重运费</span><strong>${formatMoney(result.logisticsCost)}</strong></div>
          </div>
        </div>
        <p class="pa-formula-foot">按费用率、目标贡利率和重量体积运费反推，建议采购价不高于 <strong>${formatMoney(result.suggestedPurchasePrice)}</strong>。</p>
      </div>
      <div class="pa-ai-analysis-grid">
        <div class="pa-ai-analysis-card">
          <p class="pa-ai-tag">AI 分析</p>
          <p>${escapeHtml(priceAnalysis)}</p>
          <div class="pa-ai-highlight">
            <span>建议采购价</span>
            <strong>${formatMoney(result.suggestedPurchasePrice)}</strong>
          </div>
        </div>
        <div class="pa-ai-analysis-card">
          <p class="pa-ai-tag">AI 分析</p>
          <p>${escapeHtml(profitAnalysis)}</p>
          <div class="pa-ai-highlight">
            <span>最低凑单</span>
            <strong>${escapeHtml(lowestScenario.status || "待测算")}</strong>
          </div>
        </div>
      </div>
      <div class="pa-range-card ${priceAdvice.bomConflict ? "is-danger" : ""}">
        <div>
          <span>采购价建议范围</span>
          <strong>${purchaseRange}</strong>
        </div>
        <div>
          <span>到手价建议区间</span>
          <strong>${dealRange}</strong>
        </div>
        <p>${escapeHtml(priceAdvice.message || "等待完整价格和运费口径。")}</p>
      </div>
      <div class="pa-metric-grid">
        <div class="pa-metric">
          <p class="pa-metric-label">证据完整度</p>
          <p class="pa-metric-value">${result.evidenceCompleteness || 0}%</p>
        </div>
        <div class="pa-metric">
          <p class="pa-metric-label">采用费用率</p>
          <p class="pa-metric-value">${formatPercent(result.feeRate * 100)}</p>
        </div>
        <div class="pa-metric">
          <p class="pa-metric-label">大促场景</p>
          <p class="pa-metric-value">${escapeHtml(promoScenario.status || "待测算")}</p>
        </div>
        <div class="pa-metric">
          <p class="pa-metric-label">风险分</p>
          <p class="pa-metric-value">${result.riskScore}</p>
        </div>
      </div>
      <div class="pa-chain-grid">${chainItems}</div>
      <div class="pa-two-column">
        <div class="pa-reason-card pa-good-card">
          <p class="pa-answer-label">做得好的地方</p>
          <ul class="pa-reasons">${strengths}</ul>
        </div>
        <div class="pa-reason-card pa-action-card">
          <p class="pa-answer-label">需要改正/补充</p>
          <ol class="pa-reasons">${actionItems}</ol>
        </div>
      </div>
      <div class="pa-reason-card">
        <p class="pa-answer-label">关键理由</p>
        <ol class="pa-reasons">${result.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ol>
      </div>
      <table class="pa-table">
        <thead>
          <tr>
            <th>场景</th>
            <th>件单价</th>
            <th>贡利率</th>
            <th>贡利额</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>${scenarioRows}</tbody>
      </table>
      <div class="pa-model-draft" data-pa-model-draft hidden></div>
      <div class="pa-actions pa-result-actions">
        <button class="pa-copy" data-pa-action="copy">复制审核意见</button>
        <button data-pa-action="copy-evidence">复制证据摘要</button>
        <button data-pa-action="model-review">智增增生成 Boss 版意见</button>
      </div>
    `;
  }

  async function generateModelReview(root) {
    if (!state.result) throw new Error("请先完成审核测算。");
    const form = readForm(root);
    const endpoint = aiEndpoint(form);
    if (!endpoint) throw new Error("AI 生成服务未连接，请先启动价格采集服务。");
    const draftNode = root.querySelector("[data-pa-model-draft]");
    if (draftNode) {
      draftNode.hidden = false;
      draftNode.innerHTML = `<p class="pa-muted">正在调用智增增生成 Boss 版意见...</p>`;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result: state.result,
        evidenceText: evidenceText(state.result),
        imageEvidenceText: imageEvidenceText()
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "AI 意见生成失败");
    if (draftNode) {
      draftNode.hidden = false;
      draftNode.innerHTML = `
        <div class="pa-model-head">
          <span>${payload.provider === "zhizengzeng" ? "智增增" : "本地规则"}</span>
          <strong>${payload.configured ? "已接入模型" : "未配置密钥，使用本地兜底"}</strong>
        </div>
        <pre>${escapeHtml(payload.draft || "")}</pre>
      `;
    }
    await copyText(payload.draft || "");
    showToast("Boss 版意见已生成并复制");
  }

  function evidenceText(result) {
    const officialEvidence = state.lastOfficialPrice
      ? [
          `官旗来源：${state.lastOfficialPrice.platform || "-"} / ${state.lastOfficialPrice.shopName || "-"}`,
          `官旗链接：${state.lastOfficialPrice.url || "-"}`,
          `价格证据：${state.lastOfficialPrice.evidence || "-"}`
        ]
      : [];

    return [
      "新品审核证据摘要",
      `商品：${result.input.productName || "未识别"}`,
      `采购价：${formatMoney(result.input.purchasePrice)}`,
      `京东价：${formatMoney(result.input.jdPrice)}`,
      `官旗到手价：${formatMoney(result.input.officialPrice)}`,
      `全网低价：${formatMoney(result.input.lowPrice)}`,
      `详情图数量：${state.detailImages.length}`,
      `BOM 参考：${formatMoney(result.input.bomLow)}-${formatMoney(result.input.bomHigh)}`,
      `计费重运费：${formatMoney(result.logisticsCost)}`,
      `计费重：${result.freight?.billedWeight || "-"}kg，实重：${result.freight?.actualWeight || "-"}kg，体积重：${result.freight?.volumeWeight || "-"}kg`,
      `建议采购价：${formatMoney(result.suggestedPurchasePrice)}`,
      `建议采购区间：${formatMoney(result.priceAdvice?.purchaseLower)}-${formatMoney(result.priceAdvice?.purchaseUpper)}`,
      `证据完整度：${result.evidenceCompleteness || 0}%`,
      ...officialEvidence,
      `结论：${result.recommendation}`,
      "",
      "分环节建议：",
      ...(result.actionItems || []).map((item, index) => `${index + 1}. ${item}`)
    ].join("\n");
  }

  function imageEvidenceText() {
    if (!state.detailImages.length) return "暂无详情图证据";
    return [
      "商品详情图证据",
      ...state.detailImages.map((image, index) => {
        const source = image.sourceLabel || sourceLabel(image.sourceKey || "web");
        return `${index + 1}. [${source}/${image.type || "image"}] ${image.url} 置信度 ${image.confidence || "-"} 说明：${image.alt || image.evidence || "-"}`;
      })
    ].join("\n");
  }

  function crawlStatus(root, message) {
    const status = root.querySelector("[data-pa-crawl-status]");
    if (status) status.textContent = message;
  }

  async function runRpaPriceTask(root, form, platformOverride, sourceKey, options = {}) {
    const platform = platformOverride || form.platform || "douyin";
    const source = sourceKey || platform;
    const standalone = options.standalone !== false;
    const startEndpoint = rpaEndpoint(form, RPA_PRICE_START_PATH);
    if (!startEndpoint) throw new Error("RPA 采集服务未连接，请先启动价格采集服务。");

    crawlStatus(root, "正在创建真实手机 RPA 任务...");
    setText(root, "[data-pa-price-state]", "RPA采集中");
    setText(root, "[data-pa-evidence-state]", "手机RPA正在搜索、截图并识别价格");
    updateRpaConsole(
      root,
      standalone
        ? {
            status: "starting",
            platform,
            taskId: "",
            mock: null,
            attempt: 0,
            price: null,
            images: 0,
            phaseText: "正在创建真实手机 RPA 任务",
            sourceStatus: { [source]: "running" }
          }
        : { status: "polling", platform: "all", phaseText: "正在创建真实手机 RPA 任务", sourceStatus: { [source]: "running" } }
    );

    const startResponse = await fetch(startEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: form.productName,
        brand: form.brand,
        spec: form.spec,
        skuId: form.skuId,
        officialUrl: form.officialUrl,
        platform,
        useRpa: true
      })
    });
    const started = await startResponse.json();
    if (!startResponse.ok || !started.taskId) {
      updateRpaConsole(root, { status: standalone ? "failed" : "polling", sourceStatus: { [source]: "failed" } });
      throw new Error(started.error || "RPA 任务触发失败");
    }
    updateRpaConsole(root, {
      status: "polling",
      platform: standalone ? platform : "all",
      taskId: standalone ? started.taskId : state.rpa.taskId || "2个RPA任务",
      mock: started.mock,
      attempt: 0,
      phaseText: started.phaseText || "手机 RPA 已触发，等待搜索和截图识价",
      nextPollMs: started.nextPollMs || 1200,
      sourceStatus: { [source]: "running" }
    });

    const pollUrl = absoluteServiceUrl(
      form,
      started.pollUrl || `${RPA_PRICE_RESULT_PATH}?taskId=${encodeURIComponent(started.taskId)}`
    );

    let nextDelay = started.nextPollMs || 1200;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      if (attempt > 1) await wait(Math.max(600, Math.min(2500, nextDelay)));
      crawlStatus(root, `手机 RPA 已触发，正在等待截图识价结果 ${attempt}/30...`);
      updateRpaConsole(root, { status: "polling", attempt });
      const resultResponse = await fetch(pollUrl);
      const payload = await resultResponse.json();
      nextDelay = payload.nextPollMs || nextDelay;
      if (!resultResponse.ok) {
        updateRpaConsole(root, { status: standalone ? "failed" : "polling", sourceStatus: { [source]: "failed" } });
        throw new Error(payload.error || "RPA 结果查询失败");
      }
      updateRpaConsole(root, {
        status: "polling",
        attempt,
        mock: payload.mock,
        phaseText: payload.phaseText || "手机 RPA 异步执行中",
        nextPollMs: payload.nextPollMs || nextDelay
      });
      if (payload.status === "succeeded" && payload.candidates && payload.candidates.length) {
        state.lastRpaResult = payload;
        updateRpaConsole(
          root,
          standalone
            ? {
                status: "succeeded",
                platform,
                taskId: payload.taskId || started.taskId,
                mock: payload.mock,
                phaseText: payload.phaseText || "手机 RPA 截图识价已入账",
                price: payload.candidates[0].finalPrice,
                images: payload.images?.length || 0,
                sourceStatus: { [source]: "succeeded" }
              }
            : { status: "polling", platform: "all", phaseText: payload.phaseText || "手机 RPA 截图识价已入账", sourceStatus: { [source]: "succeeded" } }
        );
        return decorateEvidencePayload({ ...payload, sourceKey: source }, source);
      }
      if (payload.status === "failed" || payload.status === "not_found") {
        updateRpaConsole(root, { status: standalone ? "failed" : "polling", sourceStatus: { [source]: "failed" } });
        throw new Error(payload.error || "RPA 未获取到有效结果");
      }
    }

    updateRpaConsole(root, { status: standalone ? "failed" : "polling", sourceStatus: { [source]: "failed" } });
    throw new Error("真实手机 RPA 仍在执行，暂未回传可入账价格。");
  }

  async function collectWebSource(root, form) {
    const officialUrl = officialUrlForWeb(form);
    if (!officialUrl) throw new Error("缺少网页官旗链接");

    updateRpaConsole(root, { status: "polling", platform: "all", phaseText: "网页官旗开始解析价格和详情图", sourceStatus: { web: "running" } });
    const endpoint = form.crawlerEndpoint || defaultServiceEndpoint(OFFICIAL_PRICE_PATH);
    const imageEndpoint = form.detailImageEndpoint || defaultServiceEndpoint(DETAIL_IMAGE_PATH);
    const priceResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: form.productName,
        brand: form.brand,
        spec: form.spec,
        skuId: form.skuId,
        officialUrl,
        platform: "auto",
        useRpa: false
      })
    });
    const pricePayload = await priceResponse.json();
    if (!priceResponse.ok || !pricePayload.candidates?.length) {
      updateRpaConsole(root, { status: "polling", sourceStatus: { web: "failed" } });
      throw new Error(pricePayload.error || "网页官旗价未获取到");
    }

    let imagePayload = { images: [] };
    try {
      const imageResponse = await fetch(imageEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: form.productName,
          brand: form.brand,
          spec: form.spec,
          skuId: form.skuId,
          officialUrl,
          platform: "auto",
          useRpa: false
        })
      });
      imagePayload = await imageResponse.json();
    } catch {
      imagePayload = { images: [] };
    }

    updateRpaConsole(root, { status: "polling", phaseText: "网页官旗价已获取，继续等待手机 RPA", sourceStatus: { web: "succeeded" } });
    return decorateEvidencePayload({
      ...pricePayload,
      images: imagePayload.images || [],
      sourceKey: "web",
      mock: false
    }, "web");
  }

  async function collectAllEvidence(root, form) {
    crawlStatus(root, "正在并发采集网页官旗，并触发抖音/淘宝手机 RPA...");
    setText(root, "[data-pa-price-state]", "多平台采集中");
    setText(root, "[data-pa-evidence-state]", "网页解析 + 手机RPA截图识价");
    updateRpaConsole(root, {
      status: "starting",
      platform: "all",
      taskId: "",
      mock: null,
      attempt: 0,
      price: null,
      images: 0,
      phaseText: "正在创建抖音和淘宝手机 RPA 任务",
      sourceStatus: { web: "running", douyin: "running", taobao: "running" }
    });

    const jobs = [
      collectWebSource(root, form),
      runRpaPriceTask(root, form, "douyin", "douyin", { standalone: false }),
      runRpaPriceTask(root, form, "taobao", "taobao", { standalone: false })
    ];
    const settled = await Promise.allSettled(jobs);
    const payloads = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
    if (!payloads.length) {
      updateRpaConsole(root, { status: "failed" });
      throw new Error("多平台均未获取到有效价格证据");
    }

    const merged = mergeEvidencePayloads(payloads);
    updateRpaConsole(root, {
      status: "succeeded",
      platform: "all",
      taskId: `${payloads.length}/3`,
      mock: merged.mock,
      phaseText: merged.mock ? "真实 RPA 结果未全部回传，已使用演示兜底补齐证据" : "真实多平台证据已入账",
      price: merged.candidates[0]?.finalPrice,
      images: merged.images.length
    });
    return merged;
  }

  function applyImageEvidencePayload(root, payload) {
    const groups = evidenceImagesFromPayload(payload);
    state.rpaEvidenceImages = groups;
    state.detailImages = flattenEvidenceImages(groups);
    setField(root, "evidenceImageCount", String(state.detailImages.length));
    renderRpaEvidence(root);
    renderImageList(root);
    setText(root, "[data-pa-image-state]", state.detailImages.length ? `${state.detailImages.length} 张` : "待采集");
  }

  function applyOfficialPricePayload(root, payload) {
    if (!payload.candidates || !payload.candidates.length) {
      const reason = payload.error || payload.errors?.[0]?.error || "未获取到有效官旗价";
      throw new Error(reason);
    }

    const best = payload.candidates[0];
    state.lastOfficialPrice = best;
    setField(root, "officialPrice", best.finalPrice);
    if (!getField(root, "dailyPrice").value) setField(root, "dailyPrice", best.finalPrice);
    if (!getField(root, "officialUrl").value && best.url) setField(root, "officialUrl", best.url);
    setText(root, "[data-pa-brief-official]", formatMoney(best.finalPrice));
    setText(root, "[data-pa-price-state]", `${formatMoney(best.finalPrice)} / 置信度 ${best.confidence}`);
    setText(root, "[data-pa-evidence-state]", "官旗价已获取，继续补低价/BOM");
    agentStatus(root, "官旗价已入库，可以继续生成审核意见。");

    if ((payload.images && payload.images.length) || payload.imagesBySource) {
      applyImageEvidencePayload(root, payload);
    }

    if (payload.taskId || payload.mock !== undefined) {
      updateRpaConsole(root, {
        status: "succeeded",
        platform: payload.taskId && String(payload.taskId).includes("/") ? "all" : readForm(root).platform || "all",
        taskId: payload.taskId || state.rpa.taskId,
        mock: payload.mock,
        phaseText: payload.phaseText || (payload.mock ? "真实 RPA 未按时回传，演示兜底识价已入账" : "真实手机 RPA 截图识价已入账"),
        price: best.finalPrice,
        images: payload.images?.length || state.detailImages.length
      });
    }

    crawlStatus(
      root,
      `已获取：${best.platform || "官旗"} ${best.shopName || ""}，${best.priceType || "到手价"} ${formatMoney(best.finalPrice)}，置信度 ${best.confidence}。`
    );
  }

  async function crawlOfficialPrice(root) {
    const form = readForm(root);
    const endpoint = form.crawlerEndpoint || defaultServiceEndpoint(OFFICIAL_PRICE_PATH);
    if (!endpoint) throw new Error("价格采集能力未连接，请联系管理员配置。");
    crawlStatus(root, "正在并发采集多平台价格证据...");

    const payload = await collectAllEvidence(root, form);
    applyOfficialPricePayload(root, payload);
  }

  function renderImageList(root) {
    const container = root.querySelector("[data-pa-image-list]");
    if (!container) return;
    if (!state.detailImages.length) {
      container.innerHTML = "";
      return;
    }

    const rows = state.detailImages
      .slice(0, 12)
      .map(
        (image, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(image.sourceLabel || sourceLabel(image.sourceKey || "web"))}</td>
            <td>${escapeHtml(image.type || "image")}</td>
            <td>${escapeHtml(image.confidence || "-")}</td>
            <td><a href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer">打开</a></td>
          </tr>
        `
      )
      .join("");

    container.innerHTML = `
      <table class="pa-table">
        <thead>
          <tr>
            <th>#</th>
            <th>来源</th>
            <th>类型</th>
            <th>置信度</th>
            <th>图片</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <button style="width:100%;margin-top:10px" data-pa-action="copy-images">复制详情图链接</button>
    `;
  }

  async function crawlDetailImages(root) {
    const form = readForm(root);
    const endpoint = form.detailImageEndpoint || defaultServiceEndpoint(DETAIL_IMAGE_PATH);
    if (!endpoint) throw new Error("详情图采集能力未连接，请联系管理员配置。");
    crawlStatus(root, "正在采集商品详情图...");

    let payload;
    if (!form.officialUrl && !state.lastRpaResult?.images?.length) {
      payload = await collectAllEvidence(root, form);
      applyOfficialPricePayload(root, payload);
    } else if (shouldUseRpa(form)) {
      payload = state.lastRpaResult?.images?.length ? state.lastRpaResult : await runRpaPriceTask(root, form);
      if (payload.candidates?.length && !hasValue(root, "officialPrice")) {
        applyOfficialPricePayload(root, payload);
      }
    } else {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: form.productName,
          brand: form.brand,
          spec: form.spec,
          skuId: form.skuId,
          officialUrl: officialUrlForWeb(form),
          platform: form.platform
        })
      });
      payload = await response.json();
      if (!response.ok) {
        const reason = payload.error || payload.errors?.[0]?.error || "未采集到详情图";
        throw new Error(reason);
      }
    }

    if (!payload.images || !payload.images.length) {
      const reason = payload.error || payload.errors?.[0]?.error || "未采集到详情图";
      throw new Error(reason);
    }

    const evidencePayload = payload.imagesBySource
      ? payload
      : decorateEvidencePayload({ ...payload, sourceKey: payload.sourceKey || sourceFromValue(payload.platform || form.platform, "web") }, payload.sourceKey || "web");
    applyImageEvidencePayload(root, evidencePayload);
    setText(root, "[data-pa-evidence-state]", "详情图已采集，等待价格证据");
    agentStatus(root, "详情图证据已采集。");
    crawlStatus(root, `已采集 ${state.detailImages.length} 张详情图，可交给视觉模型分析。`);
  }

  function hasValue(root, name) {
    return Boolean(getField(root, name)?.value.trim());
  }

  function refreshEvidenceStates(root) {
    const hasBom = hasValue(root, "bomLow") && hasValue(root, "bomHigh");
    const logisticsCost = analyzer.calculateFreight(readForm(root)).totalCost;
    setText(root, "[data-pa-bom-state]", hasBom ? "已补充" : "待补充");
    setText(root, "[data-pa-logistics-state]", logisticsCost > 0 ? formatMoney(logisticsCost) : "待接入");
  }

  function setCommand(root, value) {
    const input = root.querySelector("[data-pa-command-input]");
    if (input) input.value = value;
  }

  async function runRpaDemo(root) {
    setResultMode(root, false);
    setField(root, "platform", "auto");
    setField(root, "officialUrl", "");
    setField(root, "officialPrice", "");
    setField(root, "dailyPrice", "");
    setField(root, "promoPrice", "");
    setField(root, "lowestDealPrice", "");
    if (!hasValue(root, "lowPrice")) setField(root, "lowPrice", "14.2");
    if (!hasValue(root, "bomLow")) setField(root, "bomLow", "19");
    if (!hasValue(root, "bomHigh")) setField(root, "bomHigh", "21");
    state.lastOfficialPrice = null;
    state.lastRpaResult = null;
    state.detailImages = [];
    state.rpaEvidenceImages = emptyEvidenceImages();
    setField(root, "evidenceImageCount", "0");
    renderRpaEvidence(root);
    renderImageList(root);
    setText(root, "[data-pa-image-state]", "待采集");
    setText(root, "[data-pa-brief-official]", "待补");
    updateRpaConsole(root, {
      status: "selected",
      platform: "all",
      taskId: "",
      mock: null,
      attempt: 0,
      price: null,
      images: 0,
      phaseText: "等待触发真实手机 RPA",
      sourceStatus: { web: "waiting", douyin: "waiting", taobao: "waiting" }
    });
    setCommand(root, "帮我完整审核这单");
    agentStatus(root, "已切换到全平台自动取证链路，开始完整审核。");
    await runReviewAgent(root);
  }

  async function runReviewAgent(root, options = {}) {
    const form = readForm(root);
    const hasEvidenceTrigger = true;
    agentStatus(root, "麦总开始执行完整审核。");

    if (hasEvidenceTrigger && !hasValue(root, "officialPrice")) {
      agentStatus(root, "正在先查官旗到手价。");
      await crawlOfficialPrice(root);
    }

    if (hasEvidenceTrigger && !state.detailImages.length) {
      try {
        agentStatus(root, "正在补详情图证据。");
        await crawlDetailImages(root);
      } catch (error) {
        crawlStatus(root, `详情图采集失败：${error.message}`);
      }
    }

    if (!hasValue(root, "officialPrice")) {
      agentStatus(root, "还缺官旗到手价，建议先补证据再生成结论。");
      root.querySelector(".pa-focus-card")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    refreshEvidenceStates(root);
    setField(root, "evidenceImageCount", String(state.detailImages.length));
    state.result = analyzer.analyze(readForm(root));
    renderResult(root, state.result);
    if (options.scrollResult !== false) {
      root.querySelector("[data-pa-result-section]")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  async function runAssistantCommand(root, rawCommand) {
    const command = String(rawCommand || "").trim();
    if (!command) {
      agentStatus(root, "告诉麦总要做什么，例如：帮我完整审核这单。");
      return;
    }

    agentStatus(root, `收到指令：${command}`);

    if (/重读|读取|刷新|识别/.test(command)) {
      fillFromPage(root);
      showToast("麦总已重新读单");
      return;
    }

    if (/详情|图片|图证|采图/.test(command)) {
      await crawlDetailImages(root);
      showToast("麦总已采集详情图");
      return;
    }

    if (/官旗|到手价|价格|查价|爬价/.test(command) && !/完整|全部|一键|审核|判断|分析|能不能/.test(command)) {
      await crawlOfficialPrice(root);
      showToast("麦总已查询官旗价");
      return;
    }

    if (/完整|全部|一键|审核|判断|分析|能不能|过不过|结论/.test(command)) {
      await runReviewAgent(root);
      showToast("麦总已完成审核");
      return;
    }

    agentStatus(root, "这条指令我还不能自动执行。可以试试：完整审核、查官旗价、采集详情图。");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function showToast(message) {
    const root = createRoot();
    const oldToast = root.querySelector(".pa-toast");
    if (oldToast) oldToast.remove();
    const toast = document.createElement("div");
    toast.className = "pa-toast";
    toast.textContent = message;
    root.appendChild(toast);
    window.setTimeout(() => toast.remove(), 1800);
  }

  function bindEvents(root) {
    root.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-pa-action]");
      if (!button) return;

      const action = button.dataset.paAction;
      if (action === "close") {
        close();
        return;
      }

      if (action === "switch-panel") {
        setActivePanel(root, button.dataset.paPanelTarget || "evidence");
        return;
      }

      if (action === "refresh") {
        fillFromPage(root);
        setActivePanel(root, "evidence");
        showToast("已重新读取当前页面");
        return;
      }

      if (action === "select-platform") {
        const platform = button.dataset.paPlatform || "auto";
        setField(root, "platform", platform);
        updateRpaConsole(root, {
          status: platform === "auto" ? "idle" : "selected",
          platform,
          taskId: "",
          mock: null,
          attempt: 0,
          price: null,
          images: 0,
          phaseText: "等待触发真实手机 RPA"
        });
        agentStatus(root, platform === "auto" ? "已切换为网页官旗采集。" : `已切换为${platformLabel(platform)}采集。`);
        return;
      }

      if (action === "analyze") {
        try {
          await runReviewAgent(root, { scrollResult: false });
          showToast("全平台取证审核完成");
        } catch (error) {
          agentStatus(root, `审核失败：${error.message}`);
          showToast("审核失败");
        }
        return;
      }

      if (action === "quick-command") {
        const command = button.dataset.paCommand || "";
        setCommand(root, command);
        try {
          await runAssistantCommand(root, command);
        } catch (error) {
          agentStatus(root, `执行失败：${error.message}`);
          showToast("麦总执行失败");
        }
        return;
      }

      if (action === "run-command") {
        const command = root.querySelector("[data-pa-command-input]")?.value || "";
        try {
          await runAssistantCommand(root, command);
        } catch (error) {
          agentStatus(root, `执行失败：${error.message}`);
          showToast("麦总执行失败");
        }
        return;
      }

      if (action === "rpa-demo") {
        try {
          await runRpaDemo(root);
          showToast("RPA 完整审核已完成");
        } catch (error) {
          agentStatus(root, `RPA 演示失败：${error.message}`);
          showToast("RPA 演示失败");
        }
        return;
      }

      if (action === "crawl-official-price") {
        try {
          setActivePanel(root, "evidence");
          await crawlOfficialPrice(root);
          showToast("官旗价已获取");
        } catch (error) {
          crawlStatus(root, `自动爬取失败：${error.message}`);
          showToast("自动爬取失败");
        }
        return;
      }

      if (action === "crawl-detail-images") {
        try {
          setActivePanel(root, "evidence");
          await crawlDetailImages(root);
          showToast("详情图已采集");
        } catch (error) {
          crawlStatus(root, `详情图采集失败：${error.message}`);
          showToast("详情图采集失败");
        }
        return;
      }

      if (action === "copy-images") {
        await copyText(imageEvidenceText());
        showToast("详情图链接已复制");
        return;
      }

      if ((action === "copy" || action === "copy-decision") && state.result) {
        await copyText(state.result.reviewText);
        showToast("审核意见已复制");
        return;
      }

      if (action === "copy-evidence" && state.result) {
        await copyText(evidenceText(state.result));
        showToast("证据摘要已复制");
        return;
      }

      if (action === "model-review") {
        try {
          await generateModelReview(root);
        } catch (error) {
          agentStatus(root, `AI 生成失败：${error.message}`);
          showToast("AI 生成失败");
        }
      }
    });

    root.addEventListener("keydown", async (event) => {
      if (event.target.matches("[data-pa-command-input]") && event.key === "Enter") {
        event.preventDefault();
        try {
          await runAssistantCommand(root, event.target.value);
        } catch (error) {
          agentStatus(root, `执行失败：${error.message}`);
          showToast("麦总执行失败");
        }
      }
    });

    root.addEventListener("change", (event) => {
      if (!event.target.matches('[data-pa-field="platform"]')) return;
      const platform = event.target.value || "auto";
      updateRpaConsole(root, {
        status: platform === "auto" ? "idle" : "selected",
        platform,
        taskId: "",
        mock: null,
        attempt: 0,
        price: null,
        images: 0,
        phaseText: "等待触发真实手机 RPA"
      });
    });
  }

  function open() {
    const root = createRoot();
    root.classList.remove("pa-hidden");
    setPageShift(root, true);
    if (!state.extracted) fillFromPage(root);
  }

  function close() {
    const root = createRoot();
    root.classList.add("pa-hidden");
    setPageShift(root, false);
  }

  function toggle() {
    const root = createRoot();
    if (root.classList.contains("pa-hidden")) {
      open();
    } else {
      close();
    }
  }

  window.PurchaseAssistantUI = {
    open,
    close,
    toggle,
    refresh: () => fillFromPage(createRoot())
  };

  window.addEventListener("resize", () => {
    const root = document.getElementById("purchase-assistant-root");
    if (root && !root.classList.contains("pa-hidden")) setPageShift(root, true);
  });
})();
