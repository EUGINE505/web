/**
 * CGAuth client — posts through same-origin proxy (/api/cgauth) to avoid CORS.
 * Run `npm start` and open http://localhost:5173/login.html (not file://).
 */
class CGAuth {
  static API_URL = "https://cgauth.com/api/v1/";

  /** Same-origin path handled by server.js (or your host’s reverse proxy) */
  static PROXY_PATH = "/api/cgauth";

  static YOUR_APP_NAME = "EUGINE";

  static API_KEY =
    "583b0aaa71002eb58abf9e814dd24059666ef4ca39853a56d82efe38beee895e";

  static API_SECRET =
    "47754ef22a840d628c04b82ef61b75248060d0a64b61e06248abf5f115f9c522";

  static getAuthEndpoint() {
    if (typeof window === "undefined") return CGAuth.API_URL;
    if (window.location.protocol === "file:") {
      return null;
    }
    return new URL(CGAuth.PROXY_PATH, window.location.origin).href;
  }

  static async postEncrypted(encrypted) {
    const url = CGAuth.getAuthEndpoint();
    if (!url) {
      throw new Error(
        "This page was opened as a file. Run `npm start` in the website folder and open http://localhost:5173/login.html"
      );
    }
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          api_key: CGAuth.API_KEY,
          payload: encrypted,
        }),
      });
    } catch (e) {
      const msg = e && e.message ? e.message : "Network error";
      throw new Error(
        msg.includes("fetch") || msg.includes("Failed")
          ? "Cannot reach login server. Run `npm start` in the website folder, then use http://localhost:5173/login.html"
          : msg
      );
    }
    const text = await response.text();
    const cleaned = (text || "").replace(/^\uFEFF/, "").trim();
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(cleaned);
    } catch {
      // Some proxies/upstreams can return form-urlencoded payloads.
      // Try to parse key=value pairs before treating it as invalid.
      if (cleaned.includes("=") && !cleaned.startsWith("<")) {
        const form = new URLSearchParams(cleaned);
        const parsed = Object.fromEntries(form.entries());
        if (Object.keys(parsed).length > 0) {
          jsonResponse = parsed;
        }
      }
      if (!jsonResponse) {
        if (cleaned.startsWith("<")) {
          throw new Error("Server returned HTML instead of auth data. Start the site with npm start and open localhost URL.");
        }
        throw new Error((cleaned && cleaned.slice(0, 200)) || "Invalid response from server");
      }
    }
    if (!response.ok) {
      throw new Error(
        jsonResponse.message || jsonResponse.error || "Request failed (" + response.status + ")"
      );
    }
    return jsonResponse;
  }

  static async generateRequestId() {
    const timestamp = Date.now().toString();
    const randomBytes = crypto.getRandomValues(new Uint8Array(16));
    const randomHex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const combined = timestamp + randomHex;
    const encoder = new TextEncoder();
    const data = encoder.encode(combined);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex.toLowerCase();
  }

  static async getHWID() {
    try {
      let hwid = "";
      hwid += navigator.userAgent;
      hwid += navigator.language;
      hwid += navigator.platform;
      hwid += screen.width + "x" + screen.height;
      hwid += screen.colorDepth;
      hwid += new Date().getTimezoneOffset();

      const canvas2d = document.createElement("canvas");
      const ctx = canvas2d.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillText("CGAuth", 2, 2);
      hwid += canvas2d.toDataURL();

      const canvasGl = document.createElement("canvas");
      const gl = canvasGl.getContext("webgl");
      if (gl) {
        hwid += gl.getParameter(gl.RENDERER);
        hwid += gl.getParameter(gl.VENDOR);
      }

      hwid = hwid.replace(/[\s\-_]/g, "").toUpperCase();
      const encoder = new TextEncoder();
      const data = encoder.encode(hwid);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      return hashHex.toUpperCase();
    } catch (error) {
      const fallback = navigator.userAgent + Date.now();
      const encoder = new TextEncoder();
      const data = encoder.encode(fallback);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      return hashHex.toUpperCase();
    }
  }

  static async encryptPayload(params) {
    const json = JSON.stringify(params);
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(CGAuth.API_SECRET);
    const keyHash = await crypto.subtle.digest("SHA-256", keyMaterial);
    const key = await crypto.subtle.importKey(
      "raw",
      keyHash,
      { name: "AES-CBC" },
      false,
      ["encrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const jsonData = encoder.encode(json);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv }, key, jsonData);
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  static async decryptPayload(encrypted) {
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 16);
    const ciphertext = combined.slice(16);
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(CGAuth.API_SECRET);
    const keyHash = await crypto.subtle.digest("SHA-256", keyMaterial);
    const key = await crypto.subtle.importKey(
      "raw",
      keyHash,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, ciphertext);
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  static async verifyHMAC(data, receivedHmac, requestId) {
    const combined = data + requestId;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(CGAuth.API_SECRET);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const messageData = encoder.encode(combined);
    const signature = await crypto.subtle.sign("HMAC", key, messageData);
    const hashArray = Array.from(new Uint8Array(signature));
    const computed = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return computed.toLowerCase() === receivedHmac.toLowerCase();
  }

  static async authUser(username, password, hwid) {
    try {
      const requestId = await CGAuth.generateRequestId();
      const params = {
        api_secret: CGAuth.API_SECRET,
        type: "user",
        key: username,
        password: password,
        hwid: hwid,
        request_id: requestId,
        timestamp: Math.floor(Date.now() / 1000).toString(),
      };
      const encrypted = await CGAuth.encryptPayload(params);
      const jsonResponse = await CGAuth.postEncrypted(encrypted);

      // Preferred secure envelope format from CGAuth:
      // { data: "<encrypted>", hmac: "<sig>", timestamp: <unix> }
      if (jsonResponse && jsonResponse.data && jsonResponse.hmac && jsonResponse.timestamp) {
        const encData = jsonResponse.data;
        const receivedHmac = jsonResponse.hmac;
        const timestamp = Number(jsonResponse.timestamp);
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 120) {
          throw new Error("Response expired");
        }
        if (!(await CGAuth.verifyHMAC(encData, receivedHmac, requestId))) {
          throw new Error("HMAC verification failed - possible replay attack");
        }
        const decrypted = await CGAuth.decryptPayload(encData);
        const result = JSON.parse(decrypted);
        if (result.request_id && result.request_id !== requestId) {
          throw new Error("Request ID mismatch - possible replay attack");
        }
        return result;
      }

      // Compatibility fallback:
      // Some deployments return already-parsed auth JSON directly.
      if (jsonResponse && typeof jsonResponse === "object") {
        return jsonResponse;
      }

      throw new Error("Invalid response structure");
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
