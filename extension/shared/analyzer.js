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
    expectedGrossMargin: ["预计毛利率", "预估毛利率", "毛利率"]
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
      expectedGrossMargin: percentNearLabel(normalized, FIELD_LABELS.expectedGrossMargin)
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

  function scenario(name, price, purchasePrice, feeRate, targetRate) {
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

    const contributionRate = 1 - purchase / validPrice - feeRate;
    const contributionAmount = validPrice - purchase - validPrice * feeRate;
    let status = "达标";
    if (contributionRate < 0) status = "亏损";
    else if (contributionRate < targetRate) status = "低于目标";

    return {
      name,
      price: validPrice,
      contributionRate,
      contributionAmount,
      status
    };
  }

  function buildReviewText(result) {
    const lines = [
      `审核建议：${result.recommendation}`,
      "",
      `商品：${result.input.productName || "未识别商品名"}`,
      `品牌提报采购价：${formatMoney(result.input.purchasePrice)}`,
      `建议采购价：${formatMoney(result.suggestedPurchasePrice)}`,
      `采用费用率：${formatPercent(result.feeRate * 100)}，目标贡利率：${formatPercent(result.targetRate * 100)}`,
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
        )}，贡利额 ${formatMoney(item.contributionAmount)}，状态 ${item.status}`
      );
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

    const dailyPrice = numberOrNull(input.dailyPrice) || officialPrice || jdPrice;
    const promoPrice = numberOrNull(input.promoPrice) || (officialPrice ? officialPrice * 0.9 : null) || jdPrice;
    const lowestDealPrice = numberOrNull(input.lowestDealPrice) || lowPrice || (officialPrice ? officialPrice * 0.8 : null) || jdPrice;
    const basePrice = dailyPrice || officialPrice || jdPrice;
    const suggestedPurchasePrice = basePrice ? basePrice * (1 - feeRate - targetRate) : null;

    const scenarios = [
      scenario("日销场景", dailyPrice, purchasePrice, feeRate, targetRate),
      scenario("大促场景", promoPrice, purchasePrice, feeRate, targetRate),
      scenario("最低凑单场景", lowestDealPrice, purchasePrice, feeRate, targetRate)
    ];

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
      reasons.push(`按当前费用率和目标贡利率反推，建议采购价不高于 ${formatMoney(suggestedPurchasePrice)}，当前采购价偏高。`);
      riskScore += 30;
    }

    if (purchasePrice && bomHigh && purchasePrice > bomHigh * 1.25) {
      reasons.push(`BOM 参考成本上沿为 ${formatMoney(bomHigh)}，当前采购价超过参考上沿 25%，有降采谈判空间。`);
      riskScore += 15;
    } else if (bomLow && bomHigh) {
      reasons.push(`BOM 参考成本区间为 ${formatMoney(bomLow)}-${formatMoney(bomHigh)}，可作为品牌谈判参考。`);
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
    result.reviewText = buildReviewText(result);
    return result;
  }

  return {
    analyze,
    compactText,
    completeness,
    extractFromText,
    extractPageData,
    formatMoney,
    formatPercent,
    numberOrNull
  };
});
