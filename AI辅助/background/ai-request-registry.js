const CodingAiRequestRegistry = (() => {
  const activeRequests = new Map();

  function create(requestId) {
    const cleanRequestId = String(requestId || "");
    const controller = cleanRequestId ? new AbortController() : null;

    if (!cleanRequestId) {
      return { requestId: "", controller: null, signal: null };
    }

    const previousController = activeRequests.get(cleanRequestId);
    if (previousController) {
      previousController.abort();
    }

    activeRequests.set(cleanRequestId, controller);

    return {
      requestId: cleanRequestId,
      controller,
      signal: controller.signal
    };
  }

  function cancel(requestId) {
    const cleanRequestId = String(requestId || "");
    const controller = cleanRequestId ? activeRequests.get(cleanRequestId) : null;

    if (!controller) {
      return false;
    }

    controller.abort();
    activeRequests.delete(cleanRequestId);
    return true;
  }

  function finish(requestId, controller) {
    const cleanRequestId = String(requestId || "");

    if (cleanRequestId && activeRequests.get(cleanRequestId) === controller) {
      activeRequests.delete(cleanRequestId);
    }
  }

  return {
    cancel,
    create,
    finish
  };
})();
