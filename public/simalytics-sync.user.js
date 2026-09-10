// ==UserScript==
// @name         Simalytics Sync
// @namespace    simalytics
// @version      0.5.0
// @description  Čte data otevřené hry SimCompanies (sklad, cashflow, limitky na burze) a synchronizuje je do Simalytics. Žádné extra requesty na herní servery – jen čte odpovědi, které prohlížeč stejně dostal.
// @author       Simalytics
// @match        https://www.simcompanies.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      simalytics.vercel.app
// @connect      localhost
// ==/UserScript==

/**
 * Simalytics Sync – userscript pro Tampermonkey/Violentmonkey.
 *
 * Princip: hook na window.fetch + XMLHttpRequest v kontextu hry.
 * Když hra stáhne data skladu (odpověď už stejně máš v prohlížeči),
 * vytáhneme položky { id, quality, amount } a pošleme je do tvé
 * Simalytics instance → /api/import/sync (Bearer token).
 *
 * HERNÍ SERVERY NEJSOU VOLÁNY ANI JEDNOU – nulové riziko dle ofiko
 * pravidel API (jen GET, žádná automatizace vůči hře).
 *
 * Nastavení (menu Tampermonkey):
 *  – „Simalytics: nastavit URL“          – např. https://simalytics.vercel.app
 *  – „Simalytics: nastavit token“        – hodnota GAME_SYNC_SECRET
 *  – „Simalytics: sync teď“              – pošle poslední nasbíraný sklad
 *  – „Simalytics: debug režim zap/vyp“   – sleduje VŠECHNY /api/ odpovědi
 *  – „Simalytics: zkopírovat dump“       – zkopíruje/stáhne dump pro vývojáře
 *
 * Debug dump obsahuje: URL odpovědí + ukázky JSON + extrahované položky.
 * NIKDY neobsahuje přihlašovací údaje ani cookies – jen herní data
 * (položky, množství), která jsou stejně viditelná na obrazovce.
 */

(function () {
  "use strict";

  // ── Konfigurace (GM storage) ────────────────────────────────────
  const DEFAULT_ENDPOINT = "https://simalytics.vercel.app";
  let endpoint = GM_getValue("endpoint", DEFAULT_ENDPOINT);
  let token = GM_getValue("token", "");
  let debugMode = GM_getValue("debugMode", false);

  GM_registerMenuCommand("Simalytics: nastavit URL", () => {
    const v = prompt("URL Simalytics (bez lomítka na konci):", endpoint);
    if (v) {
      endpoint = v.replace(/\/+$/, "");
      GM_setValue("endpoint", endpoint);
      alert("Uloženo: " + endpoint);
    }
  });

  GM_registerMenuCommand("Simalytics: nastavit token", () => {
    const v = prompt("GAME_SYNC_SECRET (Bearer token):", token);
    if (v !== null) {
      token = v.trim();
      GM_setValue("token", token);
      alert(token ? "Token uložen." : "Token vymazán.");
    }
  });

  GM_registerMenuCommand("Simalytics: debug režim zap/vyp", () => {
    debugMode = !debugMode;
    GM_setValue("debugMode", debugMode);
    alert(
      debugMode
        ? "Debug režim ZAPNUTÝ – sleduji VŠECHNY /api/ odpovědi hry. " +
          "Otevři sklad, pak dej „Simalytics: zkopírovat dump“."
        : "Debug režim vypnutý."
    );
  });

  // ── Sběr dat ────────────────────────────────────────────────────
  // SKLAD: GET /api/v3/resources/{companyId}/ → šarže { id, amount, quality,
  // kind, cost } (kind = ID komodity).
  // CASHFLOW: GET /api/v2/companies/me/cashflow/recent/ → { data: [...] }
  // s reálnými cenami nákupů ('m') a maloobchodních prodejů ('s').
  // MARKET ORDERS: GET /api/v2/companies/me/market-orders/ → pole vlastních
  // nabídek na burze (limitní prodeje): { id, kind, quantity, quality,
  // price, posted, fees } (formát z dumpu 2026-09-10).
  const WAREHOUSE_URL_RE = /\/api\/v3\/resources\/\d+\/?$/i;
  const CASHFLOW_URL_RE = /\/api\/v2\/companies\/me\/cashflow\/recent\/?$/i;
  // Vlastní nabídky na burze (limitní prodeje) – stránka statistiky skladu.
  const MARKET_ORDERS_URL_RE = /\/api\/v2\/companies\/me\/market-orders\/?$/i;
  const CAPTURE_URL_RE = /(resources\/\d+|cashflow\/recent|market-orders)/i;
  // Minimální interval mezi pushi na stejný obsah (antispam).
  const PUSH_COOLDOWN_MS = 60_000;

  let lastEntriesJson = ""; // serializovaný poslední sklad
  let lastOrdersJson = ""; // serializované poslední limitky
  let lastWarehousePushAt = 0;
  let lastOrdersPushAt = 0;
  let pushTimer = null;
  let cashflowTimer = null;
  let ordersTimer = null;
  let lastPayloadsForDebug = [];
  let lastCashflowForDebug = [];
  let lastOrdersForDebug = [];

  // ── Ring buffer raw odpovědí (pro debug dump) ───────────────────
  // Vždy ukládáme zásahy dle CAPTURE_URL_RE; v debug režimu VŠECHNY
  // JSON odpovědi z /api/ – ať vidíme, který endpoint nese sklad.
  const MAX_SAMPLES = 30;
  const SAMPLE_TEXT_LIMIT = 6000; // znaků na jednu ukázku
  const rawSamples = [];

  function rememberSample(url, status, text) {
    if (!text) return;
    rawSamples.push({
      url: String(url).slice(0, 300),
      status,
      at: new Date().toISOString(),
      text: text.length > SAMPLE_TEXT_LIMIT
        ? text.slice(0, SAMPLE_TEXT_LIMIT) + "…[zkráceno]"
        : text,
    });
    if (rawSamples.length > MAX_SAMPLES) rawSamples.shift();
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** Sloučí šarže po (kind, quality) – u duplicit bereme větší amount. */
  function mergeEntries(raw) {
    const map = new Map();
    for (const e of raw) {
      const key = `${e.kind}#${e.quality}`;
      const prev = map.get(key);
      if (!prev || e.amount > prev.amount) {
        map.set(key, e);
      }
    }
    return [...map.values()];
  }

  /**
   * Přesný parser šarží skladu (dle reálného dumpu):
   * pole objektů s číselným kind (= ID komodity), amount, quality
   * a volitelným cost objektem. Pošleme šarže jako jsou – server si
   * sám spočítá unit_cost = Σ cost.* / amount (skutečná pořizovací cena).
   */
  function extractEntries(data) {
    if (!Array.isArray(data)) return [];

    const batches = [];
    for (const node of data) {
      if (!node || typeof node !== "object") continue;
      const kind = Number(node.kind);
      const amount = Number(node.amount);
      const quality = Number(node.quality ?? 0);

      // šarže skladu: malé kind (ID komodity < 200), velké id šarže
      if (
        !Number.isInteger(kind) ||
        kind <= 0 ||
        kind >= 200 ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !Number.isInteger(quality) ||
        quality < 0 ||
        quality > 7 ||
        typeof node.id !== "number" // id šarže je velké číslo
      ) {
        continue;
      }

      batches.push({
        id: node.id,
        kind,
        quality,
        amount,
        blocked: Boolean(node.blocked),
        cost: node.cost && typeof node.cost === "object" ? node.cost : null,
      });
    }
    return mergeEntries(batches);
  }

  // ── Push do Simalytics ──────────────────────────────────────────
  function postJson(body, label) {
    if (!token) {
      console.warn("[Simalytics] Chybí token – nastav v menu Tampermonkey.");
      return;
    }
    GM_xmlhttpRequest({
      method: "POST",
      url: `${endpoint}/api/import/sync`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: body,
      timeout: 15_000,
      onload: (res) => {
        try {
          const json = JSON.parse(res.responseText);
          console.info(`[Simalytics] ${label}:`, res.status, json);
        } catch {
          console.warn(`[Simalytics] ${label}: nečitelná odpověď`, res.status);
        }
      },
      onerror: () => console.error(`[Simalytics] ${label}: síťová chyba.`),
      ontimeout: () => console.error(`[Simalytics] ${label}: timeout.`),
    });
  }

  function pushCashflow(rows) {
    if (!rows || rows.length === 0) return;
    console.info(`[Simalytics] Sync cashflow: ${rows.length} transakcí → ${endpoint}`);
    postJson(JSON.stringify({ source: "cashflow", data: rows }), "Cashflow");
  }

  /**
   * Parser vlastních nabídek (dle reálného dumpu 2026-09-10):
   * pole objektů { id, kind, quantity, quality, price, posted, fees,
   * seller }. Posíláme jen položky s kladnou cenou/množstvím a malým
   * kind (ID komodity) – bez seller blobu (ten zůstává v auditu).
   */
  function extractOrders(data) {
    if (!Array.isArray(data)) return [];
    const orders = [];
    for (const o of data) {
      if (!o || typeof o !== "object") continue;
      const id = Number(o.id);
      const kind = Number(o.kind);
      const quality = Number(o.quality ?? 0);
      const quantity = Number(o.quantity);
      const price = Number(o.price);
      if (
        !Number.isFinite(id) || id <= 0 ||
        !Number.isInteger(kind) || kind <= 0 || kind >= 200 ||
        !Number.isInteger(quality) || quality < 0 || quality > 7 ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(price) || price <= 0 ||
        typeof o.posted !== "string"
      ) {
        continue;
      }
      orders.push({
        id,
        kind,
        quality,
        quantity,
        price,
        fees: Number.isFinite(Number(o.fees)) ? Number(o.fees) : null,
        posted: o.posted,
      });
    }
    return orders;
  }

  function pushOrders(orders) {
    // Prázdný snapshot posíláme taky – server tím smaže staré limitky
    // (zrušené/vyplacené nabídky) a uklidí hlídky alertů.
    const body = JSON.stringify({ source: "market_orders", orders });
    const signature = body;
    if (
      signature === lastOrdersJson &&
      Date.now() - lastOrdersPushAt < PUSH_COOLDOWN_MS
    ) {
      return;
    }
    console.info(
      `[Simalytics] Sync limitky: ${orders.length} nabídek → ${endpoint}`
    );
    postJson(body, "Limitky");
    lastOrdersJson = signature;
    lastOrdersPushAt = Date.now();
  }

  function pushToSimalytics(entries) {
    if (!entries || entries.length === 0) return;
    const body = JSON.stringify({ source: "warehouse", entries });
    const signature = body; // jednoduchá dedupe: stejný obsah = neposílat
    if (signature === lastEntriesJson && Date.now() - lastWarehousePushAt < PUSH_COOLDOWN_MS) {
      return;
    }

    console.info(
      `[Simalytics] Sync skladu: ${entries.length} položek → ${endpoint}`
    );
    postJson(body, "Sklad");
    lastEntriesJson = signature;
    lastWarehousePushAt = Date.now();
  }

  function schedulePush(entries) {
    lastPayloadsForDebug = entries;
    if (pushTimer) clearTimeout(pushTimer);
    // debounce – hra po otevření skladu často stahuje víc odpovědí;
    // 4 s dává cashflow (2 s) přednost, ať reconcile má čerstvé ceny
    pushTimer = setTimeout(() => pushToSimalytics(entries), 4_000);
  }

  function scheduleCashflow(rows) {
    lastCashflowForDebug = rows;
    if (cashflowTimer) clearTimeout(cashflowTimer);
    cashflowTimer = setTimeout(() => pushCashflow(rows), 2_000);
  }

  function scheduleOrders(orders) {
    lastOrdersForDebug = orders;
    if (ordersTimer) clearTimeout(ordersTimer);
    // 3 s – ať push stihne před skladem (reconcile potřebuje vědět,
    // kolik ks je na burze, ať je neúčtuje jako spotřebu)
    ordersTimer = setTimeout(() => pushOrders(orders), 3_000);
  }

  // ── Debug dump ──────────────────────────────────────────────────
  function buildDump() {
    const urls = [...new Set(rawSamples.map((s) => s.url))];
    return {
      generatedAt: new Date().toISOString(),
      scriptVersion: "0.5.0",
      debugMode,
      hasToken: Boolean(token),
      matchedUrlRe: String(CAPTURE_URL_RE),
      capturedUrls: urls,
      extracted: lastPayloadsForDebug,
      extractedCashflow: lastCashflowForDebug.slice(0, 20),
      extractedOrders: lastOrdersForDebug,
      rawSamples,
    };
  }

  function dumpFileName() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `simalytics-dump-${ts}.json`;
  }

  function downloadDump(dump) {
    const blob = new Blob([JSON.stringify(dump, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = dumpFileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1_000);
  }

  GM_registerMenuCommand("Simalytics: zkopírovat dump", () => {
    const dump = buildDump();
    const text = JSON.stringify(dump, null, 2);

    if (rawSamples.length === 0) {
      alert(
        "Zatím žádné zachycené odpovědi. Otevři ve hře sklad (Warehouse) " +
        "a chvíli počkej; případně zapni debug režim (sleduje VŠECHNY /api/ " +
        "odpovědi) a projdi pár obrazovek hry."
      );
      return;
    }

    // Zkus schránku; když prohlížeč nepustí, stáhni soubor
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(
          () =>
            alert(
              `Dump zkopírován do schránky (${text.length.toLocaleString("cs-CZ")} znaků, ` +
              `${rawSamples.length} ukázek). Vlož ho vývojáři Simalytics.`
            ),
          () => {
            downloadDump(dump);
            alert("Schránka nepřístupná – dump stažen jako JSON soubor.");
          }
        );
    } else {
      downloadDump(dump);
      alert("Dump stažen jako JSON soubor.");
    }

    console.info("[Simalytics] Dump:", dump);
  });

  // ── Menu: ruční akce ────────────────────────────────────────────
  GM_registerMenuCommand("Simalytics: sync teď", () => {
    if (lastPayloadsForDebug.length === 0) {
      alert(
        "Zatím žádná nasbíraná data. Otevři ve hře sklad (Warehouse) a zkus znovu."
      );
      return;
    }
    lastEntriesJson = ""; // vynuluj dedupe, ať jde vynutit
    pushToSimalytics(lastPayloadsForDebug);
  });

  GM_registerMenuCommand("Simalytics: debug dump", () => {
    console.group("[Simalytics] Nasbírané položky");
    console.table(lastPayloadsForDebug);
    console.groupEnd();
    console.info(
      "Plný dump (URL + ukázky JSON) přes menu: „Simalytics: zkopírovat dump“."
    );
  });

  // Debug okénko do stránky (pro reporting formátu odpovědí)
  window.__simalyticsDebug = () => buildDump();

  // ── Zpracování odpovědi (společné pro fetch i XHR) ──────────────
  function processResponse(url, status, text) {
    try {
      const urlStr = String(url);
      const isWarehouse = WAREHOUSE_URL_RE.test(urlStr);
      const isCashflow = CASHFLOW_URL_RE.test(urlStr);
      const isOrders = MARKET_ORDERS_URL_RE.test(urlStr);
      const isMatch = isWarehouse || isCashflow || isOrders;
      const looksApi = /\/api\//.test(urlStr);

      if (debugMode && looksApi && status >= 200 && status < 300) {
        rememberSample(url, status, text);
      } else if (isMatch && status >= 200 && status < 300) {
        rememberSample(url, status, text);
      }

      if (!isMatch || status < 200 || status >= 300) return;

      const data = tryParseJson(text);
      if (data === undefined) return; // odpověď není JSON – ignoruj

      if (isCashflow) {
        const rows = Array.isArray(data?.data) ? data.data : [];
        if (rows.length > 0) scheduleCashflow(rows);
        return;
      }

      if (isOrders) {
        const orders = extractOrders(data);
        if (orders.length > 0 || data.length === 0) {
          // data.length === 0 = žádné aktivní limitky – stejně pushni
          // (server uklidí staré záznamy)
          if (debugMode) {
            console.info(
              `[Simalytics] Extrahováno ${orders.length} nabídek z ${url}`
            );
          }
          scheduleOrders(orders);
        }
        return;
      }

      const entries = extractEntries(data);
      if (entries.length > 0) {
        if (debugMode) {
          console.info(
            `[Simalytics] Extrahováno ${entries.length} šarží z ${url}`
          );
        }
        schedulePush(entries);
      }
    } catch {
      // nikdy nesmíme rozbít hru
    }
  }

  // ── Hook: fetch ─────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      const shouldPeek =
        debugMode && /\/api\//.test(String(url))
          ? true
          : WAREHOUSE_URL_RE.test(String(url)) ||
            CASHFLOW_URL_RE.test(String(url)) ||
            MARKET_ORDERS_URL_RE.test(String(url));
      if (shouldPeek && res.ok) {
        // klon – původní odpověď musí zůstat čitelná pro hru
        res
          .clone()
          .text()
          .then((text) => processResponse(url, res.status, text))
          .catch(() => {
            /* čtení klonu selhalo – ignoruj */
          });
      }
    } catch {
      // nikdy nesmíme rozbít hru
    }
    return res;
  };

  // ── Hook: XMLHttpRequest ────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const xhrUrl = String(url ?? "");    const shouldWatch =
      debugMode && /\/api\//.test(xhrUrl)
        ? true
        : WAREHOUSE_URL_RE.test(xhrUrl) ||
          CASHFLOW_URL_RE.test(xhrUrl) ||
          MARKET_ORDERS_URL_RE.test(xhrUrl);

    if (shouldWatch) {
      this.addEventListener("load", function () {
        try {
          if (this.status >= 200 && this.status < 300) {
            processResponse(xhrUrl, this.status, this.responseText);
          }
        } catch {
          // ticho – hra nesmí pocítit žádnou změnu
        }
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };

  console.info(
    "[Simalytics Sync] Aktivní – nastav URL/token v menu Tampermonkey. " +
    "Pro ladění formátu: zapni debug režim, otevři sklad, dej „zkopírovat dump“."
  );
})();
