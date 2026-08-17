import JSZip from "jszip";
import {
  SLIDE_HEIGHT_IN,
  SLIDE_WIDTH_IN,
  layoutSlide,
  resolvedTheme
} from "./presentationLayout.js";
import {
  normalizePresentationSpec,
  presentationSlideTitles
} from "./presentationSpec.js";

const EMU_PER_INCH = 914400;
const SLIDE_WIDTH = 12_192_000;
const SLIDE_HEIGHT = 6_858_000;

const NS = Object.freeze({
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rPkg: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types"
});

export async function renderPresentationArtifact(input, { assets = null } = {}) {
  const spec = normalizePresentationSpec(input);
  const theme = resolvedTheme(spec);
  const zip = new JSZip();
  const media = [];
  const notesIndexes = [];

  spec.slides.forEach((slide, index) => {
    if (slide.notes) notesIndexes.push(index);
    if (slide.layout === "chart") {
      const chart = assets?.charts?.get(index);
      if (!chart?.data) throw new Error(`slides[${index}] is missing a rendered chart snapshot`);
      media.push(mediaPart(index, "chart", chart));
    }
    if (slide.layout === "image") {
      const image = assets?.images?.get(slide.path);
      if (!image?.data) throw new Error(`slides[${index}] is missing workspace image ${slide.path}`);
      media.push(mediaPart(index, "image", image));
    }
  });
  if (assets?.logo?.data) media.push(mediaPart("logo", "logo", assets.logo));

  zip.file("[Content_Types].xml", contentTypesXml(spec.slides.length, media, notesIndexes));
  zip.file("_rels/.rels", packageRelsXml());
  zip.file("docProps/core.xml", coreXml(spec));
  zip.file("docProps/app.xml", appXml(spec));
  zip.file("ppt/presentation.xml", presentationXml(spec, notesIndexes.length > 0));
  zip.file("ppt/_rels/presentation.xml.rels", presentationRelsXml(spec.slides.length, notesIndexes.length > 0));
  zip.file("ppt/presProps.xml", PRES_PROPS_XML);
  zip.file("ppt/viewProps.xml", VIEW_PROPS_XML);
  zip.file("ppt/tableStyles.xml", TABLE_STYLES_XML);
  zip.file("ppt/theme/theme1.xml", themeXml(theme));
  zip.file("ppt/slideMasters/slideMaster1.xml", slideMasterXml(theme));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", SLIDE_MASTER_RELS_XML);
  zip.file("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml());
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", SLIDE_LAYOUT_RELS_XML);

  spec.slides.forEach((slide, index) => {
    const slideNumber = index + 1;
    const built = buildSlide(spec, slide, index, theme, assets, media);
    zip.file(`ppt/slides/slide${slideNumber}.xml`, built.xml);
    zip.file(
      `ppt/slides/_rels/slide${slideNumber}.xml.rels`,
      slideRelsXml(built.rels, slideNumber, notesIndexes.includes(index))
    );
    if (slide.notes) {
      zip.file(`ppt/notesSlides/notesSlide${slideNumber}.xml`, notesSlideXml(slide, slideNumber));
      zip.file(`ppt/notesSlides/_rels/notesSlide${slideNumber}.xml.rels`, notesSlideRelsXml(slideNumber));
    }
  });

  if (notesIndexes.length > 0) {
    zip.file("ppt/notesMasters/notesMaster1.xml", notesMasterXml(theme));
    zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", NOTES_MASTER_RELS_XML);
  }

  for (const part of media) {
    zip.file(`ppt/media/${part.fileName}`, part.data);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  const verification = await verifyPresentationBuffer(buffer, spec);
  return { spec, buffer, verification };
}

export async function verifyPresentationBuffer(buffer, input) {
  const spec = input?.slides ? input : normalizePresentationSpec(input);
  if (!(buffer?.[0] === 0x50 && buffer[1] === 0x4B)) {
    throw new Error("Generated PPTX did not contain a valid ZIP package header");
  }
  const zip = await JSZip.loadAsync(buffer);
  const contentTypes = await requiredFile(zip, "[Content_Types].xml");
  if (!contentTypes.includes("presentationml.presentation.main+xml")) {
    throw new Error("Generated PPTX is missing the presentation content type");
  }
  const presentation = await requiredFile(zip, "ppt/presentation.xml");
  if (!presentation.includes("<p:sldIdLst>") || !presentation.includes("<p:sldSz")) {
    throw new Error("Generated PPTX is missing ppt/presentation.xml slide structure");
  }
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideIndex(left) - slideIndex(right));
  if (slideFiles.length !== spec.slides.length) {
    throw new Error("Generated PPTX did not reopen with the expected slide count");
  }
  const expectedMedia = countExpectedMedia(spec);
  const packagedMedia = Object.keys(zip.files)
    .filter((name) => /^ppt\/media\/.+/.test(name)).length;
  if (packagedMedia !== expectedMedia) {
    throw new Error(
      `Generated PPTX packaged ${packagedMedia} media parts, expected ${expectedMedia}`
    );
  }
  const extracted = await extractPresentationTextFromZip(zip);
  if (!extracted.includes(spec.title)) {
    throw new Error("Generated PPTX failed text verification for the deck title");
  }
  for (const title of presentationSlideTitles(spec)) {
    if (!extracted.includes(title)) {
      throw new Error(`Generated PPTX failed text verification for slide title: ${title}`);
    }
  }
  return {
    verified: true,
    slideCount: slideFiles.length,
    extractedCharacters: extracted.length,
    titles: presentationSlideTitles(spec)
  };
}

export async function extractPresentationText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return extractPresentationTextFromZip(zip);
}

async function extractPresentationTextFromZip(zip) {
  const parts = [];
  const names = Object.keys(zip.files).sort((left, right) => {
    const leftSlide = slideIndex(left);
    const rightSlide = slideIndex(right);
    if (leftSlide && rightSlide && leftSlide !== rightSlide) return leftSlide - rightSlide;
    return left.localeCompare(right);
  });
  for (const name of names) {
    if (!/ppt\/(?:slides|notesSlides)\/.+\.xml$/.test(name) && name !== "docProps/core.xml") continue;
    const xml = await zip.file(name).async("string");
    const matches = xml.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<dc:title(?:\s[^>]*)?>([\s\S]*?)<\/dc:title>/g) || [];
    for (const match of matches) {
      const text = decodeXml((match.match(/>([\s\S]*)</) || [])[1] || "");
      if (text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n");
}

function buildSlide(spec, slide, index, theme, assets, media) {
  const shapes = [];
  const rels = [];
  const ids = { next: 2 };
  const takeId = () => ids.next++;
  const primitives = layoutSlide(spec, slide, index, theme, assets);

  for (const primitive of primitives) {
    if (primitive.kind === "rect") {
      shapes.push(rectShape(takeId(), primitive));
      continue;
    }
    if (primitive.kind === "text") {
      shapes.push(textShape(takeId(), primitive));
      continue;
    }
    if (primitive.kind === "table") {
      shapes.push(tableShape(takeId(), primitive));
      continue;
    }
    if (primitive.kind === "picture") {
      const part = media.find((candidate) => candidate.data.equals(primitive.asset.data));
      if (!part) throw new Error(`slides[${index}] is missing packaged media for ${primitive.name || "picture"}`);
      const relId = `rId${rels.length + 2}`;
      rels.push({ id: relId, type: "image", target: `../media/${part.fileName}` });
      shapes.push(pictureShape(takeId(), { ...primitive, relId, name: primitive.name }));
    }
  }

  return {
    xml: slideXml(shapes),
    rels
  };
}

function textShape(id, box) {
  const paragraphs = box.paragraphs || [{ text: box.text || "", bullet: box.bullet, size: box.size }];
  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="Text ${id}"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        ${xfrm(box)}
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${box.anchor || "t"}"/>
        <a:lstStyle/>
        ${paragraphs.map((paragraph) => textParagraph(paragraph, box)).join("")}
      </p:txBody>
    </p:sp>`;
}

function rectShape(id, box) {
  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="Shape ${id}"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        ${xfrm(box)}
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="${box.fill}"/></a:solidFill>
        ${box.line ? `<a:ln w="6350"><a:solidFill><a:srgbClr val="${box.line}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>"}
      </p:spPr>
    </p:sp>`;
}

function pictureShape(id, box) {
  return `
    <p:pic>
      <p:nvPicPr>
        <p:cNvPr id="${id}" name="${escapeXml(box.name || `Picture ${id}`)}"/>
        <p:cNvPicPr><a:picLocks noChangeAspect="0"/></p:cNvPicPr>
        <p:nvPr/>
      </p:nvPicPr>
      <p:blipFill>
        <a:blip r:embed="${box.relId}"/>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr>
        ${xfrm(box)}
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:pic>`;
}

function tableShape(id, box) {
  const columns = box.headers.length;
  const columnWidth = Math.floor(emu(box.w) / columns);
  const rowHeight = Math.floor(emu(box.h) / (box.rows.length + 1));
  const headerRow = tableRow(box.headers, columnWidth, rowHeight, box.theme, true);
  const bodyRows = box.rows.map((row) => tableRow(row, columnWidth, rowHeight, box.theme, false));
  return `
    <p:graphicFrame>
      <p:nvGraphicFramePr>
        <p:cNvPr id="${id}" name="Table ${id}"/>
        <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
        <p:nvPr/>
      </p:nvGraphicFramePr>
      <p:xfrm>
        <a:off x="${emu(box.x)}" y="${emu(box.y)}"/>
        <a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/>
      </p:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
          <a:tbl>
            <a:tblPr/>
            <a:tblGrid>${box.headers.map(() => `<a:gridCol w="${columnWidth}"/>`).join("")}</a:tblGrid>
            ${headerRow}
            ${bodyRows.join("")}
          </a:tbl>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>`;
}

function tableRow(cells, columnWidth, rowHeight, theme, header) {
  return `
    <a:tr h="${rowHeight}">
      ${cells.map((cell) => `
        <a:tc>
          <a:txBody>
            <a:bodyPr/>
            <a:lstStyle/>
            ${textParagraph({ text: cell || " ", size: header ? 12 : 12, bold: header, color: header ? "FFFFFF" : theme.text }, { align: "l" })}
          </a:txBody>
          <a:tcPr marL="91440" marR="91440" marT="68580" marB="68580">
            <a:solidFill><a:srgbClr val="${header ? theme.accent : theme.surface}"/></a:solidFill>
            <a:lnL w="6350"><a:solidFill><a:srgbClr val="${theme.line}"/></a:solidFill></a:lnL>
            <a:lnR w="6350"><a:solidFill><a:srgbClr val="${theme.line}"/></a:solidFill></a:lnR>
            <a:lnT w="6350"><a:solidFill><a:srgbClr val="${theme.line}"/></a:solidFill></a:lnT>
            <a:lnB w="6350"><a:solidFill><a:srgbClr val="${theme.line}"/></a:solidFill></a:lnB>
          </a:tcPr>
        </a:tc>`).join("")}
    </a:tr>`;
}

function textParagraph(paragraph, box) {
  const size = Math.round((paragraph.size || box.size || 16) * 100);
  const color = paragraph.color || box.color || "1F2937";
  const align = paragraph.align || box.align || "l";
  const bold = paragraph.bold ?? box.bold ? ' b="1"' : "";
  const bullet = paragraph.bullet
    ? `<a:buFont typeface="Arial"/><a:buChar char="•"/>`
    : "<a:buNone/>";
  return `
    <a:p>
      <a:pPr algn="${align}" marL="${paragraph.bullet ? 171450 : 0}" indent="${paragraph.bullet ? -171450 : 0}">
        ${bullet}
      </a:pPr>
      <a:r>
        <a:rPr lang="en-US" sz="${size}"${bold} dirty="0">
          <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
          <a:latin typeface="${escapeXml(box.font || "Calibri")}"/>
        </a:rPr>
        <a:t>${escapeXml(paragraph.text || "")}</a:t>
      </a:r>
      <a:endParaRPr lang="en-US" sz="${size}"/>
    </a:p>`;
}

function slideXml(shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>
        </a:xfrm>
      </p:grpSpPr>
      ${shapes.join("\n")}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function presentationXml(spec, includeNotesMaster = false) {
  const slideIds = spec.slides.map((_, index) =>
    `<p:sldId id="${256 + index}" r:id="rId${6 + index}"/>`
  ).join("");
  const notesMaster = includeNotesMaster
    ? `<p:notesMasterIdLst><p:notesMasterId r:id="rId${6 + spec.slides.length}"/></p:notesMasterIdLst>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  ${notesMaster}
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRelsXml(slideCount, includeNotesMaster = false) {
  const slides = Array.from({ length: slideCount }, (_, index) =>
    rel(`rId${6 + index}`, "slide", `slides/slide${index + 1}.xml`)
  );
  if (includeNotesMaster) {
    slides.push(rel(`rId${6 + slideCount}`, "notesMaster", "notesMasters/notesMaster1.xml"));
  }
  return relsXml([
    rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml"),
    rel("rId2", "theme", "theme/theme1.xml"),
    rel("rId3", "presProps", "presProps.xml"),
    rel("rId4", "viewProps", "viewProps.xml"),
    rel("rId5", "tableStyles", "tableStyles.xml"),
    ...slides
  ]);
}

function notesSlideRelsXml(slideNumber) {
  return relsXml([
    rel("rId1", "notesMaster", "../notesMasters/notesMaster1.xml"),
    rel("rId2", "slide", `../slides/slide${slideNumber}.xml`)
  ]);
}

function slideRelsXml(imageRels, slideNumber, hasNotes) {
  const relationships = [
    rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
    ...imageRels.map((item) => rel(item.id, item.type, item.target))
  ];
  if (hasNotes) {
    relationships.push(rel(`rId${relationships.length + 1}`, "notesSlide", `../notesSlides/notesSlide${slideNumber}.xml`));
  }
  return relsXml(relationships);
}

function contentTypesXml(slideCount, media, notesIndexes) {
  const slides = Array.from({ length: slideCount }, (_, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join("");
  const notes = notesIndexes.map((index) =>
    `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
  ).join("");
  const notesMaster = notesIndexes.length > 0
    ? `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${NS.ct}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${notesMaster}
  ${slides}
  ${notes}
</Types>`;
}

function packageRelsXml() {
  return relsXml([
    rel("rId1", "officeDocument", "ppt/presentation.xml"),
    rel("rId2", "core-properties", "docProps/core.xml", true),
    rel("rId3", "extended-properties", "docProps/app.xml")
  ]);
}

function coreXml(spec) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(spec.title)}</dc:title>
  <dc:creator>${escapeXml(spec.author || "AMOS Desktop")}</dc:creator>
  <cp:lastModifiedBy>AMOS Desktop deterministic presentation engine</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(spec) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>AMOS Desktop</Application>
  <PresentationFormat>Widescreen</PresentationFormat>
  <Slides>${spec.slides.length}</Slides>
  <Notes>${spec.slides.filter((slide) => slide.notes).length}</Notes>
  <HiddenSlides>0</HiddenSlides>
  <ScaleCrop>false</ScaleCrop>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>1.0.3</AppVersion>
</Properties>`;
}

function themeXml(theme) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${NS.a}" name="AMOS ${theme.font}">
  <a:themeElements>
    <a:clrScheme name="AMOS">
      <a:dk1><a:srgbClr val="${theme.text}"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="${theme.muted}"/></a:dk2>
      <a:lt2><a:srgbClr val="${theme.accentLight}"/></a:lt2>
      <a:accent1><a:srgbClr val="${theme.accent}"/></a:accent1>
      <a:accent2><a:srgbClr val="0F766E"/></a:accent2>
      <a:accent3><a:srgbClr val="C25D2C"/></a:accent3>
      <a:accent4><a:srgbClr val="6D5BD0"/></a:accent4>
      <a:accent5><a:srgbClr val="B78A00"/></a:accent5>
      <a:accent6><a:srgbClr val="3F7D4A"/></a:accent6>
      <a:hlink><a:srgbClr val="${theme.accent}"/></a:hlink>
      <a:folHlink><a:srgbClr val="${theme.muted}"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="AMOS">
      <a:majorFont><a:latin typeface="${theme.font}"/><a:ea typeface="${theme.font}"/><a:cs typeface="${theme.font}"/></a:majorFont>
      <a:minorFont><a:latin typeface="${theme.font}"/><a:ea typeface="${theme.font}"/><a:cs typeface="${theme.font}"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="AMOS">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;
}

function slideMasterXml(theme) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="${theme.background}"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    ${txStyle("titleStyle", 32)}
    ${txStyle("bodyStyle", 18)}
    ${txStyle("otherStyle", 14)}
  </p:txStyles>
</p:sldMaster>`;
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1">
  <p:cSld name="AMOS Blank">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function notesSlideXml(slide, slideNumber) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm/></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Slide Image Placeholder 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="sldImg"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Notes Placeholder 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          ${textParagraph({ text: slide.notes, size: 12 }, { color: "1F2937" })}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
}

function notesMasterXml(theme) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm/></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:notesStyle>${levelStyle(18)}</p:notesStyle>
</p:notesMaster>`;
}

function txStyle(name, size) {
  return `<p:${name}>${levelStyle(size)}</p:${name}>`;
}

function levelStyle(size) {
  return `<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">
    <a:defRPr sz="${size * 100}">
      <a:solidFill><a:schemeClr val="tx1"/></a:solidFill>
      <a:latin typeface="+mn-lt"/>
    </a:defRPr>
  </a:lvl1pPr>`;
}

function mediaPart(slideIndex, kind, asset) {
  const extension = asset.type === "jpeg" || asset.type === "jpg" ? "jpeg" : "png";
  const suffix = slideIndex === "logo" ? "logo" : `${kind}-${Number(slideIndex) + 1}`;
  return {
    kind,
    slideIndex: slideIndex === "logo" ? null : Number(slideIndex),
    fileName: `${suffix}.${extension}`,
    data: asset.data
  };
}

function xfrm(box, prefix = "a") {
  return `<${prefix}:xfrm>
    <${prefix}:off x="${emu(box.x)}" y="${emu(box.y)}"/>
    <${prefix}:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/>
  </${prefix}:xfrm>`;
}

function emu(inches) {
  return Math.round(Number(inches) * EMU_PER_INCH);
}

function rel(id, type, target, core = false) {
  const href = core
    ? "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"
    : type === "extended-properties"
      ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties"
      : type === "officeDocument"
        ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
        : `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}`;
  return `<Relationship Id="${id}" Type="${href}" Target="${target}"/>`;
}

function relsXml(relationships) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rPkg}">
  ${relationships.join("\n  ")}
</Relationships>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value) {
  return String(value)
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", "\"")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

async function requiredFile(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error(`Generated PPTX is missing ${name}`);
  return file.async("string");
}

function slideIndex(name) {
  const match = String(name).match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

const PRES_PROPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"/>`;

const VIEW_PROPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>
  <p:slideViewPr>
    <p:cSldViewPr>
      <p:cViewPr varScale="1">
        <p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale>
        <p:origin x="0" y="0"/>
      </p:cViewPr>
      <p:guideLst/>
    </p:cSldViewPr>
  </p:slideViewPr>
</p:viewPr>`;

const TABLE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

const SLIDE_MASTER_RELS_XML = relsXml([
  rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
  rel("rId2", "theme", "../theme/theme1.xml")
]);

const SLIDE_LAYOUT_RELS_XML = relsXml([
  rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")
]);

const NOTES_MASTER_RELS_XML = relsXml([
  rel("rId1", "theme", "../theme/theme1.xml")
]);

function countExpectedMedia(spec) {
  let count = spec.slides.filter((slide) => slide.layout === "chart").length
    + spec.slides.filter((slide) => slide.layout === "image").length;
  if (spec.brand?.logo_path) count += 1;
  return count;
}
