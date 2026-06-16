(function () {
  function getCodeLineCount(code) {
    return Math.max(1, String(code || "").split("\n").length);
  }

  function shouldRecordDraftHistory(options) {
    const code = String(options.code || "");
    const previous = options.previous || null;
    const lastCode = String(options.lastCode || "");
    const now = Number(options.now) || Date.now();
    const lastSavedAt = Number(options.lastSavedAt) || 0;
    const minInterval = Number(options.minInterval) || 15000;

    if (!code.trim() || code === lastCode || (previous && previous.code === code)) {
      return false;
    }

    if (!previous) {
      return true;
    }

    const previousLineCount = getCodeLineCount(previous.code);
    const currentLineCount = getCodeLineCount(code);
    const lineDelta = Math.abs(currentLineCount - previousLineCount);
    const charDelta = Math.abs(code.length - String(previous.code || "").length);

    return now - lastSavedAt >= minInterval ||
      lineDelta >= 2 ||
      charDelta >= 80;
  }

  function normalizeDraftHistory(history, limit) {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .filter((entry) => entry && typeof entry.code === "string" && entry.code.trim())
      .map((entry) => ({
        code: entry.code,
        label: entry.label || "自动保存",
        selectionStart: Number(entry.selectionStart) || 0,
        selectionEnd: Number(entry.selectionEnd) || 0,
        scrollTop: Number(entry.scrollTop) || 0,
        lineCount: Number(entry.lineCount) || getCodeLineCount(entry.code),
        charCount: Number(entry.charCount) || entry.code.length,
        savedAt: Number(entry.savedAt) || Date.now()
      }))
      .slice(0, limit);
  }

  function dedupeAndLimitDraftHistory(history, limit) {
    return history
      .filter((entry, index, list) => list.findIndex((candidate) => candidate.code === entry.code) === index)
      .slice(0, limit);
  }

  function formatDraftHistoryLabel(entry) {
    const time = new Date(entry.savedAt || Date.now()).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    return time + " · " + (entry.lineCount || getCodeLineCount(entry.code)) + " 行 · " + (entry.label || "自动保存");
  }

  window.CodingAssistantDraftHistory = {
    dedupeAndLimit: dedupeAndLimitDraftHistory,
    formatLabel: formatDraftHistoryLabel,
    getCodeLineCount,
    normalize: normalizeDraftHistory,
    shouldRecord: shouldRecordDraftHistory
  };
})();
