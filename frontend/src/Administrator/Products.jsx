// src/Administrator/Products.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
// import { supabase, logActivity } from "./supabase"; // Commented out - using GitHub storage only
import { getPerms } from "./permissions";
import { processPastedTableHTML } from "../utils/cleanTableHTML";
import { getAllProductsLive, getAllCategoriesLive, getAllTagsLive, getProductByIdLive, bustProductCache } from "../local-storage/supabaseReader";
import { createProduct, editProduct, deleteProduct } from "./lib/cmsHelper";
import { uploadImage, uploadPdf, fetchCurrentProducts, rewriteProductsJson } from "./lib/githubStorage";

const FRONT_URL = process.env.REACT_APP_FRONT_URL || "";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function localOrRemote(product, field) {
  return product?.[`local_${field}`] || product?.[field] || null;
}

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function formsEqual(a, b) {
  for (const k of Object.keys(EMPTY_FORM)) {
    const av = a[k], bv = b[k];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else if (av !== bv) return false;
  }
  return true;
}

const EMPTY_FORM = {
  name: "", slug: "", short_description: "", description: "",
  thumbnail: "", images: [], spec_images: [], files: [],
  categories: [], tags: [], features: [],
  brand: "SAWO", type: "",
  status: "published",
  visible: true, featured: false, sort_order: 0,
};

// ─── Auto-extract tags from description HTML ──────────────────────────────────
function extractTagsFromDescription(html) {
  if (!html) return { kwTags: [], modelTags: [] };
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const kwTags    = new Set();
    const modelTags = new Set();

    const textContent = doc.body.textContent;

    const powerRangePattern = /(\d+(?:[.,]\d+)?)\s*(?:–|-|to)\s*(\d+(?:[.,]\d+)?)\s*k[wW]/gi;
    let match;
    while ((match = powerRangePattern.exec(textContent)) !== null) {
      const min = parseFloat(match[1].replace(",", "."));
      const max = parseFloat(match[2].replace(",", "."));
      if (!isNaN(min) && !isNaN(max) && min > 0 && max < 1000) {
        kwTags.add(`${min.toFixed(1)} – ${max.toFixed(1)} kW`);
      }
    }

    const singleKwPattern = /(\d+(?:[.,]\d+)?)\s*k[wW]\b/gi;
    while ((match = singleKwPattern.exec(textContent)) !== null) {
      const val = parseFloat(match[1].replace(",", "."));
      if (!isNaN(val) && val > 0 && val < 1000) {
        const formatted = `${val.toFixed(1)} kW`;
        if (![...kwTags].some(t => t.includes(formatted))) {
          kwTags.add(formatted);
        }
      }
    }

    const tables = doc.querySelectorAll("table");
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length < 2) continue;
      const headerRow = rows.find(r => r.querySelector("th")) || rows[0];
      const headers   = Array.from(headerRow.querySelectorAll("th, td"))
        .map(cell => cell.textContent.replace(/\s+/g, " ").trim().toLowerCase());
      const kwColIndex    = headers.findIndex(h => /\bkw\b/i.test(h) || /kilowatt/i.test(h));
      const modelColIndex = headers.findIndex(h => /model/i.test(h) || /heater\s*name/i.test(h));
      if (kwColIndex === -1) continue;
      const dataRows = rows.filter(r => r !== headerRow);
      for (const row of dataRows) {
        const cells = Array.from(row.querySelectorAll("td, th"));
        if (cells[kwColIndex]) {
          const raw = cells[kwColIndex].textContent.trim();
          const val = parseFloat(raw.replace(",", "."));
          if (!isNaN(val) && val > 0 && val < 1000) kwTags.add(`${val.toFixed(1)} kW`);
        }
        if (modelColIndex !== -1 && cells[modelColIndex]) {
          const model = cells[modelColIndex].textContent.trim();
          if (model && model.length > 2 && !/^\d+(\.\d+)?$/.test(model)) modelTags.add(model);
        }
      }
    }
    return {
      kwTags:    [...kwTags].sort((a, b) => parseFloat(a) - parseFloat(b)),
      modelTags: [...modelTags],
    };
  } catch (err) {
    console.warn("[extractTagsFromDescription] Parse error:", err);
    return { kwTags: [], modelTags: [] };
  }
}

function mergeAutoTags(existingTags, kwTags, modelTags) {
  const all = new Set([...existingTags, ...kwTags, ...modelTags]);
  return [...all];
}

// ─── WebP conversion + resize ─────────────────────────────────────────────────
const WEBP_QUALITY = 0.82;
const WEBP_MAX_DIM = 1800;

function convertToWebP(file, maxDim = WEBP_MAX_DIM, quality = WEBP_QUALITY) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round((height / width) * maxDim); width = maxDim; }
        else { width = Math.round((width / height) * maxDim); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("WebP conversion failed")),
        "image/webp", quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
    img.src = objectUrl;
  });
}

// ─── GitHub Upload Functions ──────────────────────────────────────────────────
async function fileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function uploadImageToGitHub(file, slug) {
  let blob, fileName;
  if (file.type.startsWith("image/")) {
    try {
      blob = await convertToWebP(file);
      fileName = `${slug}-${Date.now()}.webp`;
    } catch (err) {
      console.warn("WebP conversion failed, uploading original:", err);
      blob = file;
      fileName = `${slug}-${Date.now()}.${file.name.split(".").pop()}`;
    }
  } else {
    blob = file;
    fileName = `${slug}-${Date.now()}.${file.name.split(".").pop()}`;
  }
  const base64 = await fileToBase64(blob);
  return await uploadImage(fileName, base64);
}

async function uploadPdfToGitHub(file, slug) {
  const base64 = await fileToBase64(file);
  const fileName = `${slug}-${Date.now()}-${file.name}`;
  return await uploadPdf(fileName, base64);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = (message, type = "info") => {
    const id = Date.now();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  };
  const remove = id => setToasts(p => p.filter(t => t.id !== id));
  return { toasts, add, remove };
}

function Toast({ toasts, remove }) {
  const icons = { error: "fa-circle-xmark", success: "fa-circle-check", info: "fa-circle-info", warning: "fa-triangle-exclamation" };
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <i className={`fa-solid ${icons[t.type]}`} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
          <button className="toast-close" onClick={() => remove(t.id)}></button>
        </div>
      ))}
    </div>
  );
}

// ─── UI Primitives (same as before, truncated for brevity) ────────────────────
function Btn({ loading, label, onClick, type = "button", variant = "primary", icon, size, style: extra = {}, disabled }) {
  const cls = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : ""].filter(Boolean).join(" ");
  return (
    <button type={type} disabled={loading || disabled} onClick={onClick} className={cls} style={extra}>
      {loading
        ? <i className="fa-solid fa-spinner" style={{ animation: "spin 1s linear infinite" }} />
        : icon && <i className={`fa-solid ${icon}`} style={{ fontSize: "0.85em" }} />
      }
      {label}
    </button>
  );
}

function IconBtn({ icon, onClick, title, danger }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`icon-btn${danger ? " danger" : ""}`}>
      <i className={`fa-solid ${icon}`} />
    </button>
  );
}

function Modal({ open, onClose, title, children, wide, actions }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${wide ? " modal-wide" : ""}`} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          {actions && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              {actions}
            </div>
          )}
          <button className="modal-close-btn" onClick={onClose}></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Confirm({ open, onClose, onConfirm, title, message, confirmLabel = "Delete" }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="confirm-msg">{message}</p>
      <div className="confirm-actions">
        <Btn label="Cancel" variant="ghost" onClick={onClose} />
        <Btn label={confirmLabel} variant="danger" onClick={onConfirm} />
      </div>
    </Modal>
  );
}

function SectionLabel({ label }) {
  return <div className="section-label"><span>{label}</span></div>;
}

function Field({ label, type = "text", value, onChange, placeholder, required, helper, disabled }) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      {label && (
        <label className="form-label">
          {label}{required && <span style={{ color: "var(--danger)", marginLeft: 3 }}>*</span>}
        </label>
      )}
      <input
        type={type} value={value} onChange={onChange}
        placeholder={placeholder} required={required} disabled={disabled}
        className="form-input"
      />
      {helper && <p className="form-helper">{helper}</p>}
    </div>
  );
}

function RichField({ label, value, onChange, rows = 6, onNotify }) {
  const [mode, setMode] = useState("text");
  const textareaRef = useRef(null);
  const editorRef = useRef(null);

  const cleanPastedHTML = (html) => {
    const temp = document.createElement("div");
    temp.innerHTML = html;

    const comments = temp.querySelectorAll("*");
    comments.forEach(el => {
      if (el.nodeType === 8) el.remove();
    });

    const allElements = temp.querySelectorAll("*");
    allElements.forEach(el => {
      const allowedTags = ["P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "H1", "H2", "H3", "H4", "H5", "H6", "OL", "UL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SPAN"];

      if (!allowedTags.includes(el.tagName)) {
        const parent = el.parentNode;
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
      } else {
        const oldStyle = el.getAttribute("style") || "";
        const alignMatch = oldStyle.match(/text-align:\s*(left|center|right|justify)/);

        Array.from(el.attributes).forEach(attr => {
          el.removeAttribute(attr.name);
        });

        if (alignMatch) {
          el.setAttribute("style", `text-align: ${alignMatch[1]};`);
        }
      }
    });

    let result = temp.innerHTML;
    result = result.replace(/&nbsp;/g, " ");
    result = result.replace(/<!--.*?-->/g, "");

    return result;
  };

  const handlePaste = (e) => {
    if (!editorRef.current?.contains(e.target)) return;

    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!html && !text) return;

    e.preventDefault();

    let contentToInsert = html || text;

    if (/<table/i.test(contentToInsert)) {
      contentToInsert = processPastedTableHTML(contentToInsert);
      if (onNotify) onNotify("✓ Table cleaned and formatted! kW tags will be auto-extracted on Save.", "success");
    } else if (contentToInsert.includes("<")) {
      contentToInsert = cleanPastedHTML(contentToInsert);
    }

    document.execCommand("insertHTML", false, contentToInsert);

    setTimeout(() => {
      if (editorRef.current) {
        onChange({ target: { value: editorRef.current.innerHTML } });
        autoExpandEditor();
      }
    }, 0);
  };

  const execCommand = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  const handleEditorChange = () => {
    if (editorRef.current) {
      onChange({ target: { value: editorRef.current.innerHTML } });
      autoExpandEditor();
    }
  };

  const autoExpandEditor = () => {
    if (editorRef.current) {
      editorRef.current.style.height = "auto";
      const scrollHeight = editorRef.current.scrollHeight;
      editorRef.current.style.height = Math.max(150, scrollHeight + 4) + "px";
    }
  };

  const syncFromTextarea = () => {
    if (editorRef.current && textareaRef.current) {
      editorRef.current.innerHTML = textareaRef.current.value;
      setTimeout(autoExpandEditor, 0);
    }
  };

  const syncToTextarea = () => {
    if (textareaRef.current && editorRef.current) {
      textareaRef.current.value = editorRef.current.innerHTML;
    }
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <div className="rich-field-header">
        {label && <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>}
        <div className="rich-field-modes">
          {["text", "html"].map(m => (
            <button key={m} type="button" onClick={() => {
              if (mode === "html" && m === "text") syncToTextarea();
              if (mode === "text" && m === "html") syncFromTextarea();
              setMode(m);
            }}
              className={`rich-field-mode-btn${mode === m ? " active" : ""}`}>{m}</button>
          ))}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        value={value} onChange={onChange} rows={rows}
        onPaste={handlePaste}
        placeholder={mode === "html" ? "<p>Enter HTML here...</p>" : "Enter plain text description..."}
        className="form-textarea"
        style={{ fontFamily: mode === "html" ? "monospace" : "var(--font)", marginTop: 4, display: mode === "text" ? "block" : "none" }}
      />
      {mode === "html" && (
        <>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: 6 }}>
            💡 Paste WordPress tables directly — they'll auto-format! kW values &amp; model codes will be auto-tagged on Save.
          </div>
          <div className="rich-field-preview" style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
              <p className="rich-field-preview-label" style={{ margin: 0 }}>Editor</p>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                <button type="button" onClick={() => execCommand("bold")} title="Bold (Ctrl+B)" style={{ padding: "4px 8px", fontSize: "0.8rem", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", cursor: "pointer" }}>
                  <i className="fa-solid fa-bold" />
                </button>
                <button type="button" onClick={() => execCommand("italic")} title="Italic (Ctrl+I)" style={{ padding: "4px 8px", fontSize: "0.8rem", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", cursor: "pointer" }}>
                  <i className="fa-solid fa-italic" />
                </button>
                <button type="button" onClick={() => execCommand("underline")} title="Underline (Ctrl+U)" style={{ padding: "4px 8px", fontSize: "0.8rem", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", cursor: "pointer" }}>
                  <i className="fa-solid fa-underline" />
                </button>
              </div>
            </div>
            <div
              ref={editorRef}
              contentEditable
              onInput={handleEditorChange}
              onBlur={handleEditorChange}
              onPaste={handlePaste}
              dangerouslySetInnerHTML={{ __html: value }}
              style={{
                padding: 12,
                borderRadius: "var(--r)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                minHeight: 150,
                height: "auto",
                fontFamily: "var(--font)",
                fontSize: "0.95rem",
                lineHeight: 1.6,
                color: "var(--text)",
                outline: "none",
                overflowY: "auto",
                resize: "none",
                wordWrap: "break-word",
                whiteSpace: "pre-wrap",
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TagSuggestions({ name, description, features = [], currentTags, allTags, onAddTags }) {
  const suggestedTags = allTags.filter(tag => {
    if (currentTags.includes(tag)) return false;
    const nameLower = (name || "").toLowerCase();
    const descLower = (description || "").toLowerCase();
    const featuresText = (features || []).join(" ").toLowerCase();
    return new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(nameLower) ||
           new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(descLower) ||
           new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(featuresText);
  });

  if (!suggestedTags.length) return null;

  return (
    <div style={{
      background: "var(--surface-2)",
      border: "1px solid rgba(245,157,11,0.25)",
      borderRadius: "var(--r)", padding: "12px 14px",
      fontSize: "0.78rem", color: "var(--text-2)", lineHeight: 1.7, marginTop: 8, marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, fontWeight: 700, color: "var(--text)", fontSize: "0.8rem" }}>
        <i className="fa-solid fa-lightbulb" style={{ color: "#f59d0b" }} />
        Found matching keywords in your content
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
        {suggestedTags.map(t => (
          <span key={t} style={{
            fontSize: "0.72rem", fontWeight: 600,
            background: "rgba(245,157,11,0.1)",
            color: "#92400e",
            border: "1px solid rgba(245,157,11,0.3)",
            borderRadius: 4, padding: "3px 8px",
          }}>+ {t}</span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onAddTags(suggestedTags)}
        style={{
          background: "#f59d0b", color: "#fff", border: "none",
          padding: "6px 12px", borderRadius: 4, fontSize: "0.75rem",
          fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "#d97706"}
        onMouseLeave={e => e.currentTarget.style.background = "#f59d0b"}
      >
        <i className="fa-solid fa-check" style={{ marginRight: 4 }} />
        Add these tags
      </button>
    </div>
  );
}

function AutoTagPreview({ description, currentTags }) {
  const { kwTags, modelTags } = extractTagsFromDescription(description);
  const newKw    = kwTags.filter(t => !currentTags.includes(t));
  const newModel = modelTags.filter(t => !currentTags.includes(t));
  const hasNew   = newKw.length > 0 || newModel.length > 0;
  if (!description || (!hasNew && kwTags.length === 0)) return null;
  return (
    <div style={{
      background: "var(--surface-2)",
      border: "1px solid rgba(var(--brand-rgb, 99,102,241), 0.25)",
      borderRadius: "var(--r)", padding: "10px 14px",
      fontSize: "0.78rem", color: "var(--text-2)", lineHeight: 1.7, marginTop: -4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, fontWeight: 700, color: "var(--text)", fontSize: "0.8rem" }}>
        <i className="fa-solid fa-wand-magic-sparkles" style={{ color: "var(--brand)" }} />
        Auto-tags detected in description
        <span style={{ fontWeight: 400, color: "var(--text-3)", fontSize: "0.72rem" }}>— will be added on Save</span>
      </div>
      {kwTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: modelTags.length > 0 ? 6 : 0 }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-3)", marginRight: 2, alignSelf: "center" }}>kW:</span>
          {kwTags.map(t => (
            <span key={t} style={{
              fontSize: "0.72rem", fontWeight: 700,
              background: currentTags.includes(t) ? "var(--surface-3, #e5e7eb)" : "rgba(34,197,94,0.12)",
              color:      currentTags.includes(t) ? "var(--text-3)" : "#16a34a",
              border:     `1px solid ${currentTags.includes(t) ? "var(--border)" : "rgba(34,197,94,0.3)"}`,
              borderRadius: 4, padding: "2px 7px",
            }}>{currentTags.includes(t) ? "✓ " : "+ "}{t}</span>
          ))}
        </div>
      )}
      {modelTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-3)", marginRight: 2, alignSelf: "center" }}>Models:</span>
          {modelTags.map(t => (
            <span key={t} style={{
              fontSize: "0.72rem", fontWeight: 600,
              background: currentTags.includes(t) ? "var(--surface-3, #e5e7eb)" : "rgba(99,102,241,0.1)",
              color:      currentTags.includes(t) ? "var(--text-3)" : "var(--brand)",
              border:     `1px solid ${currentTags.includes(t) ? "var(--border)" : "rgba(99,102,241,0.25)"}`,
              borderRadius: 4, padding: "2px 7px",
            }}>{currentTags.includes(t) ? "✓ " : "+ "}{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options = [] }) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      {label && <label className="form-label">{label}</label>}
      <select value={value} onChange={onChange} className="form-select">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Toggle({ label, checked, onChange, helper }) {
  return (
    <div className="toggle-row">
      <div className={`toggle-track${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
        <div className="toggle-thumb" />
      </div>
      <div>
        {label && <div className="toggle-label">{label}</div>}
        {helper && <div className="toggle-helper">{helper}</div>}
      </div>
    </div>
  );
}

function PillInput({ label, value = [], onChange, placeholder, suggestions = [] }) {
  const [input, setInput]     = useState("");
  const [showSug, setShowSug] = useState(false);
  const filtered = suggestions.filter(s => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)).slice(0, 8);
  const add = v => { const t = v.trim(); if (!t || value.includes(t)) return; onChange([...value, t]); setInput(""); setShowSug(false); };
  const remove = i => onChange(value.filter((_, idx) => idx !== i));
  const handleKey = e => {
    if (e.key === "Enter")    { e.preventDefault(); add(input); }
    if (e.key === "Backspace" && !input && value.length) remove(value.length - 1);
    if (e.key === "Escape")   setShowSug(false);
  };
  const handlePaste = e => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!text.trim()) return;

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

    const bulletPattern = /^[»•\-*+]\s+/;
    const hasBullets = lines.some(l => bulletPattern.test(l));

    let newFeatures = [];
    if (hasBullets) {
      newFeatures = lines
        .map(l => l.replace(bulletPattern, "").trim())
        .filter(l => l && !value.includes(l));
    } else {
      newFeatures = lines.filter(l => l && !value.includes(l));
    }

    if (newFeatures.length > 0) {
      onChange([...value, ...newFeatures]);
      setInput("");
      setShowSug(false);
    }
  };
  return (
    <div className="form-group" style={{ marginBottom: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        {label && <label className="form-label" style={{ margin: 0 }}>{label}</label>}
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              fontSize: "0.75rem",
              padding: "4px 8px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              color: "var(--text-3)",
              cursor: "pointer",
              transition: "all 0.15s ease"
            }}
            onMouseEnter={e => { e.target.style.color = "var(--text)"; e.target.style.borderColor = "var(--text-3)"; }}
            onMouseLeave={e => { e.target.style.color = "var(--text-3)"; e.target.style.borderColor = "var(--border)"; }}
            title="Clear all items"
          >
            <i className="fa-solid fa-trash-can" style={{ marginRight: 4 }} />Clear
          </button>
        )}
      </div>
      <div className="pill-input-wrap" onClick={e => { e.currentTarget.querySelector("input")?.focus(); setShowSug(true); }}>
        {value.map((v, i) => (
          <span key={i} className="pill-item">
            {v}
            <button type="button" onClick={e => { e.stopPropagation(); remove(i); }}>
              <i className="fa-solid fa-xmark" />
            </button>
          </span>
        ))}
        <input
          value={input} onChange={e => { setInput(e.target.value); setShowSug(true); }}
          onKeyDown={handleKey} onFocus={() => setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 150)}
          onPaste={handlePaste}
          placeholder={value.length ? "" : (placeholder || "Type and press Enter...")}
          className="pill-input-field"
        />
      </div>
      {showSug && (filtered.length > 0 || input.trim()) && (
        <div className="pill-suggestions">
          {filtered.map((s, i) => (
            <div key={i} className="pill-suggestion-item" onMouseDown={() => add(s)}>{s}</div>
          ))}
          {input.trim() && !value.includes(input.trim()) && (
            <div className="pill-suggestion-item pill-suggestion-create" onMouseDown={() => add(input)}>
              <i className="fa-solid fa-plus" style={{ marginRight: 6 }} />Create "{input.trim()}"
            </div>
          )}
        </div>
      )}
      <p className="pill-hint">Press Enter to add items, Backspace to remove the last item, or paste formatted lists (» • - *)</p>
    </div>
  );
}

function ModelSelect({ label, value, onChange, placeholder, suggestions = [] }) {
  const [showSug, setShowSug] = useState(false);
  const inputRef = useRef();
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase())).slice(0, 8);

  return (
    <div className="form-group" style={{ marginBottom: 0, position: "relative" }}>
      {label && <label className="form-label">{label}</label>}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text" value={value} onChange={e => { onChange(e.target.value); setShowSug(true); }}
          onFocus={() => setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 150)}
          placeholder={placeholder || "Search or create new model"}
          className="form-input"
          autoComplete="off"
        />
        {showSug && filtered.length > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--r-sm)", zIndex: 10, maxHeight: 200, overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}>
            {filtered.map((model, i) => (
              <button
                key={i}
                type="button"
                onMouseDown={() => { onChange(model); setShowSug(false); }}
                style={{
                  width: "100%", padding: "10px 14px", textAlign: "left",
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: "0.85rem", color: "var(--text)", borderBottom: "1px solid var(--border)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <i className="fa-solid fa-folder-open" style={{ marginRight: 8, color: "var(--brand)", fontSize: "0.75rem" }} />
                {model}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="form-helper" style={{ fontSize: "0.75rem", color: "var(--text-3)", marginTop: 6 }}>
        Select an existing model or type a new one
      </p>
    </div>
  );
}

function SmartImageGallery({ images = [], onRemove, isSingle = false }) {
  if (!images.length) return null;

  if (isSingle && images.length === 1) {
    return (
      <div className="smart-image-single">
        <div className="smart-image-wrapper">
          <img src={images[0]} alt="" />
          {onRemove && (
            <button type="button" className="smart-image-remove" onClick={() => onRemove(0)}>
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isSingle && images.length <= 3) {
    return (
      <div className={`smart-image-grid grid-${images.length}`}>
        {images.map((url, i) => (
          <div key={i} className="smart-image-item">
            <img src={url} alt="" />
            {onRemove && (
              <button type="button" className="smart-image-remove" onClick={() => onRemove(i)}>
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="image-strip">
      {images.map((url, i) => (
        <div key={i} className="image-strip-item">
          <img src={url} alt="" />
          {onRemove && (
            <button type="button" className="image-strip-remove" onClick={() => onRemove(i)}>
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AddMoreImagesButton({ label, uploading, onChange }) {
  const [hovering, setHovering] = useState(false);
  const ref = useRef();
  const divRef = useRef();

  const handlePaste = e => {
    if (uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (let item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) { e.preventDefault(); onChange?.({ target: { files: files } }); }
  };

  return (
    <div
      ref={divRef}
      className={`add-more-label${uploading ? " uploading" : ""}`}
      onPaste={handlePaste}
      onMouseEnter={() => { setHovering(true); divRef.current?.focus(); }}
      onMouseLeave={() => setHovering(false)}
      onClick={() => !uploading && ref.current?.click()}
      tabIndex="0"
      contentEditable={hovering && !uploading}
      suppressContentEditableWarning
      style={{ outline: "none", cursor: uploading ? "default" : "pointer", position: "relative" }}
    >
      <i className="fa-solid fa-plus" />
      {uploading ? "Converting & uploading…" : label}
      {hovering && !uploading && <p style={{ fontSize: "0.65rem", color: "var(--brand)", margin: "4px 0 0", fontWeight: 600 }}>Hover to paste image • Ctrl+V</p>}
      <input ref={ref} type="file" accept="image/*" multiple style={{ display: "none" }} disabled={uploading}
        onChange={onChange} />
    </div>
  );
}

function AddMorePdfsButton({ label, uploading, onUploadFile, onAddUrl }) {
  const [hovering, setHovering] = useState(false);
  const ref = useRef();
  const divRef = useRef();

  const handlePaste = e => {
    if (uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let item of items) {
      if (item.kind === "file" && (item.type === "application/pdf" || item.type === "")) {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); onUploadFile?.(file); return; }
      }
    }
    const text = e.clipboardData.getData("text/plain")?.trim();
    if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
      e.preventDefault();
      onAddUrl?.(text);
    }
  };

  return (
    <div
      ref={divRef}
      className={`add-more-label${uploading ? " uploading" : ""}`}
      onPaste={handlePaste}
      onMouseEnter={() => { setHovering(true); divRef.current?.focus(); }}
      onMouseLeave={() => setHovering(false)}
      onClick={() => !uploading && ref.current?.click()}
      tabIndex="0"
      style={{ outline: "none", cursor: uploading ? "default" : "pointer", position: "relative" }}
    >
      <i className="fa-solid fa-plus" />
      {uploading ? "Converting & uploading…" : label}
      {hovering && !uploading && <p style={{ fontSize: "0.65rem", color: "var(--brand)", margin: "4px 0 0", fontWeight: 600 }}>Hover to paste PDF • Ctrl+V</p>}
      <input ref={ref} type="file" accept=".pdf,application/pdf" style={{ display: "none" }} disabled={uploading}
        onChange={e => { if (e.target.files?.[0]) onUploadFile?.(e.target.files[0]); }} />
    </div>
  );
}

function ImageUploader({ onUpload, label = "Upload Image", multiple = false, uploading = false }) {
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const ref    = useRef();
  const divRef = useRef();
  const handleFiles = files => { if (!files?.length) return; onUpload(multiple ? Array.from(files) : files[0]); };
  const handlePaste = e => {
    if (uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (let item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) { e.preventDefault(); handleFiles(files); }
  };
  return (
    <div
      ref={divRef}
      className={`img-upload-zone${dragging ? " dragging" : ""}${uploading ? " disabled" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      onPaste={handlePaste}
      onMouseEnter={() => { setHovering(true); divRef.current?.focus(); }}
      onMouseLeave={() => setHovering(false)}
      onClick={() => !uploading && ref.current?.click()}
      tabIndex="0" style={{ outline: "none" }}
    >
      <input ref={ref} type="file" accept="image/*" multiple={multiple} style={{ display: "none" }}
        onChange={e => handleFiles(multiple ? e.target.files : e.target.files[0])} />
      {uploading
        ? <>
            <i className="fa-solid fa-spinner" style={{ color: "var(--brand)", fontSize: "1.8rem", animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>Converting &amp; uploading…</span>
          </>
        : <>
            <div className="thumb-upload-icon">
              <i className={`fa-solid ${multiple ? "fa-images" : "fa-image"}`} />
            </div>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text)", margin: "0 0 4px" }}>{label}</p>
              <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: "0 0 6px" }}>Click to browse or drag &amp; drop · auto-converted to WebP</p>
              {hovering && <p style={{ fontSize: "0.65rem", color: "var(--brand)", margin: "4px 0 0", fontWeight: 600 }}>Hover to paste image • Ctrl+V</p>}
            </div>
          </>
      }
    </div>
  );
}

function ThumbnailPreview({ url, onRemove, onReplace, uploading }) {
  const [hovered, setHovered] = useState(false);
  const replaceRef = useRef();
  const containerRef = useRef();

  const handleFiles = files => {
    const file = files instanceof FileList ? files[0] : (Array.isArray(files) ? files[0] : files);
    if (file) onReplace(file);
  };

  const handlePaste = e => {
    if (uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); handleFiles(file); return; }
      }
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
      <div
        ref={containerRef}
        style={{ position: "relative", display: "inline-block", outline: "none", cursor: !uploading ? "pointer" : "default" }}
        onMouseEnter={() => { setHovered(true); containerRef.current?.focus(); }}
        onMouseLeave={() => { setHovered(false); }}
        onPaste={handlePaste}
        onClick={() => !uploading && replaceRef.current?.click()}
        tabIndex="0"
      >
        <img src={url} alt="Featured" style={{
          display: "block", maxHeight: 220, maxWidth: "100%",
          borderRadius: "var(--r)", objectFit: "contain",
          transition: "opacity 0.18s", opacity: uploading ? 0.5 : (hovered ? 0.8 : 1),
        }} />
        {hovered && !uploading && (
        <>
          <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove image" style={{
            position: "absolute", top: 8, right: 8,
            width: 28, height: 28, borderRadius: "50%",
            background: "rgba(0,0,0,0.65)", color: "#fff",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.8rem", zIndex: 10, backdropFilter: "blur(2px)",
            transition: "background 0.15s",
          }} onMouseEnter={e => e.target.style.background = "rgba(192,57,43,0.8)"} onMouseLeave={e => e.target.style.background = "rgba(0,0,0,0.65)"}>
            <i className="fa-solid fa-xmark" />
          </button>
          <div title="Click to browse or Ctrl+V to paste" style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            background: "rgba(0,0,0,0.7)", color: "#fff",
            padding: "8px 16px", borderRadius: 20, fontSize: "0.78rem",
            fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6, flexDirection: "column",
            backdropFilter: "blur(3px)", whiteSpace: "nowrap", zIndex: 10, userSelect: "none",
            pointerEvents: "none"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <i className="fa-solid fa-arrow-up-from-bracket" style={{ fontSize: "0.72rem" }} />
              Replace
            </div>
            <div style={{ fontSize: "0.65rem", opacity: 0.8, fontWeight: 400, marginTop: 2 }}>Click or Ctrl+V</div>
          </div>
        </>
        )}
        {uploading && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.6)", borderRadius: "var(--r)", gap: 6,
          }}>
            <i className="fa-solid fa-spinner" style={{ color: "var(--brand)", fontSize: "1.4rem", animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>Converting &amp; uploading…</span>
          </div>
        )}
        <input ref={replaceRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) { handleFiles(e.target.files[0]); e.target.value = ""; } }} />
      </div>
    </div>
  );
}

function ThumbnailUploader({ onUpload, uploading }) {
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const ref    = useRef();
  const divRef = useRef();
  const handleFiles = files => {
    const file = files instanceof FileList ? files[0] : (Array.isArray(files) ? files[0] : files);
    if (file) onUpload(file);
  };
  const handlePaste = e => {
    if (uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); handleFiles(file); return; }
      }
    }
  };
  return (
    <div ref={divRef}
      className={`thumb-upload-zone${dragging ? " dragging" : ""}${uploading ? " disabled" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      onPaste={handlePaste}
      onMouseEnter={() => { setHovering(true); divRef.current?.focus(); }}
      onMouseLeave={() => setHovering(false)}
      onClick={() => !uploading && ref.current?.click()}
      tabIndex="0" style={{ outline: "none" }}
    >
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handleFiles(e.target.files[0]); e.target.value = ""; } }} />
      {uploading ? (
        <>
          <i className="fa-solid fa-spinner" style={{ color: "var(--brand)", fontSize: "1.8rem", animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>Converting &amp; uploading…</span>
        </>
      ) : (
        <>
          <div className="thumb-upload-icon"><i className="fa-solid fa-image" /></div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text)", margin: "0 0 4px" }}>Add Featured Image</p>
            <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: "0 0 6px" }}>Click to browse or drag &amp; drop · auto-converted to WebP</p>
            {hovering && <p style={{ fontSize: "0.65rem", color: "var(--brand)", margin: "4px 0 0", fontWeight: 600 }}>Hover to paste image • Ctrl+V</p>}
          </div>
        </>
      )}
    </div>
  );
}

function SmartFileDisplay({ files = [], onRemove, onRename, isSingle = false }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(files.length > 0 ? files[0].name : "");

  if (!files.length) return null;

  if (isSingle && files.length === 1) {
    const file = files[0];

    return (
      <div className="smart-file-single">
        <div className="smart-file-card">
          <div className="smart-file-icon">
            <i className="fa-solid fa-file-pdf" />
          </div>
          <div className="smart-file-content">
            {editing ? (
              <input value={name} onChange={e => setName(e.target.value)} autoFocus className="file-row-input"
                onBlur={() => { onRename(0, name); setEditing(false); }}
                onKeyDown={e => { if (e.key === "Enter") { onRename(0, name); setEditing(false); } }} />
            ) : (
              <>
                <div className="smart-file-name">{file.name}</div>
                <a href={file.url} target="_blank" rel="noopener noreferrer" className="smart-file-link">
                  {file.url ? file.url.split("/").pop() : ""}
                </a>
              </>
            )}
          </div>
          <button type="button" onClick={() => setEditing(true)} title="Rename" className="smart-file-btn smart-file-edit">
            <i className="fa-solid fa-pen" />
          </button>
          <button type="button" onClick={() => onRemove(0)} title="Remove" className="smart-file-btn smart-file-trash">
            <i className="fa-solid fa-trash" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="file-rows">
      {files.map((file, index) => <FileRow key={index} file={file} index={index} onRemove={onRemove} onRename={onRename} />)}
    </div>
  );
}

function FileRow({ file, index, onRemove, onRename }) {
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(file.name);
  return (
    <div className="file-row">
      <div className="file-row-icon"><i className="fa-solid fa-file-pdf" /></div>
      <div className="file-row-info">
        {editing ? (
          <input value={name} onChange={e => setName(e.target.value)} autoFocus className="file-row-input"
            onBlur={() => { onRename(index, name); setEditing(false); }}
            onKeyDown={e => { if (e.key === "Enter") { onRename(index, name); setEditing(false); } }} />
        ) : (
          <div className="file-row-name">{file.name}</div>
        )}
        <a href={file.url} target="_blank" rel="noopener noreferrer" className="file-row-url">
          {file.url ? file.url.split("/").pop() : ""}
        </a>
      </div>
      <button type="button" onClick={() => setEditing(true)} title="Rename" className="file-row-btn file-row-edit">
        <i className="fa-solid fa-pen" />
      </button>
      <button type="button" onClick={() => onRemove(index)} title="Remove" className="file-row-btn file-row-trash">
        <i className="fa-solid fa-trash" />
      </button>
    </div>
  );
}

function PdfUploader({ onUploadFile, onAddUrl, uploading = false }) {
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const fileInputRef = useRef();
  const divRef = useRef();

  const handleFiles = async files => {
    const fileArray = Array.from(files || []);
    for (const file of fileArray) await onUploadFile(file);
  };

  const handlePaste = async e => {
    if (uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let item of items) {
      if (item.kind === "file" && (item.type === "application/pdf" || item.type === "")) {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); await handleFiles([file]); return; }
      }
    }
    const text = e.clipboardData.getData("text/plain")?.trim();
    if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
      e.preventDefault();
      await onAddUrl(text);
    }
  };

  return (
    <div ref={divRef}
      className={`pdf-upload-zone${dragging ? " dragging" : ""}${uploading ? " disabled" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      onPaste={handlePaste}
      onMouseEnter={() => { setHovering(true); divRef.current?.focus(); }}
      onMouseLeave={() => { setHovering(false); divRef.current?.blur(); }}
      onClick={() => !uploading && fileInputRef.current?.click()}
      contentEditable={hovering && !uploading}
      suppressContentEditableWarning
      tabIndex="0" style={{ outline: "none" }}
    >
      <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple
        style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} disabled={uploading} />
      {uploading ? (
        <>
          <i className="fa-solid fa-spinner" style={{ color: "var(--brand)", fontSize: "1.2rem", animation: "spin 1s linear infinite" }} />
          <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: "5px 0 0" }}>Uploading PDF(s)…</p>
        </>
      ) : (
        <>
          <i className="fa-solid fa-file-pdf" style={{ color: "var(--brand)", fontSize: "1.2rem" }} />
          <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: "5px 0 0" }}>Upload PDF(s)</p>
          {hovering && (
            <p style={{ fontSize: "0.65rem", color: "var(--brand)", margin: "4px 0 0", fontWeight: 600 }}>
              Hover &amp; Ctrl+V to paste a PDF link or file
            </p>
          )}
        </>
      )}
    </div>
  );
}

function UnsavedConfirm({ open, onStay, onDiscard }) {
  if (!open) return null;
  return (
    <div className="unsaved-overlay">
      <div className="unsaved-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div className="unsaved-icon">
            <i className="fa-solid fa-triangle-exclamation" style={{ color: "#e6a817", fontSize: "1rem" }} />
          </div>
          <h3 style={{ fontWeight: 700, fontSize: "0.98rem", color: "var(--text)", margin: 0 }}>Unsaved Changes</h3>
        </div>
        <p style={{ fontSize: "0.83rem", color: "var(--text-2)", margin: "0 0 20px", lineHeight: 1.6 }}>
          You have unsaved changes. If you leave now your progress will be lost.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn label="Stay & Keep Editing" variant="ghost" onClick={onStay} />
          <Btn label="Discard" variant="danger" icon="fa-trash" onClick={onDiscard} />
        </div>
      </div>
    </div>
  );
}

function ProductAuditStrip({ product }) {
  const fmt = d => d
    ? new Date(d).toLocaleString("en-PH", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  const created   = fmt(product?.created_at);
  const updated   = fmt(product?.updated_at);
  const createdBy = product?.created_by_username;
  const updatedBy = product?.updated_by_username;

  if (!created && !updated) return null;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 20,
      padding: "13px 16px",
      background: "var(--surface-2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--r)",
      fontSize: "0.76rem",
      color: "var(--text-3)",
      lineHeight: 1.7,
    }}>
      {created && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i className="fa-solid fa-circle-plus" style={{ color: "#22c55e", fontSize: "0.82rem" }} />
          <span>
            <span style={{ fontWeight: 600, color: "var(--text-2)" }}>Created</span>
            {createdBy && <> by <span style={{ fontWeight: 700, color: "var(--text)" }}>@{createdBy}</span></>}
            <span style={{ marginLeft: 5, color: "var(--text-3)" }}>· {created}</span>
          </span>
        </div>
      )}
      {updated && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i className="fa-solid fa-pen-to-square" style={{ color: "var(--brand)", fontSize: "0.82rem" }} />
          <span>
            <span style={{ fontWeight: 600, color: "var(--text-2)" }}>Last updated</span>
            {updatedBy && <> by <span style={{ fontWeight: 700, color: "var(--text)" }}>@{updatedBy}</span></>}
            <span style={{ marginLeft: 5, color: "var(--text-3)" }}>· {updated}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function ProductCard({ p, onEdit, onDelete, onDuplicate, perms }) {
  const [hovered,  setHovered]  = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const productUrl = `${FRONT_URL || window.location.origin}/products/${p.slug}`;

  const handleCardClick = (e) => {
    if (menuRef.current && menuRef.current.contains(e.currentTarget)) {
      return;
    }
    window.open(productUrl, "_blank");
  };

  return (
    <a href={productUrl} target="_blank" rel="noopener noreferrer"
      className="product-grid-card"
      style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}>
      <div className="product-grid-thumb">
        {localOrRemote(p, 'thumbnail')
          ? <img src={localOrRemote(p, 'thumbnail')} alt={p.name} />
          : <i className="fa-regular fa-image" style={{ fontSize: "1.5rem", color: "var(--border)" }} />
        }
        {hovered && (perms.can("products.edit") || perms.can("products.duplicate") || perms.can("products.delete")) && (
          <div className="product-grid-options" ref={menuRef} onClick={e => e.preventDefault()}>
            <button type="button" className="product-grid-opts-btn"
              onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(m => !m); }}>
              <i className="fa-solid fa-ellipsis-vertical" />
            </button>
            {menuOpen && (
              <div className="product-grid-menu">
                {perms.can("products.edit") && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setMenuOpen(false); onEdit(p); }}>
                    <i className="fa-solid fa-pen" /> Edit
                  </button>
                )}
                {perms.can("products.duplicate") && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setMenuOpen(false); onDuplicate(p); }}>
                    <i className="fa-solid fa-copy" /> Duplicate
                  </button>
                )}
                {perms.can("products.delete") && (
                  <button type="button" className="danger" onClick={(e) => { e.preventDefault(); setMenuOpen(false); onDelete(p); }}>
                    <i className="fa-solid fa-trash" /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="product-grid-info">
        <div className="product-grid-name product-name-link" style={{ textDecoration: "none", color: "inherit" }}>
          {p.name}
        </div>
        {(p.categories || []).length > 0 && (
          <div className="product-grid-pills">
            {(p.categories || []).slice(0, 2).map(c => <span key={c} className="tbl-pill tbl-pill-cat">{c}</span>)}
          </div>
        )}
        {(p.tags || []).length > 0 && (
          <div className="product-grid-pills">
            {(p.tags || []).slice(0, 3).map(t => <span key={t} className="tbl-pill tbl-pill-tag">{t}</span>)}
            {(p.tags || []).length > 3 && <span className="tbl-pill tbl-pill-more">+{p.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </a>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Products({ currentUser }) {
  const perms = getPerms(currentUser);
  const { toasts, add, remove } = useToast();

  const [products, setProducts]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [allCats,    setAllCats]    = useState([]);
  const [allTags,    setAllTags]    = useState([]);
  const [allModels,  setAllModels]  = useState([]);

  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sortDir,      setSortDir]      = useState("desc");
  const [viewMode,     setViewMode]     = useState("list");

  const [selected,    setSelected]    = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const [modalOpen,   setModalOpen]   = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [editingFull, setEditingFull] = useState(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [savedForm,   setSavedForm]   = useState(EMPTY_FORM);
  const [slugEdited,  setSlugEdited]  = useState(false);
  const [saving,      setSaving]      = useState(false);

  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const pendingClose = useRef(null);

  const [confirmDel, setConfirmDel] = useState(null);

  const [upThumb, setUpThumb] = useState(false);
  const [upImgs,  setUpImgs]  = useState(false);
  const [upSpec,  setUpSpec]  = useState(false);
  const [upFile,  setUpFile]  = useState(false);

  const [modalMenuOpen, setModalMenuOpen] = useState(false);
  // const [showRevisions, setShowRevisions] = useState(false); // Commented out - revisions tracked in GitHub only
  // const [revisions, setRevisions] = useState([]); // Commented out - revisions tracked in GitHub only

  const isDirty = !formsEqual(form, savedForm);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      let data = await getAllProductsLive();
      if (filterStatus) data = data.filter(p => p.status === filterStatus);
      data.sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return sortDir === "asc" ? aTime - bTime : bTime - aTime;
      });
      setProducts(data || []);
      setSelected(new Set());
    } catch (err) { add(err.message, "error"); }
    finally { setLoading(false); }
  }, [filterStatus, sortDir]); // eslint-disable-line

  const fetchMeta = useCallback(async () => {
    try {
      const cats = await getAllCategoriesLive();
      const tags = await getAllTagsLive();
      const prods = await getAllProductsLive();
      setAllCats(cats.map(c => c.name));
      setAllTags(tags.map(t => t.name));
      const models = [...new Set(prods.map(p => p.type).filter(Boolean))].sort();
      setAllModels(models);
    } catch (err) {
      console.error("Failed to fetch metadata:", err);
    }
  }, []);

  useEffect(() => { fetchProducts(); fetchMeta(); }, [fetchProducts, fetchMeta]);

  useEffect(() => {
    if (!perms.can("products.edit")) setViewMode("grid");
  }, []);

  // const fetchRevisions = async (productId) => {
  //   Commented out - using GitHub storage only (no activity_logs table)
  //   try {
  //     const { data, error } = await supabase
  //       .from("activity_logs")
  //       .select("*")
  //       .eq("entity_id", productId)
  //       .eq("entity", "product")
  //       .order("created_at", { ascending: false });
  //     if (error) throw error;
  //     setRevisions(data || []);
  //   } catch (err) {
  //     console.error("Failed to fetch revisions:", err);
  //     setRevisions([]);
  //   }
  // };

  const upsertTaxonomy = async (items, table) => {
    if (!items.length) return;
    // Taxonomy is now stored in products.json via GitHub - no separate table needed
    console.log(`[CMS] Updated ${table}:`, items);
  };

  const handleThumbUpload = async file => {
    setUpThumb(true);
    try {
      const slug = form.slug || slugify(form.name);
      const url = await uploadImageToGitHub(file, slug);
      setForm(f => ({ ...f, thumbnail: url }));
      add("Thumbnail converted to WebP and uploaded to GitHub.", "success");
    } catch (err) { add(err.message, "error"); }
    finally { setUpThumb(false); }
  };

  const uploadMoreImages = async files => {
    setUpImgs(true);
    try {
      const slug = form.slug || slugify(form.name);
      const arr  = Array.isArray(files) ? files : [files];
      const urls = await Promise.all(arr.map(f => uploadImageToGitHub(f, slug)));
      setForm(f => ({ ...f, images: [...f.images, ...urls] }));
      add(`${urls.length} image(s) converted to WebP and uploaded to GitHub.`, "success");
    } catch (err) { add(err.message, "error"); }
    finally { setUpImgs(false); }
  };

  const uploadSpecImages = async files => {
    setUpSpec(true);
    try {
      const slug = form.slug || slugify(form.name);
      const arr  = Array.isArray(files) ? files : [files];
      const urls = await Promise.all(arr.map(f => uploadImageToGitHub(f, slug)));
      setForm(f => ({ ...f, spec_images: [...f.spec_images, ...urls] }));
      add(`${urls.length} spec image(s) converted to WebP and uploaded to GitHub.`, "success");
    } catch (err) { add(err.message, "error"); }
    finally { setUpSpec(false); }
  };

  const handleFileUpload = async file => {
    setUpFile(true);
    try {
      const slug = form.slug || slugify(form.name);
      const url         = await uploadPdfToGitHub(file, slug);
      const rawName     = file.name.replace(/\.pdf$/i, "");
      const displayName = rawName.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      setForm(f => ({ ...f, files: [...f.files, { name: displayName, url }] }));
      add("PDF uploaded to GitHub.", "success");
    } catch (err) { add("PDF upload failed: " + err.message, "error"); }
    finally { setUpFile(false); }
  };

  const handleAddPdfUrl = async url => {
    setUpFile(true);
    try {
      const fileName    = url.split("/").pop().replace(/\.pdf$/i, "");
      const displayName = fileName.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      setForm(f => ({ ...f, files: [...f.files, { name: displayName, url }] }));
      add("PDF link added.", "success");
    } catch (err) { add("Error adding PDF link: " + err.message, "error"); }
    finally { setUpFile(false); }
  };

  const renameFile = (i, name) => setForm(f => ({ ...f, files: f.files.map((fi, idx) => idx === i ? { ...fi, name } : fi) }));
  const removeFile = (i) => setForm(f => ({ ...f, files: f.files.filter((_, idx) => idx !== i) }));
  const removeImageFile = (type, index) => setForm(f => ({ ...f, [type]: f[type].filter((_, idx) => idx !== index) }));

  const actualClose = () => {
    setModalOpen(false); setEditing(null); setEditingFull(null);
    // setShowRevisions(false); // Commented out - revisions tracked in GitHub only
    setModalMenuOpen(false);
    setUnsavedOpen(false); pendingClose.current = null;
  };
  const handleModalClose = () => { if (isDirty) { pendingClose.current = actualClose; setUnsavedOpen(true); } else actualClose(); };
  const handleUnsavedStay    = () => { setUnsavedOpen(false); pendingClose.current = null; };
  const handleUnsavedDiscard = () => { actualClose(); };

  const openCreate = () => {
    setEditing(null); setEditingFull(null);
    setForm({ ...EMPTY_FORM }); setSavedForm({ ...EMPTY_FORM });
    setSlugEdited(false); setModalOpen(true);
  };

  const openEdit = async row => {
    try {
      const data = await getProductByIdLive(row.id);
      if (!data) throw new Error("Product not found");
      const loaded = {
        name:              data.name              || "",
        slug:              data.slug              || "",
        short_description: data.short_description || "",
        description:       data.description       || "",
        thumbnail:         data.thumbnail         || "",
        images:            data.images            || [],
        spec_images:       data.spec_images       || [],
        files:             data.files             || [],
        categories:        data.categories        || [],
        tags:              data.tags              || [],
        features:          data.features          || [],
        brand:             data.brand             || "SAWO",
        type:              data.type              || "",
        status:            data.status            || "published",
        visible:           data.visible           !== false,
        featured:          data.featured          || false,
        sort_order:        data.sort_order        || 0,
      };
      setForm(loaded);
      setSavedForm(loaded);
      setSlugEdited(true);
      setEditing(row);
      setEditingFull(data);
      // setShowRevisions(false); // Commented out - revisions tracked in GitHub only
      setModalMenuOpen(false);
      setModalOpen(true);
    } catch (err) { add(err.message, "error"); }
  };

  const openDuplicate = async row => {
    try {
      const data = await getProductByIdLive(row.id);
      if (!data) throw new Error("Product not found");

      const newSlug = `${data.slug}-copy`;

      const loaded = {
        name:              `${data.name || ""} (Copy)`,
        slug:              newSlug,
        short_description: data.short_description || "",
        description:       data.description       || "",
        thumbnail:         data.thumbnail         || "",
        images:            data.images            || [],
        spec_images:       data.spec_images       || [],
        files:             data.files             || [],
        categories:        data.categories        || [],
        tags:              data.tags              || [],
        features:          data.features          || [],
        brand:             data.brand             || "SAWO",
        type:              data.type              || "",
        status:            "draft",
        visible:           true,
        featured:          false,
        sort_order:        0,
      };
      setForm(loaded);
      setSavedForm(EMPTY_FORM);
      setSlugEdited(false);
      setEditing(null);
      setEditingFull(null);
      // setShowRevisions(false); // Commented out - revisions tracked in GitHub only
      setModalMenuOpen(false);
      setModalOpen(true);
      add("Duplicated! Remember to change the slug before saving.", "info");
    } catch (err) { add(err.message, "error"); }
  };

  const handleSave = async e => {
    e.preventDefault();
    if (!form.name) return add("Product name is required.", "error");
    if (!form.slug) return add("Slug is required.", "error");
    setSaving(true);
    try {
      const { kwTags, modelTags } = extractTagsFromDescription(form.description);
      const mergedTags = mergeAutoTags(form.tags, kwTags, modelTags);
      const newAutoTags = mergedTags.filter(t => !form.tags.includes(t));
      if (newAutoTags.length > 0) {
        add(`Auto-tagged: ${newAutoTags.join(", ")}`, "info");
        setForm(f => ({ ...f, tags: mergedTags }));
      }

      await upsertTaxonomy(form.categories, "categories");
      await upsertTaxonomy(mergedTags, "tags");
      fetchMeta();

      if (editing) {
        await editProduct(editing.id, form, null, [], [], []);
        // Activity logged via GitHub commit history
        // await logActivity({
        //   action:      "update",
        //   entity:      "product",
        //   entity_id:   editing.id,
        //   entity_name: form.name.trim(),
        //   username:    currentUser?.username,
        //   user_id:     currentUser?.id,
        // });
      } else {
        await createProduct(form, null, [], [], []);
        // Activity logged via GitHub commit history
        // await logActivity({
        //   action:      "create",
        //   entity:      "product",
        //   entity_id:   null,
        //   entity_name: form.name.trim(),
        //   username:    currentUser?.username,
        //   user_id:     currentUser?.id,
        // });
      }

      add(editing ? "Product saved to GitHub." : "Product created on GitHub.", "success");
      actualClose();
      bustProductCache();
      fetchProducts();
    } catch (err) { add(err.message, "error"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    const target = confirmDel;
    setConfirmDel(null);
    try {
      await deleteProduct(target.id);
      // Activity logged via GitHub commit history
      // const deletedBy = currentUser?.username || "unknown";
      // const deletedById = currentUser?.id || null;
      // await logActivity({
      //   action:      "delete",
      //   entity:      "product",
      //   entity_id:   target.id,
      //   entity_name: target.name,
      //   username:    deletedBy,
      //   user_id:     deletedById,
      // });
      add("Product deleted from GitHub.", "success");
    } catch (err) { add(err.message, "error"); }
    finally { bustProductCache(); fetchProducts(); }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    setBulkConfirm(false);
    try {
      const fullProducts = await Promise.all(ids.map(id => getProductByIdLive(id))).then(products => products.filter(p => p));
      await Promise.all(ids.map(id => deleteProduct(id)));

      // Activity logged via GitHub commit history
      // const deletedBy = currentUser?.username || "unknown";
      // const deletedById = currentUser?.id || null;
      //
      // await Promise.allSettled((fullProducts || []).map(p =>
      //   logActivity({
      //     action: "delete", entity: "product",
      //     entity_id: p.id, entity_name: p.name,
      //     username: deletedBy, user_id: deletedById,
      //     meta: { bulk: true },
      //   })
      // ));
      add(`${ids.length} product(s) deleted from GitHub.`, "success");
    } catch (err) { add(err.message, "error"); }
    finally { setSelected(new Set()); bustProductCache(); fetchProducts(); }
  };

  const toggleSelect = id => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.id)));
  };

  const filtered = products.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.slug?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.type?.toLowerCase().includes(q) ||
      (p.categories || []).some(c => c.toLowerCase().includes(q)) ||
      (p.tags       || []).some(t => t.toLowerCase().includes(q))
    );
  });

  const handleNameChange = e => {
    const name = e.target.value;
    setForm(f => ({ ...f, name, slug: slugEdited ? f.slug : slugify(name) }));
  };

  const productUrl = slug => `${FRONT_URL || window.location.origin}/products/${slug}`;

  const formatDate = d => d
    ? new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "-";

  return (
    <div className="products-page">
      <Toast toasts={toasts} remove={remove} />
      <UnsavedConfirm open={unsavedOpen} onStay={handleUnsavedStay} onDiscard={handleUnsavedDiscard} />

      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="page-title">
            <i className="fa-solid fa-box" style={{ marginRight: "0.5rem", color: "var(--brand)" }} />
            Products
          </h1>
          <p className="products-subtitle">
            {loading ? "Loading..." : `${filtered.length} of ${products.length} products`}
          </p>
        </div>
      </div>

      <div className="products-toolbar">
        <div className="search-wrap">
          <i className="fa-solid fa-magnifying-glass" />
          <input className="search-input" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, brand, tag..." />
        </div>
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <select className="filter-select" value={sortDir} onChange={e => setSortDir(e.target.value)}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
        <div className="view-toggle">
          {[{ mode: "list", icon: "fa-list" }, { mode: "grid", icon: "fa-grip" }].map(({ mode, icon }) => (
            <button key={mode} type="button" onClick={() => setViewMode(mode)}
              className={`view-toggle-btn${viewMode === mode ? " active" : ""}`}>
              <i className={`fa-solid ${icon}`} />
            </button>
          ))}
        </div>
        {perms.can("products.bulk_delete") && selected.size > 0 && (
          <button type="button" className="btn btn-sm"
            style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger)", gap: 5 }}
            onClick={() => setBulkConfirm(true)}>
            <i className="fa-solid fa-trash" /> Delete {selected.size}
          </button>
        )}
        {perms.can("products.create") && (
          <Btn icon="fa-plus" label="New Product" onClick={openCreate} style={{ marginLeft: "auto" }} />
        )}
      </div>

      {!loading && viewMode === "grid" && (
        <div className="product-grid">
          {filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "var(--text-3)", fontStyle: "italic", fontSize: "0.82rem" }}>
              {search ? `No products match "${search}"` : "No products yet — click New Product to create one."}
            </div>
          )}
          {filtered.map(p => <ProductCard key={p.id} p={p} onEdit={openEdit} onDuplicate={openDuplicate} onDelete={setConfirmDel} perms={perms} />)}
        </div>
      )}

      {viewMode === "list" && (
        <div className="products-table-wrap">
          {loading ? (
            <div className="table-loading">
              <i className="fa-solid fa-circle-notch fa-spin" style={{ marginRight: "0.5rem" }} /> Loading...
            </div>
          ) : (
            <table className="products-table">
              <thead>
                <tr>
                  {perms.can("products.bulk_delete") && (
                    <th style={{ width: 36, paddingRight: 0 }}>
                      <input type="checkbox" className="tbl-checkbox"
                        checked={filtered.length > 0 && selected.size === filtered.length}
                        onChange={toggleSelectAll} />
                    </th>
                  )}
                  <th style={{ width: 44 }}></th>
                  <th>Product</th>
                  <th>Categories</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th style={{ width: 100 }}>Created Date</th>
                  <th style={{ width: 110 }}>Created By</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={perms.can("products.bulk_delete") ? 9 : 8} className="table-empty">
                    {search ? `No products match "${search}"` : "No products yet — click New Product to create one."}
                  </td></tr>
                )}
                {filtered.map(p => (
                  <tr key={p.id} className={selected.has(p.id) ? "row-selected" : ""}>
                    {perms.can("products.bulk_delete") && (
                      <td style={{ paddingRight: 0 }}>
                        <input type="checkbox" className="tbl-checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                      </td>
                    )}
                    <td style={{ width: 44 }}>
                      {localOrRemote(p, 'thumbnail')
                        ? <img src={localOrRemote(p, 'thumbnail')} alt="" className="product-thumb" />
                        : <div className="product-thumb-placeholder"><i className="fa-regular fa-image" /></div>
                      }
                    </td>
                    <td>
                      <a href={productUrl(p.slug)} target="_blank" rel="noopener noreferrer" className="product-name-link">
                        {p.name}
                      </a>
                      <div className="product-meta">
                        {p.featured && <span className="product-meta-tag featured"><i className="fa-solid fa-star" style={{ marginRight: 3 }} />Featured</span>}
                        {(p.files || []).length > 0 && <span className="product-meta-tag files"><i className="fa-solid fa-file-pdf" style={{ marginRight: 3 }} />{p.files.length} file(s)</span>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {(p.categories || []).slice(0, 2).map(c => <span key={c} className="tbl-pill tbl-pill-cat">{c}</span>)}
                        {(p.categories || []).length > 2 && <span className="tbl-pill tbl-pill-more">+{p.categories.length - 2}</span>}
                        {!(p.categories || []).length && <span style={{ color: "var(--text-3)", fontSize: "0.72rem" }}>-</span>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {(p.tags || []).slice(0, 3).map(t => <span key={t} className="tbl-pill tbl-pill-tag">{t}</span>)}
                        {(p.tags || []).length > 3 && <span className="tbl-pill tbl-pill-more">+{p.tags.length - 3}</span>}
                        {!(p.tags || []).length && <span style={{ color: "var(--text-3)", fontSize: "0.72rem" }}>-</span>}
                      </div>
                    </td>
                    <td>
                      <span className="tbl-status">{!p.visible ? "Hidden" : p.status === "published" ? "Published" : "Draft"}</span>
                    </td>
                    <td className="tbl-date" style={{ fontSize: "0.75rem" }}>
                      {formatDate(p.created_at)}
                    </td>
                    <td style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                      {p.created_by_username ? `@${p.created_by_username}` : "-"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="table-actions">
                        {perms.can("products.edit") && (
                          <IconBtn icon="fa-pen" title="Edit" onClick={() => openEdit(p)} />
                        )}
                        {perms.can("products.duplicate") && (
                          <IconBtn icon="fa-copy" title="Duplicate" onClick={() => openDuplicate(p)} />
                        )}
                        {perms.can("products.delete") && (
                          <IconBtn icon="fa-trash" title="Delete" onClick={() => setConfirmDel(p)} danger />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={handleModalClose}
        title={editing ? `Edit: ${editing.name}` : "New Product"}
        wide
        actions={(
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="submit"
              form="product-form"
              disabled={saving}
              style={{
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: 500,
                background: "var(--brand)",
                color: "white",
                border: "none",
                borderRadius: "var(--r-sm)",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
                transition: "opacity 0.15s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
              onMouseEnter={e => !saving && (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={e => !saving && (e.currentTarget.style.opacity = "1")}
            >
              <i className={`fa-solid ${saving ? "fa-spinner fa-spin" : "fa-check"}`} />
              {editing ? "Save Changes" : "Create Product"}
            </button>
            {editing && (
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setModalMenuOpen(m => !m); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "4px 8px", fontSize: "1rem", color: "var(--text-2)",
                    borderRadius: "var(--r-sm)", transition: "background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}
                >
                  <i className="fa-solid fa-ellipsis-vertical" />
                </button>

                {modalMenuOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", right: 0,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: "var(--r-sm)", padding: "4px 0",
                    minWidth: 150, boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                    zIndex: 1100,
                  }}>
                    {/* Revisions button commented out - tracked in GitHub only
                    <button
                      type="button"
                      onClick={() => {
                        setShowRevisions(true);
                        setModalMenuOpen(false);
                        fetchRevisions(editing.id);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "9px 14px",
                        background: "none", border: "none",
                        textAlign: "left", cursor: "pointer",
                        fontSize: "0.8rem", color: "var(--text)",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                    >
                      <i className="fa-solid fa-clock-rotate-left" style={{ color: "var(--brand)", fontSize: "0.75rem" }} />
                      Revisions
                    </button>
                    */}

                    <button
                      type="button"
                      onClick={() => {
                        setModalMenuOpen(false);
                        setConfirmDel(editing);
                        handleModalClose();
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "9px 14px",
                        background: "none", border: "none",
                        textAlign: "left", cursor: "pointer",
                        fontSize: "0.8rem", color: "var(--danger)",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                    >
                      <i className="fa-solid fa-trash" style={{ fontSize: "0.75rem" }} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      >

        {/* Revisions section commented out - tracked in GitHub only
        false && (
          <div>
            <button
              type="button"
              onClick={() => setShowRevisions(false)}
              style={{
                marginBottom: 16,
                padding: "8px 12px",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.78rem",
                color: "var(--text-2)",
              }}
            >
              <i className="fa-solid fa-arrow-left" style={{ marginRight: 6 }} />
              Back
            </button>
            <div>
              <h3 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: 12, color: "var(--text)" }}>Revisions</h3>
              {revisions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "16px", color: "var(--text-3)", fontSize: "0.75rem" }}>
                  No revisions recorded yet
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {revisions.map(rev => (
                    <div
                      key={rev.id}
                      style={{
                        padding: "10px 12px",
                        background: "var(--surface-2)",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {rev.action === "create" && <i className="fa-solid fa-plus" style={{ color: "#22c55e", fontSize: "0.7rem" }} />}
                          {rev.action === "update" && <i className="fa-solid fa-pen" style={{ color: "var(--brand)", fontSize: "0.7rem" }} />}
                          {rev.action === "delete" && <i className="fa-solid fa-trash" style={{ color: "#ef4444", fontSize: "0.7rem" }} />}
                          <span style={{ fontWeight: 500, color: "var(--text)" }}>
                            {rev.action === "create" ? "Created" : rev.action === "update" ? "Updated" : "Deleted"}
                          </span>
                        </div>
                        <span style={{ color: "var(--text-3)" }}>
                          {new Date(rev.created_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div style={{ color: "var(--text-2)", fontSize: "0.7rem" }}>
                        @{rev.username || "unknown"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
        */}
          <>
            {isDirty && (
              <div className="dirty-banner">
                <i className="fa-solid fa-circle-dot" style={{ fontSize: "0.6rem" }} />
                You have unsaved changes
              </div>
            )}

            <form id="product-form" onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <div className="responsive-grid-2">
            <div>
              <SectionLabel label="Featured Image" />
              {form.thumbnail ? (
                <ThumbnailPreview
                  url={form.thumbnail}
                  onRemove={() => setForm(f => ({ ...f, thumbnail: "" }))}
                  onReplace={handleThumbUpload}
                  uploading={upThumb}
                />
              ) : (
                <ThumbnailUploader onUpload={handleThumbUpload} uploading={upThumb} />
              )}
            </div>

            <div>
              <SectionLabel label="Gallery Images" />
              {form.images.length > 0 ? (
                <>
                  <SmartImageGallery images={form.images} isSingle onRemove={i => removeImageFile("images", i)} />
                  <AddMoreImagesButton label="Add More Images" uploading={upImgs}
                    onChange={e => e.target.files?.length && uploadMoreImages(Array.from(e.target.files))} />
                </>
              ) : (
                <ImageUploader onUpload={uploadMoreImages} label="Add Gallery Images" multiple uploading={upImgs} />
              )}
            </div>
          </div>

          <SectionLabel label="Basic Info" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Product Name" value={form.name} onChange={handleNameChange} placeholder="e.g. Nordex 9kW" required />
            <Field label="Slug" value={form.slug}
              onChange={e => { setSlugEdited(true); setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })); }}
              placeholder="nordex-9kw" required helper="Auto-generated and editable" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Brand" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="SAWO" />
            <ModelSelect label="Type / Model" value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} placeholder="Premium Series" suggestions={allModels} />
          </div>

          <SectionLabel label="Features" />
          <PillInput label="Features" value={form.features}
            onChange={v => setForm(f => ({ ...f, features: v }))} placeholder="e.g. Auto shutoff, Stainless steel" />

          <SectionLabel label="Product Description" />
          <RichField label="Product Description" value={form.short_description}
            onChange={e => setForm(f => ({ ...f, short_description: e.target.value }))} rows={4} onNotify={add} />

          <SectionLabel label="Categories & Tags" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <PillInput label="Categories" value={form.categories}
              onChange={v => setForm(f => ({ ...f, categories: v }))} placeholder="e.g. Wall-Mounted" suggestions={allCats} />
            <PillInput label="Tags" value={form.tags}
              onChange={v => setForm(f => ({ ...f, tags: v }))}
              placeholder="e.g. electric, 9kW" suggestions={allTags} />
          </div>

          <TagSuggestions
            name={form.name}
            description={form.short_description}
            features={form.features}
            currentTags={form.tags}
            allTags={allTags}
            onAddTags={suggestedTags => {
              setForm(f => ({ ...f, tags: [...new Set([...f.tags, ...suggestedTags])] }));
              add(`✓ Added ${suggestedTags.length} matching tag(s) from content`, "success");
            }}
          />

          <RichField label="Specifications" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} onNotify={add} />
          <AutoTagPreview description={form.description} currentTags={form.tags} />

          <div className="responsive-grid-2">
            <div>
              <SectionLabel label="Spec / Diagram Images" />
              {form.spec_images.length > 0 ? (
                <>
                  <SmartImageGallery images={form.spec_images} isSingle onRemove={i => removeImageFile("spec_images", i)} />
                  <AddMoreImagesButton label="Add More Spec Images" uploading={upSpec}
                    onChange={e => e.target.files?.length && uploadSpecImages(Array.from(e.target.files))} />
                </>
              ) : (
                <ImageUploader onUpload={uploadSpecImages} label="Add Spec Images" multiple uploading={upSpec} />
              )}
            </div>

            <div>
              <SectionLabel label="Resources (PDFs)" />
              {form.files.length > 0 ? (
                <>
                  <SmartFileDisplay files={form.files} isSingle onRemove={removeFile} onRename={renameFile} />
                  <AddMorePdfsButton label="Add More PDFs" uploading={upFile}
                    onUploadFile={handleFileUpload} onAddUrl={handleAddPdfUrl} />
                </>
              ) : (
                <PdfUploader onUploadFile={handleFileUpload} onAddUrl={handleAddPdfUrl} uploading={upFile} />
              )}
            </div>
          </div>

          <SectionLabel label="Status & Visibility" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "start" }}>
            <SelectField label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              options={[{ value: "published", label: "Published" }, { value: "draft", label: "Draft" }]} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 20 }}>
              <Toggle label="Visible"  checked={form.visible}  onChange={v => setForm(f => ({ ...f, visible: v }))} helper="Show on website" />
              <Toggle label="Featured" checked={form.featured} onChange={v => setForm(f => ({ ...f, featured: v }))} />
            </div>
            <Field label="Sort Order" type="number" value={String(form.sort_order)}
              onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} helper="Lower = shown first" />
          </div>

          {editing && editingFull && (
            <>
              <SectionLabel label="Record Info" />
              <ProductAuditStrip product={editingFull} />
            </>
          )}

          {!editing && currentUser && (
            <div className="created-by-notice">
              <i className="fa-solid fa-pen-to-square" style={{ marginRight: 6 }} />
              Will be created by <strong>@{currentUser.username}</strong>
            </div>
          )}

            </form>
          </>
        )}
      </Modal>

      <Confirm open={bulkConfirm} onClose={() => setBulkConfirm(false)} onConfirm={handleBulkDelete}
        title="Delete Selected?"
        message={`Delete ${selected.size} selected product(s)? This cannot be undone.`}
        confirmLabel="Delete All" />

      <Confirm open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={handleDelete}
        title="Delete Product?"
        message={`Delete "${confirmDel?.name}"? This cannot be undone.`}
        confirmLabel="Delete" />
    </div>
  );
}
