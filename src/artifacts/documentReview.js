import JSZip from "jszip";

const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";
const COMMENTS_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENTS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";

export async function applyDocumentReview(buffer, input = {}) {
  const zip = await JSZip.loadAsync(buffer);
  assertDocx(zip);
  let documentXml = await requiredText(zip, "word/document.xml");
  let revisionId = nextNumericId(documentXml);
  const author = clean(input.author || "AMOS Desktop", 200);
  const date = new Date(input.date || Date.now()).toISOString();
  const edits = normalizeEdits(input.edits);
  const comments = normalizeComments(input.comments);

  for (const edit of edits) {
    const location = locateTextRun(documentXml, edit.find, edit.occurrence);
    if (input.trackChanges === false) {
      documentXml = replaceClean(documentXml, location, edit.replace);
    } else {
      documentXml = replaceTracked(documentXml, location, edit.replace, {
        author,
        date,
        deleteId: revisionId,
        insertId: revisionId + 1
      });
      revisionId += 2;
    }
    if (edit.comment) {
      comments.push({
        find: edit.replace || edit.find,
        text: edit.comment,
        occurrence: edit.comment_occurrence || 1
      });
    }
  }

  let commentId = await nextCommentId(zip, documentXml);
  for (const comment of comments) {
    const location = locateTextRun(documentXml, comment.find, comment.occurrence);
    documentXml = anchorComment(documentXml, location, commentId);
    await appendComment(zip, { id: commentId, author, date, text: comment.text });
    commentId += 1;
  }

  zip.file("word/document.xml", documentXml);
  if (comments.length > 0) await wireComments(zip);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    buffer: output,
    review: await inspectDocumentReview(output),
    edits: edits.length,
    comments: comments.length
  };
}

export async function finalizeDocumentReview(buffer, input = {}) {
  const zip = await JSZip.loadAsync(buffer);
  assertDocx(zip);
  const changes = ["preserve", "accept", "reject"].includes(input.changes)
    ? input.changes
    : "accept";
  const comments = ["preserve", "remove"].includes(input.comments)
    ? input.comments
    : "remove";

  if (changes !== "preserve") {
    const storyPaths = Object.keys(zip.files).filter((path) =>
      /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)
    );
    for (const path of storyPaths) {
      const xml = await requiredText(zip, path);
      zip.file(path, resolveTrackedChanges(xml, changes));
    }
    const settings = zip.file("word/settings.xml");
    if (settings) {
      const xml = await settings.async("string");
      zip.file("word/settings.xml", xml.replace(/<w:trackRevisions\b[^>]*\/>/g, ""));
    }
  }
  if (comments === "remove") await removeComments(zip);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer: output, review: await inspectDocumentReview(output), changes, comments };
}

export async function inspectDocumentReview(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  assertDocx(zip);
  const storyPaths = Object.keys(zip.files).filter((path) => /^word\/.+\.xml$/.test(path));
  let inserted = 0;
  let deleted = 0;
  let anchors = 0;
  for (const path of storyPaths) {
    const xml = await zip.file(path).async("string");
    inserted += count(xml, /<w:ins\b/g);
    deleted += count(xml, /<w:del\b/g);
    anchors += count(xml, /<w:commentReference\b/g);
  }
  let commentBodies = 0;
  if (zip.file("word/comments.xml")) {
    commentBodies = count(await zip.file("word/comments.xml").async("string"), /<w:comment\b/g);
  }
  return {
    tracked_insertions: inserted,
    tracked_deletions: deleted,
    comment_anchors: anchors,
    comment_bodies: commentBodies
  };
}

function normalizeEdits(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("edits must contain at most 100 entries");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`edits[${index}] must be an object`);
    }
    const find = clean(entry.find, 4_000);
    const replace = cleanPreservingEmpty(entry.replace, 8_000);
    if (!find) throw new Error(`edits[${index}].find is required`);
    return {
      find,
      replace,
      occurrence: boundedOccurrence(entry.occurrence, `edits[${index}].occurrence`),
      comment: cleanPreservingEmpty(entry.comment, 2_000),
      comment_occurrence: boundedOccurrence(entry.comment_occurrence, `edits[${index}].comment_occurrence`)
    };
  });
}

function normalizeComments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("comments must contain at most 100 entries");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`comments[${index}] must be an object`);
    }
    return {
      find: clean(entry.find, 4_000),
      text: clean(entry.text, 2_000),
      occurrence: boundedOccurrence(entry.occurrence, `comments[${index}].occurrence`)
    };
  });
}

function locateTextRun(xml, find, occurrence = 1) {
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g;
  let paragraphMatch;
  let seen = 0;
  while ((paragraphMatch = paragraphPattern.exec(xml))) {
    const paragraphXml = paragraphMatch[0];
    const runPattern = /<w:r\b[\s\S]*?<\/w:r>/g;
    let runMatch;
    while ((runMatch = runPattern.exec(paragraphXml))) {
      const textPattern = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
      let textMatch;
      while ((textMatch = textPattern.exec(runMatch[0]))) {
        const decoded = decodeXml(textMatch[2]);
        let from = 0;
        while (true) {
          const offset = decoded.indexOf(find, from);
          if (offset < 0) break;
          seen += 1;
          if (seen === occurrence) {
            return {
              runStart: paragraphMatch.index + runMatch.index,
              runEnd: paragraphMatch.index + runMatch.index + runMatch[0].length,
              runXml: runMatch[0],
              textAttributes: textMatch[1],
              textValue: decoded,
              textOffset: offset,
              find
            };
          }
          from = offset + Math.max(1, find.length);
        }
      }
    }
  }
  throw new Error(
    `Could not find occurrence ${occurrence} of “${find.slice(0, 120)}” inside one editable Word text run. Choose a shorter exact anchor.`
  );
}

function replaceClean(xml, location, replacement) {
  const before = location.textValue.slice(0, location.textOffset);
  const after = location.textValue.slice(location.textOffset + location.find.length);
  const run = setRunText(location.runXml, `${before}${replacement}${after}`, "w:t");
  return `${xml.slice(0, location.runStart)}${run}${xml.slice(location.runEnd)}`;
}

function replaceTracked(xml, location, replacement, metadata) {
  const before = location.textValue.slice(0, location.textOffset);
  const after = location.textValue.slice(location.textOffset + location.find.length);
  const fragments = [];
  if (before) fragments.push(setRunText(location.runXml, before, "w:t"));
  fragments.push(
    `<w:del w:id="${metadata.deleteId}" w:author="${escapeXml(metadata.author)}" w:date="${metadata.date}">` +
    setRunText(location.runXml, location.find, "w:delText") +
    "</w:del>"
  );
  if (replacement) {
    fragments.push(
      `<w:ins w:id="${metadata.insertId}" w:author="${escapeXml(metadata.author)}" w:date="${metadata.date}">` +
      setRunText(location.runXml, replacement, "w:t") +
      "</w:ins>"
    );
  }
  if (after) fragments.push(setRunText(location.runXml, after, "w:t"));
  return `${xml.slice(0, location.runStart)}${fragments.join("")}${xml.slice(location.runEnd)}`;
}

function anchorComment(xml, location, id) {
  const before = location.textValue.slice(0, location.textOffset);
  const target = location.find;
  const after = location.textValue.slice(location.textOffset + target.length);
  const fragments = [];
  if (before) fragments.push(setRunText(location.runXml, before, "w:t"));
  fragments.push(
    `<w:commentRangeStart w:id="${id}"/>`,
    setRunText(location.runXml, target, "w:t"),
    `<w:commentRangeEnd w:id="${id}"/>`,
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`
  );
  if (after) fragments.push(setRunText(location.runXml, after, "w:t"));
  return `${xml.slice(0, location.runStart)}${fragments.join("")}${xml.slice(location.runEnd)}`;
}

function setRunText(runXml, value, tag) {
  const encoded = escapeXml(value);
  const text = `<${tag} xml:space="preserve">${encoded}</${tag}>`;
  if (!/<w:t\b[^>]*>[\s\S]*?<\/w:t>/.test(runXml)) {
    throw new Error("The selected Word run cannot be edited safely");
  }
  return runXml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/, text);
}

async function appendComment(zip, { id, author, date, text }) {
  const path = "word/comments.xml";
  const entry = `<w:comment w:id="${id}" w:author="${escapeXml(author)}" w:date="${date}">` +
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:comment>`;
  const file = zip.file(path);
  if (!file) {
    zip.file(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="${WORD_NAMESPACE}">${entry}</w:comments>`);
    return;
  }
  const xml = await file.async("string");
  const updated = /<\/w:comments>/.test(xml)
    ? xml.replace(/<\/w:comments>/, `${entry}</w:comments>`)
    : xml.replace(/<w:comments([^>]*)\/>/, `<w:comments$1>${entry}</w:comments>`);
  zip.file(path, updated);
}

async function wireComments(zip) {
  const relsPath = "word/_rels/document.xml.rels";
  const relsFile = zip.file(relsPath);
  let rels = relsFile
    ? await relsFile.async("string")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NAMESPACE}"></Relationships>`;
  if (!rels.includes(COMMENTS_RELATIONSHIP)) {
    const id = nextRelationshipId(rels);
    const relationship = `<Relationship Id="rId${id}" Type="${COMMENTS_RELATIONSHIP}" Target="comments.xml"/>`;
    rels = rels.replace(/<\/Relationships>/, `${relationship}</Relationships>`);
    zip.file(relsPath, rels);
  }
  const typesPath = "[Content_Types].xml";
  let types = await requiredText(zip, typesPath);
  if (!types.includes(COMMENTS_CONTENT_TYPE)) {
    const override = `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/>`;
    types = types.replace(/<\/Types>/, `${override}</Types>`);
    zip.file(typesPath, types);
  }
}

function resolveTrackedChanges(xml, mode) {
  let value = xml;
  if (mode === "accept") {
    value = value.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "");
    value = value.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, "$1");
    value = value.replace(/<w:moveFrom\b[^>]*>[\s\S]*?<\/w:moveFrom>/g, "");
    value = value.replace(/<w:moveTo\b[^>]*>([\s\S]*?)<\/w:moveTo>/g, "$1");
  } else {
    value = value.replace(/<w:ins\b[^>]*>[\s\S]*?<\/w:ins>/g, "");
    value = value.replace(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g, (_match, inner) =>
      inner.replace(/<w:delText\b([^>]*)>/g, "<w:t$1>").replace(/<\/w:delText>/g, "</w:t>")
    );
    value = value.replace(/<w:moveTo\b[^>]*>[\s\S]*?<\/w:moveTo>/g, "");
    value = value.replace(/<w:moveFrom\b[^>]*>([\s\S]*?)<\/w:moveFrom>/g, "$1");
  }
  return value;
}

async function removeComments(zip) {
  const storyPaths = Object.keys(zip.files).filter((path) =>
    /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)
  );
  for (const path of storyPaths) {
    let xml = await requiredText(zip, path);
    xml = xml
      .replace(/<w:commentRangeStart\b[^>]*\/>/g, "")
      .replace(/<w:commentRangeEnd\b[^>]*\/>/g, "")
      .replace(
        /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>?(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
        ""
      );
    zip.file(path, xml);
  }
  for (const path of [
    "word/comments.xml",
    "word/commentsExtended.xml",
    "word/commentsExtensible.xml",
    "word/commentsIds.xml",
    "word/people.xml"
  ]) zip.remove(path);

  const relsPath = "word/_rels/document.xml.rels";
  if (zip.file(relsPath)) {
    let rels = await requiredText(zip, relsPath);
    rels = rels.replace(new RegExp(`<Relationship\\b[^>]*Type="${escapeRegex(COMMENTS_RELATIONSHIP)}"[^>]*/>`, "g"), "");
    zip.file(relsPath, rels);
  }
  const typesPath = "[Content_Types].xml";
  let types = await requiredText(zip, typesPath);
  types = types.replace(/<Override\b[^>]*PartName="\/word\/(?:comments[^"/]*|people)\.xml"[^>]*\/>/g, "");
  zip.file(typesPath, types);
}

async function nextCommentId(zip, documentXml) {
  let maximum = maxNumericId(documentXml, /w:id="(\d+)"/g);
  if (zip.file("word/comments.xml")) {
    maximum = Math.max(maximum, maxNumericId(await requiredText(zip, "word/comments.xml"), /w:id="(\d+)"/g));
  }
  return maximum + 1;
}

function nextNumericId(xml) {
  return maxNumericId(xml, /w:id="(\d+)"/g) + 1;
}

function maxNumericId(xml, pattern) {
  let maximum = -1;
  for (const match of xml.matchAll(pattern)) maximum = Math.max(maximum, Number(match[1]));
  return maximum;
}

function nextRelationshipId(xml) {
  return maxNumericId(xml, /Id="rId(\d+)"/g) + 1;
}

function assertDocx(zip) {
  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) {
    throw new Error("The source file is not a valid Word DOCX package");
  }
}

async function requiredText(zip, path) {
  const file = zip.file(path);
  if (!file) throw new Error(`The DOCX package is missing ${path}`);
  return file.async("string");
}

function boundedOccurrence(value, field) {
  const number = value == null ? 1 : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1_000) {
    throw new Error(`${field} must be an integer from 1 to 1000`);
  }
  return number;
}

function clean(value, maximum) {
  const text = cleanPreservingEmpty(value, maximum);
  if (!text) throw new Error("A required document-review value is empty");
  return text;
}

function cleanPreservingEmpty(value, maximum) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (text.length > maximum) throw new Error(`Document-review text exceeds ${maximum} characters`);
  return text;
}

function count(value, pattern) {
  return value.match(pattern)?.length || 0;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
