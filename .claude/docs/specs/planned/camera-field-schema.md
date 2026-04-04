# Camera Field Schema

> Status: `planned`
> Last updated: 2026-04-03

## Goal

Replace the hardcoded form template in `buildCamDrawerForm()` with a declarative `CAM_FIELD_SCHEMA` array. This makes it trivial to add, remove, or conditionally show fields without touching template strings.

---

## Schema Shape

Each entry in `CAM_FIELD_SCHEMA` describes one form field:

```js
{
  id: String,           // key in the stream object
  label: String,        // display label
  type: String,         // 'text' | 'number' | 'select' | 'toggle'
  default: any,         // default value used by addCamStream()
  section: String,      // 'main' | 'advanced'
  options: Array,       // [{ value, label }] — select only
  dependsOn: String,    // optional — hide when the named field's value is falsy
  hint: String,         // optional — muted helper text below input
  validate: Function,   // optional — (value) => errorString | null
  placeholder: String,  // optional
  showIf: Function,     // optional — (cfg) => bool — hide based on global config
}
```

---

## Fields

### Main section

| id | type | default | notes |
|----|------|---------|-------|
| path | text | '' | slug validate /^[a-z0-9-]+$/; hint: "Lowercase letters, numbers, hyphens" |
| label | text | '' | placeholder: "Front Door" |
| source | text | '' | validate: must start with rtsp:// or rtsps://; placeholder: rtsp://user:pass@host/stream |
| rtspTransport | select | 'tcp' | options: TCP, UDP |
| aspectRatio | select | '16:9' | special case — see below |
| objectFit | select | 'contain' | options: Contain (letterbox), Cover (crop) |
| audio | toggle | false | |
| sourceOnDemand | toggle | true | |
| sourceOnDemandStartTimeout | text | '10s' | dependsOn: sourceOnDemand |
| sourceOnDemandCloseAfter | text | '10s' | dependsOn: sourceOnDemand |

### Advanced section

| id | type | default | notes |
|----|------|---------|-------|
| refreshInterval | number | 0 | hint: "sec (0 = off)" |
| preloadLeadTime | number | 0 | hint: "sec (0 = default)"; showIf: ENABLE_PRELOAD |

---

## aspectRatio Special Case

aspectRatio is a select (16:9, 4:3, 1:1, 21:9, Custom) with a sibling freeform text input that appears when "Custom" is selected. The renderer detects field.id === 'aspectRatio' and handles it with custom render logic. The stored value is the raw string (e.g. '16:9' or '9:16'); if it does not match a fixed option, "Custom" is pre-selected and the sibling input is populated.

---

## Renderer Contract

buildCamDrawerForm(stream, isNew):

1. Splits CAM_FIELD_SCHEMA into mainFields and advancedFields by section
2. Evaluates showIf(cfg) — skips field entirely if false
3. For fields with dependsOn: wraps in <div id="cam-dep-{id}">, initially hidden when dependency value is falsy
4. Delegates to renderCamField(field, stream) per field type
5. Wraps advanced fields in <div id="cam-advanced-fields" style="display:none"> with the existing toggle button

addCamStream() derives new stream defaults by iterating CAM_FIELD_SCHEMA.

---

## Open Questions

1. File location: Should CAM_FIELD_SCHEMA live in a dedicated www/js/camera-schema.js or remain inline in camera-editor.js?
2. Schema-driven validation: saveCamDrawer currently validates imperatively. A follow-up could iterate field.validate from the schema.
