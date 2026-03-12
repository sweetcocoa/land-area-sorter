(() => {
  const ROOT_ID = "naver-land-exclusive-sorter";
  const BUTTON_CLASS = "naver-land-exclusive-sorter__button";
  const HINT_CLASS = "naver-land-exclusive-sorter__hint";
  const FLOATING_CLASS = "naver-land-exclusive-sorter--floating";
  const INLINE_CLASS = "naver-land-exclusive-sorter--inline";
  const ACTIVE_CLASS = "naver-land-exclusive-sorter--active";
  const SORT_MODES = ["original", "exclusiveAsc", "exclusiveDesc"];
  const AREA_KEYWORDS = ["전용", "공급", "매매", "전세", "월세"];
  const INFO_BLOCK_SELECTORS = [".info_area", "[class*='info_area']", "[class*='InfoArea']"];
  const CARD_SELECTORS = [
    ".item_inner",
    "[class*='item_inner']",
    "[class*='ItemInner']",
    "article",
    "li"
  ];
  const SORT_HOST_TEXTS = ["면적순", "가격순", "최신순", "확인매물순", "정렬"];
  const LOCATION_CHECK_INTERVAL_MS = 1000;
  const REFRESH_DEBOUNCE_MS = 120;

  const state = {
    initialized: false,
    sortMode: "original",
    cardsMeta: [],
    listContainer: null,
    pageObserver: null,
    refreshTimer: null,
    suppressObserver: false,
    currentHref: location.href
  };

  function init() {
    if (state.initialized) {
      return;
    }

    state.initialized = true;
    scheduleRefresh();
    observePage();
    monitorLocationChanges();
  }

  function observePage() {
    if (state.pageObserver) {
      return;
    }

    state.pageObserver = new MutationObserver(() => {
      if (state.suppressObserver) {
        return;
      }

      scheduleRefresh();
    });

    state.pageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function monitorLocationChanges() {
    window.setInterval(() => {
      if (state.currentHref === location.href) {
        return;
      }

      state.currentHref = location.href;
      scheduleRefresh();
    }, LOCATION_CHECK_INTERVAL_MS);
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  function refresh() {
    const candidates = findArticleCards();
    const listContext = findListContext(candidates);

    if (!listContext || listContext.items.length < 2) {
      state.cardsMeta = [];
      state.listContainer = null;
      mountControl(null);
      return;
    }

    state.listContainer = listContext.container;
    state.cardsMeta = buildCardMeta(listContext.items);
    mountControl(listContext.container);

    if (state.sortMode === "original") {
      restoreOriginalOrder();
      return;
    }

    applySortedOrder();
  }

  function findArticleCards() {
    const infoBlocks = uniqueElements(
      INFO_BLOCK_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    );
    const infoDerivedCards = infoBlocks
      .map((block) => block.closest(CARD_SELECTORS.join(",")))
      .filter(Boolean)
      .filter(isLikelyArticleCard);

    if (infoDerivedCards.length >= 2) {
      return uniqueElements(infoDerivedCards);
    }

    const fallbackCards = uniqueElements(
      CARD_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    ).filter(isLikelyArticleCard);

    return fallbackCards;
  }

  function isLikelyArticleCard(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const text = normalizeWhitespace(element.innerText || element.textContent || "");
    if (!text || text.length < 12 || text.length > 600) {
      return false;
    }

    const hasAreaKeyword = AREA_KEYWORDS.some((keyword) => text.includes(keyword));
    if (!hasAreaKeyword) {
      return false;
    }

    const hasLink = Boolean(element.querySelector("a"));
    const rect = element.getBoundingClientRect();

    return hasLink && rect.height > 0 && rect.width > 0;
  }

  function findListContext(candidates) {
    const containerScores = new Map();

    candidates.forEach((candidate) => {
      let current = candidate.parentElement;
      let depth = 0;

      while (current && depth < 6) {
        const children = uniqueElements(
          candidates
            .map((item) => getDirectChildUnderAncestor(item, current))
            .filter(Boolean)
        );

        if (children.length >= 2) {
          const previous = containerScores.get(current);
          const score = {
            container: current,
            itemCount: children.length,
            depth,
            items: children
          };

          if (!previous || shouldReplaceContainer(previous, score)) {
            containerScores.set(current, score);
          }
        }

        current = current.parentElement;
        depth += 1;
      }
    });

    let best = null;
    containerScores.forEach((score) => {
      if (!best || shouldReplaceContainer(best, score)) {
        best = score;
      }
    });

    return best;
  }

  function shouldReplaceContainer(previous, next) {
    if (next.itemCount !== previous.itemCount) {
      return next.itemCount > previous.itemCount;
    }

    return next.depth < previous.depth;
  }

  function getDirectChildUnderAncestor(element, ancestor) {
    let current = element;

    while (current && current.parentElement && current.parentElement !== ancestor) {
      current = current.parentElement;
    }

    if (current && current.parentElement === ancestor) {
      return current;
    }

    return null;
  }

  function buildCardMeta(cards) {
    return cards.map((card, index) => {
      const parsed = parseExclusiveArea(card);

      return {
        id: getCardId(card, index),
        originalIndex: index,
        exclusiveAreaValue: parsed.value,
        parsedText: parsed.rawText,
        element: card,
        isSortable: Number.isFinite(parsed.value)
      };
    });
  }

  function getCardId(card, index) {
    return (
      card.getAttribute("data-id") ||
      card.getAttribute("data-article-no") ||
      card.id ||
      `${index}:${normalizeWhitespace(card.textContent || "").slice(0, 40)}`
    );
  }

  function parseExclusiveArea(card) {
    const texts = getCardTexts(card);

    for (const text of texts) {
      const labeledValue = parseLabeledExclusiveArea(text);
      if (Number.isFinite(labeledValue)) {
        return { value: labeledValue, rawText: text };
      }

      const pairValue = parseSupplyExclusivePair(text);
      if (Number.isFinite(pairValue)) {
        return { value: pairValue, rawText: text };
      }
    }

    return {
      value: null,
      rawText: texts[0] || ""
    };
  }

  function getCardTexts(card) {
    const fragments = [];

    INFO_BLOCK_SELECTORS.forEach((selector) => {
      card.querySelectorAll(selector).forEach((element) => {
        const text = normalizeWhitespace(element.textContent || "");
        if (text) {
          fragments.push(text);
        }
      });
    });

    const ownText = normalizeWhitespace(card.textContent || "");
    if (ownText) {
      fragments.push(ownText);
    }

    return uniqueStrings(fragments);
  }

  function parseLabeledExclusiveArea(text) {
    const patterns = [
      /전용(?:면적)?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /전용(?:면적)?\s*[:/]\s*([0-9]+(?:[.,][0-9]+)?)/i
    ];

    for (const pattern of patterns) {
      const matched = text.match(pattern);
      if (matched) {
        return toAreaNumber(matched[1]);
      }
    }

    return null;
  }

  function parseSupplyExclusivePair(text) {
    const supplyExclusivePattern =
      /공급\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:㎡|m2|m²)?\s*\/\s*전용\s*([0-9]+(?:[.,][0-9]+)?)/i;
    const missingSupplyPattern =
      /(?:아파트|오피스텔|빌라|주택|원룸|투룸|상가|사무실|단독|다가구|도시형생활주택|생활숙박시설)?\s*-\s*\/\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:㎡|m2|m²)/i;
    const unlabeledPairPattern =
      /(?:아파트|오피스텔|빌라|주택|원룸|투룸|상가|사무실|도시형생활주택|생활숙박시설)?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:㎡|m2|m²)?\s*\/\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:㎡|m2|m²)/i;

    const labeled = text.match(supplyExclusivePattern);
    if (labeled) {
      return toAreaNumber(labeled[2]);
    }

    const missingSupply = text.match(missingSupplyPattern);
    if (missingSupply) {
      return toAreaNumber(missingSupply[1]);
    }

    const unlabeled = text.match(unlabeledPairPattern);
    if (unlabeled) {
      return toAreaNumber(unlabeled[2]);
    }

    return null;
  }

  function toAreaNumber(value) {
    const normalized = String(value).replace(/,/g, "");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function mountControl(listContainer) {
    const existingRoot = document.getElementById(ROOT_ID);
    if (!listContainer) {
      if (existingRoot) {
        existingRoot.remove();
      }
      return;
    }

    const host = findSortHost() || document.body;
    const isInline = host !== document.body && host.classList.contains("sorting");
    const isFloating = host === document.body;
    const root = existingRoot || createControl();

    if (root.parentElement !== host) {
      if (isInline) {
        const addressFilter = host.querySelector(".address_filter");
        host.insertBefore(root, addressFilter || null);
      } else {
        host.appendChild(root);
      }
    }

    root.classList.toggle(INLINE_CLASS, isInline);
    root.classList.toggle(FLOATING_CLASS, isFloating);
    root.classList.toggle(ACTIVE_CLASS, state.sortMode !== "original");
    bindNativeSortReset(host);
    syncNativeSortHostState(host);
    updateButtonPresentation(root.querySelector("button"));
  }

  function createControl() {
    const root = document.createElement("div");
    const button = document.createElement("button");
    const hint = document.createElement("span");

    root.id = ROOT_ID;

    button.type = "button";
    button.className = BUTTON_CLASS;
    button.addEventListener("click", () => {
      state.sortMode = nextSortMode(state.sortMode);
      const rootElement = document.getElementById(ROOT_ID);
      if (rootElement) {
        rootElement.classList.toggle(ACTIVE_CLASS, state.sortMode !== "original");
      }
      const host = findSortHost();
      syncNativeSortHostState(host);
      updateButtonPresentation(button);

      applySortedOrder();
    });

    hint.className = HINT_CLASS;
    hint.textContent = "클릭할 때마다 오름차순/내림차순";

    root.appendChild(button);
    root.appendChild(hint);

    return root;
  }

  function findSortHost() {
    const sorting = document.querySelector(".sorting");
    if (sorting instanceof HTMLElement) {
      return sorting;
    }

    const candidates = uniqueElements(
      ["button", "a", "span", "div", "li"].flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    );

    for (const candidate of candidates) {
      const text = normalizeWhitespace(candidate.textContent || "");
      if (!text || text.length > 30) {
        continue;
      }

      if (!SORT_HOST_TEXTS.some((keyword) => text.includes(keyword))) {
        continue;
      }

      const host = candidate.closest("ul, nav, section, aside, div");
      if (host instanceof HTMLElement) {
        return host;
      }
    }

    return null;
  }

  function bindNativeSortReset(host) {
    if (!(host instanceof HTMLElement) || !host.classList.contains("sorting")) {
      return;
    }

    host.querySelectorAll(".sorting_type").forEach((element) => {
      if (!(element instanceof HTMLElement) || element.dataset.naverLandExclusiveBound === "true") {
        return;
      }

      element.dataset.naverLandExclusiveBound = "true";
      element.addEventListener("click", () => {
        if (state.sortMode !== "original") {
          state.sortMode = "original";
          restoreOriginalOrder();

          const root = document.getElementById(ROOT_ID);
          if (root) {
            root.classList.remove(ACTIVE_CLASS);
            updateButtonPresentation(root.querySelector("button"));
          }
        }

        window.setTimeout(() => {
          syncNativeSortHostState(host);
        }, 0);
      });
    });
  }

  function syncNativeSortHostState(host) {
    if (!(host instanceof HTMLElement) || !host.classList.contains("sorting")) {
      return;
    }

    host.classList.toggle("naver-land-exclusive-sorting-active", state.sortMode !== "original");
  }

  function updateButtonPresentation(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const labels = {
      original: "전용",
      exclusiveAsc: "전용↑",
      exclusiveDesc: "전용↓"
    };

    button.dataset.sortMode = state.sortMode;
    button.textContent = labels[state.sortMode];
    button.setAttribute("aria-pressed", state.sortMode === "original" ? "false" : "true");
    button.setAttribute("title", "클릭할 때마다 오름차순/내림차순");
  }

  function nextSortMode(currentMode) {
    return currentMode === "exclusiveAsc" ? "exclusiveDesc" : "exclusiveAsc";
  }

  function restoreOriginalOrder() {
    reorderElements(
      [...state.cardsMeta]
        .sort((left, right) => left.originalIndex - right.originalIndex)
        .map((meta) => meta.element)
    );
  }

  function applySortedOrder() {
    const sortable = state.cardsMeta.filter((meta) => meta.isSortable);
    const originalOrder = [...state.cardsMeta].sort((left, right) => left.originalIndex - right.originalIndex);

    sortable.sort((left, right) => {
      const areaDelta =
        state.sortMode === "exclusiveAsc"
          ? left.exclusiveAreaValue - right.exclusiveAreaValue
          : right.exclusiveAreaValue - left.exclusiveAreaValue;

      if (areaDelta !== 0) {
        return areaDelta;
      }

      return left.originalIndex - right.originalIndex;
    });

    let sortableIndex = 0;
    const arranged = originalOrder.map((meta) => {
      if (!meta.isSortable) {
        return meta.element;
      }

      const next = sortable[sortableIndex];
      sortableIndex += 1;
      return next.element;
    });

    reorderElements(arranged);
  }

  function reorderElements(elements) {
    if (!state.listContainer) {
      return;
    }

    state.suppressObserver = true;

    elements.forEach((element) => {
      state.listContainer.appendChild(element);
    });

    window.requestAnimationFrame(() => {
      state.suppressObserver = false;
    });
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function uniqueStrings(values) {
    return Array.from(new Set(values));
  }

  init();
})();
