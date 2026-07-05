const crypto = require("node:crypto");

const tasks = new Map();
const DEFAULT_FALLBACK_DELAY_MS = 15000;
const DEFAULT_NEXT_POLL_MS = 1200;

function compactText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[%¥￥,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function platformFromPayload(payload) {
  const platform = compactText(payload.platform || "").toLowerCase();
  if (["douyin", "抖音"].includes(platform)) return "douyin";
  if (["taobao", "tmall", "淘宝", "天猫"].includes(platform)) return "taobao";

  const url = compactText(payload.officialUrl || "").toLowerCase();
  if (/^rpa:\/\/douyin/.test(url) || /douyin|jinritemai/.test(url)) return "douyin";
  if (/^rpa:\/\/(?:taobao|tmall)/.test(url) || /taobao|tmall/.test(url)) return "taobao";
  return "auto";
}

function shouldUseRpa(payload) {
  if (payload.useRpa === true || payload.useRpa === "true") return true;
  return ["douyin", "taobao"].includes(platformFromPayload(payload));
}

function displayPlatform(platform) {
  if (platform === "douyin") return "抖音";
  if (platform === "taobao") return "淘宝/天猫";
  return "RPA";
}

function mockPriceFor(payload) {
  const text = `${payload.productName || ""} ${payload.searchWord || ""} ${payload.spec || ""}`;
  if (/西红柿|番茄/.test(text)) return 8;
  if (/喜崽|猫餐盒|猫罐头|猫/.test(text)) return 27.99;
  return 19.9;
}

function mockSkuNameFor(payload) {
  const text = compactText(payload.productName || payload.searchWord || "");
  if (/西红柿|番茄/.test(text)) return "普罗旺斯番茄 约500g";
  return text || "RPA 模拟商品";
}

function buildMockRaw(payload) {
  const price = mockPriceFor(payload);
  const skuName = mockSkuNameFor(payload);
  const platform = platformFromPayload(payload);
  return {
    price,
    skuName,
    pics: [
      "https://internal-storage.example/rpa/detail-001.png",
      "https://internal-storage.example/rpa/detail-002.png"
    ],
    searchWord: compactText(payload.searchWord || payload.productName || skuName),
    platform: displayPlatform(platform)
  };
}

function looseBodyData(value) {
  if (!value || typeof value !== "string") return null;
  const data = {};
  const price = value.match(/"price"\s*:\s*"?([\d.]+)"?/);
  const skuName = value.match(/"skuName"\s*:\s*"([^"]+)"/);
  const searchWord = value.match(/"searchWord"\s*:\s*"([^"]+)"/);
  const pics = value.match(/"pics"\s*:\s*"([^"]+)"/);
  if (price) data.price = price[1];
  if (skuName) data.skuName = skuName[1];
  if (searchWord) data.searchWord = searchWord[1];
  if (pics) data.pics = pics[1];
  return Object.keys(data).length ? data : null;
}

function normalizeRawResult(raw, task) {
  const body =
    typeof raw?.body === "string"
      ? safeJson(raw.body) || looseBodyData(raw.body) || raw
      : raw || {};
  const data = body.data || body.result || body;
  const price = numberOrNull(data.price ?? data.finalPrice ?? data.couponPrice ?? data.salePrice);
  const skuName = compactText(data.skuName || data.title || data.productName || task.payload.productName || task.payload.searchWord);
  const platform = task.platform;
  const shopName = compactText(data.shopName || data.shop || `${task.payload.brand || displayPlatform(platform)}官方旗舰店`);
  const pics = normalizePics(data.pics || data.images || data.imageUrls || data.picUrls);
  const capturedAt = new Date().toISOString();

  const candidate = {
    platform: displayPlatform(platform),
    sourceKey: platform,
    taskId: task.taskId,
    shopName,
    title: skuName,
    url: compactText(data.shareLink || data.url || task.payload.officialUrl || ""),
    finalPrice: price,
    listPrice: numberOrNull(data.listPrice || data.salePrice) || price,
    priceType: task.mock ? "演示兜底识价" : "手机RPA截图识价",
    couponDiscount: null,
    confidence: scoreRpaResult({ skuName, price, payload: task.payload }),
    evidence: `${task.mock ? "演示兜底" : "影刀手机RPA"}截图/OCR price=${price ?? "-"}, skuName=${skuName || "-"}`,
    capturedAt
  };

  const images = pics.map((url, index) => ({
    url,
    type: index === 0 ? "detail" : "screenshot",
    platform: displayPlatform(platform),
    sourceKey: platform,
    taskId: task.taskId,
    alt: `${displayPlatform(platform)}RPA采集图 ${index + 1}`,
    confidence: task.mock ? 70 : 82,
    evidence: `${task.mock ? "演示兜底" : "影刀手机RPA"}返回 pics 字段`
  }));

  return {
    ok: Boolean(price),
    taskId: task.taskId,
    status: price ? "succeeded" : "failed",
    platform: displayPlatform(platform),
    mock: task.mock,
    candidates: price ? [candidate] : [],
    images,
    raw: data,
    capturedAt
  };
}

function normalizePics(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => compactText(item.url || item)).filter(Boolean);
  return String(value)
    .split(/[,，\s]+/)
    .map(compactText)
    .filter(Boolean);
}

function scoreRpaResult({ skuName, price, payload }) {
  let score = price ? 45 : 0;
  const haystack = skuName.toLowerCase();
  const brand = compactText(payload.brand).toLowerCase();
  const spec = compactText(payload.spec).toLowerCase();
  if (brand && haystack.includes(brand)) score += 20;
  if (spec && haystack.includes(spec)) score += 15;
  const terms = compactText(payload.productName)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((item) => item.length >= 2)
    .slice(0, 6);
  if (terms.length) {
    const matched = terms.filter((term) => haystack.includes(term)).length;
    score += Math.round((matched / terms.length) * 20);
  }
  return Math.max(0, Math.min(100, score || 60));
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function envFlag(name, defaultValue = true) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function fallbackDelayMs() {
  const configured = Number(process.env.RPA_MOCK_DELAY_MS || process.env.RPA_FALLBACK_DELAY_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return DEFAULT_FALLBACK_DELAY_MS;
}

function nextPollMs(task) {
  const configured = Number(process.env.RPA_NEXT_POLL_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (task.status === "running" && task.fallbackAt) {
    const remaining = task.fallbackAt - Date.now();
    if (remaining > 0 && remaining < DEFAULT_NEXT_POLL_MS) return Math.max(400, remaining);
  }
  return DEFAULT_NEXT_POLL_MS;
}

function phaseText(task) {
  const phase = task.phase;
  if (task.status === "succeeded") {
    return task.mock ? "真实结果未按时回传，已使用演示兜底识价入账" : "真实手机 RPA 截图识价已入账";
  }
  if (task.status === "failed") return task.error || "手机 RPA 任务失败";

  return (
    {
      created: "任务已创建，准备连接手机 RPA",
      waiting_config: "等待真实影刀配置，任务保持异步等待",
      dispatching: "正在调用影刀创建手机 RPA 任务",
      mobile_running: "手机 RPA 已启动，正在 App 搜索商品",
      waiting_result_api: "已触发手机 RPA，等待结果接口回传",
      result_polling: "正在查询手机截图识价结果",
      result_pending: "影刀仍在执行，继续轮询",
      fallback_wait: "真实结果暂未回传，等待兜底窗口",
      fallback_running: "真实结果超时，正在使用演示兜底识价"
    }[phase] || "手机 RPA 异步执行中"
  );
}

function refreshTaskPhase(task) {
  if (task.status !== "running") return;
  if (task.fallbackAt && Date.now() >= task.fallbackAt) {
    completeFallback(task);
    return;
  }
  if (task.fallbackAt && task.fallbackAt - Date.now() <= 5000) {
    task.phase = "fallback_wait";
    task.updatedAt = new Date().toISOString();
  }
}

function taskSnapshot(task) {
  refreshTaskPhase(task);
  return {
    ok: task.status !== "failed",
    taskId: task.taskId,
    status: task.status,
    platform: displayPlatform(task.platform),
    mock: task.mock,
    phase: task.phase,
    phaseText: phaseText(task),
    taskMode: task.taskMode || "real-first",
    externalJobId: task.externalJobId || "",
    fallbackAt: task.fallbackAt ? new Date(task.fallbackAt).toISOString() : "",
    nextPollMs: nextPollMs(task),
    pollUrl: `/api/rpa/price/result?taskId=${encodeURIComponent(task.taskId)}`,
    candidates: task.result?.candidates || [],
    images: task.result?.images || [],
    error: task.error || "",
    startedAt: task.startedAt,
    updatedAt: task.updatedAt
  };
}

function completeFallback(task) {
  if (task.status !== "running") return;
  task.mock = true;
  task.phase = "fallback_running";
  task.updatedAt = new Date().toISOString();
  const raw = buildMockRaw(task.payload);
  task.result = normalizeRawResult(raw, task);
  task.status = task.result.status;
  task.phase = task.status === "succeeded" ? "succeeded" : "failed";
  task.updatedAt = new Date().toISOString();
}

function scheduleFallbackCompletion(task, reason, delayMs = fallbackDelayMs()) {
  if (!task.fallbackAllowed) {
    task.status = "failed";
    task.phase = "failed";
    task.error = reason;
    task.updatedAt = new Date().toISOString();
    return;
  }
  if (task.fallbackTimer) return;
  task.error = reason;
  task.fallbackAt = Date.now() + Math.max(0, delayMs);
  task.updatedAt = new Date().toISOString();
  setTimeout(() => {
    completeFallback(task);
  }, Math.max(0, delayMs));
}

function hasYingdaoConfig() {
  return Boolean(
    process.env.YINGDAO_ACCESS_KEY_ID &&
      process.env.YINGDAO_ACCESS_KEY_SECRET &&
      process.env.YINGDAO_PRICE_ROBOT_UUID &&
      process.env.YINGDAO_ACCOUNT_NAME
  );
}

async function getYingdaoToken() {
  const tokenUrl = process.env.YINGDAO_TOKEN_URL || "https://api.yingdao.com/oapi/token/v2/token/create";
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accessKeyId: process.env.YINGDAO_ACCESS_KEY_ID,
      accessKeySecret: process.env.YINGDAO_ACCESS_KEY_SECRET
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || `影刀 token HTTP ${response.status}`);
  const token =
    payload.accessToken ||
    payload.token ||
    payload.data?.accessToken ||
    payload.data?.token ||
    payload.result?.accessToken ||
    payload.result?.token;
  if (!token) throw new Error("影刀 token 响应中未找到 accessToken");
  return token;
}

function sourceForPlatform(platform, payload) {
  if (payload.source !== undefined && payload.source !== "") return Number(payload.source);
  if (platform === "douyin") return Number(process.env.YINGDAO_DOUYIN_SOURCE || 100);
  if (platform === "taobao") return Number(process.env.YINGDAO_TAOBAO_SOURCE || 200);
  return Number(process.env.YINGDAO_DEFAULT_SOURCE || 100);
}

function externalJobId(payload) {
  return (
    payload.jobId ||
    payload.taskId ||
    payload.data?.jobId ||
    payload.data?.taskId ||
    payload.result?.jobId ||
    payload.result?.taskId ||
    payload.data?.id ||
    payload.result?.id ||
    ""
  );
}

async function startYingdaoJob(task) {
  const dispatchUrl = process.env.YINGDAO_DISPATCH_URL || "https://api.yingdao.com/oapi/dispatch/v2/job/start";
  const token = await getYingdaoToken();
  const searchWord = compactText(task.payload.searchWord || task.payload.productName || task.payload.brand || "");
  const source = sourceForPlatform(task.platform, task.payload);
  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      robotUuid: process.env.YINGDAO_PRICE_ROBOT_UUID,
      accountName: process.env.YINGDAO_ACCOUNT_NAME,
      params: [
        { name: "searchWord", value: searchWord, type: "string" },
        { name: "source", value: source, type: "int" }
      ]
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || `影刀任务启动 HTTP ${response.status}`);
  return payload;
}

async function fetchYingdaoResult(task) {
  const resultUrl = process.env.YINGDAO_RESULT_URL;
  if (!resultUrl || !task.externalJobId) return null;

  const method = (process.env.YINGDAO_RESULT_METHOD || "GET").toUpperCase();
  const token = await getYingdaoToken();
  const url =
    method === "GET"
      ? `${resultUrl}${resultUrl.includes("?") ? "&" : "?"}taskId=${encodeURIComponent(task.externalJobId)}`
      : resultUrl;
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: method === "GET" ? undefined : JSON.stringify({ taskId: task.externalJobId })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || `影刀结果查询 HTTP ${response.status}`);

  const status = compactText(payload.status || payload.data?.status || payload.result?.status).toLowerCase();
  if (["running", "pending", "processing", "created", "queued", "doing"].includes(status)) return null;
  return payload;
}

async function startRpaTask(payload) {
  const platform = platformFromPayload(payload);
  const task = {
    taskId: crypto.randomUUID(),
    status: "running",
    platform: platform === "auto" ? "douyin" : platform,
    payload: {
      ...payload,
      searchWord: compactText(payload.searchWord || payload.productName || payload.brand || "")
    },
    mock: false,
    fallbackAllowed: envFlag("RPA_ALLOW_MOCK_FALLBACK", true) && payload.allowMockFallback !== false,
    taskMode: hasYingdaoConfig() ? "real-first" : "waiting-config",
    phase: "created",
    result: null,
    error: "",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  tasks.set(task.taskId, task);

  if (!hasYingdaoConfig()) {
    task.phase = "waiting_config";
    scheduleFallbackCompletion(task, "未配置真实影刀凭据，已保留异步任务等待兜底。");
    return taskSnapshot(task);
  }

  try {
    task.phase = "dispatching";
    task.updatedAt = new Date().toISOString();
    const started = await startYingdaoJob(task);
    task.externalStartResponse = started;
    task.externalJobId = externalJobId(started);
    task.phase = task.externalJobId ? "mobile_running" : "waiting_result_api";
    task.updatedAt = new Date().toISOString();
    if (!process.env.YINGDAO_RESULT_URL || !task.externalJobId) {
      scheduleFallbackCompletion(task, "已触发真实手机 RPA，但未配置结果查询接口或未返回外部任务号。");
    }
  } catch (error) {
    task.phase = "fallback_wait";
    scheduleFallbackCompletion(task, `影刀任务启动失败：${error.message}`);
  }

  return taskSnapshot(task);
}

async function getRpaTaskResult(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    return { ok: false, status: "not_found", error: "RPA 任务不存在", candidates: [], images: [] };
  }

  if (task.status === "running" && !task.mock && process.env.YINGDAO_RESULT_URL && task.externalJobId) {
    try {
      task.phase = "result_polling";
      task.updatedAt = new Date().toISOString();
      const raw = await fetchYingdaoResult(task);
      if (raw) {
        task.result = normalizeRawResult(raw, task);
        task.status = task.result.status;
        task.phase = task.status === "succeeded" ? "succeeded" : "failed";
        task.updatedAt = new Date().toISOString();
      } else {
        task.phase = "result_pending";
        task.updatedAt = new Date().toISOString();
      }
    } catch (error) {
      scheduleFallbackCompletion(task, `影刀结果查询失败：${error.message}`);
    }
  }

  return taskSnapshot(task);
}

function rawTaskId(raw) {
  return (
    raw?.taskId ||
    raw?.data?.taskId ||
    raw?.result?.taskId ||
    raw?.jobId ||
    raw?.data?.jobId ||
    raw?.result?.jobId ||
    ""
  );
}

function findTaskForRaw(raw) {
  const id = rawTaskId(raw);
  if (id && tasks.has(id)) return tasks.get(id);

  const externalId = externalJobId(raw);
  if (externalId) {
    for (const task of tasks.values()) {
      if (task.externalJobId === externalId) return task;
    }
  }

  const body = typeof raw?.body === "string" ? safeJson(raw.body) || looseBodyData(raw.body) : raw?.body || raw;
  const searchWord = compactText(body?.searchWord || body?.data?.searchWord || body?.result?.searchWord);
  if (searchWord) {
    const candidates = Array.from(tasks.values())
      .filter((task) => task.status === "running" && compactText(task.payload.searchWord) === searchWord)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    if (candidates.length) return candidates[0];
  }
  return null;
}

function completeRpaTask(raw) {
  const task = findTaskForRaw(raw);
  if (!task) {
    return { ok: false, status: "not_found", error: "未找到可入账的 RPA 任务", candidates: [], images: [] };
  }
  task.mock = false;
  task.result = normalizeRawResult(raw, task);
  task.status = task.result.status;
  task.phase = task.status === "succeeded" ? "succeeded" : "failed";
  task.updatedAt = new Date().toISOString();
  return taskSnapshot(task);
}

module.exports = {
  completeRpaTask,
  getRpaTaskResult,
  platformFromPayload,
  shouldUseRpa,
  startRpaTask
};
