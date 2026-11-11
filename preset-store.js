(() => {
  "use strict";
  const SUPABASE_URL = "https://qxkepxwaaqkriqsgzcvf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_p6ZaNm7Kai_q6bdg5W-vnw_00HLwGJc";
  const ENDPOINT = SUPABASE_URL + "/functions/v1/preset-checkout";
  const buttons = [...document.querySelectorAll(".preset-buy-button")];
  const statuses = new Map(buttons.map(button => [button.dataset.productKey, button.closest(".preset-product-info")?.querySelector(".preset-button-message")]));
  const setStatus = (key, value) => { const node = statuses.get(key); if (node) node.textContent = value; };

  async function call(action, payload = {}) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The preset store is temporarily unavailable.");
    return result;
  }

  buttons.forEach(button => {
    button.disabled = true;
    button.textContent = "CHECKING...";
    button.addEventListener("click", async () => {
      const key = button.dataset.productKey;
      button.disabled = true;
      button.textContent = "OPENING CHECKOUT...";
      setStatus(key, "Preparing your secure Stripe checkout...");
      try {
        const result = await call("create-checkout-session", { product_key: key });
        if (!result.url || !result.url.startsWith("https://checkout.stripe.com/")) throw new Error("Stripe did not return a valid secure checkout link.");
        window.location.assign(result.url);
      } catch (error) {
        setStatus(key, error.message || "Checkout could not be started.");
        button.disabled = false;
        button.textContent = "TRY AGAIN";
      }
    });
  });

  call("catalog").then(result => {
    const available = new Set((result.products || []).filter(item => item.available).map(item => item.product_key));
    buttons.forEach(button => {
      const ready = available.has(button.dataset.productKey);
      button.disabled = !ready;
      button.textContent = ready ? "BUY NOW" : "COMING SOON";
      const flag = button.closest(".preset-product-info")?.querySelector(".preset-product-footer > span");
      if (flag) flag.textContent = ready ? "AVAILABLE NOW" : "FILE NOT UPLOADED";
      if (!ready) setStatus(button.dataset.productKey, "This pack will be available after its ZIP file is uploaded by the store owner.");
    });
  }).catch(error => {
    buttons.forEach(button => {
      button.disabled = true;
      button.textContent = "CHECKOUT SETUP";
      setStatus(button.dataset.productKey, error.message || "Checkout setup is not complete yet.");
    });
  });
})();
