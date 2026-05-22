import * as THREE from "./vendor/three.module.js";

const state = {
  network: null,
  selectedChar: "",
  detail: null,
  multiInputs: [],
  multiDetails: [],
  multiNetworks: [],
  related: [],
  requestId: 0,
  bundleScene: null,
  lockedReadings: {},
  activeNetworkIndex: 0,
  visibleGraphLangs: new Set(["ko", "ja", "zh", "yue", "vi"]),
  networkCharFilters: new Map(),
  collapsedPanels: new Set(),
  pinnedCharacters: new Set(),
  charPreviewCache: new Map(),
  charPreviewTimer: 0,
};

const $ = (selector) => document.querySelector(selector);

const langLabels = {
  ko: "한국어",
  ja: "일본어",
  zh: "중국어(북경어)",
  yue: "중국어(광둥어)",
  vi: "베트남어",
};

const systemLabels = {
  hangul: "한글",
  romanized: "로마자",
  on_kana: "음독",
  on_romaji: "음독",
  pinyin: "현대 보통화",
  hanyu_pinyin: "한어병음",
  pinyin_numbered: "숫자성조",
  jyutping: "월병",
  quoc_ngu: "한월음",
  tang: "당대음",
  old_chinese: "상고한어",
  middle_chinese: "중고한어",
};

const displayLangs = ["ko", "ja", "zh", "yue", "vi"];
const defaultPublicAPIBase = "https://umyinon-api.ancom.duckdns.org";
const backendHostnames = new Set(["umyinon.ancom.duckdns.org", "umyinon-api.ancom.duckdns.org"]);
const apiBase = resolveAPIBase();

const preferredSystems = {
  ko: ["hangul", "romanized"],
  ja: ["on_kana", "on_romaji"],
  zh: ["pinyin", "hanyu_pinyin", "pinyin_numbered", "tang"],
  yue: ["jyutping"],
  vi: ["quoc_ngu"],
};

document.addEventListener("DOMContentLoaded", () => {
  initCollapsiblePanels();

  $("#searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    runStudy($("#sourceLang").value, $("#searchInput").value.trim());
  });

  document.querySelectorAll("[data-query]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#sourceLang").value = button.dataset.lang;
      $("#searchInput").value = button.dataset.query;
      runStudy(button.dataset.lang, button.dataset.query);
    });
  });

  document.body.addEventListener("click", (event) => {
    const panelToggle = event.target.closest("[data-panel-toggle]");
    if (panelToggle) {
      togglePanel(panelToggle);
      return;
    }
    const studyButton = event.target.closest("[data-study-index]");
    if (studyButton) {
      setActiveStudyNetwork(Number(studyButton.dataset.studyIndex));
      return;
    }
    const clearFilterButton = event.target.closest("[data-clear-char-filter]");
    if (clearFilterButton) {
      setNetworkCharFilter(Number(clearFilterButton.dataset.networkIndex ?? -1), "");
      return;
    }
    const pinButton = event.target.closest("[data-pin-char]");
    if (pinButton) {
      const block = pinButton.closest("[data-pronunciation-network-index]");
      if (block) {
        toggleNetworkCharFilter(Number(block.dataset.pronunciationNetworkIndex ?? -1), pinButton.dataset.pinChar);
      }
      togglePinnedCharacter(pinButton.dataset.pinChar);
      return;
    }
    const charButton = event.target.closest("[data-char]");
    if (charButton) {
      loadCharacter(charButton.dataset.char);
      return;
    }
    const readingButton = event.target.closest("[data-reading-lang][data-reading-key]");
    if (readingButton) {
      toggleLockedReading(readingButton.dataset.readingLang, readingButton.dataset.readingKey);
      return;
    }
  });
  document.body.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-graph-lang]");
    if (!toggle || toggle.disabled) {
      return;
    }
    const lang = toggle.dataset.graphLang;
    if (toggle.checked) {
      state.visibleGraphLangs.add(lang);
    } else {
      state.visibleGraphLangs.delete(lang);
    }
    renderNetworkStudy();
  });
  document.body.addEventListener("pointerover", handleReadingPointer);
  document.body.addEventListener("pointerout", handleReadingPointerOut);
  document.body.addEventListener("focusin", handleReadingPointer);
  document.body.addEventListener("focusout", handleReadingPointerOut);
  document.body.addEventListener("pointerover", handleCharPreviewPointer);
  document.body.addEventListener("pointerout", handleCharPreviewPointerOut);
  document.body.addEventListener("focusin", handleCharPreviewPointer);
  document.body.addEventListener("focusout", handleCharPreviewPointerOut);

  runStudy($("#sourceLang").value, $("#searchInput").value.trim());
});

function initCollapsiblePanels() {
  document.querySelectorAll("[data-panel-id]").forEach((panel) => {
    const id = panel.dataset.panelId;
    const toggle = panel.querySelector("[data-panel-toggle]");
    const collapsed = state.collapsedPanels.has(id);
    panel.classList.toggle("is-collapsed", collapsed);
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(!collapsed));
    }
  });
}

function togglePanel(button) {
  const panel = button.closest("[data-panel-id]");
  if (!panel) {
    return;
  }
  const collapsed = !panel.classList.contains("is-collapsed");
  panel.classList.toggle("is-collapsed", collapsed);
  button.setAttribute("aria-expanded", String(!collapsed));
  if (collapsed) {
    state.collapsedPanels.add(panel.dataset.panelId);
  } else {
    state.collapsedPanels.delete(panel.dataset.panelId);
  }
}

async function runStudy(sourceLang, query) {
  if (!query) {
    return;
  }
  const requestId = ++state.requestId;
  const inputUnits = studyInputUnits(query);
  const multiInputMode = inputUnits.length > 1;
  setNetworkLoading(sourceLang, query);
  state.multiInputs = inputUnits;
  try {
    const firstUnit = inputUnits[0];
    if (firstUnit?.type === "char") {
      const detail = await fetchJSON(`/api/v1/characters/${encodeURIComponent(firstUnit.char)}/`);
      const reading = preferredSourceReading(detail, sourceLang);
      state.detail = detail;
      state.selectedChar = detail.character.char;
      state.multiDetails = multiInputMode ? [detail] : [];
      if (reading) {
        if (!multiInputMode) {
          $("#searchInput").value = reading;
        }
        query = reading;
      }
    } else if (firstUnit?.type === "reading") {
      query = firstUnit.reading;
    }

    const network = await fetchPronunciationNetwork(sourceLang, query);
    if (requestId !== state.requestId) {
      return;
    }
    state.network = network;
    setSourceLockedReadings(network);
    renderNetworkStudy();

    if (multiInputMode) {
      if (firstUnit?.type === "char") {
        state.multiDetails = await Promise.all(inputUnits.map((unit) => cachedCharacterDetail(unit.char)));
        if (requestId !== state.requestId) {
          return;
        }
        state.multiNetworks = await Promise.all(
          state.multiDetails.map((detail, index) => networkForDetail(detail, sourceLang, index === 0 ? network : null)),
        );
      } else {
        state.multiDetails = [];
        state.multiNetworks = await Promise.all(
          inputUnits.map((unit, index) => networkForReadingUnit(unit, sourceLang, index === 0 ? network : null)),
        );
      }
      if (requestId !== state.requestId) {
        return;
      }
      state.activeNetworkIndex = 0;
      state.network = state.multiNetworks[0]?.network || network;
      setSourceLockedReadings(state.network);
      renderNetworkStudy();
    }

    const firstChar = firstNetworkChar(network);
    if (firstChar) {
      await loadCharacter(firstChar, requestId);
    } else if (state.detail) {
      await loadCharacter(state.detail.character.char, requestId);
    } else {
      clearCharacter();
    }
  } catch (error) {
    renderError(error);
  }
}

async function loadCharacter(char, requestId = state.requestId) {
  state.selectedChar = char;
  renderNetworkStudy();
  try {
    const [detail, related] = await Promise.all([
      fetchJSON(`/api/v1/characters/${encodeURIComponent(char)}/`),
      fetchJSON(`/api/v1/characters/${encodeURIComponent(char)}/related?limit=18`),
    ]);
    if (requestId !== state.requestId && char !== state.selectedChar) {
      return;
    }
    state.detail = detail;
    state.related = related.related || [];
    renderCharacter();
  } catch (error) {
    renderError(error);
  }
}

function setNetworkLoading(sourceLang, query) {
  disposeBundleScene();
  hideCharacterPreview();
  state.lockedReadings = {};
  state.activeNetworkIndex = 0;
  state.networkCharFilters = new Map();
  state.multiInputs = [];
  state.multiDetails = [];
  state.multiNetworks = [];
  $("#sourceSummaryBadge").textContent = "loading";
  $("#sourceSummary").innerHTML = `<div class="empty">${escapeHTML(formatLang(sourceLang))} ${escapeHTML(query)} 분석 중</div>`;
  $("#multiCharacterStrip").innerHTML = "";
  $("#pronunciationGraph").innerHTML = "";
  $("#branchCards").innerHTML = `<div class="empty">갈래 계산 중</div>`;
  $("#branchInsights").innerHTML = `<div class="empty">갈래 계산 중</div>`;
  $("#branchInsightCount").textContent = "0";
  $("#evolutionLanes").innerHTML = `<div class="empty">변천 단서 계산 중</div>`;
}

async function fetchPronunciationNetwork(sourceLang, reading) {
  return fetchJSON(
    `/api/v1/pronunciation-network?source_lang=${encodeURIComponent(sourceLang)}&reading=${encodeURIComponent(reading)}&limit=18`,
  );
}

async function networkForDetail(detail, sourceLang, fallbackNetwork = null) {
  const reading = preferredSourceReading(detail, sourceLang);
  const char = detail?.character?.char || "";
  if (!reading) {
    return {
      char,
      detail,
      network: null,
      reading: "",
      warning: `${formatLang(sourceLang)} 대표 발음 없음`,
    };
  }
  if (
    fallbackNetwork &&
    fallbackNetwork.source_lang === sourceLang &&
    (fallbackNetwork.source_reading === reading || fallbackNetwork.source_reading_key === lightReadingKeyForLang(sourceLang, reading))
  ) {
    return { char, detail, network: fallbackNetwork, reading };
  }
  try {
    const network = await fetchPronunciationNetwork(sourceLang, reading);
    return { char, detail, network, reading };
  } catch (error) {
    return { char, detail, network: null, reading, warning: error.message };
  }
}

async function networkForReadingUnit(unit, sourceLang, fallbackNetwork = null) {
  const reading = unit?.reading || "";
  if (!reading) {
    return {
      char: unit?.label || "",
      network: null,
      reading: "",
      warning: "발음 입력 없음",
    };
  }
  if (
    fallbackNetwork &&
    fallbackNetwork.source_lang === sourceLang &&
    (fallbackNetwork.source_reading === reading || fallbackNetwork.source_reading_key === lightReadingKeyForLang(sourceLang, reading))
  ) {
    return { char: unit.label || reading, network: fallbackNetwork, reading };
  }
  try {
    const network = await fetchPronunciationNetwork(sourceLang, reading);
    return { char: unit.label || reading, network, reading };
  } catch (error) {
    return { char: unit.label || reading, network: null, reading, warning: error.message };
  }
}

function setSourceLockedReadings(network) {
  state.lockedReadings = network
    ? {
        [network.source_lang]: network.source_reading_key || network.source_reading,
      }
    : {};
}

function setActiveStudyNetwork(index) {
  const item = state.multiNetworks?.[index];
  if (!item?.network) {
    return;
  }
  state.activeNetworkIndex = index;
  state.network = item.network;
  setSourceLockedReadings(item.network);
  renderNetworkStudy();
  const char = item.detail?.character?.char || (containsHan(item.char || "") ? item.char : "");
  if (char) {
    loadCharacter(char);
  }
}

function renderNetworkStudy() {
  const network = state.network;
  if (!network) {
    return;
  }
  $("#sourceSummaryBadge").textContent = `${network.total_characters || 0}자`;
  $("#branchCount").textContent = String(network.target_groups?.length || 0);
  renderSourceSummary(network);
  renderMultiCharacters();
  renderPronunciationGraph(network);
  renderBranchCards(network);
  renderEvolutionLanes(network);
}

function renderSourceSummary(network) {
  const top = (network.target_groups || []).slice(0, 4);
  const bullets = top
    .map((group) => {
      const pct = network.total_characters
        ? Math.round((group.character_count / network.total_characters) * 100)
        : 0;
      return `<span class="map-chip ${group.target_lang}">${escapeHTML(formatLang(group.target_lang))} ${escapeHTML(group.target_reading_key)} · ${group.character_count}자 · ${pct}%</span>`;
    })
    .join("");
  $("#sourceSummary").innerHTML = `
    <div class="source-summary-bar">
      <div class="source-title">
        <span class="source-reading">${escapeHTML(network.source_reading)}</span>
        <span>${escapeHTML(formatLang(network.source_lang))} 중심 · ${network.total_characters || 0}자</span>
      </div>
      <div class="chip-grid">${bullets}</div>
    </div>
  `;
}

function renderMultiCharacters() {
  const box = $("#multiCharacterStrip");
  if (!box) {
    return;
  }
  const details = state.multiDetails || [];
  const readingInputs = (state.multiInputs || []).filter((unit) => unit.type === "reading");
  if (readingInputs.length > 1) {
    box.innerHTML = `
      <div class="multi-head">
        <strong>입력 발음 ${readingInputs.length}개</strong>
      </div>
      <div class="multi-card-row">
        ${readingInputs.map((unit, index) => multiReadingCard(unit, index)).join("")}
      </div>
    `;
    return;
  }
  if (details.length <= 1) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `
    <div class="multi-head">
      <strong>입력 글자 ${details.length}자</strong>
    </div>
    <div class="multi-card-row">
      ${details.map((detail, index) => multiCharacterCard(detail, index)).join("")}
    </div>
  `;
}

function multiReadingCard(unit, index) {
  const item = (state.multiNetworks || [])[index] || {};
  const total = item.network?.total_characters;
  const summary = total === undefined ? "계산 중" : `${total}자`;
  const active = index === state.activeNetworkIndex ? "active" : "";
  return `
    <button class="multi-char-card reading-token-card ${active}" type="button" data-study-index="${index}" aria-pressed="${active ? "true" : "false"}">
      <span>${escapeHTML(unit.label || unit.reading)}</span>
      <strong>${escapeHTML(formatLang(unit.sourceLang || state.network?.source_lang || "ko"))}</strong>
      <small>${escapeHTML(summary)}</small>
    </button>
  `;
}

function multiCharacterCard(detail, index) {
  const char = detail.character || {};
  const readings = compactReadings(detail.readings || []);
  const variants = compactVariantText(detail);
  const active = index === state.activeNetworkIndex ? "active" : "";
  return `
    <button class="multi-char-card ${active}" type="button" data-study-index="${index}" data-char="${escapeHTML(char.char)}" aria-pressed="${active ? "true" : "false"}">
      <span>${escapeHTML(char.char)}</span>
      <strong>${escapeHTML(readings || "발음 없음")}</strong>
      <small>${escapeHTML(variants || shortDefinition(char.definition))}</small>
    </button>
  `;
}

function renderPronunciationGraph(network) {
  const items = pronunciationNetworkItems(network);
  if (!items.length) {
    $("#pronunciationGraph").innerHTML = `<div class="empty">연결된 발음 갈래 없음</div>`;
    return;
  }
  $("#pronunciationGraph").innerHTML = items.map((item) => pronunciationNetworkBlock(item)).join("");
}

function pronunciationNetworkItems(network) {
  const multi = (state.multiNetworks || []).filter(Boolean);
  if (multi.length > 1) {
    return multi.map((item, index) => ({ ...item, networkIndex: index }));
  }
  return [
    {
      char: state.selectedChar || firstNetworkChar(network),
      detail: state.detail,
      network,
      networkIndex: -1,
      reading: network.source_reading,
    },
  ];
}

function pronunciationNetworkBlock(item) {
  if (!item.network) {
    return `
      <section class="pronunciation-network-block" data-pronunciation-network-index="${item.networkIndex ?? -1}">
        <div class="pronunciation-network-head">
          <h3>${escapeHTML(item.char || "글자")}</h3>
          <span>${escapeHTML(item.warning || "네트워크 없음")}</span>
        </div>
        <div class="empty">연결된 발음 갈래 없음</div>
      </section>
    `;
  }
  const filterChar = selectedNetworkCharFilter(item.networkIndex ?? -1);
  const columns = buildLanguageColumns(item.network, filterChar);
  if (!columns.some((column) => column.nodes.length)) {
    return `
      <section class="pronunciation-network-block" data-pronunciation-network-index="${item.networkIndex ?? -1}">
        <div class="pronunciation-network-head">
          <h3>${escapeHTML(item.char || firstNetworkChar(item.network) || item.network.source_reading)}</h3>
          <span>${escapeHTML(formatLang(item.network.source_lang))} ${escapeHTML(item.reading || item.network.source_reading)}</span>
        </div>
        <div class="empty">연결된 발음 갈래 없음</div>
      </section>
    `;
  }
  const pinned = pinnedCharactersForNetwork(item.network);
  return `
    <section class="pronunciation-network-block" data-pronunciation-network-index="${item.networkIndex ?? -1}">
      <div class="pronunciation-network-head">
        <h3>${escapeHTML(item.char || firstNetworkChar(item.network) || item.network.source_reading)}</h3>
        <span>${escapeHTML(formatLang(item.network.source_lang))} ${escapeHTML(item.reading || item.network.source_reading)} · ${item.network.total_characters || 0}자</span>
      </div>
      ${filterChar ? networkFilterChip(filterChar, item.networkIndex ?? -1) : ""}
      ${pinned.length ? pinnedCharacterTray(pinned) : ""}
      <div class="lane-graph" role="list" aria-label="pronunciation graph">
      ${columns
        .map(
          (column) => `
            <section class="language-lane ${column.lang}" role="listitem">
              <div class="lane-title">
                <strong>${escapeHTML(formatLang(column.lang))}</strong>
                <span>${column.nodes.length}갈래</span>
              </div>
              <div class="lane-nodes">
                ${column.nodes.map((node) => readingNode(node, item.network.total_characters, filterChar)).join("")}
              </div>
            </section>
          `,
        )
        .join("")}
      </div>
    </section>
  `;
}

function networkFilterChip(char, networkIndex) {
  return `
    <div class="network-filter-strip">
      <span class="network-filter-chip">
        <strong>${escapeHTML(char)}</strong>
        <button type="button" data-clear-char-filter data-network-index="${networkIndex}" aria-label="한자 필터 해제">×</button>
      </span>
    </div>
  `;
}

function renderBranchCards(network) {
  const groups = network.target_groups || [];
  const bundles = network.bundles || [];
  if (!groups.length && !bundles.length) {
    $("#branchCards").innerHTML = `<div class="empty">발음 갈래 없음</div>`;
    renderBranchInsights(network, groups);
    disposeBundleScene();
    return;
  }
  const visibleBundles = bundles.slice(0, 12);
  const hasSceneGraph = visibleBundles.length || groups.length;
  const bundleHTML = hasSceneGraph ? bundleGraph(network, visibleBundles) : "";
  $("#branchCards").innerHTML = bundleHTML || `<div class="empty">발음 집합 그래프 없음</div>`;
  renderBranchInsights(network, groups);
  if (hasSceneGraph) {
    requestAnimationFrame(() => mountBundleScene(network, visibleBundles));
  } else {
    disposeBundleScene();
  }
}

function renderBranchInsights(network, groups) {
  const target = $("#branchInsights");
  if (!target) {
    return;
  }
  $("#branchInsightCount").textContent = String(groups.length || 0);
  if (!groups.length) {
    target.innerHTML = `<div class="empty">발음 갈래 없음</div>`;
    return;
  }
  target.innerHTML = groups
    .slice(0, 9)
    .map((group) => {
      const pct = network.total_characters
        ? Math.round((group.character_count / network.total_characters) * 100)
        : 0;
      const clusters = (group.clusters || []).length
        ? group.clusters.map((cluster) => branchCluster(cluster, group.target_lang)).join("")
        : `<div class="char-strip">${(group.characters || [])
            .slice(0, 18)
            .map((entry) => branchCharChip(entry, group.target_lang))
            .join("")}</div>`;
      const systems = (group.systems || [])
        .slice(0, 3)
        .map((system) => `<span class="map-chip">${escapeHTML(system.label)} ${escapeHTML(compactSystemReadings(group.target_lang, system.readings || []))}</span>`)
        .join("");
      return `
        <section class="branch-card ${group.target_lang}">
          <div class="branch-head">
            <div>
              <h3>${escapeHTML(formatLang(group.target_lang))} ${escapeHTML(groupTitle(group))}</h3>
              <p>${escapeHTML(network.source_reading)} 계열 중 ${group.character_count}자는 이 발음 갈래로 모입니다.</p>
            </div>
            <span class="branch-score">${pct}%</span>
          </div>
          <div class="reading-values">${systems}</div>
          <div class="cluster-stack">${clusters}</div>
        </section>
      `;
    })
    .join("");
}

function buildLanguageColumns(network, filterChar = "") {
  const details = characterDetailsFromNetwork(network);
  const chars = filterChar
    ? charObjectsFromValues([filterChar], details, 1)
    : sourceCharactersForNetwork(network, details);
  return visibleGraphLangList(network.source_lang).map((lang) => {
    const nodes =
      lang === network.source_lang
        ? [
            {
              lang,
              key: network.source_reading_key || network.source_reading,
              display: [network.source_reading],
              count: filterChar ? 1 : network.total_characters || 0,
              source: true,
              characters: chars,
            },
          ]
        : (network.target_groups || [])
            .filter((group) => group.target_lang === lang)
            .filter((group) => !filterChar || groupSupportsChar(group, filterChar, details))
            .slice(0, filterChar ? 16 : 8)
            .map((group) => {
              const groupChars = charactersForReadingGroup(group, details);
              const characters = filterChar
                ? groupChars.filter((char) => (char.char || char) === filterChar)
                : groupChars;
              return {
                lang,
                key: group.target_reading_key,
                display: group.display_readings || [],
                count: filterChar ? Math.max(characters.length, 1) : group.character_count || 0,
                source: false,
                characters: characters.length || !filterChar ? characters : charObjectsFromValues([filterChar], details, 1),
              };
            });
    return { lang, nodes };
  });
}

function readingNode(node, total, filterChar = "") {
  const pct = filterChar ? 100 : total ? Math.round((node.count / total) * 100) : 0;
  const shownChars = (node.characters || []).slice(0, 96);
  const chars = shownChars
    .map((char) => {
      const value = char.char || char;
      const pinned = state.pinnedCharacters.has(value);
      const filtered = filterChar && value === filterChar;
      return `
        <button class="node-char ${pinned ? "is-pinned-char" : ""} ${filtered ? "is-filter-char" : ""}" type="button" data-char="${escapeHTML(value)}" data-pin-char="${escapeHTML(value)}" aria-pressed="${pinned ? "true" : "false"}">
          ${escapeHTML(value)}
        </button>
      `;
    })
    .join("");
  const more = node.count > shownChars.length ? `<span class="char-more">+${node.count - shownChars.length}</span>` : "";
  return `
    <article
      class="reading-node-card ${node.lang} ${node.source ? "source" : ""}"
      data-reading-lang="${escapeHTML(node.lang)}"
      data-reading-key="${escapeHTML(node.key)}"
      tabindex="0"
    >
      <div class="reading-node-head">
        <strong>${escapeHTML(readingDisplay(node.key, node.display, node.lang))}</strong>
        <span>${node.count}자${node.source ? "" : ` · ${pct}%`}</span>
      </div>
      <div class="reading-node-meter"><span style="width:${Math.min(Math.max(pct, node.source ? 100 : 6), 100)}%"></span></div>
      <div class="node-char-row scrollable-char-row">${chars}${more || ""}${chars ? "" : `<span class="muted">대표 글자 없음</span>`}</div>
    </article>
  `;
}

function pinnedCharacterTray(chars) {
  return `
    <div class="pinned-char-tray">
      ${chars
        .map(
          (char) => `
            <button class="pinned-char" type="button" data-char="${escapeHTML(char.char)}" data-pin-char="${escapeHTML(char.char)}" aria-pressed="true">
              <span>${escapeHTML(char.char)}</span>
              <small>${escapeHTML(shortDefinition(char.definition))}</small>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function sourceCharactersForNetwork(network, details) {
  const values = [];
  for (const group of network.target_groups || []) {
    values.push(...(group.support_chars || []));
  }
  if (!values.length) {
    values.push(...sourceRepresentativeChars(network).map((char) => char.char || char));
  }
  return charObjectsFromValues(values, details, 120);
}

function charactersForReadingGroup(group, details) {
  const values = [...(group.support_chars || [])];
  for (const char of representativeCharsForGroup(group)) {
    values.push(char.char || char);
  }
  return charObjectsFromValues(values, details, 120);
}

function groupSupportsChar(group, char, details) {
  if (!char) {
    return true;
  }
  return charactersForReadingGroup(group, details).some((entry) => (entry.char || entry) === char);
}

function charObjectsFromValues(values, details, limit) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const char = value?.char || value;
    if (!char || seen.has(char)) {
      continue;
    }
    seen.add(char);
    out.push(details.get(char) || (typeof value === "object" ? value : { char }));
    if (limit > 0 && out.length >= limit) {
      break;
    }
  }
  return out;
}

function pinnedCharactersForNetwork(network) {
  const available = networkCharacterSet(network);
  const details = characterDetailsFromNetwork(network);
  return [...state.pinnedCharacters]
    .filter((char) => available.has(char))
    .map((char) => details.get(char) || { char });
}

function networkCharacterSet(network) {
  const chars = new Set();
  for (const group of network.target_groups || []) {
    for (const char of group.support_chars || []) {
      chars.add(char);
    }
    for (const item of representativeCharsForGroup(group)) {
      chars.add(item.char || item);
    }
  }
  for (const item of sourceRepresentativeChars(network)) {
    chars.add(item.char || item);
  }
  return chars;
}

function bundleGraph(network, bundles) {
  const axis = sceneAxisLabels(network.source_lang);
  return `
    <section class="bundle-board bundle-board-3d">
      <div class="bundle-title">
        <div>
          <strong>발음 집합 3D 그래프</strong>
          <span>${escapeHTML(network.source_reading)} 기준으로 같은 글자들이 만드는 경로</span>
        </div>
        ${graphLanguageControls(network.source_lang)}
      </div>
      <div id="bundleScene" class="bundle-scene">
        <div id="lockedCombo" class="locked-combo"></div>
        <div id="bundleSceneLabels" class="bundle-scene-labels"></div>
        <div class="bundle-depth-axis" aria-hidden="true">
          <span>${escapeHTML(axis.left)}</span>
          <span>${escapeHTML(formatLang(network.source_lang))}</span>
          <span>${escapeHTML(axis.right)}</span>
        </div>
        <div class="bundle-vertical-axis" aria-hidden="true">
          <span>${escapeHTML(axis.top)}</span>
          <span>${escapeHTML(axis.bottom)}</span>
        </div>
      </div>
      ${
        bundles.length
          ? `<div class="bundle-path-list compact">${bundles.slice(0, 5).map((bundle, index) => bundlePath(bundle, index)).join("")}</div>`
          : ""
      }
    </section>
  `;
}

function graphLanguageControls(sourceLang) {
  const visible = visibleGraphLangSet(sourceLang);
  return `
    <div class="graph-language-controls" aria-label="그래프 표시 언어">
      ${displayLangs
        .map((lang) => {
          const checked = visible.has(lang);
          const isSource = lang === sourceLang;
          return `
            <label class="graph-lang-chip ${lang} ${checked ? "active" : ""} ${isSource ? "source" : ""}">
              <input
                type="checkbox"
                data-graph-lang="${escapeHTML(lang)}"
                ${checked ? "checked" : ""}
                ${isSource ? "disabled" : ""}
              />
              <span>${escapeHTML(formatLang(lang))}</span>
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function visibleGraphLangSet(sourceLang = state.network?.source_lang || "ko") {
  const visible = new Set([...state.visibleGraphLangs].filter((lang) => displayLangs.includes(lang)));
  visible.add(sourceLang);
  return visible;
}

function visibleGraphLangList(sourceLang = state.network?.source_lang || "ko") {
  const visible = visibleGraphLangSet(sourceLang);
  return displayLangs.filter((lang) => visible.has(lang));
}

function sceneAxisLabels(sourceLang) {
  const sides = { left: [], right: [], top: [], bottom: [] };
  for (const lang of visibleGraphLangList(sourceLang)) {
    if (lang === sourceLang) {
      continue;
    }
    sides[sceneSideForLang(lang, sourceLang)].push(formatLang(lang));
  }
  return {
    left: sides.left.join(" / ") || "좌측",
    right: sides.right.join(" / ") || "우측",
    top: sides.top.join(" / "),
    bottom: sides.bottom.join(" / "),
  };
}

function bundlePath(bundle, index) {
  const chars = (bundle.characters || [])
    .slice(0, 8)
    .map(
      (char) => `
        <button class="node-char" type="button" data-char="${escapeHTML(char.char)}">
          ${escapeHTML(char.char)}
        </button>
      `,
    )
    .join("");
  return `
    <article
      class="bundle-path"
      data-bundle-index="${index}"
      data-zh-key="${escapeHTML(bundle.zh?.reading_key || "")}"
      data-ko-key="${escapeHTML(bundle.ko?.reading_key || "")}"
      data-ja-key="${escapeHTML(bundle.ja?.reading_key || "")}"
    >
      ${bundleNode(bundle.zh, "zh")}
      <span class="bundle-arrow" aria-hidden="true">→</span>
      ${bundleNode(bundle.ko, "ko")}
      <span class="bundle-arrow" aria-hidden="true">→</span>
      ${bundleNode(bundle.ja, "ja")}
      <div class="bundle-path-support">
        <strong>${bundle.character_count || 0}자</strong>
        <div class="node-char-row">${chars}</div>
      </div>
    </article>
  `;
}

function bundleNode(reading, lang) {
  const key = reading?.reading_key || "";
  return `
    <button
      class="bundle-node ${lang} ${reading?.is_source ? "source" : ""}"
      type="button"
      data-reading-lang="${escapeHTML(lang)}"
      data-reading-key="${escapeHTML(key)}"
    >
      <small>${escapeHTML(formatLang(lang))}</small>
      <strong>${escapeHTML(readingDisplay(key, reading?.display_readings || [], lang))}</strong>
    </button>
  `;
}

function mountBundleScene(network, bundles) {
  const container = $("#bundleScene");
  const labelLayer = $("#bundleSceneLabels");
  if (!container || !labelLayer) {
    return;
  }
  disposeBundleScene();

  const graph = buildBundleSceneModel(network, bundles);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.6, 9.4);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "bundle-canvas";
  container.insertBefore(renderer.domElement, labelLayer);

  const root = new THREE.Group();
  root.rotation.x = -0.08;
  scene.add(root);
  scene.add(new THREE.AmbientLight(0xffffff, 1.35));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(3.6, 4.2, 6.5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xddeaff, 1.2);
  fillLight.position.set(-4.6, -2, 4);
  scene.add(fillLight);

  const nodeObjects = new Map();
  const edgeObjects = [];
  for (const edge of graph.edges) {
    const source = graph.nodes.get(edge.source);
    const target = graph.nodes.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const start = new THREE.Vector3(source.x, source.y, source.z);
    const end = new THREE.Vector3(target.x, target.y, target.z);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.z += edge.arc;
    mid.y += edge.lift;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const geometry = new THREE.TubeGeometry(curve, 32, Math.min(0.035 + edge.count / 900, 0.072), 8, false);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8c949b,
      emissive: 0x1f7a5c,
      emissiveIntensity: 0.05,
      metalness: 0.08,
      roughness: 0.42,
      transparent: true,
      opacity: 0.34,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = edge;
    root.add(mesh);
    edgeObjects.push(mesh);
  }

  for (const node of graph.nodes.values()) {
    const radius = node.source ? 0.48 : Math.min(0.22 + Math.sqrt(node.count) / 30, 0.42);
    const geometry = node.source
      ? new THREE.DodecahedronGeometry(radius, 1)
      : new THREE.IcosahedronGeometry(radius, 2);
    const material = new THREE.MeshPhysicalMaterial({
      color: readingColor(node.lang),
      emissive: readingColor(node.lang),
      emissiveIntensity: node.source ? 0.24 : 0.12,
      metalness: 0.34,
      roughness: 0.28,
      clearcoat: 0.72,
      clearcoatRoughness: 0.28,
      transparent: true,
      opacity: 0.94,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(node.x, node.y, node.z);
    mesh.userData = node;
    root.add(mesh);

    const ringGeometry = new THREE.TorusGeometry(radius * 1.38, 0.012, 8, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: readingColor(node.lang),
      transparent: true,
      opacity: node.source ? 0.46 : 0.24,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(mesh.position);
    ring.rotation.x = Math.PI / 2.4;
    root.add(ring);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: node.source ? 0.34 : 0.18,
      }),
    );
    wire.position.copy(mesh.position);
    root.add(wire);

    const label = document.createElement("button");
    label.type = "button";
    label.className = `bundle-3d-label ${node.lang}${node.source ? " source" : ""}`;
    label.dataset.readingLang = node.lang;
    label.dataset.readingKey = node.key;
    const nodePct = node.source
      ? 100
      : Math.min(Math.max(Math.round((node.count / Math.max(network.total_characters || node.count || 1, 1)) * 100), 8), 100);
    label.style.setProperty("--node-meter", `${nodePct}%`);
    label.innerHTML = `
      <span class="node-cap">
        <small>${escapeHTML(formatLang(node.lang))}</small>
        <span>${node.count}자</span>
      </span>
      <strong>${escapeHTML(readingDisplay(node.key, node.display, node.lang))}</strong>
      <i class="node-meter" aria-hidden="true"></i>
      <em>${escapeHTML(node.chars.slice(0, 6).join(" "))}</em>
    `;
    labelLayer.appendChild(label);
    nodeObjects.set(node.id, { mesh, ring, wire, label, node });
  }

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width, 320);
    const height = Math.max(rect.height, 420);
    if (width < 560) {
      root.scale.set(0.58, 1.08, 0.58);
    } else {
      root.scale.setScalar(1);
    }
    camera.position.z = width < 560 ? 14.5 : 9.4;
    camera.position.y = width < 560 ? 0.25 : 0.6;
    camera.fov = width < 560 ? 48 : 42;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const clock = new THREE.Clock();
  const render = () => {
    const elapsed = clock.getElapsedTime();
    root.rotation.y = Math.sin(elapsed * 0.42) * 0.075;
    root.rotation.z = Math.sin(elapsed * 0.27) * 0.025;
    for (const { mesh, ring, wire, node } of nodeObjects.values()) {
      ring.rotation.z += node.source ? 0.012 : 0.006;
      mesh.rotation.x += node.source ? 0.004 : 0.002;
      mesh.rotation.y += node.source ? 0.006 : 0.003;
      mesh.position.y = node.y + Math.sin(elapsed * 1.4 + node.phase) * 0.035;
      ring.position.copy(mesh.position);
      wire.position.copy(mesh.position);
      wire.rotation.copy(mesh.rotation);
    }
    renderer.render(scene, camera);
    positionBundleLabels(container, camera, nodeObjects);
    state.bundleScene.frame = requestAnimationFrame(render);
  };

  state.bundleScene = {
    camera,
    container,
    edgeObjects,
    frame: 0,
    labelLayer,
    nodeObjects,
    renderer,
    resizeObserver,
    scene,
  };
  renderLockedCombo();
  applyReadingState();
  render();
}

function disposeBundleScene() {
  const active = state.bundleScene;
  if (!active) {
    return;
  }
  cancelAnimationFrame(active.frame);
  active.resizeObserver?.disconnect();
  active.scene.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => material.dispose?.());
    } else {
      object.material?.dispose?.();
    }
  });
  active.renderer.dispose();
  active.renderer.domElement.remove();
  if (active.labelLayer) {
    active.labelLayer.innerHTML = "";
  }
  state.bundleScene = null;
}

function buildBundleSceneModel(network, bundles) {
  const visibleLangs = new Set(visibleGraphLangList(network.source_lang));
  const nodes = new Map();
  const edges = [];
  const sourceReading = {
    lang: network.source_lang,
    reading_key: network.source_reading_key || network.source_reading,
    display_readings: [network.source_reading],
    is_source: true,
  };
  const addNode = (reading, side, support, options = {}) => {
    if (!reading?.lang || !reading?.reading_key) {
      return null;
    }
    const id = readingID(reading.lang, reading.reading_key);
    const count = reading.is_source ? network.total_characters || 0 : support?.character_count || 0;
    const existing = nodes.get(id);
    if (existing) {
      existing.count = options.accumulate === false ? Math.max(existing.count, count) : existing.count + count;
      mergeNodeChars(existing, support?.characters || []);
      mergeDisplayReadings(existing, reading.display_readings || []);
      return existing;
    }
    const node = {
      chars: [],
      count,
      display: reading.display_readings || [],
      id,
      key: reading.reading_key,
      lang: reading.lang,
      phase: nodes.size * 0.83,
      side,
      source: Boolean(reading.is_source),
      x: side === "left" ? -3.9 : side === "right" ? 3.9 : 0,
      y: side === "top" ? 2.45 : side === "bottom" ? -2.55 : 0,
      z: side === "center" ? 0.15 : 0,
    };
    mergeNodeChars(node, support?.characters || []);
    nodes.set(id, node);
    return node;
  };

  const center = addNode(sourceReading, "center", {
    character_count: network.total_characters || 0,
    characters: sourceRepresentativeChars(network),
  });
  bundles.forEach((bundle, index) => {
    const source = addNode(bundle[network.source_lang] || sourceReading, "center", bundle) || center;
    for (const lang of ["zh", "ko", "ja"]) {
      if (lang === network.source_lang || !visibleLangs.has(lang)) {
        continue;
      }
      const node = addNode(bundle[lang], sceneSideForLang(lang, network.source_lang), bundle);
      if (node && source) {
        edges.push(sceneEdge(source, node, bundle, index, node.side === "left" ? -1 : 1));
      }
    }
  });

  (network.target_groups || [])
    .filter((group) => visibleLangs.has(group.target_lang))
    .forEach((group, index) => {
      const reading = {
        lang: group.target_lang,
        reading_key: group.target_reading_key,
        display_readings: group.display_readings || [],
      };
      const support = {
        character_count: group.character_count || 0,
        characters: representativeCharsForGroup(group),
      };
      const node = addNode(reading, sceneSideForLang(group.target_lang, network.source_lang), support, { accumulate: false });
      if (node && center) {
        edges.push(sceneGroupEdge(center, node, group, bundles.length + index));
      }
    });

  layoutSceneSide(nodes, "left");
  layoutSceneSide(nodes, "right");
  layoutSceneSide(nodes, "top");
  layoutSceneSide(nodes, "bottom");
  for (const node of nodes.values()) {
    if (node.source) {
      node.x = 0;
      node.y = 0;
      node.z = 0.35;
      node.count = network.total_characters || node.count;
      node.chars = sourceRepresentativeChars(network)
        .map((char) => char.char || char)
        .slice(0, 10);
    }
  }
  return { edges, nodes };
}

function sceneEdge(source, target, bundle, index, direction) {
  const readings = [bundle.zh, bundle.ko, bundle.ja]
    .filter((reading) => reading?.lang && reading?.reading_key)
    .map((reading) => readingID(reading.lang, reading.reading_key));
  return {
    arc: 0.65 + (index % 4) * 0.12,
    bundle,
    bundleIndex: index,
    count: bundle.character_count || 1,
    direction,
    lift: ((index % 5) - 2) * 0.04,
    readings,
    source: source.id,
    target: target.id,
  };
}

function sceneGroupEdge(source, target, group, index) {
  return {
    arc: 0.52 + (index % 5) * 0.08,
    bundle: null,
    bundleIndex: `group-${index}`,
    count: group.character_count || 1,
    direction: target.side === "left" || target.side === "top" ? -1 : 1,
    lift: ((index % 7) - 3) * 0.035,
    readings: [source.id, readingID(group.target_lang, group.target_reading_key)],
    source: source.id,
    target: target.id,
  };
}

function layoutSceneSide(nodes, side) {
  const items = [...nodes.values()]
    .filter((node) => node.side === side)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (side === "top" || side === "bottom") {
    const spread = Math.max(0.86, Math.min(1.18, 6.4 / Math.max(items.length, 1)));
    const offset = ((items.length - 1) * spread) / 2;
    items.forEach((node, index) => {
      node.sideRank = index;
      node.x = -offset + index * spread;
      node.y = side === "top" ? 2.55 : -2.65;
      node.z = Math.cos(index * 1.35) * 0.62 - 0.05;
    });
    return;
  }
  const spread = Math.max(0.78, Math.min(1.05, 5.1 / Math.max(items.length, 1)));
  const offset = ((items.length - 1) * spread) / 2;
  items.forEach((node, index) => {
    node.sideRank = index;
    node.y = offset - index * spread;
    node.z = Math.sin(index * 1.45) * 0.72 - 0.15;
    node.x += Math.cos(index * 0.9) * 0.18;
  });
}

function mergeNodeChars(node, chars) {
  const seen = new Set(node.chars);
  for (const char of chars || []) {
    const value = char.char || char;
    if (value && !seen.has(value)) {
      seen.add(value);
      node.chars.push(value);
    }
  }
}

function mergeDisplayReadings(node, readings) {
  const seen = new Set(node.display);
  for (const reading of readings || []) {
    if (reading && !seen.has(reading)) {
      seen.add(reading);
      node.display.push(reading);
    }
  }
}

function positionBundleLabels(container, camera, nodeObjects) {
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  const narrow = width < 560;
  const vector = new THREE.Vector3();
  for (const { mesh, label, node } of nodeObjects.values()) {
    if (narrow && node.side !== "center" && node.sideRank > 1) {
      label.style.display = "none";
      continue;
    }
    label.style.display = "";
    mesh.getWorldPosition(vector);
    vector.project(camera);
    const x = (vector.x * 0.5 + 0.5) * width;
    const y = (-vector.y * 0.5 + 0.5) * height;
    label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    label.style.zIndex = String(Math.round((1 - vector.z) * 1000));
  }
}

function updateBundleSceneActivation(lang = "", key = "") {
  const active = state.bundleScene;
  if (!active) {
    return;
  }
  const hasSelection = Boolean(lang && key);
  const lockedIDs = lockedReadingIDs();
  const lockedBundleIndexes = matchingLockedBundleIndexes();
  const linked = hasSelection ? linkedReadingIDs(lang, key, state.network) : lockedIDs;
  const selected = hasSelection ? readingID(lang, key) : "";
  const hasLocked = lockedIDs.size > 1;
  for (const [id, item] of active.nodeObjects.entries()) {
    const isSelected = id === selected;
    const isLocked = lockedIDs.has(id);
    const isLinked = linked.has(id);
    const muted = (hasSelection || hasLocked) && !isLinked;
    item.label.classList.toggle("is-active-reading", isSelected);
    item.label.classList.toggle("is-linked-reading", isLinked && !isSelected);
    item.label.classList.toggle("is-muted-reading", muted);
    item.label.classList.toggle("is-locked-reading", isLocked);
    item.mesh.material.opacity = muted ? 0.22 : isSelected ? 1 : isLocked ? 0.98 : isLinked ? 0.94 : 0.86;
    item.mesh.material.emissiveIntensity = isSelected ? 0.72 : isLocked ? 0.48 : isLinked ? 0.32 : 0.12;
    item.ring.material.opacity = muted ? 0.07 : isSelected ? 0.86 : isLocked ? 0.64 : isLinked ? 0.44 : 0.22;
    item.wire.material.opacity = muted ? 0.05 : isSelected ? 0.42 : isLocked ? 0.34 : isLinked ? 0.24 : 0.14;
    const scale = isSelected ? 1.3 : isLocked ? 1.18 : isLinked ? 1.1 : muted ? 0.75 : 1;
    item.mesh.scale.setScalar(scale);
    item.ring.scale.setScalar(scale);
    item.wire.scale.setScalar(scale);
  }
  for (const edge of active.edgeObjects) {
    const lineLinked = hasSelection && edge.userData.readings.includes(selected);
    const lineRelated = hasSelection && edge.userData.readings.some((id) => linked.has(id));
    const lineLocked = !hasSelection && lockedBundleIndexes.has(String(edge.userData.bundleIndex));
    edge.material.opacity = !hasSelection && !hasLocked ? 0.32 : lineLinked || lineLocked ? 0.88 : lineRelated ? 0.5 : 0.06;
    edge.material.emissiveIntensity = lineLinked || lineLocked ? 0.48 : lineRelated ? 0.22 : 0.02;
    edge.scale.setScalar(lineLinked || lineLocked ? 1.08 : 1);
  }
}

function readingColor(lang) {
  switch (lang) {
    case "zh":
      return 0xa63d40;
    case "ko":
      return 0x1f7a5c;
    case "ja":
      return 0x2f62a3;
    case "yue":
      return 0x7650a1;
    case "vi":
      return 0x9b6a22;
    default:
      return 0x6b7280;
  }
}

function sceneSideForLang(lang, sourceLang) {
  if (lang === sourceLang) {
    return "center";
  }
  if (lang === "yue") {
    return "top";
  }
  if (lang === "vi") {
    return "bottom";
  }
  const sideMap = {
    ko: { zh: "left", ja: "right" },
    zh: { ko: "right", ja: "right" },
    yue: { zh: "left", ko: "right", ja: "right" },
    ja: { zh: "left", ko: "left" },
    vi: { zh: "left", ko: "right", ja: "right" },
  };
  return sideMap[sourceLang]?.[lang] || (displayLangs.indexOf(lang) < displayLangs.indexOf(sourceLang) ? "left" : "right");
}

function bundleRow(bundle) {
  const readings = [
    bundleReadingCell(bundle.zh, "zh"),
    bundleReadingCell(bundle.ko, "ko"),
    bundleReadingCell(bundle.ja, "ja"),
  ].join("");
  const chars = (bundle.characters || [])
    .slice(0, 10)
    .map(
      (char) => `
        <button class="node-char" type="button" data-char="${escapeHTML(char.char)}">
          ${escapeHTML(char.char)}
        </button>
      `,
    )
    .join("");
  return `
    <article class="bundle-row">
      <div class="bundle-readings">${readings}</div>
      <div class="bundle-support">
        <strong>${bundle.character_count || 0}자</strong>
        <div class="node-char-row">${chars}</div>
      </div>
    </article>
  `;
}

function bundleReadingCell(reading, lang) {
  return `
    <span
      class="bundle-reading ${lang} ${reading?.is_source ? "source" : ""}"
      data-reading-lang="${escapeHTML(lang)}"
      data-reading-key="${escapeHTML(reading?.reading_key || "")}"
      tabindex="0"
    >
      <small>${escapeHTML(formatLang(lang))}</small>
      <strong>${escapeHTML(readingDisplay(reading?.reading_key || "", reading?.display_readings || [], lang))}</strong>
    </span>
  `;
}

function handleReadingPointer(event) {
  const node = event.target.closest("[data-reading-lang][data-reading-key]");
  if (!node) {
    return;
  }
  activateReading(node.dataset.readingLang, node.dataset.readingKey, networkForReadingElement(node));
}

function handleReadingPointerOut(event) {
  const node = event.target.closest("[data-reading-lang][data-reading-key]");
  if (!node) {
    return;
  }
  if (event.relatedTarget && node.contains(event.relatedTarget)) {
    return;
  }
  clearReadingActivation();
}

function activateReading(lang, key, network = state.network) {
  if (!state.network || !lang || !key) {
    return;
  }
  applyReadingState(lang, key, network);
}

function clearReadingActivation() {
  applyReadingState();
}

function togglePinnedCharacter(char) {
  if (!char) {
    return;
  }
  if (state.pinnedCharacters.has(char)) {
    state.pinnedCharacters.delete(char);
  } else {
    state.pinnedCharacters.add(char);
  }
  loadCharacter(char);
}

function toggleLockedReading(lang, key) {
  if (!state.network || !lang || !key) {
    return;
  }
  if (lang === state.network.source_lang) {
    state.lockedReadings[lang] = key;
  } else if (state.lockedReadings[lang] === key) {
    delete state.lockedReadings[lang];
  } else {
    state.lockedReadings[lang] = key;
  }
  renderLockedCombo();
  applyReadingState();
}

function applyReadingState(lang = "", key = "", network = state.network) {
  if (!state.network) {
    return;
  }
  const hasHover = Boolean(lang && key);
  const selected = readingID(lang, key);
  const linked = hasHover ? linkedReadingIDs(lang, key, network || state.network) : lockedReadingIDs();
  const locked = lockedReadingIDs();
  const hasLocked = locked.size > 1;
  const lockedPaths = matchingLockedBundleIndexes();
  document.querySelectorAll("[data-reading-lang][data-reading-key]").forEach((element) => {
    const id = readingID(element.dataset.readingLang, element.dataset.readingKey);
    element.classList.toggle("is-active-reading", hasHover && id === selected);
    element.classList.toggle("is-linked-reading", hasHover && linked.has(id) && id !== selected);
    element.classList.toggle("is-muted-reading", (hasHover || hasLocked) && !linked.has(id));
    element.classList.toggle("is-locked-reading", locked.has(id));
  });
  document.querySelectorAll("[data-bundle-index]").forEach((element) => {
    const hoverActive = hasHover && bundleElementHasReading(element, lang, key);
    const lockedActive = lockedPaths.has(element.dataset.bundleIndex);
    element.classList.toggle("is-active-path", hoverActive);
    element.classList.toggle("is-muted-path", hasHover ? !hoverActive : hasLocked && !lockedActive);
    element.classList.toggle("is-locked-path", lockedActive);
  });
  updateBundleSceneActivation(network === state.network ? lang : "", network === state.network ? key : "");
}

function networkForReadingElement(element) {
  const block = element.closest("[data-pronunciation-network-index]");
  const index = Number(block?.dataset.pronunciationNetworkIndex ?? -1);
  if (Number.isInteger(index) && index >= 0) {
    return state.multiNetworks?.[index]?.network || state.network;
  }
  return state.network;
}

function networkFilterKey(index) {
  return Number.isInteger(index) ? String(index) : "-1";
}

function selectedNetworkCharFilter(index) {
  return state.networkCharFilters.get(networkFilterKey(index)) || "";
}

function setNetworkCharFilter(index, char) {
  const key = networkFilterKey(index);
  if (char) {
    state.networkCharFilters.set(key, char);
  } else {
    state.networkCharFilters.delete(key);
  }
  renderPronunciationGraph(state.network);
}

function toggleNetworkCharFilter(index, char) {
  if (!char) {
    return;
  }
  const current = selectedNetworkCharFilter(index);
  setNetworkCharFilter(index, current === char ? "" : char);
}

function linkedReadingIDs(lang, key, network) {
  const selected = readingID(lang, key);
  const linked = new Set([selected]);
  for (const bundle of network.bundles || []) {
    if (!bundleHasReading(bundle, lang, key)) {
      continue;
    }
    for (const reading of [bundle.zh, bundle.ko, bundle.ja]) {
      if (reading?.lang && reading?.reading_key) {
        linked.add(readingID(reading.lang, reading.reading_key));
      }
    }
  }
  const sourceID = readingID(network.source_lang, network.source_reading_key || network.source_reading);
  if (selected === sourceID) {
    for (const group of network.target_groups || []) {
      linked.add(readingID(group.target_lang, group.target_reading_key));
    }
    return linked;
  }
  const selectedGroups = groupsForReading(network, lang, key);
  if (!selectedGroups.length) {
    return linked;
  }
  linked.add(sourceID);
  const selectedChars = new Set(selectedGroups.flatMap((group) => group.support_chars || []));
  if (!selectedChars.size) {
    return linked;
  }
  for (const group of network.target_groups || []) {
    if ((group.support_chars || []).some((char) => selectedChars.has(char))) {
      linked.add(readingID(group.target_lang, group.target_reading_key));
    }
  }
  return linked;
}

function groupsForReading(network, lang, key) {
  return (network.target_groups || []).filter((group) => group.target_lang === lang && group.target_reading_key === key);
}

function lockedReadingIDs() {
  const out = new Set();
  for (const [lang, key] of Object.entries(state.lockedReadings || {})) {
    if (key) {
      out.add(readingID(lang, key));
    }
  }
  return out;
}

function matchingLockedBundles() {
  const lockedEntries = bundleLockedEntries();
  if (!state.network || lockedEntries.length < 2) {
    return [];
  }
  return (state.network.bundles || []).filter((bundle) =>
    lockedEntries.every(([lang, key]) => bundle?.[lang]?.reading_key === key),
  );
}

function matchingLockedBundleIndexes() {
  const lockedEntries = bundleLockedEntries();
  const out = new Set();
  if (!state.network || lockedEntries.length < 2) {
    return out;
  }
  (state.network.bundles || []).forEach((bundle, index) => {
    if (lockedEntries.every(([lang, key]) => bundle?.[lang]?.reading_key === key)) {
      out.add(String(index));
    }
  });
  return out;
}

function bundleLockedEntries() {
  const bundleLangs = new Set(["zh", "ko", "ja"]);
  return Object.entries(state.lockedReadings || {}).filter(([lang, key]) => key && bundleLangs.has(lang));
}

function renderLockedCombo() {
  const box = $("#lockedCombo");
  if (!box || !state.network) {
    return;
  }
  const locked = state.lockedReadings || {};
  const comboLangs = visibleGraphLangList(state.network.source_lang);
  const selectedReadings = comboLangs
    .map((lang) => {
      const key = locked[lang];
      if (!key) {
        return `<span class="locked-reading empty">${escapeHTML(formatLang(lang))}</span>`;
      }
      return `<span class="locked-reading ${lang}">${escapeHTML(formatLang(lang))} <strong>${escapeHTML(lockedReadingDisplay(lang, key))}</strong></span>`;
    })
    .join("");
  const chars = matchingLockedCharacters().slice(0, 16);
  const charHTML = chars
    .map(
      (char) => `
        <button class="locked-char" type="button" data-char="${escapeHTML(char.char)}">
          <span>${escapeHTML(char.char)}</span>
          <small>${escapeHTML(shortDefinition(char.definition))}</small>
        </button>
      `,
    )
    .join("");
  const lockedTargets = Object.entries(locked).filter(([lang, key]) => key && lang !== state.network.source_lang).length;
  const copy = lockedTargets ? `${chars.length}자 후보` : "";
  box.innerHTML = `
    ${copy ? `<div class="locked-head"><span>${escapeHTML(copy)}</span></div>` : ""}
    <div class="locked-readings">${selectedReadings}</div>
    <div class="locked-char-row">${charHTML || `<span class="muted">대표 한자 대기</span>`}</div>
  `;
}

function matchingLockedCharacters() {
  const network = state.network;
  if (!network) {
    return [];
  }
  const locked = Object.entries(state.lockedReadings || {}).filter(([, key]) => key);
  const targetLocks = locked.filter(([lang]) => lang !== network.source_lang);
  if (!targetLocks.length) {
    return [];
  }
  let intersection = null;
  for (const [lang, key] of targetLocks) {
    const groups = groupsForReading(network, lang, key);
    const chars = new Set(groups.flatMap((group) => group.support_chars || []));
    if (!chars.size) {
      return [];
    }
    intersection = intersection ? new Set([...intersection].filter((char) => chars.has(char))) : chars;
  }
  if (!intersection?.size) {
    return [];
  }
  const details = characterDetailsFromNetwork(network);
  return [...intersection].map((char) => details.get(char) || { char });
}

function characterDetailsFromNetwork(network) {
  const details = new Map();
  for (const bundle of network.bundles || []) {
    for (const char of bundle.characters || []) {
      if (char?.char && !details.has(char.char)) {
        details.set(char.char, char);
      }
    }
  }
  for (const group of network.target_groups || []) {
    for (const char of representativeCharsForGroup(group)) {
      const value = char?.char || char;
      if (value && !details.has(value)) {
        details.set(value, typeof char === "string" ? { char } : char);
      }
    }
  }
  return details;
}

function lockedReadingDisplay(lang, key) {
  const bundles = state.network?.bundles || [];
  for (const bundle of bundles) {
    const reading = bundle?.[lang];
    if (reading?.reading_key === key) {
      return readingDisplay(key, reading.display_readings || [], lang);
    }
  }
  for (const group of state.network?.target_groups || []) {
    if (group.target_lang === lang && group.target_reading_key === key) {
      return readingDisplay(key, group.display_readings || [], lang);
    }
  }
  return key;
}

function uniqueCharacters(chars) {
  const seen = new Set();
  const out = [];
  for (const char of chars) {
    const value = char?.char || char;
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(typeof char === "string" ? { char } : char);
  }
  return out;
}

function shortDefinition(value) {
  return String(value || "")
    .split(/[;,]/)[0]
    .trim()
    .slice(0, 28);
}

function variantMetaItems(detail) {
  const groups = variantGroups(detail);
  const out = [];
  if (groups.simplified.length) {
    out.push(`간체 ${groups.simplified.join(" ")}`);
  }
  if (groups.traditional.length) {
    out.push(`정체 ${groups.traditional.join(" ")}`);
  }
  return out;
}

function compactVariantText(detail) {
  return variantMetaItems(detail).join(" · ");
}

function variantGroups(detail) {
  const groups = { simplified: [], traditional: [] };
  const char = detail?.character?.char || "";
  for (const variant of detail?.variants || []) {
    const target = variant.target_char;
    if (!target || target === char) {
      continue;
    }
    if (variant.relation === "kSimplifiedVariant" && !groups.simplified.includes(target)) {
      groups.simplified.push(target);
    }
    if (variant.relation === "kTraditionalVariant" && !groups.traditional.includes(target)) {
      groups.traditional.push(target);
    }
  }
  return groups;
}

function bundleHasReading(bundle, lang, key) {
  const reading = bundle?.[lang];
  return reading?.reading_key === key;
}

function bundleElementHasReading(element, lang, key) {
  return element.dataset[`${lang}Key`] === key;
}

function readingID(lang, key) {
  return `${lang}\u0000${key}`;
}

function branchCluster(cluster, targetLang) {
  const chars = (cluster.characters || [])
    .map((entry) => branchCharChip(entry, targetLang))
    .join("");
  const rep = cluster.representative?.char ? ` · 대표 ${cluster.representative.char}` : "";
  return `
    <section class="phonetic-cluster">
      <div class="cluster-head">
        <strong>${escapeHTML(cluster.label)}</strong>
        <span>${cluster.character_count || 0}자${escapeHTML(rep)}</span>
      </div>
      <div class="char-strip">${chars}</div>
    </section>
  `;
}

function branchCharChip(entry, targetLang) {
  const target = compactReadingList(entry.target_readings || [], targetLang);
  const source = compactReadingList(entry.source_readings || [], "");
  const active = entry.character.char === state.selectedChar ? " active" : "";
  return `
    <button class="branch-char${active}" type="button" data-char="${escapeHTML(entry.character.char)}">
      <span>${escapeHTML(entry.character.char)}</span>
      <small>${escapeHTML(target || source)}</small>
    </button>
  `;
}

function groupTitle(group) {
  return readingDisplay(group.target_reading_key, group.display_readings || [], group.target_lang);
}

function readingDisplay(key, readings, lang) {
  if (lang === "ja") {
    return japaneseReadingValues(key, readings).slice(0, 4).join(" / ") || key;
  }
  const values = compactReadingValues(lang, readings, key);
  return values.slice(0, 4).join(" / ") || key;
}

function compactSystemReadings(lang, readings) {
  return compactReadingValues(lang, readings, "").slice(0, 4).join("/");
}

function sourceRepresentativeChars(network) {
  const seen = new Set();
  const chars = [];
  for (const bundle of network.bundles || []) {
    for (const char of bundle.characters || []) {
      if (!seen.has(char.char)) {
        seen.add(char.char);
        chars.push(char);
      }
    }
  }
  for (const group of network.target_groups || []) {
    for (const char of representativeCharsForGroup(group)) {
      const value = char.char || char;
      if (!seen.has(value)) {
        seen.add(value);
        chars.push(char);
      }
    }
  }
  return chars.slice(0, 12);
}

function representativeCharsForGroup(group) {
  const seen = new Set();
  const chars = [];
  for (const cluster of group.clusters || []) {
    const rep = cluster.representative;
    if (rep?.char && !seen.has(rep.char)) {
      seen.add(rep.char);
      chars.push(rep);
    }
    for (const entry of cluster.characters || []) {
      const char = entry.character;
      if (char?.char && !seen.has(char.char)) {
        seen.add(char.char);
        chars.push(char);
      }
    }
  }
  for (const entry of group.characters || []) {
    const char = entry.character;
    if (char?.char && !seen.has(char.char)) {
      seen.add(char.char);
      chars.push(char);
    }
  }
  return chars.slice(0, 10);
}

function renderEvolutionLanes(network) {
  const lanes = network.evolution_lanes || [];
  if (!lanes.length) {
    $("#evolutionLanes").innerHTML = `<div class="empty">변천 단서 없음</div>`;
    return;
  }
  $("#evolutionLanes").innerHTML = lanes
    .map((lane) => {
      const stages = (lane.stages || [])
        .map((stage) => {
          const values = stage.unavailable
            ? "데이터 미내재화"
            : (stage.readings || []).slice(0, 10).join(" / ");
          return `
            <div class="stage ${stage.unavailable ? "unavailable" : ""}">
              <strong>${escapeHTML(stage.label || formatSystem(stage.system))}</strong>
              <span>${escapeHTML(values || "없음")}</span>
            </div>
          `;
        })
        .join("");
      return `
        <section class="evolution-lane">
          <h3>${escapeHTML(lane.label)}</h3>
          <div class="stage-row">${stages}</div>
        </section>
      `;
    })
    .join("");
}

function renderCharacter() {
  const detail = state.detail;
  if (!detail) {
    clearCharacter();
    return;
  }
  const char = detail.character;
  $("#glyph").textContent = char.char;
  $("#codepoint").textContent = char.codepoint || "";
  $("#definition").textContent = char.definition || "definition not available";
  $("#characterMeta").innerHTML = [
    char.total_strokes ? `총획 ${char.total_strokes}` : "",
    char.rs_unicode ? `부수 ${char.rs_unicode}` : "",
    char.frequency ? `빈도 ${char.frequency}` : "",
    char.grade_level ? `학년 ${char.grade_level}` : "",
    ...variantMetaItems(detail),
  ]
    .filter(Boolean)
    .map((item) => `<span class="meta-chip">${escapeHTML(item)}</span>`)
    .join("");
  renderReadingCards(detail);
  renderTagsAndNotes(detail);
  renderRelated();
  renderPhoneticNetwork();
}

function renderReadingCards(detail) {
  const cards = displayLangs.map((lang) => {
    const readings = displayReadingsFor(detail, lang);
    const body = readings.length
      ? readings
          .map(
            (reading) => `
              <span class="reading-pill ${lang}">
                ${escapeHTML(reading.value)}
                <span class="system-label">${escapeHTML(reading.label)}</span>
              </span>
            `,
          )
          .join("")
      : `<span class="muted">없음</span>`;
    return `
      <section class="reading-card">
        <h3>${escapeHTML(formatLang(lang))}</h3>
        <div class="reading-values">${body}</div>
      </section>
    `;
  });
  $("#readingCards").innerHTML = cards.join("");
}

function renderTagsAndNotes(detail) {
  const tags = (detail.tags || []).slice(0, 30);
  const notes = detail.notes || [];
  $("#tagCount").textContent = String((detail.tags || []).length + notes.length);
  const tagHTML = tags
    .map((tag) => `<span class="tag ${(tag.region || "").toLowerCase()}">${escapeHTML(formatTag(tag))}</span>`)
    .join("");
  const noteHTML = notes
    .map((note) => `<span class="tag">${escapeHTML(note.title || note.note_type)}: ${escapeHTML(note.note)}</span>`)
    .join("");
  $("#tagsAndNotes").innerHTML = tagHTML || noteHTML ? tagHTML + noteHTML : `<div class="empty">목록/주석 없음</div>`;
}

function renderRelated() {
  const related = state.related || [];
  $("#relatedCount").textContent = String(related.length);
  if (!related.length) {
    $("#relatedList").innerHTML = `<div class="empty">형성자 시리즈 없음</div>`;
    $("#seriesBadge").textContent = "none";
    return;
  }
  const series = [...new Set(related.flatMap((item) => item.shared_series || []))].slice(0, 3);
  $("#seriesBadge").textContent = series.length ? `series ${series.join(", ")}` : "kPhonetic";
  $("#relatedList").innerHTML = related
    .slice(0, 14)
    .map((item) => {
      const readings = compactReadings(item.readings || []);
      return `
        <button class="related-row" type="button" data-char="${escapeHTML(item.character.char)}">
          <span class="mini-glyph">${escapeHTML(item.character.char)}</span>
          <span>
            <span class="row-title">
              <span>${escapeHTML(item.character.char)}</span>
              <span>${escapeHTML((item.shared_series || []).join(","))}</span>
            </span>
            <span class="row-copy">${escapeHTML(readings || item.character.definition || "")}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderPhoneticNetwork() {
  const char = state.detail?.character?.char || "";
  const related = (state.related || []).slice(0, 10);
  if (!char) {
    $("#network").innerHTML = `<div class="empty">선택 대기</div>`;
    return;
  }
  const width = 520;
  const height = 260;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 96;
  const nodes = related.map((item, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(related.length, 1);
    return {
      char: item.character.char,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
  const lines = nodes
    .map((node) => `<line class="network-line" x1="${cx}" y1="${cy}" x2="${node.x}" y2="${node.y}" />`)
    .join("");
  const nodeHTML = nodes
    .map(
      (node) => `
        <g class="network-node" data-char="${escapeHTML(node.char)}">
          <circle class="network-circle" cx="${node.x}" cy="${node.y}" r="22"></circle>
          <text x="${node.x}" y="${node.y}" font-size="23">${escapeHTML(node.char)}</text>
        </g>
      `,
    )
    .join("");
  $("#network").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="phonetic series graph">
      ${lines}
      ${nodeHTML}
      <g>
        <circle class="network-center" cx="${cx}" cy="${cy}" r="34"></circle>
        <text x="${cx}" y="${cy}" font-size="36">${escapeHTML(char)}</text>
      </g>
    </svg>
  `;
}

function clearCharacter() {
  $("#glyph").textContent = "";
  $("#codepoint").textContent = "";
  $("#definition").textContent = "선택된 한자 없음";
  $("#characterMeta").innerHTML = "";
  $("#readingCards").innerHTML = "";
  $("#tagsAndNotes").innerHTML = `<div class="empty">목록/주석 없음</div>`;
  $("#relatedList").innerHTML = `<div class="empty">선택 대기</div>`;
  $("#network").innerHTML = `<div class="empty">선택 대기</div>`;
}

async function handleCharPreviewPointer(event) {
  const target = event.target.closest("[data-char]");
  if (!target) {
    return;
  }
  clearTimeout(state.charPreviewTimer);
  const char = target.dataset.char;
  const preview = ensureCharacterPreview();
  preview.innerHTML = `<div class="char-preview-loading">${escapeHTML(char)} 불러오는 중</div>`;
  positionCharacterPreview(preview, target);
  preview.hidden = false;
  try {
    const detail = await cachedCharacterDetail(char);
    if (!detail || target.dataset.char !== char) {
      return;
    }
    preview.innerHTML = renderCharacterPreview(detail);
    positionCharacterPreview(preview, target);
  } catch {
    preview.innerHTML = `<div class="char-preview-loading">${escapeHTML(char)} 정보를 불러오지 못함</div>`;
  }
}

function handleCharPreviewPointerOut(event) {
  const target = event.target.closest("[data-char]");
  if (!target) {
    return;
  }
  state.charPreviewTimer = window.setTimeout(hideCharacterPreview, 120);
}

function ensureCharacterPreview() {
  let preview = $("#charPreview");
  if (!preview) {
    preview = document.createElement("aside");
    preview.id = "charPreview";
    preview.className = "char-preview";
    preview.hidden = true;
    document.body.appendChild(preview);
  }
  return preview;
}

function hideCharacterPreview() {
  clearTimeout(state.charPreviewTimer);
  const preview = $("#charPreview");
  if (preview) {
    preview.hidden = true;
  }
}

async function cachedCharacterDetail(char) {
  if (state.charPreviewCache.has(char)) {
    return state.charPreviewCache.get(char);
  }
  const detail = await fetchJSON(`/api/v1/characters/${encodeURIComponent(char)}/`);
  state.charPreviewCache.set(char, detail);
  return detail;
}

function renderCharacterPreview(detail) {
  const char = detail.character || {};
  const variants = compactVariantText(detail);
  const readings = displayLangs
    .map((lang) => {
      const values = displayReadingsFor(detail, lang)
        .slice(0, 3)
        .map((item) => item.value);
      return values.length
        ? `<span class="preview-reading ${lang}">${escapeHTML(formatLang(lang))} ${escapeHTML(values.join(" / "))}</span>`
        : "";
    })
    .filter(Boolean)
    .join("");
  return `
    <div class="char-preview-head">
      <strong>${escapeHTML(char.char)}</strong>
      <span>${escapeHTML(char.codepoint || "")}</span>
    </div>
    <p>${escapeHTML(char.definition || "뜻 정보 없음")}</p>
    ${variants ? `<div class="preview-variants">${escapeHTML(variants)}</div>` : ""}
    <div class="preview-readings">${readings}</div>
  `;
}

function positionCharacterPreview(preview, target) {
  const rect = target.getBoundingClientRect();
  const width = 280;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const top = rect.top > 170 ? rect.top - 14 : rect.bottom + 14;
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
  preview.classList.toggle("below", rect.top <= 170);
}

function renderError(error) {
  $("#sourceSummaryBadge").textContent = "error";
  $("#sourceSummary").innerHTML = `<div class="empty error">${escapeHTML(error.message)}</div>`;
}

function firstNetworkChar(network) {
  for (const group of network.target_groups || []) {
    const char = group.characters?.[0]?.character?.char;
    if (char) {
      return char;
    }
  }
  return "";
}

function preferredSourceReading(detail, lang) {
  const readings = preferredReadingsFor(detail, lang);
  return readings[0]?.reading || "";
}

function preferredReadingsFor(detail, lang) {
  const readings = (detail.readings || []).filter((reading) => reading.lang === lang);
  const order = preferredSystems[lang] || [];
  const seen = new Set();
  const out = [];
  for (const system of order) {
    for (const reading of readings) {
      const key = `${reading.system}\u0000${reading.reading}`;
      if (reading.system === system && !seen.has(key)) {
        seen.add(key);
        out.push(reading);
      }
    }
  }
  return out;
}

function displayReadingsFor(detail, lang) {
  const readings = preferredReadingsFor(detail, lang);
  if (lang === "zh") {
    const pinyinReadings = readings.filter((reading) =>
      ["pinyin", "hanyu_pinyin", "pinyin_numbered"].includes(reading.system),
    );
    return compactReadingValues(
      "zh",
      pinyinReadings.map((reading) => reading.reading),
      "",
    ).map((value) => ({
      value,
      label: "병음",
    }));
  }
  if (lang === "yue") {
    return compactReadingValues(
      "yue",
      readings.map((reading) => reading.reading),
      "",
    ).map((value) => ({
      value,
      label: "월병",
    }));
  }
  if (lang !== "ja") {
    const seen = new Set();
    const displayReadings =
      lang === "ko" && readings.some((reading) => containsHangulText(reading.reading))
        ? readings.filter((reading) => containsHangulText(reading.reading))
        : readings;
    return displayReadings
      .filter((reading) => {
        const key = `${reading.system}\u0000${reading.reading}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((reading) => ({
        value: reading.reading,
        label: formatSystem(reading.system),
      }));
  }
  const groups = new Map();
  for (const reading of readings) {
    const key = canonicalJapaneseKey(reading.reading);
    if (!groups.has(key)) {
      groups.set(key, {
        kana: [],
        romaji: [],
      });
    }
    const group = groups.get(key);
    const bucket = containsKanaText(reading.reading) ? group.kana : group.romaji;
    if (!bucket.includes(reading.reading)) {
      bucket.push(reading.reading);
    }
  }
  return [...groups.entries()].map(([key, group]) => ({
    value: japaneseReadingValues(key, [...group.kana, ...group.romaji]).slice(0, 4).join(" / "),
    label: "음독",
  }));
}

function compactReadingList(readings, lang) {
  const order = lang ? preferredSystems[lang] || [] : [];
  const filtered = order.length
    ? readings.filter((reading) => order.includes(reading.system))
    : readings;
  return compactReadingValues(lang, filtered.map((reading) => reading.reading), "").slice(0, 3).join("/");
}

function compactReadings(readings) {
  return displayLangs
    .map((lang) => {
      const values = readings
        .filter((reading) => reading.lang === lang)
        .filter((reading) => (preferredSystems[lang] || []).includes(reading.system))
        .map((reading) => reading.reading);
      const unique = compactReadingValues(lang, values, "").slice(0, 3);
      return unique.length ? `${formatLang(lang)} ${unique.join("/")}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

function japaneseReadingValues(key, readings) {
  const values = [];
  const seen = new Set();
  for (const reading of readings || []) {
    if (!reading || seen.has(reading)) {
      continue;
    }
    seen.add(reading);
    values.push(reading);
  }
  const kana = values.filter((value) => containsKanaText(value));
  const romaji = values.filter((value) => !containsKanaText(value));
  const canonical =
    key ||
    romaji.map((value) => canonicalJapaneseKey(value)).find(Boolean) ||
    kana.map((value) => canonicalJapaneseKey(value)).find(Boolean) ||
    "";
  const out = [];
  const add = (value) => {
    if (value && !out.includes(value)) {
      out.push(value);
    }
  };
  kana.forEach(add);
  if (!kana.length) {
    add(romajiToKatakana(canonical));
  }
  romaji.forEach(add);
  if (!romaji.length) {
    add(canonical);
  }
  return out;
}

function compactReadingValues(lang, readings, fallbackKey) {
  if (lang === "zh") {
    return compactChineseReadingValues(readings, fallbackKey);
  }
  if (lang === "yue") {
    return compactCantoneseReadingValues(readings, fallbackKey);
  }
  if (lang === "ko") {
    const values = [...new Set((readings || []).filter(Boolean))];
    const hangul = values.filter((value) => containsHangulText(value));
    return hangul.length ? hangul : values;
  }
  if (lang !== "ja") {
    return [...new Set((readings || []).filter(Boolean))];
  }
  const groups = new Map();
  for (const reading of readings || []) {
    const key = canonicalJapaneseKey(reading);
    if (!groups.has(key)) {
      groups.set(key, {
        kana: [],
        romaji: [],
      });
    }
    const group = groups.get(key);
    const bucket = containsKanaText(reading) ? group.kana : group.romaji;
    if (!bucket.includes(reading)) {
      bucket.push(reading);
    }
  }
  if (!groups.size && fallbackKey) {
    groups.set(canonicalJapaneseKey(fallbackKey), {
      kana: [],
      romaji: [fallbackKey],
    });
  }
  return [...groups.values()].flatMap((group) => [...group.kana, ...group.romaji].slice(0, 2));
}

function lightReadingKeyForLang(lang, value) {
  if (lang === "zh") {
    return parsePinyin(value).base || String(value || "").trim().toLowerCase();
  }
  if (lang === "yue") {
    const text = String(value || "").trim().toLowerCase().replace(/[\s·.\-_/']/gu, "");
    return text.replace(/[1-6]$/u, "");
  }
  if (lang === "ja") {
    return canonicalJapaneseKey(value);
  }
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s·.\-_/']/gu, "");
}

function compactChineseReadingValues(readings, fallbackKey) {
  const groups = new Map();
  for (const reading of readings || []) {
    const parsed = parsePinyin(reading);
    const base = parsed.base || fallbackKey || reading;
    if (!groups.has(base)) {
      groups.set(base, new Set());
    }
    if (parsed.tone) {
      groups.get(base).add(parsed.tone);
    }
  }
  if (!groups.size && fallbackKey) {
    groups.set(fallbackKey, new Set());
  }
  return [...groups.entries()].map(([base, tones]) => {
    const sorted = [...tones].sort();
    return sorted.length ? `${base}${sorted.map(toneMark).join("")}` : base;
  });
}

function compactCantoneseReadingValues(readings, fallbackKey) {
  const groups = new Map();
  for (const reading of readings || []) {
    const text = String(reading || "").trim().toLowerCase().replace(/[\s·.\-_/']/gu, "");
    const match = text.match(/([1-6])$/u);
    const tone = match?.[1] || "";
    const base = tone ? text.slice(0, -1) : text || fallbackKey || reading;
    if (!groups.has(base)) {
      groups.set(base, new Set());
    }
    if (tone) {
      groups.get(base).add(tone);
    }
  }
  if (!groups.size && fallbackKey) {
    groups.set(fallbackKey, new Set());
  }
  return [...groups.entries()].map(([base, tones]) => {
    const sorted = [...tones].sort();
    return sorted.length ? `${base}${sorted.map(toneMark).join("")}` : base;
  });
}

function parsePinyin(value) {
  let text = String(value || "").trim().toLowerCase();
  const numbered = text.match(/([1-5])$/);
  let tone = numbered?.[1] || "";
  if (numbered) {
    text = text.slice(0, -1);
  }
  const toneMarks = {
    ā: ["a", "1"], á: ["a", "2"], ǎ: ["a", "3"], à: ["a", "4"],
    ē: ["e", "1"], é: ["e", "2"], ě: ["e", "3"], è: ["e", "4"],
    ī: ["i", "1"], í: ["i", "2"], ǐ: ["i", "3"], ì: ["i", "4"],
    ō: ["o", "1"], ó: ["o", "2"], ǒ: ["o", "3"], ò: ["o", "4"],
    ū: ["u", "1"], ú: ["u", "2"], ǔ: ["u", "3"], ù: ["u", "4"],
    ǖ: ["v", "1"], ǘ: ["v", "2"], ǚ: ["v", "3"], ǜ: ["v", "4"],
    ü: ["v", ""],
  };
  let base = "";
  for (const char of text.normalize("NFC")) {
    const mapped = toneMarks[char];
    if (mapped) {
      base += mapped[0];
      tone ||= mapped[1];
      continue;
    }
    if (/[\s·.\-_/']/u.test(char)) {
      continue;
    }
    base += char === "ü" ? "v" : char;
  }
  return { base, tone };
}

function toneMark(tone) {
  return { 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶" }[tone] || "";
}

function canonicalJapaneseKey(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[ \t\n\r·.\-_/']/g, "");
  return containsKanaText(cleaned) ? kanaToRomaji(cleaned) : normalizeJapaneseRomaji(cleaned);
}

function normalizeJapaneseRomaji(value) {
  return String(value || "")
    .replaceAll("shy", "sh")
    .replaceAll("chy", "ch")
    .replace(/(^|[^cs])hu/gu, "$1fu");
}

function romajiToKatakana(value) {
  let text = canonicalJapaneseKey(value);
  if (!/^[a-z]+$/u.test(text)) {
    return "";
  }
  const pairs = [
    ["kya", "キャ"], ["kyu", "キュ"], ["kyo", "キョ"],
    ["gya", "ギャ"], ["gyu", "ギュ"], ["gyo", "ギョ"],
    ["shya", "シャ"], ["shyu", "シュ"], ["shyo", "ショ"],
    ["sha", "シャ"], ["shu", "シュ"], ["sho", "ショ"],
    ["chya", "チャ"], ["chyu", "チュ"], ["chyo", "チョ"],
    ["cha", "チャ"], ["chu", "チュ"], ["cho", "チョ"],
    ["ja", "ジャ"], ["ju", "ジュ"], ["jo", "ジョ"],
    ["nya", "ニャ"], ["nyu", "ニュ"], ["nyo", "ニョ"],
    ["hya", "ヒャ"], ["hyu", "ヒュ"], ["hyo", "ヒョ"],
    ["bya", "ビャ"], ["byu", "ビュ"], ["byo", "ビョ"],
    ["pya", "ピャ"], ["pyu", "ピュ"], ["pyo", "ピョ"],
    ["mya", "ミャ"], ["myu", "ミュ"], ["myo", "ミョ"],
    ["rya", "リャ"], ["ryu", "リュ"], ["ryo", "リョ"],
    ["shi", "シ"], ["chi", "チ"], ["tsu", "ツ"], ["fu", "フ"],
    ["si", "シ"], ["ti", "チ"], ["tu", "ツ"], ["hu", "フ"],
    ["ka", "カ"], ["ki", "キ"], ["ku", "ク"], ["ke", "ケ"], ["ko", "コ"],
    ["ga", "ガ"], ["gi", "ギ"], ["gu", "グ"], ["ge", "ゲ"], ["go", "ゴ"],
    ["sa", "サ"], ["su", "ス"], ["se", "セ"], ["so", "ソ"],
    ["za", "ザ"], ["ji", "ジ"], ["zu", "ズ"], ["ze", "ゼ"], ["zo", "ゾ"],
    ["ta", "タ"], ["te", "テ"], ["to", "ト"],
    ["da", "ダ"], ["de", "デ"], ["do", "ド"],
    ["na", "ナ"], ["ni", "ニ"], ["nu", "ヌ"], ["ne", "ネ"], ["no", "ノ"],
    ["ha", "ハ"], ["hi", "ヒ"], ["he", "ヘ"], ["ho", "ホ"],
    ["ba", "バ"], ["bi", "ビ"], ["bu", "ブ"], ["be", "ベ"], ["bo", "ボ"],
    ["pa", "パ"], ["pi", "ピ"], ["pu", "プ"], ["pe", "ペ"], ["po", "ポ"],
    ["ma", "マ"], ["mi", "ミ"], ["mu", "ム"], ["me", "メ"], ["mo", "モ"],
    ["ya", "ヤ"], ["yu", "ユ"], ["yo", "ヨ"],
    ["ra", "ラ"], ["ri", "リ"], ["ru", "ル"], ["re", "レ"], ["ro", "ロ"],
    ["wa", "ワ"], ["wo", "ヲ"],
    ["a", "ア"], ["i", "イ"], ["u", "ウ"], ["e", "エ"], ["o", "オ"],
  ];
  let out = "";
  while (text) {
    if (text[0] === "n" && (!text[1] || !/[aeiouy]/u.test(text[1]))) {
      out += "ン";
      text = text.slice(1);
      continue;
    }
    const pair = pairs.find(([romaji]) => text.startsWith(romaji));
    if (!pair) {
      return "";
    }
    out += pair[1];
    text = text.slice(pair[0].length);
  }
  return out;
}

function containsKanaText(value) {
  return /[\u3040-\u309f\u30a0-\u30ff]/u.test(String(value || ""));
}

function containsHangulText(value) {
  return /[\uac00-\ud7a3]/u.test(String(value || ""));
}

function kanaToRomaji(value) {
  const chars = [...String(value || "")].map(katakanaToHiragana);
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (char === "っ") {
      const next = kanaSyllable(chars[i + 1] || "");
      if (next) {
        out += next[0];
      }
      continue;
    }
    if (char === "ー") {
      continue;
    }
    const combo = kanaDigraph(char, chars[i + 1] || "");
    if (combo) {
      out += combo;
      i += 1;
      continue;
    }
    out += kanaSyllable(char) || char;
  }
  return out;
}

function katakanaToHiragana(char) {
  const code = char.codePointAt(0);
  if (code >= 0x30a1 && code <= 0x30f6) {
    return String.fromCodePoint(code - 0x60);
  }
  return char;
}

function kanaDigraph(first, second) {
  const forms = {
    き: ["kya", "kyu", "kyo"],
    ぎ: ["gya", "gyu", "gyo"],
    し: ["sha", "shu", "sho"],
    じ: ["ja", "ju", "jo"],
    ち: ["cha", "chu", "cho"],
    ぢ: ["ja", "ju", "jo"],
    に: ["nya", "nyu", "nyo"],
    ひ: ["hya", "hyu", "hyo"],
    び: ["bya", "byu", "byo"],
    ぴ: ["pya", "pyu", "pyo"],
    み: ["mya", "myu", "myo"],
    り: ["rya", "ryu", "ryo"],
  }[first];
  const index = { ゃ: 0, ゅ: 1, ょ: 2 }[second];
  return forms && index !== undefined ? forms[index] : "";
}

function kanaSyllable(char) {
  return {
    あ: "a", い: "i", う: "u", え: "e", お: "o",
    か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
    さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
    た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
    な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
    は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
    ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
    や: "ya", ゆ: "yu", よ: "yo",
    ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
    わ: "wa", ゐ: "wi", ゑ: "we", を: "wo", ん: "n",
    が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
    ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
    だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
    ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
    ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
    ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  }[char] || "";
}

function containsHan(value) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}

function hanSearchTokens(value) {
  const seen = new Set();
  const out = [];
  for (const char of String(value || "")) {
    if (!containsHan(char)) {
      continue;
    }
    if (!seen.has(char)) {
      seen.add(char);
      out.push(char);
    }
  }
  return out;
}

function studyInputUnits(value) {
  const hanTokens = hanSearchTokens(value);
  if (hanTokens.length) {
    return hanTokens.map((char) => ({ type: "char", char, label: char }));
  }
  const seen = new Set();
  const out = [];
  for (const token of String(value || "").trim().split(/\s+/u)) {
    const reading = token.trim();
    if (!reading || seen.has(reading)) {
      continue;
    }
    seen.add(reading);
    out.push({ type: "reading", reading, label: reading });
  }
  return out.length > 1 ? out : [];
}

function formatSystem(system) {
  return systemLabels[system] || system;
}

function formatLang(lang) {
  return langLabels[lang] || lang;
}

function formatTag(tag) {
  const region = tag.region ? `${tag.region} ` : "";
  return `${region}${tag.system}:${tag.tag_type} ${tag.tag_value}`;
}

function resolveAPIBase() {
  const explicit =
    window.UMYINON_API_BASE ||
    document.querySelector('meta[name="umyinon-api-base"]')?.content ||
    "";
  if (explicit.trim()) {
    return explicit.trim().replace(/\/+$/u, "");
  }
  if (window.location.protocol === "file:") {
    return defaultPublicAPIBase;
  }
  const host = window.location.hostname;
  const localHosts = new Set(["", "localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (!localHosts.has(host) && !backendHostnames.has(host)) {
    return defaultPublicAPIBase;
  }
  return "";
}

function apiURL(url) {
  if (/^https?:\/\//iu.test(url)) {
    return url;
  }
  if (!apiBase) {
    return url;
  }
  return `${apiBase}${url.startsWith("/") ? url : `/${url}`}`;
}

async function fetchJSON(url) {
  const response = await fetch(apiURL(url), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
