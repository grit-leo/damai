(function attachAnalyzer(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.PurchaseAssistantAnalyzer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAnalyzer() {
  const MONEY_PATTERN = /(?:[¥￥]\s*)?([0-9]+(?:\.[0-9]+)?)/;
  const PERCENT_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*%/;

  const FIELD_LABELS = {
    productName: ["商品名称", "商品名", "品名", "标题", "主商品信息"],
    skuId: ["商品编码", "商品编号", "SKU", "sku", "SKUID", "申请单ID", "申请单号"],
    brand: ["品牌", "品牌名称"],
    category: ["类目", "分类", "商品分类"],
    spec: ["规格", "净含量", "型号", "重量", "包装规格"],
    supplier: ["供应商", "商家", "供应商商家"],
    purchasePrice: ["采购价", "采销价", "供货价", "报价", "采购成本", "仓报价"],
    jdPrice: ["京东价", "JD价", "销售价", "零售价", "标价"],
    expectedGrossMargin: ["预计毛利率", "预估毛利率", "毛利率"],
    freightCost: ["履约运费", "运费成本", "配送费", "仓配费", "单件运费"],
    packageWeightKg: ["实重", "实际重量", "重量", "毛重"],
    packageLengthCm: ["长", "长度"],
    packageWidthCm: ["宽", "宽度"],
    packageHeightCm: ["高", "高度"],
    packagingCost: ["包材费", "包装费", "仓配作业费", "仓储作业费", "操作费"],
    freightSurcharge: ["冷链加收", "重货加收", "特殊履约费", "偏远加收"]
  };

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

  function formatMoney(value) {
    const num = numberOrNull(value);
    return num === null ? "-" : `${num.toFixed(2)} 元`;
  }

  function formatPercent(value) {
    const num = numberOrNull(value);
    return num === null ? "-" : `${num.toFixed(1)}%`;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function valueAfterLabel(text, labels) {
    for (const label of labels) {
      const regex = new RegExp(`${escapeRegExp(label)}\\s*[:：]?\\s*([^\\n\\r]{1,100})`, "i");
      const match = text.match(regex);
      if (match && match[1]) {
        return compactText(match[1]).replace(/^[-|：:]+/, "").trim();
      }
    }
    return "";
  }

  function moneyNearLabel(text, labels) {
    for (const label of labels) {
      const regex = new RegExp(`${escapeRegExp(label)}[\\s\\S]{0,80}?${MONEY_PATTERN.source}`, "i");
      const match = text.match(regex);
      if (match) return numberOrNull(match[1]);
    }
    return null;
  }

  function percentNearLabel(text, labels) {
    for (const label of labels) {
      const regex = new RegExp(`${escapeRegExp(label)}[\\s\\S]{0,80}?${PERCENT_PATTERN.source}`, "i");
      const match = text.match(regex);
      if (match) return numberOrNull(match[1]);
    }
    return null;
  }

  function trimField(value, maxLength) {
    const text = compactText(value);
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function extractFromText(text) {
    const normalized = compactText(text);
    return {
      productName: trimField(valueAfterLabel(normalized, FIELD_LABELS.productName), 90),
      skuId: trimField(valueAfterLabel(normalized, FIELD_LABELS.skuId), 50),
      brand: trimField(valueAfterLabel(normalized, FIELD_LABELS.brand), 40),
      category: trimField(valueAfterLabel(normalized, FIELD_LABELS.category), 40),
      spec: trimField(valueAfterLabel(normalized, FIELD_LABELS.spec), 40),
      supplier: trimField(valueAfterLabel(normalized, FIELD_LABELS.supplier), 60),
      purchasePrice: moneyNearLabel(normalized, FIELD_LABELS.purchasePrice),
      jdPrice: moneyNearLabel(normalized, FIELD_LABELS.jdPrice),
      expectedGrossMargin: percentNearLabel(normalized, FIELD_LABELS.expectedGrossMargin),
      freightCost: moneyNearLabel(normalized, FIELD_LABELS.freightCost),
      packageWeightKg: moneyNearLabel(normalized, FIELD_LABELS.packageWeightKg),
      packageLengthCm: moneyNearLabel(normalized, FIELD_LABELS.packageLengthCm),
      packageWidthCm: moneyNearLabel(normalized, FIELD_LABELS.packageWidthCm),
      packageHeightCm: moneyNearLabel(normalized, FIELD_LABELS.packageHeightCm),
      packagingCost: moneyNearLabel(normalized, FIELD_LABELS.packagingCost),
      freightSurcharge: moneyNearLabel(normalized, FIELD_LABELS.freightSurcharge)
    };
  }

  function findLikelyImage(doc) {
    const images = Array.from(doc.images || []);
    const candidates = images
      .map((image) => {
        const rect = image.getBoundingClientRect();
        const area = Math.max(rect.width, image.naturalWidth || 0) * Math.max(rect.height, image.naturalHeight || 0);
        return {
          src: image.currentSrc || image.src || "",
          alt: image.alt || "",
          area
        };
      })
      .filter((item) => item.src && item.area >= 1600 && !item.src.startsWith("data:image/svg"))
      .sort((a, b) => b.area - a.area);
    return candidates[0] || null;
  }

  function completeness(data) {
    const required = ["productName", "purchasePrice", "jdPrice"];
    const optional = ["skuId", "spec", "brand", "category", "supplier"];
    const requiredScore = required.reduce((score, key) => score + (data[key] ? 18 : 0), 0);
    const optionalScore = optional.reduce((score, key) => score + (data[key] ? 6 : 0), 0);
    const imageScore = data.imageUrl ? 16 : 0;
    return Math.min(100, requiredScore + optionalScore + imageScore);
  }

  function extractPageData(doc) {
    const textData = extractFromText(doc.body ? doc.body.innerText : "");
    const metaTitle = doc.querySelector("meta[property='og:title']")?.content || "";
    const title = compactText(metaTitle || doc.title || "");
    const image = findLikelyImage(doc);
    const merged = {
      ...textData,
      productName: textData.productName || trimField(title, 90),
      imageUrl: image?.src || "",
      imageAlt: image?.alt || "",
      pageUrl: doc.location?.href || "",
      extractedAt: new Date().toISOString()
    };
    merged.completeness = completeness(merged);
    return merged;
  }

  function roundMoney(value) {
    const num = numberOrNull(value);
    return num === null ? null : Number(num.toFixed(2));
  }

  function clampMoney(value) {
    const num = numberOrNull(value);
    return num === null ? null : Math.max(0, Number(num.toFixed(2)));
  }

  function statusTone(status) {
    if (status === "亏损" || status === "需改正") return "danger";
    if (status === "低于目标" || status === "待补证") return "warn";
    return "good";
  }

  function positiveOrDefault(value, defaultValue) {
    const num = numberOrNull(value);
    return num !== null && num > 0 ? num : defaultValue;
  }

  function inferWeightFromSpec(spec) {
    const text = compactText(spec);
    if (!text) return null;
    const kg = text.match(/([0-9]+(?:\.[0-9]+)?)\s*kg/i);
    if (kg) return numberOrNull(kg[1]);
    const gram = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:g|克)/i);
    if (gram) return Number((numberOrNull(gram[1]) / 1000).toFixed(3));
    return null;
  }

  function ceilToUnit(value, unit) {
    const num = numberOrNull(value);
    const step = positiveOrDefault(unit, 1);
    if (num === null) return null;
    return Number((Math.ceil((num - 1e-9) / step) * step).toFixed(3));
  }

  function calculateFreight(input) {
    const packageCount = positiveOrDefault(input.packageCount, 1);
    const inferredWeight = inferWeightFromSpec(input.spec);
    const singleWeight = positiveOrDefault(input.packageWeightKg, inferredWeight || 0);
    const length = numberOrNull(input.packageLengthCm);
    const width = numberOrNull(input.packageWidthCm);
    const height = numberOrNull(input.packageHeightCm);
    const divisor = positiveOrDefault(input.volumeDivisor, 8000);
    const firstWeight = positiveOrDefault(input.firstWeightKg, 1);
    const firstFee = numberOrNull(input.firstFreightFee) ?? 0;
    const continuedWeight = positiveOrDefault(input.continuedWeightKg, 1);
    const continuedFee = numberOrNull(input.continuedFreightFee) ?? 0;
    const packagingCost = numberOrNull(input.packagingCost) || 0;
    const freightSurcharge = numberOrNull(input.freightSurcharge) || 0;
    const shippingSubsidy = numberOrNull(input.shippingSubsidy) || 0;
    const manualFreightCost = numberOrNull(input.freightCost);
    const hasTemplate = Boolean(firstFee || continuedFee || singleWeight || (length && width && height));

    const actualWeight = singleWeight ? Number((singleWeight * packageCount).toFixed(3)) : null;
    const volumeWeight = length && width && height ? Number(((length * width * height * packageCount) / divisor).toFixed(3)) : null;
    const rawChargeableWeight =
      actualWeight !== null || volumeWeight !== null ? Math.max(actualWeight || 0, volumeWeight || 0) : null;
    const billedWeight =
      rawChargeableWeight === null
        ? null
        : rawChargeableWeight <= firstWeight
          ? firstWeight
          : Number((firstWeight + Math.ceil((rawChargeableWeight - firstWeight - 1e-9) / continuedWeight) * continuedWeight).toFixed(3));
    const continuedUnits = billedWeight === null ? 0 : Math.max(0, Math.round((billedWeight - firstWeight) / continuedWeight));
    const templateFee = billedWeight === null ? null : firstFee + continuedUnits * continuedFee;
    const totalCost =
      templateFee === null
        ? manualFreightCost
        : Math.max(0, templateFee + packagingCost + freightSurcharge - shippingSubsidy);

    return {
      mode: templateFee === null ? (manualFreightCost !== null ? "manual" : "missing") : "template",
      source: templateFee === null ? "人工运费覆盖" : "实重/体积重计费模板",
      packageCount,
      singleWeight,
      actualWeight,
      length,
      width,
      height,
      divisor,
      volumeWeight,
      rawChargeableWeight,
      billedWeight,
      firstWeight,
      firstFee,
      continuedWeight,
      continuedFee,
      continuedUnits,
      packagingCost,
      freightSurcharge,
      shippingSubsidy,
      manualFreightCost,
      totalCost: totalCost === null ? 0 : Number(totalCost.toFixed(2)),
      hasTemplate
    };
  }

  function scenario(name, price, purchasePrice, feeRate, targetRate, logisticsCost) {
    const validPrice = numberOrNull(price);
    const purchase = numberOrNull(purchasePrice);
    if (!validPrice || !purchase) {
      return {
        name,
        price: validPrice,
        contributionRate: null,
        contributionAmount: null,
        status: "缺少价格"
      };
    }

    const logistics = numberOrNull(logisticsCost) || 0;
    const contributionAmount = validPrice - purchase - validPrice * feeRate - logistics;
    const contributionRate = contributionAmount / validPrice;
    let status = "达标";
    if (contributionRate < 0) status = "亏损";
    else if (contributionRate < targetRate) status = "低于目标";

    return {
      name,
      price: validPrice,
      contributionRate,
      contributionAmount,
      logisticsCost: logistics,
      status
    };
  }

  function buildPriceAdvice({
    basePrice,
    officialPrice,
    lowPrice,
    purchasePrice,
    suggestedPurchasePrice,
    feeRate,
    targetRate,
    logisticsCost,
    bomLow,
    bomHigh
  }) {
    const healthySellingPrice = purchasePrice
      ? clampMoney((purchasePrice + logisticsCost) / Math.max(0.01, 1 - feeRate - targetRate))
      : null;
    const anchorPrice = officialPrice || basePrice || healthySellingPrice;
    const dealRangeLow = anchorPrice ? clampMoney(Math.min(anchorPrice * 0.92, lowPrice || anchorPrice * 0.92)) : null;
    const dealRangeHigh = anchorPrice ? clampMoney(anchorPrice * 1.06) : null;
    const purchaseUpper = clampMoney(suggestedPurchasePrice);
    const bomFloor = numberOrNull(bomLow);
    const bomCeiling = numberOrNull(bomHigh);
    const purchaseLower =
      purchaseUpper === null
        ? null
        : bomFloor && bomFloor <= purchaseUpper
          ? roundMoney(bomFloor)
          : clampMoney(purchaseUpper * 0.9);
    const hasViablePurchaseRange = Boolean(purchaseLower !== null && purchaseUpper !== null && purchaseLower <= purchaseUpper);
    const bomConflict = Boolean(bomFloor && purchaseUpper !== null && bomFloor > purchaseUpper);
    const message = bomConflict
      ? `含运费后采购价上限 ${formatMoney(purchaseUpper)} 已低于 BOM 下沿 ${formatMoney(bomFloor)}，当前售价结构下不建议直接过审。`
      : hasViablePurchaseRange
        ? `建议采购价控制在 ${formatMoney(purchaseLower)}-${formatMoney(purchaseUpper)}，并保留运费和促销资源口径。`
        : "缺少售价或采购价，暂不能形成健康采购价区间。";

    return {
      healthySellingPrice,
      dealRangeLow,
      dealRangeHigh,
      purchaseLower,
      purchaseUpper,
      hasViablePurchaseRange,
      bomConflict,
      bomLow: bomFloor,
      bomHigh: bomCeiling,
      message
    };
  }

  function evidenceScore(input) {
    let score = 0;
    if (input.productName && input.purchasePrice) score += 15;
    if (input.officialPrice) score += 22;
    if (input.lowPrice) score += 15;
    if (input.bomLow && input.bomHigh) score += 16;
    if (numberOrNull(input.evidenceImageCount) > 0) score += 14;
    if (input.freight?.totalCost > 0) score += 18;
    return Math.min(100, score);
  }

  function buildEvidenceChain(input, result) {
    const priceRisk =
      input.purchasePrice && input.officialPrice && input.purchasePrice >= input.officialPrice ? "danger" : input.officialPrice ? "good" : "warn";
    const promoRisk = result.scenarios.some((item) => item.status === "亏损")
      ? "danger"
      : result.scenarios.some((item) => item.status === "低于目标")
        ? "warn"
        : "good";
    const bomRisk = result.priceAdvice.bomConflict ? "danger" : input.bomLow && input.bomHigh ? "good" : "warn";
    const logisticsRisk = result.freight.totalCost > 0 ? "good" : "warn";

    return [
      {
        label: "读单",
        tone: input.productName && input.purchasePrice ? "good" : "warn",
        verdict: input.productName && input.purchasePrice ? "基础字段已识别" : "审批单字段不完整",
        suggestion: input.productName && input.purchasePrice ? "可直接进入取证和测算。" : "先补商品名、规格、采购价后再判断。"
      },
      {
        label: "全站价盘",
        tone: priceRisk,
        verdict: input.officialPrice ? `官旗到手价 ${formatMoney(input.officialPrice)}` : "缺少外部成交价",
        suggestion:
          priceRisk === "danger"
            ? "采购价高于终端成交价，需降采或驳回。"
            : input.officialPrice
              ? "外部价格已入账，可作为谈判证据。"
              : "触发网页官旗和手机 RPA 补齐抖音/淘宝证据。"
      },
      {
        label: "运费体系",
        tone: logisticsRisk,
        verdict:
          result.freight.totalCost > 0
            ? `计费重 ${result.freight.billedWeight || "-"}kg / 运费 ${formatMoney(result.freight.totalCost)}`
            : "未计入运费模板",
        suggestion:
          result.freight.totalCost > 0
            ? "已按实重/体积重取大并套首重续重模板，口径比固定单件运费更稳。"
            : "先补实重、长宽高和运费模板，或接入仓配运费接口后再给最终意见。"
      },
      {
        label: "BOM 成本",
        tone: bomRisk,
        verdict: input.bomLow && input.bomHigh ? `${formatMoney(input.bomLow)}-${formatMoney(input.bomHigh)}` : "缺少 BOM 区间",
        suggestion:
          bomRisk === "danger"
            ? "建议采购价已低于 BOM 下沿，需品牌解释成本或调整售价结构。"
            : input.bomLow && input.bomHigh
              ? "BOM 可作为降采谈判参考，不作为唯一审批依据。"
              : "补配方图/包材信息后再估算成本区间。"
      },
      {
        label: "利润计算器",
        tone: promoRisk,
        verdict: `最低场景 ${result.scenarios[2].status}`,
        suggestion:
          promoRisk === "danger"
            ? "最低凑单亏损，需限制促销资源或重谈采购价。"
            : promoRisk === "warn"
              ? "促销价低于目标贡利，建议补资源口径。"
              : "日销、大促、最低凑单均达标，可表扬并进入人工复核。"
      }
    ];
  }

  function buildActionItems(input, result) {
    const actions = [];
    if (result.suggestedPurchasePrice !== null && input.purchasePrice && input.purchasePrice > result.suggestedPurchasePrice) {
      actions.push(`要求品牌把采购价降至 ${formatMoney(result.suggestedPurchasePrice)} 以内，或补充等额促销/运费资源。`);
    }
    if (result.priceAdvice.healthySellingPrice && result.priceAdvice.dealRangeHigh && result.priceAdvice.healthySellingPrice > result.priceAdvice.dealRangeHigh) {
      actions.push(`若坚持采购价 ${formatMoney(input.purchasePrice)}，健康到手价需达到 ${formatMoney(result.priceAdvice.healthySellingPrice)}，明显高于官旗可接受区间。`);
    }
    if (result.scenarios.some((item) => item.status === "亏损")) {
      actions.push("最低凑单场景亏损，Boss 复核前需明确是否限制大促、礼金、PLUS 券和自投广告。");
    }
    if (!input.officialPrice || !input.lowPrice) {
      actions.push("补齐官旗价和全网低价截图，避免只用站内数据自证。");
    }
    if (!actions.length) actions.push("当前测算口径达标，建议保留证据包后进入人工复核。");
    return actions;
  }

  function buildStrengths(input, result) {
    const strengths = [];
    if (result.evidenceCompleteness >= 80) strengths.push("证据链完整度高，已覆盖外部价盘、BOM、运费和利润测算。");
    if (result.freight.totalCost > 0) strengths.push("已按实重/体积重计算计费重并扣减运费，避免固定单件运费导致误判。");
    if (input.officialPrice && input.lowPrice) strengths.push("全站价盘已纳入官旗价和低价证据，可支撑采销谈判。");
    if (!strengths.length) strengths.push("基础读单已完成，下一步补齐证据后可形成可复制意见。");
    return strengths;
  }

  function buildReviewText(result) {
    const lines = [
      `审核建议：${result.recommendation}`,
      "",
      `商品：${result.input.productName || "未识别商品名"}`,
      `品牌提报采购价：${formatMoney(result.input.purchasePrice)}`,
      `建议采购价：${formatMoney(result.suggestedPurchasePrice)}`,
      `采用费用率：${formatPercent(result.feeRate * 100)}，计费重运费：${formatMoney(result.logisticsCost)}，目标贡利率：${formatPercent(result.targetRate * 100)}`,
      `运费计费：计费重：${result.freight.billedWeight || "-"}kg，实重：${result.freight.actualWeight || "-"}kg，体积重：${result.freight.volumeWeight || "-"}kg，泡重系数：${result.freight.divisor || "-"}`,
      `建议采购区间：${formatMoney(result.priceAdvice.purchaseLower)}-${formatMoney(result.priceAdvice.purchaseUpper)}`,
      "",
      "主要原因："
    ];

    result.reasons.forEach((reason, index) => {
      lines.push(`${index + 1}. ${reason}`);
    });

    lines.push("");
    lines.push("场景测算：");
    result.scenarios.forEach((item) => {
      lines.push(
        `${item.name}：件单价 ${formatMoney(item.price)}，贡利率 ${formatPercent(
          item.contributionRate === null ? null : item.contributionRate * 100
        )}，贡利额 ${formatMoney(item.contributionAmount)}，计费重运费 ${formatMoney(item.logisticsCost)}，状态 ${item.status}`
      );
    });

    lines.push("");
    lines.push("分环节建议：");
    result.actionItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });

    return lines.join("\n");
  }

  function analyze(input) {
    const purchasePrice = numberOrNull(input.purchasePrice);
    const jdPrice = numberOrNull(input.jdPrice);
    const officialPrice = numberOrNull(input.officialPrice);
    const lowPrice = numberOrNull(input.lowPrice);
    const bomLow = numberOrNull(input.bomLow);
    const bomHigh = numberOrNull(input.bomHigh);
    const controllableRate = numberOrNull(input.controllableRate) ?? 12;
    const uncontrollableRate = numberOrNull(input.uncontrollableRate) ?? 2.5;
    const adRate = numberOrNull(input.adRate) ?? 0;
    const targetProfitRate = numberOrNull(input.targetProfitRate) ?? 12;
    const feeRate = (controllableRate + uncontrollableRate + adRate) / 100;
    const targetRate = targetProfitRate / 100;
    const freight = calculateFreight(input);
    const logisticsCost = freight.totalCost;

    const dailyPrice = numberOrNull(input.dailyPrice) || officialPrice || jdPrice;
    const promoPrice = numberOrNull(input.promoPrice) || (officialPrice ? officialPrice * 0.9 : null) || jdPrice;
    const lowestDealPrice = numberOrNull(input.lowestDealPrice) || lowPrice || (officialPrice ? officialPrice * 0.8 : null) || jdPrice;
    const basePrice = dailyPrice || officialPrice || jdPrice;
    const suggestedPurchasePrice = basePrice ? Math.max(0, basePrice * (1 - feeRate - targetRate) - logisticsCost) : null;

    const scenarios = [
      scenario("日销场景", dailyPrice, purchasePrice, feeRate, targetRate, logisticsCost),
      scenario("大促场景", promoPrice, purchasePrice, feeRate, targetRate, logisticsCost),
      scenario("最低凑单场景", lowestDealPrice, purchasePrice, feeRate, targetRate, logisticsCost)
    ];
    const normalizedInput = {
      ...input,
      purchasePrice,
      jdPrice,
      officialPrice,
      lowPrice,
      bomLow,
      bomHigh,
      packageWeightKg: freight.singleWeight,
      packageCount: freight.packageCount,
      packageLengthCm: freight.length,
      packageWidthCm: freight.width,
      packageHeightCm: freight.height,
      volumeDivisor: freight.divisor,
      firstWeightKg: freight.firstWeight,
      firstFreightFee: freight.firstFee,
      continuedWeightKg: freight.continuedWeight,
      continuedFreightFee: freight.continuedFee,
      packagingCost: freight.packagingCost,
      freightSurcharge: freight.freightSurcharge,
      shippingSubsidy: freight.shippingSubsidy,
      freightCost: freight.manualFreightCost,
      freight
    };
    const priceAdvice = buildPriceAdvice({
      basePrice,
      officialPrice,
      lowPrice,
      purchasePrice,
      suggestedPurchasePrice,
      feeRate,
      targetRate,
      logisticsCost,
      bomLow,
      bomHigh
    });

    const reasons = [];
    let riskScore = 0;

    if (!purchasePrice) {
      reasons.push("缺少采购价，无法判断新品是否具备利润空间。");
      riskScore += 35;
    }

    if (purchasePrice && officialPrice && purchasePrice >= officialPrice) {
      reasons.push(`采购价 ${formatMoney(purchasePrice)} 高于或等于官旗到手价 ${formatMoney(officialPrice)}，新品上线即存在负毛利风险。`);
      riskScore += 45;
    }

    const lowestScenario = scenarios[2];
    if (lowestScenario.contributionRate !== null && lowestScenario.contributionRate < 0) {
      reasons.push(`最低凑单场景贡利率为 ${formatPercent(lowestScenario.contributionRate * 100)}，存在促销亏损风险。`);
      riskScore += 35;
    } else if (lowestScenario.contributionRate !== null && lowestScenario.contributionRate < targetRate) {
      reasons.push(`最低凑单场景贡利率为 ${formatPercent(lowestScenario.contributionRate * 100)}，低于目标贡利率 ${formatPercent(targetRate * 100)}。`);
      riskScore += 25;
    }

    if (purchasePrice && suggestedPurchasePrice && purchasePrice > suggestedPurchasePrice) {
      reasons.push(`按费用率、目标贡利率和计费重运费反推，建议采购价不高于 ${formatMoney(suggestedPurchasePrice)}，当前采购价偏高。`);
      riskScore += 30;
    }

    if (logisticsCost > 0) {
      reasons.push(`已按实重 ${freight.actualWeight || "-"}kg、体积重 ${freight.volumeWeight || "-"}kg 取大，计费重 ${freight.billedWeight || "-"}kg，运费 ${formatMoney(logisticsCost)} 已计入利润。`);
    } else {
      reasons.push("尚未形成运费模板结果，需补实重、长宽高、首重续重或接入仓配运费接口后再做最终审批。");
      riskScore += 8;
    }

    if (purchasePrice && bomHigh && purchasePrice > bomHigh * 1.25) {
      reasons.push(`BOM 参考成本上沿为 ${formatMoney(bomHigh)}，当前采购价超过参考上沿 25%，有降采谈判空间。`);
      riskScore += 15;
    } else if (bomLow && bomHigh) {
      reasons.push(`BOM 参考成本区间为 ${formatMoney(bomLow)}-${formatMoney(bomHigh)}，可作为品牌谈判参考。`);
    }

    if (priceAdvice.bomConflict) {
      reasons.push(priceAdvice.message);
      riskScore += 15;
    }

    if (!officialPrice && !lowPrice) {
      reasons.push("尚未录入竞对官旗价或全网低价，建议补充价格证据后再做最终判断。");
      riskScore += 10;
    }

    if (!reasons.length) {
      reasons.push("当前采购价、费用率和促销场景测算未发现明显异常，可进入人工复核。");
    }

    let riskLevel = "低";
    let recommendation = "建议通过，保留人工复核。";
    if (riskScore >= 70) {
      riskLevel = "高";
      recommendation = "建议驳回或要求品牌降采后重新提报。";
    } else if (riskScore >= 35) {
      riskLevel = "中";
      recommendation = "建议要求降采或补充价格证据后再审批。";
    }

    const result = {
      input: {
        ...input,
        purchasePrice,
        jdPrice,
        officialPrice,
        lowPrice,
        bomLow,
        bomHigh
      },
      feeRate,
      targetRate,
      suggestedPurchasePrice,
      scenarios,
      reasons,
      riskLevel,
      riskScore,
      recommendation
    };
    result.input = normalizedInput;
    result.logisticsCost = logisticsCost;
    result.freight = freight;
    result.priceAdvice = priceAdvice;
    result.evidenceCompleteness = evidenceScore(normalizedInput);
    result.evidenceChain = buildEvidenceChain(normalizedInput, result);
    result.actionItems = buildActionItems(normalizedInput, result);
    result.strengths = buildStrengths(normalizedInput, result);
    result.reviewText = buildReviewText(result);
    return result;
  }

  return {
    analyze,
    calculateFreight,
    compactText,
    completeness,
    extractFromText,
    extractPageData,
    formatMoney,
    formatPercent,
    numberOrNull
  };
});
