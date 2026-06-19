// ============================================================
// MoneyIn — Receipt scanning (Google Gemini vision)
// ------------------------------------------------------------
// Calls the Gemini API directly from the browser. The API key
// is therefore visible in your site's network requests/source.
// See the warning in firebase-config.js before deploying publicly.
// ============================================================

import { GEMINI_API_KEY } from "./firebase-config.js";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

/** Reads a File/Blob and returns its base64 payload (no data URL prefix) and mime type. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:<mime>;base64,<data>
      const base64 = result.split(",")[1];
      resolve({ base64, mimeType: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

/** Lightly compresses an image client-side before sending it (keeps payload + tokens small). */
async function compressImage(file, maxDim = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  return new File([blob], "receipt.jpg", { type: "image/jpeg" });
}

const RECEIPT_PROMPT = `You are a receipt-parsing assistant. Look at this receipt image and extract a structured JSON object with this exact shape, and nothing else (no markdown fences, no commentary):

{
  "description": "short merchant or receipt description, max 40 chars",
  "date": "YYYY-MM-DD, your best guess, today if unreadable",
  "items": [
    { "name": "item name", "amount": 0.00 }
  ],
  "tax": 0.00,
  "total": 0.00
}

Rules:
- amount and total are numbers (not strings), in the receipt's currency, no symbol.
- "tax" is 0 if no separate tax/tip line exists.
- Each item amount should reflect its line total (price × quantity already multiplied).
- If the image is not a legible receipt, return {"error": "unreadable"} instead.
Return ONLY the JSON object.`;

/**
 * Scans a receipt image and returns parsed { description, date, items, tax, total }.
 * Throws an Error with a user-facing message on failure.
 */
export async function scanReceipt(file) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY") {
    throw new Error("Receipt scanning isn't configured yet. Add your Gemini API key in firebase-config.js.");
  }

  let compressed;
  try {
    compressed = await compressImage(file);
  } catch {
    compressed = file; // fall back to original if compression unsupported
  }

  const { base64, mimeType } = await fileToBase64(compressed);

  const body = {
    contents: [{
      parts: [
        { text: RECEIPT_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  };

  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("Couldn't reach the receipt scanner. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error("The receipt scanner couldn't process this image. Try a clearer photo, or add the expense manually.");
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("No items were found on this receipt. Try a clearer photo, or add the expense manually.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The receipt scanner returned an unreadable result. Try a clearer photo, or add the expense manually.");
  }

  if (parsed.error || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error("No items were found on this receipt. Try a clearer photo, or add the expense manually.");
  }

  return {
    description: (parsed.description || "Receipt").slice(0, 40),
    date: parsed.date || new Date().toISOString().slice(0, 10),
    items: parsed.items.map(i => ({
      name: String(i.name || "Item").slice(0, 60),
      amount: Number(i.amount) || 0
    })),
    tax: Number(parsed.tax) || 0,
    total: Number(parsed.total) || 0
  };
}
