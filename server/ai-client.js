function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[%¥￥,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value) {
  const num = numberOrNull(value);
  return num === null ? "-" : `${num.toFixed(2)} 元`;
}

function compactText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function zzzApiKey() {
  return process.env.ZZZ_API_KEY || process.env.ZHIZENGZENG_API_KEY || "";
}

function zzzBaseUrl() {
  return (process.env.ZZZ_BASE_URL || process.env.ZHIZENGZENG_BASE_URL || "https://api.zhizengzeng.com/v1").replace(/\/+$/, "");
}

function zzzModel() {
  return process.env.ZZZ_MODEL || process.env.ZHIZENGZENG_MODEL || "chat-latest";
}

function completionUrl(baseUrl) {
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function buildLocalDraft(payload) {
  const result = payload.result || {};
  const input = result.input || {};
  const priceAdvice = result.priceAdvice || {};
  const actions = result.actionItems || [];
  const strengths = result.strengths || [];
  const reasons = result.reasons || [];

  return [
    `Boss 审批意见：${result.recommendation || "建议人工复核后决策"}`,
    `商品：${input.productName || "未识别商品"}。品牌提报采购价 ${formatMoney(input.purchasePrice)}，官旗到手价 ${formatMoney(input.officialPrice)}，含运费建议采购价上限 ${formatMoney(result.suggestedPurchasePrice)}。`,
    `利润口径：采用费用率 ${((numberOrNull(result.feeRate) || 0) * 100).toFixed(1)}%，计费重运费 ${formatMoney(result.logisticsCost)}，目标贡利率 ${((numberOrNull(result.targetRate) || 0) * 100).toFixed(1)}%。建议采购区间 ${formatMoney(priceAdvice.purchaseLower)}-${formatMoney(priceAdvice.purchaseUpper)}。`,
    "",
    "可以表扬：",
    ...(strengths.length ? strengths : ["基础读单完成，后续补齐证据后可进入复核。"]).map((item, index) => `${index + 1}. ${item}`),
    "",
    "需要整改：",
    ...(actions.length ? actions : reasons).slice(0, 4).map((item, index) => `${index + 1}. ${item}`),
    "",
    "结论：当前不建议直接通过。请采销补齐外部价盘证据，并与品牌围绕采购价、运费资源和促销限制重新确认。"
  ].join("\n");
}

function slimResult(result) {
  if (!result) return {};
  return {
    recommendation: result.recommendation,
    riskLevel: result.riskLevel,
    riskScore: result.riskScore,
    suggestedPurchasePrice: result.suggestedPurchasePrice,
    logisticsCost: result.logisticsCost,
    evidenceCompleteness: result.evidenceCompleteness,
    input: result.input,
    priceAdvice: result.priceAdvice,
    reasons: result.reasons,
    actionItems: result.actionItems,
    strengths: result.strengths,
    scenarios: result.scenarios,
    evidenceChain: result.evidenceChain
  };
}

async function callZhizengzeng(payload) {
  const apiKey = zzzApiKey();
  if (!apiKey) return null;

  const response = await fetch(completionUrl(zzzBaseUrl()), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: zzzModel(),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你是采销新品审核助手，只能依据输入的结构化数据写审核意见。不要编造价格、SKU、平台或结论。输出中文，语气像采销审核记录，不要使用夸张营销话术。"
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: "生成 Boss 复核版新品审核意见，包含结论、证据、利润口径、表扬点、整改建议。",
              result: slimResult(payload.result),
              evidenceText: compactText(payload.evidenceText).slice(0, 5000),
              imageEvidenceText: compactText(payload.imageEvidenceText).slice(0, 3000)
            },
            null,
            2
          )
        }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.message || `智增增 HTTP ${response.status}`);
  const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("智增增响应中没有可用文本");
  return compactText(content);
}

async function generateReviewDraft(payload) {
  const configured = Boolean(zzzApiKey());
  const fallback = buildLocalDraft(payload);
  if (!configured) {
    return {
      ok: true,
      provider: "local-rules",
      configured: false,
      draft: fallback
    };
  }

  try {
    const draft = await callZhizengzeng(payload);
    return {
      ok: true,
      provider: "zhizengzeng",
      configured: true,
      model: zzzModel(),
      draft
    };
  } catch (error) {
    return {
      ok: true,
      provider: "local-fallback",
      configured: true,
      error: error.message,
      draft: `${fallback}\n\n模型调用异常：${error.message}`
    };
  }
}

module.exports = {
  buildLocalDraft,
  generateReviewDraft
};
