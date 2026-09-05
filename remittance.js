(function () {
  "use strict";

  var STORAGE_UNLOCKED = "fc_remit_data_v1";
  var STORAGE_ATTEMPTS = "fc_remit_attempts_v1";
  var MAX_ATTEMPTS = 5;
  var LOCK_SECONDS = 30;

  var overlay = document.getElementById("remit-overlay");
  var openBtn = document.getElementById("remit-open-btn");
  var closeBtn = document.getElementById("remit-close");
  var form = document.getElementById("remit-form");
  var input = document.getElementById("remit-input");
  var submitBtn = document.getElementById("remit-submit");
  var errorEl = document.getElementById("remit-error");
  var gateEl = document.getElementById("remit-gate");
  var resultEl = document.getElementById("remit-result");
  var liveEl = document.getElementById("remit-live");

  if (!overlay || !openBtn || !form || !input || !window.crypto || !window.crypto.subtle) {
    if (openBtn) openBtn.disabled = true;
    return;
  }

  var lastFocused = null;
  var countdownTimer = null;

  function safeSessionGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSessionSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {}
  }

  function getAttemptsState() {
    var raw = safeSessionGet(STORAGE_ATTEMPTS);
    if (!raw) return { count: 0, lockUntil: 0 };
    try {
      var parsed = JSON.parse(raw);
      return { count: parsed.count || 0, lockUntil: parsed.lockUntil || 0 };
    } catch (e) {
      return { count: 0, lockUntil: 0 };
    }
  }

  function setAttemptsState(state) {
    safeSessionSet(STORAGE_ATTEMPTS, JSON.stringify(state));
  }

  function getUnlockedData() {
    var raw = safeSessionGet(STORAGE_UNLOCKED);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setUnlockedData(data) {
    safeSessionSet(STORAGE_UNLOCKED, JSON.stringify(data));
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function isValidRecord(data) {
    if (!data || typeof data !== "object") return false;
    var fields = ["bankName", "bankCode", "branchName", "accountName", "accountNumber"];
    for (var i = 0; i < fields.length; i++) {
      if (typeof data[fields[i]] !== "string" || data[fields[i]].trim() === "") return false;
    }
    if (!/^[0-9]{3,4}$/.test(data.bankCode)) return false;
    if (!/^[0-9]{6,16}$/.test(data.accountNumber)) return false;
    return true;
  }

  function announce(msg) {
    if (liveEl) liveEl.textContent = msg;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
    input.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  async function tryDecrypt(taxId) {
    var payload = window.FC_REMIT_CIPHER;
    if (!payload) return null;
    try {
      var enc = new TextEncoder();
      var keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(taxId),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
      );
      var key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: base64ToBytes(payload.salt),
          iterations: payload.iterations,
          hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
      var plainBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
        key,
        base64ToBytes(payload.cipher)
      );
      var data = JSON.parse(new TextDecoder().decode(plainBuf));
      return isValidRecord(data) ? data : null;
    } catch (e) {
      return null;
    }
  }

  function renderResult(data) {
    document.getElementById("remit-bankName").textContent = data.bankName;
    document.getElementById("remit-bankCode").textContent = data.bankCode;
    document.getElementById("remit-branchName").textContent = data.branchName;
    document.getElementById("remit-accountName").textContent = data.accountName;
    document.getElementById("remit-accountNumber").textContent = data.accountNumber;
    gateEl.hidden = true;
    resultEl.hidden = false;
  }

  function resetToGate() {
    gateEl.hidden = false;
    resultEl.hidden = true;
    showError("");
    input.value = "";
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function updateLockUI() {
    var state = getAttemptsState();
    var remaining = Math.ceil((state.lockUntil - Date.now()) / 1000);
    if (remaining > 0) {
      input.disabled = true;
      submitBtn.disabled = true;
      showError("嘗試次數過多，請於 " + remaining + " 秒後再試。");
      if (!countdownTimer) {
        countdownTimer = setInterval(function () {
          var left = Math.ceil((getAttemptsState().lockUntil - Date.now()) / 1000);
          if (left <= 0) {
            stopCountdown();
            input.disabled = false;
            submitBtn.disabled = false;
            showError("");
          } else {
            showError("嘗試次數過多，請於 " + left + " 秒後再試。");
          }
        }, 1000);
      }
      return true;
    }
    stopCountdown();
    input.disabled = false;
    submitBtn.disabled = false;
    return false;
  }

  function getFocusable() {
    var nodes = overlay.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(nodes, function (el) {
      return el.offsetParent !== null;
    });
  }

  function onKeydown(e) {
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === "Tab") {
      var focusable = getFocusable();
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function openModal() {
    lastFocused = document.activeElement;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    openBtn.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKeydown, true);

    var cached = getUnlockedData();
    if (cached && isValidRecord(cached)) {
      renderResult(cached);
      window.setTimeout(function () {
        closeBtn.focus();
      }, 0);
      return;
    }

    resetToGate();
    var locked = updateLockUI();
    window.setTimeout(function () {
      if (locked) {
        closeBtn.focus();
      } else {
        input.focus();
      }
    }, 0);
  }

  function closeModal() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    openBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKeydown, true);
    stopCountdown();
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(text);
      });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  overlay.addEventListener("mousedown", function (e) {
    if (e.target === overlay) closeModal();
  });

  input.addEventListener("input", function () {
    var digitsOnly = input.value.replace(/[^0-9]/g, "").slice(0, 8);
    if (digitsOnly !== input.value) input.value = digitsOnly;
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (updateLockUI()) return;

    var value = input.value.trim();
    if (!/^[0-9]{8}$/.test(value)) {
      showError("統一編號不正確，請確認後重新輸入。");
      input.value = "";
      input.focus();
      return;
    }

    submitBtn.disabled = true;
    tryDecrypt(value).then(function (data) {
      input.value = "";
      if (data) {
        submitBtn.disabled = false;
        setAttemptsState({ count: 0, lockUntil: 0 });
        setUnlockedData(data);
        renderResult(data);
        announce("驗證成功，已顯示匯款資訊。");
        window.setTimeout(function () {
          closeBtn.focus();
        }, 0);
        return;
      }

      var state = getAttemptsState();
      var nextCount = state.count + 1;
      if (nextCount >= MAX_ATTEMPTS) {
        setAttemptsState({ count: 0, lockUntil: Date.now() + LOCK_SECONDS * 1000 });
        submitBtn.disabled = false;
        updateLockUI();
      } else {
        setAttemptsState({ count: nextCount, lockUntil: 0 });
        submitBtn.disabled = false;
        showError("統一編號不正確，請確認後重新輸入。");
        input.focus();
      }
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".remit-copy"), function (btn) {
    btn.addEventListener("click", function () {
      var targetId = btn.getAttribute("data-copy-target");
      var el = targetId ? document.getElementById(targetId) : null;
      if (!el) return;
      var original = btn.textContent;
      copyText(el.textContent || "").then(function () {
        btn.textContent = "已複製";
        announce("已複製");
        window.setTimeout(function () {
          btn.textContent = original;
        }, 1500);
      });
    });
  });
})();
