(function initPurchaseAssistant() {
  if (window.__purchaseAssistantLoaded) return;
  window.__purchaseAssistantLoaded = true;

  const analyzer = window.PurchaseAssistantAnalyzer;
  const state = {
    extracted: null,
    result: null,
    lastOfficialPrice: null,
    detailImages: []
  };
  const OFFICIAL_PRICE_PATH = "/api/official-price";
  const DETAIL_IMAGE_PATH = "/api/detail-images";
  const PICKUP_FIELDS = [
    ["productName", "商品名"],
    ["skuId", "商品编码"],
    ["purchasePrice", "采购价"],
    ["jdPrice", "京东价"]
  ];

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
              <h2 class="pa-title">新品价格风控助手</h2>
              <p class="pa-subtitle">我会读取审批单、补齐价格证据，并给出可复制的审核意见。</p>
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
                  <h3 class="pa-hero-title">麦总正在审核这张新品单</h3>
                  <span class="pa-pill" data-pa-completeness>未识别</span>
                </div>
                <p class="pa-hero-summary" data-pa-assistant-summary>我会先读单，再补价格证据，最后给出可复制的审核意见。</p>
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
            <div class="pa-command-grid">
              <button data-pa-action="refresh">重新读单</button>
              <button data-pa-action="crawl-detail-images">采集详情图</button>
              <button data-pa-action="crawl-official-price">查询官旗价</button>
              <button class="pa-primary" data-pa-action="analyze">生成审核意见</button>
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

          <div class="pa-chat">
            <section class="pa-turn pa-turn-assistant">
              <div class="pa-message-avatar">
                <img src="${assistantAvatarUrl}" alt="">
              </div>
              <div class="pa-message-bubble">
                <h3 class="pa-section-title">下一步我需要关键证据</h3>
                <p class="pa-muted" data-pa-crawl-status>优先补官旗到手价、全网低价和 BOM 区间。证据越完整，我给出的降采建议越可靠。</p>
              </div>
            </section>

            <section class="pa-work-card pa-focus-card">
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
                <div><span>官旗价</span><strong data-pa-price-state>待获取</strong></div>
                <div><span>详情图</span><strong data-pa-image-state>待采集</strong></div>
                <div><span>BOM</span><strong data-pa-bom-state>待补充</strong></div>
              </div>
            </section>

            <section class="pa-turn pa-turn-assistant">
              <div class="pa-message-avatar">
                <img src="${assistantAvatarUrl}" alt="">
              </div>
              <div class="pa-message-bubble">
                <h3 class="pa-section-title">我会按这套口径测算</h3>
                <p class="pa-muted">默认采用可控费率 12%、不可控费率 2.5%、目标贡利率 12%。你可以按业务口径覆盖。</p>
              </div>
            </section>

            <section class="pa-work-card">
              <div class="pa-card-head">
                <h3 class="pa-section-title">测算口径</h3>
                <span class="pa-section-hint">费用率和促销场景</span>
              </div>
              <div class="pa-grid">
                ${fieldHtml("controllableRate", "可控费率 %", "number")}
                ${fieldHtml("uncontrollableRate", "不可控费率 %", "number")}
                ${fieldHtml("adRate", "自投广告 %", "number")}
                ${fieldHtml("targetProfitRate", "目标贡利率 %", "number")}
                ${fieldHtml("dailyPrice", "日销件单价", "number")}
                ${fieldHtml("promoPrice", "大促件单价", "number")}
                ${fieldHtml("lowestDealPrice", "最低凑单价", "number", true)}
              </div>
            </section>

            <section class="pa-turn pa-turn-assistant" data-pa-result-section>
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
                    <p>点击“生成审核意见”后，我会输出风险等级、建议采购价和可复制意见。</p>
                  </div>
                </div>
              </div>
            </section>

            <section class="pa-work-card pa-detail-card">
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
              <div data-pa-image-list></div>
            </section>
          </div>
        </main>
      </aside>
    `;
    document.body.appendChild(root);
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
    setText(root, "[data-pa-assistant-summary]", `已识别 ${data.productName || "当前商品"}，我会重点检查采购价、官旗价和促销贡利风险。`);
    agentStatus(root, "读单完成，下一步补价格证据。");
    setText(root, "[data-pa-read-state]", `完整度 ${data.completeness}%`);
    renderPickup(root, data);
  }

  function riskClass(level) {
    if (level === "高") return "pa-pill pa-risk-high";
    if (level === "中") return "pa-pill pa-risk-mid";
    return "pa-pill pa-risk-low";
  }

  function renderResult(root, result) {
    const risk = root.querySelector("[data-pa-risk]");
    risk.className = riskClass(result.riskLevel);
    risk.textContent = `${result.riskLevel}风险`;
    setText(root, "[data-pa-assistant-summary]", `审核完成：${result.riskLevel}风险，建议采购价 ${formatMoney(result.suggestedPurchasePrice)}。`);
    agentStatus(root, `审核完成，结论为${result.riskLevel}风险。`);
    setText(root, "[data-pa-result-state]", `${result.riskLevel}风险 / ${formatMoney(result.suggestedPurchasePrice)}`);
    const decisionSummary = root.querySelector("[data-pa-decision-summary]");
    if (decisionSummary) decisionSummary.hidden = false;
    setText(root, "[data-pa-decision-title]", result.recommendation);
    setText(root, "[data-pa-decision-risk]", `${result.riskLevel}风险`);
    setText(root, "[data-pa-decision-price]", formatMoney(result.suggestedPurchasePrice));
    setText(root, "[data-pa-decision-score]", String(result.riskScore));

    const scenarioRows = result.scenarios
      .map(
        (item) => `
          <tr>
            <td>${item.name}</td>
            <td>${formatMoney(item.price)}</td>
            <td>${formatPercent(item.contributionRate === null ? null : item.contributionRate * 100)}</td>
            <td>${formatMoney(item.contributionAmount)}</td>
            <td>${item.status}</td>
          </tr>
        `
      )
      .join("");

    root.querySelector("[data-pa-result]").innerHTML = `
      <div class="pa-answer">
        <p class="pa-answer-label">我的判断</p>
        <p class="pa-result-title">${result.recommendation}</p>
      </div>
      <div class="pa-metric-grid">
        <div class="pa-metric">
          <p class="pa-metric-label">建议采购价</p>
          <p class="pa-metric-value">${formatMoney(result.suggestedPurchasePrice)}</p>
        </div>
        <div class="pa-metric">
          <p class="pa-metric-label">采用费用率</p>
          <p class="pa-metric-value">${formatPercent(result.feeRate * 100)}</p>
        </div>
        <div class="pa-metric">
          <p class="pa-metric-label">目标贡利率</p>
          <p class="pa-metric-value">${formatPercent(result.targetRate * 100)}</p>
        </div>
        <div class="pa-metric">
          <p class="pa-metric-label">风险分</p>
          <p class="pa-metric-value">${result.riskScore}</p>
        </div>
      </div>
      <div class="pa-reason-card">
        <p class="pa-answer-label">关键理由</p>
        <ol class="pa-reasons">${result.reasons.map((reason) => `<li>${reason}</li>`).join("")}</ol>
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
      <div class="pa-actions pa-result-actions">
        <button class="pa-copy" data-pa-action="copy">复制审核意见</button>
        <button data-pa-action="copy-evidence">复制证据摘要</button>
      </div>
    `;
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
      `建议采购价：${formatMoney(result.suggestedPurchasePrice)}`,
      ...officialEvidence,
      `结论：${result.recommendation}`
    ].join("\n");
  }

  function imageEvidenceText() {
    if (!state.detailImages.length) return "暂无详情图证据";
    return [
      "商品详情图证据",
      ...state.detailImages.map((image, index) => {
        return `${index + 1}. [${image.type || "image"}] ${image.url} 置信度 ${image.confidence || "-"} 说明：${image.alt || image.evidence || "-"}`;
      })
    ].join("\n");
  }

  function crawlStatus(root, message) {
    const status = root.querySelector("[data-pa-crawl-status]");
    if (status) status.textContent = message;
  }

  async function crawlOfficialPrice(root) {
    const form = readForm(root);
    const endpoint = form.crawlerEndpoint || defaultServiceEndpoint(OFFICIAL_PRICE_PATH);
    if (!endpoint) throw new Error("价格采集能力未连接，请联系管理员配置。");
    crawlStatus(root, "正在爬取官旗到手价...");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: form.productName,
        brand: form.brand,
        spec: form.spec,
        skuId: form.skuId,
        officialUrl: form.officialUrl
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.candidates || !payload.candidates.length) {
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

    crawlStatus(
      root,
      `已获取：${best.platform || "官旗"} ${best.shopName || ""}，${best.priceType || "到手价"} ${formatMoney(best.finalPrice)}，置信度 ${best.confidence}。`
    );
  }

  function renderImageList(root) {
    const container = root.querySelector("[data-pa-image-list]");
    if (!container) return;
    if (!state.detailImages.length) {
      container.innerHTML = "";
      return;
    }

    const rows = state.detailImages
      .slice(0, 8)
      .map(
        (image, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${image.type || "image"}</td>
            <td>${image.confidence || "-"}</td>
            <td><a href="${image.url}" target="_blank" rel="noreferrer">打开</a></td>
          </tr>
        `
      )
      .join("");

    container.innerHTML = `
      <table class="pa-table">
        <thead>
          <tr>
            <th>#</th>
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

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: form.productName,
        brand: form.brand,
        spec: form.spec,
        skuId: form.skuId,
        officialUrl: form.officialUrl
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.images || !payload.images.length) {
      const reason = payload.error || payload.errors?.[0]?.error || "未采集到详情图";
      throw new Error(reason);
    }

    state.detailImages = payload.images;
    renderImageList(root);
    setText(root, "[data-pa-image-state]", `${payload.images.length} 张`);
    setText(root, "[data-pa-evidence-state]", "详情图已采集，等待价格证据");
    agentStatus(root, "详情图证据已采集。");
    crawlStatus(root, `已采集 ${payload.images.length} 张详情图，可交给视觉模型分析。`);
  }

  function hasValue(root, name) {
    return Boolean(getField(root, name)?.value.trim());
  }

  function refreshEvidenceStates(root) {
    const hasBom = hasValue(root, "bomLow") && hasValue(root, "bomHigh");
    setText(root, "[data-pa-bom-state]", hasBom ? "已补充" : "待补充");
  }

  function setCommand(root, value) {
    const input = root.querySelector("[data-pa-command-input]");
    if (input) input.value = value;
  }

  async function runReviewAgent(root) {
    const hasOfficialUrl = hasValue(root, "officialUrl");
    agentStatus(root, "麦总开始执行完整审核。");

    if (hasOfficialUrl && !hasValue(root, "officialPrice")) {
      agentStatus(root, "正在先查官旗到手价。");
      await crawlOfficialPrice(root);
    }

    if (hasOfficialUrl && !state.detailImages.length) {
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
    state.result = analyzer.analyze(readForm(root));
    renderResult(root, state.result);
    root.querySelector("[data-pa-result-section]")?.scrollIntoView({ block: "center", behavior: "smooth" });
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

      if (action === "refresh") {
        fillFromPage(root);
        showToast("已重新读取当前页面");
        return;
      }

      if (action === "analyze") {
        refreshEvidenceStates(root);
        state.result = analyzer.analyze(readForm(root));
        renderResult(root, state.result);
        showToast("分析完成");
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

      if (action === "crawl-official-price") {
        try {
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
