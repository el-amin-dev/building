/**
 * draw.io HTML-export plumbing: read and write the pages of
 * `docs/source-of-truth-n-floor.drawio.html` without disturbing anything else.
 *
 * The owner edits that file by hand in the draw.io desktop app, and we
 * regenerate one of its pages from `plan-v2.mjs`. Both directions must survive
 * the other, so this module is deliberately conservative: it changes the bytes
 * it is asked to change and copies every other byte through verbatim.
 *
 * ## The four nested encodings
 *
 * A draw.io "HTML" export is an ordinary HTML page whose payload hides four
 * layers deep. From the outside in:
 *
 * 1. **HTML** — `<div class="mxgraph" style="…" data-mxgraph="…">`. The viewer
 *    script at the bottom of the page reads that one attribute.
 * 2. **HTML-escaped JSON** — the attribute value is a JSON object
 *    (`{highlight, nav, resize, xml, toolbar, page}`) with `&` `<` `>` `"`
 *    replaced by entities so it can live inside a double-quoted attribute.
 *    Only the `xml` key is ours; the others are viewer options we must keep.
 * 3. **mxfile** — `obj.xml` is `<mxfile …><diagram id="…" name="…">PAYLOAD
 *    </diagram>…</mxfile>`, one `<diagram>` per page of the document.
 * 4. **The diagram payload** — either the `<mxGraphModel>` XML inline and
 *    plain, or `base64(deflateRaw(encodeURIComponent(xml)))`. draw.io writes
 *    whichever its "compressed" preference says and reads both; the file we
 *    inherited happens to be plain, so {@link decodePayload} sniffs.
 *
 * ## Why we default to writing the payload *uncompressed*
 *
 * `docs/…drawio.html` is committed, and a deflated payload is one 20 kB opaque
 * base64 blob: every regeneration would be an unreviewable diff, and `git
 * blame` on the geometry would be worthless. Plain XML costs a few kB and keeps
 * the drawing reviewable in a pull request, so {@link writeDiagrams} defaults to
 * `compress: false` — which is also what the file already uses, making an
 * untouched read/write pair byte-for-byte identical. Pass `compress: true` for
 * the deflated form; draw.io opens either without complaint.
 *
 * Node built-ins only, ES modules. No XML parser: we own both ends of this
 * format and regexes over a machine-generated file are less to go wrong (and to
 * install) than a dependency.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * The attribute that holds everything, as draw.io writes it. Captured lazily so
 * a `style` attribute before it, or a second `.mxgraph` div, cannot confuse us:
 * we match the attribute itself rather than the element around it.
 */
const DATA_MXGRAPH = /data-mxgraph="([^"]*)"/;

/** Opening `<mxfile …>` tag, its attributes kept verbatim so `host="…"` survives. */
const MXFILE = /^([\s\S]*?<mxfile\b[^>]*>)([\s\S]*?)(<\/mxfile>[\s\S]*)$/;

/** One `<diagram …>payload</diagram>`, with its attribute string and its payload. */
const DIAGRAM = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g;

/**
 * Un-escape the four entities draw.io uses inside `data-mxgraph`.
 *
 * `&amp;` is replaced last: doing it first would turn a literal `&amp;lt;` (an
 * escaped `&lt;` that belongs to the diagram's own text) into a `<`, corrupting
 * the payload. The inverse ordering in {@link escapeAttribute} is why a
 * read/write pair is lossless.
 *
 * @param {string} value Raw attribute text.
 * @returns {string} The JSON source it encodes.
 */
function unescapeAttribute(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Escape JSON source for a double-quoted HTML attribute.
 *
 * `&` goes first, for the mirror-image reason. We deliberately do *not* escape
 * `'`: the attribute is double-quoted, draw.io leaves apostrophes alone, and
 * emitting `&#39;` where the original had `'` would make every regeneration
 * dirty a file the owner had not changed.
 *
 * @param {string} json JSON source.
 * @returns {string} Attribute-safe text.
 */
function escapeAttribute(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Decode one `<diagram>` payload to its `<mxGraphModel>` XML.
 *
 * Sniffs the two forms draw.io emits rather than trusting a flag: a payload
 * that starts with `<` is already the model (draw.io's "uncompressed" setting),
 * anything else is base64 over a raw DEFLATE stream over percent-encoded XML.
 *
 * The `binary` (latin1) round trip in the middle is not decoration: draw.io
 * percent-encodes *before* deflating, so the inflated bytes are ASCII
 * percent-escapes that `decodeURIComponent` turns back into UTF-8. Reading them
 * as UTF-8 first would mangle every `²`, `—` and `↓` in the drawing.
 *
 * @param {string} payload Text between `<diagram …>` and `</diagram>`.
 * @returns {string} The inner `<mxGraphModel>…</mxGraphModel>` XML.
 */
export function decodePayload(payload) {
  const trimmed = payload.trim();
  if (trimmed.startsWith('<')) return trimmed;
  const inflated = inflateRawSync(Buffer.from(trimmed, 'base64')).toString('binary');
  return decodeURIComponent(inflated);
}

/**
 * Encode `<mxGraphModel>` XML as a `<diagram>` payload.
 *
 * @param {string} xml The inner `<mxGraphModel>…</mxGraphModel>` XML.
 * @param {{ compress?: boolean }} [options] `compress: true` for draw.io's
 *   deflated base64 form; the default keeps the XML plain so the committed file
 *   stays reviewable (see the module note).
 * @returns {string} Payload text.
 */
export function encodePayload(xml, { compress = false } = {}) {
  if (!compress) return xml;
  return deflateRawSync(Buffer.from(encodeURIComponent(xml), 'binary')).toString('base64');
}

/**
 * Read every page of a draw.io HTML export.
 *
 * @param {string} htmlPath Path to the `.drawio.html` export.
 * @returns {Array<{ id: string, name: string, xml: string, extraAttributes: string }>}
 *   One entry per page, in document order, with the payload decoded.
 *   `extraAttributes` carries any `<diagram>` attribute beyond `id`/`name`
 *   (draw.io adds them over time) so {@link writeDiagrams} can put them back;
 *   it is `''` for the pages we write ourselves.
 */
export function readDiagrams(htmlPath) {
  const { mxfileBody } = readWrapper(htmlPath);
  const diagrams = [];
  for (const match of mxfileBody.matchAll(DIAGRAM)) {
    const attributes = match[1];
    diagrams.push({
      id: attributeValue(attributes, 'id'),
      name: attributeValue(attributes, 'name'),
      xml: decodePayload(match[2]),
      extraAttributes: otherAttributes(attributes),
    });
  }
  if (diagrams.length === 0) {
    throw new Error(`${htmlPath}: no <diagram> found inside <mxfile>`);
  }
  return diagrams;
}

/**
 * Write pages back into a draw.io HTML export, in place.
 *
 * Everything outside the `xml` key is copied from the file on disk rather than
 * regenerated: the surrounding HTML, the `<div>`'s other attributes, the viewer
 * options (`highlight`, `nav`, `resize`, `toolbar`, `page`) and their key order,
 * and the `<mxfile>` tag's own attributes. That is what lets us rewrite one page
 * of a document the owner is also editing.
 *
 * @param {string} htmlPath Path to the export, overwritten in place.
 * @param {ReadonlyArray<{ id: string, name: string, xml: string, extraAttributes?: string }>} diagrams
 *   Pages to write, in the order they should appear. Typically the result of
 *   {@link readDiagrams} with one entry's `xml` replaced.
 * @param {{ compress?: boolean }} [options] See {@link encodePayload}.
 * @returns {void}
 */
export function writeDiagrams(htmlPath, diagrams, { compress = false } = {}) {
  if (!Array.isArray(diagrams) || diagrams.length === 0) {
    throw new Error('writeDiagrams: expected at least one diagram');
  }
  const { html, attributeMatch, options, mxfilePrefix, mxfileSuffix } = readWrapper(htmlPath);

  const body = diagrams
    .map((page) => {
      const extra = page.extraAttributes ?? '';
      const open = `<diagram id="${page.id}" name="${page.name}"${extra}>`;
      return `${open}${encodePayload(page.xml, { compress })}</diagram>`;
    })
    .join('');

  // Mutating the parsed object preserves JSON key order, so `xml` stays in the
  // slot draw.io put it in and the other options are re-emitted untouched.
  options.xml = `${mxfilePrefix}${body}${mxfileSuffix}`;

  const attribute = `data-mxgraph="${escapeAttribute(JSON.stringify(options))}"`;
  const start = attributeMatch.index;
  const next = `${html.slice(0, start)}${attribute}${html.slice(start + attributeMatch[0].length)}`;
  writeFileSync(htmlPath, next);
}

/**
 * Pull the export apart into the pieces both public functions need.
 *
 * Shared so a read and the write that follows it agree on how the file is
 * shaped, and so the error messages naming a malformed file live in one place.
 *
 * @param {string} htmlPath Path to the export.
 * @returns {{ html: string, attributeMatch: RegExpMatchArray, options: Record<string, unknown>,
 *   mxfilePrefix: string, mxfileBody: string, mxfileSuffix: string }} The raw file, the
 *   located attribute, the parsed viewer options, and the `<mxfile>` wrapper split
 *   around its `<diagram>` list.
 */
function readWrapper(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const attributeMatch = html.match(DATA_MXGRAPH);
  if (!attributeMatch) {
    throw new Error(`${htmlPath}: no data-mxgraph attribute — not a draw.io HTML export?`);
  }
  const options = JSON.parse(unescapeAttribute(attributeMatch[1]));
  if (typeof options.xml !== 'string') {
    throw new Error(`${htmlPath}: data-mxgraph JSON has no "xml" key`);
  }
  const mxfile = options.xml.match(MXFILE);
  if (!mxfile) {
    throw new Error(`${htmlPath}: the "xml" value is not wrapped in <mxfile>…</mxfile>`);
  }
  return {
    html,
    attributeMatch,
    options,
    mxfilePrefix: mxfile[1],
    mxfileBody: mxfile[2],
    mxfileSuffix: mxfile[3],
  };
}

/**
 * Read one attribute out of a `<diagram>` tag's attribute string.
 *
 * @param {string} attributes Everything between `<diagram` and `>`.
 * @param {string} name Attribute to read.
 * @returns {string} Its value, or `''` when absent (draw.io omits `name` on
 *   single-page documents, which is not worth failing over).
 */
function attributeValue(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : '';
}

/**
 * Everything in a `<diagram>` tag that is neither `id` nor `name`, kept so
 * future draw.io versions can add attributes without us silently dropping them.
 *
 * @param {string} attributes Everything between `<diagram` and `>`.
 * @returns {string} The leftover attributes, leading space included, or `''`.
 */
function otherAttributes(attributes) {
  const rest = attributes.replace(/\s*\b(?:id|name)="[^"]*"/g, '').trim();
  return rest ? ` ${rest}` : '';
}
